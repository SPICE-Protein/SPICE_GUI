// Baseline TIFF writer for Figure Studio.
//
// The output is deliberately conservative: little-endian, 8-bit RGB, one
// uncompressed strip, no extra samples. That is the subset every journal
// production system and image editor accepts, and it keeps metadata explicit
// (DPI, description, software) instead of relying on format extensions.

import { renderSvgToCanvas, type ResolvedAssets } from './render';
import type { FigureDocument } from './types';

const SOFTWARE = 'SPICE Figure Studio';

const encoder = new TextEncoder();

function u16(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function u32(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

/** ASCII tag payload, always NUL-terminated as the TIFF spec requires. */
function ascii(value: string): Uint8Array {
  const text = encoder.encode(String(value ?? ''));
  const bytes = new Uint8Array(text.length + 1);
  bytes.set(text, 0);
  bytes[text.length] = 0;
  return bytes;
}

function rational(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  const [numerator, denominator] = reduceRational(value);
  view.setUint32(0, numerator, true);
  view.setUint32(4, denominator, true);
  return bytes;
}

function reduceRational(value: number): [number, number] {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-9 && rounded > 0) return [rounded, 1];
  let numerator = Math.round(value * 1000);
  let denominator = 1000;
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  return [numerator, denominator];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

function tiffDateTime(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}:${pad(now.getMonth() + 1)}:${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  bytes: Uint8Array;
}

/**
 * Encode RGBA pixels as an uncompressed baseline RGB TIFF.
 *
 * Alpha is dropped: callers that start from a transparent canvas must flatten
 * onto the intended background first (see `renderTiff`).
 */
export function encodeTiffRgb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dpi = 300,
  description = '',
): Uint8Array {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid TIFF dimensions: ${width} x ${height}`);
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error(`Invalid TIFF resolution: ${dpi}`);
  }
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`Invalid RGBA buffer: expected ${expected} bytes, got ${rgba.length}`);
  }

  const samples = 3;
  const pixels = new Uint8Array(width * height * samples);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += samples) {
    pixels[target] = rgba[source];
    pixels[target + 1] = rgba[source + 1];
    pixels[target + 2] = rgba[source + 2];
  }

  const bitsPerSample = u16([8, 8, 8]);
  const sampleFormat = u16([1, 1, 1]);
  const descriptionBytes = ascii(description);
  const softwareBytes = ascii(SOFTWARE);
  const dateBytes = ascii(tiffDateTime());

  // Tag order is ascending; offsets and counts are filled in below.
  const entries: IfdEntry[] = [
    { tag: 256, type: 4, count: 1, bytes: u32([width]) },
    { tag: 257, type: 4, count: 1, bytes: u32([height]) },
    { tag: 258, type: 3, count: 3, bytes: bitsPerSample },
    { tag: 259, type: 3, count: 1, bytes: u16([1]) },
    { tag: 262, type: 3, count: 1, bytes: u16([2]) },
    { tag: 270, type: 2, count: descriptionBytes.length, bytes: descriptionBytes },
    { tag: 273, type: 4, count: 1, bytes: u32([0]) },
    { tag: 277, type: 3, count: 1, bytes: u16([samples]) },
    { tag: 278, type: 4, count: 1, bytes: u32([height]) },
    { tag: 279, type: 4, count: 1, bytes: u32([pixels.length]) },
    { tag: 282, type: 5, count: 1, bytes: rational(dpi) },
    { tag: 283, type: 5, count: 1, bytes: rational(dpi) },
    { tag: 296, type: 3, count: 1, bytes: u16([2]) },
    { tag: 305, type: 2, count: softwareBytes.length, bytes: softwareBytes },
    { tag: 306, type: 2, count: dateBytes.length, bytes: dateBytes },
    { tag: 339, type: 3, count: 3, bytes: sampleFormat },
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdSize;
  const placements = entries.map((entry) => {
    if (entry.bytes.length <= 4) return { inline: true, offset: 0 };
    if (cursor % 2) cursor++;
    const offset = cursor;
    cursor += entry.bytes.length;
    if (cursor % 2) cursor++;
    return { inline: false, offset };
  });
  const stripOffset = cursor;
  const total = stripOffset + pixels.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // Patch the strip offset now that its position is known.
  const stripEntry = entries.find((entry) => entry.tag === 273);
  if (stripEntry) stripEntry.bytes = u32([stripOffset]);

  out[0] = 0x49; // 'I'
  out[1] = 0x49; // 'I' (little-endian)
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);

  let pointer = ifdOffset + 2;
  entries.forEach((entry, index) => {
    view.setUint16(pointer, entry.tag, true);
    view.setUint16(pointer + 2, entry.type, true);
    view.setUint32(pointer + 4, entry.count, true);
    const placement = placements[index];
    if (placement.inline) {
      out.set(entry.bytes, pointer + 8);
    } else {
      view.setUint32(pointer + 8, placement.offset, true);
      out.set(entry.bytes, placement.offset);
    }
    pointer += 12;
  });
  view.setUint32(pointer, 0, true); // next IFD

  out.set(pixels, stripOffset);
  return out;
}

/** Flatten straight alpha onto a white page background. */
function flattenOnWhite(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    const inverse = 1 - alpha;
    out[i] = Math.round(rgba[i] * alpha + 255 * inverse);
    out[i + 1] = Math.round(rgba[i + 1] * alpha + 255 * inverse);
    out[i + 2] = Math.round(rgba[i + 2] * alpha + 255 * inverse);
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Rasterise a figure at `dpi` and encode it as a baseline RGB TIFF.
 *
 * Canvas rendering is the only DOM-dependent step; the existing raster size
 * guard in `renderSvgToCanvas` rejects pages that would allocate too much
 * memory. Transparent corners are composited onto white.
 */
export async function renderTiff(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 300,
): Promise<Uint8Array> {
  const canvas = await renderSvgToCanvas(doc, assets, dpi);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const flattened = flattenOnWhite(image.data);
  const width = canvas.width;
  const height = canvas.height;
  const description =
    `${doc.name || 'Figure'} - ${doc.widthMm} x ${doc.heightMm} mm at ${dpi} dpi - ${SOFTWARE}`;
  return encodeTiffRgb(flattened, width, height, dpi, description);
}
