// SWISS-MODEL provider: submits a homology-modelling job to the public
// SWISS-MODEL Modelling API, polls it to completion and converts the returned
// PDB Cα trace into the internal `FoldOutput` shape.
//
// Only the Cα coordinates are real data. The distogram and contact map shipped
// to the viewers are derived from those coordinates, and the mutation head is
// reported as unavailable through the capability flags.

import { httpText } from '$lib/net/http';
import type { FoldOutput } from '$lib/backend/types';
import type {
  FoldCapabilities,
  FoldProvider,
  FoldProviderDescriptor,
  FoldProviderResult,
  FoldProgress,
  FoldRequest,
} from '../types';

const DEFAULT_BASE_URL = 'https://swissmodel.expasy.org';
const BASE_URL_STORAGE_KEY = 'spice_fold_swissmodel_base';
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;
const CONTACT_THRESHOLD_ANGSTROM = 8;

const CAPABILITIES: FoldCapabilities = {
  environment: false,
  pressure: false,
  mutantHead: false,
  // The viewer receives a derived distogram, but the model itself has no
  // distogram head, so the provider does not claim one.
  distogram: false,
  contactMap: false,
  mutationProbabilities: false,
  // QMEAN provides a global confidence score.
  confidence: true,
  asyncJob: true,
  requiresToken: true,
};

export const swissModelDescriptor: FoldProviderDescriptor = {
  id: 'swissmodel',
  name: 'SWISS-MODEL',
  description: 'Remote homology modelling via the SWISS-MODEL Modelling API.',
  capabilities: CAPABILITIES,
};

export interface SwissModelAutomodelBody {
  target_sequences: string[];
  project_title: string;
}

export interface SwissModelSummaryModel {
  modelId: string;
  coordinatesUrl: string;
  qmean?: number;
}

export interface SwissModelSummary {
  status: string;
  models: SwissModelSummaryModel[];
  message?: string;
}

export interface SwissModelFoldMeta {
  projectId: string;
  modelId: string;
  elapsedMs: number;
  qmean?: number;
}

/** Base URL for the API. Tests and e2e can point this at a local mock. */
export function swissModelBaseUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(BASE_URL_STORAGE_KEY);
      if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '');
    }
  } catch {
    // localStorage may be unavailable (private mode, non-browser runtime).
  }
  return DEFAULT_BASE_URL;
}

export function buildAutomodelBody(sequence: string, projectTitle = 'SPICE fold'): SwissModelAutomodelBody {
  return {
    target_sequences: [sequence],
    project_title: projectTitle,
  };
}

export function parseProjectId(raw: string): string {
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error(formatSwissModelError(raw));
  }
  const id = doc?.project_id ?? doc?.projectId;
  if (!id) {
    throw new Error('SWISS-MODEL response did not include a project id');
  }
  return String(id);
}

export function parseSummary(raw: string | unknown): SwissModelSummary {
  let doc: any;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new Error(formatSwissModelError(raw));
    }
  } else {
    doc = raw;
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error('SWISS-MODEL summary response was not a JSON object');
  }

  const project = doc.project ?? {};
  const status = String(doc.status ?? doc.project_status ?? project.status ?? '').toUpperCase();
  const modelsRaw = firstArray(doc.models, doc.result?.models, project.models, doc.results);
  const models: SwissModelSummaryModel[] = modelsRaw.map((model: any, index: number) => ({
    modelId: String(model.model_id ?? model.modelId ?? model.id ?? `model-${index + 1}`),
    coordinatesUrl: String(model.coordinates_url ?? model.coordinatesUrl ?? model.coordinates ?? ''),
    qmean: pickQmean(model),
  }));

  const message = doc.message ?? doc.error ?? project.message;
  return {
    status,
    models,
    message: message === undefined || message === null ? undefined : String(message),
  };
}

/** Collect Cα coordinates from ATOM records, preserving file order. */
export function parsePdbCaCoordinates(pdb: string): Array<[number, number, number]> {
  const coords: Array<[number, number, number]> = [];
  for (const line of pdb.split(/\r?\n/)) {
    if (line.slice(0, 6).trim() !== 'ATOM') continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const x = Number.parseFloat(line.slice(30, 38));
    const y = Number.parseFloat(line.slice(38, 46));
    const z = Number.parseFloat(line.slice(46, 54));
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      coords.push([x, y, z]);
    }
  }
  return coords;
}

export function pdbCaToFoldOutput(pdb: string, sequence: string, meta: SwissModelFoldMeta): FoldOutput {
  const ca = parsePdbCaCoordinates(pdb);
  if (ca.length === 0) {
    throw new Error('SWISS-MODEL PDB contains no Cα atoms');
  }

  const length = sequence.length;
  const known = ca.slice(0, Math.min(ca.length, length));

  // Missing positions are filled with the nearest known Cα so the trace stays
  // contiguous and deterministic. observed atoms occupy a prefix of the chain.
  const nearestKnown = (index: number): [number, number, number] => {
    let best = 0;
    for (let k = 0; k < known.length; k++) {
      if (Math.abs(k - index) < Math.abs(best - index)) best = k;
    }
    return known[best];
  };

  const coords: number[] = [];
  for (let i = 0; i < length; i++) {
    const point = i < known.length ? known[i] : nearestKnown(i);
    coords.push(point[0], point[1], point[2]);
  }

  const distExp = new Array<number>(length * length).fill(0);
  const pContact = new Array<number>(length * length).fill(0);
  for (let i = 0; i < length; i++) {
    for (let j = 0; j < length; j++) {
      const dx = coords[i * 3] - coords[j * 3];
      const dy = coords[i * 3 + 1] - coords[j * 3 + 1];
      const dz = coords[i * 3 + 2] - coords[j * 3 + 2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      distExp[i * length + j] = distance;
      pContact[i * length + j] = distance < CONTACT_THRESHOLD_ANGSTROM ? 1 : 0;
    }
  }

  const qmean = meta.qmean ?? 0;
  const coverage = length > 0 ? ca.length / length : 0;
  const conf = [clamp01(qmean / 100), clamp01(coverage)];

  return {
    length,
    coords,
    // The provider has no mutant head; mirror the reference trace so the
    // viewer still receives a well-formed payload.
    coordsMut: coords.slice(),
    distExp,
    pContact,
    mutation: new Array<number>(length * 20).fill(0),
    envOffset: [0, 0],
    conf,
    trainedHeads: ['A'],
    modelPath: `swissmodel://${meta.projectId}/${meta.modelId}`,
    runMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : 0,
  };
}

export function formatSwissModelError(raw: string, status?: number): string {
  let detail = (raw ?? '').trim();
  try {
    const parsed = JSON.parse(detail);
    if (Array.isArray(parsed?.errors)) {
      detail = parsed.errors.map((entry: unknown) => String(entry)).join('; ');
    } else {
      detail = String(parsed?.error ?? parsed?.message ?? parsed?.detail ?? detail);
    }
  } catch {
    // Not JSON: keep the raw text below.
  }
  detail = detail.replace(/\s+/g, ' ').slice(0, 300);
  const prefix = status === undefined ? 'SWISS-MODEL request failed' : `SWISS-MODEL HTTP ${status}`;
  return detail ? `${prefix}: ${detail}` : prefix;
}

export const swissModelFoldProvider: FoldProvider = {
  descriptor: swissModelDescriptor,

  async fold(request: FoldRequest, onProgress): Promise<FoldProviderResult> {
    const token = request.token?.trim();
    if (!token) throw new Error('SWISS-MODEL API token required');

    const baseUrl = swissModelBaseUrl();
    const pollIntervalMs = Math.max(1, request.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const maxWaitMs = Math.max(1, request.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
    const started = Date.now();
    const headers = {
      Authorization: `Token ${token}`,
      Accept: 'application/json',
    };

    onProgress?.({ phase: 'submitting', elapsedMs: 0 });

    const submit = await httpText(`${baseUrl}/automodel`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAutomodelBody(request.sequence)),
      signal: request.signal,
    });
    if (submit.status < 200 || submit.status >= 300) {
      throw new Error(formatSwissModelError(submit.text, submit.status));
    }

    const projectId = parseProjectId(submit.text);
    const deadline = started + maxWaitMs;
    let summary: SwissModelSummary | null = null;

    while (true) {
      const poll = await httpText(`${baseUrl}/project/${encodeURIComponent(projectId)}/models/summary/`, {
        headers,
        signal: request.signal,
      });
      if (poll.status < 200 || poll.status >= 300) {
        throw new Error(formatSwissModelError(poll.text, poll.status));
      }

      summary = parseSummary(poll.text);
      const elapsedMs = Date.now() - started;

      if (summary.status === 'FAILED') {
        const detail = summary.message ? `: ${summary.message}` : '';
        throw new Error(`SWISS-MODEL project ${projectId} failed${detail}`);
      }
      if (summary.status === 'COMPLETED') break;

      onProgress?.({ phase: 'waiting', jobId: projectId, elapsedMs });
      if (Date.now() >= deadline) {
        throw new Error(`SWISS-MODEL project ${projectId} timed out after ${maxWaitMs} ms`);
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), request.signal);
    }

    const model = summary.models.find((candidate) => candidate.coordinatesUrl);
    if (!model) {
      throw new Error(`SWISS-MODEL project ${projectId} completed without a downloadable model`);
    }

    onProgress?.({ phase: 'fetching', jobId: projectId, elapsedMs: Date.now() - started });

    const coordinateUrl = resolveUrl(model.coordinatesUrl, baseUrl);
    const download = await httpText(coordinateUrl, {
      headers: { Authorization: `Token ${token}`, Accept: 'text/plain' },
      signal: request.signal,
    });
    if (download.status < 200 || download.status >= 300) {
      throw new Error(formatSwissModelError(download.text, download.status));
    }

    const elapsedMs = Date.now() - started;
    const output = pdbCaToFoldOutput(download.text, request.sequence, {
      projectId,
      modelId: model.modelId,
      elapsedMs,
      qmean: model.qmean,
    });

    return {
      output,
      providerId: swissModelDescriptor.id,
      providerName: swissModelDescriptor.name,
      modelId: model.modelId,
      qmean: model.qmean,
      coordinateUrl,
      note: 'Homology model: distogram and contact map are derived from Cα coordinates.',
    };
  },
};

function firstArray(...candidates: unknown[]): any[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickQmean(model: any): number | undefined {
  const candidates = [
    model.qmean,
    model.qmean_global_score,
    model.qmean4_global_score,
    model.qmeandisco_global_score,
    model.global_score,
    model.score,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return normalizeQmean(candidate);
    }
    if (candidate && typeof candidate === 'object') {
      for (const key of ['global_score', 'score', 'z_score']) {
        const value = candidate[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          return normalizeQmean(value);
        }
      }
    }
  }
  return undefined;
}

/** SWISS-MODEL exports QMEAN either on a 0-1 or a 0-100 scale. */
function normalizeQmean(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('SWISS-MODEL request aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('SWISS-MODEL request aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
