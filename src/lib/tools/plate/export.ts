// Plate map figure export: vector SVG, raster PNG with physical DPI metadata
// and a clipboard helper. No external libraries are used.

import { rowLabel } from './types';

export interface PlateSvgCell {
  fill: string;
  label: string;
  textColor: string;
  well: string;
}

export interface PlateSvgLegendItem {
  label: string;
  color: string;
  count: number;
}

export interface PlateSvgOptions {
  title: string;
  rows: number;
  cols: number;
  cells: Array<PlateSvgCell | null>;
  legend: PlateSvgLegendItem[];
  legendTitle: string;
  note?: string;
}

export interface PlateSvgResult {
  svg: string;
  width: number;
  height: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 1)}…`;
}

function estimateWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0x2e80 ? 10 : 5.9;
  }
  return width;
}

function cellSizeFor(cols: number): number {
  if (cols >= 20) return 24;
  if (cols >= 16) return 28;
  if (cols >= 12) return 38;
  if (cols >= 8) return 46;
  if (cols >= 6) return 56;
  return 70;
}

export function buildPlateSvg(options: PlateSvgOptions): PlateSvgResult {
  const { title, rows, cols, cells, legend, legendTitle, note } = options;
  const cellSize = cellSizeFor(cols);
  const left = 44;
  const top = 84;
  const right = 28;
  const plateWidth = cols * cellSize;
  const plateHeight = rows * cellSize;
  const width = Math.max(560, left + plateWidth + right);
  const contentWidth = width - left - right;

  // Legend layout is computed first so the canvas can grow to fit it.
  const legendPositions: Array<{ x: number; y: number; item: PlateSvgLegendItem; text: string }> = [];
  let cursorX = 0;
  let cursorY = 0;
  let legendLines = 0;
  for (const item of legend) {
    const text = `${item.label} (${item.count})`;
    const itemWidth = 16 + estimateWidth(text) + 18;
    if (cursorX > 0 && cursorX + itemWidth > contentWidth) {
      cursorX = 0;
      cursorY += 19;
      legendLines++;
    }
    legendPositions.push({ x: cursorX, y: cursorY, item, text });
    cursorX += itemWidth;
  }
  const legendHeight = legend.length > 0 ? 26 + (legendLines + 1) * 19 : 0;
  const height = top + plateHeight + 18 + legendHeight + 10;
  const legendTop = top + plateHeight + 22;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0b0e14"/>`);
  parts.push(
    `<text x="${left}" y="30" fill="#ffd23f" font-family="monospace" font-size="17" font-weight="700">${escapeXml(title)}</text>`,
  );
  if (note) {
    parts.push(
      `<text x="${left}" y="50" fill="#8b96b5" font-family="monospace" font-size="9">${escapeXml(note)}</text>`,
    );
  }

  const headerFont = Math.max(6.5, Math.min(11, cellSize * 0.3));
  for (let col = 0; col < cols; col++) {
    const x = left + col * cellSize + cellSize / 2;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${(top - 8).toFixed(1)}" fill="#8b96b5" font-family="monospace" font-size="${headerFont.toFixed(1)}" text-anchor="middle">${col + 1}</text>`,
    );
  }
  for (let row = 0; row < rows; row++) {
    const y = top + row * cellSize + cellSize / 2 + headerFont * 0.35;
    parts.push(
      `<text x="${left - 10}" y="${y.toFixed(1)}" fill="#8b96b5" font-family="monospace" font-size="${headerFont.toFixed(1)}" text-anchor="end">${rowLabel(row)}</text>`,
    );
  }

  parts.push(
    `<rect x="${left}" y="${top}" width="${plateWidth}" height="${plateHeight}" fill="none" stroke="#4a5a82" stroke-width="2"/>`,
  );

  const labelFont = Math.max(7, Math.min(10.5, cellSize * 0.22));
  const showLabels = cellSize >= 34;
  const showWellIds = cellSize >= 44;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row * cols + col];
      const x = left + col * cellSize + 1;
      const y = top + row * cellSize + 1;
      const size = cellSize - 2;
      const fill = cell?.fill ?? '#0e1220';
      parts.push(
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}" stroke="#121624" stroke-width="1"/>`,
      );
      if (!cell) continue;
      if (showWellIds) {
        parts.push(
          `<text x="${(x + 2.5).toFixed(1)}" y="${(y + 7).toFixed(1)}" fill="${cell.textColor}" opacity="0.7" font-family="monospace" font-size="6">${escapeXml(cell.well)}</text>`,
        );
      }
      if (showLabels && cell.label) {
        const maxChars = Math.max(3, Math.floor((size - 8) / 5.4));
        const label = truncate(cell.label, maxChars);
        parts.push(
          `<text x="${(x + size / 2).toFixed(1)}" y="${(y + size / 2 + labelFont * 0.35).toFixed(1)}" fill="${cell.textColor}" font-family="monospace" font-size="${labelFont.toFixed(1)}" text-anchor="middle">${escapeXml(label)}</text>`,
        );
      }
    }
  }

  if (legend.length > 0) {
    parts.push(
      `<text x="${left}" y="${legendTop}" fill="#8b96b5" font-family="monospace" font-size="9" font-weight="700">${escapeXml(legendTitle)}</text>`,
    );
    for (const position of legendPositions) {
      const x = left + position.x;
      const y = legendTop + 14 + position.y;
      parts.push(
        `<rect x="${x}" y="${(y - 8).toFixed(1)}" width="10" height="10" fill="${position.item.color}" stroke="#2a3450" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${(x + 15).toFixed(1)}" y="${(y + 0.5).toFixed(1)}" fill="#d8e1f2" font-family="monospace" font-size="9">${escapeXml(position.text)}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SVG rasterization failed'));
    image.src = url;
  });
}

export async function renderSvgToCanvas(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.fillStyle = '#0b0e14';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
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

const textEncoder = new TextEncoder();

/** Adds pHYs (physical resolution), sRGB and an iTXt description to a PNG. */
export function pngWithDpi(png: Uint8Array, dpi: number, description: string): Uint8Array {
  const physical = new Uint8Array(9);
  const view = new DataView(physical.buffer);
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  view.setUint32(0, pixelsPerMetre);
  view.setUint32(4, pixelsPerMetre);
  physical[8] = 1;

  const keyword = textEncoder.encode('Description');
  const text = textEncoder.encode(description);
  const itxt = new Uint8Array(keyword.length + 4 + text.length);
  itxt.set(keyword, 0);
  // compression flag, compression method, empty language tag, empty translated keyword
  itxt.set(text, keyword.length + 4);

  const chunks = [
    pngChunk('pHYs', physical),
    pngChunk('sRGB', new Uint8Array([0])),
    pngChunk('iTXt', itxt),
  ];
  const ihdrEnd = 8 + 25;
  if (png.length < ihdrEnd) return png;
  const extra = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(png.length + extra);
  out.set(png.subarray(0, ihdrEnd), 0);
  let offset = ihdrEnd;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(png.subarray(ihdrEnd), offset);
  return out;
}

/** Clipboard write with a selection-based fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (area.parentNode) area.parentNode.removeChild(area);
  }
}
