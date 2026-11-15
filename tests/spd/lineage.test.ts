import { describe, expect, it } from 'vitest';
import { substitutionDiff } from '$lib/spd/lineage';

describe('substitutionDiff', () => {
  it('reports nothing for identical sequences', () => {
    expect(substitutionDiff('MKV', 'MKV')).toEqual([]);
  });

  it('reports 1-based positions for every substitution', () => {
    expect(substitutionDiff('MKVAA', 'MRVSA')).toEqual([
      { position: 2, from: 'K', to: 'R' },
      { position: 4, from: 'A', to: 'S' },
    ]);
  });

  it('upper-cases both sides so case-only edits are not mutations', () => {
    expect(substitutionDiff('mkv', 'MKV')).toEqual([]);
    expect(substitutionDiff('mkv', 'mrV')).toEqual([{ position: 2, from: 'K', to: 'R' }]);
  });

  it('declines a length change instead of inventing a parent link', () => {
    expect(substitutionDiff('MKV', 'MKVA')).toBeNull();
    expect(substitutionDiff('MKVA', 'MKV')).toBeNull();
  });

  it('declines empty input', () => {
    expect(substitutionDiff('', 'MKV')).toBeNull();
    expect(substitutionDiff('MKV', '')).toBeNull();
  });
});
