// Replicate statistics for blot group summaries. The Welch t-test and the
// Student t quantile are implemented locally so the tool has no dependency on
// the qPCR module and stays usable on its own.

export function mean(values: number[]): number {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Sample standard deviation (n - 1). */
export function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

export function sem(values: number[]): number {
  const sd = sampleSd(values);
  return values.length ? sd / Math.sqrt(values.length) : 0;
}

/** Two-sided 97.5% Student t quantiles by degrees of freedom. */
const T_CRIT_975 = [
  Infinity,
  12.7062, 4.3027, 3.1824, 2.7764, 2.5706, 2.4469, 2.3646, 2.306, 2.2622, 2.2281,
  2.201, 2.1788, 2.1604, 2.1448, 2.1314, 2.1199, 2.1098, 2.1009, 2.093, 2.086,
  2.0796, 2.0739, 2.0687, 2.0639, 2.0595, 2.0555, 2.0518, 2.0484, 2.0452, 2.0423,
  2.0395, 2.0369, 2.0345, 2.0322, 2.0301, 2.0281, 2.0262, 2.0244, 2.0227, 2.0211,
];

/** Two-sided 95% Student t critical value, interpolated between table rows. */
export function tCritical95(df: number): number {
  if (!Number.isFinite(df) || df <= 0) return 1.959964;
  if (df <= 40) {
    const low = Math.max(1, Math.floor(df));
    const high = Math.min(40, low + 1);
    const a = T_CRIT_975[low] ?? 2.0211;
    const b = T_CRIT_975[high] ?? 2.0211;
    const t = df - low;
    return a + (b - a) * t;
  }
  if (df >= 120) return 1.959964;
  // Linear interpolation between common large-sample anchors.
  const anchors: Array<[number, number]> = [
    [40, 2.0211],
    [60, 2.0003],
    [120, 1.9799],
  ];
  for (let i = 1; i < anchors.length; i++) {
    const [d1, t1] = anchors[i - 1];
    const [d2, t2] = anchors[i];
    if (df <= d2) return t1 + ((t2 - t1) * (df - d1)) / (d2 - d1);
  }
  return 1.959964;
}

/** Half-width of the two-sided 95% confidence interval of a mean. */
export function ci95HalfWidth(values: number[]): number {
  if (values.length < 2) return 0;
  return tCritical95(values.length - 1) * sem(values);
}

// ------------------------------------------------------------- Welch t-test

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

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
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

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logTerm =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const term = Math.exp(logTerm);
  if (x < (a + 1) / (a + b + 2)) {
    return (term * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (term * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a Student t statistic. */
export function studentTTwoSidedP(t: number, df: number): number | null {
  if (!Number.isFinite(df) || df <= 0) return null;
  if (!Number.isFinite(t)) return 0;
  if (t === 0) return 1;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, incompleteBeta(df / 2, 0.5, x)));
}

export interface WelchResult {
  t: number;
  df: number;
  p: number;
}

/** Two-sided Welch t-test for two independent samples. */
export function welchTTest(a: number[], b: number[]): WelchResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = sampleSd(a) ** 2;
  const varB = sampleSd(b) ** 2;
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
  const denominator = (termA ** 2) / (a.length - 1) + (termB ** 2) / (b.length - 1);
  const df = denominator === 0 ? a.length + b.length - 2 : numerator / denominator;
  const p = studentTTwoSidedP(t, df);
  return p === null ? null : { t, df, p };
}
