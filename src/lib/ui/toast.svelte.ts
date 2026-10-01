// In-app pixel toast store (Svelte 5 runes at module scope).
import { localizeInline } from '$lib/i18nMsg';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

let nextId = 1;

export const toasts = $state<Toast[]>([]);

export function pushToast(kind: ToastKind, title: string, body?: string) {
  const id = nextId++;
  // Backend messages arrive as `i18n:` codes (or embed them); resolve here so
  // every toast path — including catch-all error strings — shows localized text.
  toasts.push({ id, kind, title: localizeInline(title), body: body ? localizeInline(body) : body });
  setTimeout(() => dismissToast(id), 6500);
}

export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

// OS notification (Tauri plugin) + always show an in-app pixel toast.
// Lives here so plain .ts modules never have to import a `.svelte.ts` store.
import { isTauri } from '$lib/backend/api';

let permissionReady = false;
let permissionGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionReady) return permissionGranted;
  permissionReady = true;
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    if (await isPermissionGranted()) {
      permissionGranted = true;
      return true;
    }
    const p = await requestPermission();
    permissionGranted = p === 'granted';
    return permissionGranted;
  } catch {
    return false;
  }
}

export async function notify(kind: ToastKind, title: string, body?: string) {
  // The in-app toast always shows (visible in both browser and desktop)
  pushToast(kind, title, body);
  if (!isTauri()) return;
  try {
    if (await ensurePermission()) {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title, body });
    }
  } catch {
    /* ignore */
  }
}
