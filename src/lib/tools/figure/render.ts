// Figure Studio rendering. `renderSvg` is a pure, synchronous serialiser that
// Node tests can import; the raster helpers below are the only DOM-dependent
// part and are guarded at call time so importing this module never touches the
// document.
import {
  PT_TO_PX,
  documentHeightPx,
  documentWidthPx,
  type AssetNode,
  type FigureDocument,
  type FigureNode,
  type ImageFit,
  type ImageNode,
  type LineNode,
  type TextNode,
} from './types';
import { renderChartNode } from './charts';
import { renderScaleBarNode } from './scalebar';
import { renderPathNode } from './paths';
import {
  bytesToDataUrl,
  canvasToDataUrl,
  canvasToPngBytes,
  createCanvas,
  loadRasterImage,
} from '$lib/tools/shared/canvas';

/** A resolved asset bundle ready to be embedded as a data URL. */
export interface ResolvedAsset {
  dataUrl: string;
  width: number;
  height: number;
}

/** Keyed by `AssetNode.assetId`. */
export type ResolvedAssets = Map<string, ResolvedAsset>;

// ------------------------------------------------------------------ primitives

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 10000) / 10000);
}

function mm(value: number): string {
  return `${num(value)}mm`;
}

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(' ');
}

function isNone(color: string | undefined): boolean {
  const value = (color ?? '').trim().toLowerCase();
  return !value || value === 'none' || value === 'transparent';
}

function dashArray(node: FigureNode): string | undefined {
  if (node.dash === 'dashed') {
    return `${num(Math.max(3, node.strokeWidth * 3))} ${num(Math.max(2, node.strokeWidth * 2))}`;
  }
  if (node.dash === 'dotted') {
    return `${num(Math.max(0.75, node.strokeWidth))} ${num(Math.max(1.5, node.strokeWidth * 2))}`;
  }
  return undefined;
}

/** True when the node or its owning group is hidden. */
export function isNodeVisible(doc: FigureDocument, node: FigureNode): boolean {
  if (node.hidden) return false;
  if (!node.groupId) return true;
  const group = doc.groups.find((candidate) => candidate.id === node.groupId);
  return !group?.hidden;
}

/** Straight line endpoints derived from the node's bounding box. */
export function lineEndpoints(node: LineNode): { x1: number; y1: number; x2: number; y2: number } {
  const { x, y, w, h, direction } = node;
  if (direction === 'horizontal') {
    return { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2 };
  }
  if (direction === 'vertical') {
    return { x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h };
  }
  return { x1: x, y1: y, x2: x + w, y2: y + h };
}

function arrowHeadPoints(tipX: number, tipY: number, fromX: number, fromY: number, size: number): string {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = 0.45;
  const ax = tipX - size * Math.cos(angle - spread);
  const ay = tipY - size * Math.sin(angle - spread);
  const bx = tipX - size * Math.cos(angle + spread);
  const by = tipY - size * Math.sin(angle + spread);
  return `${num(tipX)},${num(tipY)} ${num(ax)},${num(ay)} ${num(bx)},${num(by)}`;
}

function preserveAspectRatio(fit: ImageFit): string {
  if (fit === 'cover') return 'xMidYMid slice';
  if (fit === 'stretch') return 'none';
  return 'xMidYMid meet';
}

function tintFilter(id: string, color: string): string {
  return [
    `<filter id="${id}" color-interpolation-filters="sRGB">`,
    `<feFlood flood-color="${escapeXml(color)}" result="flood"/>`,
    `<feComposite in="flood" in2="SourceAlpha" operator="in" result="tint"/>`,
    `<feBlend in="SourceGraphic" in2="tint" mode="multiply"/>`,
    '</filter>',
  ].join('');
}

// --------------------------------------------------------------------- shapes

function renderRectNode(node: FigureNode): string {
  const radius = Math.max(0, node.cornerRadius);
  return `<rect ${attrs({
    x: num(node.x),
    y: num(node.y),
    width: num(node.w),
    height: num(node.h),
    rx: radius > 0 ? num(radius) : undefined,
    ry: radius > 0 ? num(radius) : undefined,
    fill: isNone(node.fill) ? 'none' : node.fill,
    stroke: isNone(node.stroke) ? 'none' : node.stroke,
    'stroke-width': num(node.strokeWidth),
    'stroke-dasharray': dashArray(node),
  })}/>`;
}

function renderEllipseNode(node: FigureNode): string {
  return `<ellipse ${attrs({
    cx: num(node.x + node.w / 2),
    cy: num(node.y + node.h / 2),
    rx: num(Math.abs(node.w / 2)),
    ry: num(Math.abs(node.h / 2)),
    fill: isNone(node.fill) ? 'none' : node.fill,
    stroke: isNone(node.stroke) ? 'none' : node.stroke,
    'stroke-width': num(node.strokeWidth),
    'stroke-dasharray': dashArray(node),
  })}/>`;
}

function renderLineNode(node: LineNode): string[] {
  const { x1, y1, x2, y2 } = lineEndpoints(node);
  const out: string[] = [];
  if (!isNone(node.stroke)) {
    out.push(
      `<line ${attrs({
        x1: num(x1),
        y1: num(y1),
        x2: num(x2),
        y2: num(y2),
        stroke: node.stroke,
        'stroke-width': num(node.strokeWidth),
        'stroke-dasharray': dashArray(node),
        'stroke-linecap': node.dash === 'dotted' ? 'round' : 'butt',
        fill: 'none',
      })}/>`,
    );
  }
  const headSize = Math.max(0, node.headSize);
  if (headSize > 0) {
    const color = isNone(node.stroke) ? '#000000' : node.stroke;
    if (node.headStart) {
      out.push(`<polygon points="${arrowHeadPoints(x1, y1, x2, y2, headSize)}" fill="${escapeXml(color)}"/>`);
    }
    if (node.headEnd) {
      out.push(`<polygon points="${arrowHeadPoints(x2, y2, x1, y1, headSize)}" fill="${escapeXml(color)}"/>`);
    }
  }
  return out;
}

function renderTextNode(node: TextNode): string[] {
  const out: string[] = [];
  if (!isNone(node.background)) {
    out.push(
      `<rect ${attrs({
        x: num(node.x),
        y: num(node.y),
        width: num(node.w),
        height: num(node.h),
        fill: node.background,
      })}/>`,
    );
  }
  const fontPx = node.fontSize * PT_TO_PX;
  const lineStep = fontPx * Math.max(0.5, node.lineHeight);
  const padding = Math.max(0, node.padding);
  const anchor = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const x =
    node.align === 'center' ? node.x + node.w / 2 : node.align === 'right' ? node.x + node.w - padding : node.x + padding;
  const lines = node.text.split('\n');
  const tspans = (lines.length ? lines : [''])
    .map(
      (line, index) =>
        `<tspan ${attrs({ x: num(x), y: num(node.y + padding + index * lineStep) })}>${escapeXml(line)}</tspan>`,
    )
    .join('');
  out.push(
    `<text ${attrs({
      'font-family': node.fontFamily,
      'font-size': num(fontPx),
      'font-weight': node.fontWeight,
      'font-style': node.italic ? 'italic' : undefined,
      'text-anchor': anchor,
      fill: isNone(node.color) ? 'none' : node.color,
      'dominant-baseline': 'text-before-edge',
      'xml:space': 'preserve',
    })}>${tspans}</text>`,
  );
  return out;
}

function nodeImageSource(
  node: AssetNode | ImageNode,
  assets: ResolvedAssets | undefined,
): { href: string; fit: ImageFit; tint: string } | null {
  if (node.type === 'image') {
    return node.dataUrl ? { href: node.dataUrl, fit: node.fit, tint: '' } : null;
  }
  const resolved = assets?.get(node.assetId);
  // A bundled SVG path is a preview-only fallback; standalone exports need the
  // resolved data URL produced by the asset pipeline.
  const href = resolved?.dataUrl ?? node.svgFile;
  if (!href) return null;
  return { href, fit: 'contain', tint: node.tint };
}

function renderImageNode(
  node: AssetNode | ImageNode,
  assets: ResolvedAssets | undefined,
  defs: string[],
  index: number,
): string[] {
  const source = nodeImageSource(node, assets);
  if (!source) return [];
  const out: string[] = [];
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const transforms: string[] = [];
  if (node.flipX || node.flipY) {
    const sx = node.flipX ? -1 : 1;
    const sy = node.flipY ? -1 : 1;
    transforms.push(`translate(${num(cx)} ${num(cy)}) scale(${sx} ${sy}) translate(${num(-cx)} ${num(-cy)})`);
  }
  let filter: string | undefined;
  if (source.tint && !isNone(source.tint)) {
    filter = `tint_${index}`;
    defs.push(tintFilter(filter, source.tint));
  }
  const crop = node.type === 'image' ? node.crop : undefined;
  if (crop && crop.w > 0 && crop.h > 0) {
    const clipId = `crop_${index}`;
    defs.push(
      `<clipPath id="${clipId}"><rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}"/></clipPath>`,
    );
    out.push(
      `<g clip-path="url(#${clipId})">`,
      `<image ${attrs({
        href: source.href,
        x: num(node.x - (crop.x / crop.w) * node.w),
        y: num(node.y - (crop.y / crop.h) * node.h),
        width: num(node.w / crop.w),
        height: num(node.h / crop.h),
        preserveAspectRatio: 'none',
        transform: transforms.length ? transforms.join(' ') : undefined,
        filter: filter ? `url(#${filter})` : undefined,
      })}/>`,
      '</g>',
    );
    return out;
  }
  out.push(
    `<image ${attrs({
      href: source.href,
      x: num(node.x),
      y: num(node.y),
      width: num(node.w),
      height: num(node.h),
      preserveAspectRatio: preserveAspectRatio(source.fit),
      transform: transforms.length ? transforms.join(' ') : undefined,
      filter: filter ? `url(#${filter})` : undefined,
    })}/>`,
  );
  return out;
}

// ----------------------------------------------------------------------- SVG

function nodeBody(node: FigureNode, assets: ResolvedAssets | undefined, defs: string[], index: number): string {
  switch (node.type) {
    case 'rect':
      return renderRectNode(node);
    case 'ellipse':
      return renderEllipseNode(node);
    case 'line':
    case 'arrow':
      return renderLineNode(node).join('');
    case 'text':
      return renderTextNode(node).join('');
    case 'image':
    case 'asset':
      return renderImageNode(node, assets, defs, index).join('');
    case 'chart':
      return renderChartNode(node).svg;
    case 'scalebar':
      return renderScaleBarNode(node);
    case 'path':
      return renderPathNode(node);
  }
}

function wrapNode(node: FigureNode, body: string): string {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const parts: string[] = [`data-node-id="${escapeXml(node.id)}"`, `data-node-type="${escapeXml(node.type)}"`];
  if (node.rotation) parts.push(`transform="rotate(${num(node.rotation)} ${num(cx)} ${num(cy)})"`);
  if (node.opacity < 1) parts.push(`opacity="${num(Math.max(0, node.opacity))}"`);
  return `<g ${parts.join(' ')}>${body}</g>`;
}

/**
 * Serialise a Figure Studio document to a complete standalone SVG.
 *
 * Asset resolution uses `assets` (keyed by assetId). When an asset is missing,
 * the node's bundled `svgFile` path is used as a preview fallback; exports
 * should pass resolved asset data URLs so the SVG stays self-contained.
 */
export function renderSvg(doc: FigureDocument, assets?: ResolvedAssets): string {
  const widthPx = documentWidthPx(doc);
  const heightPx = documentHeightPx(doc);
  const defs: string[] = [];
  const body: string[] = [];

  doc.nodes.forEach((node, index) => {
    if (!isNodeVisible(doc, node)) return;
    const inner = nodeBody(node, assets, defs, index);
    if (inner) body.push(wrapNode(node, inner));
  });

  const description = `${doc.name || 'Figure'} — ${doc.widthMm} x ${doc.heightMm} mm, ${doc.nodes.length} node${
    doc.nodes.length === 1 ? '' : 's'
  }.`;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${mm(doc.widthMm)}" height="${mm(
      doc.heightMm,
    )}" viewBox="0 0 ${num(widthPx)} ${num(heightPx)}">`,
    `<title>${escapeXml(doc.name)}</title>`,
    `<desc>${escapeXml(description)}</desc>`,
  ];
  if (defs.length) out.push(`<defs>${defs.join('')}</defs>`);
  out.push(
    `<rect x="0" y="0" width="${num(widthPx)}" height="${num(heightPx)}" fill="${escapeXml(
      doc.background || '#ffffff',
    )}"/>`,
  );
  out.push(...body);
  out.push('</svg>');
  return out.join('\n');
}

// -------------------------------------------------------------------- raster

export function pngDpiAvailable(): boolean {
  return typeof document !== 'undefined';
}

async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Rendering figures to PNG requires a DOM environment with canvas support');
  }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    return await loadRasterImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draw a document through its SVG representation onto a canvas at `dpi`.
 * The returned canvas uses the shared HTMLCanvasElement-compatible subset so
 * it also works with OffscreenCanvas in a worker.
 */
export async function renderSvgToCanvas(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 96,
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new Error('Rendering figures to raster requires a DOM environment with canvas support');
  }
  const scale = Math.max(0.01, dpi / 96);
  const width = Math.max(1, Math.round(documentWidthPx(doc) * scale));
  const height = Math.max(1, Math.round(documentHeightPx(doc) * scale));
  // A poster at 300 dpi would otherwise allocate hundreds of megabytes and
  // can crash the webview. Fail early with an actionable error.
  if (width * height > 40_000_000) {
    throw new Error(
      `Figure is too large to rasterise at ${dpi} dpi (${width} x ${height}px). Lower the DPI or page size.`,
    );
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const image = await loadSvgImage(renderSvg(doc, assets));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Rasterise an arbitrary image data URL (including SVG) to PNG at `scale`. */
export async function rasterizeToPngDataUrl(
  dataUrl: string,
  widthPx: number,
  heightPx: number,
  scale = 2,
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Rasterising images requires a DOM environment with canvas support');
  }
  const canvas = createCanvas(Math.max(1, widthPx * scale), Math.max(1, heightPx * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const image = await loadRasterImage(dataUrl);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToDataUrl(canvas, 'image/png');
}

// ------------------------------------------------------------- PNG metadata

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

/**
 * Insert pHYs (physical resolution) and iTXt description chunks into an
 * encoded PNG. The IHDR always lives at bytes 8..32, so the new chunks are
 * spliced directly after it.
 */
export function addPngDpiMetadata(png: Uint8Array, dpi: number, description = ''): Uint8Array {
  if (png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50) return png;
  const encoder = new TextEncoder();
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  const ppm = Math.round(1000 / (25.4 / Math.max(1, dpi)));
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  phys[8] = 1;
  const chunks: Uint8Array[] = [pngChunk('pHYs', phys)];
  if (description) {
    const keyword = encoder.encode('Description');
    const text = encoder.encode(description);
    const itxt = new Uint8Array(keyword.length + 5 + text.length);
    itxt.set(keyword, 0);
    let offset = keyword.length;
    itxt[offset++] = 0;
    itxt[offset++] = 0;
    itxt[offset++] = 0;
    itxt[offset++] = 0;
    itxt[offset++] = 0;
    itxt.set(text, offset);
    chunks.push(pngChunk('iTXt', itxt));
  }

  const ihdrEnd = 33;
  const extra = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(png.length + extra);
  out.set(png.subarray(0, ihdrEnd), 0);
  let cursor = ihdrEnd;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(png.subarray(ihdrEnd), cursor);
  return out;
}

/** Render the document to PNG bytes at a target resolution. */
export async function renderPng(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 300,
): Promise<Uint8Array> {
  const canvas = await renderSvgToCanvas(doc, assets, dpi);
  const png = await canvasToPngBytes(canvas);
  return addPngDpiMetadata(
    png,
    dpi,
    `${doc.name || 'Figure'} — ${doc.widthMm} x ${doc.heightMm} mm at ${dpi} dpi`,
  );
}

export async function renderPngDataUrl(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 192,
): Promise<string> {
  return bytesToDataUrl(await renderPng(doc, assets, dpi), 'image/png');
}

/** Small project-preview image sized to `maxWidth` CSS pixels. */
export async function renderThumbnail(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  maxWidth = 480,
): Promise<string> {
  const widthPx = documentWidthPx(doc);
  const dpi = widthPx > 0 ? (Math.max(16, maxWidth) / widthPx) * 96 : 96;
  return renderPngDataUrl(doc, assets, dpi);
}
