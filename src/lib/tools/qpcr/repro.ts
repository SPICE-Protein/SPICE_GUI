// Reproducibility bundle for the qPCR workspace: chart PNG and SVG, the full
// results CSV, project JSON, parameters and a methods paragraph that records
// the reference-gene, control and QC choices actually used.
import { saveReproBundle } from '$lib/repro/bundle';
import { fileBaseName } from '$lib/tools/shared/batch';
import type { SvgDoc } from './chart';
import { svgToPngBytes } from './chart';
import type { DdctAnalysis, StandardAnalysis, WellQc } from './analysis';
import { buildResultsCsv } from './export';
import type { QpcrProject } from './types';

export interface QpcrReproInput {
  project: QpcrProject;
  chart: SvgDoc;
  qc: Record<string, WellQc>;
  ddct: DdctAnalysis;
  standard: StandardAnalysis;
  title: string;
  flagged: number;
}

function methodsText(input: QpcrReproInput): string {
  const { project, ddct, standard } = input;
  const settings = project.settings;
  const references = ddct.references.map((reference) => reference.label).join(', ') || 'none';
  const control =
    ddct.controlLabel || settings.controlSample || settings.controlGroup || 'the first sample';
  const lines: string[] = [];
  if (project.mode === 'ddct') {
    lines.push(
      `qPCR data were analysed with SPICE GUI using the Delta Delta Ct method. Reference Ct for each sample was calculated as the geometric mean of the Ct values of the selected reference targets (${references}). Target Ct was the mean of the included technical replicates, and Delta Ct was target Ct minus reference Ct.`,
    );
    lines.push(
      `Delta Delta Ct was calculated relative to the control group or sample "${control}". Fold change was calculated as 2^-DeltaDeltaCt, or as (1+E)^-DeltaDeltaCt when efficiency correction was enabled (default efficiency ${settings.defaultEfficiencyPct}%).`,
    );
    lines.push(
      `Group summaries report the mean fold change, sample SD and SEM. Two-sided Welch t-tests were computed on Delta Ct values of each group against the control group.`,
    );
  } else {
    lines.push(
      'qPCR data were analysed with SPICE GUI using standard-curve quantification. For each target, Ct was regressed on the log10 standard quantity by ordinary least squares; amplification efficiency was calculated as 10^(-1/slope) - 1.',
    );
    lines.push(
      'Unknown sample quantities were interpolated from the fitted curve per target and summarised as the mean log10 quantity with SD and SEM.',
    );
  }
  lines.push(
    `Quality control flagged ${input.flagged} wells. Ct values above ${settings.highCt} were marked as high Ct, replicate SD above ${settings.sdLimit} was flagged, and wells deviating more than ${settings.outlierLimit} Ct from the replicate mean were treated as outliers${settings.excludeOutliers ? ' and excluded automatically' : ' but retained'}. Wells without Ct and selected reference targets without Ct were flagged.`,
  );
  lines.push(
    'All analysis parameters are recorded in parameters.json and the complete editable state is stored in project.json.',
  );
  if (project.mode === 'ddct' && standard.fits.length) {
    lines.push(
      `Standard curves were also fitted for ${standard.fits.length} target(s) present in the data.`,
    );
  }
  return lines.join('\n\n');
}

function parameters(input: QpcrReproInput): Record<string, unknown> {
  const { project, ddct, standard, flagged } = input;
  return {
    mode: project.mode,
    settings: project.settings,
    referenceTargets: ddct.references.map((reference) => reference.label),
    controlLabel: ddct.controlLabel,
    controlGroup: project.settings.controlGroup,
    controlSample: project.settings.controlSample,
    wells: project.wells.length,
    flaggedWells: flagged,
    sampleResults: ddct.sampleResults.length,
    groupResults: ddct.groupResults.map((group) => ({
      group: group.category,
      target: group.target,
      nSamples: group.nSamples,
      meanFold: group.meanFold,
      sdFold: group.sdFold,
      semFold: group.semFold,
      meanDCt: group.meanDCt,
      sdDCt: group.sdDCt,
      welchP: group.pValue,
      isControl: group.isControl,
    })),
    standardFits: standard.fits.map((fit) => ({
      target: fit.target,
      slope: fit.slope,
      intercept: fit.intercept,
      r2: fit.r2,
      efficiency: fit.efficiency,
      n: fit.n,
      valid: fit.valid,
      reason: fit.reason,
    })),
  };
}

export async function saveQpcrReproBundle(input: QpcrReproInput) {
  const { project, chart, qc, ddct, standard, title } = input;
  const base = fileBaseName(project.fileName || title, 'qpcr');
  const png = await svgToPngBytes(chart.svg, chart.width, chart.height, 2);
  const csv = buildResultsCsv(project, qc, ddct, standard);
  return saveReproBundle({
    tool: 'qpcr',
    title,
    files: [
      { name: `${base}_qpcr_chart.png`, mime: 'image/png', data: png },
      { name: `${base}_qpcr_chart.svg`, mime: 'image/svg+xml', data: chart.svg },
      { name: `${base}_qpcr_results.csv`, mime: 'text/csv', data: csv },
    ],
    parameters: parameters(input),
    methods: methodsText(input),
    project,
  });
}
