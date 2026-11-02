import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '$lib/repro/zip';

const encoder = new TextEncoder();

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('crc32', () => {
  it('matches the standard check vectors', () => {
    expect(crc32(encoder.encode(''))).toBe(0x00000000);
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(encoder.encode('hello'))).toBe(0x3610a686);
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is sensitive to byte order and content', () => {
    expect(crc32(new Uint8Array([1, 2]))).not.toBe(crc32(new Uint8Array([2, 1])));
    expect(crc32(new Uint8Array([0]))).toBe(0xd202ef8d);
  });
});

describe('zipStore', () => {
  const files = [
    { name: 'folder/a.txt', data: encoder.encode('hello') },
    { name: '/b.bin', data: new Uint8Array([0, 1, 2, 254, 255]) },
  ];
  const zip = zipStore(files);
  const dv = view(zip);

  it('starts with local file headers and ends with an EOCD record', () => {
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 4, true)).toBe(0);
    expect(dv.getUint16(eocd + 6, true)).toBe(0);
  });

  it('reports the correct central-directory entry count', () => {
    const eocd = zip.length - 22;
    expect(dv.getUint16(eocd + 8, true)).toBe(files.length);
    expect(dv.getUint16(eocd + 10, true)).toBe(files.length);
    const centralOffset = dv.getUint32(eocd + 16, true);
    expect(dv.getUint32(centralOffset, true)).toBe(0x02014b50);
  });

  it('stores entry metadata and payloads consistently', () => {
    const eocd = zip.length - 22;
    let central = dv.getUint32(eocd + 16, true);
    const expectedNames = ['folder/a.txt', 'b.bin'];

    for (let i = 0; i < files.length; i++) {
      expect(dv.getUint32(central, true)).toBe(0x02014b50);
      expect(dv.getUint16(central + 8, true)).toBe(0x0800); // UTF-8 names
      expect(dv.getUint16(central + 10, true)).toBe(0); // stored, no compression
      const crc = dv.getUint32(central + 16, true);
      const compressedSize = dv.getUint32(central + 20, true);
      const uncompressedSize = dv.getUint32(central + 24, true);
      const nameLength = dv.getUint16(central + 28, true);
      const localOffset = dv.getUint32(central + 42, true);
      const name = new TextDecoder().decode(zip.subarray(central + 46, central + 46 + nameLength));

      expect(name).toBe(expectedNames[i]);
      expect(crc).toBe(crc32(files[i].data));
      expect(compressedSize).toBe(files[i].data.length);
      expect(uncompressedSize).toBe(files[i].data.length);

      expect(dv.getUint32(localOffset, true)).toBe(0x04034b50);
      expect(dv.getUint16(localOffset + 8, true)).toBe(0);
      expect(dv.getUint32(localOffset + 14, true)).toBe(crc);
      const localNameLength = dv.getUint16(localOffset + 26, true);
      const localName = new TextDecoder().decode(
        zip.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      );
      expect(localName).toBe(expectedNames[i]);
      const payload = zip.subarray(
        localOffset + 30 + localNameLength,
        localOffset + 30 + localNameLength + files[i].data.length,
      );
      expect(Array.from(payload)).toEqual(Array.from(files[i].data));

      central += 46 + nameLength + dv.getUint16(central + 30, true) + dv.getUint16(central + 32, true);
    }

    expect(central).toBe(dv.getUint32(eocd + 16, true) + dv.getUint32(eocd + 12, true));
  });

  it('writes a valid empty archive', () => {
    const empty = zipStore([]);
    expect(empty).toHaveLength(22);
    const ev = view(empty);
    expect(ev.getUint32(0, true)).toBe(0x06054b50);
    expect(ev.getUint16(8, true)).toBe(0);
    expect(ev.getUint16(10, true)).toBe(0);
    expect(ev.getUint32(12, true)).toBe(0);
    expect(ev.getUint32(16, true)).toBe(0);
  });

  it('normalizes backslashes and strips leading slashes in entry names', () => {
    const nested = zipStore([{ name: '\\windows\\path.txt', data: encoder.encode('x') }]);
    const cv = view(nested);
    const eocd = nested.length - 22;
    const central = cv.getUint32(eocd + 16, true);
    const nameLength = cv.getUint16(central + 28, true);
    const name = new TextDecoder().decode(nested.subarray(central + 46, central + 46 + nameLength));
    expect(name).toBe('windows/path.txt');
  });

  it('sets plausible DOS date/time fields', () => {
    const firstLocal = 0;
    const time = dv.getUint16(firstLocal + 10, true);
    const date = dv.getUint16(firstLocal + 12, true);
    expect(time).toBeGreaterThanOrEqual(0);
    expect(time).toBeLessThan(24 * 60 * 60);
    const year = 1980 + ((date >> 9) & 0x7f);
    const month = (date >> 5) & 0x0f;
    const day = date & 0x1f;
    expect(year).toBeGreaterThanOrEqual(1980);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});
