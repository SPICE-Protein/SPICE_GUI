// Export helpers: annotated PNG with physical DPI metadata, binary mask PNG,
// CSV and the portable project JSON.
import { maskExportCanvas } from './imaging';
import type { MarkerNumbering } from './markers';
import { median } from './markers';
import type { ColonyMarker, ColonyProject } from './types';
import { isColonyProject, normalizeProject } from './types';

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG encoding failed'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}

/** Insert a pHYs chunk (physical pixel size) into a canvas PNG. */
export async function canvasToPngWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Uint8Array> {
  const png = await canvasToPng(canvas);
  if (png.length < 33) return png;
  const ppm = Math.round(Math.max(1, dpi) / 0.0254);
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  phys[8] = 1; // meters
  const physChunk = pngChunk('pHYs', phys);
  // Walk chunks until the first IDAT so pHYs sits with the image header.
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  const out = new Uint8Array(png.length + physChunk.length);
  out.set(png.subarray(0, offset), 0);
  out.set(physChunk, offset);
  out.set(png.subarray(offset), offset + physChunk.length);
  return out;
}

// --------------------------------------------------------- annotated image

function textFont(size: number): string {
  return `700 ${Math.max(8, Math.round(size))}px "SFMono-Regular", "JetBrains Mono", Menlo, monospace`;
}

/** Paint the processed image plus numbered rings. Excluded markers get a red
 *  cross and are not numbered. */
export function renderAnnotated(
  source: HTMLCanvasElement,
  markers: ColonyMarker[],
  numbering: MarkerNumbering,
  showNumbers: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const radii = markers.filter((m) => m.included).map((m) => m.radius);
  const baseRadius = radii.length ? median(radii) : Math.min(canvas.width, canvas.height) * 0.01;
  const line = Math.max(1.2, baseRadius * 0.12);
  const font = Math.max(9, Math.min(64, baseRadius * 1.1));
  ctx.lineWidth = line;
  ctx.font = textFont(font);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const marker of markers) {
    const color = marker.included ? '#53d769' : '#ff5d5d';
    const radius = Math.max(4, marker.radius * 1.18);
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.stroke();
    if (marker.included) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, Math.max(1.5, radius * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      const arm = radius * 0.7;
      ctx.beginPath();
      ctx.moveTo(marker.x - arm, marker.y - arm);
      ctx.lineTo(marker.x + arm, marker.y + arm);
      ctx.moveTo(marker.x + arm, marker.y - arm);
      ctx.lineTo(marker.x - arm, marker.y + arm);
      ctx.stroke();
    }
    if (showNumbers) {
      const label = marker.included ? String(numbering.labels.get(marker.id) ?? '') : '×';
      if (!label) continue;
      const bx = marker.x + radius * 0.75;
      const by = marker.y - radius * 0.75;
      const pad = font * 0.22;
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + pad * 2;
      const boxH = font + pad * 2;
      ctx.fillStyle = 'rgba(6, 9, 15, 0.82)';
      ctx.fillRect(bx - boxW / 2, by - boxH / 2, boxW, boxH);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, line * 0.6);
      ctx.strokeRect(bx - boxW / 2, by - boxH / 2, boxW, boxH);
      ctx.fillStyle = color;
      ctx.fillText(label, bx, by + font * 0.04);
      ctx.lineWidth = line;
    }
  }
  return canvas;
}

export async function annotatedPngBytes(
  source: HTMLCanvasElement,
  markers: ColonyMarker[],
  numbering: MarkerNumbering,
  dpi: number,
  showNumbers: boolean,
): Promise<Uint8Array> {
  const canvas = renderAnnotated(source, markers, numbering, showNumbers);
  return canvasToPngWithDpi(canvas, dpi);
}

export async function maskPngBytes(mask: Uint8Array, width: number, height: number, dpi: number): Promise<Uint8Array> {
  const canvas = maskExportCanvas(mask, width, height);
  return canvasToPngWithDpi(canvas, dpi);
}

// --------------------------------------------------------------- project JSON

export function projectJson(project: ColonyProject): string {
  return JSON.stringify({ ...project, savedAt: new Date().toISOString() }, null, 2);
}

export function parseProjectJson(text: string): ColonyProject {
  const parsed = JSON.parse(text) as unknown;
  if (!isColonyProject(parsed)) throw new Error('Invalid colony project');
  return normalizeProject(parsed);
}

export function projectBaseName(name: string): string {
  const base = (name || 'colony-plate').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
  return base || 'colony-plate';
}
