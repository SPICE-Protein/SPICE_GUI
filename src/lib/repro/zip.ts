// Minimal ZIP writer (stored entries, no compression). Figures and JSON are
// already compact; using store avoids a runtime dependency and keeps the
// reproducible bundle byte-for-byte inspectable with any unzip tool.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosDateTime();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, '/').replace(/^\/+/, ''));
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const hv = new DataView(header.buffer);
    u32(hv, 0, 0x04034b50);
    u16(hv, 4, 20);
    u16(hv, 6, 0x0800);
    u16(hv, 8, 0);
    u16(hv, 10, stamp.time);
    u16(hv, 12, stamp.date);
    u32(hv, 14, crc);
    u32(hv, 18, entry.data.length);
    u32(hv, 22, entry.data.length);
    u16(hv, 26, name.length);
    u16(hv, 28, 0);
    header.set(name, 30);
    local.push(header, entry.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, 0);
    u16(cv, 12, stamp.time);
    u16(cv, 14, stamp.date);
    u32(cv, 16, crc);
    u32(cv, 20, entry.data.length);
    u32(cv, 24, entry.data.length);
    u16(cv, 28, name.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, offset);
    cd.set(name, 46);
    central.push(cd);

    offset += header.length + entry.data.length;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralBytes.length);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  return concat([...local, centralBytes, end]);
}
