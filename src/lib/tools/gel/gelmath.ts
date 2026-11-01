/** Gel figure tool — image profiles, peak detection, straighten search and
 *  ladder fitting. Pure functions only; no DOM beyond a canvas used by the
 *  straighten search (which the component owns). */

export interface Peak {
  /** Row/column index (fraction of the profile length). */
  frac: number;
  /** Raw profile value at the peak. */
  value: number;
  /** Prominence above the local baseline (profile units). */
  prominence: number;
}

export interface PeakOptions {
  /** Minimum prominence as a multiple of the profile standard deviation. */
  prominenceStd?: number;
  /** Minimum absolute prominence (profile units, 0..1 gray scale). */
  minProminence?: number;
  /** Minimum distance between peaks in profile buckets. */
  minGap?: number;
  /** Smoothing window (odd number of buckets, 1 = off). */
  smooth?: number;
}

/** Average RGB to a 0..1 gray plane (row-major, length w*h). */
export function toGrayPlane(data: ImageData): Float32Array {
  const { width, height, data: px } = data;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    out[p] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
  }
  return out;
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
    out[i] = sum / n;
  }
  return out;
}

function meanStd(values: Float32Array, from = 0, to = values.length): { mean: number; std: number } {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  const mean = sum / Math.max(1, to - from);
  let sq = 0;
  for (let i = from; i < to; i++) sq += (values[i] - mean) ** 2;
  return { mean, std: Math.sqrt(sq / Math.max(1, to - from)) };
}

/** Local-maxima peak finder with prominence and minimum-gap filtering. */
export function findPeaks(profile: Float32Array, opts: PeakOptions = {}): Peak[] {
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
    // Strict on the falling side, lenient on the rising side: a flat-topped
    // plateau (a wide band column) yields exactly one candidate, not one per
    // pixel of its top.
    if (v < smoothed[i - 1] || v <= smoothed[i + 1]) continue;
    // Baseline = minimum in a local window around the peak.
    const lo = Math.max(0, i - minGap * 3);
    const hi = Math.min(n, i + minGap * 3 + 1);
    let base = v;
    for (let j = lo; j < hi; j++) base = Math.min(base, smoothed[j]);
    const prominence = v - base;
    if (prominence < minProminence) continue;
    candidates.push({ frac: i / (n - 1), value: v, prominence });
  }

  // Greedy non-maximum suppression by prominence.
  candidates.sort((a, b) => b.prominence - a.prominence);
  const kept: Peak[] = [];
  const minFrac = minGap / Math.max(1, n - 1);
  for (const cand of candidates) {
    if (kept.every((k) => Math.abs(k.frac - cand.frac) >= minFrac)) kept.push(cand);
  }
  kept.sort((a, b) => a.frac - b.frac);
  return kept;
}

/** Mean gray per COLUMN inside a row band — finds lane centers. */
export function columnProfile(gray: Float32Array, width: number, height: number, y0 = 0, y1 = height): Float32Array {
  const out = new Float32Array(width);
  const top = Math.max(0, Math.min(height, y0));
  const bottom = Math.max(top + 1, Math.min(height, y1));
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = top; y < bottom; y++) sum += gray[y * width + x];
    out[x] = sum / (bottom - top);
  }
  return out;
}

/** Mean gray per ROW inside a column band — finds band positions in a lane. */
export function rowProfile(gray: Float32Array, width: number, height: number, x0: number, x1: number): Float32Array {
  const out = new Float32Array(height);
  const left = Math.max(0, Math.min(width, x0));
  const right = Math.max(left + 1, Math.min(width, x1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = left; x < right; x++) sum += gray[y * width + x];
    out[y] = sum / (right - left);
  }
  return out;
}

export interface DetectedLane {
  x: number;      // fraction
  width: number;  // fraction
}

/** Column-profile lane detection: peaks are lane centers; width is derived
 *  from the nearest-neighbour spacing so adjacent lanes do not overlap. */
export function detectLanes(gray: Float32Array, width: number, height: number): DetectedLane[] {
  const profile = columnProfile(gray, width, height, Math.floor(height * 0.08), Math.floor(height * 0.92));
  const peaks = findPeaks(profile, { prominenceStd: 0.35, minProminence: 0.004, minGap: Math.max(6, Math.round(width * 0.01)), smooth: 5 });
  if (peaks.length < 2) return [];
  const xs = peaks.map((p) => p.frac);
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0.05;
  const widthFraction = Math.max(0.01, Math.min(0.2, medianGap * 0.62));
  return xs.map((x) => ({ x, width: widthFraction }));
}

export interface LadderFit {
  /** log10(size) = a * y + b */
  a: number;
  b: number;
  r2: number;
  n: number;
}

/** Least-squares fit of log10(size) against normalized band positions.
 *  `points` must pair each band's y with its known ladder size. */
export function fitLadder(points: { y: number; size: number }[]): LadderFit | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.y);
  const ys = points.map((p) => Math.log10(p.size));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const a = sxy / sxx;
  const b = my - a * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = a * xs[i] + b;
    ssTot += (ys[i] - my) ** 2;
    ssRes += (ys[i] - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, r2, n };
}

export function sizeFromY(fit: LadderFit, y: number): number {
  return 10 ** (fit.a * y + fit.b);
}

/** Score a candidate rotation: sum of squared row-mean differences (bands
 *  aligned horizontally produce sharp row contrast). Used by auto-straighten. */
export function rotationScore(gray: Float32Array, width: number, height: number): number {
  const rows = rowProfile(gray, width, height, 0, width);
  let score = 0;
  for (let y = 1; y < rows.length; y++) score += (rows[y] - rows[y - 1]) ** 2;
  return score;
}
