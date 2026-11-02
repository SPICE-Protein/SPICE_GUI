// Local autosave for the qPCR workspace. A downloaded project JSON remains the
// authoritative backup because browser storage can be cleared.
import { normalizeProject, type QpcrProject } from './types';

const SNAPSHOT_KEY = 'spice_qpcr_project_v1';

export function loadSnapshot(): QpcrProject | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSnapshot(project: QpcrProject): boolean {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot(): boolean {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    return true;
  } catch {
    return false;
  }
}
