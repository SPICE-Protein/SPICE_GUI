// Small statistics toolkit: descriptive statistics, a two-sided Welch t-test
// with a real Student t CDF (regularized incomplete beta), and least-squares
// linear regression for standard curves. No external dependencies.

export function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n - 1). Null for fewer than two values. */
export function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  let sum = 0;
  for (const v of values) {
    const d = v - m;
    sum += d * d;
  }
  return Math.sqrt(sum / (values.length - 1));
}

export function sem(values: number[]): number | null {
  const sd = sampleSd(values);
  return sd === null ? null : sd / Math.sqrt(values.length);
}

// ------------------------------------------------------------------ t-test

const LANCZOS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  let x = LANCZOS[0];
  const t = z - 1;
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (t + i);
  const w = t + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (t + 0.5) * Math.log(w) - w + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 300;
  const epsilon = 3e-14;
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b) for a, b > 0. */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logTerm =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  const term = Math.exp(logTerm);
  if (x < (a + 1) / (a + b + 2)) {
    return (term * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (term * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Two-sided p-value for a Student t statistic with `df` degrees of freedom.
 * p = I_{df/(df+t^2)}(df/2, 1/2).
 */
export function studentTTwoSidedP(t: number, df: number): number | null {
  if (!Number.isFinite(df) || df <= 0) return null;
  if (!Number.isFinite(t)) return 0;
  if (t === 0) return 1;
  const x = df / (df + t * t);
  const p = incompleteBeta(df / 2, 0.5, x);
  return Math.min(1, Math.max(0, p));
}

export interface WelchResult {
  t: number;
  df: number;
  p: number;
}

/**
 * Welch t-test for two independent samples. Returns null when either group has
 * fewer than two observations. Zero variance is handled analytically.
 */
export function welchTTest(a: number[], b: number[]): WelchResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = sampleSd(a)! ** 2;
  const varB = sampleSd(b)! ** 2;
  const termA = varA / a.length;
  const termB = varB / b.length;
  const standardError = Math.sqrt(termA + termB);
  const diff = meanA - meanB;

  if (standardError === 0) {
    if (diff === 0) return { t: 0, df: a.length + b.length - 2, p: 1 };
    return { t: diff > 0 ? Infinity : -Infinity, df: a.length + b.length - 2, p: 0 };
  }
  const t = diff / standardError;
  const numerator = (termA + termB) ** 2;
  const denominator =
    (termA ** 2) / (a.length - 1) + (termB ** 2) / (b.length - 1);
  const df = denominator === 0 ? a.length + b.length - 2 : numerator / denominator;
  const p = studentTTwoSidedP(t, df);
  return p === null ? null : { t, df, p };
}

// ------------------------------------------------------------- regression

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  xMin: number;
  xMax: number;
}

/** Ordinary least squares fit of y = slope * x + intercept. */
export function linearRegression(points: { x: number; y: number }[]): Regression | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const xs = points.map((p) => p.x);
  return {
    slope,
    intercept,
    r2: Number.isFinite(r2) ? Math.max(0, Math.min(1, r2)) : 0,
    n,
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
  };
}

/** Amplification efficiency from a standard-curve slope: 10^(-1/slope) - 1. */
export function efficiencyFromSlope(slope: number): number {
  if (!Number.isFinite(slope) || slope === 0) return Number.NaN;
  return 10 ** (-1 / slope) - 1;
}
