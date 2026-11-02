// Dependency-free SVG chart builders for the qPCR tool: a grouped bar chart
// with individual points and SEM error bars, plus an optional Delta Ct heatmap.
// The generated SVG is used inline and exported as SVG or rasterized to PNG.

export interface ChartBar {
  value: number;
  points: number[];
  sem: number | null;
  logSem?: number | null;
  n: number;
}

export interface ChartSeries {
  name: string;
  bars: (ChartBar | null)[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
  log: boolean;
}

export interface SvgDoc {
  svg: string;
  width: number;
  height: number;
}

export interface ChartLabels {
  title: string;
  yLabel: string;
}

const PALETTE = [
  '#2f6fed',
  '#e8892b',
  '#2f9e5f',
  '#d64545',
  '#8a5cd6',
  '#2aa7b8',
  '#b8860b',
  '#777777',
];

const FONT = "'SFMono-Regular','JetBrains Mono','Fira Code','Menlo',monospace";

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(1);
  }
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return value.toPrecision(3);
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function chartColors(count: number): string[] {
  return Array.from({ length: count }, (_, i) => PALETTE[i % PALETTE.length]);
}

/** Grouped bar chart with individual points and SEM error bars. */
export function barChartSvg(data: ChartData, labels: ChartLabels): SvgDoc {
  const width = 860;
  const height = 440;
  const marginLeft = 78;
  const marginRight = 24;
  const marginBottom = 88;
  const titleY = 24;
  const legendStartY = 44;
  const legendLineHeight = 16;
  const colors = chartColors(data.series.length);

  const legendLines: { name: string; color: string }[][] = [[]];
  const availableWidth = width - marginLeft - marginRight;
  let cursor = marginLeft;
  data.series.forEach((series, index) => {
    const itemWidth = series.name.length * 6.4 + 28;
    if (cursor + itemWidth > width - marginRight && legendLines[legendLines.length - 1].length) {
      legendLines.push([]);
      cursor = marginLeft;
    }
    legendLines[legendLines.length - 1].push({ name: series.name, color: colors[index] });
    cursor += itemWidth;
  });
  const plotTop = legendStartY + legendLines.length * legendLineHeight + 12;
  const plotBottom = height - marginBottom;
  const plotLeft = marginLeft;
  const plotRight = width - marginRight;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const linearValues: number[] = [];
  const logValues: number[] = [];
  for (const series of data.series) {
    for (const bar of series.bars) {
      if (!bar) continue;
      const candidates = [bar.value, ...bar.points];
      for (const value of candidates) {
        if (!Number.isFinite(value)) continue;
        if (data.log) {
          if (value > 0) logValues.push(value);
        } else {
          linearValues.push(value);
        }
      }
      if (bar.sem !== null && Number.isFinite(bar.sem)) {
        if (!data.log) linearValues.push(bar.value + bar.sem);
      }
      if (data.log && bar.logSem !== null && bar.logSem !== undefined && bar.value > 0) {
        logValues.push(bar.value * 10 ** bar.logSem);
        if (bar.value / 10 ** bar.logSem > 0) logValues.push(bar.value / 10 ** bar.logSem);
      }
    }
  }

  let yMin = 0;
  let yMax = 1;
  let ticks: number[] = [];
  if (data.log) {
    const positive = logValues.filter((v) => v > 0);
    let minLog = -1;
    let maxLog = 1;
    if (positive.length) {
      minLog = Math.floor(Math.log10(Math.min(...positive)));
      maxLog = Math.ceil(Math.log10(Math.max(...positive)));
    }
    if (maxLog - minLog < 1) maxLog = minLog + 1;
    yMin = minLog;
    yMax = maxLog;
    const span = maxLog - minLog;
    const step = Math.max(1, Math.ceil(span / 7));
    for (let v = minLog; v <= maxLog + 1e-9; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] !== maxLog) ticks.push(maxLog);
  } else {
    const maxValue = linearValues.length ? Math.max(...linearValues) : 0;
    yMax = maxValue > 0 ? maxValue * 1.08 : 1;
    const step = niceStep(yMax / 5);
    yMax = Math.ceil(yMax / step) * step;
    for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  }

  const yOf = (value: number): number => {
    if (data.log) {
      if (value <= 0) return plotBottom;
      const ratio = (Math.log10(value) - yMin) / (yMax - yMin);
      return plotBottom - Math.max(0, Math.min(1, ratio)) * plotHeight;
    }
    const ratio = (value - 0) / (yMax - 0);
    return plotBottom - Math.max(0, Math.min(1, ratio)) * plotHeight;
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="24" y="${titleY}" font-family="${FONT}" font-size="15" font-weight="700" fill="#151a24">${esc(labels.title)}</text>`,
  );

  legendLines.forEach((line, lineIndex) => {
    let x = marginLeft;
    const y = legendStartY + lineIndex * legendLineHeight;
    for (const item of line) {
      parts.push(
        `<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${item.color}" stroke="#333333" stroke-width="0.6"/>`,
      );
      parts.push(
        `<text x="${x + 15}" y="${y}" font-family="${FONT}" font-size="10" fill="#333333">${esc(truncate(item.name, 26))}</text>`,
      );
      x += item.name.length * 6.4 + 28;
    }
  });

  // Plot frame and horizontal grid.
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#fbfcfe" stroke="#c9cfda" stroke-width="1"/>`,
  );
  for (const tick of ticks) {
    const y = data.log ? yOf(10 ** tick) : yOf(tick);
    if (y < plotTop - 0.5 || y > plotBottom + 0.5) continue;
    parts.push(
      `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#e4e8f0" stroke-width="1"/>`,
    );
    const label = data.log ? `1e${Math.round(tick)}` : formatTick(tick);
    parts.push(
      `<text x="${plotLeft - 8}" y="${y + 3}" text-anchor="end" font-family="${FONT}" font-size="9" fill="#4a5262">${esc(label)}</text>`,
    );
  }
  parts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#333b4a" stroke-width="1.2"/>`,
  );
  parts.push(
    `<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#333b4a" stroke-width="1.2"/>`,
  );

  const categoryCount = data.categories.length;
  const bandWidth = categoryCount ? plotWidth / categoryCount : plotWidth;
  const groupWidth = bandWidth * 0.78;
  const barWidth = groupWidth / Math.max(1, data.series.length);
  const rotateLabels =
    categoryCount > 6 || data.categories.some((category) => category.length > 10);

  data.categories.forEach((category, categoryIndex) => {
    const groupStart = plotLeft + categoryIndex * bandWidth + (bandWidth - groupWidth) / 2;
    data.series.forEach((series, seriesIndex) => {
      const bar = series.bars[categoryIndex];
      if (!bar || !Number.isFinite(bar.value) || (data.log && bar.value <= 0)) return;
      const color = colors[seriesIndex];
      const x = groupStart + seriesIndex * barWidth;
      const center = x + barWidth / 2;
      const top = yOf(bar.value);
      const barPixelHeight = Math.max(0, plotBottom - top);
      parts.push(
        `<rect x="${x + barWidth * 0.08}" y="${top}" width="${barWidth * 0.84}" height="${barPixelHeight}" fill="${color}" fill-opacity="0.82" stroke="${color}" stroke-width="0.8"/>`,
      );

      if (data.log) {
        const logSem = bar.logSem;
        if (logSem !== null && logSem !== undefined && Number.isFinite(logSem) && logSem > 0) {
          const high = bar.value * 10 ** logSem;
          const low = bar.value / 10 ** logSem;
          const yHigh = Math.max(plotTop, yOf(high));
          const yLow = Math.min(plotBottom, yOf(low));
          const cap = Math.min(10, barWidth * 0.3);
          parts.push(
            `<line x1="${center}" y1="${yHigh}" x2="${center}" y2="${yLow}" stroke="#222222" stroke-width="1"/>`,
          );
          parts.push(
            `<line x1="${center - cap}" y1="${yHigh}" x2="${center + cap}" y2="${yHigh}" stroke="#222222" stroke-width="1"/>`,
          );
          parts.push(
            `<line x1="${center - cap}" y1="${yLow}" x2="${center + cap}" y2="${yLow}" stroke="#222222" stroke-width="1"/>`,
          );
        }
      } else if (bar.sem !== null && Number.isFinite(bar.sem) && bar.sem > 0) {
        const yHigh = yOf(bar.value + bar.sem);
        const yLow = yOf(Math.max(0, bar.value - bar.sem));
        const cap = Math.min(10, barWidth * 0.3);
        parts.push(
          `<line x1="${center}" y1="${yHigh}" x2="${center}" y2="${yLow}" stroke="#222222" stroke-width="1"/>`,
        );
        parts.push(
          `<line x1="${center - cap}" y1="${yHigh}" x2="${center + cap}" y2="${yHigh}" stroke="#222222" stroke-width="1"/>`,
        );
        parts.push(
          `<line x1="${center - cap}" y1="${yLow}" x2="${center + cap}" y2="${yLow}" stroke="#222222" stroke-width="1"/>`,
        );
      }

      const points = bar.points.filter((p) => Number.isFinite(p) && (!data.log || p > 0));
      points.forEach((point, pointIndex) => {
        const offset =
          (pointIndex - (points.length - 1) / 2) / Math.max(1, points.length) * barWidth * 0.7;
        const pointY = yOf(point);
        parts.push(
          `<circle cx="${center + offset}" cy="${pointY}" r="2.4" fill="#ffffff" stroke="${color}" stroke-width="1.2"/>`,
        );
      });
    });

    const labelX = plotLeft + categoryIndex * bandWidth + bandWidth / 2;
    if (rotateLabels) {
      parts.push(
        `<text x="${labelX}" y="${plotBottom + 12}" transform="rotate(-32 ${labelX} ${plotBottom + 12})" text-anchor="end" font-family="${FONT}" font-size="9" fill="#333b4a">${esc(truncate(category, 20))}</text>`,
      );
    } else {
      parts.push(
        `<text x="${labelX}" y="${plotBottom + 18}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#333b4a">${esc(truncate(category, 20))}</text>`,
      );
    }
  });

  if (!categoryCount) {
    parts.push(
      `<text x="${plotLeft + plotWidth / 2}" y="${plotTop + plotHeight / 2}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#7a8394">-</text>`,
    );
  }

  // Axis label.
  const axisLabelY = plotTop + plotHeight / 2;
  parts.push(
    `<text x="18" y="${axisLabelY}" transform="rotate(-90 18 ${axisLabelY})" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#333b4a">${esc(labels.yLabel)}</text>`,
  );
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

// --------------------------------------------------------------- heatmap

export interface HeatmapRow {
  label: string;
  sub: string;
  values: (number | null)[];
}

export interface HeatmapLabels {
  title: string;
  low: string;
  high: string;
}

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${blue})`;
}

function heatColor(t: number): string {
  if (t <= 0.5) return lerpColor('#2166ac', '#f7f7f7', t * 2);
  return lerpColor('#f7f7f7', '#b2182b', (t - 0.5) * 2);
}

/** Delta Ct heatmap with sample rows and target columns. */
export function heatmapSvg(
  rows: HeatmapRow[],
  columns: string[],
  labels: HeatmapLabels,
): SvgDoc {
  const left = 150;
  const top = 66;
  const cellWidth = 82;
  const cellHeight = 24;
  const right = 24;
  const bottom = 66;
  const width = left + Math.max(1, columns.length) * cellWidth + right;
  const height = top + Math.max(1, rows.length) * cellHeight + bottom;

  const allValues: number[] = [];
  for (const row of rows) {
    for (const value of row.values) {
      if (value !== null && Number.isFinite(value)) allValues.push(value);
    }
  }
  let min = allValues.length ? Math.min(...allValues) : 0;
  let max = allValues.length ? Math.max(...allValues) : 1;
  if (max - min < 1e-6) {
    min -= 0.5;
    max += 0.5;
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="24" y="24" font-family="${FONT}" font-size="14" font-weight="700" fill="#151a24">${esc(labels.title)}</text>`,
  );

  columns.forEach((column, columnIndex) => {
    const x = left + columnIndex * cellWidth + cellWidth / 2;
    const y = top - 10;
    parts.push(
      `<text x="${x}" y="${y}" transform="rotate(-32 ${x} ${y})" text-anchor="start" font-family="${FONT}" font-size="9" fill="#333b4a">${esc(truncate(column, 14))}</text>`,
    );
  });

  rows.forEach((row, rowIndex) => {
    const y = top + rowIndex * cellHeight;
    const label = row.sub ? `${row.label} · ${row.sub}` : row.label;
    parts.push(
      `<text x="${left - 8}" y="${y + cellHeight / 2 + 3}" text-anchor="end" font-family="${FONT}" font-size="9" fill="#333b4a">${esc(truncate(label, 24))}</text>`,
    );
    columns.forEach((_, columnIndex) => {
      const value = row.values[columnIndex] ?? null;
      const x = left + columnIndex * cellWidth;
      let fill = '#eef1f6';
      let text = '';
      if (value !== null && Number.isFinite(value)) {
        const t = (value - min) / (max - min);
        fill = heatColor(t);
        text = value.toFixed(2);
      }
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellWidth - 1}" height="${cellHeight - 1}" fill="${fill}" stroke="#ffffff" stroke-width="1"/>`,
      );
      const t = value !== null && Number.isFinite(value) ? (value - min) / (max - min) : 0.5;
      const textColor = t > 0.28 && t < 0.72 ? '#1a1a1a' : '#ffffff';
      parts.push(
        `<text x="${x + (cellWidth - 1) / 2}" y="${y + cellHeight / 2 + 3}" text-anchor="middle" font-family="${FONT}" font-size="8.5" fill="${textColor}">${esc(text)}</text>`,
      );
    });
  });

  const legendY = height - 36;
  parts.push(
    `<defs><linearGradient id="qpcrHeat" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2166ac"/><stop offset="0.5" stop-color="#f7f7f7"/><stop offset="1" stop-color="#b2182b"/></linearGradient></defs>`,
  );
  parts.push(
    `<rect x="${left}" y="${legendY}" width="150" height="9" fill="url(#qpcrHeat)" stroke="#c9cfda" stroke-width="0.7"/>`,
  );
  parts.push(
    `<text x="${left}" y="${legendY + 22}" font-family="${FONT}" font-size="9" fill="#4a5262">${esc(labels.low)} ${formatTick(min)}</text>`,
  );
  parts.push(
    `<text x="${left + 150}" y="${legendY + 22}" text-anchor="end" font-family="${FONT}" font-size="9" fill="#4a5262">${formatTick(max)} ${esc(labels.high)}</text>`,
  );
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

// ------------------------------------------------------------- raster

/** Rasterize an SVG document to PNG bytes using a temporary canvas. */
export async function svgToPngBytes(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG rasterization failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
        'image/png',
      );
    });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
