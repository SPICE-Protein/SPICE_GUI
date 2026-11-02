// Annotated raster output, SVG chart and the combined figure panel. The figure
// is assembled as SVG so the same markup drives the live preview and the
// exported vector file; PNG export rasterises the annotated blot canvas.

import { cropCanvas } from './image';
import { groupMetricStats, type BandMeasurement, type GroupStat, type QuantResult } from './quant';
import type { BlotProject } from './types';

// One measure across groups uses one bar hue; group identity is carried by the
// axis labels, so no categorical colour cycle or legend is needed.
const BAR = '#2f7f94';
const TEXT = '#1b2230';
const MUTED = '#68748a';
const GRID = '#dde3ec';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0';
}

export interface AnnotationOptions {
  selectedLaneId?: string | null;
  selectedBandId?: string | null;
  laneLabels?: boolean;
  roi?: boolean;
}

/** Annotated blot at native crop resolution, with a label strip below. */
export function annotatedCanvas(
  project: BlotProject,
  processed: HTMLCanvasElement,
  options: AnnotationOptions = {},
): HTMLCanvasElement {
  const crop = cropCanvas(processed, project.crop);
  const labelH = options.laneLabels === false ? 0 : Math.max(22, Math.round(crop.height * 0.07));
  const out = document.createElement('canvas');
  out.width = crop.width;
  out.height = crop.height + labelH;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(crop, 0, 0);

  const sx = project.crop.left * processed.width;
  const sy = project.crop.top * processed.height;
  const scale = crop.width / Math.max(1, processed.width * (1 - project.crop.left - project.crop.right));
  const mapX = (x: number) => (x * processed.width - sx) * scale;
  const mapY = (y: number) => (y * processed.height - sy) * scale;
  const line = Math.max(1, Math.round(out.width / 900));
  const font = Math.max(9, Math.round(out.width / 110));

  const visibleLeft = project.crop.left;
  const visibleRight = 1 - project.crop.right;
  for (const lane of project.lanes) {
    if (lane.x < visibleLeft || lane.x > visibleRight) continue;
    const x0 = mapX(lane.x - lane.width / 2);
    const x1 = mapX(lane.x + lane.width / 2);
    const selected = options.selectedLaneId === lane.id;
    ctx.strokeStyle = lane.excluded ? 'rgba(184,67,63,0.9)' : selected ? '#d97b1f' : 'rgba(31,138,158,0.85)';
    ctx.lineWidth = selected ? line * 2 : line;
    ctx.setLineDash(lane.excluded ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, crop.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, crop.height);
    ctx.stroke();
    ctx.setLineDash([]);
    if (options.roi !== false) {
      for (const band of lane.bands) {
        const bx0 = mapX(lane.x - band.width / 2);
        const bx1 = mapX(lane.x + band.width / 2);
        const by0 = mapY(band.y - band.height / 2);
        const by1 = mapY(band.y + band.height / 2);
        const active = options.selectedBandId === band.id;
        const excluded = lane.excluded || band.excluded;
        ctx.strokeStyle = excluded ? 'rgba(184,67,63,0.95)' : active ? '#d97b1f' : 'rgba(63,143,79,0.95)';
        ctx.lineWidth = active ? line * 2 : line;
        ctx.setLineDash(excluded ? [5, 3] : []);
        ctx.strokeRect(bx0, by0, Math.max(1, bx1 - bx0), Math.max(1, by1 - by0));
        ctx.setLineDash([]);
      }
    }
    if (labelH > 0) {
      ctx.save();
      ctx.translate((x0 + x1) / 2, crop.height + 4);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = lane.excluded ? '#b8433f' : '#1b2230';
      ctx.font = `${font}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(lane.name || '', 0, 0);
      ctx.restore();
    }
  }
  return out;
}

function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const n = value / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

interface ChartBodyOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  metricLabel: string;
  title?: string;
  emptyLabel: string;
  nLabel: string;
  noGroupLabel: string;
  showTitle?: boolean;
}

function chartBody(
  groups: GroupStat[],
  rows: BandMeasurement[],
  metric: BlotProject['chartMetric'],
  opts: ChartBodyOptions,
): string {
  const parts: string[] = [];
  const { x, y, width, height } = opts;
  if (opts.title && opts.showTitle !== false) {
    parts.push(
      `<text x="${x}" y="${y - 12}" font-family="monospace" font-size="15" font-weight="700" fill="${TEXT}">${escapeXml(opts.title)}</text>`,
    );
  }
  const plotTop = y + 18;
  const plotBottom = y + height - 48;
  const plotLeft = x + 58;
  const plotRight = x + width - 16;
  const plotW = Math.max(20, plotRight - plotLeft);
  const plotH = Math.max(20, plotBottom - plotTop);

  const data = groups.map((group) => ({
    group,
    ...groupMetricStats(group, rows, metric),
  }));
  const allValues = data.flatMap((d) => d.values);
  const maxValue = allValues.length ? Math.max(...allValues) : 0;
  const maxError = data.length ? Math.max(...data.map((d) => d.mean + d.sem)) : 0;
  const rawMax = Math.max(maxValue, maxError);
  const yMax = rawMax > 0 ? niceMax(rawMax) : 1;
  const tickDigits = yMax >= 10 ? 1 : yMax >= 1 ? 2 : 4;
  parts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="${TEXT}" stroke-width="1.2"/>`,
    `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="${TEXT}" stroke-width="1.2"/>`,
  );
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const value = (yMax * i) / ticks;
    const ty = plotBottom - (plotH * i) / ticks;
    parts.push(
      `<line x1="${plotLeft}" y1="${ty}" x2="${plotRight}" y2="${ty}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${plotLeft - 8}" y="${ty + 4}" text-anchor="end" font-family="monospace" font-size="11" fill="${MUTED}">${fmt(value, tickDigits)}</text>`,
    );
  }
  parts.push(
    `<text transform="translate(${x + 14},${plotTop + plotH / 2}) rotate(-90)" text-anchor="middle" font-family="monospace" font-size="12" fill="${TEXT}">${escapeXml(opts.metricLabel)}</text>`,
  );
  if (!data.some((d) => d.values.length)) {
    parts.push(
      `<text x="${x + width / 2}" y="${plotTop + plotH / 2}" text-anchor="middle" font-family="monospace" font-size="12" fill="${MUTED}">${escapeXml(opts.emptyLabel)}</text>`,
    );
    return parts.join('');
  }
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(slot * 0.5, 76);
  data.forEach((entry, index) => {
    const cx = plotLeft + slot * (index + 0.5);
    const meanY = plotBottom - (entry.mean / yMax) * plotH;
    const zeroY = plotBottom;
    const label = entry.group.name || opts.noGroupLabel;
    const marks: string[] = [];
    marks.push(
      `<rect x="${cx - barW / 2}" y="${Math.min(meanY, zeroY)}" width="${barW}" height="${Math.abs(zeroY - meanY)}" rx="2" fill="${BAR}" fill-opacity="0.68" stroke="${BAR}" stroke-width="1"/>`,
    );
    if (entry.values.length > 1) {
      const semTop = plotBottom - ((entry.mean + entry.sem) / yMax) * plotH;
      const semBottom = plotBottom - (Math.max(0, entry.mean - entry.sem) / yMax) * plotH;
      marks.push(
        `<line x1="${cx}" y1="${semTop}" x2="${cx}" y2="${semBottom}" stroke="${TEXT}" stroke-width="1.4"/>`,
        `<line x1="${cx - 5}" y1="${semTop}" x2="${cx + 5}" y2="${semTop}" stroke="${TEXT}" stroke-width="1.4"/>`,
        `<line x1="${cx - 5}" y1="${semBottom}" x2="${cx + 5}" y2="${semBottom}" stroke="${TEXT}" stroke-width="1.4"/>`,
      );
    }
    entry.values.forEach((value, pointIndex) => {
      const jitter = ((pointIndex % 5) - 2) * (barW / 10);
      const py = plotBottom - (value / yMax) * plotH;
      marks.push(
        `<circle cx="${cx + jitter}" cy="${py}" r="3" fill="${TEXT}" fill-opacity="0.78"/>`,
      );
    });
    marks.push(
      `<text x="${cx}" y="${plotBottom + 18}" text-anchor="middle" font-family="monospace" font-size="11" fill="${TEXT}">${escapeXml(label)}</text>`,
      `<text x="${cx}" y="${plotBottom + 33}" text-anchor="middle" font-family="monospace" font-size="10" fill="${MUTED}">${escapeXml(opts.nLabel)}=${entry.values.length}</text>`,
    );
    const tooltip = `${label}: ${fmt(entry.mean, 3)} ± ${fmt(entry.sem, 3)} (${opts.nLabel}=${entry.values.length})`;
    parts.push(`<g><title>${escapeXml(tooltip)}</title>${marks.join('')}</g>`);
  });
  return parts.join('');
}

export interface ChartOptions {
  width: number;
  height: number;
  metricLabel: string;
  title?: string;
  emptyLabel: string;
  nLabel: string;
  noGroupLabel: string;
}

/** Standalone SVG chart for the results pane. */
export function chartSvg(
  result: QuantResult,
  project: BlotProject,
  opts: ChartOptions,
): string {
  const body = chartBody(result.groups, result.rows, project.chartMetric, {
    x: 12,
    y: 34,
    width: opts.width - 24,
    height: opts.height - 46,
    metricLabel: opts.metricLabel,
    title: opts.title,
    emptyLabel: opts.emptyLabel,
    nLabel: opts.nLabel,
    noGroupLabel: opts.noGroupLabel,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}" role="img" aria-label="${escapeXml(opts.title ?? opts.metricLabel)}"><rect width="${opts.width}" height="${opts.height}" fill="#ffffff"/>${body}</svg>`;
}

export interface FigureOptions {
  title: string;
  chartTitle: string;
  metricLabel: string;
  emptyLabel: string;
  nLabel: string;
  noGroupLabel: string;
  footer: string;
}

interface PlacedImage {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Full figure panel: title, annotated blot with lane labels, chart, footer. */
export function figureSvg(
  project: BlotProject,
  processed: HTMLCanvasElement,
  result: QuantResult,
  opts: FigureOptions,
): string {
  const crop = cropCanvas(processed, project.crop);
  const dataUrl = crop.toDataURL('image/png');
  const width = 1200;
  const height = 760;
  const margin = 44;
  const titleH = opts.title.trim() ? 52 : 22;
  const panelTop = margin + titleH;
  const panelH = height - panelTop - 58;
  const blotPanelW = Math.round((width - margin * 2) * 0.54);
  const chartX = margin + blotPanelW + 26;
  const chartW = width - margin - chartX;
  const image = fitImage(crop.width, crop.height, margin, panelTop, blotPanelW, panelH - 46);
  const parts: string[] = [];

  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  if (opts.title.trim()) {
    parts.push(
      `<text x="${width / 2}" y="${margin + 24}" text-anchor="middle" font-family="monospace" font-size="24" font-weight="700" fill="${TEXT}">${escapeXml(opts.title)}</text>`,
    );
  }
  parts.push(
    `<image x="${image.x}" y="${image.y}" width="${image.width}" height="${image.height}" href="${dataUrl}" preserveAspectRatio="none"/>`,
  );

  const sx = project.crop.left * processed.width;
  const sy = project.crop.top * processed.height;
  const cropW = Math.max(1, processed.width * (1 - project.crop.left - project.crop.right));
  const cropH = Math.max(1, processed.height * (1 - project.crop.top - project.crop.bottom));
  const mapX = (value: number) => image.x + ((value * processed.width - sx) / cropW) * image.width;
  const mapY = (value: number) => image.y + ((value * processed.height - sy) / cropH) * image.height;

  const visibleLeft = project.crop.left;
  const visibleRight = 1 - project.crop.right;
  const visibleTop = project.crop.top;
  const visibleBottom = 1 - project.crop.bottom;
  for (const lane of project.lanes) {
    if (lane.x < visibleLeft || lane.x > visibleRight) continue;
    const lx0 = mapX(lane.x - lane.width / 2);
    const lx1 = mapX(lane.x + lane.width / 2);
    parts.push(
      `<line x1="${lx0}" y1="${image.y}" x2="${lx0}" y2="${image.y + image.height}" stroke="${lane.excluded ? '#b8433f' : '#1f8a9e'}" stroke-width="1.2" stroke-dasharray="${lane.excluded ? '6 4' : 'none'}" opacity="0.9"/>`,
      `<line x1="${lx1}" y1="${image.y}" x2="${lx1}" y2="${image.y + image.height}" stroke="${lane.excluded ? '#b8433f' : '#1f8a9e'}" stroke-width="1.2" stroke-dasharray="${lane.excluded ? '6 4' : 'none'}" opacity="0.9"/>`,
    );
    if (project.showRoi) {
      for (const band of lane.bands) {
        if (band.y < visibleTop || band.y > visibleBottom) continue;
        const bx0 = mapX(lane.x - band.width / 2);
        const bx1 = mapX(lane.x + band.width / 2);
        const by0 = mapY(band.y - band.height / 2);
        const by1 = mapY(band.y + band.height / 2);
        parts.push(
          `<rect x="${bx0}" y="${by0}" width="${Math.max(1, bx1 - bx0)}" height="${Math.max(1, by1 - by0)}" fill="none" stroke="${lane.excluded || band.excluded ? '#b8433f' : '#3f8f4f'}" stroke-width="1.2" stroke-dasharray="${lane.excluded || band.excluded ? '5 3' : 'none'}"/>`,
        );
      }
    }
    if (project.showLaneLabels) {
      const label = lane.sample || lane.name;
      parts.push(
        `<text transform="translate(${(lx0 + lx1) / 2},${image.y + image.height + 8}) rotate(-45)" text-anchor="end" font-family="monospace" font-size="12" fill="${lane.excluded ? '#b8433f' : TEXT}">${escapeXml(label)}</text>`,
      );
    }
  }

  parts.push(
    chartBody(result.groups, result.rows, project.chartMetric, {
      x: chartX,
      y: panelTop + 22,
      width: chartW,
      height: panelH - 30,
      metricLabel: opts.metricLabel,
      title: opts.chartTitle,
      emptyLabel: opts.emptyLabel,
      nLabel: opts.nLabel,
      noGroupLabel: opts.noGroupLabel,
    }),
  );
  parts.push(
    `<text x="${width - margin}" y="${height - 20}" text-anchor="end" font-family="monospace" font-size="11" fill="${MUTED}">${escapeXml(opts.footer)}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(opts.title || opts.chartTitle)}">${parts.join('')}</svg>`;
}

function fitImage(
  sourceW: number,
  sourceH: number,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): PlacedImage {
  const scale = Math.min(maxW / Math.max(1, sourceW), maxH / Math.max(1, sourceH));
  const width = Math.max(1, sourceW * scale);
  const height = Math.max(1, sourceH * scale);
  return {
    x: x + (maxW - width) / 2,
    y: y + (maxH - height) / 2,
    width,
    height,
  };
}

// --------------------------------------------------------------------- CSV

export interface CsvLabels {
  lane: string;
  band: string;
  sample: string;
  group: string;
  included: string;
  area: string;
  mean: string;
  background: string;
  volume: string;
  saturated: string;
  normalized: string;
  fold: string;
  groupMean: string;
  groupSd: string;
  groupSem: string;
  groupN: string;
  metric: string;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function resultsCsv(
  project: BlotProject,
  result: QuantResult,
  labels: CsvLabels,
): string {
  const header = [
    labels.lane,
    labels.band,
    labels.sample,
    labels.group,
    labels.included,
    labels.area,
    labels.mean,
    labels.background,
    labels.volume,
    labels.saturated,
    labels.normalized,
    labels.fold,
    labels.groupMean,
    labels.groupSd,
    labels.groupSem,
    labels.groupN,
    labels.metric,
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of result.rows) {
    lines.push(
      [
        row.laneName,
        row.bandIndex + 1,
        row.sample,
        row.group,
        row.included ? 1 : 0,
        row.area,
        fmt(row.meanSignal, 6),
        fmt(row.background, 6),
        fmt(row.netVolume, 6),
        row.saturated ? 1 : 0,
        fmt(row.normalized, 6),
        fmt(row.fold, 6),
        fmt(row.groupMean, 6),
        fmt(row.groupSd, 6),
        fmt(row.groupSem, 6),
        row.groupN,
        project.chartMetric,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------ PNG metadata

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

async function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Insert a pHYs chunk so the annotated PNG carries the requested print DPI. */
export async function annotatedPng(
  canvas: HTMLCanvasElement,
  dpi: number,
  description: string,
): Promise<Uint8Array> {
  const png = await canvasToBytes(canvas);
  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  const ppm = Math.round(dpi / 0.0254);
  pv.setUint32(0, ppm);
  pv.setUint32(4, ppm);
  phys[8] = 1;
  const chunk = pngChunk('pHYs', phys);
  const encoder = new TextEncoder();
  const keyword = encoder.encode('Description');
  const text = encoder.encode(description);
  const itxt = new Uint8Array(keyword.length + 5 + text.length);
  itxt.set(keyword, 0);
  let p = keyword.length;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt[p++] = 0;
  itxt.set(text, p);
  const textChunk = pngChunk('iTXt', itxt);
  const ihdrEnd = 33;
  const out = new Uint8Array(png.length + chunk.length + textChunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(textChunk, ihdrEnd + chunk.length);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length + textChunk.length);
  return out;
}
