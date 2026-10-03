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
  SpdArtifactInput, SpdArtifactReceipt, SpdClientOptions, SpdEnzymeCreateInput, SpdEnzymeExport,
  SpdEnvironmentInput, SpdErrorBody, SpdFoldInput, SpdFoldQuery,
  SpdFoldSummary, SpdGraphData, SpdGraphQuery, SpdHealth, SpdModelInput, SpdProteinInput,
  SpdSequenceInput, SpdUploadGrant, SpdUserMe, SpdVectorDesign, SpdVectorDetail,
  SpdVectorReceipt, SpdVectorSummary, SpdVectorValidation,
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

  // ─── Vector templates (SPD design objects) ───
  // POST /vectors takes the §13 model UNDER `data` (DesignInput wrapper);
  // the receipt is bare: {id, created, data}.
  listVectors(q?: string) { return this.http<SpdVectorSummary[]>('GET', `/vectors${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  getVector(id: string) { return this.http<SpdVectorDetail>('GET', `/vectors/${encodeURIComponent(id)}`); }
  createVector(design: SpdVectorDesign) { return this.http<SpdVectorReceipt>('POST', '/vectors', { data: design }); }
  validateVector(id: string, body: { sequenceArtifactId?: string; strict?: boolean } = {}) {
    return this.http<SpdVectorValidation>('POST', `/vectors/${encodeURIComponent(id)}/validate`, body);
  }

  // ─── Restriction enzyme catalog (library sync source) ───
  // The export bundle is PUBLIC (no token) and is what "sync from SPD" pulls.
  listRestrictionEnzymes() { return this.http<{ items: unknown[] }>('GET', '/restriction-enzymes'); }
  exportRestrictionEnzymes() { return this.http<SpdEnzymeExport>('GET', '/restriction-enzymes/export'); }
  createRestrictionEnzyme(input: SpdEnzymeCreateInput) { return this.http<Record<string, unknown>>('POST', '/restriction-enzymes', input); }

  // ─── Artifact upload pipeline (raw bytes through the Rust bridge) ───
  // preflight: snake_case keys on the way in (PreflightInput has no rename);
  // the grant comes back camelCase. PUT /uploads/{token} then requires the
  // exact bytes + matching Content-Type + Content-Length (server compares
  // both against the grant), and returns the SERVER-side sha256 (bare hex).
  uploadPreflight(objectKey: string, contentType: string, size: number) {
    return this.http<SpdUploadGrant>('POST', '/user/uploads/preflight', { object_key: objectKey, content_type: contentType, size });
  }
  createArtifact(input: SpdArtifactInput) { return this.http<SpdArtifactReceipt>('POST', '/artifacts', input); }
  completeArtifact(id: string, sha256: string, byteLength: number) {
    return this.http<SpdArtifactReceipt>('POST', `/artifacts/${encodeURIComponent(id)}/complete`, { sha256, byteLength });
  }

  /** PUT raw bytes to an absolute grant URL (bypasses the base-url prefix).
   *  Desktop goes through `spd_put_bytes` (base64 over IPC); browser mode
   *  fetches directly — its dev origin is CORS-allow-listed. */
  async putUploadBytes(uploadUrl: string, contentType: string, bytes: Uint8Array): Promise<{ ok: boolean; objectKey: string; size: number; sha256: string }> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let text: string;
    let status: number;
    if (isTauri()) {
      const out = await invoke<{ status: number; body: string }>('spd_put_bytes', {
        url: uploadUrl, headers, bodyBase64: bytesToBase64(bytes),
      });
      status = out.status; text = out.body;
    } else {
      const resp = await fetch(uploadUrl, { method: 'PUT', headers, body: bytes.slice().buffer });
      status = resp.status; text = await resp.text();
    }
    let payload: unknown;
    try { payload = JSON.parse(text); } catch {
      throw new SpdApiError(`HTTP_${status}`, `upload returned non-JSON (${status}): ${text.slice(0, 160)}`);
    }
    const obj = payload as { ok?: boolean; objectKey?: string; size?: number; sha256?: string; error?: SpdErrorBody | null };
    if (obj && typeof obj === 'object' && obj.error) throw new SpdApiError(obj.error.code ?? `HTTP_${status}`, obj.error.message ?? 'upload failed', obj.error.fields ?? null);
    if (status >= 400) throw new SpdApiError(`HTTP_${status}`, text.slice(0, 200));
    return { ok: obj.ok === true, objectKey: obj.objectKey ?? '', size: obj.size ?? 0, sha256: obj.sha256 ?? '' };
  }

  /** GET /artifacts/{id}/content returns RAW bytes (fasta/genbank text here),
   *  not the JSON envelope — httpRawText skips the JSON parse. */
  async getArtifactContentText(id: string): Promise<string> {
    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(id)}/content`;
    const headers: Record<string, string> = { Accept: '*/*' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let status: number;
    let text: string;
    if (isTauri()) {
      const out = await invoke<{ status: number; body: string }>('spd_request', { method: 'GET', url, headers, body: null });
      status = out.status; text = out.body;
    } else {
      const resp = await fetch(url, { headers });
      status = resp.status; text = await resp.text();
    }
    if (status >= 400) throw new SpdApiError(`HTTP_${status}`, text.slice(0, 200));
    return text;
  }
}

/** Uint8Array → base64 without the spread-stack-overflow on big inputs. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function configureSpdClient(options: SpdClientOptions = {}) { return new SpdClient(options); }
export const spdClient = new SpdClient();
export default SpdClient;
