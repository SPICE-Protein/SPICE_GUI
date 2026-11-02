// CSV export: raw wells with QC flags, replicate and sample tables, group
// statistics, Delta Ct matrices and standard-curve fits in one file.
import type { QpcrProject } from './types';
import type { DdctAnalysis, StandardAnalysis, WellQc } from './analysis';

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(values: (string | number | null | undefined)[]): string {
  return values.map(csvEscape).join(',');
}

function num(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const rounded = Number(value.toFixed(digits));
  return String(rounded);
}

function pValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (value > 0 && value < 0.0001) return value.toExponential(3);
  return value.toFixed(4);
}

export function buildResultsCsv(
  project: QpcrProject,
  qc: Record<string, WellQc>,
  ddct: DdctAnalysis,
  standard: StandardAnalysis,
): string {
  const lines: string[] = [];
  const section = (title: string) => {
    if (lines.length) lines.push('');
    lines.push(row([title]));
  };

  lines.push(row(['SPICE qPCR results']));
  lines.push(row(['generated', new Date().toISOString()]));
  lines.push(row(['file', project.fileName]));
  lines.push(row(['mode', project.mode]));
  lines.push(
    row([
      'referenceTargets',
      ddct.references.map((reference) => reference.label).join(';'),
      'controlGroup',
      project.settings.controlGroup,
      'controlSample',
      project.settings.controlSample,
    ]),
  );
  lines.push(
    row([
      'highCt',
      project.settings.highCt,
      'sdLimit',
      project.settings.sdLimit,
      'outlierLimit',
      project.settings.outlierLimit,
      'excludeOutliers',
      project.settings.excludeOutliers ? 'yes' : 'no',
      'efficiencyCorrection',
      project.settings.efficiencyCorrection ? 'yes' : 'no',
    ]),
  );

  section('Raw data with QC');
  lines.push(
    row([
      'row',
      'well',
      'sample',
      'target',
      'group',
      'replicate',
      'ct',
      'tm',
      'efficiency',
      'quantity',
      'include',
      'qcFlags',
    ]),
  );
  for (const well of project.wells) {
    lines.push(
      row([
        well.row + 2,
        well.well,
        well.sample,
        well.target,
        well.group,
        num(well.replicate, 0),
        num(well.ct, 4),
        num(well.tm, 2),
        num(well.efficiency, 4),
        num(well.quantity, 6),
        well.include ? 'yes' : 'no',
        (qc[well.id]?.flags ?? []).join('|'),
      ]),
    );
  }

  section('Replicate results');
  lines.push(
    row([
      'sample',
      'target',
      'group',
      'category',
      'replicate',
      'well',
      'ct',
      'refCt',
      'dCt',
      'ddCt',
      'foldChange',
      'isControl',
    ]),
  );
  for (const rep of ddct.replicates) {
    lines.push(
      row([
        rep.sample,
        rep.target,
        rep.group,
        rep.category,
        num(rep.replicate, 0),
        rep.well,
        num(rep.ct, 4),
        num(rep.refCt, 4),
        num(rep.dCt, 4),
        num(rep.ddCt, 4),
        num(rep.fold, 6),
        rep.isControl ? 'yes' : 'no',
      ]),
    );
  }

  section('Sample results');
  lines.push(
    row([
      'sample',
      'target',
      'group',
      'category',
      'n',
      'meanCt',
      'sdCt',
      'dCt',
      'ddCt',
      'efficiency',
      'foldChange',
      'foldSD',
      'foldSEM',
      'isControl',
    ]),
  );
  for (const sample of ddct.sampleResults) {
    lines.push(
      row([
        sample.sample,
        sample.target,
        sample.group,
        sample.category,
        sample.n,
        num(sample.meanCt, 4),
        num(sample.sdCt, 4),
        num(sample.dCt, 4),
        num(sample.ddCt, 4),
        num(sample.efficiency, 4),
        num(sample.fold, 6),
        num(sample.foldSd, 6),
        num(sample.foldSem, 6),
        sample.isControl ? 'yes' : 'no',
      ]),
    );
  }

  section('Group results');
  lines.push(
    row([
      'group',
      'target',
      'nSamples',
      'meanFold',
      'sdFold',
      'semFold',
      'meanDCt',
      'sdDCt',
      'welchP',
      'isControl',
    ]),
  );
  for (const group of ddct.groupResults) {
    lines.push(
      row([
        group.category,
        group.target,
        group.nSamples,
        num(group.meanFold, 6),
        num(group.sdFold, 6),
        num(group.semFold, 6),
        num(group.meanDCt, 4),
        num(group.sdDCt, 4),
        pValue(group.pValue),
        group.isControl ? 'yes' : 'no',
      ]),
    );
  }

  section('Delta Ct matrix');
  lines.push(row(['sample', 'group', 'refCt', ...ddct.targets.map((t) => `dCt:${t.label}`)]));
  for (const matrixRow of ddct.matrix) {
    lines.push(
      row([
        matrixRow.sample,
        matrixRow.group,
        num(matrixRow.refCt, 4),
        ...ddct.targets.map((t) => num(matrixRow.dCt[t.key], 4)),
      ]),
    );
  }

  section('Delta Delta Ct matrix');
  lines.push(row(['sample', 'group', ...ddct.targets.map((t) => `ddCt:${t.label}`)]));
  for (const matrixRow of ddct.matrix) {
    lines.push(
      row([
        matrixRow.sample,
        matrixRow.group,
        ...ddct.targets.map((t) => num(matrixRow.ddCt[t.key], 4)),
      ]),
    );
  }

  section('Control mean Delta Ct');
  lines.push(row(['target', 'controlMeanDCt']));
  for (const target of ddct.targets) {
    lines.push(row([target.label, num(ddct.controlMeanDCt[target.key], 4)]));
  }

  section('Reference QC');
  lines.push(row(['sample', 'group', 'refCt', 'missingReferenceTargets']));
  for (const matrixRow of ddct.matrix) {
    lines.push(
      row([
        matrixRow.sample,
        matrixRow.group,
        num(matrixRow.refCt, 4),
        matrixRow.referenceMissing.join(';'),
      ]),
    );
  }

  section('Standard curve fits');
  lines.push(
    row(['target', 'slope', 'intercept', 'r2', 'efficiency', 'n', 'xMin', 'xMax', 'valid', 'reason']),
  );
  for (const fit of standard.fits) {
    lines.push(
      row([
        fit.target,
        num(fit.slope, 6),
        num(fit.intercept, 6),
        num(fit.r2, 6),
        num(fit.efficiency, 6),
        fit.n,
        num(fit.xMin, 6),
        num(fit.xMax, 6),
        fit.valid ? 'yes' : 'no',
        fit.reason,
      ]),
    );
  }

  section('Interpolated standard quantities');
  lines.push(
    row([
      'sample',
      'target',
      'group',
      'category',
      'n',
      'meanCt',
      'log10Quantity',
      'quantity',
      'sdLog10',
      'semLog10',
    ]),
  );
  for (const sample of standard.samples) {
    lines.push(
      row([
        sample.sample,
        sample.target,
        sample.group,
        sample.category,
        sample.n,
        num(sample.meanCt, 4),
        num(sample.log10Quantity, 6),
        num(sample.quantity, 6),
        num(sample.sdLog, 6),
        num(sample.semLog, 6),
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}
