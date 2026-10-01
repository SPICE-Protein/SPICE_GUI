// Low-level byte/text codecs shared by the .spiceproj container (container.ts).
//
// Three generations of on-disk encodings, ALL auto-detected on open:
//   1. plain UTF-8 JSON          (starts with '{')
//   2. gzip'ed JSON              (magic 1f 8b)
//   3. SPJB private binary container (magic "SPJB" — see container.ts)
// Compression uses the webview's own CompressionStream/DecompressionStream
// (Safari 16.4+/Chromium) — no new dependency.

export const GZIP_MAGIC_0 = 0x1f;
export const GZIP_MAGIC_1 = 0x8b;

export function looksGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

export function compressionAvailable(): boolean {
  return typeof globalThis.CompressionStream === 'function' && typeof globalThis.DecompressionStream === 'function';
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode a legacy gzip-JSON or plain-JSON .spiceproj buffer into text. */
export async function inflateBytesToText(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  if (looksGzip(bytes)) {
    if (!compressionAvailable()) {
      throw new Error('this .spiceproj is gzip-compressed, but the current webview lacks DecompressionStream');
    }
    const inflated = await gunzipBytes(bytes);
    return new TextDecoder().decode(inflated);
  }
  return new TextDecoder().decode(bytes);
}
