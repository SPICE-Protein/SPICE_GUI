// Thin file wrappers for SPICE_PROJECT persistence so the store never imports
// backend directly. Mirrors the app-wide convention: Tauri dialog or silent
// direct write; browser mode = Blob download via saveExport fallback.
import { backend, isTauri } from '$lib/backend/api';

export interface WriteResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  /** true when nothing was really written (browser snapshot-only path) */
  snapshotOnly?: boolean;
  error?: string;
}

/** Silent overwrite when `filePath` is known (Tauri), otherwise native save dialog.
 *  `text` may be plain JSON or gzipped bytes — both flow through unchanged. */
export async function writeProjectText(text: string | Uint8Array, name: string, filePath: string | null, allowDialog = true): Promise<WriteResult> {
  if (filePath && isTauri()) {
    const r = await backend.saveFileDirect(filePath, text);
    if (r.data === true && !r.error) return { saved: true, path: filePath };
    // fall through to dialog if direct write failed
    if (!allowDialog) return { saved: false, snapshotOnly: true, error: r.error ?? 'direct write failed' };
  }
  if (!allowDialog) {
    // Autosave path must never raise a dialog.
    return { saved: false, snapshotOnly: !isTauri(), canceled: !filePath };
  }
  const r = await backend.saveExport(`${name || 'project'}.spiceproj`, text);
  if (r.data?.saved && r.data.path) return { saved: true, path: r.data.path };
  if (r.error) return { saved: false, canceled: true, error: r.error };
  if (r.data?.saved) return { saved: true }; // browser Blob download — "saved" but path unknown
  return { saved: false, canceled: true };
}

/** Always asks for a location (Save As). */
export async function writeProjectWithDialog(text: string | Uint8Array, name: string): Promise<WriteResult> {
  return writeProjectText(text, name, null, true);
}
