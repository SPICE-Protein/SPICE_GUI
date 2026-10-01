// SPD (SPICE Protein Database) HTTP client for d-api.spicebio.top.
//
// Auth model: Universal API Token (`Authorization: Bearer spd_…`), minted by
// the user on the SPD website (https://d.spicebio.top, after ORCID login) and
// pasted into Settings → Public Integrations. The token inherits the minting
// user's live roles; every create/query-write endpoint requires it.
//
// Transport: the packaged Tauri app cannot `fetch` cross-origin (the worker's
// CORS list only allows the SPD web + dev origins), so desktop requests go
// through the `spd_request` Rust command; browser dev mode uses fetch — its
// localhost:5173 origin is explicitly allow-listed server-side.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/backend/api';
import type {
  SpdClientOptions, SpdEnvironmentInput, SpdErrorBody, SpdFoldInput, SpdFoldQuery,
  SpdFoldSummary, SpdGraphData, SpdGraphQuery, SpdHealth, SpdModelInput, SpdProteinInput,
  SpdSequenceInput, SpdUserMe,
} from './types';

export const SPD_DEFAULT_BASE_URL = 'https://d-api.spicebio.top/api/v1';
/** Stable protocol identifiers used in fold/model identity hashes. Bump only
 *  when the submitted payload semantics change — dedup keys depend on them. */
export const SPD_INPUT_PROTOCOL_VERSION = 'spice-gui-input-v1';
export const SPD_INFERENCE_PROTOCOL_VERSION = 'spice-gui-fold-v1';

export class SpdApiError extends Error {
  readonly code: string; readonly fields?: string[] | null;
  constructor(code: string, message: string, fields?: string[] | null) {
    super(message);
    this.name = 'SpdApiError';
    this.code = code;
    this.fields = fields;
  }
}

function readStoredBaseUrl(): string {
  if (typeof localStorage === 'undefined') return SPD_DEFAULT_BASE_URL;
  const raw = localStorage.getItem('spice_spd_base_url') || '';
  // Pre-restructure builds defaulted to the relative '/api/v1' (same-origin
  // proxy that no longer exists); migrate silently to the production host.
  if (!raw || raw === '/api/v1') return SPD_DEFAULT_BASE_URL;
  return raw;
}
export function spdBaseUrl(): string { return readStoredBaseUrl().replace(/\/$/, ''); }
export function spdToken(): string { return (typeof localStorage !== 'undefined' && localStorage.getItem('spice_spd_api_token')) || ''; }

export class SpdClient {
  readonly baseUrl: string;
  private readonly token: string;
  constructor(options: SpdClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? readStoredBaseUrl()).replace(/\/$/, '');
    this.token = options.token ?? spdToken();
  }

  private async http<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\//, '')}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const payloadText = body === undefined ? null : JSON.stringify(body);

    let status: number;
    let text: string;
    if (isTauri()) {
      const out = await invoke<{ status: number; body: string }>('spd_request', { method, url, headers, body: payloadText });
      status = out.status;
      text = out.body;
    } else {
      const resp = await fetch(url, { method, headers, body: payloadText ?? undefined });
      status = resp.status;
      text = await resp.text();
    }

    let payload: unknown;
    try { payload = JSON.parse(text); } catch {
      throw new SpdApiError(`HTTP_${status}`, `SPD returned non-JSON (${status}): ${text.slice(0, 160)}`);
    }
    const obj = payload as Record<string, unknown> & { error?: SpdErrorBody | null };
    if (obj && typeof obj === 'object' && obj.error) {
      throw new SpdApiError(obj.error.code ?? `HTTP_${status}`, obj.error.message ?? 'request failed', obj.error.fields ?? null);
    }
    if (status >= 400) {
      const msg = typeof (obj as { message?: unknown })?.message === 'string' ? (obj as { message: string }).message : text.slice(0, 160);
      throw new SpdApiError(`HTTP_${status}`, msg);
    }
    // Reads/lists use the { data, meta, error } envelope; creation receipts are
    // bare objects ({ <entity>: …, created, deduplicated }).
    if (obj && typeof obj === 'object' && 'data' in obj && ('meta' in obj || 'error' in obj)) {
      return obj.data as T;
    }
    return payload as T;
  }

  health() { return this.http<SpdHealth>('GET', '/health'); }
  me() { return this.http<SpdUserMe>('GET', '/user/me'); }

  createEnvironment(input: SpdEnvironmentInput) { return this.http<Record<string, unknown>>('POST', '/environments', input); }
  createModel(input: SpdModelInput) { return this.http<Record<string, unknown>>('POST', '/models', input); }
  createProtein(input: SpdProteinInput) { return this.http<Record<string, unknown>>('POST', '/proteins', input); }
  createSequence(input: SpdSequenceInput) { return this.http<Record<string, unknown>>('POST', '/sequences', input); }
  createFold(input: SpdFoldInput) { return this.http<Record<string, unknown>>('POST', '/folds', input); }

  queryFolds(query: SpdFoldQuery) { return this.http<SpdFoldSummary[]>('POST', '/folds/query', query); }
  /** Graph DSL batch read — roots walk registered edges in one metered call. */
  graphQuery(query: SpdGraphQuery) { return this.http<SpdGraphData>('POST', '/query', query); }
  getFold(id: string) { return this.http<SpdFoldSummary>(`GET`, `/folds/${encodeURIComponent(id)}`); }
  getConstruct(id: string) { return this.http<Record<string, unknown>>(`GET`, `/constructs/${encodeURIComponent(id)}`); }
  schema(entityType: string) { return this.http<{ entityType: string; jsonSchema: Record<string, unknown>; schemaVersion?: string }>('GET', `/schema/${encodeURIComponent(entityType)}`); }
}

export function configureSpdClient(options: SpdClientOptions = {}) { return new SpdClient(options); }
export const spdClient = new SpdClient();
export default SpdClient;
