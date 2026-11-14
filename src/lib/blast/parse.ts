// Normalise NCBI BLAST JSON2_S and EBI Job Dispatcher JSON into one shape.
// Both formats are plain JSON, so no XML parsing (and no DOMParser dependency)
// is needed in either the desktop or the browser build.

import type { BlastHit, BlastHsp, BlastProgram, BlastProvider, BlastResult } from './types';

interface NcbiHsp {
  bit_score: number;
  score: number;
  evalue: number;
  identity: number;
  align_len: number;
  gaps: number;
  query_from: number;
  query_to: number;
  hit_from: number;
  hit_to: number;
  query_strand?: string;
  hit_strand?: string;
  qseq?: string;
  hseq?: string;
  midline?: string;
}

interface NcbiHit {
  num: number;
  description: { id?: string; accession?: string; title?: string; sciname?: string }[];
  len: number;
  hsps?: NcbiHsp[];
}

interface NcbiDoc {
  BlastOutput2?: {
    report?: {
      program?: string;
      search_target?: { db?: string };
      results?: {
        search?: {
          query_len?: number;
          hits?: NcbiHit[];
        };
      };
    };
  }[];
}

interface EbiHsp {
  hsp_bit_score: number;
  hsp_score: number;
  hsp_expect: number;
  hsp_identity: number;
  hsp_align_len: number;
  hsp_gaps: number;
  hsp_query_from: number;
  hsp_query_to: number;
  hsp_hit_from: number;
  hsp_hit_to: number;
  hsp_query_frame?: string;
  hsp_hit_frame?: string;
  hsp_qseq?: string;
  hsp_hseq?: string;
  hsp_mseq?: string;
}

interface EbiHit {
  hit_acc: string;
  hit_id: string;
  hit_def?: string;
  hit_desc?: string;
  hit_os?: string;
  hit_len: number;
  hit_hsps?: EbiHsp[];
}

interface EbiDoc {
  program?: string;
  query_len?: number;
  hits?: EbiHit[];
}

function numberOr(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function programOf(value: unknown, fallback: BlastProgram): BlastProgram {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('blastn')) return 'blastn';
  if (text.includes('blastp')) return 'blastp';
  return fallback;
}

export function normalizeNcbiDoc(
  doc: NcbiDoc,
  database: string,
): BlastResult {
  const report = doc?.BlastOutput2?.[0]?.report;
  const search = report?.results?.search;
  const queryLength = numberOr(search?.query_len);
  const hits: BlastHit[] = (search?.hits ?? []).map((hit) => {
    const desc = hit.description?.[0] ?? {};
    const hsps: BlastHsp[] = (hit.hsps ?? []).map((hsp) => {
      const alignLen = numberOr(hsp.align_len);
      return {
        bitScore: numberOr(hsp.bit_score),
        score: numberOr(hsp.score),
        evalue: numberOr(hsp.evalue),
        // NCBI reports identity as a residue count, not a percentage.
        identity: alignLen ? (numberOr(hsp.identity) / alignLen) * 100 : 0,
        alignLen,
        gaps: numberOr(hsp.gaps),
        queryFrom: numberOr(hsp.query_from),
        queryTo: numberOr(hsp.query_to),
        hitFrom: numberOr(hsp.hit_from),
        hitTo: numberOr(hsp.hit_to),
        queryStrand: cleanText(hsp.query_strand) || 'Plus',
        hitStrand: cleanText(hsp.hit_strand) || 'Plus',
        qseq: cleanText(hsp.qseq),
        hseq: cleanText(hsp.hseq),
        midline: cleanText(hsp.midline),
      };
    });
    return {
      accession: cleanText(desc.accession) || cleanText(desc.id),
      id: cleanText(desc.id),
      title: cleanText(desc.title),
      organism: cleanText(desc.sciname),
      length: numberOr(hit.len),
      hsps,
    };
  });

  return {
    provider: 'ncbi',
    program: programOf(report?.program, 'blastn'),
    database: cleanText(report?.search_target?.db) || database,
    queryLength,
    hits,
  };
}

export function normalizeEbiDoc(doc: EbiDoc, database: string): BlastResult {
  const queryLength = numberOr(doc?.query_len);
  const hits: BlastHit[] = (doc?.hits ?? []).map((hit) => {
    const hsps: BlastHsp[] = (hit.hit_hsps ?? []).map((hsp) => ({
      bitScore: numberOr(hsp.hsp_bit_score),
      score: numberOr(hsp.hsp_score),
      evalue: numberOr(hsp.hsp_expect),
      // EBI already reports percent identity.
      identity: numberOr(hsp.hsp_identity),
      alignLen: numberOr(hsp.hsp_align_len),
      gaps: numberOr(hsp.hsp_gaps),
      queryFrom: numberOr(hsp.hsp_query_from),
      queryTo: numberOr(hsp.hsp_query_to),
      hitFrom: numberOr(hsp.hsp_hit_from),
      hitTo: numberOr(hsp.hsp_hit_to),
      queryStrand: cleanText(hsp.hsp_query_frame) || '0',
      hitStrand: cleanText(hsp.hsp_hit_frame) || '0',
      qseq: cleanText(hsp.hsp_qseq),
      hseq: cleanText(hsp.hsp_hseq),
      midline: cleanText(hsp.hsp_mseq),
    }));
    return {
      accession: cleanText(hit.hit_acc),
      id: cleanText(hit.hit_id),
      title: cleanText(hit.hit_desc) || cleanText(hit.hit_def),
      organism: cleanText(hit.hit_os),
      length: numberOr(hit.hit_len),
      hsps,
    };
  });

  return {
    provider: 'ebi',
    program: programOf(doc?.program, 'blastp'),
    database,
    queryLength,
    hits,
  };
}

/** Parse the `RID = ...` / `RTOE = ...` block of an NCBI Put response. */
export function parseNcbiPutResponse(text: string): { rid: string; rtoe: number } {
  const info = text.match(/QBlastInfoBegin([\s\S]*?)QBlastInfoEnd/);
  const block = info ? info[1] : text;
  const rid = block.match(/RID\s*=\s*([A-Z0-9]+)/)?.[1] ?? '';
  const rtoe = numberOr(block.match(/RTOE\s*=\s*(\d+)/)?.[1], 10);
  return { rid, rtoe };
}

/** Parse `Status=READY` (plus `ThereAreHits=yes`) from an NCBI SearchInfo page. */
export function parseNcbiSearchInfo(text: string): {
  status: string;
  hasHits: boolean;
  message: string;
} {
  const status = text.match(/Status\s*=\s*([A-Z_]+)/)?.[1] ?? 'UNKNOWN';
  const hasHits = /ThereAreHits\s*=\s*yes/i.test(text);
  const message =
    text.match(/<p class="error">([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ??
    text.match(/Message\s*=\s*(.+)/)?.[1]?.trim() ??
    '';
  return { status, hasHits, message };
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export type { NcbiDoc, EbiDoc };
