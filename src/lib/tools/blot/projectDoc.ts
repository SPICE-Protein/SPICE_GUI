// Project document helpers for the blot tool: the SPICE_PROJECT payload
// sanitizer, the one-line hub summary and the compact hub preview.
import { annotatedCanvas } from './render';
import type { ProcessedImage } from './image';
import { canvasPreview } from '$lib/tools/shared/preview';
import { sanitizeProject, type BlotProject } from './types';
import { tm } from './messages';

export function sanitizeBlotProject(input: unknown): BlotProject | null {
  return sanitizeProject(input);
}

/** One-line status shown in the project hub document list. */
export function blotDocSummary(project: BlotProject): string {
  const lanes = project.lanes.filter((lane) => !lane.excluded).length;
  const bands = project.lanes.reduce(
    (sum, lane) => sum + lane.bands.filter((band) => !band.excluded).length,
    0,
  );
  const groups = new Set(
    project.lanes
      .map((lane) => lane.group.trim())
      .filter((group) => group.length > 0),
  ).size;
  return tm.blotDocSummary({ lanes, bands, groups });
}

/** Compact annotated JPEG stored on the project document. */
export async function blotDocPreview(
  project: BlotProject,
  processed: ProcessedImage | null,
): Promise<string | null> {
  if (!processed) return null;
  const canvas = annotatedCanvas(project, processed.canvas, {
    laneLabels: project.showLaneLabels,
    roi: project.showRoi,
  });
  return canvasPreview(canvas) || null;
}
