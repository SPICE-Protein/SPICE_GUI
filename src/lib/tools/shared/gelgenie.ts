// Frontend bridge to the native GelGenie U-Net. The model is downloaded on
// demand (same pattern as the SPICE fold model) and inference runs in Rust
// through `ort`; the webview only sends an 8-bit grayscale plane and receives
// normalised band boxes + lane clusters.

import { Channel, invoke } from '@tauri-apps/api/core';

export const GELGENIE_MODEL_URL =
  'https://huggingface.co/mattaq/GelGenie-Universal-FineTune-May-2024/resolve/main/onnx_checkpoints/unet_dec_21_finetune_epoch_590.onnx';

export interface GelGenieStatus {
  ok: boolean;
  modelPath?: string;
  sizeBytes?: number;
  modelUrl?: string;
  modelSha256?: string;
  error?: string;
}

export interface GelGenieBand {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  intensity: number;
  lane: number;
}

export interface GelGenieLane {
  x: number;
  width: number;
  /** Indices into `bands`, sorted by x within the lane. */
  bands: number[];
}

export interface GelGenieResult {
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
  bands: GelGenieBand[];
  lanes: GelGenieLane[];
  runMs: number;
}

export interface GelGenieProgress {
  done: number;
  total: number | null;
  stage: string;
}

export function gelgenieAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export async function gelgenieStatus(): Promise<GelGenieStatus> {
  if (!gelgenieAvailable()) return { ok: false, error: 'native runtime required' };
  try {
    return await invoke<GelGenieStatus>('gelgenie_status');
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function downloadGelGenie(
  url: string,
  proxy: string,
  onProgress: (progress: GelGenieProgress) => void,
): Promise<{ ok: boolean; modelPath?: string; error?: string }> {
  if (!gelgenieAvailable()) return { ok: false, error: 'native runtime required' };
  try {
    const channel = new Channel<GelGenieProgress>();
    channel.onmessage = onProgress;
    return await invoke<{ ok: boolean; modelPath?: string }>('gelgenie_download_model', {
      url: url.trim() || null,
      proxy: proxy.trim() || null,
      channel,
    });
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/** `gray` is either 0..255 or 0..1; it is converted to bytes for the backend. */
export async function segmentWithGelGenie(
  gray: Float32Array | Uint8Array,
  width: number,
  height: number,
): Promise<GelGenieResult> {
  if (!gelgenieAvailable()) throw new Error('GelGenie inference requires the desktop app');
  let bytes: Uint8Array;
  if (gray instanceof Uint8Array) {
    bytes = gray;
  } else {
    bytes = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) {
      bytes[i] = Math.max(0, Math.min(255, Math.round(gray[i] * 255)));
    }
  }
  return invoke<GelGenieResult>('gelgenie_segment', {
    request: { gray: b64(bytes), width, height },
  });
}
