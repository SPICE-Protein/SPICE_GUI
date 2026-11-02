// Module worker for the gel folder batch. Processing and PNG encoding happen
// here; the component saves the returned ZIP payload on the main thread.
import { buildGelBatch, type GelBatchOptions } from './batch';
import type { ZipEntry } from '$lib/repro/zip';

interface Request {
  files: File[];
  payload: { ladderId?: string; dpi?: number };
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
    const options: GelBatchOptions = {
      ladderId: event.data.payload.ladderId,
      dpi: event.data.payload.dpi,
      onProgress: (progress) => {
        ctx.postMessage({
          type: 'progress',
          done: progress.current,
          total: progress.total,
          name: progress.name,
        });
      },
    };
    const result = await buildGelBatch(event.data.files, options);
    ctx.postMessage({ type: 'result', result }, transferable(result.entries));
  } catch (error) {
    ctx.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
