// Raster export and project-file (JSON) round-tripping.
import type {
  MetaEntry,
  PaletteId,
  SerializedNode,
  TreeNode,
  TreeMetadata,
  TreeProject,
  TreeSettings
} from './types';
import { defaultSettings, PALETTES, PALETTE_IDS } from './types';

export class TreeProjectError extends Error {
  constructor(message = 'invalid project') {
    super(message);
    this.name = 'TreeProjectError';
  }
}

export interface PngResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  dpi: number;
  reduced: boolean;
}

const MAX_PIXELS_PER_SIDE = 14000;
const MAX_TOTAL_PIXELS = 48_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSettings(raw: unknown): TreeSettings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;
  const mode = raw.mode;
  if (mode === 'phylogram' || mode === 'cladogram' || mode === 'circular') base.mode = mode;
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) base.fontSize = clamp(raw.fontSize, 6, 36);
  if (typeof raw.branchWidth === 'number' && Number.isFinite(raw.branchWidth)) base.branchWidth = clamp(raw.branchWidth, 0.5, 8);
  if (typeof raw.labelAngle === 'number' && Number.isFinite(raw.labelAngle)) base.labelAngle = clamp(raw.labelAngle, 0, 90);
  if (typeof raw.supportThreshold === 'number' && Number.isFinite(raw.supportThreshold)) base.supportThreshold = clamp(raw.supportThreshold, 0, 100);
  if (typeof raw.showBranchLengths === 'boolean') base.showBranchLengths = raw.showBranchLengths;
  if (typeof raw.showSupport === 'boolean') base.showSupport = raw.showSupport;
  if (typeof raw.showNodeDots === 'boolean') base.showNodeDots = raw.showNodeDots;
  if (typeof raw.showScaleBar === 'boolean') base.showScaleBar = raw.showScaleBar;
  if (raw.theme === 'dark' || raw.theme === 'light') base.theme = raw.theme;
  return base;
}

export function normalizeMetadata(raw: unknown): TreeMetadata {
  if (!isRecord(raw)) return { entries: [], paletteId: 'default' };
  const entries: MetaEntry[] = [];
  if (Array.isArray(raw.entries)) {
    for (const item of raw.entries) {
      if (!isRecord(item)) continue;
      if (typeof item.leaf !== 'string' || !item.leaf.trim()) continue;
      const group = typeof item.group === 'string' ? item.group : '';
      const color = typeof item.color === 'string' ? item.color : null;
      entries.push({ leaf: item.leaf, group, color });
    }
  }
  const paletteId: PaletteId = typeof raw.paletteId === 'string' && PALETTE_IDS.includes(raw.paletteId as PaletteId)
    ? raw.paletteId as PaletteId
    : 'default';
  if (!PALETTES[paletteId]) return { entries, paletteId: 'default' };
  return { entries, paletteId };
}

export function nodeToSerialized(node: TreeNode): SerializedNode {
  return {
    id: node.id,
    name: node.name,
    length: node.length,
    support: node.support,
    comment: node.comment,
    children: node.children.map(nodeToSerialized)
  };
}

function normalizeSerialized(raw: unknown, usedIds: Set<string>, counter: { value: number }): SerializedNode {
  if (!isRecord(raw)) throw new TreeProjectError('node is not an object');
  let id = typeof raw.id === 'string' && raw.id ? raw.id : '';
  while (!id || usedIds.has(id)) {
    id = `p${counter.value++}`;
  }
  usedIds.add(id);

  const name = typeof raw.name === 'string' ? raw.name : '';
  const length = typeof raw.length === 'number' && Number.isFinite(raw.length) ? raw.length : null;
  const support = typeof raw.support === 'number' && Number.isFinite(raw.support) ? raw.support : null;
  const comment = typeof raw.comment === 'string' ? raw.comment : null;
  const children = Array.isArray(raw.children)
    ? raw.children.map((child) => normalizeSerialized(child, usedIds, counter))
    : [];

  return { id, name, length, support, comment, children };
}

export function deserializeTree(raw: unknown): TreeNode {
  const normalized = normalizeSerialized(raw, new Set<string>(), { value: 1 });
  return toTree(normalized);
}

function toTree(node: SerializedNode): TreeNode {
  return {
    id: node.id,
    name: node.name,
    length: node.length,
    support: node.support,
    comment: node.comment,
    children: node.children.map(toTree)
  };
}

export function parseProjectJson(text: string): TreeProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TreeProjectError('not JSON');
  }
  if (!isRecord(raw)) throw new TreeProjectError('project is not an object');
  if (raw.format !== 'spice-tree') throw new TreeProjectError('unknown format');
  if (raw.version !== 1) throw new TreeProjectError('unknown version');
  if (typeof raw.originalNewick !== 'string') throw new TreeProjectError('missing Newick');
  if (!isRecord(raw.tree)) throw new TreeProjectError('missing tree');

  const tree = normalizeSerialized(raw.tree, new Set<string>(), { value: 1 });
  const collapsedIds = Array.isArray(raw.collapsedIds)
    ? raw.collapsedIds.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    format: 'spice-tree',
    version: 1,
    originalNewick: raw.originalNewick,
    tree,
    rooted: typeof raw.rooted === 'boolean' ? raw.rooted : true,
    sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : null,
    collapsedIds,
    settings: normalizeSettings(raw.settings),
    metadata: normalizeMetadata(raw.metadata),
    title: typeof raw.title === 'string' ? raw.title : '',
    caption: typeof raw.caption === 'string' ? raw.caption : '',
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString()
  };
}

export function serializeProject(project: TreeProject): string {
  return JSON.stringify(project, null, 2);
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

/** Insert a pHYs chunk before IDAT so the PNG carries its print resolution. */
function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33) return png;
  const ppm = Math.round(Math.max(1, dpi) / 0.0254);
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  phys[8] = 1;
  const chunk = pngChunk('pHYs', phys);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    if (type === 'IDAT') {
      const out = new Uint8Array(png.length + chunk.length);
      out.set(png.subarray(0, offset), 0);
      out.set(chunk, offset);
      out.set(png.subarray(offset), offset + chunk.length);
      return out;
    }
    offset += 12 + length;
  }
  return png;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG encoding failed'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(reject);
    }, 'image/png');
  });
}

/**
 * Rasterize a standalone SVG string. The source SVG is authored at 96 dpi, so
 * a 300 dpi export is drawn at 300/96 scale.
 */
export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  requestedDpi: number,
  background: string
): Promise<PngResult> {
  const requestedScale = requestedDpi / 96;
  let scale = requestedScale;
  if (width * scale > MAX_PIXELS_PER_SIDE) scale = MAX_PIXELS_PER_SIDE / width;
  if (height * scale > MAX_PIXELS_PER_SIDE) scale = MAX_PIXELS_PER_SIDE / height;
  const totalPixels = width * scale * height * scale;
  if (totalPixels > MAX_TOTAL_PIXELS) {
    scale *= Math.sqrt(MAX_TOTAL_PIXELS / totalPixels);
  }

  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG could not be rasterized'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, outputWidth, outputHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, outputWidth, outputHeight);

    return {
      bytes: withDpi(await canvasToPngBytes(canvas), Math.round(scale * 96)),
      width: outputWidth,
      height: outputHeight,
      dpi: Math.round(scale * 96),
      reduced: scale < requestedScale - 0.0001
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
