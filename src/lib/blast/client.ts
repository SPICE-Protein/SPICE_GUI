// External BLAST transport.
//
// NCBI uses the public BLAST URL API: Put -> poll SearchInfo -> fetch
// JSON2_S. UniProt searches go through the EBI Job Dispatcher, which accepts
// UniProt databases and returns the same style of result as JSON. Both are
// asynchronous jobs, so the panel can poll and show elapsed time without
// holding a single long request open.

import { formBody, httpText, HttpError } from '$lib/net/http';
import { normalizeEbiDoc, normalizeNcbiDoc, parseNcbiPutResponse, parseNcbiSearchInfo, type EbiDoc, type NcbiDoc } from './parse';
import type { BlastProgress, BlastSearchRequest, BlastResult } from './types';

const DEFAULT_NCBI_BASE = 'https://blast.ncbi.nlm.nih.gov';
const DEFAULT_EBI_BASE = 'https://www.ebi.ac.uk/Tools/services/rest/ncbiblast';
const DEFAULT_UNIPROT_BASE = 'https://rest.uniprot.org';
const DEFAULT_EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** Base URLs can be redirected to a local mock by e2e tests. */
function baseUrl(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key)?.replace(/\/+$/, '') || fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cleanSequence(value: string): string {
  return value.toUpperCase().replace(/[^A-Z*-]/g, '');
}

function xmlError(text: string): string {
  const description = text.match(/<description>([\s\S]*?)<\/description>/)?.[1];
  return description?.trim() || text.slice(0, 300);
}

export interface RunBlastOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BlastProgress) => void;
}

export async function runBlast(
  request: BlastSearchRequest,
  options: RunBlastOptions = {},
): Promise<BlastResult> {
  const sequence = cleanSequence(request.sequence);
  if (!sequence) throw new Error('empty sequence');

  options.onProgress?.({ phase: 'submitting' });
  if (request.provider === 'ncbi') return runNcbi(request, sequence, options);
  return runEbi(request, sequence, options);
}

async function runNcbi(
  request: BlastSearchRequest,
  sequence: string,
  options: RunBlastOptions,
): Promise<BlastResult> {
  const { signal, onProgress } = options;
  const base = baseUrl('spice_blast_ncbi_base', DEFAULT_NCBI_BASE);
  const started = Date.now();
  const maxHits = request.maxHits ?? 50;

  const put = await httpText(`${base}/Blast.cgi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      CMD: 'Put',
      PROGRAM: request.program,
      DATABASE: request.database,
      QUERY: sequence,
      EXPECT: request.expect ?? 1e-5,
      HITLIST_SIZE: maxHits,
      TOOL: 'spice-gui',
      EMAIL: request.email,
    }),
    signal,
  });
  if (put.status !== 200) throw new HttpError(`NCBI submit HTTP ${put.status}`, put.status);

  const { rid, rtoe } = parseNcbiPutResponse(put.text);
  if (!rid) throw new Error(xmlError(put.text) || 'NCBI did not return a RID');

  let waitMs = Math.min(Math.max(rtoe * 1000, 2000), 30000);
  const deadline = Date.now() + 10 * 60 * 1000;
  let status = 'WAITING';
  while (status === 'WAITING' || status === 'UNKNOWN') {
    if (Date.now() > deadline) throw new Error('NCBI search timed out');
    onProgress?.({ phase: 'waiting', jobId: rid, elapsedMs: Date.now() - started });
    await sleep(waitMs, signal);
    waitMs = 3000;

    const poll = await httpText(
      `${base}/Blast.cgi?${formBody({ CMD: 'Get', FORMAT_OBJECT: 'SearchInfo', RID: rid })}`,
      { signal },
    );
    if (poll.status !== 200) throw new HttpError(`NCBI poll HTTP ${poll.status}`, poll.status);
    const info = parseNcbiSearchInfo(poll.text);
    status = info.status;
    if (status === 'FAILED') throw new Error(info.message || 'NCBI search failed');
    if (status === 'UNKNOWN') {
      // A RID that never becomes valid (expired or rejected) stays UNKNOWN.
      throw new Error(info.message || 'NCBI search expired');
    }
  }
  if (status !== 'READY') throw new Error(`NCBI returned status ${status}`);

  onProgress?.({ phase: 'fetching', jobId: rid, elapsedMs: Date.now() - started });
  const result = await httpText(
    `${base}/Blast.cgi?${formBody({ CMD: 'Get', FORMAT_TYPE: 'JSON2_S', RID: rid })}`,
    { signal },
  );
  if (result.status !== 200) throw new HttpError(`NCBI result HTTP ${result.status}`, result.status);
  if (!result.text.trim().startsWith('{')) throw new Error(xmlError(result.text) || 'NCBI returned no JSON');

  return normalizeNcbiDoc(JSON.parse(result.text) as NcbiDoc, request.database);
}

async function runEbi(
  request: BlastSearchRequest,
  sequence: string,
  options: RunBlastOptions,
): Promise<BlastResult> {
  const { signal, onProgress } = options;
  const email = request.email?.trim() ?? '';
  if (!email) throw new Error('email required');
  const base = baseUrl('spice_blast_ebi_base', DEFAULT_EBI_BASE);
  const started = Date.now();
  const maxHits = request.maxHits ?? 50;

  const submit = await httpText(`${base}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      email,
      program: request.program,
      stype: 'protein',
      database: request.database,
      sequence,
      exp: request.expect ?? 1e-5,
      alignments: maxHits,
      scores: maxHits,
    }),
    signal,
  });
  if (submit.status !== 200) throw new HttpError(`EBI submit HTTP ${submit.status}`, submit.status);
  const jobId = submit.text.trim();
  if (!jobId || jobId.startsWith('<')) throw new Error(xmlError(submit.text) || 'EBI did not return a job id');

  const deadline = Date.now() + 10 * 60 * 1000;
  let status = 'RUNNING';
  while (status === 'RUNNING' || status === 'PENDING' || status === 'QUEUED') {
    if (Date.now() > deadline) throw new Error('EBI search timed out');
    onProgress?.({ phase: 'waiting', jobId, elapsedMs: Date.now() - started });
    await sleep(2000, signal);
    const poll = await httpText(`${base}/status/${encodeURIComponent(jobId)}`, { signal });
    if (poll.status !== 200) throw new HttpError(`EBI poll HTTP ${poll.status}`, poll.status);
    status = (poll.text.match(/<status>([A-Z_]+)<\/status>/)?.[1] ?? poll.text.trim()).toUpperCase();
    if (status === 'ERROR' || status === 'FAILURE' || status === 'NOT_FOUND') {
      const detail = await httpText(`${base}/result/${encodeURIComponent(jobId)}/error`, { signal });
      throw new Error(detail.text.trim() || `EBI job ${status}`);
    }
  }
  if (status !== 'FINISHED') throw new Error(`EBI returned status ${status}`);

  onProgress?.({ phase: 'fetching', jobId, elapsedMs: Date.now() - started });
  const result = await httpText(`${base}/result/${encodeURIComponent(jobId)}/json`, { signal });
  if (result.status !== 200) throw new HttpError(`EBI result HTTP ${result.status}`, result.status);
  if (!result.text.trim().startsWith('{')) throw new Error(xmlError(result.text) || 'EBI returned no JSON');

  return normalizeEbiDoc(JSON.parse(result.text) as EbiDoc, request.database);
}

function fastaSequence(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>'))
    .join('')
    .replace(/[^A-Za-z*]/g, '')
    .toUpperCase();
}

export async function fetchUniprotFasta(accession: string, signal?: AbortSignal): Promise<string> {
  const base = baseUrl('spice_blast_uniprot_base', DEFAULT_UNIPROT_BASE);
  const response = await httpText(`${base}/uniprotkb/${encodeURIComponent(accession)}.fasta`, { signal });
  if (response.status !== 200) throw new HttpError(`UniProt HTTP ${response.status}`, response.status);
  const seq = fastaSequence(response.text);
  if (!seq) throw new Error('UniProt returned an empty sequence');
  return seq;
}

export async function fetchNcbiProteinFasta(accession: string, signal?: AbortSignal): Promise<string> {
  const base = baseUrl('spice_blast_eutils_base', DEFAULT_EUTILS_BASE);
  const query = formBody({
    db: 'protein',
    id: accession,
    rettype: 'fasta',
    retmode: 'text',
    tool: 'spice-gui',
  });
  const response = await httpText(`${base}/efetch.fcgi?${query}`, { signal });
  if (response.status !== 200) throw new HttpError(`NCBI efetch HTTP ${response.status}`, response.status);
  const seq = fastaSequence(response.text);
  if (!seq) throw new Error('NCBI returned an empty sequence');
  return seq;
}
