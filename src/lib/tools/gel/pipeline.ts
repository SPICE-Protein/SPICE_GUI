// Image decoding and the processed-image pipeline: orientation, fine rotation,
// crop-free pixel adjustments and the grayscale planes used by detection.
import type { GelExposure, GelProject } from './types';
import { toGrayPlane } from './gelmath';

export interface ProcessedImage {
  canvas: HTMLCanvasElement;
  /** Grayscale before display adjustments (camera data). */
  rawGray: Float32Array;
  /** Grayscale after adjustments (what detection sees). */
  gray: Float32Array;
  width: number;
  height: number;
}

const imageCache = new Map<string, HTMLImageElement>();

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = src;
  });
}

function isTiff(file: File): boolean {
  return /\.tiff?$/i.test(file.name) || file.type === 'image/tiff';
}

/** Decode PNG/JPG/BMP directly; TIFF goes through the UTIF decoder so raw
 *  8/16-bit grayscale and LZW/Deflate files from gel imagers work. */
export async function decodeExposure(file: File): Promise<GelExposure> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isTiff(file)) {
    const dataUrl = await bytesToDataUrl(bytes, file.type || 'image/png');
    const img = await loadImageElement(dataUrl);
    return {
      id: `exp_${Math.random().toString(36).slice(2, 10)}`,
      name: file.name,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      mime: file.type || 'image/png',
      originalBase64: bytesToBase64(bytes),
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  out.data.set(rgba);
  ctx.putImageData(out, 0, 0);
  return {
    id: `exp_${Math.random().toString(36).slice(2, 10)}`,
    name: file.name,
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    mime: 'image/tiff',
    originalBase64: bytesToBase64(bytes),
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Quality proxy for picking the best exposure: signal spread minus clipping. */
export function exposureScore(processed: ProcessedImage): number {
  const gray = processed.rawGray;
  let mean = 0;
  for (const v of gray) mean += v;
  mean /= Math.max(1, gray.length);
  let variance = 0;
  let clipped = 0;
  for (const v of gray) {
    variance += (v - mean) ** 2;
    if (v <= 0.004 || v >= 0.996) clipped++;
  }
  return Math.sqrt(variance / Math.max(1, gray.length)) - (clipped / Math.max(1, gray.length)) * 2;
}

export function renderProcessed(exposure: GelExposure, project: GelProject, img: HTMLImageElement): ProcessedImage {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const orient = ((project.orient % 4) + 4) % 4;
  const swap = orient % 2 === 1;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const rad = (project.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rw = Math.max(1, Math.round(ow * cos + oh * sin));
  const rh = Math.max(1, Math.round(ow * sin + oh * cos));
  const canvas = document.createElement('canvas');
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.save();
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate(rad + (orient * Math.PI) / 2);
  ctx.scale(project.mirrorH ? -1 : 1, project.mirrorV ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2);
  ctx.restore();

  const data = ctx.getImageData(0, 0, rw, rh);
  const rawGray = toGrayPlane(data);
  if (project.display === 'color') {
    return { canvas, rawGray, gray: rawGray, width: rw, height: rh };
  }
  applyAdjustments(data.data, project);
  ctx.putImageData(data, 0, 0);
  return { canvas, rawGray, gray: toGrayPlane(data), width: rw, height: rh };
}

export function applyAdjustments(px: Uint8ClampedArray, project: GelProject) {
  const { grayscale, invert, contrast, brightness, gamma } = project.adjust;
  const g = Math.max(0.2, gamma);
  const shift = (v: number) => {
    let x = v / 255;
    x = (x - 0.5) * contrast + 0.5 + brightness;
    x = Math.min(1, Math.max(0, x));
    x = x ** g;
    if (invert) x = 1 - x;
    return x * 255;
  };
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i];
    let gg = px[i + 1];
    let b = px[i + 2];
    if (grayscale) {
      const v = r * 0.299 + gg * 0.587 + b * 0.114;
      r = gg = b = v;
    }
    px[i] = shift(r);
    px[i + 1] = shift(gg);
    px[i + 2] = shift(b);
  }
}

/** Crop source rectangle in processed-image pixels. */
export function cropRect(project: GelProject, width: number, height: number) {
  const { left, top, right, bottom } = project.crop;
  return {
    sx: Math.round(left * width),
    sy: Math.round(top * height),
    sw: Math.max(8, Math.round((1 - left - right) * width)),
    sh: Math.max(8, Math.round((1 - top - bottom) * height)),
  };
}

/** Crop to a new canvas for display and figure preview. */
export function cropCanvas(processed: HTMLCanvasElement, project: GelProject): HTMLCanvasElement {
  const { sx, sy, sw, sh } = cropRect(project, processed.width, processed.height);
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d')!.drawImage(processed, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Rotate/flip every stored coordinate so annotations travel with the image. */
export function transformForFlip(project: GelProject, axis: 'h' | 'v' | '180') {
  const fx = (x: number) => (axis === 'v' ? x : 1 - x);
  const fy = (y: number) => (axis === 'h' ? y : 1 - y);
  for (const lane of project.lanes) {
    lane.x = fx(lane.x);
    for (const band of lane.bands) band.y = fy(band.y);
  }
  for (const a of project.annotations) {
    if (a.type === 'box') {
      if (axis !== 'v') a.x = 1 - a.x - a.w;
      if (axis !== 'h') a.y = 1 - a.y - a.h;
    } else if (a.type === 'bracket') {
      if (a.side === 'left' || a.side === 'right') a.start = fy(a.start), (a.end = fy(a.end));
      else a.start = fx(a.start), (a.end = fx(a.end));
      if (axis === 'h') a.side = a.side === 'left' ? 'right' : a.side === 'right' ? 'left' : a.side;
      if (axis === 'v') a.side = a.side === 'top' ? 'bottom' : a.side === 'bottom' ? 'top' : a.side;
      if (axis === '180') {
        a.side = a.side === 'left' ? 'right' : a.side === 'right' ? 'left' : a.side === 'top' ? 'bottom' : 'top';
      }
    } else if (a.type === 'sideText') {
      a.pos = axis === 'v' ? a.pos : 1 - a.pos;
      if (axis === 'h') a.side = a.side === 'left' ? 'right' : a.side === 'right' ? 'left' : a.side;
      if (axis === '180') {
        a.side = a.side === 'left' ? 'right' : a.side === 'right' ? 'left' : a.side === 'top' ? 'bottom' : 'top';
      }
    }
  }
}

/** Coordinates after a clockwise quarter turn. Lanes are re-detected by the
 *  caller; boxes, brackets and captions rotate here. */
export function transformForQuarterTurn(project: GelProject, clockwise = true) {
  for (const a of project.annotations) {
    if (a.type === 'box') {
      const x = a.x;
      const y = a.y;
      const w = a.w;
      const h = a.h;
      if (clockwise) {
        a.x = 1 - y - h;
        a.y = x;
      } else {
        a.x = y;
        a.y = 1 - x - w;
      }
      a.w = h;
      a.h = w;
    } else if (a.type === 'bracket') {
      if (a.side === 'left' || a.side === 'right') {
        const start = clockwise ? 1 - a.end : a.start;
        const end = clockwise ? 1 - a.start : a.end;
        a.side = clockwise ? 'bottom' : 'top';
        a.start = start;
        a.end = end;
      } else {
        const start = clockwise ? a.start : 1 - a.start;
        const end = clockwise ? a.end : 1 - a.end;
        a.side = clockwise ? 'left' : 'right';
        a.start = start;
        a.end = end;
      }
    } else if (a.type === 'sideText') {
      const sides: Record<string, string> = clockwise
        ? { left: 'top', top: 'right', right: 'bottom', bottom: 'left' }
        : { left: 'bottom', bottom: 'right', right: 'top', top: 'left' };
      a.side = sides[a.side] as typeof a.side;
      a.pos = clockwise ? 1 - a.pos : a.pos;
    }
  }
}

/** Rotate lane, band and annotation coordinates around the image centre when
 *  the fine rotation changes, so annotations stay on their bands. */
export function rotateProjectCoordinates(
  project: GelProject,
  oldRotation: number,
  newRotation: number,
  naturalWidth: number,
  naturalHeight: number,
) {
  const orient = ((project.orient % 4) + 4) % 4;
  const swap = orient % 2 === 1;
  const ow = swap ? naturalHeight : naturalWidth;
  const oh = swap ? naturalWidth : naturalHeight;
  const dims = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return { w: Math.max(1, ow * cos + oh * sin), h: Math.max(1, ow * sin + oh * cos) };
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
    const nx = map(lane.x, 0.5).x;
    for (const band of lane.bands) band.y = map(lane.x, band.y).y;
    lane.x = nx;
  }
  for (const a of project.annotations) {
    if (a.type === 'box') {
      const pts = [
        map(a.x, a.y),
        map(a.x + a.w, a.y),
        map(a.x, a.y + a.h),
        map(a.x + a.w, a.y + a.h),
      ];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      a.x = x0;
      a.y = y0;
      a.w = Math.max(...xs) - x0;
      a.h = Math.max(...ys) - y0;
    } else if (a.type === 'bracket') {
      if (a.side === 'left' || a.side === 'right') {
        a.start = map(0.5, a.start).y;
        a.end = map(0.5, a.end).y;
      } else {
        a.start = map(a.start, 0.5).x;
        a.end = map(a.end, 0.5).x;
      }
    } else if (a.type === 'sideText') {
      a.pos =
        a.side === 'left' || a.side === 'right' ? map(0.5, a.pos).y : map(a.pos, 0.5).x;
    }
  }
}
