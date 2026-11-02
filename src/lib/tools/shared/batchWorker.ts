// Run a folder batch in a module worker, with a transparent main-thread
// fallback for environments that cannot construct one (for example an older
// WebView without OffscreenCanvas support).

export interface BatchWorkerProgress {
  done: number;
  total: number;
  name: string;
}

export interface BatchWorkerJob<T> {
  createWorker: () => Worker;
  files: File[];
  payload: unknown;
  onProgress?: (progress: BatchWorkerProgress) => void;
  /** Runs on the main thread when a worker cannot be constructed or dies. */
  fallback: () => Promise<T>;
}

type WorkerMessage =
  | { type: 'progress'; done: number; total: number; name: string }
  | { type: 'result'; result: unknown }
  | { type: 'error'; error: string };

export async function runBatchJob<T>(job: BatchWorkerJob<T>): Promise<T> {
  // Offscreen canvas and bitmap decoding are worker-only requirements; an
  // older WebView can still run the batch on the main thread.
  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof createImageBitmap === 'undefined'
  ) {
    return job.fallback();
  }

  let worker: Worker;
  try {
    worker = job.createWorker();
  } catch {
    return job.fallback();
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };

    const failOver = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Keep the batch usable, but leave a trace for diagnostics.
      console.warn('[batch] worker unavailable; falling back to the main thread', reason);
      job.fallback().then(resolve, reject);
    };

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === 'progress') {
        job.onProgress?.({ done: message.done, total: message.total, name: message.name });
        return;
      }
      settled = true;
      cleanup();
      if (message.type === 'result') resolve(message.result as T);
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      failOver(event.message || 'worker error');
    };
    worker.onmessageerror = () => failOver('worker message could not be cloned');

    try {
      worker.postMessage({ files: job.files, payload: job.payload });
    } catch (error) {
      failOver(error);
    }
  });
}
