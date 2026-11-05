import { describe, expect, it } from 'vitest';
import * as UTIF from 'utif2';
import { encodeTiffRgb, renderTiff } from '$lib/tools/figure/tiff';
import { createFigureDocument } from '$lib/tools/figure/types';

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Offset of the 12-byte IFD entry itself. */
  entryOffset: number;
}

interface ParsedTiff {
  bytes: Uint8Array;
  view: DataView;
  ifdOffset: number;
  entries: Map<number, TiffEntry>;
}

function parseTiff(bytes: Uint8Array): ParsedTiff {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(4, true);
  const count = view.getUint16(ifdOffset, true);
  const entries = new Map<number, TiffEntry>();
  for (let index = 0; index < count; index++) {
    const entryOffset = ifdOffset + 2 + index * 12;
    entries.set(view.getUint16(entryOffset, true), {
      tag: view.getUint16(entryOffset, true),
      type: view.getUint16(entryOffset + 2, true),
      count: view.getUint32(entryOffset + 4, true),
      entryOffset,
    });
  }
  return { bytes, view, ifdOffset, entries };
}

function entryData(parsed: ParsedTiff, entry: TiffEntry): Uint8Array {
  const total = TYPE_SIZE[entry.type] * entry.count;
  if (total <= 4) {
    return parsed.bytes.subarray(entry.entryOffset + 8, entry.entryOffset + 8 + total);
  }
  const offset = parsed.view.getUint32(entry.entryOffset + 8, true);
  return parsed.bytes.subarray(offset, offset + total);
}

function scalar(parsed: ParsedTiff, tag: number): number {
  const entry = parsed.entries.get(tag)!;
  const data = entryData(parsed, entry);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return entry.type === 3 ? view.getUint16(0, true) : view.getUint32(0, true);
}

function shorts(parsed: ParsedTiff, tag: number): number[] {
  const entry = parsed.entries.get(tag)!;
  const data = entryData(parsed, entry);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const values: number[] = [];
  for (let index = 0; index < entry.count; index++) {
    values.push(view.getUint16(index * 2, true));
  }
  return values;
}

function rational(parsed: ParsedTiff, tag: number): [number, number] {
  const entry = parsed.entries.get(tag)!;
  const data = entryData(parsed, entry);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [view.getUint32(0, true), view.getUint32(4, true)];
}

function ascii(parsed: ParsedTiff, tag: number): string {
  const entry = parsed.entries.get(tag)!;
  return new TextDecoder('latin1')
    .decode(entryData(parsed, entry))
    .replace(/\0+$/, '');
}

const RGBA = new Uint8ClampedArray([
  255,
  0,
  0,
  255,
  0,
  255,
  0,
  128,
  0,
  0,
  255,
  0,
  255,
  255,
  255,
  255,
]);

describe('encodeTiffRgb', () => {
  it('writes a little-endian baseline TIFF header', () => {
    const bytes = encodeTiffRgb(RGBA, 2, 2, 300, 'Test');
    expect(bytes[0]).toBe(0x49); // 'I'
    expect(bytes[1]).toBe(0x49);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(2, true)).toBe(42);
    expect(view.getUint32(4, true)).toBe(8);
  });

  it('writes the required IFD tags with RGB, uncompressed sample data', () => {
    const description = 'Protein blot - 100 x 50 mm at 300 dpi - SPICE Figure Studio';
    const bytes = encodeTiffRgb(RGBA, 2, 2, 300, description);
    const parsed = parseTiff(bytes);

    expect([...parsed.entries.keys()]).toEqual([
      256, 257, 258, 259, 262, 270, 273, 277, 278, 279, 282, 283, 296, 305, 306, 339,
    ]);
    expect(scalar(parsed, 256)).toBe(2);
    expect(scalar(parsed, 257)).toBe(2);
    expect(shorts(parsed, 258)).toEqual([8, 8, 8]);
    expect(scalar(parsed, 259)).toBe(1); // no compression
    expect(scalar(parsed, 262)).toBe(2); // RGB
    expect(scalar(parsed, 277)).toBe(3);
    expect(scalar(parsed, 278)).toBe(2);
    expect(scalar(parsed, 279)).toBe(2 * 2 * 3);
    expect(rational(parsed, 282)).toEqual([300, 1]);
    expect(rational(parsed, 283)).toEqual([300, 1]);
    expect(scalar(parsed, 296)).toBe(2); // inches
    expect(shorts(parsed, 339)).toEqual([1, 1, 1]);
    expect(ascii(parsed, 270)).toBe(description);
    expect(ascii(parsed, 305)).toContain('SPICE Figure Studio');
    expect(ascii(parsed, 306)).toMatch(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('stores one strip of RGB samples and drops alpha', () => {
    const bytes = encodeTiffRgb(RGBA, 2, 2, 300, 'Test');
    const parsed = parseTiff(bytes);
    const stripOffset = scalar(parsed, 273);
    const stripBytes = scalar(parsed, 279);
    const pixels = bytes.subarray(stripOffset, stripOffset + stripBytes);

    expect([...pixels]).toEqual([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255,
    ]);
    expect(stripOffset % 2).toBe(0);
  });

  it('decodes with a third-party TIFF reader', () => {
    const bytes = encodeTiffRgb(RGBA, 2, 2, 300, 'Third-party decode');
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const ifds = UTIF.decode(buffer);
    expect(ifds).toHaveLength(1);
    UTIF.decodeImage(buffer, ifds[0]);
    expect(ifds[0].width).toBe(2);
    expect(ifds[0].height).toBe(2);
    expect([...UTIF.toRGBA8(ifds[0])]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
  });

  it('reduces fractional resolutions to an exact rational', () => {
    const parsed = parseTiff(encodeTiffRgb(RGBA, 2, 2, 300.5, 'Test'));
    expect(rational(parsed, 282)).toEqual([601, 2]);
  });

  it('rejects invalid dimensions, resolutions and buffers', () => {
    expect(() => encodeTiffRgb(new Uint8ClampedArray(0), 0, 2, 300, 'x')).toThrow(/dimensions/i);
    expect(() => encodeTiffRgb(new Uint8ClampedArray(0), 2, -1, 300, 'x')).toThrow(/dimensions/i);
    expect(() => encodeTiffRgb(new Uint8ClampedArray(4), 2, 2, 300, 'x')).toThrow(/RGBA buffer/i);
    expect(() => encodeTiffRgb(RGBA, 2, 2, 0, 'x')).toThrow(/resolution/i);
  });
});

describe('renderTiff', () => {
  it('fails clearly when canvas rendering is unavailable', async () => {
    const doc = createFigureDocument('No canvas', 100, 50);
    await expect(renderTiff(doc, undefined, 72)).rejects.toThrow(/canvas/i);
  });
});
