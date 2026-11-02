// QC, Delta Ct / Delta Delta Ct analysis, standard-curve fitting and chart data.
import type { QpcrSettings, Well } from './types';
import type { ChartData } from './chart';
import {
  efficiencyFromSlope,
  linearRegression,
  mean,
  sampleSd,
  sem,
  welchTTest,
} from './stats';

export type QcFlag =
  | 'missingCt'
  | 'highCt'
  | 'replicateSd'
  | 'outlier'
  | 'duplicateWell'
  | 'invalid';

export interface WellQc {
  flags: QcFlag[];
  replicateN: number;
  replicateMean: number | null;
  replicateSd: number | null;
}

export function normKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface InfoItem {
  key: string;
  label: string;
}

function uniqueInfo(wells: Well[], pick: (well: Well) => string): InfoItem[] {
  const map = new Map<string, string>();
  for (const well of wells) {
    const raw = pick(well).trim();
    const key = normKey(raw);
    if (key && !map.has(key)) map.set(key, raw);
  }
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function listTargets(wells: Well[]): InfoItem[] {
  return uniqueInfo(wells, (w) => w.target);
}

export function listSamples(wells: Well[]): InfoItem[] {
  return uniqueInfo(wells, (w) => w.sample);
}

export function listGroups(wells: Well[]): InfoItem[] {
  return uniqueInfo(wells, (w) => w.group);
}

export function resolveInfo(label: string, items: InfoItem[]): InfoItem | null {
  const key = normKey(label);
  if (!key) return null;
  return items.find((item) => item.key === key) ?? null;
}

export function isStandardWell(well: Well): boolean {
  return well.quantity !== null;
}

export function computeQc(wells: Well[], settings: QpcrSettings): Record<string, WellQc> {
  const highCt = Number.isFinite(settings.highCt) ? settings.highCt : Number.POSITIVE_INFINITY;
  const sdLimit = Number.isFinite(settings.sdLimit) ? settings.sdLimit : Number.POSITIVE_INFINITY;
  const outlierLimit = Number.isFinite(settings.outlierLimit)
    ? settings.outlierLimit
    : Number.POSITIVE_INFINITY;
  const replicateGroups = new Map<string, Well[]>();
  const wellCounts = new Map<string, number>();

  for (const well of wells) {
    const sampleKey = normKey(well.sample);
    const targetKey = normKey(well.target);
    if (sampleKey && targetKey) {
      const key = `${sampleKey}\u0000${targetKey}`;
      const list = replicateGroups.get(key);
      if (list) list.push(well);
      else replicateGroups.set(key, [well]);
    }
    const wellKey = normKey(well.well);
    if (wellKey) wellCounts.set(wellKey, (wellCounts.get(wellKey) ?? 0) + 1);
  }

  const replicateStats = new Map<string, { n: number; mean: number | null; sd: number | null }>();
  for (const [key, list] of replicateGroups) {
    const values = list.filter((w) => w.ct !== null).map((w) => w.ct as number);
    replicateStats.set(key, {
      n: values.length,
      mean: values.length ? mean(values) : null,
      sd: sampleSd(values),
    });
  }

  // Outlier flags use the replicate mean as requested. When one extreme value
  // pulls the mean so far that every replicate exceeds the limit, only the
  // farthest well is flagged, otherwise excluding outliers would erase the
  // whole group. Two replicates are not enough to call an outlier.
  const outlierWells = new Set<string>();
  for (const list of replicateGroups.values()) {
    const measured = list.filter((w) => w.ct !== null);
    if (measured.length < 3) continue;
    const center = mean(measured.map((w) => w.ct as number));
    const candidates = measured.filter((w) => Math.abs((w.ct as number) - center) > outlierLimit);
    if (!candidates.length) continue;
    if (candidates.length === measured.length) {
      let farthest = candidates[0];
      for (const candidate of candidates) {
        if (Math.abs((candidate.ct as number) - center) > Math.abs((farthest.ct as number) - center)) {
          farthest = candidate;
        }
      }
      outlierWells.add(farthest.id);
    } else {
      for (const candidate of candidates) outlierWells.add(candidate.id);
    }
  }

  const out: Record<string, WellQc> = {};
  for (const well of wells) {
    const flags: QcFlag[] = [];
    const sampleKey = normKey(well.sample);
    const targetKey = normKey(well.target);
    const wellKey = normKey(well.well);
    if (!sampleKey || !targetKey) flags.push('invalid');
    if (well.ct === null) flags.push('missingCt');
    else if (well.ct > highCt) flags.push('highCt');

    const groupKey = `${sampleKey}\u0000${targetKey}`;
    const stats = replicateStats.get(groupKey);
    if (stats && well.ct !== null) {
      if (stats.n >= 2 && stats.sd !== null && stats.sd > sdLimit) {
        flags.push('replicateSd');
      }
      if (outlierWells.has(well.id)) flags.push('outlier');
    }
    if (wellKey && (wellCounts.get(wellKey) ?? 0) > 1) flags.push('duplicateWell');

    out[well.id] = {
      flags,
      replicateN: stats?.n ?? 0,
      replicateMean: stats?.mean ?? null,
      replicateSd: stats?.sd ?? null,
    };
  }
  return out;
}

export function usableWell(
  well: Well,
  qc: WellQc | undefined,
  settings: QpcrSettings,
): boolean {
  if (!well.include) return false;
  if (!well.sample.trim() || !well.target.trim()) return false;
  if (well.ct === null) return false;
  if (settings.excludeOutliers && qc?.flags.includes('outlier')) return false;
  return true;
}

function efficiencyForTarget(
  targetKey: string,
  wells: Well[],
  settings: QpcrSettings,
): number {
  const values = wells
    .filter((w) => normKey(w.target) === targetKey && w.efficiency !== null)
    .map((w) => w.efficiency as number);
  if (values.length) return mean(values);
  const pct = Number.isFinite(settings.defaultEfficiencyPct)
    ? settings.defaultEfficiencyPct
    : 100;
  return Math.max(0.01, pct / 100);
}

// --------------------------------------------------------------- Delta Ct

export interface DdctReplicate {
  sample: string;
  sampleKey: string;
  target: string;
  targetKey: string;
  group: string;
  category: string;
  replicate: number | null;
  well: string;
  ct: number;
  refCt: number;
  dCt: number;
  ddCt: number;
  fold: number;
  isControl: boolean;
}

export interface DdctSample {
  sample: string;
  sampleKey: string;
  target: string;
  targetKey: string;
  group: string;
  category: string;
  n: number;
  meanCt: number;
  sdCt: number | null;
  dCt: number;
  ddCt: number;
  efficiency: number;
  fold: number;
  foldSd: number | null;
  foldSem: number | null;
  foldValues: number[];
  isControl: boolean;
}

export interface DdctGroup {
  category: string;
  categoryKey: string;
  target: string;
  targetKey: string;
  nSamples: number;
  meanFold: number;
  sdFold: number | null;
  semFold: number | null;
  meanDCt: number;
  sdDCt: number | null;
  pValue: number | null;
  foldValues: number[];
  isControl: boolean;
}

export interface DdctMatrixRow {
  sample: string;
  sampleKey: string;
  group: string;
  category: string;
  isControl: boolean;
  refCt: number | null;
  dCt: Record<string, number | null>;
  ddCt: Record<string, number | null>;
}

export interface DdctAnalysis {
  reference: InfoItem | null;
  targets: InfoItem[];
  samples: InfoItem[];
  groups: InfoItem[];
  hasGroups: boolean;
  matrix: DdctMatrixRow[];
  sampleResults: DdctSample[];
  groupResults: DdctGroup[];
  replicates: DdctReplicate[];
  controlMeanDCt: Record<string, number | null>;
  controlLabel: string;
  controlSampleKeys: string[];
  missingReference: boolean;
  missingControl: boolean;
  referenceFallback: boolean;
  controlFallback: boolean;
}

interface SampleBucket {
  sample: string;
  sampleKey: string;
  group: string;
  category: string;
  isControl: boolean;
  refWells: Well[];
  targetWells: Map<string, Well[]>;
}

export function computeDdct(
  wells: Well[],
  settings: QpcrSettings,
  qc: Record<string, WellQc>,
): DdctAnalysis {
  // Standards are calibration wells: they must not appear as samples, groups or
  // selectable reference targets in the Delta Delta Ct analysis.
  const analysisWells = wells.filter((well) => !isStandardWell(well));
  const targets = listTargets(analysisWells);
  const samples = listSamples(analysisWells);
  const groups = listGroups(analysisWells);
  const hasGroups = groups.length > 0;
  const reference = resolveInfo(settings.referenceTarget, targets) ?? targets[0] ?? null;
  const referenceFallback =
    !!reference && resolveInfo(settings.referenceTarget, targets) === null;

  const groupLabelByKey = new Map(groups.map((g) => [g.key, g.label]));
  const sampleLabelByKey = new Map(samples.map((s) => [s.key, s.label]));
  const targetLabelByKey = new Map(targets.map((t) => [t.key, t.label]));

  const buckets = new Map<string, SampleBucket>();
  for (const well of wells) {
    if (!usableWell(well, qc[well.id], settings)) continue;
    if (isStandardWell(well)) continue;
    const sampleKey = normKey(well.sample);
    const targetKey = normKey(well.target);
    let bucket = buckets.get(sampleKey);
    if (!bucket) {
      const groupKey = normKey(well.group);
      const groupLabel = groupKey ? (groupLabelByKey.get(groupKey) ?? well.group.trim()) : '';
      bucket = {
        sample: sampleLabelByKey.get(sampleKey) ?? well.sample.trim(),
        sampleKey,
        group: groupLabel,
        category: hasGroups && groupLabel ? groupLabel : (sampleLabelByKey.get(sampleKey) ?? well.sample.trim()),
        isControl: false,
        refWells: [],
        targetWells: new Map(),
      };
      buckets.set(sampleKey, bucket);
    }
    if (reference && targetKey === reference.key) {
      bucket.refWells.push(well);
    } else {
      const list = bucket.targetWells.get(targetKey);
      if (list) list.push(well);
      else bucket.targetWells.set(targetKey, [well]);
    }
  }

  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    const ba = buckets.get(a)!;
    const bb = buckets.get(b)!;
    return (
      ba.category.localeCompare(bb.category, undefined, { sensitivity: 'base' }) ||
      ba.sample.localeCompare(bb.sample, undefined, { sensitivity: 'base' })
    );
  });

  let controlKeys = new Set<string>();
  let controlLabel = '';
  let controlFallback = true;
  if (hasGroups && settings.controlGroup.trim()) {
    const groupKey = normKey(settings.controlGroup);
    const group = groups.find((g) => g.key === groupKey);
    if (group) {
      const keys = new Set(
        orderedKeys.filter((key) => normKey(buckets.get(key)!.group) === groupKey),
      );
      if (keys.size) {
        controlKeys = keys;
        controlLabel = group.label;
        controlFallback = false;
      }
    }
  }
  if (!controlKeys.size && settings.controlSample.trim()) {
    const sample = samples.find((s) => s.key === normKey(settings.controlSample));
    if (sample && buckets.has(sample.key)) {
      controlKeys = new Set([sample.key]);
      controlLabel = sample.label;
      controlFallback = false;
    }
  }
  if (!controlKeys.size) {
    const first = orderedKeys[0];
    if (first) {
      controlKeys = new Set([first]);
      controlLabel = buckets.get(first)!.sample;
    }
    controlFallback = true;
  }
  for (const key of controlKeys) {
    const bucket = buckets.get(key);
    if (bucket) bucket.isControl = true;
  }

  const refCtBySample = new Map<string, number | null>();
  for (const key of orderedKeys) {
    const bucket = buckets.get(key)!;
    const values = bucket.refWells.map((w) => w.ct as number);
    refCtBySample.set(key, values.length ? mean(values) : null);
  }
  const referenceUsableInControl =
    !!reference &&
    [...controlKeys].some((key) => (refCtBySample.get(key) ?? null) !== null);

  const controlMeanDCt: Record<string, number | null> = {};
  for (const target of targets) {
    if (reference && target.key === reference.key) {
      controlMeanDCt[target.key] = 0;
      continue;
    }
    const values: number[] = [];
    for (const key of controlKeys) {
      const bucket = buckets.get(key);
      const refCt = refCtBySample.get(key);
      if (!bucket || refCt === null || refCt === undefined) continue;
      const targetWells = bucket.targetWells.get(target.key);
      if (!targetWells?.length) continue;
      const ctValues = targetWells.map((w) => w.ct as number);
      values.push(mean(ctValues) - refCt);
    }
    controlMeanDCt[target.key] = values.length ? mean(values) : null;
  }

  const matrix: DdctMatrixRow[] = [];
  const sampleResults: DdctSample[] = [];
  const replicates: DdctReplicate[] = [];

  for (const key of orderedKeys) {
    const bucket = buckets.get(key)!;
    const refCt = refCtBySample.get(key) ?? null;
    const dCt: Record<string, number | null> = {};
    const ddCt: Record<string, number | null> = {};

    for (const target of targets) {
      let value: number | null = null;
      if (reference && target.key === reference.key) {
        value = refCt === null ? null : 0;
      } else if (refCt !== null) {
        const list = bucket.targetWells.get(target.key);
        if (list?.length) value = mean(list.map((w) => w.ct as number)) - refCt;
      }
      dCt[target.key] = value;
      const control = controlMeanDCt[target.key];
      ddCt[target.key] = value !== null && control !== null ? value - control : null;
    }

    matrix.push({
      sample: bucket.sample,
      sampleKey: bucket.sampleKey,
      group: bucket.group,
      category: bucket.category,
      isControl: bucket.isControl,
      refCt,
      dCt,
      ddCt,
    });

    if (refCt === null) continue;
    for (const target of targets) {
      if (reference && target.key === reference.key) continue;
      const targetWells = bucket.targetWells.get(target.key);
      const controlMean = controlMeanDCt[target.key];
      if (!targetWells?.length || controlMean === null) continue;

      const ctValues = targetWells.map((w) => w.ct as number);
      const meanCt = mean(ctValues);
      const sdCt = sampleSd(ctValues);
      const dCtValue = meanCt - refCt;
      const ddCtValue = dCtValue - controlMean;
      const efficiency = efficiencyForTarget(target.key, wells, settings);
      const base = settings.efficiencyCorrection ? 1 + efficiency : 2;
      const foldValues = targetWells.map((w) => base ** -(w.ct! - refCt - controlMean));
      const fold = mean(foldValues);

      sampleResults.push({
        sample: bucket.sample,
        sampleKey: bucket.sampleKey,
        target: targetLabelByKey.get(target.key) ?? target.label,
        targetKey: target.key,
        group: bucket.group,
        category: bucket.category,
        n: targetWells.length,
        meanCt,
        sdCt,
        dCt: dCtValue,
        ddCt: ddCtValue,
        efficiency,
        fold,
        foldSd: sampleSd(foldValues),
        foldSem: sem(foldValues),
        foldValues,
        isControl: bucket.isControl,
      });

      for (const well of targetWells) {
        const ct = well.ct as number;
        const repDCt = ct - refCt;
        const repDDCt = repDCt - controlMean;
        replicates.push({
          sample: bucket.sample,
          sampleKey: bucket.sampleKey,
          target: targetLabelByKey.get(target.key) ?? target.label,
          targetKey: target.key,
          group: bucket.group,
          category: bucket.category,
          replicate: well.replicate,
          well: well.well,
          ct,
          refCt,
          dCt: repDCt,
          ddCt: repDDCt,
          fold: base ** -repDDCt,
          isControl: bucket.isControl,
        });
      }
    }
  }

  sampleResults.sort(
    (a, b) =>
      a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) ||
      a.sample.localeCompare(b.sample, undefined, { sensitivity: 'base' }) ||
      a.target.localeCompare(b.target, undefined, { sensitivity: 'base' }),
  );
  replicates.sort(
    (a, b) =>
      a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) ||
      a.sample.localeCompare(b.sample, undefined, { sensitivity: 'base' }) ||
      a.target.localeCompare(b.target, undefined, { sensitivity: 'base' }) ||
      (a.replicate ?? 0) - (b.replicate ?? 0),
  );

  // Group-level summaries and Welch tests against the control samples.
  const groupResults: DdctGroup[] = [];
  const categoryOrder: string[] = [];
  for (const row of matrix) {
    if (!categoryOrder.includes(row.category)) categoryOrder.push(row.category);
  }
  const resolvedTargets = targets.filter((t) => !reference || t.key !== reference.key);
  for (const category of categoryOrder) {
    const categoryKey = normKey(category);
    const controlValuesByTarget = new Map<string, number[]>();
    for (const target of resolvedTargets) {
      const values = matrix
        .filter((row) => row.isControl && row.dCt[target.key] !== null)
        .map((row) => row.dCt[target.key] as number);
      controlValuesByTarget.set(target.key, values);
    }
    for (const target of resolvedTargets) {
      const rows = sampleResults.filter(
        (r) => r.category === category && r.targetKey === target.key,
      );
      if (!rows.length) continue;
      const foldValues = rows.map((r) => r.fold);
      const dCtValues = rows.map((r) => r.dCt);
      const isControl = rows.every((r) => r.isControl);
      const controlValues = controlValuesByTarget.get(target.key) ?? [];
      const test =
        !isControl && controlValues.length >= 2 && dCtValues.length >= 2
          ? welchTTest(dCtValues, controlValues)
          : null;
      groupResults.push({
        category,
        categoryKey,
        target: target.label,
        targetKey: target.key,
        nSamples: rows.length,
        meanFold: mean(foldValues),
        sdFold: sampleSd(foldValues),
        semFold: sem(foldValues),
        meanDCt: mean(dCtValues),
        sdDCt: sampleSd(dCtValues),
        pValue: test?.p ?? null,
        foldValues,
        isControl,
      });
    }
  }

  return {
    reference,
    targets,
    samples,
    groups,
    hasGroups,
    matrix,
    sampleResults,
    groupResults,
    replicates,
    controlMeanDCt,
    controlLabel,
    controlSampleKeys: [...controlKeys],
    missingReference: !reference || targets.length < 2 || !referenceUsableInControl,
    missingControl: !controlKeys.size,
    referenceFallback,
    controlFallback,
  };
}

// ----------------------------------------------------------- chart data

export function chartDataFromDdct(analysis: DdctAnalysis): ChartData | null {
  if (!analysis.groupResults.length) return null;
  const categories: string[] = [];
  for (const row of analysis.groupResults) {
    if (!categories.includes(row.category)) categories.push(row.category);
  }
  const seriesTargets: InfoItem[] = [];
  for (const row of analysis.groupResults) {
    if (!seriesTargets.some((t) => t.key === row.targetKey)) {
      seriesTargets.push({ key: row.targetKey, label: row.target });
    }
  }
  const series = seriesTargets.map((target) => ({
    name: target.label,
    bars: categories.map((category) => {
      const row = analysis.groupResults.find(
        (r) => r.category === category && r.targetKey === target.key,
      );
      if (!row) return null;
      return {
        value: row.meanFold,
        points: row.foldValues,
        sem: row.semFold,
        logSem: null,
        n: row.nSamples,
      };
    }),
  }));
  return { categories, series, log: false };
}

// ------------------------------------------------------- standard curve

export type CurveReason = 'ok' | 'noPoints' | 'fewPoints' | 'noVariance' | 'positiveSlope';

export interface CurveFit {
  targetKey: string;
  target: string;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
  efficiency: number | null;
  n: number;
  xMin: number | null;
  xMax: number | null;
  valid: boolean;
  reason: CurveReason;
}

export interface StandardSample {
  sample: string;
  sampleKey: string;
  target: string;
  targetKey: string;
  group: string;
  category: string;
  n: number;
  meanCt: number;
  log10Quantity: number;
  quantity: number;
  sdLog: number | null;
  semLog: number | null;
  quantityValues: number[];
}

export interface StandardAnalysis {
  fits: CurveFit[];
  samples: StandardSample[];
  missingStandards: boolean;
}

function standardX(quantity: number, isLog10: boolean): number | null {
  if (isLog10) return Number.isFinite(quantity) ? quantity : null;
  if (quantity <= 0) return null;
  return Math.log10(quantity);
}

export function computeStandard(
  wells: Well[],
  settings: QpcrSettings,
  qc: Record<string, WellQc>,
): StandardAnalysis {
  const targets = listTargets(wells);
  const hasGroups = listGroups(wells).length > 0;
  const groupLabelByKey = new Map(listGroups(wells).map((g) => [g.key, g.label]));
  const sampleLabelByKey = new Map(listSamples(wells).map((s) => [s.key, s.label]));

  const pointsByTarget = new Map<string, { x: number; y: number }[]>();
  let totalStandardPoints = 0;
  for (const well of wells) {
    if (!usableWell(well, qc[well.id], settings)) continue;
    if (well.quantity === null || well.ct === null) continue;
    const x = standardX(well.quantity, settings.quantityIsLog10);
    if (x === null) continue;
    const key = normKey(well.target);
    if (!key) continue;
    const list = pointsByTarget.get(key);
    if (list) list.push({ x, y: well.ct });
    else pointsByTarget.set(key, [{ x, y: well.ct }]);
    totalStandardPoints++;
  }

  const fits: CurveFit[] = [];
  const fitByTarget = new Map<string, CurveFit>();
  for (const target of targets) {
    const points = pointsByTarget.get(target.key);
    if (!points?.length) continue;
    let fit: CurveFit;
    if (points.length < 2) {
      fit = {
        targetKey: target.key,
        target: target.label,
        slope: null,
        intercept: null,
        r2: null,
        efficiency: null,
        n: points.length,
        xMin: null,
        xMax: null,
        valid: false,
        reason: 'fewPoints',
      };
    } else {
      const regression = linearRegression(points);
      if (!regression) {
        fit = {
          targetKey: target.key,
          target: target.label,
          slope: null,
          intercept: null,
          r2: null,
          efficiency: null,
          n: points.length,
          xMin: Math.min(...points.map((p) => p.x)),
          xMax: Math.max(...points.map((p) => p.x)),
          valid: false,
          reason: 'noVariance',
        };
      } else {
        const efficiency = efficiencyFromSlope(regression.slope);
        const valid = regression.slope < 0 && Number.isFinite(efficiency);
        fit = {
          targetKey: target.key,
          target: target.label,
          slope: regression.slope,
          intercept: regression.intercept,
          r2: regression.r2,
          efficiency,
          n: regression.n,
          xMin: regression.xMin,
          xMax: regression.xMax,
          valid,
          reason: valid ? 'ok' : 'positiveSlope',
        };
      }
    }
    fits.push(fit);
    fitByTarget.set(target.key, fit);
  }

  const sampleBuckets = new Map<
    string,
    {
      sample: string;
      sampleKey: string;
      target: string;
      targetKey: string;
      group: string;
      category: string;
      ctValues: number[];
      logValues: number[];
    }
  >();

  for (const well of wells) {
    if (!usableWell(well, qc[well.id], settings)) continue;
    if (well.quantity !== null || well.ct === null) continue;
    const targetKey = normKey(well.target);
    const sampleKey = normKey(well.sample);
    const fit = fitByTarget.get(targetKey);
    if (!sampleKey || !fit?.valid || fit.slope === null || fit.slope === 0 || fit.intercept === null) {
      continue;
    }
    const logQuantity = (well.ct - fit.intercept) / fit.slope;
    const bucketKey = `${sampleKey}\u0000${targetKey}`;
    let bucket = sampleBuckets.get(bucketKey);
    if (!bucket) {
      const groupKey = normKey(well.group);
      const groupLabel = groupKey ? (groupLabelByKey.get(groupKey) ?? well.group.trim()) : '';
      bucket = {
        sample: sampleLabelByKey.get(sampleKey) ?? well.sample.trim(),
        sampleKey,
        target: fit.target,
        targetKey,
        group: groupLabel,
        category:
          hasGroups && groupLabel
            ? groupLabel
            : (sampleLabelByKey.get(sampleKey) ?? well.sample.trim()),
        ctValues: [],
        logValues: [],
      };
      sampleBuckets.set(bucketKey, bucket);
    }
    bucket.ctValues.push(well.ct);
    bucket.logValues.push(logQuantity);
  }

  const samples: StandardSample[] = [...sampleBuckets.values()]
    .map((bucket) => {
      const meanCt = mean(bucket.ctValues);
      const meanLog = mean(bucket.logValues);
      return {
        sample: bucket.sample,
        sampleKey: bucket.sampleKey,
        target: bucket.target,
        targetKey: bucket.targetKey,
        group: bucket.group,
        category: bucket.category,
        n: bucket.ctValues.length,
        meanCt,
        log10Quantity: meanLog,
        quantity: 10 ** meanLog,
        sdLog: sampleSd(bucket.logValues),
        semLog: sem(bucket.logValues),
        quantityValues: bucket.logValues.map((v) => 10 ** v),
      };
    })
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) ||
        a.sample.localeCompare(b.sample, undefined, { sensitivity: 'base' }) ||
        a.target.localeCompare(b.target, undefined, { sensitivity: 'base' }),
    );

  return { fits, samples, missingStandards: totalStandardPoints === 0 };
}

export function chartDataFromStandard(analysis: StandardAnalysis): ChartData | null {
  if (!analysis.samples.length) return null;
  const categories: string[] = [];
  for (const row of analysis.samples) {
    if (!categories.includes(row.category)) categories.push(row.category);
  }
  const seriesTargets: InfoItem[] = [];
  for (const row of analysis.samples) {
    if (!seriesTargets.some((t) => t.key === row.targetKey)) {
      seriesTargets.push({ key: row.targetKey, label: row.target });
    }
  }
  const series = seriesTargets.map((target) => ({
    name: target.label,
    bars: categories.map((category) => {
      const rows = analysis.samples.filter(
        (r) => r.category === category && r.targetKey === target.key,
      );
      if (!rows.length) return null;
      const logValues = rows.map((r) => r.log10Quantity);
      const meanLog = mean(logValues);
      return {
        value: 10 ** meanLog,
        points: rows.map((r) => r.quantity),
        sem: null,
        logSem: sem(logValues),
        n: rows.length,
      };
    }),
  }));
  return { categories, series, log: true };
}
