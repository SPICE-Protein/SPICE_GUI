import { describe, expect, it } from 'vitest';
import {
  parseDnaBlocks,
  parseMutationBlocks,
  toCartMutations,
  validateDnaSequence,
  validateMutations,
} from '$lib/ai/parse';

describe('parseMutationBlocks', () => {
  it('collects rows from arrays and {mutations} objects', () => {
    const text = [
      'Here are two suggestions:',
      '```json',
      '[{"pos": 3, "from": "a", "to": "v", "score": -1.2}]',
      '```',
      'And one more:',
      '```json',
      '{"mutations": [{"pos": 7, "from": "G", "to": "D"}]}',
      '```',
    ].join('\n');

    expect(parseMutationBlocks(text)).toEqual([
      { pos: 3, from: 'A', to: 'V', score: -1.2 },
      { pos: 7, from: 'G', to: 'D', score: undefined },
    ]);
  });

  it('ignores malformed JSON and incomplete rows', () => {
    const text = [
      '```json',
      '{not json',
      '```',
      '```json',
      '[{"pos": 0, "from": "A", "to": "V"}, {"pos": 2, "from": "", "to": "V"}]',
      '```',
    ].join('\n');

    expect(parseMutationBlocks(text)).toEqual([]);
  });

  it('only reads json fences', () => {
    expect(parseMutationBlocks('```dna\nACGT\n```')).toEqual([]);
  });
});

describe('parseDnaBlocks', () => {
  it('takes the first dna fence, strips whitespace, and uppercases', () => {
    const text = '```dna\nacgt nn\n```\n```dna\nTTTT\n```';
    expect(parseDnaBlocks(text)).toBe('ACGTNN');
  });

  it('returns null when no dna fence exists', () => {
    expect(parseDnaBlocks('no sequence here')).toBeNull();
  });
});

describe('validateMutations', () => {
  it('accepts matching wild-type residues and reports mismatches', () => {
    const result = validateMutations(
      [
        { pos: 4, from: 'A', to: 'V' },
        { pos: 5, from: 'W', to: 'Y' },
      ],
      'MKTA',
    );

    expect(result.valid).toEqual([{ pos: 4, from: 'A', to: 'V', score: undefined }]);
    expect(result.errors).toEqual(['position 5 is outside the 4-residue sequence']);
  });

  it('rejects out-of-range positions and non-standard residues', () => {
    const result = validateMutations(
      [
        { pos: 9, from: 'A', to: 'V' },
        { pos: 1, from: 'B', to: 'V' },
        { pos: 1, from: 'M', to: 'Z' },
      ],
      'MKTA',
    );

    expect(result.valid).toEqual([]);
    expect(result.errors).toHaveLength(3);
  });

  it('validates structure without a sequence when none is supplied', () => {
    const result = validateMutations([{ pos: 42, from: 'A', to: 'V' }], '');
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe('validateDnaSequence', () => {
  it('normalizes valid DNA and IUPAC ambiguity codes', () => {
    expect(validateDnaSequence(' acgt nRysw\n')).toEqual({ sequence: 'ACGTNRYSW', error: null });
  });

  it('rejects empty and non-DNA input', () => {
    expect(validateDnaSequence('   ').error).toBe('empty sequence');
    expect(validateDnaSequence('ACGTE').error).toBe('sequence contains non-DNA characters');
    expect(validateDnaSequence('ACGT-ACGT').error).toBe('sequence contains non-DNA characters');
  });
});

describe('toCartMutations', () => {
  it('converts 1-based positions to 0-based without mutating the input', () => {
    const rows = [{ pos: 1, from: 'M', to: 'V' }];
    expect(toCartMutations(rows)).toEqual([{ pos: 0, from: 'M', to: 'V' }]);
    expect(rows[0].pos).toBe(1);
  });
});
