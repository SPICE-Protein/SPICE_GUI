// Native gel binarization bridge. The heavy per-pixel pass runs in Rust
// (`gel::binarize_gel`); the pure-JS binarizer is only the browser fallback so
// `pnpm dev` and the web build still detect lanes without the Tauri backend.

import { invoke } from '@tauri-apps/api/core';
import { binarizeGray } from './gelmath';
import { bytesToBase64 } from './pipeline';
import {
  detectConfigKey,
  nativeBinarizeOptions,
  type GelDetectConfig,
} from './presets';

interface SignalEntry {
  width: number;
  height: number;
  signal: Float32Array;
}

/** Keyed by the processed detection plane. A plane can have several cached
 *  masks (one per channel/polarity/sensitivity combination). */
const cache = new WeakMap<Float32Array, Map<string, SignalEntry>>();

function cacheKey(config?: GelDetectConfig): string {
  return config ? detectConfigKey(config) : 'auto';
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function cachedSignal(
  gray: Float32Array,
  width: number,
  height: number,
  config?: GelDetectConfig,
): Float32Array | null {
  const hit = cache.get(gray)?.get(cacheKey(config));
  return hit && hit.width === width && hit.height === height ? hit.signal : null;
}

function jsSignal(
  gray: Float32Array,
  width: number,
  height: number,
  config?: GelDetectConfig,
): Float32Array {
  return binarizeGray(gray, width, height, config).signal;
}

async function nativeSignal(
  gray: Float32Array,
  width: number,
  height: number,
  config?: GelDetectConfig,
): Promise<Float32Array> {
  const bytes = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(gray[i] * 255)));
  }
  const args: Record<string, unknown> = {
    gray: bytesToBase64(bytes),
    width,
    height,
  };
  // Omit the options object entirely for the default preset so older backends
  // (and the three-argument E2E call) keep working.
  if (config) args.options = nativeBinarizeOptions(config);
  const result = await invoke<ArrayBuffer | number[]>('binarize_gel', args);
  const raw =
    result instanceof ArrayBuffer ? new Uint8Array(result) : Uint8Array.from(result as number[]);
  const signal = new Float32Array(width * height);
  for (let i = 0; i < signal.length; i++) signal[i] = raw[i] ? 1 : 0;
  return signal;
}

/** Threshold once and cache. Detection entry points await this before running
 *  the (synchronous) profile math. */
export async function ensureSignal(
  gray: Float32Array,
  width: number,
  height: number,
  config?: GelDetectConfig,
): Promise<Float32Array> {
  const hit = cachedSignal(gray, width, height, config);
  if (hit) return hit;
  let signal: Float32Array;
  if (isTauriRuntime()) {
    try {
      signal = await nativeSignal(gray, width, height, config);
    } catch (err) {
      console.warn('native gel binarization failed; using the JS fallback', err);
      signal = jsSignal(gray, width, height, config);
    }
  } else {
    signal = jsSignal(gray, width, height, config);
  }
  let entries = cache.get(gray);
  if (!entries) {
    entries = new Map();
    cache.set(gray, entries);
  }
  entries.set(cacheKey(config), { width, height, signal });
  return signal;
}
