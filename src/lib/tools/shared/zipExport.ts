// Main-thread ZIP saving. Kept separate from the worker-safe helpers so a
// module worker never imports the Tauri backend or Paraglide runtime.
import { backend } from '$lib/backend/api';
import { zipStore, type ZipEntry } from '$lib/repro/zip';

export async function saveZip(
  fileName: string,
  entries: ZipEntry[],
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const bytes = zipStore(entries);
  const r = await backend.saveExport(fileName.endsWith('.zip') ? fileName : `${fileName}.zip`, bytes);
  return r.data?.saved ? { ok: true, path: r.data.path } : { ok: false, error: r.error };
}
