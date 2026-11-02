// Local session persistence for the tree tool.
import type { TreeProject } from './types';
import { parseProjectJson, serializeProject } from './export';

const STORAGE_KEY = 'spice_tree_viewer_v1';

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

export function saveSession(project: TreeProject): boolean {
  if (!storageAvailable()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): TreeProject | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseProjectJson(raw);
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  if (!storageAvailable()) return false;
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function clearSession(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore quota or privacy-mode failures; the UI remains usable.
  }
}
