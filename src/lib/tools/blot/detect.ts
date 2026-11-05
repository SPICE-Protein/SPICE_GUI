// Lane and band detection for blots. Dark bands on a light background are the
// signal, so every profile is inverted before peak picking. Pure functions over
// the raw grayscale plane; no DOM access.

import { clamp, newId, type BlotBand, type BlotCrop, type BlotLane } from './types';

export interface Peak {
  frac: number;
  value: number;
  prominence: number;
}

interface PeakOptions {
  prominenceStd?: number;
  minProminence?: number;
  minGap?: number;
  smooth?: number;
}

function smoothProfile(profile: Float32Array, window: number): Float32Array {
  if (window <= 1) return profile;
  const half = Math.floor(window / 2);
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(profile.length - 1, i + half); j++) {
      sum += profile[j];
      n++;
    }
    out[i] = sum / Math.max(1, n);
  }
  return out;
}

function meanStd(values: Float32Array): { mean: number; std: number } {
  if (!values.length) return { mean: 0, std: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return { mean, std: Math.sqrt(sq / values.length) };
}

function findPeaks(profile: Float32Array, opts: PeakOptions = {}): Peak[] {
  const smoothed = smoothProfile(profile, opts.smooth ?? 3);
  const n = smoothed.length;
  if (n < 3) return [];
  const { mean, std } = meanStd(smoothed);
  const prominenceStd = opts.prominenceStd ?? 0.6;
  const minProminence = opts.minProminence ?? 0.01;
  const minGap = Math.max(1, opts.minGap ?? 4);
  const threshold = mean + prominenceStd * std;
  const candidates: Peak[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = smoothed[i];
    if (v < threshold) continue;
    // Lenient on the rising side keeps flat-topped plateaus to one peak.
    if (v < smoothed[i - 1] || v <= smoothed[i + 1]) continue;
    const lo = Math.max(0, i - minGap * 3);
    const hi = Math.min(n, i + minGap * 3 + 1);
    let base = v;
    for (let j = lo; j < hi; j++) base = Math.min(base, smoothed[j]);
    const prominence = v - base;
    if (prominence < minProminence) continue;
    candidates.push({ frac: i / (n - 1), value: v, prominence });
  }
  candidates.sort((a, b) => b.prominence - a.prominence);
  const kept: Peak[] = [];
  const minFrac = minGap / Math.max(1, n - 1);
  for (const cand of candidates) {
    if (kept.every((k) => Math.abs(k.frac - cand.frac) >= minFrac)) kept.push(cand);
  }
  return kept.sort((a, b) => a.frac - b.frac);
}

/** Mean inverted intensity per column inside a row range. */
export function columnSignal(
  gray: Float32Array,
  width: number,
  height: number,
  y0: number,
  y1: number,
): Float32Array {
  const out = new Float32Array(width);
  const top = clamp(Math.round(y0), 0, Math.max(0, height - 1));
  const bottom = clamp(Math.round(y1), top + 1, height);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = top; y < bottom; y++) sum += 1 - gray[y * width + x];
    out[x] = sum / Math.max(1, bottom - top);
  }
  return out;
}

/** Mean inverted intensity per row inside a column range. */
export function rowSignal(
  gray: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): Float32Array {
  const out = new Float32Array(height);
  const left = clamp(Math.round(x0), 0, Math.max(0, width - 1));
  const right = clamp(Math.round(x1), left + 1, width);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = left; x < right; x++) sum += 1 - gray[y * width + x];
    out[y] = sum / Math.max(1, right - left);
  }
  return out;
}

/** Lower-envelope baseline via a grayscale opening. A moving average would
 *  cut a flat lane or band into two edge peaks; an opening removes features
 *  narrower than its window while leaving the feature itself intact. */
function openBaseline(profile: Float32Array, window: number): Float32Array {
  const n = profile.length;
  if (window < 3 || n < 3) return profile;
  const half = Math.max(1, Math.floor(window / 2));
  const eroded = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let v = Infinity;
    for (let j = lo; j <= hi; j++) v = Math.min(v, profile[j]);
    eroded[i] = v;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let v = -Infinity;
    for (let j = lo; j <= hi; j++) v = Math.max(v, eroded[j]);
    out[i] = profile[i] - v;
  }
  return out;
}

export interface DetectedLane {
  x: number;
  width: number;
}

/** Merge peaks that sit inside one lane. Smeared or overloaded bands produce
 *  two lobes, and both survive the profile peak picker; lanes are separated by
 *  at least ~half the typical spacing, so anything closer is one lane. */
function mergeClosePeaks(peaks: Peak[]): Peak[] {
  if (peaks.length < 3) return peaks;
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i].frac - peaks[i - 1].frac);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
  if (medianGap <= 0) return peaks;
  const merged: Peak[] = [];
  for (const peak of peaks) {
    const last = merged[merged.length - 1];
    if (last && peak.frac - last.frac < medianGap * 0.55) {
      if (peak.prominence > last.prominence) merged[merged.length - 1] = peak;
    } else {
      merged.push(peak);
    }
  }
  return merged;
}

/** Column-profile lane finding inside the visible crop. */
export function detectLanes(
  gray: Float32Array,
  width: number,
  height: number,
  crop: BlotCrop,
): DetectedLane[] {
  const y0 = crop.top * height;
  const y1 = (1 - crop.bottom) * height;
  const raw = columnSignal(gray, width, height, y0, y1);

  // Scanned blots often carry a dark frame or shadow on the outer columns.
  // Those peaks are huge enough to raise the mean/std threshold and hide the
  // real lanes, so keep the edges out of both the baseline and the stats.
  const edge = Math.max(1, Math.round(width * 0.02));
  const usable = width > edge * 4 ? raw.slice(edge, width - edge) : raw;
  const profile = openBaseline(usable, Math.max(9, Math.round(width * 0.1)));
  const peaks = mergeClosePeaks(
    findPeaks(profile, {
      // Smooth over a fraction of the image width so texture inside a band
      // collapses into one lane peak instead of several sub-peaks.
      prominenceStd: 0.8,
      minProminence: 0.01,
      minGap: Math.max(6, Math.round(width * 0.03)),
      smooth: Math.max(3, Math.round(width * 0.03)),
    })
      .map((peak) => ({
        ...peak,
        frac: (peak.frac * usable.length + edge) / width,
      }))
      .filter((peak) => peak.frac > 0.02 && peak.frac < 0.98),
  );
  if (peaks.length < 1) return [];
  const xs = peaks.map((peak) => peak.frac);
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0.06;
  const laneWidth = Math.max(0.012, Math.min(0.16, medianGap * 0.62));
  return xs.map((x) => ({ x, width: laneWidth }));
}

function fwhm(profile: Float32Array, index: number): number {
  const peak = profile[index];
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= Math.max(1, profile.length);
  const half = mean + (peak - mean) * 0.5;
  let l = index;
  let r = index;
  while (l > 0 && profile[l - 1] >= half) l--;
  while (r < profile.length - 1 && profile[r + 1] >= half) r++;
  return (r - l + 1) / Math.max(1, profile.length);
}

export interface DetectedBand {
  y: number;
  height: number;
}

/** Row-profile band finding inside one lane. */
export function detectBands(
  gray: Float32Array,
  width: number,
  height: number,
  lane: { x: number; width: number },
  crop: BlotCrop,
): DetectedBand[] {
  const x0 = (lane.x - lane.width / 2) * width;
  const x1 = (lane.x + lane.width / 2) * width;
  const raw = rowSignal(gray, width, height, x0, x1);
  const top = Math.round(crop.top * height);
  const bottom = Math.round((1 - crop.bottom) * height);
  const visible = raw.subarray(top, Math.max(top + 3, bottom));
  const profile = openBaseline(visible, Math.max(7, Math.round(height * 0.12)));
  const peaks = findPeaks(profile, {
    prominenceStd: 0.62,
    minProminence: 0.004,
    minGap: Math.max(4, Math.round(height * 0.008)),
    smooth: 3,
  });
  return peaks
    .slice(0, 24)
    .map((p) => {
      const local = Math.round(p.frac * Math.max(0, profile.length - 1));
      const thickness = clamp(fwhm(profile, local), 0.008, 0.12);
      return {
        y: clamp((top + p.frac * (bottom - top)) / height, 0.002, 0.998),
        height: Math.max(0.012, thickness),
      };
    });
}

export function bandsFromDetection(found: DetectedBand[], laneWidth: number): BlotBand[] {
  return found.map((band) => ({
    id: newId('band'),
    y: band.y,
    height: band.height,
    width: Math.max(0.008, laneWidth * 0.9),
    manual: false,
    excluded: false,
  }));
}

export function lanesFromDetection(
  found: DetectedLane[],
  previous: BlotLane[],
  defaultGroup: string,
): BlotLane[] {
  const prior = [...previous].sort((a, b) => a.x - b.x);
  return found.map((lane, index) => ({
    id: newId('lane'),
    x: lane.x,
    width: lane.width,
    name: prior[index]?.name ?? String(index + 1),
    sample: prior[index]?.sample ?? '',
    group: prior[index]?.group ?? defaultGroup,
    excluded: false,
    bands: [],
  }));
}

/** Deterministic initial lane count: spread lanes evenly in the crop. */
export function lanesFromCount(
  count: number,
  previous: BlotLane[],
  crop: BlotCrop,
  defaultGroup: string,
): BlotLane[] {
  const prior = [...previous].sort((a, b) => a.x - b.x);
  const left = crop.left + (1 - crop.left - crop.right) * 0.04;
  const right = 1 - crop.right - (1 - crop.left - crop.right) * 0.04;
  const laneWidth = Math.min(0.12, ((right - left) / Math.max(1, count)) * 0.62);
  const next: BlotLane[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = left + (right - left) * t;
    const old = prior[i];
    next.push({
      id: old?.id ?? newId('lane'),
      x,
      width: old?.width ?? laneWidth,
      name: old?.name ?? String(i + 1),
      sample: old?.sample ?? '',
      group: old?.group ?? defaultGroup,
      excluded: old?.excluded ?? false,
      bands: old ? old.bands.map((band) => ({ ...band })) : [],
    });
  }
  return next;
}

/** Landmark positions for the chart, independent of pixel work. */
export function groupNames(lanes: BlotLane[]): string[] {
  const out: string[] = [];
  for (const lane of lanes) {
    const name = lane.group.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
