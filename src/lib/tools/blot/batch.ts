// Folder-style batch processing for western blots. Each image is decoded,
// lanes and bands are detected with the interactive tool algorithms, and the
// result is written as an annotated PNG plus a densitometry CSV. A summary
// table and a failure log accompany the per-image files in one ZIP.
import { fileBaseName, stringEntry, bytesEntry } from '$lib/tools/shared/batch';
import type { ZipEntry } from '$lib/repro/zip';
import { decodeImageFile, loadImageElement, renderProcessed } from './image';
import { bandsFromDetection, detectBands, detectLanes, lanesFromDetection } from './detect';
import { quantify } from './quant';
import { annotatedCanvas, annotatedPng, resultsCsv, type CsvLabels } from './render';
import { emptyProject, type BlotProject } from './types';

export const MAX_BLOT_BATCH_IMAGES = 40;

export interface BlotBatchOptions {
  defaultGroup: string;
  csvLabels: CsvLabels;
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface BlotBatchBuild {
  entries: ZipEntry[];
  processed: number;
  failed: number;
  failures: string[];
  images: number;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: (string | number | null)[]): string {
  return values.map(csvCell).join(',');
}

function uniqueStem(stem: string, used: Set<string>): string {
  let name = stem;
  let index = 2;
  while (used.has(name)) name = `${stem}-${index++}`;
  used.add(name);
  return name;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildBlotBatch(
  files: File[],
  options: BlotBatchOptions,
): Promise<BlotBatchBuild> {
  const queue = files.slice(0, MAX_BLOT_BATCH_IMAGES);
  const entries: ZipEntry[] = [];
  const failures: string[] = [];
  const summary: (string | number | null)[][] = [
    ['image', 'source', 'lanes', 'bands', 'groups', 'totalVolume', 'controlMean', 'groupMeans'],
  ];
  const used = new Set<string>();

  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    options.onProgress?.(index, queue.length, file.name);
    try {
      const decoded = await decodeImageFile(file);
      const image = await loadImageElement(decoded.dataUrl);
      const project: BlotProject = {
        ...emptyProject(),
        createdAt: new Date().toISOString(),
        imageName: decoded.name,
        imageDataUrl: decoded.dataUrl,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        title: decoded.name.replace(/\.[^.]+$/, ''),
      };
      const processed = renderProcessed(project, image);
      const detected = detectLanes(processed.rawGray, processed.width, processed.height, project.crop);
      if (!detected.length) throw new Error('no lanes detected');
      const lanes = lanesFromDetection(detected, [], options.defaultGroup);
      for (const lane of lanes) {
        lane.bands = bandsFromDetection(
          detectBands(processed.rawGray, processed.width, processed.height, lane, project.crop),
          lane.width,
        );
      }
      const bandCount = lanes.reduce((sum, lane) => sum + lane.bands.length, 0);
      if (!bandCount) throw new Error('no bands detected');
      project.lanes = lanes;

      const result = quantify(project, {
        gray: processed.rawGray,
        width: processed.width,
        height: processed.height,
        project,
      });
      if (!result.hasData) throw new Error('no quantifiable bands');

      const canvas = annotatedCanvas(project, processed.canvas, {
        laneLabels: true,
        roi: true,
      });
      const stem = uniqueStem(fileBaseName(file.name, 'blot'), used);
      const description = `${file.name}; ${lanes.length} lanes; ${bandCount} bands; background ${project.backgroundMode}`;
      const png = await annotatedPng(canvas, project.exportDpi, description);
      const csv = resultsCsv(project, result, options.csvLabels);

      entries.push(bytesEntry(`${stem}_annotated.png`, png));
      entries.push(stringEntry(`${stem}_densitometry.csv`, csv));
      const groupMeans = result.groups
        .map((group) => `${group.name}=${group.mean.toFixed(4)}`)
        .join('; ');
      summary.push([
        stem,
        file.name,
        lanes.length,
        bandCount,
        result.groups.length,
        result.totalVolume,
        result.controlMean,
        groupMeans,
      ]);
    } catch (error) {
      failures.push(`${file.name}: ${errorText(error)}`);
      summary.push([
        uniqueStem(fileBaseName(file.name, 'blot'), used),
        file.name,
        0,
        0,
        0,
        null,
        null,
        '',
      ]);
    }
  }

  options.onProgress?.(queue.length, queue.length, '');
  entries.push(stringEntry('summary.csv', `${summary.map(csvRow).join('\r\n')}\r\n`));
  entries.push(
    stringEntry(
      'failures.txt',
      failures.length ? `${failures.join('\n')}\n` : 'No failures.\n',
    ),
  );
  return {
    entries,
    processed: summary.length - 1 - failures.length,
    failed: failures.length,
    failures,
    images: queue.length,
  };
}
