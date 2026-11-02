// Project-document helpers for the colony counter. A SPICE_PROJECT document
// stores the same portable ColonyProject object as the standalone JSON export.
import { isColonyProject, normalizeProject, type ColonyProject } from './types';

export const COLONY_PROJECT_KIND = 'colony' as const;

/** Validate and normalise a project document payload, or null when invalid. */
export function normalizeColonyPayload(payload: unknown): ColonyProject | null {
  if (!isColonyProject(payload)) return null;
  return normalizeProject(payload);
}

export function colonyProjectName(project: ColonyProject, fallback: string): string {
  const name = project.imageName.replace(/\.[^.]+$/, '').trim();
  return name || fallback;
}

export interface ColonyProjectCounts {
  included: number;
  excluded: number;
  blue: number;
  white: number;
}

export function colonyProjectCounts(project: ColonyProject): ColonyProjectCounts {
  const included = project.markers.filter((marker) => marker.included);
  return {
    included: included.length,
    excluded: project.markers.length - included.length,
    blue: included.filter((marker) => marker.colonyClass === 'blue').length,
    white: included.filter((marker) => marker.colonyClass === 'white').length
  };
}
