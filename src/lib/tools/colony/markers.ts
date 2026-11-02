// Marker bookkeeping: statistics, histogram bins, numbering and CSV output.
import type { ColonyMarker, ColonyStats } from './types';

export interface MarkerNumbering {
  /** Stable marker id -> visible number (included markers only). */
  labels: Map<number, number>;
}

/** Number included markers top-to-bottom, left-to-right for the overlay. */
export function numberMarkers(markers: ColonyMarker[]): MarkerNumbering {
  const included = markers.filter((m) => m.included).sort((a, b) => a.y - b.y || a.x - b.x);
  const labels = new Map<number, number>();
  included.forEach((marker, index) => labels.set(marker.id, index + 1));
  return { labels };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeStats(markers: ColonyMarker[]): ColonyStats {
  const included = markers.filter((m) => m.included);
  const areas = included.map((m) => m.area);
  const intensities = included.map((m) => m.meanIntensity);
  const circularities = included.map((m) => m.circularity);
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return {
    total: markers.length,
    included: included.length,
    excluded: markers.length - included.length,
    manual: markers.filter((m) => m.source === 'manual').length,
    meanArea: mean(areas),
    medianArea: median(areas),
    meanIntensity: mean(intensities),
    meanCircularity: mean(circularities),
  };
}

export interface ColonyClassCounts {
  blue: number;
  white: number;
  unclassified: number;
}

/** Count blue, white and unclassified colonies among included markers. */
export function countClasses(markers: ColonyMarker[]): ColonyClassCounts {
  const included = markers.filter((marker) => marker.included);
  return {
    blue: included.filter((marker) => marker.colonyClass === 'blue').length,
    white: included.filter((marker) => marker.colonyClass === 'white').length,
    unclassified: included.filter(
      (marker) => marker.colonyClass !== 'blue' && marker.colonyClass !== 'white'
    ).length,
  };
}

export interface Histogram {
  counts: number[];
  min: number;
  max: number;
  binWidth: number;
  peak: number;
  total: number;
}

/** Fixed-bin area histogram used by the SVG chart. */
export function buildHistogram(areas: number[], binCount = 18): Histogram {
  if (!areas.length) {
    return { counts: [], min: 0, max: 0, binWidth: 0, peak: 0, total: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of areas) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  }
  const bins = Math.max(4, Math.min(binCount, Math.ceil(Math.sqrt(areas.length)) + 4));
  const binWidth = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const value of areas) {
    let index = Math.floor((value - min) / binWidth);
    if (index < 0) index = 0;
    if (index >= bins) index = bins - 1;
    counts[index]++;
  }
  return { counts, min, max, binWidth, peak: Math.max(1, ...counts), total: areas.length };
}

/**
 * One CSV row per marker, including excluded ones. Class columns are appended
 * for current marker records; legacy fixtures without class data keep the
 * original ten-column shape for backward compatibility.
 */
export function markersToCsv(markers: ColonyMarker[], numbering: MarkerNumbering): string {
  const withClass = markers.some((marker) => marker.colonyClass !== undefined);
  const header = withClass
    ? 'id,number,x,y,area_px2,radius_px,mean_intensity,circularity,included,source,class,mean_r,mean_g,mean_b,hue,saturation,class_manual'
    : 'id,number,x,y,area_px2,radius_px,mean_intensity,circularity,included,source';
  const rows = markers.map((marker) => {
    const number = numbering.labels.get(marker.id) ?? '';
    const values: Array<string | number> = [
      marker.id,
      number,
      round(marker.x, 2),
      round(marker.y, 2),
      round(marker.area, 2),
      round(marker.radius, 2),
      round(marker.meanIntensity, 2),
      round(marker.circularity, 4),
      marker.included ? 1 : 0,
      marker.source,
    ];
    if (withClass) {
      values.push(
        marker.colonyClass,
        round(marker.meanR, 1),
        round(marker.meanG, 1),
        round(marker.meanB, 1),
        round(marker.hue, 1),
        round(marker.saturation, 3),
        marker.classManual ? 1 : 0
      );
    }
    return values.join(',');
  });
  return [header, ...rows].join('\n');
}

function round(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

/** CFU per mL from included count, dilution factor and plated volume (mL). */
export function computeCfu(count: number, dilutionFactor: number, platedVolume: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(dilutionFactor) || !Number.isFinite(platedVolume)) return null;
  if (dilutionFactor <= 0 || platedVolume <= 0) return null;
  return (count * dilutionFactor) / platedVolume;
}

export interface Interval {
  low: number;
  high: number;
}

// ------------------------------------------------- Poisson 95% interval
// Exact Garwood interval: lower = 0.5 * chi2(0.025, 2k), upper =
// 0.5 * chi2(0.975, 2k + 2). The chi-square quantiles are obtained from the
// regularised incomplete gamma function so the bounds stay exact for the
// colony counts typically seen on a plate.

function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (let j = 0; j < coefficients.length; j++) {
    y += 1;
    series += coefficients[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n < 200; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaContinuedFraction(a, x);
}

function chiSquareCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(df / 2, x / 2);
}

function chiSquareQuantile(p: number, df: number): number {
  if (df <= 0) return 0;
  let low = 0;
  let high = Math.max(1, df + 10 * Math.sqrt(2 * df) + 20);
  while (chiSquareCdf(high, df) < p) high *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (chiSquareCdf(mid, df) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Exact Poisson 95% confidence interval for a colony count. */
export function poissonCi95(count: number): Interval {
  const k = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const low = k === 0 ? 0 : 0.5 * chiSquareQuantile(0.025, 2 * k);
  const high = 0.5 * chiSquareQuantile(0.975, 2 * k + 2);
  return { low, high };
}

/** Scale a Poisson count interval to CFU/mL with the same dilution factor. */
export function cfuCi95(count: number, dilutionFactor: number, platedVolume: number): Interval | null {
  if (!Number.isFinite(dilutionFactor) || !Number.isFinite(platedVolume)) return null;
  if (dilutionFactor <= 0 || platedVolume <= 0) return null;
  const ci = poissonCi95(count);
  const factor = dilutionFactor / platedVolume;
  return { low: ci.low * factor, high: ci.high * factor };
}

export function formatInterval(interval: Interval | null): string {
  if (!interval) return '—';
  return `${formatScientific(interval.low)} – ${formatScientific(interval.high)}`;
}

export interface StatisticsRow {
  label: string;
  count: number;
  countLow: number;
  countHigh: number;
  blue: number;
  white: number;
  unclassified: number;
  cfu: number | null;
  cfuLow: number | null;
  cfuHigh: number | null;
}

/** Statistics CSV used by the single-plate and batch exports. */
export function statisticsToCsv(rows: StatisticsRow[]): string {
  const header =
    'label,count,count_ci95_low,count_ci95_high,blue,white,unclassified,cfu_per_ml,cfu_ci95_low,cfu_ci95_high';
  const lines = rows.map((row) =>
    [
      csvCell(row.label),
      round(row.count, 0),
      round(row.countLow, 2),
      round(row.countHigh, 2),
      row.blue,
      row.white,
      row.unclassified,
      round(row.cfu, 4),
      round(row.cfuLow, 4),
      round(row.cfuHigh, 4),
    ].join(','),
  );
  return [header, ...lines].join('\n');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatScientific(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value.toExponential(2).replace('e+', ' × 10^').replace('e-', ' × 10^-');
}

export function formatArea(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 10000) return Math.round(value).toLocaleString('en-US');
  return value.toFixed(value >= 100 ? 0 : 1);
}

let idCounter = 1;

/** Ids stay unique across detection runs so manual markers keep their labels. */
export function nextMarkerId(markers: ColonyMarker[]): number {
  let max = idCounter - 1;
  for (const marker of markers) if (marker.id > max) max = marker.id;
  idCounter = max + 1;
  return idCounter++;
}
