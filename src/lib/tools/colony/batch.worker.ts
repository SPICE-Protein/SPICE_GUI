// Module worker for colony batch counting. Segmentation, annotation and PNG
// encoding run here; the component only opens the save dialog for the ZIP.
import { runColonyBatch, type ColonyBatchInput } from './batch';
import type { ZipEntry } from '$lib/repro/zip';

interface Request {
  files: File[];
  payload: ColonyBatchInput;
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
    const result = await runColonyBatch(event.data.files, event.data.payload, (done, total, name) => {
      ctx.postMessage({ type: 'progress', done, total, name });
    });
    ctx.postMessage({ type: 'result', result }, transferable(result.entries));
  } catch (error) {
    ctx.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
