// Local persistence for the colony counter. The browser snapshot keeps the
// image compressed at identical pixel dimensions so marker coordinates remain
// valid; the downloadable project JSON keeps the original encoded image.
import { loadImageElement } from './imaging';
import type { ColonyProject } from './types';
import { isColonyProject, normalizeProject } from './types';

const SNAPSHOT_KEY = 'spice_colony_project_v1';
/** Approximate character budget before re-encoding the image as JPEG. */
const IMAGE_BUDGET = 2_600_000;

export function loadSnapshot(): ColonyProject | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isColonyProject(parsed) ? normalizeProject(parsed) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

/** Re-encode a large image at the same dimensions (JPEG) to fit site storage. */
export async function compactProjectImage(project: ColonyProject): Promise<ColonyProject> {
  if (!project.imageDataUrl || project.imageDataUrl.length <= IMAGE_BUDGET) return project;
  try {
    const img = await loadImageElement(project.imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    if (dataUrl.length > IMAGE_BUDGET) dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    if (dataUrl.startsWith('data:image/jpeg')) {
      return { ...project, imageDataUrl: dataUrl, imageName: `${project.imageName}` };
    }
  } catch {
    /* keep the original */
  }
  return project;
}

export function saveSnapshot(project: ColonyProject): boolean {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}
