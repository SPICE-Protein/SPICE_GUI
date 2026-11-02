// Binary segmentation for colony plates.
//
// Pipeline: Gaussian blur -> Otsu (or manual) threshold -> connected
// components -> optional distance-transform seeding + marker-controlled
// watershed-style split for touching colonies -> area / circularity filters.
// Everything here is pure typed-array code so it can run on a downscaled
// detector plane without touching the DOM.

import type { ColonyPolarity } from './types';

export type ResolvedPolarity = 'dark' | 'bright';

export interface SegmentRequest {
  /** Fixed threshold in gray levels 0..255, or null to use Otsu. */
  threshold: number | null;
  polarity: ColonyPolarity;
  /** Gaussian radius in detector pixels. */
  blurRadius: number;
  /** Areas are in detector pixels squared. */
  minArea: number;
  maxArea: number;
  minCircularity: number;
  splitTouching: boolean;
}

export interface RawColony {
  x: number;
  y: number;
  area: number;
  radius: number;
  meanIntensity: number;
  circularity: number;
}

export interface SegmentResult {
  colonies: RawColony[];
  mask: Uint8Array;
  width: number;
  height: number;
  otsu: number;
  threshold: number;
  background: number;
  polarity: ResolvedPolarity;
}

// ------------------------------------------------------------------- blur

function gaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(0.5, radius / 2);
  const half = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = new Float32Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + half] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

/** Separable Gaussian blur with clamped edges. Radius <= 0 copies nothing. */
export function gaussianBlur(gray: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (!(radius > 0.05)) return gray;
  const kernel = gaussianKernel(radius);
  const half = (kernel.length - 1) / 2;
  const temp = new Float32Array(gray.length);
  const out = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -half; k <= half; k++) {
        const sx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k;
        acc += gray[row + sx] * kernel[k + half];
      }
      temp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -half; k <= half; k++) {
        const sy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        acc += temp[sy * width + x] * kernel[k + half];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

// ------------------------------------------------------------------- otsu

export function otsuThreshold(gray: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) {
    let v = Math.round(gray[i]);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    hist[v]++;
  }
  const total = gray.length;
  if (!total) return 128;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Median gray level of a border band, used to infer which side is background. */
export function estimateBackground(gray: Float32Array, width: number, height: number): number {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const hist = new Float64Array(256);
  const sample = (x: number, y: number) => {
    let v = Math.round(gray[y * width + x]);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    hist[v]++;
  };
  for (let y = 0; y < height; y++) {
    const edgeY = y < band || y >= height - band;
    for (let x = 0; x < width; x++) {
      if (edgeY || x < band || x >= width - band) sample(x, y);
    }
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 128;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total / 2) return i;
  }
  return 128;
}

export function resolvePolarity(polarity: ColonyPolarity, background: number, threshold: number): ResolvedPolarity {
  if (polarity === 'dark') return 'dark';
  if (polarity === 'bright') return 'bright';
  // Colonies are usually the minority class; the plate background touches the
  // frame border. If the border is brighter than the threshold the colonies
  // must be the dark side (and the reverse).
  return background >= threshold ? 'dark' : 'bright';
}

export function buildMask(
  gray: Float32Array,
  threshold: number,
  polarity: ResolvedPolarity,
): Uint8Array {
  const mask = new Uint8Array(gray.length);
  if (polarity === 'dark') {
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] <= threshold ? 1 : 0;
  } else {
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] >= threshold ? 1 : 0;
  }
  return mask;
}

// ------------------------------------------------------- connected components

interface Component {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  sumIntensity: number;
  circularity: number;
  pixels: Int32Array;
}

function componentCircularity(area: number, perimeter: number): number {
  if (area <= 0 || perimeter <= 0) return 0;
  const value = (4 * Math.PI * area) / (perimeter * perimeter);
  return Math.min(1, Math.max(0, value));
}

function collectComponents(
  mask: Uint8Array,
  gray: Float32Array,
  width: number,
  height: number,
): { components: Component[] } {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const order = new Int32Array(width * height);
  const components: Component[] = [];
  let nextId = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed]) continue;
    nextId++;
    let sp = 0;
    let count = 0;
    stack[sp++] = seed;
    labels[seed] = nextId;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    let sumIntensity = 0;
    while (sp > 0) {
      const p = stack[--sp];
      order[count++] = p;
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      sumIntensity += gray[p];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const ni = ny * width + nx;
          if (mask[ni] && !labels[ni]) {
            labels[ni] = nextId;
            stack[sp++] = ni;
          }
        }
      }
    }
    const pixels = order.slice(0, count);
    let perimeter = 0;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || !mask[p - 1]) perimeter++;
      if (x === width - 1 || !mask[p + 1]) perimeter++;
      if (y === 0 || !mask[p - width]) perimeter++;
      if (y === height - 1 || !mask[p + width]) perimeter++;
    }
    components.push({
      area: count,
      minX,
      minY,
      maxX,
      maxY,
      sumX,
      sumY,
      sumIntensity,
      circularity: componentCircularity(count, perimeter),
      pixels,
    });
  }
  return { components };
}

// ----------------------------------------------------- distance transform

/** 1-D squared Euclidean distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Exact Euclidean distance transform of a binary plane (0 = background). */
export function distanceTransform(bin: Uint8Array, width: number, height: number): Float32Array {
  const grid = new Float64Array(width * height);
  const INF = 1e12;
  for (let i = 0; i < bin.length; i++) grid[i] = bin[i] ? INF : 0;
  const maxN = Math.max(width, height);
  const f = new Float64Array(maxN);
  const d = new Float64Array(maxN);
  const z = new Float64Array(maxN + 1);
  const v = new Int32Array(maxN);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[row + x] = d[x];
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

interface Seed {
  x: number;
  y: number;
  distance: number;
}

/** Local maxima of the distance transform, thinned by non-maximum suppression. */
function findSeeds(dt: Float32Array, bin: Uint8Array, width: number, height: number): Seed[] {
  let maxDistance = 0;
  for (let i = 0; i < dt.length; i++) {
    if (bin[i] && dt[i] > maxDistance) maxDistance = dt[i];
  }
  if (maxDistance <= 0) return [];
  const minSeed = Math.max(1.5, maxDistance * 0.35);
  const candidates: Seed[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!bin[i]) continue;
      const d = dt[i];
      if (d < minSeed) continue;
      let localMax = true;
      for (let dy = -1; dy <= 1 && localMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (dt[i + dy * width + dx] > d) {
            localMax = false;
            break;
          }
        }
      }
      if (localMax) candidates.push({ x, y, distance: d });
    }
  }
  candidates.sort((a, b) => b.distance - a.distance || a.y - b.y || a.x - b.x);
  // Two touching lobes have centres roughly two radii apart, so one radius of
  // separation keeps both while collapsing ridge plateaus of a single blob.
  const suppress = Math.max(2.5, maxDistance);
  const kept: Seed[] = [];
  for (const candidate of candidates) {
    let tooClose = false;
    for (const seed of kept) {
      const dx = seed.x - candidate.x;
      const dy = seed.y - candidate.y;
      if (dx * dx + dy * dy < suppress * suppress) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) kept.push(candidate);
  }
  if (kept.length < 2) return kept;
  // Reject the flat distance ridge of a single elongated object: two genuine
  // lobes are separated by a saddle that is clearly lower than both peaks.
  const separated = new Set<number>();
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i];
      const b = kept[j];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.ceil(distance));
      let saddle = Infinity;
      let insideObject = true;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const sx = Math.round(a.x + (b.x - a.x) * t);
        const sy = Math.round(a.y + (b.y - a.y) * t);
        const index = sy * width + sx;
        if (!bin[index]) {
          insideObject = false;
          break;
        }
        const value = dt[index];
        if (value < saddle) saddle = value;
      }
      if (insideObject && saddle < 0.85 * Math.min(a.distance, b.distance)) {
        separated.add(i);
        separated.add(j);
      }
    }
  }
  return kept.filter((_seed, index) => separated.has(index));
}

/** Split one connected component into watershed-style sub-regions.
 *  Returns null when the object is not worth splitting. */
function splitComponent(
  component: Component,
  gray: Float32Array,
  width: number,
  height: number,
): RawColony[] | null {
  const bw = component.maxX - component.minX + 1;
  const bh = component.maxY - component.minY + 1;
  if (bw < 5 || bh < 5) return null;
  // One-pixel zero border so objects touching the bounding box still see an
  // outside boundary in the distance transform.
  const pw = bw + 2;
  const ph = bh + 2;
  const bin = new Uint8Array(pw * ph);
  for (let i = 0; i < component.pixels.length; i++) {
    const p = component.pixels[i];
    const x = p % width;
    const y = (p - x) / width;
    bin[(y - component.minY + 1) * pw + (x - component.minX + 1)] = 1;
  }
  // A ring-shaped object (or a colony enclosing another one) has no meaningful
  // neck, so leave it whole instead of carving it into ridge segments.
  const visited = new Uint8Array(pw * ph);
  const flood = new Int32Array(pw * ph);
  let floodHead = 0;
  let floodTail = 0;
  for (let x = 0; x < pw; x++) {
    flood[floodTail++] = x;
    flood[floodTail++] = (ph - 1) * pw + x;
    visited[x] = 1;
    visited[(ph - 1) * pw + x] = 1;
  }
  for (let y = 1; y < ph - 1; y++) {
    flood[floodTail++] = y * pw;
    flood[floodTail++] = y * pw + pw - 1;
    visited[y * pw] = 1;
    visited[y * pw + pw - 1] = 1;
  }
  while (floodHead < floodTail) {
    const p = flood[floodHead++];
    const x = p % pw;
    const y = (p - x) / pw;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) continue;
      const ni = ny * pw + nx;
      if (!bin[ni] && !visited[ni]) {
        visited[ni] = 1;
        flood[floodTail++] = ni;
      }
    }
  }
  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const i = y * pw + x;
      if (!bin[i] && !visited[i]) return null; // enclosed hole
    }
  }

  const dt = distanceTransform(bin, pw, ph);
  // Light 3x3 smoothing reduces spurious maxima on jagged colony edges.
  const smooth = new Float32Array(pw * ph);
  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const i = y * pw + x;
      if (!bin[i]) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += dt[i + dy * pw + dx];
      }
      smooth[i] = sum / 9;
    }
  }
  const seeds = findSeeds(smooth, bin, pw, ph);
  if (seeds.length < 2) return null;

  // Marker-controlled watershed: every foreground pixel goes to the nearest
  // seed measured through the object (4-neighbour BFS), so splits follow the
  // narrow necks between touching colonies.
  const assign = new Int32Array(pw * ph);
  assign.fill(-1);
  const queue = new Int32Array(pw * ph);
  let head = 0;
  let tail = 0;
  for (let s = 0; s < seeds.length; s++) {
    const idx = seeds[s].y * pw + seeds[s].x;
    if (assign[idx] >= 0) continue;
    assign[idx] = s;
    queue[tail++] = idx;
  }
  while (head < tail) {
    const p = queue[head++];
    const label = assign[p];
    const x = p % pw;
    const y = (p - x) / pw;
    if (x > 1 && bin[p - 1] && assign[p - 1] < 0) {
      assign[p - 1] = label;
      queue[tail++] = p - 1;
    }
    if (x < pw - 2 && bin[p + 1] && assign[p + 1] < 0) {
      assign[p + 1] = label;
      queue[tail++] = p + 1;
    }
    if (y > 1 && bin[p - pw] && assign[p - pw] < 0) {
      assign[p - pw] = label;
      queue[tail++] = p - pw;
    }
    if (y < ph - 2 && bin[p + pw] && assign[p + pw] < 0) {
      assign[p + pw] = label;
      queue[tail++] = p + pw;
    }
  }

  const regions: RawColony[] = [];
  const area = new Float64Array(seeds.length);
  const sx = new Float64Array(seeds.length);
  const sy = new Float64Array(seeds.length);
  const si = new Float64Array(seeds.length);
  const peri = new Float64Array(seeds.length);
  for (let i = 0; i < component.pixels.length; i++) {
    const p = component.pixels[i];
    const x = p % width;
    const y = (p - x) / width;
    const localX = x - component.minX + 1;
    const localY = y - component.minY + 1;
    const local = localY * pw + localX;
    const r = assign[local];
    if (r < 0) {
      // Unassigned pixels can only occur when a seed was overwritten; attach
      // them to the nearest seed by direct distance so no area is lost.
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = seeds[s].x - localX;
        const dy = seeds[s].y - localY;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      area[best]++;
      sx[best] += x;
      sy[best] += y;
      si[best] += gray[p];
      continue;
    }
    area[r]++;
    sx[r] += x;
    sy[r] += y;
    si[r] += gray[p];
    if (!bin[local - 1] || assign[local - 1] !== r) peri[r]++;
    if (!bin[local + 1] || assign[local + 1] !== r) peri[r]++;
    if (!bin[local - pw] || assign[local - pw] !== r) peri[r]++;
    if (!bin[local + pw] || assign[local + pw] !== r) peri[r]++;
  }
  for (let r = 0; r < seeds.length; r++) {
    if (area[r] <= 0) continue;
    regions.push({
      x: sx[r] / area[r] + 0.5,
      y: sy[r] / area[r] + 0.5,
      area: area[r],
      radius: Math.sqrt(area[r] / Math.PI),
      meanIntensity: si[r] / area[r],
      circularity: componentCircularity(area[r], peri[r]),
    });
  }
  return regions.length >= 2 ? regions : null;
}

/** Full segmentation pass on a detector-resolution grayscale plane. */
export function segmentGray(gray: Float32Array, width: number, height: number, request: SegmentRequest): SegmentResult {
  const blurred = gaussianBlur(gray, width, height, request.blurRadius);
  const otsu = otsuThreshold(blurred);
  const threshold =
    request.threshold === null ? otsu : Math.min(255, Math.max(0, request.threshold));
  const background = estimateBackground(blurred, width, height);
  const polarity = resolvePolarity(request.polarity, background, threshold);
  const mask = buildMask(blurred, threshold, polarity);
  const { components } = collectComponents(mask, blurred, width, height);
  const colonies: RawColony[] = [];
  const minArea = Math.max(0, request.minArea);
  const maxArea = Math.max(0, request.maxArea);

  const accept = (colony: RawColony) => {
    if (colony.area < Math.max(1, minArea)) return false;
    if (maxArea > 0 && colony.area > maxArea) return false;
    if (request.minCircularity > 0 && colony.circularity < request.minCircularity) return false;
    return true;
  };

  for (let c = 0; c < components.length; c++) {
    const component = components[c];
    if (component.area < Math.max(1, minArea)) continue;
    if (request.splitTouching && component.area >= Math.max(12, minArea * 1.5)) {
      const split = splitComponent(component, blurred, width, height);
      if (split) {
        for (const colony of split) if (accept(colony)) colonies.push(colony);
        continue;
      }
    }
    const colony: RawColony = {
      x: component.sumX / component.area + 0.5,
      y: component.sumY / component.area + 0.5,
      area: component.area,
      radius: Math.sqrt(component.area / Math.PI),
      meanIntensity: component.sumIntensity / component.area,
      circularity: component.circularity,
    };
    if (accept(colony)) colonies.push(colony);
  }
  return { colonies, mask, width, height, otsu, threshold, background, polarity };
}
