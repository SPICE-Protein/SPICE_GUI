// Intensity line profiles sampled from the rendered RGB composite.
// Sampling is deliberately separate from drawing: the source canvas contains
// only the composited panel pixels, so the measurement line and every other
// annotation stay out of the data they describe.
import { PX_PER_MM, clamp, type AnnotateProject, type ProfileAnnotation } from './types';
import type { FigureGeometry } from './layout';
import { renderCompositeFigure, type ArtResolver } from './render';

export const PROFILE_DEFAULT_SAMPLES = 192;
export const PROFILE_MIN_SAMPLES = 16;
export const PROFILE_MAX_SAMPLES = 1024;

export interface ProfilePoint {
  index: number;
  /** Position along the segment, 0..1. */
  t: number;
  x: number;
  y: number;
  distancePx: number;
  distanceMm: number;
  /** Rec. 709 luminance of the composite pixel, 0..255. */
  intensity: number;
  /** Intensity divided by 255. */
  normalized: number;
}

export interface ProfileSeries {
  annotationId: string;
  name: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  samples: number;
  points: ProfilePoint[];
  min: number;
  max: number;
  mean: number;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Sample evenly spaced points along a line from a composite RGBA buffer.
 * Coordinates are figure CSS pixels; the buffer must use the same space.
 */
export function sampleProfile(
  ann: ProfileAnnotation,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  name = 'Profile',
): ProfileSeries {
  const count = Math.round(clamp(ann.samples, PROFILE_MIN_SAMPLES, PROFILE_MAX_SAMPLES));
  const dx = ann.x2 - ann.x1;
  const dy = ann.y2 - ann.y1;
  const lengthPx = Math.hypot(dx, dy);
  const points: ProfilePoint[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (let index = 0; index < count; index++) {
    const t = count <= 1 ? 0 : index / (count - 1);
    const x = ann.x1 + dx * t;
    const y = ann.y1 + dy * t;
    const px = Math.round(clamp(x, 0, Math.max(0, width - 1)));
    const py = Math.round(clamp(y, 0, Math.max(0, height - 1)));
    const offset = (py * width + px) * 4;
    const intensity = luminance(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
    const distancePx = lengthPx * t;
    points.push({
      index,
      t,
      x,
      y,
      distancePx,
      distanceMm: distancePx / PX_PER_MM,
      intensity,
      normalized: intensity / 255,
    });
    if (intensity < min) min = intensity;
    if (intensity > max) max = intensity;
    sum += intensity;
  }

  return {
    annotationId: ann.id,
    name,
    color: ann.color,
    x1: ann.x1,
    y1: ann.y1,
    x2: ann.x2,
    y2: ann.y2,
    samples: count,
    points,
    min: points.length ? min : 0,
    max: points.length ? max : 0,
    mean: points.length ? sum / points.length : 0,
  };
}

/** Render the composite and sample one profile annotation from it. */
export function computeProfile(
  ann: ProfileAnnotation,
  project: AnnotateProject,
  geom: FigureGeometry,
  resolve: ArtResolver,
  name = 'Profile',
): ProfileSeries {
  const width = Math.max(1, Math.round(geom.width));
  const height = Math.max(1, Math.round(geom.height));
  const canvas = renderCompositeFigure(project, geom, resolve, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const data = ctx.getImageData(0, 0, width, height).data;
  return sampleProfile(ann, data, width, height, name);
}

export async function collectProfiles(
  project: AnnotateProject,
  geom: FigureGeometry,
  resolve: ArtResolver,
): Promise<ProfileSeries[]> {
  const annotations = project.annotations.filter(
    (ann): ann is ProfileAnnotation => ann.kind === 'profile',
  );
  if (!annotations.length) return [];
  const width = Math.max(1, Math.round(geom.width));
  const height = Math.max(1, Math.round(geom.height));
  const canvas = renderCompositeFigure(project, geom, resolve, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const data = ctx.getImageData(0, 0, width, height).data;
  return annotations.map((ann, index) => sampleProfile(ann, data, width, height, `Profile ${index + 1}`));
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function profileCsv(series: ProfileSeries[]): string {
  const header =
    'profile,annotation_id,index,distance_px,distance_mm,x_px,y_px,intensity_0_255,intensity_norm';
  const rows = [header];
  for (const item of series) {
    for (const point of item.points) {
      rows.push(
        [
          csvCell(item.name),
          csvCell(item.annotationId),
          String(point.index),
          point.distancePx.toFixed(3),
          point.distanceMm.toFixed(4),
          point.x.toFixed(2),
          point.y.toFixed(2),
          point.intensity.toFixed(3),
          point.normalized.toFixed(5),
        ].join(','),
      );
    }
  }
  return `${rows.join('\n')}\n`;
}

/** SVG path for a compact plot, normalised to the supplied box. */
export function profilePlotPath(series: ProfileSeries, width: number, height: number): string {
  if (!series.points.length) return '';
  const pad = 2;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  return series.points
    .map((point, index) => {
      const x = pad + (index / Math.max(1, series.points.length - 1)) * innerW;
      const y = pad + (1 - point.normalized) * innerH;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function profileStatsText(series: ProfileSeries): string {
  return `${series.min.toFixed(1)} / ${series.mean.toFixed(1)} / ${series.max.toFixed(1)}`;
}
