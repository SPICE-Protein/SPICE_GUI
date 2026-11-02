// Reproducibility bundle for the blot tool. Everything is built from the same
// in-memory project that drives the figure and CSV exports: annotated PNG,
// vector figure, densitometry CSV, project JSON, parameters and methods.
import { saveReproBundle } from '$lib/repro/bundle';
import { fileBaseName } from '$lib/tools/shared/batch';
import type { ProcessedImage } from './image';
import { annotatedCanvas, annotatedPng, figureSvg, resultsCsv, type CsvLabels, type FigureOptions } from './render';
import type { QuantResult } from './quant';
import type { BlotProject } from './types';

export interface BlotReproInput {
  project: BlotProject;
  processed: ProcessedImage;
  quant: QuantResult;
  title: string;
  csvLabels: CsvLabels;
  figure: FigureOptions;
}

const BACKGROUND_TEXT: Record<BlotProject['backgroundMode'], string> = {
  ring: 'a local ring median around each band ROI',
  lane: 'the median signal of the lane outside the band ROI',
  global: 'a border-ring median over the whole image',
  manual: 'a fixed manual background level',
};

function loadingLaneName(project: BlotProject): string {
  const lane = project.lanes.find((item) => item.id === project.normalization.loadingLaneId);
  return lane?.sample || lane?.name || '';
}

function normalizationText(project: BlotProject): string {
  if (project.normalization.mode === 'loading') {
    const name = loadingLaneName(project);
    return name
      ? `Band signal was normalised to the loading-control lane "${name}".`
      : 'Band signal was normalised to the selected loading-control lane.';
  }
  if (project.normalization.mode === 'total') {
    return 'Band signal was normalised to the total signal of each lane.';
  }
  return 'No lane-level normalisation was applied; normalised signal equals net band volume.';
}

function groupList(project: BlotProject): string {
  const groups: string[] = [];
  for (const lane of project.lanes) {
    const group = lane.group.trim();
    if (group && !groups.includes(group)) groups.push(group);
  }
  return groups.length ? groups.join(', ') : 'none';
}

function methodsText(project: BlotProject, quant: QuantResult): string {
  const lanes = project.lanes.filter((lane) => !lane.excluded).length;
  const bands = project.lanes.reduce(
    (sum, lane) => sum + lane.bands.filter((band) => !band.excluded).length,
    0,
  );
  const control = project.normalization.controlGroup.trim();
  const lines = [
    `Western blot images were analysed with SPICE GUI. ${lanes} lanes and ${bands} band regions of interest were detected on the inverted grayscale plane and reviewed before quantification. Integrated band signal was corrected for local background estimated from ${BACKGROUND_TEXT[project.backgroundMode]}.`,
    `${normalizationText(project)} The loading-control lane setting was ${loadingLaneName(project) || 'not assigned'}.`,
    `Lanes were grouped by the sample-table labels (${groupList(project)}). Replicate summaries report the mean, sample standard deviation, standard error and the 95% confidence interval from the Student t distribution.`,
    control
      ? `Two-sided Welch t-tests were computed for each group against the control group "${control}" on normalised signal.`
      : 'No control group was selected, so Welch t-test p values are not reported.',
    `The annotated figure PNG was rendered at ${project.exportDpi} dpi. All parameters are recorded in parameters.json and the complete editable state is stored in project.json.`,
  ];
  return lines.join('\n\n');
}

function parameters(project: BlotProject, quant: QuantResult): Record<string, unknown> {
  return {
    backgroundMode: project.backgroundMode,
    manualBackground: project.manualBackground,
    normalization: project.normalization.mode,
    loadingLane: loadingLaneName(project),
    controlGroup: project.normalization.controlGroup,
    chartMetric: project.chartMetric,
    exportDpi: project.exportDpi,
    crop: project.crop,
    rotationDegrees: project.rotation,
    orientationQuarterTurns: project.orient,
    display: project.adjust,
    laneCount: project.lanes.length,
    includedLanes: project.lanes.filter((lane) => !lane.excluded).length,
    bandCount: quant.rows.length,
    includedBands: quant.rows.filter((row) => row.included).length,
    controlMean: quant.controlMean,
    totalVolume: quant.totalVolume,
    groups: quant.groups.map((group) => ({
      name: group.name,
      n: group.n,
      mean: group.mean,
      sd: group.sd,
      sem: group.sem,
      ci95: group.n >= 2 ? group.ci95 : null,
      welchP: group.pValue,
    })),
  };
}

export async function saveBlotReproBundle(input: BlotReproInput) {
  const { project, processed, quant, title, csvLabels, figure } = input;
  const base = fileBaseName(project.imageName || title, 'blot');
  const canvas = annotatedCanvas(project, processed.canvas, {
    laneLabels: project.showLaneLabels,
    roi: project.showRoi,
  });
  const description = `${title}; ${project.lanes.length} lanes; ${project.exportDpi} dpi; background ${project.backgroundMode}; normalisation ${project.normalization.mode}`;
  const png = await annotatedPng(canvas, project.exportDpi, description);
  const svg = figureSvg(project, processed.canvas, quant, figure);
  const csv = resultsCsv(project, quant, csvLabels);

  return saveReproBundle({
    tool: 'blot',
    title,
    files: [
      { name: `${base}_annotated_${project.exportDpi}dpi.png`, mime: 'image/png', data: png },
      { name: `${base}_figure.svg`, mime: 'image/svg+xml', data: svg },
      { name: `${base}_densitometry.csv`, mime: 'text/csv', data: csv },
    ],
    parameters: parameters(project, quant),
    methods: methodsText(project, quant),
    project,
  });
}
