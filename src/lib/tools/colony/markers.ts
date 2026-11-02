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

/** One CSV row per marker, including excluded ones. */
export function markersToCsv(markers: ColonyMarker[], numbering: MarkerNumbering): string {
  const header = 'id,number,x,y,area_px2,radius_px,mean_intensity,circularity,included,source';
  const rows = markers.map((marker) => {
    const number = numbering.labels.get(marker.id) ?? '';
    return [
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
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

function round(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

/** CFU per mL from included count, dilution factor and plated volume (mL). */
export function computeCfu(count: number, dilutionFactor: number, platedVolume: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(dilutionFactor) || !Number.isFinite(platedVolume)) return null;
  if (dilutionFactor <= 0 || platedVolume <= 0) return null;
  return (count * dilutionFactor) / platedVolume;
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
