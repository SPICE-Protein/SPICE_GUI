// Minimal PDF 1.4 writer for Figure Studio. One page, one embedded RGB image,
// page dimensions taken from the document's physical millimetre size. The
// object builder is pure and testable in Node; only `renderPdf` needs a canvas.
import { renderSvgToCanvas } from './render';
import type { FigureDocument } from './types';

/** PDF user-space points per millimetre (1 pt = 1/72 in). */
export const PAGE_MM_TO_PT = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PAGE_MM_TO_PT;
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value
    .toFixed(4)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

/** PDF literal string, switching to UTF-16BE hex for non-ASCII titles. */
function pdfString(value: string): string {
  const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(clean)) {
    return `(${clean.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  }
  let hex = 'FEFF';
  for (let i = 0; i < clean.length; i++) {
    hex += clean.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/** zlib/deflate bytes. Uses the web stream in browsers and Node's zlib fallback. */
async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // A variable specifier keeps Vite from trying to bundle a Node built-in into
  // the browser build; the branch only runs in a Node test environment.
  const specifier = 'node:zlib';
  const zlib = (await import(/* @vite-ignore */ specifier)) as {
    deflateSync(data: Uint8Array): Uint8Array;
  };
  return new Uint8Array(zlib.deflateSync(bytes));
}

/**
 * Build a one-page PDF from raw RGB samples (row-major, no padding).
 *
 * @param rgb       width * height * 3 bytes.
 * @param pageWpt   page width in points.
 * @param pageHpt   page height in points.
 */
export async function buildPdfFromRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  pageWpt: number,
  pageHpt: number,
  title = 'Figure',
): Promise<Uint8Array> {
  const expected = width * height * 3;
  if (width <= 0 || height <= 0 || rgb.length !== expected) {
    throw new Error(`Invalid RGB buffer: expected ${expected} bytes for ${width}x${height}, received ${rgb.length}`);
  }

  const compressed = await deflateBytes(rgb);
  const content = new TextEncoder().encode(
    `q\n${pdfNumber(pageWpt)} 0 0 ${pdfNumber(pageHpt)} 0 0 cm\n/Im0 Do\nQ\n`,
  );

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let offset = 0;
  const appendBytes = (data: Uint8Array): void => {
    parts.push(data);
    offset += data.length;
  };
  const appendText = (text: string): void => appendBytes(encoder.encode(text));
  const offsets = new Array<number>(7).fill(0);

  // "%PDF-1.4" plus the conventional high-bit marker comment.
  appendBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  offsets[1] = offset;
  appendText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = offset;
  appendText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets[3] = offset;
  appendText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(pageWpt)} ${pdfNumber(
      pageHpt,
    )}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  offsets[4] = offset;
  appendText(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  appendBytes(content);
  appendText('endstream\nendobj\n');

  offsets[5] = offset;
  appendText(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
  );
  appendBytes(compressed);
  appendText('\nendstream\nendobj\n');

  offsets[6] = offset;
  appendText(
    `6 0 obj\n<< /Title ${pdfString(title)} /Producer (SPICE Figure Studio) /Creator (SPICE Figure Studio) >>\nendobj\n`,
  );

  const xrefOffset = offset;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  appendText(xref);
  appendText(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * Rasterise the document at `dpi` and wrap it in a single-page PDF. PDF export
 * needs a canvas; calling this without a DOM throws immediately.
 */
export async function renderPdf(
  doc: FigureDocument,
  assets?: Map<string, { dataUrl: string; width: number; height: number }>,
  dpi = 300,
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('PDF export requires canvas rendering, which is unavailable in this environment');
  }
  const canvas = await renderSvgToCanvas(doc, assets, dpi);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable for PDF export');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    // PDF images have no alpha, so flatten onto white.
    const alpha = data[i + 3] / 255;
    rgb[j] = Math.round(data[i] * alpha + 255 * (1 - alpha));
    rgb[j + 1] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
    rgb[j + 2] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
  }
  return buildPdfFromRgb(
    rgb,
    canvas.width,
    canvas.height,
    mmToPt(doc.widthMm),
    mmToPt(doc.heightMm),
    doc.name || 'Figure',
  );
}
