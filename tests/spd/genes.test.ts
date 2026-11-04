import { beforeEach, describe, expect, it, vi } from 'vitest';

// The publisher/loader resolve their client from the SPD store, whose module
// initializes Svelte runes at import time. Replace it with a controllable stub
// so loadGene can be tested without touching the network.
const client = vi.hoisted(() => ({
  getGene: vi.fn(),
  listGeneRegions: vi.fn(),
}));
vi.mock('$lib/spd/store.svelte', () => ({ configureSpdClient: () => client }));

import {
  loadGene,
  mapFeatureTypeToRegionType,
  mapGeneRegionsToFeatures,
  normalizeGeneDna,
  toGeneRegions,
} from '$lib/spd/genes';

type Feature = Parameters<typeof toGeneRegions>[0][number];
type Region = Parameters<typeof mapGeneRegionsToFeatures>[0][number];

/** Cast loosely shaped fixtures (invalid coordinates are the point). */
function feature(value: unknown): Feature {
  return value as Feature;
}

function region(value: unknown): Region {
  return value as Region;
}

beforeEach(() => {
  client.getGene.mockReset();
  client.listGeneRegions.mockReset();
});

describe('normalizeGeneDna', () => {
  it('upper-cases and strips ASCII whitespace only', () => {
    expect(normalizeGeneDna('  ac\n\tgt\r\f\v ')).toBe('ACGT');
    expect(normalizeGeneDna('acgt')).toBe('ACGT');
  });

  it('preserves ambiguous and even invalid letters', () => {
    // Coordinates are tied to the original string, so nothing is filtered.
    expect(normalizeGeneDna('nryswkmbdhvn')).toBe('NRYSWKMBDHVN');
    expect(normalizeGeneDna('ACGTX')).toBe('ACGTX');
  });

  it('does not treat non-ASCII whitespace as removable', () => {
    expect(normalizeGeneDna('AC\u00A0GT')).toBe('AC\u00A0GT');
  });

  it('throws when nothing remains', () => {
    expect(() => normalizeGeneDna(' \n\t\r\f\v')).toThrow('gene sequence is empty');
    expect(() => normalizeGeneDna('')).toThrow('gene sequence is empty');
  });
});

describe('mapFeatureTypeToRegionType', () => {
  it('passes through SPD enum members and normalizes case', () => {
    expect(mapFeatureTypeToRegionType('cds')).toBe('cds');
    expect(mapFeatureTypeToRegionType('CDS')).toBe('cds');
    expect(mapFeatureTypeToRegionType('promoter')).toBe('promoter');
    expect(mapFeatureTypeToRegionType('TATA-box')).toBe('tata_box');
  });

  it('maps common UTR spellings', () => {
    expect(mapFeatureTypeToRegionType("5'UTR")).toBe('five_prime_utr');
    expect(mapFeatureTypeToRegionType('5 UTR')).toBe('five_prime_utr');
    expect(mapFeatureTypeToRegionType('five prime UTR')).toBe('five_prime_utr');
    expect(mapFeatureTypeToRegionType("3' UTR")).toBe('three_prime_utr');
    expect(mapFeatureTypeToRegionType('three prime UTR')).toBe('three_prime_utr');
  });

  it('maps GenBank generic features to other', () => {
    expect(mapFeatureTypeToRegionType('misc_feature')).toBe('other');
    expect(mapFeatureTypeToRegionType('gene')).toBe('other');
    // Unknown names are never forwarded to the server.
    expect(mapFeatureTypeToRegionType('weird-thing')).toBe('other');
    expect(mapFeatureTypeToRegionType('')).toBe('other');
  });
});

describe('toGeneRegions', () => {
  it('maps 1-based inclusive coordinates, strand, and feature keys', () => {
    const { regions, skipped } = toGeneRegions([
      { name: 'Promoter', start: 1, end: 100, type: 'promoter', forward: true },
      { name: '  CDS  ', start: 101, end: 400, type: 'cds' },
      { name: 'Reverse feature', start: 500, end: 600, type: 'misc_feature', forward: false },
    ], 1000);

    expect(skipped).toBe(0);
    expect(regions).toEqual([
      {
        molecule: 'dna',
        regionType: 'promoter',
        description: 'Promoter',
        startPosition: 1,
        endPosition: 100,
        strand: 'forward',
        featureKey: 'promoter',
      },
      {
        molecule: 'dna',
        regionType: 'cds',
        description: 'CDS',
        startPosition: 101,
        endPosition: 400,
        strand: 'forward',
        featureKey: 'cds',
      },
      {
        molecule: 'dna',
        regionType: 'other',
        description: 'Reverse feature',
        startPosition: 500,
        endPosition: 600,
        strand: 'reverse',
        featureKey: 'misc_feature',
      },
    ]);
  });

  it('skips invalid and origin-spanning coordinates instead of clamping', () => {
    const { regions, skipped } = toGeneRegions([
      feature({ name: 'zero', start: 0, end: 10, type: 'cds' }),
      feature({ name: 'fraction', start: 1.5, end: 10, type: 'cds' }),
      feature({ name: 'nan', start: NaN, end: 10, type: 'cds' }),
      feature({ name: 'infinite', start: 1, end: Infinity, type: 'cds' }),
      feature({ name: 'reversed', start: 20, end: 10, type: 'cds' }),
      feature({ name: 'past end', start: 900, end: 1001, type: 'cds' }),
      feature({ name: 'origin spanning', start: 950, end: 50, type: 'cds' }),
      feature({ name: 'missing end', start: 10, type: 'cds' }),
      feature({ name: 'string coordinate', start: '1', end: 10, type: 'cds' }),
    ], 1000);

    expect(regions).toEqual([]);
    expect(skipped).toBe(9);
  });

  it('falls back to the type for a blank name and skips fully blank rows', () => {
    const { regions, skipped } = toGeneRegions([
      { name: '   ', start: 1, end: 10, type: 'exon' },
      { name: '', start: 20, end: 30, type: '' },
    ], 1000);

    expect(skipped).toBe(1);
    expect(regions).toHaveLength(1);
    expect(regions[0].description).toBe('exon');
    expect(regions[0].featureKey).toBe('exon');
  });

  it('caps descriptions at 400 characters and feature keys at 64', () => {
    const { regions } = toGeneRegions([
      { name: 'x'.repeat(500), start: 1, end: 10, type: 't'.repeat(80) },
    ], 1000);

    expect(regions[0].description).toHaveLength(400);
    expect(regions[0].featureKey).toHaveLength(64);
    expect(regions[0].regionType).toBe('other');
  });

  it('caps the batch at 500 regions and counts the rest as skipped', () => {
    const features: Feature[] = Array.from({ length: 505 }, (_, i) => ({
      name: `feature-${i}`,
      start: 1,
      end: 2,
      type: 'cds',
    }));

    const { regions, skipped } = toGeneRegions(features, 1000);
    expect(regions).toHaveLength(500);
    expect(skipped).toBe(5);
  });
});

describe('mapGeneRegionsToFeatures', () => {
  it('can project the RNA molecule used by RefSeq-imported genes', () => {
    const features = mapGeneRegionsToFeatures([
      region({ molecule: 'rna', regionType: 'exon', description: 'Exon 1', startPosition: 1, endPosition: 187, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'cds', description: 'DNA row', startPosition: 200, endPosition: 300, strand: 'forward' }),
    ], 1000, 'rna');

    expect(features).toEqual([
      { name: 'Exon 1', start: 1, end: 187, type: 'exon', forward: true },
    ]);
  });

  it('keeps only placed DNA rows and maps the reverse strand', () => {
    const features = mapGeneRegionsToFeatures([
      region({ molecule: 'dna', regionType: 'promoter', description: 'Promoter', startPosition: 1, endPosition: 100, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'cds', description: '', startPosition: 200, endPosition: 300, strand: 'reverse' }),
      region({ molecule: 'rna', regionType: 'cds', description: 'RNA row', startPosition: 1, endPosition: 100, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'unplaced', startPosition: null, endPosition: null, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'past end', startPosition: 990, endPosition: 1001, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'zero', startPosition: 0, endPosition: 10, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'reversed', startPosition: 50, endPosition: 40, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'fraction', startPosition: 1.5, endPosition: 10, strand: 'forward' }),
      region({ molecule: 'dna', regionType: 'exon', description: 'no strand', startPosition: 400, endPosition: 450, strand: null }),
    ], 1000);

    expect(features).toEqual([
      { name: 'Promoter', start: 1, end: 100, type: 'promoter', forward: true },
      { name: 'cds', start: 200, end: 300, type: 'cds', forward: false },
      { name: 'no strand', start: 400, end: 450, type: 'exon', forward: true },
    ]);
  });
});

describe('loadGene', () => {
  it('loads a DNA record and maps its DNA regions', async () => {
    client.getGene.mockResolvedValue({
      id: 'spd:gene:1',
      name: 'dna-gene',
      dnaSequence: 'acgt',
      rnaSequence: null,
    });
    client.listGeneRegions.mockResolvedValue([
      { molecule: 'dna', regionType: 'cds', description: 'CDS', startPosition: 1, endPosition: 4, strand: 'forward' },
    ]);

    const loaded = await loadGene('spd:gene:1');
    expect(loaded.sourceMolecule).toBe('dna');
    expect(loaded.sequence).toBe('ACGT');
    expect(loaded.features).toEqual([{ name: 'CDS', start: 1, end: 4, type: 'cds', forward: true }]);
  });

  it('loads an RNA-only RefSeq gene as DNA with U→T conversion', async () => {
    client.getGene.mockResolvedValue({
      id: 'spd:gene:2',
      name: 'rna-gene',
      dnaSequence: null,
      rnaSequence: 'augcUU',
    });
    client.listGeneRegions.mockResolvedValue([
      { molecule: 'rna', regionType: 'exon', description: 'Exon 1', startPosition: 1, endPosition: 3, strand: 'forward' },
      { molecule: 'dna', regionType: 'cds', description: 'stale DNA row', startPosition: 1, endPosition: 3, strand: 'forward' },
    ]);

    const loaded = await loadGene('spd:gene:2');
    expect(loaded.sourceMolecule).toBe('rna');
    expect(loaded.sequence).toBe('ATGCTT');
    expect(loaded.features).toEqual([{ name: 'Exon 1', start: 1, end: 3, type: 'exon', forward: true }]);
  });

  it('rejects a record with neither molecule', async () => {
    client.getGene.mockResolvedValue({ id: 'spd:gene:3', name: 'empty', dnaSequence: null, rnaSequence: null });
    client.listGeneRegions.mockResolvedValue([]);

    await expect(loadGene('spd:gene:3')).rejects.toThrow('no DNA or RNA sequence');
  });
});
