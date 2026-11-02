// Local autosave, project JSON import/export and a compact history signature.
// Panels embed their pixels, so a project JSON is fully self-contained; the
// localStorage copy is a convenience and can be cleared by the user.
import { normalizeProject, type AnnotateProject } from './types';

const SNAPSHOT_KEY = 'spice_annotate_project_v1';

export function saveSnapshot(project: AnnotateProject): boolean {
  try {
    const text = JSON.stringify(project);
    localStorage.setItem(SNAPSHOT_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadSnapshot(): AnnotateProject | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

export function projectJson(project: AnnotateProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectText(text: string): AnnotateProject | null {
  try {
    return normalizeProject(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Signature used to skip no-op history entries. Image payloads are excluded
 * because they never change in place; all editable panel fields are included.
 */
export function historyKey(project: AnnotateProject): string {
  return JSON.stringify({
    name: project.name,
    layout: project.layout,
    panels: project.panels.map((panel) => ({
      id: panel.id,
      name: panel.name,
      width: panel.width,
      height: panel.height,
      crop: panel.crop,
      zoom: panel.zoom,
      offsetX: panel.offsetX,
      offsetY: panel.offsetY,
      brightness: panel.brightness,
      contrast: panel.contrast,
      calibration: panel.calibration,
    })),
    annotations: project.annotations,
  });
}

export function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
  return cleaned || 'figure';
}
