// Queue a rendered panel from another tool and open Figure Studio.
//
// The payload is a PNG data URL plus its natural size. Figure Studio consumes
// it once on mount, inserts an image node at the centre of the current page and
// then clears the key, so a reload cannot duplicate the panel.
import { goto } from '$app/navigation';

const KEY = 'spice_figure_pending_image';

export interface FigurePanelPayload {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
}

interface StoredPanel extends FigurePanelPayload {
  createdAt: number;
}

export function queueFigurePanel(payload: FigurePanelPayload): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  if (!/^data:image\//i.test(payload.dataUrl)) return false;
  try {
    const stored: StoredPanel = { ...payload, createdAt: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** Read and clear the pending panel. Invalid or stale payloads are discarded. */
export function takeFigurePanel(): FigurePanelPayload | null {
  if (typeof sessionStorage === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<StoredPanel>;
    if (typeof candidate.dataUrl !== 'string' || !/^data:image\//i.test(candidate.dataUrl)) {
      return null;
    }
    if (typeof candidate.createdAt === 'number' && Date.now() - candidate.createdAt > 10 * 60_000) {
      return null;
    }
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    return {
      dataUrl: candidate.dataUrl,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : 'Panel',
      width: Number.isFinite(width) && width > 0 ? width : 320,
      height: Number.isFinite(height) && height > 0 ? height : 240,
    };
  } catch {
    return null;
  }
}

/** Queue the panel then navigate to Figure Studio. */
export async function sendImageToFigure(payload: FigurePanelPayload): Promise<boolean> {
  if (!queueFigurePanel(payload)) return false;
  await goto('/tools/figure');
  return true;
}
