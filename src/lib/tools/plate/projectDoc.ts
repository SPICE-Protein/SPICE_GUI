// Project-document helpers for the plate designer. The payload stored in a
// SPICE_PROJECT document is a plain PlateProjectFile, so opening one is the
// same operation as importing a standalone project JSON file.
import {
  formatGeometry,
  normalizeProject,
  type NormalizedProject,
  type PlateProjectFile
} from './types';

export const PLATE_PROJECT_KIND = 'plate' as const;

/** Validate and normalise a project document payload. */
export function normalizePlatePayload(payload: unknown): NormalizedProject {
  return normalizeProject(payload);
}

export function plateProjectName(project: PlateProjectFile, fallback: string): string {
  return project.title.trim() || fallback;
}

export interface PlateProjectCounts {
  samples: number;
  assigned: number;
  total: number;
  format: PlateProjectFile['format'];
}

export function plateProjectCounts(project: PlateProjectFile): PlateProjectCounts {
  return {
    samples: project.samples.length,
    assigned: project.assignments.length,
    total: formatGeometry(project.format).total,
    format: project.format
  };
}
