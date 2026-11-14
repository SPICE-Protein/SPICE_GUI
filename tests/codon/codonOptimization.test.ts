import { describe, expect, it } from 'vitest';
import {
  calculateGc,
  findForbiddenMotifs,
  optimizeCodonsMultiObjective
} from '$lib/genome/codonOptimization';
import { getAminoAcidOfCodon } from '$lib/genome/codon';

function translate(dna: string): string {
  let protein = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) {
    protein += getAminoAcidOfCodon(dna.slice(i, i + 3)) ?? '?';
  }
  return protein;
}

describe('optimizeCodonsMultiObjective', () => {
  it('produces the same sequence for the same seed', () => {
    const protein = 'MLVAGPMLVAGPMLVAGP';
    const options = {
      host: 'ecoli' as const,
      targetGc: 45,
      seed: 12345,
      iterations: 600
    };

    const first = optimizeCodonsMultiObjective(protein, options);
    const second = optimizeCodonsMultiObjective(protein, options);

    expect(first.sequence).toBe(second.sequence);
    expect(first.cai).toBeCloseTo(second.cai, 12);
    expect(first.iterations).toBe(600);
    expect(first.improvements).toBe(second.improvements);
    expect(translate(first.sequence)).toBe(protein);
  });

  it('preserves stop codons as a stop codon', () => {
    const protein = 'MKT*';
    const result = optimizeCodonsMultiObjective(protein, {
      host: 'ecoli',
      seed: 7,
      iterations: 300
    });

    expect(translate(result.sequence)).toBe(protein);
    const lastCodon = result.sequence.slice(-3);
    expect(['TAA', 'TAG', 'TGA']).toContain(lastCodon);
  });

  it('removes a forbidden motif when synonymous alternatives exist', () => {
    const protein = 'MEFG';
    const baseline = optimizeCodonsMultiObjective(protein, {
      host: 'ecoli',
      seed: 42,
      iterations: 0
    });
    expect(baseline.sequence).toContain('GAATTC');

    const result = optimizeCodonsMultiObjective(protein, {
      host: 'ecoli',
      seed: 42,
      iterations: 500,
      forbiddenMotifs: ['GAATTC']
    });

    expect(result.sequence).not.toContain('GAATTC');
    expect(findForbiddenMotifs(result.sequence, ['GAATTC'])).toEqual([]);
    expect(translate(result.sequence)).toBe(protein);
  });

  it('moves GC toward the requested target compared with the best-codon baseline', () => {
    const protein = 'MLVAGP'.repeat(5);
    const options = {
      host: 'ecoli' as const,
      targetGc: 40,
      seed: 1
    };

    const baseline = optimizeCodonsMultiObjective(protein, {
      ...options,
      iterations: 0
    });
    const result = optimizeCodonsMultiObjective(protein, {
      ...options,
      iterations: 1500
    });

    expect(Math.abs(result.gc - options.targetGc)).toBeLessThan(
      Math.abs(baseline.gc - options.targetGc)
    );
    expect(result.gc).toBeCloseTo(calculateGc(result.sequence), 10);
    expect(translate(result.sequence)).toBe(protein);
  });

  it('returns a positive CAI and translates back to the input protein', () => {
    const protein = 'MKTAYIAKQRQISFVKSHFSRQDILDLWIYHTQGYFP';
    const result = optimizeCodonsMultiObjective(protein, {
      host: 'yeast',
      targetGc: 42,
      seed: 99,
      iterations: 800
    });

    expect(result.cai).toBeGreaterThan(0);
    expect(result.cai).toBeLessThanOrEqual(1);
    expect(translate(result.sequence)).toBe(protein);
  });

  it('reports remaining hard-constraint violations', () => {
    const result = optimizeCodonsMultiObjective('KKKK', {
      host: 'yeast',
      maxHomopolymer: 2,
      iterations: 0
    });

    expect(result.violations.some((entry) => entry.includes('Homopolymer'))).toBe(
      true
    );
  });

  it('rejects empty input and unsupported residues', () => {
    expect(() => optimizeCodonsMultiObjective('', { host: 'ecoli' })).toThrow(
      /empty/i
    );
    expect(() => optimizeCodonsMultiObjective('MKZ', { host: 'ecoli' })).toThrow(
      /Unsupported amino acid/i
    );
  });
});
