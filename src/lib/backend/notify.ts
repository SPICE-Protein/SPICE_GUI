// Notification helper: OS notification (Tauri plugin) + always show an in-app pixel toast.
import { isTauri } from '$lib/backend/api';
import { pushToast, type ToastKind } from '../ui/toast.svelte.ts';

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
