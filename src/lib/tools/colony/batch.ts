// Batch colony counting for folder-sized plate sets. Each image is decoded with
// the same path as the editor (including TIFF), segmented with the current
// detection parameters and exported as an annotated PNG plus a marker CSV.
// The component owns the ZIP download; this module only builds the entries.
import { fileBaseName, stringEntry, bytesEntry } from '$lib/tools/shared/batch';
import type { ZipEntry } from '$lib/repro/zip';
import {
  MAX_DETECT_DIM,
  buildWorkCanvas,
  decodeImageFile,
  downscaleCanvas,
  extractGray,
  loadImageElement,
  renderAdjusted
} from './imaging';
import { segmentGray, type SegmentRequest } from './segment';
import {
  computeCfu,
  computeStats,
  countClasses,
  markersToCsv,
  numberMarkers,
  poissonCi95,
  cfuCi95
} from './markers';
import { annotatedPngBytes } from './export';
import { classifyMarkers } from './color';
import {
  defaultCrop,
  type ColonyAdjust,
  type ColonyMarker,
  type ColonyParams
} from './types';

/** Hard cap shared by the UI and this runner. */
export const MAX_BATCH_PLATES = 40;

export interface ColonyBatchInput {
  params: ColonyParams;
  adjust: ColonyAdjust;
  dpi: 300 | 600;
  showNumbers: boolean;
  dilutionFactor: number;
  platedVolume: number;
}

export interface ColonyBatchFailure {
  name: string;
  message: string;
}

export interface ColonyBatchResult {
  entries: ZipEntry[];
  processed: number;
  failed: number;
  failures: ColonyBatchFailure[];
  /** Images beyond MAX_BATCH_PLATES that were ignored. */
  clipped: number;
}

export type BatchProgress = (done: number, total: number, name: string) => void;

function nextFrame(): Promise<void> {
  // Workers have no requestAnimationFrame; yielding still lets progress
  // messages drain between plates.
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function uniqueStem(name: string, used: Set<string>): string {
  const base = fileBaseName(name, 'plate');
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}-${index++}`;
  used.add(candidate);
  return candidate;
}

function segmentRequest(params: ColonyParams, fx: number, fy: number): SegmentRequest {
  const areaScale = fx * fy;
  return {
    threshold: params.autoThreshold ? null : Math.min(255, Math.max(0, params.manualThreshold)),
    polarity: params.polarity,
    blurRadius: params.blurRadius * Math.min(fx, fy),
    minArea: Math.max(0, params.minArea) * areaScale,
    maxArea: Math.max(0, params.maxArea) * areaScale,
    minCircularity: params.minCircularity,
    splitTouching: params.splitTouching
  };
}

export async function runColonyBatch(
  files: File[],
  input: ColonyBatchInput,
  onProgress?: BatchProgress
): Promise<ColonyBatchResult> {
  const selected = files.slice(0, MAX_BATCH_PLATES);
  const clipped = Math.max(0, files.length - selected.length);
  const entries: ZipEntry[] = [];
  const failures: ColonyBatchFailure[] = [];
  const usedStems = new Set<string>();
  const summaryRows: string[] = [];
  let processed = 0;

  summaryRows.push(
    'file,status,count,blue,white,unclassified,count_ci95_low,count_ci95_high,cfu_per_ml,cfu_ci95_low,cfu_ci95_high,threshold,polarity'
  );

  for (let index = 0; index < selected.length; index++) {
    const file = selected[index];
    await nextFrame();
    onProgress?.(index, selected.length, file.name);
    try {
      const decoded = await decodeImageFile(file);
      const image = await loadImageElement(decoded.dataUrl);
      const work = buildWorkCanvas(image, 0, defaultCrop());
      const processedCanvas = renderAdjusted(work.canvas, { ...input.adjust });
      const scaled = downscaleCanvas(processedCanvas, MAX_DETECT_DIM);
      const { gray, width, height } = extractGray(scaled.canvas);
      const fx = width / Math.max(1, work.width);
      const fy = height / Math.max(1, work.height);
      const areaScale = fx * fy;
      const result = segmentGray(gray, width, height, segmentRequest(input.params, fx, fy));

      const markers: ColonyMarker[] = result.colonies.map((colony, markerIndex) => {
        const area = colony.area / areaScale;
        return {
          id: markerIndex + 1,
          x: colony.x / fx,
          y: colony.y / fy,
          radius: Math.sqrt(Math.max(0, area) / Math.PI),
          area,
          meanIntensity: colony.meanIntensity,
          circularity: colony.circularity,
          included: true,
          source: 'auto',
          meanR: 0,
          meanG: 0,
          meanB: 0,
          hue: -1,
          saturation: 0,
          colonyClass: 'unclassified',
          classManual: false
        };
      });

      if (input.params.colorMode === 'blue-white') classifyMarkers(work.canvas, markers);

      const numbering = numberMarkers(markers);
      const stats = computeStats(markers);
      const classes = countClasses(markers);
      const cfu = computeCfu(stats.included, input.dilutionFactor, input.platedVolume);
      const countCi = poissonCi95(stats.included);
      const cfuInterval = cfuCi95(stats.included, input.dilutionFactor, input.platedVolume);
      const stem = uniqueStem(file.name, usedStems);

      const png = await annotatedPngBytes(
        processedCanvas,
        markers,
        numbering,
        input.dpi,
        input.showNumbers
      );
      entries.push(bytesEntry(`${stem}_annotated_${input.dpi}dpi.png`, png));
      entries.push(stringEntry(`${stem}_markers.csv`, markersToCsv(markers, numbering)));

      summaryRows.push(
        [
          csvCell(file.name),
          'ok',
          stats.included,
          classes.blue,
          classes.white,
          classes.unclassified,
          countCi.low.toFixed(2),
          countCi.high.toFixed(2),
          cfu === null ? '' : cfu.toFixed(4),
          cfuInterval ? cfuInterval.low.toFixed(4) : '',
          cfuInterval ? cfuInterval.high.toFixed(4) : '',
          Math.round(result.threshold),
          result.polarity
        ].join(',')
      );
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ name: file.name, message });
      summaryRows.push([csvCell(file.name), 'failed', '', '', '', '', '', '', '', '', '', '', ''].join(','));
    }
    onProgress?.(index + 1, selected.length, file.name);
  }

  entries.push(stringEntry('summary.csv', summaryRows.join('\n')));
  entries.push(
    stringEntry(
      'failures.txt',
      failures.length
        ? failures.map((failure) => `${failure.name}: ${failure.message}`).join('\n')
        : 'No failures.'
    )
  );

  return { entries, processed, failed: failures.length, failures, clipped };
}
