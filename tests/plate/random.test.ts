import { describe, expect, it } from 'vitest';
import { mulberry32, shuffled, shuffleInPlace } from '$lib/tools/plate/random';

describe('mulberry32', () => {
  it('produces a stable known sequence for seed 42', () => {
    const random = mulberry32(42);
    expect(random()).toBeCloseTo(0.601103751920, 12);
    expect(random()).toBeCloseTo(0.448290558998, 12);
    expect(random()).toBeCloseTo(0.85246579349, 12);
    expect(random()).toBeCloseTo(0.669734041439, 12);
    expect(random()).toBeCloseTo(0.174813898746, 12);
  });

  it('is deterministic per seed and independent across seeds', () => {
    const a = mulberry32(20261102);
    const b = mulberry32(20261102);
    const c = mulberry32(7);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    const seqC = Array.from({ length: 8 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('stays within [0, 1)', () => {
    const random = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('normalizes negative and oversized seeds', () => {
    const negative = mulberry32(-1);
    const wrapped = mulberry32(0xffffffff);
    expect(negative()).toBeCloseTo(0.896422614111, 12);
    expect(wrapped()).toBeCloseTo(0.896422614111, 12);
  });
});

describe('Fisher-Yates helpers', () => {
  it('shuffles deterministically with the same seed', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const first = shuffled(items, mulberry32(42));
    const second = shuffled(items, mulberry32(42));
    expect(first).toEqual(second);
    expect(first).not.toEqual(items);
    expect([...first].sort((x, y) => x - y)).toEqual(items);
  });

  it('does not mutate the input when using shuffled', () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    shuffled(items, mulberry32(1));
    expect(items).toEqual(copy);
  });

  it('shuffles in place and keeps every element', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffleInPlace(items, mulberry32(3));
    expect(result).toBe(items);
    expect([...items].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('leaves empty and single-element arrays untouched', () => {
    expect(shuffled([], mulberry32(1))).toEqual([]);
    expect(shuffled(['only'], mulberry32(1))).toEqual(['only']);
  });
});
