// Image import and the display pipeline. The source is decoded once, then
// orientation, fine rotation and tonal adjustments are applied on demand. The
// raw grayscale plane is kept free of display adjustments so densitometry is
// not biased by contrast or gamma.

import type { BlotCrop, BlotProject } from './types';
import {
  bytesToDataUrl,
  canvasToDataUrl,
  createCanvas,
  loadRasterImage,
  rasterHeight,
  rasterWidth,
} from '$lib/tools/shared/canvas';

export interface DecodedImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
}

export interface ProcessedImage {
  /** Adjusted canvas used for display and figure embedding. */
  canvas: HTMLCanvasElement;
  /** Unadjusted oriented canvas, used for raw grayscale extraction. */
  base: HTMLCanvasElement;
  rawGray: Float32Array;
  width: number;
  height: number;
}

const imageCache = new Map<string, HTMLImageElement>();

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && (cached.complete || !('naturalWidth' in cached))) return cached;
  const img = await loadRasterImage(src);
  imageCache.set(src, img);
  return img;
}

function isTiff(file: File): boolean {
  return /\.tiff?$/i.test(file.name) || file.type === 'image/tiff';
}

/** Decode PNG/JPEG/WebP directly and TIFF through UTIF (8/16-bit scientific
 *  exports included), always normalising the payload to a PNG data URL. */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const supported =
    /image\/(png|jpe?g|webp|bmp|gif|tiff?)/i.test(file.type) ||
    /\.(tiff?|png|jpe?g|webp|bmp|gif)$/i.test(file.name);
  if (!supported) throw new Error('Unsupported image format');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isTiff(file)) {
    const dataUrl = await bytesToDataUrl(bytes, file.type || 'image/png');
    const img = await loadImageElement(dataUrl);
    return {
      name: file.name,
      dataUrl,
      width: rasterWidth(img),
      height: rasterHeight(img),
      mime: file.type || 'image/png',
    };
  }
  const UTIF = (await import('utif2')) as unknown as {
    decode(buffer: ArrayBuffer): { width: number; height: number }[];
    decodeImage(buffer: ArrayBuffer, ifd: unknown): void;
    toRGBA8(ifd: unknown): Uint8Array;
  };
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  if (!ifds?.length) throw new Error('TIFF contains no image');
  const ifd = ifds[0];
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const width = Math.max(1, ifd.width);
  const height = Math.max(1, ifd.height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  out.data.set(rgba);
  ctx.putImageData(out, 0, 0);
  return {
    name: file.name,
    dataUrl: await canvasToDataUrl(canvas),
    width,
    height,
    mime: 'image/tiff',
  };
}

export function toGrayPlane(data: ImageData): Float32Array {
  const { width, height, data: px } = data;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    out[p] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
  }
  return out;
}

const GRAY_LOOKUP = new Uint8ClampedArray(256);
let lookupContrast = NaN;
let lookupBrightness = NaN;
let lookupGamma = NaN;
let lookupInvert = false;

function ensureLookup(project: BlotProject) {
  const { contrast, brightness, gamma, invert } = project.adjust;
  if (
    lookupContrast === contrast &&
    lookupBrightness === brightness &&
    lookupGamma === gamma &&
    lookupInvert === invert
  ) {
    return;
  }
  lookupContrast = contrast;
  lookupBrightness = brightness;
  lookupGamma = gamma;
  lookupInvert = invert;
  const g = Math.max(0.1, gamma);
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    x = (x - 0.5) * contrast + 0.5 + brightness;
    x = Math.min(1, Math.max(0, x));
    x = x ** g;
    if (invert) x = 1 - x;
    GRAY_LOOKUP[i] = Math.round(x * 255);
  }
}

function applyAdjustments(px: Uint8ClampedArray, project: BlotProject) {
  ensureLookup(project);
  const grayscale = project.adjust.display === 'gray';
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (grayscale) {
      const v = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      const out = GRAY_LOOKUP[v];
      px[i] = out;
      px[i + 1] = out;
      px[i + 2] = out;
    } else {
      px[i] = GRAY_LOOKUP[r];
      px[i + 1] = GRAY_LOOKUP[g];
      px[i + 2] = GRAY_LOOKUP[b];
    }
  }
}

function orientedSize(width: number, height: number, orient: number, rotation: number) {
  const swap = orient % 2 === 1;
  const ow = swap ? height : width;
  const oh = swap ? width : height;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.max(1, Math.round(ow * cos + oh * sin)),
    height: Math.max(1, Math.round(ow * sin + oh * cos)),
  };
}

export function renderProcessed(
  project: BlotProject,
  img: HTMLImageElement,
): ProcessedImage {
  const w = rasterWidth(img);
  const h = rasterHeight(img);
  const orient = ((project.orient % 4) + 4) % 4;
  const size = orientedSize(w, h, orient, project.rotation);
  const rad = (project.rotation * Math.PI) / 180;
  const base = createCanvas(size.width, size.height);
  const bctx = base.getContext('2d', { willReadFrequently: true })!;
  // Rotation corners are filled with white so a normal membrane scan keeps a
  // light surround; the display inversion then turns them dark consistently.
  bctx.fillStyle = '#fff';
  bctx.fillRect(0, 0, base.width, base.height);
  bctx.save();
  bctx.translate(base.width / 2, base.height / 2);
  bctx.rotate(rad + (orient * Math.PI) / 2);
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(img, -w / 2, -h / 2);
  bctx.restore();

  const rawData = bctx.getImageData(0, 0, base.width, base.height);
  const rawGray = toGrayPlane(rawData);

  const display = createCanvas(base.width, base.height);
  const dctx = display.getContext('2d', { willReadFrequently: true })!;
  dctx.putImageData(rawData, 0, 0);
  const displayData = dctx.getImageData(0, 0, display.width, display.height);
  applyAdjustments(displayData.data, project);
  dctx.putImageData(displayData, 0, 0);

  return {
    canvas: display,
    base,
    rawGray,
    width: display.width,
    height: display.height,
  };
}

/** Fine-rotation coordinate transform, so lane and band ROIs follow the gel. */
export function rotateCoordinates(
  project: BlotProject,
  oldRotation: number,
  newRotation: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const orient = ((project.orient % 4) + 4) % 4;
  const swap = orient % 2 === 1;
  const ow = swap ? sourceHeight : sourceWidth;
  const oh = swap ? sourceWidth : sourceHeight;
  const dims = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return { w: ow * cos + oh * sin, h: ow * sin + oh * cos };
  };
  const oldD = dims(oldRotation);
  const newD = dims(newRotation);
  const rad = ((newRotation - oldRotation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const map = (x: number, y: number) => {
    const px = x * oldD.w - oldD.w / 2;
    const py = y * oldD.h - oldD.h / 2;
    return {
      x: (px * cos - py * sin + newD.w / 2) / newD.w,
      y: (px * sin + py * cos + newD.h / 2) / newD.h,
    };
  };
  for (const lane of project.lanes) {
    const centre = map(lane.x, 0.5);
    for (const band of lane.bands) band.y = map(lane.x, band.y).y;
    lane.x = centre.x;
  }
}

export function cropPixels(project: BlotProject, width: number, height: number) {
  const { left, top, right, bottom } = project.crop;
  return {
    sx: Math.round(left * width),
    sy: Math.round(top * height),
    sw: Math.max(8, Math.round((1 - left - right) * width)),
    sh: Math.max(8, Math.round((1 - top - bottom) * height)),
  };
}

/** Cropped copy of the adjusted canvas for previews and exports. */
export function cropCanvas(
  source: HTMLCanvasElement,
  crop: BlotCrop,
): HTMLCanvasElement {
  const sx = Math.round(crop.left * source.width);
  const sy = Math.round(crop.top * source.height);
  const sw = Math.max(8, Math.round((1 - crop.left - crop.right) * source.width));
  const sh = Math.max(8, Math.round((1 - crop.top - crop.bottom) * source.height));
  const out = createCanvas(sw, sh);
  out.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Border-ring median of the raw plane, a robust global background estimate. */
export function globalBackground(gray: Float32Array, width: number, height: number): number {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const values: number[] = [];
  const stepX = Math.max(1, Math.floor(width / 400));
  const stepY = Math.max(1, Math.floor(height / 400));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) {
        values.push(1 - gray[y * width + x]);
      }
    }
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
