// Export helpers: PNG with physical resolution and a processing summary, an
// uncompressed RGB TIFF, editable SVG, an editable PowerPoint slide, the
// uncropped annotated image, the original file and a processing log.
import type { FigureLayout } from './figure';
import { figureToSvg, renderUncropped } from './render';
import type { GelProject } from './types';
import { ladderById, type LadderDef } from './ladders';
import { polyAt } from './gelmath';

// ---------------------------------------------------------------- utilities

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function canvasToDataUrl(canvas: HTMLCanvasElement, type = 'image/png'): string {
  return canvas.toDataURL(type);
}

async function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// ------------------------------------------------------------------- PNG

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

const encoder = new TextEncoder();

/** Add pHYs, sRGB and an iTXt description to a canvas PNG. */
export async function exportPngWithMetadata(
  canvas: HTMLCanvasElement,
  dpi: number,
  summary: string,
): Promise<Uint8Array> {
  const png = await canvasToBytes(canvas);
  const chunks: Uint8Array[] = [];
  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  const ppm = Math.round(dpi / 0.0254);
  pv.setUint32(0, ppm);
  pv.setUint32(4, ppm);
  phys[8] = 1;
  chunks.push(pngChunk('pHYs', phys));
  chunks.push(pngChunk('sRGB', new Uint8Array([0])));
  const keyword = encoder.encode('Description');
  const text = encoder.encode(summary);
  const itxt = new Uint8Array(keyword.length + 5 + text.length);
  itxt.set(keyword, 0);
  // compression flag 0, method 0, empty language tag, empty translated keyword
  let p = keyword.length;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt.set(text, p);
  chunks.push(pngChunk('iTXt', itxt));

  // Insert after IHDR (signature 8 + length/type/data/crc 25).
  const ihdrEnd = 8 + 25;
  const extra = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + extra);
  out.set(png.subarray(0, ihdrEnd), 0);
  let off = ihdrEnd;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  out.set(png.subarray(ihdrEnd), off);
  return out;
}

// ------------------------------------------------------------------- TIFF

function asciiBytes(s: string): Uint8Array {
  const b = encoder.encode(s);
  return b.length % 2 ? new Uint8Array([...b, 0]) : b;
}

/** Minimal baseline TIFF: 8-bit RGB (or grayscale), one uncompressed strip. */
export function encodeTiff(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dpi: number,
  description: string,
  grayscale: boolean,
): Uint8Array {
  const samples = grayscale ? 1 : 3;
  const pixels = new Uint8Array(width * height * samples);
  if (grayscale) {
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      pixels[p] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    }
  } else {
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 3) {
      pixels[p] = rgba[i];
      pixels[p + 1] = rgba[i + 1];
      pixels[p + 2] = rgba[i + 2];
    }
  }
  const bits = grayscale ? [8] : [8, 8, 8];
  const desc = asciiBytes(description);
  const software = asciiBytes('SPICE gel figure tool');
  const date = asciiBytes(new Date().toISOString().slice(0, 19).replace('T', ' '));

  interface Entry {
    tag: number;
    type: number;
    count: number;
    value: number | number[] | Uint8Array | [number, number][];
  }
  const entries: Entry[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: bits.length, value: bits },
    { tag: 259, type: 3, count: 1, value: 1 },
    { tag: 262, type: 3, count: 1, value: grayscale ? 1 : 2 },
    { tag: 270, type: 2, count: desc.length, value: desc },
    { tag: 273, type: 4, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: samples },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: pixels.length },
    { tag: 282, type: 5, count: 1, value: [[dpi, 1]] },
    { tag: 283, type: 5, count: 1, value: [[dpi, 1]] },
    { tag: 296, type: 3, count: 1, value: 2 },
    { tag: 305, type: 2, count: software.length, value: software },
    { tag: 306, type: 2, count: date.length, value: date },
    { tag: 339, type: 3, count: bits.length, value: bits.map(() => 1) },
  ];
  entries.sort((a, b) => a.tag - b.tag);

  const encodeValue = (e: Entry): Uint8Array => {
    if (e.type === 2) return e.value as Uint8Array;
    if (e.type === 1) return e.value as Uint8Array;
    if (e.type === 5) {
      const rats = e.value as [number, number][];
      const bytes = new Uint8Array(rats.length * 8);
      const dv = new DataView(bytes.buffer);
      rats.forEach(([n, d], i) => {
        dv.setUint32(i * 8, n, true);
        dv.setUint32(i * 8 + 4, d, true);
      });
      return bytes;
    }
    const arr = typeof e.value === 'number' ? [e.value] : (e.value as number[]);
    const bytes = new Uint8Array(arr.length * (e.type === 4 ? 4 : 2));
    const dv = new DataView(bytes.buffer);
    arr.forEach((v, i) => (e.type === 4 ? dv.setUint32(i * 4, v, true) : dv.setUint16(i * 2, v, true)));
    return bytes;
  };

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdOffset + ifdSize;
  const extras: { offset: number; bytes: Uint8Array }[] = [];
  const alloc = (bytes: Uint8Array): number => {
    const offset = extraOffset;
    extras.push({ offset, bytes });
    extraOffset += bytes.length + (bytes.length % 2);
    return offset;
  };
  const resolved = entries.map((e) => {
    const bytes = encodeValue(e);
    const inline = bytes.length <= 4;
    return { e, bytes, inline, offset: inline ? 0 : alloc(bytes) };
  });
  const stripOffset = extraOffset;
  const total = stripOffset + pixels.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, entries.length, true);
  let ip = ifdOffset + 2;
  for (const { e, bytes, inline, offset } of resolved) {
    dv.setUint16(ip, e.tag, true);
    dv.setUint16(ip + 2, e.type, true);
    dv.setUint32(ip + 4, e.count, true);
    if (e.tag === 273) {
      dv.setUint32(ip + 8, stripOffset, true);
    } else if (inline) {
      out.set(bytes, ip + 8);
    } else {
      dv.setUint32(ip + 8, offset, true);
    }
    ip += 12;
  }
  dv.setUint32(ip, 0, true);
  for (const ex of extras) out.set(ex.bytes, ex.offset);
  out.set(pixels, stripOffset);
  return out;
}

// -------------------------------------------------------------------- SVG

export function makeSvg(layout: FigureLayout, processed: HTMLCanvasElement): string {
  return figureToSvg(layout, processed.toDataURL('image/png'), processed.width, processed.height);
}

// ------------------------------------------------------------------- PPTX

/** Editable slide: the gel is a cropped picture and every label is real text. */
export async function makePptx(
  layout: FigureLayout,
  processed: HTMLCanvasElement,
  fileName: string,
): Promise<Uint8Array> {
  const mod = (await import('pptxgenjs')) as unknown as { default: new () => any };
  const pptx = new mod.default();
  const inW = layout.width / 96;
  const inH = layout.height / 96;
  pptx.defineLayout({ name: 'GEL_FIGURE', width: inW, height: inH });
  pptx.layout = 'GEL_FIGURE';
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const gelData = processed.toDataURL('image/png');
  const imgW = processed.width / 96;
  const imgH = processed.height / 96;
  const crop = layout.crop;
  for (const item of layout.items) {
    const x = item.kind === 'image' || item.kind === 'text' || item.kind === 'rect' ? item.x / 96 : 0;
    const y = item.kind === 'image' || item.kind === 'text' || item.kind === 'rect' ? item.y / 96 : 0;
    if (item.kind === 'image') {
      const box =
        item.source === 'gel'
          ? {
              x: crop.left * imgW,
              y: crop.top * imgH,
              w: (1 - crop.left - crop.right) * imgW,
              h: (1 - crop.top - crop.bottom) * imgH,
            }
          : { x: item.box.x * imgW, y: item.box.y * imgH, w: item.box.w * imgW, h: item.box.h * imgH };
      slide.addImage({
        data: gelData,
        x,
        y,
        w: item.w / 96,
        h: item.h / 96,
        sizing: { type: 'crop', x: box.x, y: box.y, w: box.w, h: box.h },
      });
    } else if (item.kind === 'text') {
      const s = item.style;
      slide.addText(item.text, {
        x: x - 0.02,
        y: y - (s.baseline === 'middle' ? s.size / 96 / 2 : s.size / 96),
        w: Math.max(0.1, item.bbox.w / 96 + 0.05),
        h: s.size / 96 * 1.6,
        fontFace: s.family,
        fontSize: s.size * 0.75,
        color: s.color.replace('#', ''),
        bold: s.bold,
        italic: s.italic,
        align: s.align === 'center' ? 'center' : s.align === 'right' ? 'right' : 'left',
        valign: 'middle',
        rotate: s.angle ?? 0,
        margin: 0,
      });
    } else if (item.kind === 'line') {
      slide.addShape(pptx.ShapeType.line, {
        x: item.x1 / 96,
        y: item.y1 / 96,
        w: (item.x2 - item.x1) / 96,
        h: (item.y2 - item.y1) / 96,
        line: { color: item.color.replace('#', ''), width: Math.max(0.5, item.width * 0.75) },
      });
    } else if (item.kind === 'rect') {
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: item.w / 96,
        h: item.h / 96,
        fill: { color: 'FFFFFF', transparency: 100 },
        line: { color: item.color.replace('#', ''), width: Math.max(0.5, item.width * 0.75) },
      });
    } else if (item.kind === 'arrow') {
      slide.addShape(pptx.ShapeType.line, {
        x: item.x1 / 96,
        y: item.y1 / 96,
        w: (item.x2 - item.x1) / 96,
        h: (item.y2 - item.y1) / 96,
        line: { color: item.color.replace('#', ''), width: Math.max(0.5, item.width * 0.75), endArrowType: 'triangle' },
      });
    }
  }
  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  void fileName;
  return new Uint8Array(out);
}

// --------------------------------------------------------------- pre-flight

export interface PreflightItem {
  id: 'saturation' | 'clip' | 'resolution' | 'tinyFont' | 'approx' | 'protein' | 'ladder';
  severity: 'warn' | 'info';
  value: number;
}

export function preflight(
  project: GelProject,
  layout: FigureLayout,
  processed: HTMLCanvasElement,
  rawGray: Float32Array,
  adjustedGray: Float32Array,
): PreflightItem[] {
  const out: PreflightItem[] = [];
  const rawClip = clippedFraction(rawGray);
  if (rawClip.bright > 0.003 || rawClip.dark > 0.003) {
    out.push({ id: 'saturation', severity: 'warn', value: Math.round((rawClip.bright + rawClip.dark) * 1000) / 10 });
  }
  const adjClip = clippedFraction(adjustedGray);
  if (adjClip.bright > 0.02 || adjClip.dark > 0.02) {
    out.push({ id: 'clip', severity: 'warn', value: Math.round((adjClip.bright + adjClip.dark) * 1000) / 10 });
  }
  const visW = 1 - project.crop.left - project.crop.right;
  const effectiveDpi = (processed.width * visW) / (layout.gel.w / 96);
  if (effectiveDpi < 300) out.push({ id: 'resolution', severity: 'warn', value: Math.round(effectiveDpi) });
  const minFont = Math.min(project.layout.nameFontSize, project.layout.labelFontSize) * 0.75;
  if (minFont < 6) out.push({ id: 'tinyFont', severity: 'warn', value: Math.round(minFont * 10) / 10 });
  const approx = project.lanes.reduce((n, l) => n + l.bands.filter((b) => b.approx).length, 0);
  if (approx) out.push({ id: 'approx', severity: 'info', value: approx });
  if (project.gelType === 'protein') out.push({ id: 'protein', severity: 'info', value: 0 });
  if (!project.fit) out.push({ id: 'ladder', severity: 'warn', value: 0 });
  return out;
}

function clippedFraction(gray: Float32Array): { dark: number; bright: number } {
  let dark = 0;
  let bright = 0;
  for (const v of gray) {
    if (v <= 0.004) dark++;
    else if (v >= 0.996) bright++;
  }
  return { dark: dark / Math.max(1, gray.length), bright: bright / Math.max(1, gray.length) };
}

// --------------------------------------------------------- processing log

export interface ProcessingLog {
  format: 'SPICE_GEL_LOG';
  version: 1;
  exportedAt: string;
  source: { name: string; mime: string; width: number; height: number; sha256?: string };
  image: {
    rotation: number;
    orient: number;
    mirrorH: boolean;
    mirrorV: boolean;
    display: string;
    crop: GelProject['crop'];
    levels: GelProject['adjust'];
  };
  gel: { type: string; unit: string; effectiveDpi: number };
  ladder: { id: string; name: string; degree: number; r2: number; n: number } | null;
  lanes: { index: number; name: string; marker: boolean; removed: boolean; bands: number }[];
  arrows: { lane: string; band: number; size: number | null; approx: boolean }[];
  legendNote: string;
}

export function makeLog(
  project: GelProject,
  processed: HTMLCanvasElement,
  layout: FigureLayout,
  ladders: LadderDef[],
  sourceSha?: string,
): ProcessingLog {
  const exposure = project.exposures.find((e) => e.id === project.activeExposureId);
  const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, ladders);
  const visW = 1 - project.crop.left - project.crop.right;
  return {
    format: 'SPICE_GEL_LOG',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      name: exposure?.name ?? project.imageName,
      mime: exposure?.mime ?? '',
      width: exposure?.width ?? processed.width,
      height: exposure?.height ?? processed.height,
      sha256: sourceSha ?? exposure?.sha256,
    },
    image: {
      rotation: project.rotation,
      orient: project.orient,
      mirrorH: project.mirrorH,
      mirrorV: project.mirrorV,
      display: project.display,
      crop: project.crop,
      levels: project.adjust,
    },
    gel: {
      type: project.gelType,
      unit: project.unit,
      effectiveDpi: (processed.width * visW) / (layout.gel.w / 96),
    },
    ladder: ladder
      ? {
          id: ladder.id,
          name: ladder.name,
          degree: project.fit?.degree ?? 1,
          r2: project.fit?.r2 ?? 0,
          n: project.fit?.n ?? 0,
        }
      : null,
    lanes: project.lanes.map((l, i) => ({
      index: i + 1,
      name: l.name,
      marker: l.isMarker,
      removed: !!l.removed,
      bands: l.bands.length,
    })),
    arrows: project.annotations
      .filter((a) => a.type === 'arrow')
      .map((a) => {
        const lane = project.lanes.find((l) => l.id === a.laneId);
        const band = lane?.bands[a.bandIndex];
        return { lane: lane?.name ?? '', band: a.bandIndex, size: band?.size ?? null, approx: !!band?.approx };
      }),
    legendNote:
      project.gelType === 'protein'
        ? 'Prestained marker sizes are apparent molecular weights (Tris-glycine).'
        : '',
  };
}

/** Processing summary embedded in PNG/TIFF metadata. */
export function summaryText(project: GelProject, processed: HTMLCanvasElement, ladder?: LadderDef | null): string {
  const parts = [
    `SPICE gel figure; ${project.gelType} gel; unit ${project.unit}`,
    `rotation ${project.rotation.toFixed(1)} deg`,
    `crop L${project.crop.left.toFixed(3)} T${project.crop.top.toFixed(3)} R${project.crop.right.toFixed(3)} B${project.crop.bottom.toFixed(3)}`,
    `display ${project.display}`,
    `levels c=${project.adjust.contrast} b=${project.adjust.brightness} g=${project.adjust.gamma} invert=${project.adjust.invert}`,
    `source ${processed.width}x${processed.height}px`,
  ];
  if (ladder) parts.push(`ladder ${ladder.name} (${ladder.sizes.length} bands)`);
  if (project.fit) parts.push(`fit R2=${project.fit.r2.toFixed(3)} n=${project.fit.n}`);
  return parts.join('; ');
}

export function uncroppedCanvas(project: GelProject, processed: HTMLCanvasElement): HTMLCanvasElement {
  return renderUncropped(project, processed, 1);
}

export function fitSizeAt(project: GelProject, y: number): number | null {
  if (!project.fit) return null;
  return 10 ** polyAt(project.fit, y);
}
