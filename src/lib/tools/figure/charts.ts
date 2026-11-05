// Chart node: CSV parsing plus a deterministic SVG renderer.
//
// Charts stay vector in SVG/PDF/PPTX exports. The renderer only depends on the
// node model, so it can be unit-tested without a DOM. CSV is deliberately
// simple: the first column is the category label; a header ending in "err",
// "error", "sd" or "sem" attaches an error column to the series before it.
import { PT_TO_PX, type ChartKind, type ChartNode, type ChartSeries } from './types';

export interface ChartData {
  labels: string[];
  series: ChartSeries[];
}

interface TickScale {
  min: number;
  max: number;
  ticks: number[];
}

function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 10000) / 10000);
}

function isNone(value: string | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return !text || text === 'none' || text === 'transparent';
}

// ---------------------------------------------------------------------- CSV

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      out.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  out.push(cell.trim());
  return out;
}

function detectDelimiter(lines: string[]): string {
  const header = lines[0] ?? '';
  const counts: Array<[string, number]> = [
    [',', (header.match(/,/g) ?? []).length],
    ['\t', (header.match(/\t/g) ?? []).length],
    [';', (header.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function isErrorHeader(header: string): boolean {
  return /(?:^|[\s_(])(?:err|error|sd|sem)(?:$|[\s_)])/i.test(header.trim());
}

function seriesId(index: number): string {
  return `series_${index + 1}`;
}

export const CHART_CSV_EXAMPLE = [
  'Condition,Control,Control err,Treatment,Treatment err',
  '0 h,1,0.10,1.8,0.18',
  '24 h,1.2,0.12,2.1,0.20',
].join('\n');

/** Parse a small CSV table. Returns null when no labelled numeric column exists. */
export function parseChartCsv(text: string): ChartData | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Only "# " starts a comment, so a label such as "#1" survives a round-trip.
    .filter((line) => line.length > 0 && !/^#\s/.test(line));
  if (lines.length < 2) return null;
  const delimiter = detectDelimiter(lines);
  const header = splitCsvLine(lines[0], delimiter);
  if (header.length < 2) return null;

  const rows = lines.slice(1).map((line) => splitCsvLine(line, delimiter));
  const labels = rows.map((row, index) => row[0] || `#${index + 1}`);
  if (labels.length === 0) return null;

  const series: ChartSeries[] = [];
  for (let column = 1; column < header.length; column += 1) {
    const name = header[column] || `Series ${column}`;
    const values = rows.map((row) => {
      const value = Number.parseFloat(row[column] ?? '');
      return Number.isFinite(value) ? value : 0;
    });
    if (isErrorHeader(name)) {
      if (!series.length) continue;
      const target = series[series.length - 1];
      target.errors = values.map((value) => Math.abs(value));
      continue;
    }
    series.push({
      id: seriesId(series.length),
      name,
      color: '',
      values,
      errors: new Array(labels.length).fill(0) as number[],
    });
  }
  if (!series.length) return null;
  return { labels, series };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Round-trip a chart through the CSV editor format. */
export function chartCsv(node: ChartNode): string {
  const hasErrors = node.series.some((series) => series.errors.some((value) => value !== 0));
  const header = ['Label'];
  for (const series of node.series) {
    header.push(series.name);
    if (hasErrors) header.push(`${series.name} err`);
  }
  const rows = [header.map(csvCell).join(',')];
  for (let index = 0; index < node.labels.length; index += 1) {
    const row = [node.labels[index] ?? ''];
    for (const series of node.series) {
      row.push(String(series.values[index] ?? 0));
      if (hasErrors) row.push(String(series.errors[index] ?? 0));
    }
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

/** Apply parsed CSV while preserving existing series colours where possible. */
export function applyChartCsv(node: ChartNode, data: ChartData, palette: readonly string[]): void {
  const previous = new Map(node.series.map((series) => [series.name, series]));
  node.labels = data.labels;
  node.series = data.series.map((series, index) => {
    const old = previous.get(series.name);
    return {
      ...series,
      id: old?.id ?? series.id,
      color: old?.color || palette[index % palette.length],
      errors: series.errors.slice(0, data.labels.length),
    };
  });
}

// ------------------------------------------------------------------ geometry

function valuesInRange(node: ChartNode): number[] {
  const values: number[] = [];
  for (const series of node.series) {
    for (let index = 0; index < node.labels.length; index += 1) {
      values.push(series.values[index] ?? 0);
    }
  }
  return values;
}

function dataExtent(node: ChartNode): { min: number; max: number } {
  const values = valuesInRange(node);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (node.showErrorBars) {
    for (const series of node.series) {
      for (let index = 0; index < node.labels.length; index += 1) {
        const value = series.values[index] ?? 0;
        const error = Math.abs(series.errors[index] ?? 0);
        min = Math.min(min, value - error);
        max = Math.max(max, value + error);
      }
    }
  }
  if (node.chartType === 'bar') {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  return { min, max };
}

function niceStep(span: number, targetTicks: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function chartScale(node: ChartNode): TickScale {
  const extent = dataExtent(node);
  let min = node.yMin !== null && Number.isFinite(node.yMin) ? node.yMin : extent.min;
  let max = node.yMax !== null && Number.isFinite(node.yMax) ? node.yMax : extent.max;
  if (max <= min) max = min + 1;
  const pad = (max - min) * 0.08;
  if (node.yMin === null) min = min < 0 ? min - pad : Math.min(0, min);
  if (node.yMax === null) max += pad;
  const step = niceStep(max - min, 5);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step * 0.001; value += step) {
    ticks.push(Math.abs(value) < step * 0.0001 ? 0 : value);
  }
  return { min: start, max: end, ticks };
}

function tickLabel(value: number, step: number): string {
  if (value === 0) return '0';
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}

function significanceLevels(node: ChartNode): number[] {
  const levels: number[] = [];
  const occupied: Array<Array<[number, number]>> = [];
  for (const sig of node.significance) {
    let level = 0;
    while (true) {
      const spans = occupied[level] ?? [];
      if (!spans.some(([from, to]) => sig.from <= to && sig.to >= from)) break;
      level += 1;
    }
    (occupied[level] ??= []).push([sig.from, sig.to]);
    levels.push(level);
  }
  return levels;
}

// -------------------------------------------------------------------- render

export interface ChartRender {
  svg: string;
  scale: TickScale;
}

/**
 * Render a chart inside its node bounds. The caller wraps the fragment in the
 * node rotation/opacity group, so coordinates are document coordinates.
 */
export function renderChartNode(node: ChartNode): ChartRender {
  const fontPx = Math.max(5, node.fontSize * PT_TO_PX);
  const textColor = isNone(node.textColor) ? '#334155' : node.textColor;
  const axisColor = isNone(node.stroke) ? textColor : node.stroke;
  const scale = chartScale(node);
  const tickPad = fontPx * 4.2;
  const hasXLabel = Boolean(node.xLabel.trim());
  const hasLegend = node.showLegend && node.series.length > 0;
  const padLeft = Math.max(tickPad, fontPx * 2.2);
  const padRight = Math.max(8, fontPx * 0.6);
  const padTop = hasLegend ? fontPx * 2.6 : fontPx * 0.8;
  const padBottom = fontPx * 2.4 + (hasXLabel ? fontPx * 1.6 : 0);
  const plot = {
    x: node.x + padLeft,
    y: node.y + padTop,
    w: Math.max(20, node.w - padLeft - padRight),
    h: Math.max(20, node.h - padTop - padBottom),
  };
  const yFor = (value: number): number =>
    plot.y + plot.h - ((value - scale.min) / (scale.max - scale.min)) * plot.h;
  const baseline = yFor(Math.min(scale.max, Math.max(scale.min, 0)));
  const categoryCount = Math.max(1, node.labels.length);
  const slot = plot.w / categoryCount;
  const out: string[] = [];

  if (!isNone(node.plotBackground)) {
    out.push(
      `<rect x="${num(plot.x)}" y="${num(plot.y)}" width="${num(plot.w)}" height="${num(plot.h)}" fill="${esc(node.plotBackground)}"/>`,
    );
  }

  if (node.showGrid) {
    for (const tick of scale.ticks) {
      const y = yFor(tick);
      out.push(
        `<line x1="${num(plot.x)}" y1="${num(y)}" x2="${num(plot.x + plot.w)}" y2="${num(y)}" stroke="#e2e8f0" stroke-width="0.6"/>`,
      );
    }
  }

  // Axes
  out.push(
    `<line x1="${num(plot.x)}" y1="${num(plot.y)}" x2="${num(plot.x)}" y2="${num(plot.y + plot.h)}" stroke="${esc(axisColor)}" stroke-width="${num(Math.max(0.6, node.strokeWidth))}"/>`,
  );
  out.push(
    `<line x1="${num(plot.x)}" y1="${num(plot.y + plot.h)}" x2="${num(plot.x + plot.w)}" y2="${num(plot.y + plot.h)}" stroke="${esc(axisColor)}" stroke-width="${num(Math.max(0.6, node.strokeWidth))}"/>`,
  );

  // Y ticks and labels
  for (const tick of scale.ticks) {
    const y = yFor(tick);
    out.push(
      `<line x1="${num(plot.x - 3)}" y1="${num(y)}" x2="${num(plot.x)}" y2="${num(y)}" stroke="${esc(axisColor)}" stroke-width="0.7"/>`,
    );
    out.push(
      `<text x="${num(plot.x - 5)}" y="${num(y)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" fill="${esc(textColor)}" text-anchor="end" dominant-baseline="middle">${esc(tickLabel(tick, scale.ticks.length > 1 ? scale.ticks[1] - scale.ticks[0] : 1))}</text>`,
    );
  }

  // X category labels
  node.labels.forEach((label, index) => {
    const x = plot.x + slot * (index + 0.5);
    const maxChars = Math.max(3, Math.floor(slot / (fontPx * 0.58)));
    const text = label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
    out.push(
      `<text x="${num(x)}" y="${num(plot.y + plot.h + fontPx * 1.35)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" fill="${esc(textColor)}" text-anchor="middle">${esc(text)}</text>`,
    );
  });

  // Axis labels
  if (hasXLabel) {
    out.push(
      `<text x="${num(plot.x + plot.w / 2)}" y="${num(node.y + node.h - fontPx * 0.4)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" fill="${esc(textColor)}" text-anchor="middle">${esc(node.xLabel)}</text>`,
    );
  }
  if (node.yLabel.trim()) {
    const cx = node.x + fontPx * 1.1;
    const cy = plot.y + plot.h / 2;
    out.push(
      `<text x="${num(cx)}" y="${num(cy)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" fill="${esc(textColor)}" text-anchor="middle" transform="rotate(-90 ${num(cx)} ${num(cy)})">${esc(node.yLabel)}</text>`,
    );
  }

  // Data marks
  const seriesCount = Math.max(1, node.series.length);
  if (node.chartType === 'bar') {
    const groupWidth = slot * 0.72;
    const barWidth = groupWidth / seriesCount;
    node.series.forEach((series, seriesIndex) => {
      const color = isNone(series.color) ? '#2563eb' : series.color;
      node.labels.forEach((_, index) => {
        const value = series.values[index] ?? 0;
        const x = plot.x + slot * index + (slot - groupWidth) / 2 + barWidth * seriesIndex;
        const y = yFor(Math.max(scale.min, Math.min(scale.max, value)));
        const top = Math.min(y, baseline);
        const height = Math.max(0.5, Math.abs(baseline - y));
        out.push(
          `<rect x="${num(x)}" y="${num(top)}" width="${num(Math.max(0.5, barWidth - 1))}" height="${num(height)}" fill="${esc(color)}"/>`,
        );
        if (node.showValues) {
          out.push(
            `<text x="${num(x + barWidth / 2)}" y="${num((value >= 0 ? y : baseline) - 3)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx * 0.9)}" fill="${esc(textColor)}" text-anchor="middle">${esc(String(value))}</text>`,
          );
        }
      });
    });
  } else {
    node.series.forEach((series) => {
      const color = isNone(series.color) ? '#2563eb' : series.color;
      const points = node.labels.map((_, index) => ({
        x: plot.x + slot * (index + 0.5),
        y: yFor(Math.max(scale.min, Math.min(scale.max, series.values[index] ?? 0))),
        value: series.values[index] ?? 0,
      }));
      if (node.chartType === 'line') {
        out.push(
          `<polyline points="${points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ')}" fill="none" stroke="${esc(color)}" stroke-width="${num(Math.max(1, node.strokeWidth * 1.4))}" stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
      points.forEach((point) => {
        out.push(
          `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(Math.max(2, fontPx * 0.34))}" fill="${esc(color)}"/>`,
        );
        if (node.showValues) {
          out.push(
            `<text x="${num(point.x)}" y="${num(point.y - fontPx * 0.8)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx * 0.9)}" fill="${esc(textColor)}" text-anchor="middle">${esc(String(point.value))}</text>`,
          );
        }
      });
    });
  }

  // Error bars
  if (node.showErrorBars) {
    const cap = Math.max(2, fontPx * 0.3);
    node.series.forEach((series, seriesIndex) => {
      const color = isNone(series.color) ? '#2563eb' : series.color;
      const barWidth = node.chartType === 'bar' ? (slot * 0.72) / seriesCount : 0;
      node.labels.forEach((_, index) => {
        const error = Math.abs(series.errors[index] ?? 0);
        if (!error) return;
        const value = series.values[index] ?? 0;
        const x =
          node.chartType === 'bar'
            ? plot.x + slot * index + (slot - slot * 0.72) / 2 + barWidth * (seriesIndex + 0.5)
            : plot.x + slot * (index + 0.5);
        const high = yFor(Math.min(scale.max, value + error));
        const low = yFor(Math.max(scale.min, value - error));
        out.push(
          `<line x1="${num(x)}" y1="${num(high)}" x2="${num(x)}" y2="${num(low)}" stroke="${esc(color)}" stroke-width="1"/>`,
          `<line x1="${num(x - cap)}" y1="${num(high)}" x2="${num(x + cap)}" y2="${num(high)}" stroke="${esc(color)}" stroke-width="1"/>`,
          `<line x1="${num(x - cap)}" y1="${num(low)}" x2="${num(x + cap)}" y2="${num(low)}" stroke="${esc(color)}" stroke-width="1"/>`,
        );
      });
    });
  }

  // Significance brackets
  if (node.significance.length && node.labels.length > 1) {
    const levels = significanceLevels(node);
    node.significance.forEach((sig, index) => {
      const level = levels[index] ?? 0;
      let peak = 0;
      for (let category = sig.from; category <= sig.to; category += 1) {
        for (const series of node.series) {
          const value = series.values[category] ?? 0;
          const error = node.showErrorBars ? Math.abs(series.errors[category] ?? 0) : 0;
          peak = Math.max(peak, value + error);
        }
      }
      const y = Math.max(
        plot.y + fontPx * 0.6,
        Math.min(plot.y + plot.h - 4, yFor(Math.min(scale.max, peak)) - 6 - level * (fontPx * 1.3)),
      );
      const x1 = plot.x + slot * (sig.from + 0.5);
      const x2 = plot.x + slot * (sig.to + 0.5);
      const hook = Math.min(6, Math.abs(x2 - x1) / 4);
      out.push(
        `<path d="M ${num(x1)} ${num(y + hook)} L ${num(x1)} ${num(y)} L ${num(x2)} ${num(y)} L ${num(x2)} ${num(y + hook)}" fill="none" stroke="${esc(textColor)}" stroke-width="0.9"/>`,
      );
      if (sig.label) {
        out.push(
          `<text x="${num((x1 + x2) / 2)}" y="${num(y - 2)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" font-weight="600" fill="${esc(textColor)}" text-anchor="middle">${esc(sig.label)}</text>`,
        );
      }
    });
  }

  // Legend
  if (hasLegend) {
    let x = plot.x;
    const y = node.y + fontPx * 1.1;
    const maxX = plot.x + plot.w;
    for (const series of node.series) {
      const color = isNone(series.color) ? '#2563eb' : series.color;
      const labelWidth = Math.max(fontPx * 3, series.name.length * fontPx * 0.56);
      if (x + labelWidth + fontPx * 1.6 > maxX) break;
      out.push(
        `<rect x="${num(x)}" y="${num(y - fontPx * 0.5)}" width="${num(fontPx * 0.55)}" height="${num(fontPx * 0.55)}" fill="${esc(color)}"/>`,
        `<text x="${num(x + fontPx * 0.8)}" y="${num(y)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx * 0.95)}" fill="${esc(textColor)}" dominant-baseline="middle">${esc(series.name)}</text>`,
      );
      x += fontPx * 0.55 + fontPx * 0.8 + labelWidth + fontPx;
    }
  }

  return { svg: out.join(''), scale };
}

/** Human-readable summary used by the layer list and project metadata. */
export function chartSummary(node: ChartNode): string {
  const kind: Record<ChartKind, string> = { bar: 'Bar', line: 'Line', scatter: 'Scatter' };
  return `${kind[node.chartType]} · ${node.series.length} series · ${node.labels.length} categories`;
}
