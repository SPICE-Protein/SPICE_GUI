// Canvas and raster helpers that work on both the main thread and in a
// module worker. Workers have no DOM, so they use OffscreenCanvas and
// createImageBitmap instead. Everything here keeps the HTMLCanvasElement
// return type cast so the existing rendering code stays unchanged.

/** True when running without a DOM (a dedicated worker). */
export function isWorkerRuntime(): boolean {
  return typeof document === 'undefined';
}

/**
 * Create a canvas in either environment. The return type is deliberately
 * HTMLCanvasElement: callers only use the shared 2D subset, and at runtime a
 * worker receives an OffscreenCanvas.
 */
export function createCanvas(width = 1, height = 1): HTMLCanvasElement {
  let canvas: HTMLCanvasElement;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
  } else {
    throw new Error('Canvas is not available in this environment');
  }
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Encode a canvas to PNG bytes on either thread. */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const offscreen = canvas as unknown as {
    convertToBlob?: (options?: { type?: string }) => Promise<Blob>;
    toBlob?: (callback: (blob: Blob | null) => void, type?: string) => void;
  };
  let blob: Blob;
  if (typeof offscreen.convertToBlob === 'function') {
    blob = await offscreen.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise<Blob>((resolve, reject) =>
      offscreen.toBlob!((value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/** Synchronous data URL on the main thread, async fallback in a worker. */
export async function canvasToDataUrl(canvas: HTMLCanvasElement, type = 'image/png'): Promise<string> {
  const url = (canvas as unknown as { toDataURL?: (mime: string) => string }).toDataURL;
  if (typeof url === 'function') {
    try {
      return url.call(canvas, type);
    } catch {
      // OffscreenCanvas has no toDataURL; fall through to PNG bytes.
    }
  }
  return bytesToDataUrl(await canvasToPngBytes(canvas), type);
}

/** Base64 encode without FileReader, which is absent in workers. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Build a data URL without a FileReader round-trip. */
export async function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
  const bytes = meta.includes(';base64')
    ? base64ToBytes(body)
    : new TextEncoder().encode(decodeURIComponent(body));
  return new Blob([bytes as unknown as BlobPart], { type: mime });
}

/**
 * Load an image from a data URL. The main thread returns an HTMLImageElement;
 * a worker returns an ImageBitmap cast to the same type. Callers must use
 * rasterWidth/rasterHeight instead of naturalWidth/naturalHeight.
 */
export async function loadRasterImage(src: string): Promise<HTMLImageElement> {
  if (typeof document !== 'undefined') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = src;
    });
  }
  if (typeof createImageBitmap === 'function') {
    return (await createImageBitmap(dataUrlToBlob(src))) as unknown as HTMLImageElement;
  }
  throw new Error('Image decoding is not available in this worker');
}

export function rasterWidth(img: HTMLImageElement): number {
  return 'naturalWidth' in img ? img.naturalWidth : (img as unknown as ImageBitmap).width;
}

export function rasterHeight(img: HTMLImageElement): number {
  return 'naturalHeight' in img ? img.naturalHeight : (img as unknown as ImageBitmap).height;
}
