// Main-thread half of the scripting layer: owns the worker lifecycle, enforces
// the timeout, and collects logs. One worker per run keeps a runaway script
// fully isolated and makes timeout recovery a single terminate().

import {
  SCRIPT_TIMEOUT_MS,
  type ScriptLogEntry,
  type ScriptRunOptions,
  type ScriptRunResult,
  type ScriptWorkerResponse,
  type ScriptWorkerRun,
} from './types';

export function runScript(options: ScriptRunOptions): Promise<ScriptRunResult> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  const logs: ScriptLogEntry[] = [];

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./lua.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const finish = (result: Omit<ScriptRunResult, 'logs' | 'durationMs'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.terminate();
      resolve({
        ...result,
        logs,
        durationMs: Math.round(performance.now() - started),
      });
    };

    worker.onmessage = (event: MessageEvent<ScriptWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'log') {
        logs.push(message.entry);
        options.onLog?.(message.entry);
        return;
      }
      if (message.type === 'fatal') {
        finish({ ok: false, error: message.error });
        return;
      }
      finish({
        ok: !message.error,
        valueText: message.valueText || undefined,
        patch: message.patch,
        error: message.error,
      });
    };

    worker.onerror = (event) => {
      finish({ ok: false, error: event.message || 'Lua worker crashed' });
    };

    timer = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        error: `Script timed out after ${Math.round(timeoutMs / 1000)} s`,
      });
    }, timeoutMs);

    // Svelte state is proxied; structured clone refuses proxies, so copy every
    // nested container into plain data before crossing the worker boundary.
    const request: ScriptWorkerRun = {
      type: 'run',
      name: options.name,
      source: options.source,
      permissions: [...options.permissions],
      document: {
        ...options.document,
        features: options.document.features.map((feature) => ({ ...feature })),
      },
      args: options.args ?? {},
    };
    worker.postMessage(request);
  });
}
