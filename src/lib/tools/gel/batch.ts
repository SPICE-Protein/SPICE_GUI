// Folder batch mode for the gel figure tool.
//
// Every image runs the same automatic pipeline as the editor: straighten,
// auto-crop, infer the gel type, detect lanes and bands, optionally fit the
// selected marker ladder, then render a publication figure. Results are packed
// as one ZIP with a PNG, project JSON and one summary.csv row per image.
import type { GelProject, GelExposure } from './types';
import { emptyProject, newLaneId } from './types';
import { laddersFor, ladderById, unitForKind, type LadderDef } from './ladders';
import { autoCropRect, rotationScore, toGrayPlane } from './gelmath';
import {
  detectBandsInLane,
  detectGelType,
  detectLanesAuto,
  estimateBandSizes,
  identifyMarkers,
} from './detect';
import { decodeExposure, loadImageElement, renderProcessed, type ProcessedImage } from './pipeline';
import { buildFigure } from './figure';
import { rasterizeFigure } from './render';
import { exportPngWithMetadata, summaryText } from './export';
import type { ZipEntry } from '$lib/repro/zip';
import {
  MAX_BATCH_IMAGES,
  bytesEntry,
  fileBaseName,
  imageFiles,
  stringEntry,
} from '$lib/tools/shared/batch';
import { createCanvas, rasterHeight, rasterWidth } from '$lib/tools/shared/canvas';

export interface GelBatchOptions {
  /** Selected marker ladder; omit or pass an empty string to skip fitting. */
  ladderId?: string;
  /** Figure resolution, matching the editor export selector. */
  dpi?: number;
  onProgress?: (progress: { current: number; total: number; name: string }) => void;
}

export interface GelBatchBuild {
  entries: ZipEntry[];
  ok: number;
  failed: number;
  /** Images beyond MAX_BATCH_IMAGES that were not processed. */
  skipped: number;
  errors: { name: string; error: string }[];
  images: number;
}

interface ProcessedGel {
  project: GelProject;
  processed: ProcessedImage;
  png: Uint8Array;
}

/** Downscaled, unrotated copy used only to search for the straighten angle. */
function smallImageCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const maxSide = 300;
  const width = rasterWidth(img);
  const height = rasterHeight(img);
  const scale = maxSide / Math.max(width, height);
  const canvas = createCanvas(
    Math.max(8, Math.round(width * scale)),
    Math.max(8, Math.round(height * scale)),
  );
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rotationScoreAt(small: HTMLCanvasElement, deg: number): number {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.max(8, Math.round(small.width * cos + small.height * sin));
  const height = Math.max(8, Math.round(small.width * sin + small.height * cos));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  ctx.drawImage(small, -small.width / 2, -small.height / 2);
  const data = ctx.getImageData(0, 0, width, height);
  return rotationScore(toGrayPlane(data), width, height);
}

/** Mirror of the editor straighten search, at a slightly coarser step. */
function bestStraightenAngle(img: HTMLImageElement): number {
  const small = smallImageCanvas(img);
  let best = 0;
  let bestScore = -Infinity;
  for (let a = -15; a <= 15.0001; a += 1) {
    const score = rotationScoreAt(small, a);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  let fine = best;
  for (let a = best - 0.5; a <= best + 0.5001; a += 0.1) {
    const score = rotationScoreAt(small, a);
    if (score > bestScore) {
      bestScore = score;
      fine = a;
    }
  }
  return Math.round(fine * 10) / 10;
}

/** Assign the selected ladder and size estimates to the detected lanes. */
function fitSelectedLadder(project: GelProject, ladder: LadderDef): boolean {
  const result = identifyMarkers(project.lanes, {
    kind: project.gelType,
    ladders: [ladder],
    favorites: project.favorites,
  });
  if (!result) return false;

  project.ladderId = ladder.id;
  project.fit = {
    ladderId: ladder.id,
    laneIds: result.laneIds,
    a: result.fit.a,
    b: result.fit.b,
    c: result.fit.c,
    degree: result.fit.degree,
    r2: result.fit.r2,
    n: result.fit.n,
  };
  for (const lane of project.lanes) {
    const assigned = result.assignments[lane.id];
    lane.isMarker = !!assigned;
    lane.ladderId = assigned ? ladder.id : undefined;
    if (assigned) {
      const sorted = [...lane.bands].filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
      sorted.forEach((band, index) => {
        if (index < assigned.length) {
          band.size = assigned[index];
          band.showSize = true;
          band.approx = false;
        } else {
          band.size = undefined;
          band.showSize = false;
        }
      });
    }
  }
  for (const lane of project.lanes) {
    if (lane.isMarker || lane.removed) continue;
    const estimated = estimateBandSizes(lane.bands, result.fit, ladder);
    lane.bands.forEach((band, index) => {
      band.size = estimated[index].size;
      band.approx = estimated[index].approx;
      band.showSize = true;
    });
  }
  return true;
}

/** Run the automatic editor pipeline on one image and render its figure. */
async function processImage(file: File, ladderId: string | undefined, dpi: number): Promise<ProcessedGel> {
  const exposure: GelExposure = await decodeExposure(file);
  const img = await loadImageElement(exposure.dataUrl);
  const project = emptyProject();
  project.exposures = [exposure];
  project.activeExposureId = exposure.id;
  project.imageName = exposure.name;

  // 1. Straighten, then crop the gel slab.
  project.rotation = bestStraightenAngle(img);
  const processed = renderProcessed(exposure, project, img);
  project.crop = autoCropRect(processed.gray, processed.width, processed.height);

  // 2. Infer the gel type from the preliminary DNA pass.
  const preliminary = detectLanesAuto(processed.gray, processed.width, processed.height, false);
  const preliminaryBands = preliminary.map((lane) =>
    detectBandsInLane(processed.gray, processed.width, processed.height, lane, 'dna'),
  );
  const maxBands = preliminaryBands.reduce((n, bands) => Math.max(n, bands.length), 0);
  const widths = preliminaryBands.flat().map((band) => band.width).sort((a, b) => a - b);
  const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const ctx = processed.canvas.getContext('2d', { willReadFrequently: true })!;
  const rgba = ctx.getImageData(0, 0, processed.width, processed.height).data;
  const guess = detectGelType(rgba, maxBands, preliminary.length, medianWidth);
  project.gelType = guess.kind;
  project.unit = unitForKind(guess.kind);
  project.ladderId = laddersFor(guess.kind, project.customLadders)[0]?.id ?? project.ladderId;

  // 3. Lanes and bands with the inferred gel kind.
  project.lanes = preliminary.map((lane, index) => ({
    id: newLaneId(),
    x: lane.x,
    width: lane.width,
    name: String(index + 1),
    isMarker: false,
    bands: [],
  }));
  for (const lane of project.lanes) {
    lane.bands = detectBandsInLane(processed.gray, processed.width, processed.height, lane, project.gelType).map(
      (peak) => ({ y: peak.y, intensity: peak.intensity, showSize: true }),
    );
  }

  // 4. Optional calibration with the ladder chosen in the batch panel.
  if (ladderId) {
    const ladder = ladderById(ladderId, project.customLadders);
    if (ladder && ladder.kind === project.gelType) fitSelectedLadder(project, ladder);
  }

  // 5. Render the figure exactly like the editor export.
  const layout = buildFigure(project, processed.canvas);
  const canvas = rasterizeFigure(layout, processed.canvas, dpi);
  const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
  const png = await exportPngWithMetadata(canvas, dpi, summaryText(project, processed.canvas, ladder));
  return { project, processed, png };
}

function uniqueBase(base: string, used: Map<string, number>): string {
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

const CSV_HEADER = [
  'file',
  'width',
  'height',
  'gel_type',
  'unit',
  'lane_count',
  'band_count',
  'marker_lanes',
  'ladder',
  'fit_degree',
  'fit_r2',
  'rotation_deg',
  'crop_left',
  'crop_top',
  'crop_right',
  'crop_bottom',
  'png',
  'project',
  'error',
].join(',');

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function successRow(fileName: string, result: ProcessedGel, pngName: string, projectName: string): string {
  const { project, processed } = result;
  const exposure = project.exposures.find((e) => e.id === project.activeExposureId) ?? project.exposures[0];
  const ladder = project.fit ? ladderById(project.fit.ladderId, project.customLadders) : null;
  const markerLanes = project.lanes.filter((lane) => lane.isMarker && !lane.removed).length;
  const bands = project.lanes.reduce((n, lane) => n + lane.bands.length, 0);
  return [
    fileName,
    exposure?.width ?? processed.width,
    exposure?.height ?? processed.height,
    project.gelType,
    project.unit,
    project.lanes.filter((lane) => !lane.removed).length,
    bands,
    markerLanes,
    ladder?.name ?? (project.fit ? project.fit.ladderId : ''),
    project.fit?.degree ?? '',
    project.fit ? project.fit.r2.toFixed(4) : '',
    project.rotation.toFixed(2),
    project.crop.left.toFixed(4),
    project.crop.top.toFixed(4),
    project.crop.right.toFixed(4),
    project.crop.bottom.toFixed(4),
    pngName,
    projectName,
    '',
  ]
    .map(csvCell)
    .join(',');
}

function failureRow(fileName: string, error: string): string {
  return [
    fileName,
    ...Array(17).fill(''),
    error,
  ]
    .map(csvCell)
    .join(',');
}

/**
 * Process up to MAX_BATCH_IMAGES images and return one ZIP payload. Saving is
 * left to the caller, so this function is safe inside a module worker.
 */
export async function buildGelBatch(files: File[], options: GelBatchOptions = {}): Promise<GelBatchBuild> {
  const all = imageFiles(files);
  const images = all.slice(0, MAX_BATCH_IMAGES);
  const skipped = all.length - images.length;
  const dpi = options.dpi ?? 300;
  const errors: { name: string; error: string }[] = [];
  const entries: ZipEntry[] = [];
  const rows: string[] = [CSV_HEADER];
  const used = new Map<string, number>();
  let ok = 0;
  let failed = 0;

  for (const [index, file] of images.entries()) {
    options.onProgress?.({ current: index + 1, total: images.length, name: file.name });
    try {
      const result = await processImage(file, options.ladderId, dpi);
      const base = uniqueBase(fileBaseName(file.name), used);
      const pngName = `${base}-figure.png`;
      const projectName = `${base}.gel.json`;
      entries.push(bytesEntry(pngName, result.png));
      entries.push(stringEntry(projectName, JSON.stringify(result.project, null, 2)));
      rows.push(successRow(file.name, result, pngName, projectName));
      ok++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ name: file.name, error: message });
      rows.push(failureRow(file.name, message));
      failed++;
    }
  }

  entries.push(stringEntry('summary.csv', `${rows.join('\n')}\n`));
  return { entries, ok, failed, skipped, errors, images: images.length };
}
