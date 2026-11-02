// Densitometry: ROI integration on the inverted raw grayscale plane with local
// background subtraction, then loading-control / total-lane normalisation and
// per-group replicate statistics.

import { groupNames } from './detect';
import { globalBackground } from './image';
import type { BlotBand, BlotLane, BlotProject } from './types';
import { clamp } from './types';

export type BackgroundMode = BlotProject['backgroundMode'];

export interface BandMeasurement {
  laneId: string;
  bandId: string;
  laneIndex: number;
  bandIndex: number;
  laneName: string;
  sample: string;
  group: string;
  included: boolean;
  area: number;
  meanSignal: number;
  background: number;
  netVolume: number;
  clippedFraction: number;
  saturated: boolean;
  normalized: number;
  fold: number;
  groupMean: number;
  groupSd: number;
  groupSem: number;
  groupN: number;
}

export interface GroupStat {
  name: string;
  n: number;
  mean: number;
  sd: number;
  sem: number;
  values: number[];
  laneCount: number;
}

export interface QuantResult {
  rows: BandMeasurement[];
  groups: GroupStat[];
  controlMean: number;
  totalVolume: number;
  hasData: boolean;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

interface Roi {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** ROI rectangle from a lane centre and a band, in pixel coordinates. */
export function roiForBand(
  lane: BlotLane,
  band: BlotBand,
  width: number,
  height: number,
): Roi {
  const cx = lane.x * width;
  const halfW = Math.max(1, (band.width * width) / 2);
  const halfH = Math.max(1, (band.height * height) / 2);
  const cy = band.y * height;
  return {
    x0: clamp(Math.round(cx - halfW), 0, width - 1),
    y0: clamp(Math.round(cy - halfH), 0, height - 1),
    x1: clamp(Math.round(cx + halfW), 1, width),
    y1: clamp(Math.round(cy + halfH), 1, height),
  };
}

function ringBackground(
  gray: Float32Array,
  width: number,
  height: number,
  roi: Roi,
): number {
  const ring = Math.max(1, Math.round(Math.min(roi.x1 - roi.x0, roi.y1 - roi.y0) * 0.18));
  const values: number[] = [];
  for (let y = roi.y0; y < roi.y1; y++) {
    for (let x = roi.x0; x < roi.x1; x++) {
      if (
        x < roi.x0 + ring ||
        x >= roi.x1 - ring ||
        y < roi.y0 + ring ||
        y >= roi.y1 - ring
      ) {
        values.push(1 - gray[y * width + x]);
      }
    }
  }
  return median(values);
}

function laneBackground(
  gray: Float32Array,
  width: number,
  height: number,
  lane: BlotLane,
  roi: Roi,
): number {
  const x0 = clamp(Math.round((lane.x - lane.width / 2) * width), 0, width - 1);
  const x1 = clamp(Math.round((lane.x + lane.width / 2) * width), x0 + 1, width);
  const values: number[] = [];
  const step = Math.max(1, Math.floor((x1 - x0) / 48));
  for (let y = 0; y < height; y++) {
    if (y >= roi.y0 && y < roi.y1) continue;
    for (let x = x0; x < x1; x += step) values.push(1 - gray[y * width + x]);
  }
  return median(values);
}

export interface MeasureContext {
  gray: Float32Array;
  width: number;
  height: number;
  project: BlotProject;
  globalBg: number;
}

export function measureBand(
  lane: BlotLane,
  band: BlotBand,
  laneIndex: number,
  bandIndex: number,
  context: MeasureContext,
): BandMeasurement {
  const { gray, width, height, project, globalBg } = context;
  const roi = roiForBand(lane, band, width, height);
  const area = Math.max(0, (roi.x1 - roi.x0) * (roi.y1 - roi.y0));
  let sum = 0;
  let clipped = 0;
  for (let y = roi.y0; y < roi.y1; y++) {
    for (let x = roi.x0; x < roi.x1; x++) {
      const v = gray[y * width + x];
      sum += 1 - v;
      if (v <= 0.004 || v >= 0.996) clipped++;
    }
  }
  const mode = project.backgroundMode;
  const background =
    mode === 'manual'
      ? clamp(project.manualBackground, 0, 1)
      : mode === 'lane'
        ? laneBackground(gray, width, height, lane, roi)
        : mode === 'global'
          ? globalBg
          : ringBackground(gray, width, height, roi);
  let net = 0;
  for (let y = roi.y0; y < roi.y1; y++) {
    for (let x = roi.x0; x < roi.x1; x++) {
      const signal = 1 - gray[y * width + x];
      const corrected = signal - background;
      if (corrected > 0) net += corrected;
    }
  }
  const clippedFraction = clipped / Math.max(1, area);
  return {
    laneId: lane.id,
    bandId: band.id,
    laneIndex,
    bandIndex,
    laneName: lane.name,
    sample: lane.sample || lane.name,
    group: lane.group.trim(),
    included: !lane.excluded && !band.excluded,
    area,
    meanSignal: sum / Math.max(1, area),
    background,
    netVolume: net,
    clippedFraction,
    saturated: clippedFraction > 0.005,
    normalized: 0,
    fold: 0,
    groupMean: 0,
    groupSd: 0,
    groupSem: 0,
    groupN: 0,
  };
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) sq += (v - m) ** 2;
  return Math.sqrt(sq / (values.length - 1));
}

/** Measure every band, apply the selected normalisation and fold change, then
 *  attach per-group statistics to each row. */
export function quantify(project: BlotProject, contextWithoutBg: Omit<MeasureContext, 'globalBg'>): QuantResult {
  const { gray, width, height } = contextWithoutBg;
  const globalBg = globalBackground(gray, width, height);
  const context: MeasureContext = { ...contextWithoutBg, globalBg };
  const rows: BandMeasurement[] = [];
  project.lanes.forEach((lane, laneIndex) => {
    lane.bands.forEach((band, bandIndex) => {
      rows.push(measureBand(lane, band, laneIndex, bandIndex, context));
    });
  });

  const includedRows = rows.filter((row) => row.included);
  const laneTotals = new Map<string, number>();
  for (const row of includedRows) {
    laneTotals.set(row.laneId, (laneTotals.get(row.laneId) ?? 0) + row.netVolume);
  }

  let loadingReference = 1;
  if (project.normalization.mode === 'loading') {
    const laneId = project.normalization.loadingLaneId;
    if (laneId) {
      const laneRows = includedRows.filter((row) => row.laneId === laneId);
      loadingReference = laneRows.reduce((sum, row) => sum + row.netVolume, 0);
    }
    if (!(loadingReference > 0)) loadingReference = 1;
  }

  const normalizedMap = new Map<string, number>();
  for (const row of rows) {
    let value = row.netVolume;
    if (project.normalization.mode === 'loading') {
      value = row.netVolume / loadingReference;
    } else if (project.normalization.mode === 'total') {
      const total = laneTotals.get(row.laneId) ?? 0;
      value = total > 0 ? row.netVolume / total : 0;
    }
    normalizedMap.set(row.bandId, value);
    row.normalized = row.included ? value : 0;
  }

  const controlGroup = project.normalization.controlGroup.trim();
  const controlValues = includedRows
    .filter((row) => row.group === controlGroup)
    .map((row) => normalizedMap.get(row.bandId) ?? 0);
  const controlMean = mean(controlValues);

  for (const row of rows) {
    const normalized = normalizedMap.get(row.bandId) ?? 0;
    row.normalized = row.included ? normalized : 0;
    row.fold = row.included && controlMean > 0 ? normalized / controlMean : 0;
  }

  const groups: GroupStat[] = [];
  for (const name of groupNames(project.lanes)) {
    const groupRows = includedRows.filter((row) => row.group === name);
    const values = groupRows.map((row) => normalizedMap.get(row.bandId) ?? 0);
    const m = mean(values);
    const sd = sampleSd(values);
    const laneCount = project.lanes.filter((lane) => lane.group.trim() === name && !lane.excluded).length;
    groups.push({
      name,
      n: values.length,
      mean: m,
      sd,
      sem: values.length ? sd / Math.sqrt(values.length) : 0,
      values,
      laneCount,
    });
  }

  for (const row of rows) {
    const group = groups.find((g) => g.name === row.group);
    row.groupMean = group?.mean ?? 0;
    row.groupSd = group?.sd ?? 0;
    row.groupSem = group?.sem ?? 0;
    row.groupN = group?.n ?? 0;
  }

  const totalVolume = includedRows.reduce((sum, row) => sum + row.netVolume, 0);
  return {
    rows,
    groups,
    controlMean,
    totalVolume,
    hasData: includedRows.length > 0,
  };
}

export function metricValue(row: BandMeasurement, metric: BlotProject['chartMetric']): number {
  return metric === 'fold' ? row.fold : row.normalized;
}

export function groupMetricValues(
  group: GroupStat,
  rows: BandMeasurement[],
  metric: BlotProject['chartMetric'],
): number[] {
  return rows
    .filter((row) => row.included && row.group === group.name)
    .map((row) => metricValue(row, metric));
}

/** Group mean and SEM in the metric chosen for the chart. */
export function groupMetricStats(
  group: GroupStat,
  rows: BandMeasurement[],
  metric: BlotProject['chartMetric'],
): { mean: number; sem: number; values: number[] } {
  const values = groupMetricValues(group, rows, metric);
  const m = mean(values);
  const sd = sampleSd(values);
  return { mean: m, sem: values.length ? sd / Math.sqrt(values.length) : 0, values };
}
