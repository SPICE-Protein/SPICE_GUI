// High-level gel detection: lane finding, band finding, gel-type inference and
// marker-lane matching. Pure functions over the processed grayscale plane.
import {
  binarizeGray,
  columnProfile,
  rowProfile,
  findPeaks,
  robustFit,
  polyAt,
  collapseFlatPeaks,
  meanRgb,
  type DetectedLane,
  type PolyFit,
} from './gelmath';
import type { LadderDef } from './ladders';
import { cachedSignal } from './native';
import { detectConfigKey, type GelDetectConfig } from './presets';

interface FallbackEntry {
  width: number;
  height: number;
  signal: Float32Array;
}

const fallbackCache = new WeakMap<Float32Array, Map<string, FallbackEntry>>();

function fallbackKey(config?: GelDetectConfig): string {
  return config ? detectConfigKey(config) : 'auto';
}

/** Detection works on a binary signal plane, not raw grayscale. The native
 *  entry points precompute and cache it; this is the synchronous lookup used
 *  by the profile math, with the pure-JS threshold as a cold-start fallback. */
export function signalPlane(
  gray: Float32Array,
  width: number,
  height: number,
  config?: GelDetectConfig,
): Float32Array {
  const native = cachedSignal(gray, width, height, config);
  if (native) return native;
  const key = fallbackKey(config);
  const hit = fallbackCache.get(gray)?.get(key);
  if (hit && hit.width === width && hit.height === height) return hit.signal;
  const signal = binarizeGray(gray, width, height, config).signal;
  let entries = fallbackCache.get(gray);
  if (!entries) {
    entries = new Map();
    fallbackCache.set(gray, entries);
  }
  entries.set(key, { width, height, signal });
  return signal;
}

export interface BandPeak {
  /** Normalised y in the processed full image. */
  y: number;
  intensity: number;
  /** Full width at half maximum, as a fraction of image height. */
  width: number;
}

export interface GelTypeGuess {
  kind: 'dna' | 'protein';
  /** Reason codes, translated by the UI. */
  reasons: ('blue' | 'red' | 'wide' | 'many' | 'neutral')[];
}

/** Contiguous profile regions above `cut`, merging small gaps and dropping
 *  specks. Returned as inclusive [start, end] column ranges. */
function activeRuns(
  profile: Float32Array,
  cut: number,
  minWidth: number,
  mergeGap: number,
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < profile.length; i++) {
    const on = profile[i] >= cut;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, profile.length - 1]);
  const merged: Array<[number, number]> = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run[0] - prev[1] - 1 <= mergeGap) prev[1] = run[1];
    else merged.push([run[0], run[1]]);
  }
  return merged.filter(([a, b]) => b - a + 1 >= minWidth);
}

/** Lane centres from the well row, corrected by band signal below it. Lanes
 *  that run together in crowded protein gels still separate at the wells. */
export function detectLanesAuto(
  gray: Float32Array,
  width: number,
  height: number,
  protein = false,
  config?: GelDetectConfig,
): DetectedLane[] {
  const signal = signalPlane(gray, width, height, config);
  const wellTop = Math.floor(height * 0.02);
  const wellBottom = Math.floor(height * 0.2);
  const bodyTop = Math.floor(height * 0.15);
  const bodyBottom = Math.floor(height * 0.95);
  const wells = columnProfile(signal, width, height, wellTop, wellBottom);
  const body = columnProfile(signal, width, height, bodyTop, bodyBottom);
  // Normalise both profiles so the well row can guide the band signal.
  const norm = (p: Float32Array) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of p) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const span = hi - lo || 1;
    return p.map((v) => (v - lo) / span);
  };
  const nw = norm(wells);
  const nb = norm(body);
  const combined = new Float32Array(width);
  for (let i = 0; i < width; i++) combined[i] = 0.55 * nw[i] + 0.45 * nb[i];
  let peakMax = 0;
  for (const v of combined) peakMax = Math.max(peakMax, v);

  // A lane is a contiguous active run, not a local maximum: on real UV photos
  // the lane itself glows, so one lane spans a plateau that peak picking
  // splits into several false lanes. A low relative cut recovers the run; if
  // the lanes merge into one run, raise the cut before giving up.
  // Protein gels often run lanes together with no dark gap; there the peak
  // detector separates them better, so the run split is DNA-only.
  if (!protein) {
    const laneOpts = config?.lanes;
    const minRunWidth = Math.max(3, Math.round(width * (laneOpts?.minWidth ?? 0.004)));
    const mergeRunGap = Math.max(1, Math.round(width * (laneOpts?.mergeGap ?? 0.005)));
    const baseCut = laneOpts?.cut ?? 0.08;
    for (const cutFraction of [baseCut, baseCut * 2, baseCut * 3]) {
      const runs = activeRuns(combined, peakMax * cutFraction, minRunWidth, mergeRunGap);
      if (runs.length >= 2) {
        return runs.map(([start, end]) => {
          const laneWidth = Math.max(0.008, Math.min(0.2, (end - start + 1) / width));
          return { x: (start + end) / 2 / Math.max(1, width - 1), width: laneWidth };
        });
      }
    }
  }
  // Binary profiles have no intensity dynamic range; gate on prominence only,
  // otherwise one saturated ladder lane raises the mean and hides the samples.
  // The smoothing window is sized to a lane: without it, two bands in one lane
  // that sit a few pixels apart become two lanes.
  const minProminence = Math.max(0.01, peakMax * (config?.lanes.prominence ?? 0.1));
  const minGap = Math.max(6, Math.round(width * (protein ? 0.02 : 0.03)));
  const smoothFraction = (config?.lanes.smooth ?? 0.02) * (protein ? 0.75 : 1);
  let peaks = findPeaks(combined, {
    useThreshold: false,
    minProminence,
    minGap,
    smooth: Math.max(3, Math.round(width * smoothFraction)),
  });
  if (peaks.length < 2) {
    peaks = findPeaks(nb, {
      useThreshold: false,
      minProminence,
      minGap: Math.max(6, Math.round(width * 0.01)),
      smooth: 3,
    });
  }
  if (peaks.length < 2) return [];
  const kept = collapseFlatPeaks(combined, peaks);
  const xs = kept.map((p) => p.frac);
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0.05;
  const widthFraction = Math.max(0.008, Math.min(0.2, medianGap * 0.62));
  return xs.map((x) => ({ x, width: widthFraction }));
}

export function detectBandsInLane(
  gray: Float32Array,
  width: number,
  height: number,
  lane: { x: number; width: number },
  kind: 'dna' | 'protein' = 'dna',
  config?: GelDetectConfig,
): BandPeak[] {
  const x0 = Math.round((lane.x - lane.width / 2) * width);
  const x1 = Math.round((lane.x + lane.width / 2) * width);
  const signal = signalPlane(gray, width, height, config);
  const profile = rowProfile(signal, width, height, x0, x1);
  const protein = kind === 'protein';
  const prominence = config?.bands.prominence ?? 0.5;
  const gapFraction = (config?.bands.minGap ?? 0.006) * (protein ? 2 / 3 : 1);
  const smooth = config?.bands.smooth ?? 3;
  const peaks = collapseFlatPeaks(
    profile,
    findPeaks(profile, {
      prominenceStd: prominence * (protein ? 0.6 : 1),
      minProminence: protein ? 0.003 : 0.006,
      minGap: Math.max(3, Math.round(height * gapFraction)),
      smooth: protein ? smooth + 2 : smooth,
    }),
  );
  // Full width at half maximum, used to tell broad protein bands from thin
  // DNA bands when the image carries no colour clue.
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= Math.max(1, profile.length);
  return peaks.slice(0, 40).map((p) => {
    const idx = Math.round(p.frac * (profile.length - 1));
    const half = mean + (p.value - mean) * 0.5;
    let l = idx;
    let r = idx;
    while (l > 0 && profile[l - 1] >= half) l--;
    while (r < profile.length - 1 && profile[r + 1] >= half) r++;
    return { y: p.frac, intensity: p.value, width: (r - l + 1) / Math.max(1, profile.length) };
  });
}

/** Mean colour of the band pixels only. A UV gel's purple background would
 *  otherwise dominate the whole-image mean and vote "blue" (protein), even
 *  though the bands themselves are red/pink DNA. Falls back to the full image
 *  when the mask is missing or covers almost nothing. */
function bandMeanRgb(rgba: Uint8ClampedArray, mask?: Float32Array) {
  if (!mask || mask.length * 4 !== rgba.length) return meanRgb(rgba);
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  let n = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    if (!mask[p]) continue;
    const red = rgba[i];
    const green = rgba[i + 1];
    const blue = rgba[i + 2];
    r += red;
    g += green;
    b += blue;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    sat += max === 0 ? 0 : (max - min) / max;
    n++;
  }
  if (n < Math.max(64, (rgba.length / 4) * 0.001)) return meanRgb(rgba);
  return { r: r / n, g: g / n, b: b / n, sat: sat / n };
}

/** Best-effort DNA/protein vote from colour and band character. */
export function detectGelType(
  rgba: Uint8ClampedArray,
  bandCount: number,
  laneCount: number,
  bandWidth = 0,
  mask?: Float32Array,
): GelTypeGuess {
  const { r, g, b, sat } = bandMeanRgb(rgba, mask);
  const reasons: GelTypeGuess['reasons'] = [];
  const blue = b > r * 1.08 && b > g * 1.03 && sat > 0.04;
  const red = r > b * 1.08 && sat > 0.04;
  if (blue) reasons.push('blue');
  if (red) reasons.push('red');
  // A crowded gel with many evenly spaced bands is almost always a DNA ladder;
  // protein lysates show fewer, broader bands.
  const many = bandCount >= 12 && laneCount >= 3;
  const wide = bandWidth >= 0.018 || (bandCount >= 4 && bandCount <= 8 && laneCount <= 3 && bandWidth >= 0.012);
  if (many) reasons.push('many');
  if (wide) reasons.push('wide');
  if (!reasons.length) reasons.push('neutral');
  if (blue) return { kind: 'protein', reasons };
  if (red || many) return { kind: 'dna', reasons };
  if (wide) return { kind: 'protein', reasons };
  return { kind: 'dna', reasons };
}

export interface MarkerMatch {
  laneId: string;
  ladder: LadderDef;
  fit: PolyFit;
  /** Sizes assigned to the lane's bands, top to bottom. */
  sizes: number[];
  score: number;
}

function fitForSizes(bandsY: number[], sizes: number[]): PolyFit | null {
  const points = bandsY.map((y, i) => ({ y, size: sizes[i] }));
  const degree = points.length >= 8 ? 2 : 1;
  return robustFit(points, degree);
}

/** All contiguous windows of descending sizes that can pair with the bands.
 *  Missing faint bands at either end of a protein marker are tolerated. */
function sizeWindows(ladder: LadderDef, count: number, protein: boolean): number[][] {
  const sizes = ladder.sizes;
  if (count === sizes.length) return [sizes];
  if (!protein || count > sizes.length) return [];
  const out: number[][] = [];
  for (let start = 0; start + count <= sizes.length; start++) out.push(sizes.slice(start, start + count));
  return out;
}

export interface MatchOptions {
  kind: 'dna' | 'protein';
  ladders: LadderDef[];
  favorites?: string[];
}

/** Rank every lane/ladder pairing; the editor keeps the best ladder overall,
 *  matching several marker lanes jointly. */
export function findMarkerMatches(
  lanes: {
    id: string;
    removed?: boolean;
    bands: { y: number; manual?: boolean; size?: number; hidden?: boolean }[];
  }[],
  opts: MatchOptions,
): MarkerMatch[] {
  const protein = opts.kind === 'protein';
  const favorites = new Set(opts.favorites ?? []);
  const matches: MarkerMatch[] = [];
  for (const lane of lanes) {
    if (lane.removed) continue;
    const bands = [...lane.bands].filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
    if (bands.length < (protein ? 4 : 3)) continue;
    const ys = bands.map((b) => b.y);
    for (const ladder of opts.ladders) {
      if (ladder.kind !== opts.kind) continue;
      for (const sizes of sizeWindows(ladder, bands.length, protein)) {
        const fit = fitForSizes(ys, sizes);
        if (!fit) continue;
        // Bands lower down the gel are smaller, so log10(size) must fall as y
        // grows. A non-negative slope means the ladder was matched upside down.
        const slope = fit.degree === 2 ? fit.b + fit.c : fit.b;
        if (slope >= -0.1) continue;
        const countPenalty = ladder.sizes.length - bands.length;
        const fewBands = bands.length < 4 ? 0.12 : 0;
        const score =
          fit.r2 -
          countPenalty * (protein ? 0.02 : 0.06) -
          fewBands +
          (favorites.has(ladder.id) ? 0.02 : 0);
        matches.push({ laneId: lane.id, ladder, fit, sizes, score });
      }
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

export interface JointMarkerResult {
  ladder: LadderDef;
  laneIds: string[];
  fit: PolyFit;
  /** laneId -> sizes assigned to its bands, top to bottom. */
  assignments: Record<string, number[]>;
  score: number;
}

/** Pick the ladder that best explains one or more lanes and fit it jointly. */
export function identifyMarkers(lanes: Parameters<typeof findMarkerMatches>[0], opts: MatchOptions): JointMarkerResult | null {
  const matches = findMarkerMatches(lanes, opts);
  if (!matches.length) return null;
  // The best single match chooses the ladder; other lanes that fit it join.
  const best = matches[0];
  // Only lanes whose own fit is credible may join; a lane with a different
  // band count or a much worse fit is a sample lane, not a second marker.
  const sameLadder = matches.filter(
    (m) =>
      m.ladder.id === best.ladder.id &&
      m.laneId !== best.laneId &&
      m.sizes.length === best.sizes.length &&
      m.score >= best.score - 0.08,
  );
  // One lane per ladder contribution: keep the best match for each lane.
  const byLane = new Map<string, MarkerMatch>();
  for (const m of [best, ...sameLadder]) if (!byLane.has(m.laneId)) byLane.set(m.laneId, m);
  const chosen = [...byLane.values()];
  const points: { y: number; size: number }[] = [];
  for (const m of chosen) {
    const lane = lanes.find((l) => l.id === m.laneId);
    if (!lane) continue;
    const bins = [...lane.bands].filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
    bins.slice(0, m.sizes.length).forEach((b, i) => points.push({ y: b.y, size: m.sizes[i] }));
  }
  const degree = points.length >= 8 ? 2 : 1;
  const joint = robustFit(points, degree) ?? best.fit;
  const assignments: Record<string, number[]> = {};
  for (const m of chosen) assignments[m.laneId] = m.sizes;
  return {
    ladder: best.ladder,
    laneIds: chosen.map((m) => m.laneId),
    fit: joint,
    assignments,
    score: chosen.reduce((s, m) => s + m.score, 0) / chosen.length,
  };
}

/** Sizes for a lane's detected bands, with extrapolation flags. */
export function estimateBandSizes(
  bands: { y: number; manual?: boolean; hidden?: boolean; size?: number }[],
  fit: PolyFit,
  ladder: LadderDef,
  alternatives: PolyFit[] = [],
): { size: number; approx: boolean }[] {
  const lo = Math.log10(Math.min(...ladder.sizes));
  const hi = Math.log10(Math.max(...ladder.sizes));
  return bands.map((b) => {
    const log = polyAt(fit, b.y);
    const size = 10 ** log;
    const outOfRange = log < lo - 0.01 || log > hi + 0.01;
    const disagree = alternatives.some((alt) => {
      const other = 10 ** polyAt(alt, b.y);
      return Math.abs(other - size) / Math.max(1, size) > 0.1;
    });
    return { size, approx: outOfRange || disagree };
  });
}

export function isOutOfRange(size: number, fit: PolyFit, ladder: LadderDef): boolean {
  const log = Math.log10(Math.max(1e-6, size));
  const lo = Math.log10(Math.min(...ladder.sizes));
  const hi = Math.log10(Math.max(...ladder.sizes));
  // Also treat positions beyond the matched band span as extrapolated.
  return log < lo - 0.01 || log > hi + 0.01;
}
