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

/** Merge local maxima that share one flat top. Scanner dither turns a solid
 *  band or lane into a small sawtooth, which otherwise becomes several peaks.
 *  The merged peak sits at the prominence-weighted centroid. */
export function collapseFlatPeaks(profile: Float32Array, peaks: Peak[]): Peak[] {
  if (peaks.length < 2) return peaks;
  const ordered = [...peaks].sort((a, b) => a.frac - b.frac);
  const clusters: Peak[][] = [];
  for (const peak of ordered) {
    const current = clusters[clusters.length - 1];
    if (!current) {
      clusters.push([peak]);
      continue;
    }
    const prev = current[current.length - 1];
    const i0 = Math.round(prev.frac * (profile.length - 1));
    const i1 = Math.round(peak.frac * (profile.length - 1));
    let valley = Infinity;
    for (let i = i0; i <= i1; i++) valley = Math.min(valley, profile[i]);
    const shallow = valley >= Math.min(prev.value, peak.value) * 0.7;
    if (peak.frac - prev.frac <= 0.012 || shallow) current.push(peak);
    else clusters.push([peak]);
  }
  return clusters.map((cluster) => {
    const weight = cluster.reduce((sum, p) => sum + p.prominence, 0) || 1;
    const frac = cluster.reduce((sum, p) => sum + p.frac * p.prominence, 0) / weight;
    const best = cluster.reduce((a, b) => (b.value > a.value ? b : a));
    return { ...best, frac };
  });
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

export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const i = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)));
  return arr[i];
}

/** Fraction of pixels at the black or white rail. */
export function clippedFraction(gray: Float32Array): { dark: number; bright: number } {
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= 0.004) dark++;
    else if (gray[i] >= 0.996) bright++;
  }
  return { dark: dark / Math.max(1, gray.length), bright: bright / Math.max(1, gray.length) };
}

/** Locate the gel slab as the contiguous run through the image centre that
 *  differs from the scanner background. Returns normalised crop fractions. */
export function autoCropRect(
  gray: Float32Array,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } {
  const cols = columnProfile(gray, width, height);
  const rows = rowProfile(gray, width, height, 0, width);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const middleCol = cols[cx];
  const middleRow = rows[cy];
  const border = (cols[0] + cols[width - 1] + rows[0] + rows[height - 1]) / 4;
  // Whichever direction the slab lies relative to the background.
  const sign = Math.sign(middleCol - border) || 1;
  const cut = (v: number) => (v - border) * sign > Math.abs(middleCol - border) * 0.22;
  let x0 = cx;
  let x1 = cx;
  while (x0 > 0 && cut(cols[x0 - 1])) x0--;
  while (x1 < width - 1 && cut(cols[x1 + 1])) x1++;
  let y0 = cy;
  let y1 = cy;
  while (y0 > 0 && cut(rows[y0 - 1])) y0--;
  while (y1 < height - 1 && cut(rows[y1 + 1])) y1++;
  if (x1 - x0 < width * 0.3) {
    x0 = 0;
    x1 = width - 1;
  }
  if (y1 - y0 < height * 0.3) {
    y0 = 0;
    y1 = height - 1;
  }
  const padX = Math.round((x1 - x0) * 0.015);
  const padY = Math.round((y1 - y0) * 0.015);
  x0 = Math.max(0, x0 - padX);
  x1 = Math.min(width - 1, x1 + padX);
  y0 = Math.max(0, y0 - padY);
  y1 = Math.min(height - 1, y1 + padY);
  return {
    left: x0 / width,
    right: 1 - (x1 + 1) / width,
    top: y0 / height,
    bottom: 1 - (y1 + 1) / height,
  };
}

/** Mean RGB of the processed full image, for gel-type voting. */
export function meanRgb(rgba: Uint8ClampedArray): { r: number; g: number; b: number; sat: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  const n = Math.max(1, rgba.length / 4);
  for (let i = 0; i < rgba.length; i += 4) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    const max = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    const min = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    sat += max === 0 ? 0 : (max - min) / max;
  }
  return { r: r / n, g: g / n, b: b / n, sat: sat / n };
}

export interface PolyFit {
  a: number;
  b: number;
  c: number;
  degree: 1 | 2;
  r2: number;
  n: number;
}

export function polyAt(fit: PolyFit, y: number): number {
  return fit.a + fit.b * y + (fit.degree === 2 ? fit.c * y * y : 0);
}

function solve3(m: number[][], v: number[]): number[] | null {
  // Gaussian elimination for the normal equations (degree-2 least squares).
  const a = m.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j;
    if (Math.abs(a[p][i]) < 1e-12) return null;
    [a[i], a[p]] = [a[p], a[i]];
    for (let j = i + 1; j < 3; j++) {
      const f = a[j][i] / a[i][i];
      for (let k = i; k < 4; k++) a[j][k] -= f * a[i][k];
    }
  }
  const out = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = a[i][3];
    for (let j = i + 1; j < 3; j++) s -= a[i][j] * out[j];
    out[i] = s / a[i][i];
  }
  return out;
}

function leastSquares(points: { y: number; size: number }[], degree: 1 | 2): PolyFit | null {
  const n = points.length;
  if (n < (degree === 2 ? 4 : 2)) return null;
  const xs = points.map((p) => p.y);
  const ys = points.map((p) => Math.log10(p.size));
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sx3 = 0;
  let sx4 = 0;
  let sx2y = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    sx3 += dx ** 3;
    sx4 += dx ** 4;
    // Normal-equation RHS for the quadratic term is Σ(dx² · y), not Σ(dx² · dy).
    // Using the mean-centred dy silently drops meanY·S2 and corrupts the fit.
    sx2y += dx * dx * ys[i];
  }
  let a: number;
  let b: number;
  let c = 0;
  if (degree === 2) {
    const sol = solve3(
      [
        [n, 0, sxx],
        [0, sxx, sx3],
        [sxx, sx3, sx4],
      ],
      [n * meanY, sxy, sx2y],
    );
    if (!sol) return null;
    // The normal equations were solved in centred coordinates; expand back to
    // raw y so polyAt can evaluate the stored coefficients directly.
    const ca = sol[0];
    const cb = sol[1];
    c = sol[2];
    a = ca - cb * meanX + c * meanX * meanX;
    b = cb - 2 * c * meanX;
  } else {
    if (sxx === 0) return null;
    b = sxy / sxx;
    a = meanY - b * meanX;
  }
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = a + b * xs[i] + (degree === 2 ? c * xs[i] * xs[i] : 0);
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - pred) ** 2;
  }
  return { a, b, c, degree, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n };
}

/** Robust fit of log10(size) against band position. RANSAC rejects a
 *  mis-detected or mislabelled band; falls back to all points. */
export function robustFit(points: { y: number; size: number }[], degree: 1 | 2 = 1): PolyFit | null {
  const clean = points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.size) && p.size > 0);
  if (clean.length < (degree === 2 ? 4 : 3)) return leastSquares(clean, degree);
  let best: PolyFit | null = null;
  let bestInliers = -1;
  const need = degree === 2 ? 3 : 2;
  const iterations = 160;
  for (let it = 0; it < iterations; it++) {
    const pick: typeof clean = [];
    while (pick.length < need) {
      const cand = clean[Math.floor(Math.random() * clean.length)];
      if (!pick.includes(cand)) pick.push(cand);
    }
    const model = leastSquares(pick, degree);
    if (!model) continue;
    let inliers = 0;
    for (const p of clean) {
      const pred = polyAt(model, p.y);
      if (Math.abs(pred - Math.log10(p.size)) < 0.03) inliers++;
    }
    if (inliers > bestInliers) {
      bestInliers = inliers;
      best = model;
    }
  }
  if (!best) return leastSquares(clean, degree);
  const full = leastSquares(clean, degree);
  // A clean ladder should report every band it was fitted with; RANSAC is only
  // there to reject a grossly mislabelled point.
  if (full && full.r2 >= 0.985) return full;
  const inlierPoints = clean.filter((p) => Math.abs(polyAt(best!, p.y) - Math.log10(p.size)) < 0.05);
  return leastSquares(inlierPoints.length >= need ? inlierPoints : clean, degree);
}

