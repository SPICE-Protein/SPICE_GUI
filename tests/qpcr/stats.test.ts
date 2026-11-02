import { describe, expect, it } from 'vitest';
import {
  efficiencyFromSlope,
  incompleteBeta,
  linearRegression,
  logGamma,
  mean,
  sampleSd,
  sem,
  studentTTwoSidedP,
  welchTTest,
} from '$lib/tools/qpcr/stats';

describe('descriptive statistics', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([-4, 4])).toBe(0);
  });

  it('returns NaN for an empty sample', () => {
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('uses the n-1 sample standard deviation and handles small samples', () => {
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935, 8);
    expect(sampleSd([5])).toBeNull();
    expect(sampleSd([])).toBeNull();
  });

  it('divides the sample SD by sqrt(n) for the SEM', () => {
    expect(sem([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3) / 2, 12);
    expect(sem([7])).toBeNull();
  });

  it('matches the log-gamma reference values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(2)).toBeCloseTo(0, 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10);
  });
});

describe('incomplete beta and Student t', () => {
  it('satisfies boundary and uniform cases', () => {
    expect(incompleteBeta(1, 1, 0)).toBe(0);
    expect(incompleteBeta(1, 1, 1)).toBe(1);
    expect(incompleteBeta(1, 1, 0.3)).toBeCloseTo(0.3, 12);
  });

  it('matches the binomial closed form for integer parameters', () => {
    // I_0.5(2,3) = P(Bin(4,0.5) >= 2) = 11/16
    expect(incompleteBeta(2, 3, 0.5)).toBeCloseTo(11 / 16, 12);
  });

  it('is symmetric in its parameters', () => {
    const a = incompleteBeta(3, 7, 0.25);
    const b = 1 - incompleteBeta(7, 3, 0.75);
    expect(a).toBeCloseTo(b, 10);
  });

  it('reports conventional two-sided p-values', () => {
    expect(studentTTwoSidedP(0, 10)).toBe(1);
    expect(studentTTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 4);
    expect(studentTTwoSidedP(-2.228, 10)).toBeCloseTo(0.05, 4);
    expect(studentTTwoSidedP(Infinity, 10)).toBe(0);
    expect(studentTTwoSidedP(1, 0)).toBeNull();
  });
});

describe('Welch t-test', () => {
  it('matches a hand-computed small sample', () => {
    const result = welchTTest([1, 2, 3], [4, 5, 6])!;
    expect(result.t).toBeCloseTo(-3.674234614, 8);
    expect(result.df).toBeCloseTo(4, 8);
    expect(result.p).toBeGreaterThan(0.02);
    expect(result.p).toBeLessThan(0.023);
  });

  it('returns null when a group has fewer than two observations', () => {
    expect(welchTTest([1], [2, 3])).toBeNull();
    expect(welchTTest([1, 2], [])).toBeNull();
  });

  it('handles zero variance analytically', () => {
    expect(welchTTest([1, 1], [2, 2])).toEqual({ t: -Infinity, df: 2, p: 0 });
    expect(welchTTest([3, 3], [3, 3])).toEqual({ t: 0, df: 2, p: 1 });
  });
});

describe('linear regression and efficiency', () => {
  it('recovers an exact line', () => {
    const fit = linearRegression([
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ])!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.n).toBe(3);
    expect(fit.xMin).toBe(1);
    expect(fit.xMax).toBe(3);
  });

  it('computes a negative standard-curve slope with R2 below one', () => {
    const fit = linearRegression([
      { x: 1, y: 30 },
      { x: 2, y: 26 },
      { x: 3, y: 23 },
      { x: 4, y: 20 },
    ])!;
    expect(fit.slope).toBeLessThan(0);
    expect(fit.r2).toBeGreaterThan(0.97);
    expect(fit.r2).toBeLessThan(1);
  });

  it('rejects degenerate input', () => {
    expect(linearRegression([{ x: 1, y: 2 }])).toBeNull();
    expect(
      linearRegression([
        { x: 2, y: 1 },
        { x: 2, y: 5 },
      ]),
    ).toBeNull();
  });

  it('converts slope to amplification efficiency', () => {
    // slope = -log10(2)/log10(2)... a perfect doubling curve is -3.321928.
    expect(efficiencyFromSlope(-3.321928094887362)).toBeCloseTo(1, 8);
    expect(efficiencyFromSlope(-3.32)).toBeCloseTo(1.0, 2);
    expect(Number.isNaN(efficiencyFromSlope(0))).toBe(true);
    expect(Number.isNaN(efficiencyFromSlope(Number.NaN))).toBe(true);
  });
});
