// Small worker-safe helpers shared by the folder-batch modes (gel, blot,
// colony). ZIP saving lives in zipExport.ts so a worker never imports Tauri.
import type { ZipEntry } from '$lib/repro/zip';

export const MAX_BATCH_IMAGES = 60;

export function fileBaseName(name: string, fallback = 'file'): string {
  const stem = name.replace(/\.[^.]+$/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return stem || fallback;
}

export function imageFiles(files: FileList | File[] | null | undefined): File[] {
  const list = files ? Array.from(files) : [];
  return list.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/i.test(file.name));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export async function imageFromDataUrl(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
  return img;
}

export function stringEntry(name: string, text: string): ZipEntry {
  return { name, data: new TextEncoder().encode(text) };
}

export function bytesEntry(name: string, bytes: Uint8Array): ZipEntry {
  return { name, data: bytes };
}

/** Convert a data URL to raw bytes without a network round-trip. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Uint8Array();
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}
