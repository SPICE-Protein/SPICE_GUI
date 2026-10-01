// SPJB — SPice Project Binary container for .spiceproj (private protocol).
//
// Rationale (user call, 2026-09-20): a project bundles images, experimental
// data and coordinate trajectories; it was never meant to be human-readable,
// so optimize for size/robustness instead. Layers:
//   1. numeric bulk arrays (coords, trajectories, histograms) are stripped
//      from the JSON into raw Float32 chunks (JSON float text is ~4-5x fatter);
//   2. base64 data-URI images in markdown become raw binary chunks
//      (no +33% base64 tax, and PNG/JPEG payloads skip re-deflation);
//   3. the whole record stream is gzipped.
//
// File layout (little-endian):
//   0..3   magic  "SPJB"
//   4      u8     container version (1)
//   5      u8     flags (bit0 = payload gzipped)
//   6..7   u16    reserved (0)
//   8..11  u32    payload raw length
//   12..15 u32    payload stored length
//   16..   stored payload
//
// Payload (after inflate) = record stream:
//   [u8 kind][u32 len][bytes] ...
//   kind 0 = JSON header (UTF-8): the full SpiceProjectFile with
//            numeric arrays replaced by {"$c":id,"dim":d,"n":outerLen}
//            and data-URI images replaced by spicebin:<mime>:<id>
//   kind 1 = Float32 array bytes (count = n*dim)
//   kind 2 = raw binary blob (image)
// Chunk id = index among kind1/kind2 records in stream order (0-based).
//
// Fallbacks: opening gen-1 (plain JSON) and gen-2 (gzip'ed JSON) files is
// handled by the store's magic sniffing (see store.importFromFile).

import { compressionAvailable, gzipBytes, gunzipBytes } from './codecs';
import type { SpiceProjectFile } from './types';

const MAGIC = [0x53, 0x50, 0x4a, 0x42]; // "SPJB"
const CONTAINER_VERSION = 1;
const REC_JSON = 0;
const REC_F32 = 1;
const REC_BIN = 2;

// Any base64 data URI (journal images AND attached experimental-data files)
// is extracted into a raw binary chunk — no +33% base64 tax in the container.
const DATA_URI_RE = /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]+=[^;,]+)*);base64,([A-Za-z0-9+/=]+)/g;
const SPICEBIN_RE = /spicebin:([^:\s]+):(\d+)/g;

// Minimum elements before a numeric array is worth a chunk (placeholder JSON
// itself costs bytes).
const MIN_FLAT = 64;
const MIN_TUPLE_ROWS = 24;

export function looksLikeContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}

interface ChunkRec {
  kind: number;
  bytes: Uint8Array;
}

function allFiniteNumbers(arr: unknown[]): boolean {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;

  }
  return true;
}

/** If `arr` is a big numeric array (flat or uniform rows of small tuples),
 *  return the flattened numbers + row dimension; else null. */
function numericCandidate(arr: unknown[]): { flat: number[]; dim: number; n: number } | null {
  if (!arr.length) return null;
  const first = arr[0];
  if (typeof first === 'number') {
    if (arr.length < MIN_FLAT || !allFiniteNumbers(arr)) return null;
    return { flat: arr as number[], dim: 1, n: arr.length };
  }
  if (Array.isArray(first)) {
    const L = first.length;
    if (L < 2 || L > 6 || arr.length < MIN_TUPLE_ROWS) return null;
    if (!allFiniteNumbers(first)) return null;
    const flat: number[] = [];
    for (const row of arr) {
      if (!Array.isArray(row) || row.length !== L || !allFiniteNumbers(row)) return null;
      for (const v of row as number[]) flat.push(v);
    }
    return { flat, dim: L, n: arr.length };
  }
  return null;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------- encode ----------------

export async function encodeProject(project: SpiceProjectFile): Promise<Uint8Array> {
  // Deep-clone via JSON round-trip so we never mutate the live $state graph.
  const clone = JSON.parse(JSON.stringify(project)) as unknown;
  const chunks: ChunkRec[] = [];

  const transform = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const cand = numericCandidate(v);
      if (cand) {
        const id = chunks.length;
        const f32 = new Float32Array(cand.flat);
        chunks.push({ kind: REC_F32, bytes: new Uint8Array(f32.buffer) });
        return { $c: id, dim: cand.dim, n: cand.n };
      }
      for (let i = 0; i < v.length; i++) v[i] = transform(v[i]);
      return v;
    }
    if (typeof v === 'string') {
      if (!v.includes('data:image/')) return v;
      return v.replace(DATA_URI_RE, (_m, mime: string, b64: string) => {
        const id = chunks.length;
        chunks.push({ kind: REC_BIN, bytes: b64ToBytes(b64) });
        return `spicebin:${mime}:${id}`;
      });
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = transform(o[k]);
      return o;
    }
    return v;
  };

  transform(clone);

  const enc = new TextEncoder();
  const headerBytes = enc.encode(JSON.stringify(clone));
  const bodyLen = 5 + headerBytes.length;
  let bodyTotal = bodyLen;
  for (const c of chunks) bodyTotal += 5 + c.bytes.length;

  const payload = new Uint8Array(bodyTotal);
  const dv = new DataView(payload.buffer);
  let p = 0;
  const putRecord = (kind: number, bytes: Uint8Array) => {
    payload[p] = kind;
    dv.setUint32(p + 1, bytes.length, true);
    payload.set(bytes, p + 5);
    p += 5 + bytes.length;
  };
  putRecord(REC_JSON, headerBytes);
  for (const c of chunks) putRecord(c.kind, c.bytes);

  let stored = payload;
  let flags = 0;
  if (compressionAvailable()) {
    try {
      const gz = await gzipBytes(payload);
      if (gz.length < payload.length) {
        stored = gz;
        flags |= 1;
      }
    } catch {
      /* keep raw */
    }
  }

  const file = new Uint8Array(16 + stored.length);
  const fdv = new DataView(file.buffer);
  file.set(MAGIC, 0);
  file[4] = CONTAINER_VERSION;
  file[5] = flags;
  fdv.setUint32(8, payload.length, true);
  fdv.setUint32(12, stored.length, true);
  file.set(stored, 16);
  return file;
}

// ---------------- decode ----------------

function readRecords(payload: Uint8Array): { header: unknown; chunks: ChunkRec[] } {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let p = 0;
  let header: unknown = null;
  const chunks: ChunkRec[] = [];
  while (p + 5 <= payload.length) {
    const kind = payload[p];
    const len = dv.getUint32(p + 1, true);
    p += 5;
    if (p + len > payload.length) break;
    const bytes = payload.subarray(p, p + len);
    p += len;
    if (kind === REC_JSON) {
      header = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      chunks.push({ kind, bytes: bytes.slice() }); // slice: detach from payload
    }
  }
  if (header === null) throw new Error('SPJB: missing JSON record');
  return { header, chunks };
}

export async function decodeProjectAsync(fileBytes: Uint8Array): Promise<unknown> {
  if (!looksLikeContainer(fileBytes)) throw new Error('not an SPJB container');
  if (fileBytes[4] !== CONTAINER_VERSION) throw new Error(`unsupported SPJB version ${fileBytes[4]}`);
  const dv = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const rawLen = dv.getUint32(8, true);
  const storedLen = dv.getUint32(12, true);
  if (16 + storedLen > fileBytes.length) throw new Error('SPJB: truncated payload');
  let payload = fileBytes.subarray(16, 16 + storedLen);
  if (fileBytes[5] & 1) {
    if (!compressionAvailable()) throw new Error('SPJB payload is gzipped but DecompressionStream is unavailable');
    payload = await gunzipBytes(new Uint8Array(payload));
  }
  if (payload.length !== rawLen) throw new Error(`SPJB: length mismatch (${payload.length} != ${rawLen})`);

  const { header, chunks } = readRecords(payload instanceof Uint8Array && payload.byteOffset === 0 ? payload : new Uint8Array(payload));

  const restore = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = restore(v[i]);
      return v;
    }
    if (typeof v === 'string') {
      if (!v.includes('spicebin:')) return v;
      return v.replace(SPICEBIN_RE, (_m, mime: string, id: string) => {
        const rec = chunks[Number(id)];
        if (!rec || rec.kind !== REC_BIN) throw new Error(`SPJB: broken image ref ${_m}`);
        return `data:${mime};base64,${bytesToB64(rec.bytes)}`;
      });
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.$c === 'number') {
        const rec = chunks[o.$c];
        const dim = Number(o.dim) || 1;
        const n = Number(o.n) || 0;
        if (!rec || rec.kind !== REC_F32) throw new Error(`SPJB: broken chunk ref ${o.$c}`);
        const f32 = new Float32Array(rec.bytes.buffer, rec.bytes.byteOffset, rec.bytes.byteLength / 4);
        const nums = Array.from(f32);
        if (dim === 1) return nums;
        const rows: number[][] = [];
        for (let i = 0; i + dim <= nums.length; i += dim) rows.push(nums.slice(i, i + dim));
        void n;
        return rows;
      }
      for (const k of Object.keys(o)) o[k] = restore(o[k]);
      return o;
    }
    return v;
  };

  return restore(header);
}
