// Raster import and image processing for the annotator. TIFF files (8/16-bit
// scanner output, LZW or Deflate) go through UTIF and are re-encoded as PNG so
// the project remains a single portable JSON document.
import { clamp, emptyPanel, type Panel } from './types';

export interface PanelArt {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Present only for export artwork that is embedded in the SVG. */
  dataUrl?: string;
}

const imageCache = new Map<string, HTMLImageElement>();

export function clearImageCache() {
  imageCache.clear();
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
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

function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function isTiff(file: File): boolean {
  return file.type === 'image/tiff' || fileExtension(file.name) === 'tif' || fileExtension(file.name) === 'tiff';
}

function supportedMime(file: File): string | null {
  if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') return file.type;
  const ext = fileExtension(file.name);
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

function readDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file.type ? file : new Blob([file], { type: mime }));
  });
}

async function decodeTiff(file: File): Promise<Panel> {
  const UTIF = (await import('utif2')) as unknown as {
    decode(buffer: ArrayBuffer): unknown[];
    decodeImage(buffer: ArrayBuffer, ifd: unknown): void;
    toRGBA8(ifd: unknown): Uint8Array;
  };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buffer);
  if (!ifds?.length) throw new Error('TIFF contains no image');
  const ifd = ifds[0] as { width?: number; height?: number };
  UTIF.decodeImage(buffer, ifd);
  const width = Math.round(ifd.width ?? 0);
  const height = Math.round(ifd.height ?? 0);
  if (width <= 0 || height <= 0) throw new Error('TIFF has invalid dimensions');
  const rgba = UTIF.toRGBA8(ifd);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return emptyPanel(file.name, dataUrl, width, height, 'image/png');
}

/** Decode one user file into a panel. Throws for unsupported or corrupt input. */
export async function fileToPanel(file: File): Promise<Panel> {
  if (isTiff(file)) return decodeTiff(file);
  const mime = supportedMime(file);
  if (!mime) throw new Error('Unsupported image format');
  const dataUrl = await readDataUrl(file, mime);
  const image = await loadImageElement(dataUrl);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image has no pixels');
  return emptyPanel(file.name, dataUrl, image.naturalWidth, image.naturalHeight, mime);
}

let filterSupport: boolean | null = null;

/** Probe with a real draw: some engines expose the property but ignore it. */
function canvasFilterSupported(): boolean {
  if (filterSupport != null) return filterSupport;
  try {
    const source = document.createElement('canvas');
    source.width = 1;
    source.height = 1;
    const sourceCtx = source.getContext('2d');
    const target = document.createElement('canvas');
    target.width = 1;
    target.height = 1;
    const targetCtx = target.getContext('2d');
    if (!sourceCtx || !targetCtx) {
      filterSupport = false;
      return false;
    }
    sourceCtx.fillStyle = '#808080';
    sourceCtx.fillRect(0, 0, 1, 1);
    targetCtx.filter = 'brightness(0%)';
    targetCtx.drawImage(source, 0, 0);
    const pixel = targetCtx.getImageData(0, 0, 1, 1).data;
    filterSupport = pixel[0] < 20 && pixel[3] > 0;
  } catch {
    filterSupport = false;
  }
  return filterSupport;
}

/** WebKit builds without ctx.filter still get real brightness/contrast. */
function applyLevels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  brightness: number,
  contrast: number,
) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const bf = brightness / 100;
  const cf = contrast / 100;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] * bf - 128) * cf + 128;
    data[i + 1] = (data[i + 1] * bf - 128) * cf + 128;
    data[i + 2] = (data[i + 2] * bf - 128) * cf + 128;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Build a drawable version of the panel. Preview art is downscaled for speed;
 * export art stays at native resolution and carries a PNG data URL for SVG.
 */
export async function buildArtwork(
  panel: Panel,
  maxDimension = 0,
  withDataUrl = false,
): Promise<PanelArt> {
  const image = await loadImageElement(panel.dataUrl);
  const naturalWidth = panel.width || image.naturalWidth;
  const naturalHeight = panel.height || image.naturalHeight;
  const longest = Math.max(naturalWidth, naturalHeight);
  const scale = maxDimension > 0 && longest > maxDimension ? maxDimension / longest : 1;
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const needsFilter = clamp(panel.brightness, 10, 300) !== 100 || clamp(panel.contrast, 10, 300) !== 100;
  if (!needsFilter && !withDataUrl && width === naturalWidth && height === naturalHeight) {
    return { source: image, width: naturalWidth, height: naturalHeight };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const brightness = clamp(panel.brightness, 10, 300);
  const contrast = clamp(panel.contrast, 10, 300);
  const useFilter = needsFilter && canvasFilterSupported();
  if (useFilter) {
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  }
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = 'none';
  if (needsFilter && !useFilter) applyLevels(ctx, width, height, brightness, contrast);
  return {
    source: canvas,
    width,
    height,
    dataUrl: withDataUrl ? canvas.toDataURL('image/png') : undefined,
  };
}
