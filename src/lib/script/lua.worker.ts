/// <reference lib="webworker" />

// Lua VM worker. One engine per run, with only the standard libraries a
// computational script needs: base, coroutine, table, string, utf8, and math.
// `io`, `os`, `package`, and `debug` are never opened, and the file loaders are
// removed from the base library.
//
// Everything reachable from Lua lives on the `spice` table below. Document
// changes are returned as a patch and applied by the UI after review.

import { LuaFactory, LuaLibraries } from 'wasmoon';
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import { calculatePercentGC, getAminoAcidStringFromSequenceString, getReverseComplementSequenceString } from '$lib/genome/sequence';
import { optimizeCodonsMultiObjective } from '$lib/genome/codonOptimization';
import { formatScriptValue, sanitizePatch } from './model';
import type {
  ScriptLogEntry,
  ScriptPatch,
  ScriptWorkerResponse,
  ScriptWorkerRun,
} from './types';

const MAX_LOG_ENTRIES = 500;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function post(message: ScriptWorkerResponse) {
  self.postMessage(message);
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function stringifyLuaValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'nil';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function numericOption(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function buildSpiceApi(
  request: ScriptWorkerRun,
  log: (level: ScriptLogEntry['level'], message: string) => void,
  proposePatch: (patch: ScriptPatch) => void,
) {
  const canWrite = request.permissions.includes('doc:write');
  let patchProposed = false;
  const document = request.document;

  return {
    apiVersion: 1,
    args: request.args ?? {},

    log: (message: unknown) => log('log', stringifyLuaValue(message)),
    warn: (message: unknown) => log('warn', stringifyLuaValue(message)),
    error: (message: unknown) => log('error', stringifyLuaValue(message)),

    doc: {
      kind: document.kind,
      name: document.name,
      sequence: document.sequence,
      length: document.sequence.length,
      topology: document.topology,
      features: document.features,
      apply: (input: unknown) => {
        if (!canWrite) throw new Error('This script does not have the doc:write permission');
        if (patchProposed) throw new Error('apply() can only be called once per run');
        const { patch, error } = sanitizePatch(input);
        if (!patch) throw new Error(error ?? 'Invalid patch');
        patchProposed = true;
        proposePatch(patch);
        log('log', `Patch proposed (${patch.sequence ? `${patch.sequence.length} bp` : 'name only'}).`);
        return true;
      },
    },

    seq: {
      // Lua strings are 1-based and inclusive on both ends.
      sub: (sequence: unknown, first: unknown, last: unknown) => {
        const text = String(sequence ?? '');
        const start = Math.max(1, Math.floor(Number(first) || 1));
        const end = Math.min(text.length, Math.floor(Number(last) || text.length));
        return end < start ? '' : text.slice(start - 1, end);
      },
      gc: (sequence: unknown) => calculatePercentGC(String(sequence ?? '')),
      revcomp: (sequence: unknown) => getReverseComplementSequenceString(String(sequence ?? '')),
      translate: (sequence: unknown) => getAminoAcidStringFromSequenceString(String(sequence ?? '')),
    },

    design: {
      codonOptimize: (protein: unknown, options: Record<string, unknown> = {}) => {
        const host = options?.host === 'yeast' || options?.host === 'human' ? options.host : 'ecoli';
        const forbiddenMotifs = Array.isArray(options?.forbiddenMotifs)
          ? options.forbiddenMotifs.map((motif) => String(motif))
          : undefined;
        const result = optimizeCodonsMultiObjective(String(protein ?? ''), {
          host,
          targetGc: numericOption(options?.targetGc),
          gcWindow: numericOption(options?.gcWindow),
          maxHomopolymer: numericOption(options?.maxHomopolymer),
          forbiddenMotifs,
          seed: numericOption(options?.seed),
          iterations: numericOption(options?.iterations),
        });
        return {
          sequence: result.sequence,
          cai: result.cai,
          gc: result.gc,
          iterations: result.iterations,
          violations: result.violations,
        };
      },
    },
  };
}

async function run(request: ScriptWorkerRun) {
  const logs: ScriptLogEntry[] = [];
  const log = (level: ScriptLogEntry['level'], message: string) => {
    if (logs.length >= MAX_LOG_ENTRIES) return;
    const entry: ScriptLogEntry = { level, message };
    logs.push(entry);
    post({ type: 'log', entry });
  };

  let patch: ScriptPatch | undefined;
  const factory = new LuaFactory(glueWasmUrl);
  let engine: Awaited<ReturnType<LuaFactory['createEngine']>> | null = null;

  try {
    // Allocation tracing is what makes the memory cap enforceable.
    engine = await factory.createEngine({
      openStandardLibs: false,
      enableProxy: false,
      traceAllocations: true,
    });
    for (const library of [
      LuaLibraries.Base,
      LuaLibraries.Coroutine,
      LuaLibraries.Table,
      LuaLibraries.String,
      LuaLibraries.UTF8,
      LuaLibraries.Math,
    ]) {
      engine.global.loadLibrary(library);
    }
    engine.global.setMemoryMax(MAX_MEMORY_BYTES);

    // Base ships loaders that expect a package/IO layer; remove them explicitly.
    await engine.doString(
      'dofile = nil; loadfile = nil; require = nil; package = nil; io = nil; os = nil; debug = nil; collectgarbage = nil',
    );

    engine.global.set('print', (...parts: unknown[]) => {
      log('log', parts.map(stringifyLuaValue).join('\t'));
    });
    engine.global.set(
      'spice',
      buildSpiceApi(
        request,
        log,
        (nextPatch) => {
          patch = nextPatch;
        },
      ),
    );

    const value = await engine.doString(request.source);
    post({
      type: 'done',
      valueText: formatScriptValue(value),
      patch,
    });
  } catch (error) {
    post({ type: 'done', error: errorMessage(error), valueText: '', patch });
  } finally {
    try {
      engine?.global.close();
    } catch {
      // The engine may already be unusable after a Lua error; nothing to do.
    }
  }
}

self.onmessage = (event: MessageEvent<ScriptWorkerRun>) => {
  const request = event.data;
  if (!request || request.type !== 'run') return;
  void run(request).catch((error) => {
    post({ type: 'fatal', error: errorMessage(error) });
  });
};
