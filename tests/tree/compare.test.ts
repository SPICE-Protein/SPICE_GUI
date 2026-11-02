import { describe, expect, it } from 'vitest';
import { parseNewick } from '$lib/tools/tree/newick';
import { compareTrees } from '$lib/tools/tree/compare';
import { emptySupportSummary, supportSummary } from '$lib/tools/tree/support';

function tree(text: string) {
  return parseNewick(text).root;
}

describe('compareTrees', () => {
  it('reports zero distance for identical topologies', () => {
    const a = tree('((A:1,B:1):1,(C:1,D:1):1);');
    const result = compareTrees(a, a);
    expect(result.sharedLeaves).toEqual(['A', 'B', 'C', 'D']);
    expect(result.sharedSplits).toBe(1);
    expect(result.rf).toBe(0);
    expect(result.normalizedRf).toBe(0);
    expect(result.identical).toBe(true);
  });

  it('counts the two unique splits in an alternative quartet', () => {
    const a = tree('((A:1,B:1):1,(C:1,D:1):1);');
    const b = tree('((A:1,C:1):1,(B:1,D:1):1);');
    const result = compareTrees(a, b);
    expect(result.sharedSplits).toBe(0);
    expect(result.uniqueA).toBe(1);
    expect(result.uniqueB).toBe(1);
    expect(result.rf).toBe(2);
    expect(result.maxRf).toBe(2);
    expect(result.normalizedRf).toBe(1);
    expect(result.identical).toBe(false);
  });

  it('handles partially overlapping leaf sets without inventing splits', () => {
    const a = tree('((A:1,B:1):1,(C:1,D:1):1);');
    const b = tree('((A:1,B:1):1,E:1);');
    const result = compareTrees(a, b);
    expect(result.sharedLeaves).toEqual(['A', 'B']);
    expect(result.leavesOnlyA).toEqual(['C', 'D']);
    expect(result.leavesOnlyB).toEqual(['E']);
    expect(result.identical).toBe(false);
  });
});

describe('supportSummary', () => {
  it('normalizes fractions to percent and bins them', () => {
    const root = tree('(A:1,(B:1,C:1)0.9:1);');
    const summary = supportSummary(root, 85, 10);
    expect(summary.internal).toBe(2);
    expect(summary.withSupport).toBe(1);
    expect(summary.shown).toBe(1);
    expect(summary.filtered).toBe(0);
    expect(summary.mean).toBeCloseTo(90, 8);
    expect(summary.bins[9].total).toBe(1);
    expect(summary.bins[9].shown).toBe(1);
  });

  it('filters support below the threshold', () => {
    const root = tree('(A:1,(B:1,C:1)72:1);');
    const summary = supportSummary(root, 80, 10);
    expect(summary.withSupport).toBe(1);
    expect(summary.shown).toBe(0);
    expect(summary.filtered).toBe(1);
    expect(summary.bins[7].filtered).toBe(1);
  });

  it('returns a stable empty histogram', () => {
    const empty = emptySupportSummary(10);
    expect(empty.bins).toHaveLength(10);
    expect(empty.internal).toBe(0);
    expect(empty.mean).toBeNull();
  });
});
