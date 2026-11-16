import { describe, expect, it } from 'vitest';
import {
  extractRange,
  firstOverlap,
  isRangeInBounds,
  isWrappedRange,
  positionAt,
  rangeLength,
  rangeSegments,
} from '$lib/gene/featureRange';
import { toEmbl, toGenBank } from '$lib/genome/formats';

const SEQUENCE = 'ACGTACGTACGTACGTACGT';
const LENGTH = SEQUENCE.length;

describe('featureRange', () => {
  it('treats a range stored backwards as a wrap across the origin', () => {
    expect(isWrappedRange({ start: 15, end: 5 })).toBe(true);
    expect(isWrappedRange({ start: 5, end: 15 })).toBe(false);
    expect(rangeLength({ start: 15, end: 5 }, LENGTH)).toBe(11);
    expect(rangeLength({ start: 5, end: 15 }, LENGTH)).toBe(11);
  });

  it('follows the origin when it reads bases', () => {
    expect(extractRange(SEQUENCE, { start: 17, end: 4 })).toBe('ACGTACGT');
    expect(extractRange(SEQUENCE, { start: 3, end: 6 })).toBe('GTAC');
  });

  it('maps an offset back to a document position across the origin', () => {
    expect(positionAt({ start: 17, end: 4 }, 0, LENGTH)).toBe(17);
    expect(positionAt({ start: 17, end: 4 }, 4, LENGTH)).toBe(1);
    expect(positionAt({ start: 17, end: 4 }, 8, LENGTH)).toBe(5);
  });

  it('splits a wrapped range into two segments in document order', () => {
    expect(rangeSegments({ start: 15, end: 5 }, LENGTH)).toEqual([
      { start: 15, end: 20 },
      { start: 1, end: 5 },
    ]);
    expect(rangeSegments({ start: 5, end: 15 }, LENGTH)).toEqual([{ start: 5, end: 15 }]);
  });

  it('finds an overlap that only exists across the origin', () => {
    expect(firstOverlap({ start: 15, end: 5 }, { start: 18, end: 2 }, LENGTH)).toEqual({
      start: 18,
      end: 20,
    });
    expect(firstOverlap({ start: 15, end: 5 }, { start: 7, end: 12 }, LENGTH)).toBeNull();
  });

  it('rejects coordinates outside the sequence', () => {
    expect(isRangeInBounds({ start: 1, end: LENGTH }, LENGTH)).toBe(true);
    expect(isRangeInBounds({ start: 0, end: 5 }, LENGTH)).toBe(false);
    expect(isRangeInBounds({ start: 5, end: LENGTH + 1 }, LENGTH)).toBe(false);
    expect(isRangeInBounds({ start: 2.5, end: 5 }, LENGTH)).toBe(false);
  });
});

describe('serialising a feature that crosses the origin', () => {
  const data = {
    sequence: SEQUENCE,
    name: 'pWRAP',
    circular: true,
    features: [{ name: 'backbone', type: 'misc_feature', start: 14, end: 4, forward: true }],
  };

  it('writes the range as a join in GenBank', () => {
    const text = toGenBank(data as never);
    expect(text).toMatch(/MISC_FEATURE\s+join\(15\.\.20,1\.\.5\)/);
  });

  it('writes the range as a join in EMBL', () => {
    const text = toEmbl(data as never);
    expect(text).toContain('join(15..20,1..5)');
  });
});
