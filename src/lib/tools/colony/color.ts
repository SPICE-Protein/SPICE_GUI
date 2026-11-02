// Optional blue/white colony classification.
//
// Markers are measured on the original color working canvas (not the grayscale
// detection copy), so the classification survives a grayscale display mode.
// A genuinely grayscale source is detected globally and every marker falls
// back to "unclassified" instead of inventing a class from RGB noise.
import type { ColonyClass, ColonyMarker } from './types';

export interface ColorSample {
  r: number;
  g: number;
  b: number;
  hue: number;
  saturation: number;
  value: number;
}

interface PixelSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function pixelSource(canvas: HTMLCanvasElement): PixelSource | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: canvas.width, height: canvas.height };
}

function rgbToHsv(r: number, g: number, b: number): { hue: number; saturation: number; value: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = -1;
  if (delta > 1e-6) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }
  return {
    hue,
    saturation: max > 0 ? delta / max : 0,
    value: max / 255,
  };
}

/**
 * True when the image carries enough chroma to justify color classification.
 * A sparse color check keeps neutral backgrounds and JPEG noise from turning
 * a grayscale plate into false blue/white calls.
 */
export function canvasHasColor(source: PixelSource): boolean {
  const step = Math.max(1, Math.round(Math.min(source.width, source.height) / 96));
  let total = 0;
  let colored = 0;
  let maxChroma = 0;
  for (let y = 0; y < source.height; y += step) {
    for (let x = 0; x < source.width; x += step) {
      const offset = (y * source.width + x) * 4;
      const r = source.data[offset];
      const g = source.data[offset + 1];
      const b = source.data[offset + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (chroma >= 18) colored++;
      if (chroma > maxChroma) maxChroma = chroma;
      total++;
    }
  }
  if (!total) return false;
  // A few strongly saturated pixels are enough for a sparse blue colony;
  // grayscale JPEG noise stays below the chroma floor.
  if (maxChroma >= 60 && colored >= 2) return true;
  return colored >= Math.max(8, total * 0.001);
}

/** Mean color inside a marker footprint; step-sampled so large plates stay snappy. */
export function sampleMarkerColor(source: PixelSource, marker: ColonyMarker): ColorSample {
  const radius = Math.max(1.5, marker.radius * 0.82);
  const step = Math.max(1, Math.floor(radius / 12));
  const minX = Math.max(0, Math.floor(marker.x - radius));
  const maxX = Math.min(source.width - 1, Math.ceil(marker.x + radius));
  const minY = Math.max(0, Math.floor(marker.y - radius));
  const maxY = Math.min(source.height - 1, Math.ceil(marker.y + radius));
  const radiusSq = radius * radius;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += step) {
    const dy = y - marker.y;
    for (let x = minX; x <= maxX; x += step) {
      const dx = x - marker.x;
      if (dx * dx + dy * dy > radiusSq) continue;
      const offset = (y * source.width + x) * 4;
      sumR += source.data[offset];
      sumG += source.data[offset + 1];
      sumB += source.data[offset + 2];
      count++;
    }
  }
  if (!count) {
    const cx = Math.max(0, Math.min(source.width - 1, Math.round(marker.x)));
    const cy = Math.max(0, Math.min(source.height - 1, Math.round(marker.y)));
    const offset = (cy * source.width + cx) * 4;
    sumR = source.data[offset];
    sumG = source.data[offset + 1];
    sumB = source.data[offset + 2];
    count = 1;
  }
  const r = sumR / count;
  const g = sumG / count;
  const b = sumB / count;
  const hsv = rgbToHsv(r, g, b);
  return { r, g, b, ...hsv };
}

/** Classify a sampled marker. The image-level color check gates grayscale input. */
export function classifyColor(sample: ColorSample, imageHasColor: boolean): ColonyClass {
  if (!imageHasColor) return 'unclassified';
  const max = Math.max(sample.r, sample.g, sample.b);
  const min = Math.min(sample.r, sample.g, sample.b);
  const chroma = max - min;
  if (max < 18 || chroma < 6) return 'unclassified';
  const saturation = max > 0 ? chroma / max : 0;
  // Pale / whitish growth: low saturation but clearly lighter than the plate.
  if (saturation <= 0.28 && max >= 70) return 'white';
  // X-gal blue ranges from cyan to violet; require visible chroma.
  if (saturation >= 0.16 && sample.hue >= 155 && sample.hue <= 310 && max >= 28) return 'blue';
  return 'unclassified';
}

/** Cheap image-level color check used when restoring a project. */
export function detectImageColor(canvas: HTMLCanvasElement): boolean {
  const source = pixelSource(canvas);
  return !!source && canvasHasColor(source);
}

export interface ClassifyResult {
  imageHasColor: boolean;
  classified: number;
}

/**
 * Measure RGB/hue for every marker and update its class unless the user has
 * overridden it manually. Returns whether the source image had usable color.
 */
export function classifyMarkers(canvas: HTMLCanvasElement, markers: ColonyMarker[]): ClassifyResult {
  const source = pixelSource(canvas);
  if (!source) {
    for (const marker of markers) {
      marker.meanR = 0;
      marker.meanG = 0;
      marker.meanB = 0;
      marker.hue = -1;
      marker.saturation = 0;
      if (!marker.classManual) marker.colonyClass = 'unclassified';
    }
    return { imageHasColor: false, classified: 0 };
  }
  const imageHasColor = canvasHasColor(source);
  if (markers.length === 0) return { imageHasColor, classified: 0 };
  let classified = 0;
  for (const marker of markers) {
    const sample = sampleMarkerColor(source, marker);
    marker.meanR = sample.r;
    marker.meanG = sample.g;
    marker.meanB = sample.b;
    marker.hue = sample.hue;
    marker.saturation = sample.saturation;
    if (!marker.classManual) {
      marker.colonyClass = classifyColor(sample, imageHasColor);
      if (marker.colonyClass !== 'unclassified') classified++;
    }
  }
  return { imageHasColor, classified };
}

/** Reset classes when the optional classification mode is switched off. */
export function clearClassification(markers: ColonyMarker[]): void {
  for (const marker of markers) {
    marker.colonyClass = 'unclassified';
    marker.classManual = false;
  }
}
