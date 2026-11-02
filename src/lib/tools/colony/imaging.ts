// Image decoding and the working-image pipeline for the colony counter.
// Source images are decoded once, then a working canvas is produced by
// rotating, cropping and (optionally) downscaling. Detector input is a further
// downscaled grayscale copy; results are mapped back to working coordinates.
import type { ColonyAdjust, ColonyCrop, ColonyMarker } from './types';
import {
  bytesToDataUrl,
  canvasToDataUrl,
  createCanvas,
  loadRasterImage,
  rasterHeight,
  rasterWidth,
} from '$lib/tools/shared/canvas';

/** Hard cap for the working canvas so 50 MP phone photos stay responsive. */
export const MAX_WORK_DIM = 4096;
/** Detector resolution cap. Objects are mapped back to working pixels. */
export const MAX_DETECT_DIM = 1400;

export interface DecodedImage {
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
  name: string;
}

export interface WorkMeta {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  rotate: number;
  crop: ColonyCrop;
  /** Size of the rotated, uncropped frame. */
  rotatedWidth: number;
  rotatedHeight: number;
  /** Crop rectangle inside the rotated frame, in source pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Working pixels per rotated-frame pixel (usually <= 1). */
  scaleX: number;
  scaleY: number;
}

const imageCache = new Map<string, HTMLImageElement>();

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && (cached.complete || !('naturalWidth' in cached))) return cached;
  const img = await loadRasterImage(src);
  imageCache.set(src, img);
  return img;
}

function looksLikeTiff(file: File, bytes: Uint8Array): boolean {
  if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') return true;
  if (bytes.length < 4) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a;
  return little || big;
}

/** Decode PNG/JPEG/WebP through the browser; TIFF goes through UTIF so raw
 *  8/16-bit grayscale, LZW and Deflate files from plate imagers work too. */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeTiff(file, bytes)) {
    const mime = file.type || 'image/png';
    const dataUrl = await bytesToDataUrl(bytes, mime);
    const img = await loadImageElement(dataUrl);
    return {
      dataUrl,
      width: rasterWidth(img),
      height: rasterHeight(img),
      mime,
      name: file.name,
    };
  }
  const UTIF = (await import('utif2')) as unknown as {
    decode(buffer: ArrayBuffer): any[];
    decodeImage(buffer: ArrayBuffer, ifd: any): void;
    toRGBA8(ifd: any): Uint8Array;
  };
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  if (!ifds?.length) throw new Error('TIFF contains no image');
  const ifd = ifds[0];
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const width = ifd.width as number;
  const height = ifd.height as number;
  if (!width || !height) throw new Error('TIFF has invalid dimensions');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  out.data.set(rgba);
  ctx.putImageData(out, 0, 0);
  return {
    dataUrl: await canvasToDataUrl(canvas),
    width,
    height,
    mime: 'image/tiff',
    name: file.name,
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.4, Math.max(0, value));
}

export function cropRect(crop: ColonyCrop, rotatedWidth: number, rotatedHeight: number) {
  const left = clampFraction(crop.left);
  const right = clampFraction(crop.right);
  const top = clampFraction(crop.top);
  const bottom = clampFraction(crop.bottom);
  const sx = Math.round(left * rotatedWidth);
  const sy = Math.round(top * rotatedHeight);
  const sw = Math.max(8, rotatedWidth - sx - Math.round(right * rotatedWidth));
  const sh = Math.max(8, rotatedHeight - sy - Math.round(bottom * rotatedHeight));
  return { sx, sy, sw, sh };
}

/** Rotate (quarter turns clockwise), crop and cap the working canvas. */
export function buildWorkCanvas(img: HTMLImageElement, rotate: number, crop: ColonyCrop): WorkMeta {
  const width = rasterWidth(img);
  const height = rasterHeight(img);
  const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;
  const swap = r === 90 || r === 270;
  const rotatedWidth = swap ? height : width;
  const rotatedHeight = swap ? width : height;
  const { sx, sy, sw, sh } = cropRect(crop, rotatedWidth, rotatedHeight);
  const scale = Math.min(1, MAX_WORK_DIM / Math.max(sw, sh));
  const outWidth = Math.max(1, Math.round(sw * scale));
  const outHeight = Math.max(1, Math.round(sh * scale));
  const canvas = createCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scaleX = outWidth / sw;
  const scaleY = outHeight / sh;
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  ctx.translate(-sx, -sy);
  ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -width / 2, -height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return {
    canvas,
    width: outWidth,
    height: outHeight,
    naturalWidth: width,
    naturalHeight: height,
    rotate: r,
    crop: { ...crop },
    rotatedWidth,
    rotatedHeight,
    sx,
    sy,
    sw,
    sh,
    scaleX,
    scaleY,
  };
}

/** Working coordinates -> rotated-frame source coordinates. */
export function workToRotated(meta: WorkMeta, x: number, y: number) {
  return {
    x: (x + 0.5) / meta.scaleX - 0.5 + meta.sx,
    y: (y + 0.5) / meta.scaleY - 0.5 + meta.sy,
  };
}

/** Rotated-frame source coordinates -> working coordinates. */
export function rotatedToWork(meta: WorkMeta, x: number, y: number) {
  return {
    x: (x - meta.sx + 0.5) * meta.scaleX - 0.5,
    y: (y - meta.sy + 0.5) * meta.scaleY - 0.5,
  };
}

/** Carry markers through a rotate/crop/rebuild. Markers outside the new
 *  frame are dropped; areas follow the working-resolution change. */
export function transformMarkersBetween(oldMeta: WorkMeta, newMeta: WorkMeta, markers: ColonyMarker[]): ColonyMarker[] {
  const delta = ((newMeta.rotate - oldMeta.rotate) % 360 + 360) % 360;
  const oldRW = oldMeta.rotatedWidth;
  const oldRH = oldMeta.rotatedHeight;
  const areaFactor =
    (newMeta.scaleX * newMeta.scaleY) / Math.max(1e-9, oldMeta.scaleX * oldMeta.scaleY);
  const radiusFactor = Math.sqrt(areaFactor);
  const out: ColonyMarker[] = [];
  for (const marker of markers) {
    const old = workToRotated(oldMeta, marker.x, marker.y);
    const u = old.x / oldRW;
    const v = old.y / oldRH;
    let nu = u;
    let nv = v;
    if (delta === 90) {
      nu = 1 - v;
      nv = u;
    } else if (delta === 180) {
      nu = 1 - u;
      nv = 1 - v;
    } else if (delta === 270) {
      nu = v;
      nv = 1 - u;
    }
    const next = rotatedToWork(newMeta, nu * newMeta.rotatedWidth, nv * newMeta.rotatedHeight);
    if (next.x < -0.5 || next.y < -0.5 || next.x > newMeta.width - 0.5 || next.y > newMeta.height - 0.5) {
      continue;
    }
    out.push({
      ...marker,
      x: next.x,
      y: next.y,
      radius: marker.radius * radiusFactor,
      area: marker.area * areaFactor,
    });
  }
  return out;
}

/** Re-render brightness/contrast/grayscale/invert at working resolution. */
export function renderAdjusted(source: HTMLCanvasElement, adjust: ColonyAdjust): HTMLCanvasElement {
  const noColorChange = !adjust.grayscale && !adjust.invert && Math.abs(adjust.contrast - 1) < 1e-4 && Math.abs(adjust.brightness) < 1e-4;
  if (noColorChange) return source;
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const contrast = Math.max(0.1, adjust.contrast);
  const offset = adjust.brightness / 255;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = (i / 255 - 0.5) * contrast + 0.5 + offset;
    v = Math.min(1, Math.max(0, v));
    if (adjust.invert) v = 1 - v;
    lut[i] = Math.round(v * 255);
  }
  for (let i = 0; i < data.length; i += 4) {
    if (adjust.grayscale) {
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const v = lut[lum < 0 ? 0 : lum > 255 ? 255 : Math.round(lum)];
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export interface ScaledCanvas {
  canvas: HTMLCanvasElement;
  scaleX: number;
  scaleY: number;
}

export function downscaleCanvas(source: HTMLCanvasElement, maxDim: number): ScaledCanvas {
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  if (scale >= 1) return { canvas: source, scaleX: 1, scaleY: 1 };
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, scaleX: width / source.width, scaleY: height / source.height };
}

/** Luminance plane (0..255) used by the segmenter. */
export function extractGray(canvas: HTMLCanvasElement): { gray: Float32Array; width: number; height: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const width = canvas.width;
  const height = canvas.height;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return { gray, width, height };
}

/** Binary mask preview canvas (foreground in cyan). */
export function maskPreviewCanvas(mask: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    data[p] = 76;
    data[p + 1] = 214;
    data[p + 2] = 255;
    data[p + 3] = 110;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Export-resolution binary mask (white foreground, black background). */
export function maskExportCanvas(mask: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    const p = i * 4;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
