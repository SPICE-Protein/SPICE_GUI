// Module worker for western-blot batch processing. The worker returns the
// finished ZIP entries; only the save dialog runs on the main thread.
import { buildBlotBatch } from './batch';
import type { CsvLabels } from './render';
import type { ZipEntry } from '$lib/repro/zip';

interface Request {
  files: File[];
  payload: { defaultGroup: string; csvLabels: CsvLabels };
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

function transferable(entries: ZipEntry[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  for (const entry of entries) {
    const buffer = entry.data.buffer;
    if (buffer instanceof ArrayBuffer) seen.add(buffer);
  }
  return [...seen];
}

ctx.onmessage = async (event) => {
  try {
    const result = await buildBlotBatch(event.data.files, {
      defaultGroup: event.data.payload.defaultGroup,
      csvLabels: event.data.payload.csvLabels,
      onProgress: (done, total, name) => ctx.postMessage({ type: 'progress', done, total, name }),
    });
    ctx.postMessage({ type: 'result', result }, transferable(result.entries));
  } catch (error) {
    ctx.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
