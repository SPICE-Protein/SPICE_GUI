import { describe, expect, it } from 'vitest';
import type { Env } from '$lib/backend/types';
import {
  DEFAULT_FOLD_PROVIDER_ID,
  FOLD_PROVIDERS,
  foldWithProvider,
  getFoldProvider,
} from '$lib/folding/registry';
import {
  buildAutomodelBody,
  formatSwissModelError,
  parsePdbCaCoordinates,
  parseProjectId,
  parseSummary,
  pdbCaToFoldOutput,
  swissModelFoldProvider,
} from '$lib/folding/providers/swissmodel';

const ENV: Env = { ph: 7.0, tempK: 310, pressureBar: 1.0, ionicStrengthM: 0.0 };

// Four residues, Cα atoms spaced 3.8 Å along x.
const PDB = [
  'ATOM      1  CA  ALA A   1      10.000  10.000  10.000  1.00 20.00           C',
  'ATOM      2  CA  CYS A   2      13.800  10.000  10.000  1.00 20.00           C',
  'ATOM      3  CA  ASP A   3      17.600  10.000  10.000  1.00 20.00           C',
  'ATOM      4  CA  GLU A   4      21.400  10.000  10.000  1.00 20.00           C',
  'TER',
  'END',
].join('\n');

const PDB_THREE = PDB.split('\n').slice(0, 3).join('\n');

describe('fold provider registry', () => {
  it('exposes the expected providers and default', () => {
    expect(Object.keys(FOLD_PROVIDERS).sort()).toEqual(['demo', 'spice', 'swissmodel']);
    expect(DEFAULT_FOLD_PROVIDER_ID).toBe('spice');
    expect(getFoldProvider('spice').descriptor.id).toBe('spice');
    expect(() => getFoldProvider('unknown')).toThrow(/Unknown fold provider/);
  });

  it('advertises provider-specific capabilities', () => {
    const spice = getFoldProvider('spice').descriptor.capabilities;
    expect(spice.environment).toBe(true);
    expect(spice.pressure).toBe(false);
    expect(spice.mutantHead).toBe(true);
    expect(spice.distogram).toBe(true);
    expect(spice.contactMap).toBe(true);
    expect(spice.mutationProbabilities).toBe(true);
    expect(spice.confidence).toBe(true);
    expect(spice.asyncJob).toBe(false);
    expect(spice.requiresToken).toBe(false);

    const swiss = getFoldProvider('swissmodel').descriptor.capabilities;
    expect(swiss.environment).toBe(false);
    expect(swiss.pressure).toBe(false);
    expect(swiss.mutantHead).toBe(false);
    expect(swiss.distogram).toBe(false);
    expect(swiss.contactMap).toBe(false);
    expect(swiss.mutationProbabilities).toBe(false);
    expect(swiss.confidence).toBe(true);
    expect(swiss.asyncJob).toBe(true);
    expect(swiss.requiresToken).toBe(true);
  });

  it('runs the demo provider without network access', async () => {
    const result = await foldWithProvider({ providerId: 'demo', sequence: 'ACDE', env: ENV });
    expect(result.providerId).toBe('demo');
    expect(result.output.length).toBe(4);
    expect(result.output.coords).toHaveLength(12);
  });

  it('requires a token for the SWISS-MODEL provider', async () => {
    await expect(
      swissModelFoldProvider.fold({ sequence: 'ACDE', env: ENV })
    ).rejects.toThrow('SWISS-MODEL API token required');
  });
});

describe('SWISS-MODEL payload helpers', () => {
  it('builds the automodel request body', () => {
    expect(buildAutomodelBody('ACDE', 'job title')).toEqual({
      target_sequences: ['ACDE'],
      project_title: 'job title',
    });
  });

  it('parses a project id', () => {
    expect(parseProjectId('{"project_id":"proj-123"}')).toBe('proj-123');
    expect(() => parseProjectId('{"unexpected":true}')).toThrow(/project id/);
    expect(() => parseProjectId('<html>bad gateway</html>')).toThrow(/SWISS-MODEL/);
  });

  it('parses a project summary and normalizes QMEAN', () => {
    const summary = parseSummary(
      JSON.stringify({
        status: 'completed',
        models: [
          {
            model_id: 'model-1',
            coordinates_url: 'https://example.org/model-1.pdb',
            qmean: { global_score: 0.82 },
          },
          {
            model_id: 'model-2',
            coordinates_url: '',
            qmean: 61,
          },
        ],
      })
    );
    expect(summary.status).toBe('COMPLETED');
    expect(summary.models).toHaveLength(2);
    expect(summary.models[0].modelId).toBe('model-1');
    expect(summary.models[0].coordinatesUrl).toBe('https://example.org/model-1.pdb');
    expect(summary.models[0].qmean).toBeCloseTo(82);
    expect(summary.models[1].qmean).toBe(61);
  });

  it('formats API errors', () => {
    expect(formatSwissModelError('{"error":"invalid token"}', 401)).toBe(
      'SWISS-MODEL HTTP 401: invalid token'
    );
    expect(formatSwissModelError('')).toBe('SWISS-MODEL request failed');
  });
});

describe('PDB Cα conversion', () => {
  it('parses ATOM CA records in order', () => {
    expect(parsePdbCaCoordinates(PDB)).toEqual([
      [10, 10, 10],
      [13.8, 10, 10],
      [17.6, 10, 10],
      [21.4, 10, 10],
    ]);
    expect(parsePdbCaCoordinates('HEADER    NOT A STRUCTURE\n')).toEqual([]);
  });

  it('produces a FoldOutput with the expected dimensions', () => {
    const output = pdbCaToFoldOutput(PDB, 'ACDE', {
      projectId: 'proj-1',
      modelId: 'model-1',
      elapsedMs: 1234,
      qmean: 82,
    });

    expect(output.length).toBe(4);
    expect(output.coords).toHaveLength(12);
    expect(output.coordsMut).toEqual(output.coords);
    expect(output.distExp).toHaveLength(16);
    expect(output.pContact).toHaveLength(16);
    expect(output.mutation).toHaveLength(80);
    expect(output.envOffset).toEqual([0, 0]);
    expect(output.conf).toHaveLength(2);
    expect(output.conf[0]).toBeCloseTo(0.82);
    expect(output.conf[1]).toBeCloseTo(1);
    expect(output.trainedHeads).toEqual(['A']);
    expect(output.modelPath).toBe('swissmodel://proj-1/model-1');
    expect(output.runMs).toBe(1234);

    // Adjacent Cα atoms are 3.8 Å apart, the first/last pair is 11.4 Å.
    expect(output.pContact[0 * 4 + 1]).toBe(1);
    expect(output.pContact[0 * 4 + 3]).toBe(0);
    expect(output.distExp[0 * 4 + 3]).toBeCloseTo(11.4);
  });

  it('fills missing Cα positions with the nearest known coordinate', () => {
    const output = pdbCaToFoldOutput(PDB_THREE, 'ACDEF', {
      projectId: 'proj-1',
      modelId: 'model-1',
      elapsedMs: 10,
      qmean: 50,
    });

    expect(output.length).toBe(5);
    expect(output.coords).toHaveLength(15);
    // Positions 4 and 5 repeat the last observed Cα (17.6 Å).
    expect(output.coords.slice(9)).toEqual([17.6, 10, 10, 17.6, 10, 10]);
    expect(output.conf[1]).toBeCloseTo(3 / 5);
  });

  it('throws only when no Cα atom is present', () => {
    expect(() =>
      pdbCaToFoldOutput('HEADER    NOT A STRUCTURE\n', 'ACDE', {
        projectId: 'proj-1',
        modelId: 'model-1',
        elapsedMs: 0,
      })
    ).toThrow(/no C/);
  });
});
