// Local autosave for the blot project. The image travels inside the project so
// a restored session is complete; a downloaded project JSON is the durable
// backup when browser storage is cleared or full.

import { sanitizeProject, type BlotProject } from './types';

const KEY = 'spice_blot_project_v1';

export function loadSnapshot(): BlotProject | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return sanitizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSnapshot(project: BlotProject): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
