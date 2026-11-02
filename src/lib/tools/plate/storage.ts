// Local persistence for the plate designer. The browser snapshot is a
// convenience copy; the project JSON file is the portable backup.

import { normalizeProject, type NormalizedProject, type PlateProjectFile } from './types';

const SNAPSHOT_KEY = 'spice_plate_project_v1';

export function loadPlateSnapshot(): NormalizedProject | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const normalized = normalizeProject(JSON.parse(raw));
    return normalized.project ? normalized : null;
  } catch {
    return null;
  }
}

export function savePlateSnapshot(project: PlateProjectFile): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function clearPlateSnapshot(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

export function parsePlateProject(text: string): NormalizedProject | null {
  try {
    const normalized = normalizeProject(JSON.parse(text));
    return normalized.project ? normalized : null;
  } catch {
    return null;
  }
}

export function serializePlateProject(project: PlateProjectFile): string {
  return JSON.stringify(project, null, 2);
}
