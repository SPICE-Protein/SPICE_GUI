import { describe, expect, it } from 'vitest';
import {
  normalizeSampleSheet,
  parsePlateMap,
  parseSampleSheet,
  plateMapToQpcrTsv,
  sampleSheetToCsv,
  sampleSheetToJson,
  type SampleSheet,
} from '$lib/tools/shared/samples';

describe('normalizeSampleSheet', () => {
  it('normalizes an object-wrapped sample list', () => {
    const sheet = normalizeSampleSheet({
      name: '  Plate 1  ',
      samples: [
        { name: ' Alpha ', group: ' G1 ', color: '#fff', replicates: 2.4, notes: ' n ' },
        { sample: 'Beta', condition: 'G2', n: '3' },
        { name: '' },
        { name: 'Delta', replicates: -1 },
      ],
    })!;
    expect(sheet.format).toBe('SPICE_SAMPLES');
    expect(sheet.version).toBe(1);
    expect(sheet.name).toBe('Plate 1');
    expect(typeof sheet.updatedAt).toBe('string');
    expect(sheet.samples).toEqual([
      { id: undefined, name: 'Alpha', group: 'G1', color: '#fff', replicates: 2, notes: 'n' },
      { id: undefined, name: 'Beta', group: 'G2', color: undefined, replicates: 3, notes: undefined },
      { id: undefined, name: 'Delta', group: '', color: undefined, replicates: undefined, notes: undefined },
    ]);
  });

  it('accepts a bare array and fills the default name', () => {
    const sheet = normalizeSampleSheet([{ name: 'A' }])!;
    expect(sheet.name).toBe('Samples');
    expect(sheet.samples).toEqual([
      { id: undefined, name: 'A', group: '', color: undefined, replicates: 1, notes: undefined },
    ]);
  });

  it('skips malformed entries and rejects a missing sample list', () => {
    const sheet = normalizeSampleSheet({ samples: [null, 'x', 5, { name: '' }] })!;
    expect(sheet.samples).toEqual([]);
    expect(normalizeSampleSheet(null)).toBeNull();
    expect(normalizeSampleSheet({})).toBeNull();
    expect(normalizeSampleSheet({ samples: 'nope' })).toBeNull();
  });

  it('keeps explicit ids and data URLs out of the sample fields', () => {
    const sheet = normalizeSampleSheet({
      updatedAt: '2026-01-01T00:00:00.000Z',
      samples: [{ id: 's1', name: 'A', group: 'G' }],
    })!;
    expect(sheet.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(sheet.samples[0].id).toBe('s1');
  });
});

describe('JSON import/export', () => {
  it('parses valid sample-sheet JSON and rejects invalid JSON', () => {
    const sheet = parseSampleSheet('{"samples":[{"name":"A","group":"G"}]}')!;
    expect(sheet.samples[0]).toMatchObject({ name: 'A', group: 'G' });
    expect(parseSampleSheet('not json')).toBeNull();
    expect(parseSampleSheet('{"format":"SPICE_SAMPLES"}')).toBeNull();
  });

  it('writes JSON that parses back to the same samples', () => {
    const sheet: SampleSheet = {
      format: 'SPICE_SAMPLES',
      version: 1,
      name: 'S',
      samples: [{ name: 'A', group: 'G', replicates: 2 }],
      updatedAt: 'old',
    };
    const json = sampleSheetToJson(sheet);
    const parsed = JSON.parse(json);
    expect(parsed.samples).toEqual(sheet.samples);
    expect(parsed.updatedAt).not.toBe('old');
  });
});

describe('sampleSheetToCsv', () => {
  it('writes standard columns with CSV escaping', () => {
    const sheet: SampleSheet = {
      format: 'SPICE_SAMPLES',
      version: 1,
      name: 'S',
      updatedAt: 'now',
      samples: [
        { name: 'Alpha, "one"', group: 'G1', color: '#fff', replicates: 2, notes: 'n' },
        { name: 'Beta', group: 'G2' },
      ],
    };
    expect(sampleSheetToCsv(sheet)).toBe(
      [
        'sample,group,color,replicates,notes',
        '"Alpha, ""one""",G1,#fff,2,n',
        'Beta,G2,,,',
      ].join('\n'),
    );
  });
});

describe('parsePlateMap', () => {
  it('parses a CSV plate map, uppercasing wells and normalizing types', () => {
    const rows = parsePlateMap(
      'well,sample,group,type,replicate\nA1,Alpha,G1,sample,2\na2,Beta,G2,Control,bad\n,skip,,,1\n',
    );
    expect(rows).toEqual([
      { well: 'A1', sample: 'Alpha', group: 'G1', type: 'sample', replicate: 2 },
      { well: 'A2', sample: 'Beta', group: 'G2', type: 'control', replicate: null },
    ]);
  });

  it('detects TSV and accepts column aliases', () => {
    const rows = parsePlateMap(
      'position\tname\tcondition\tkind\trep\nB2\tS\tG\tsample\t3\nB3\tT\tG2\tblank\t0\n',
    );
    expect(rows).toEqual([
      { well: 'B2', sample: 'S', group: 'G', type: 'sample', replicate: 3 },
      { well: 'B3', sample: 'T', group: 'G2', type: 'blank', replicate: null },
    ]);
  });

  it('unquotes commas in sample names', () => {
    const rows = parsePlateMap('well,sample,group,type,replicate\nA1,"Alpha, one",G,sample,1\n');
    expect(rows[0].sample).toBe('Alpha, one');
  });

  it('returns an empty list without a well column or without data', () => {
    expect(parsePlateMap('sample,group\nA,G\n')).toEqual([]);
    expect(parsePlateMap('')).toEqual([]);
    expect(parsePlateMap('well,sample\nA1,A\n')).toHaveLength(1);
  });
});

describe('plateMapToQpcrTsv', () => {
  it('writes a qPCR-ready skeleton with blank target and Ct', () => {
    const tsv = plateMapToQpcrTsv(
      [
        { well: 'A1', sample: 'Alpha', group: 'G1', type: 'sample', replicate: 2 },
        { well: 'A2', sample: 'Beta', group: 'G2', type: 'sample', replicate: null },
      ],
      'GAPDH',
    );
    expect(tsv).toBe(
      [
        'well\tsample\ttarget\tct\tgroup\treplicate',
        'A1\tAlpha\tGAPDH\t\tG1\t2',
        'A2\tBeta\tGAPDH\t\tG2\t',
      ].join('\n'),
    );
  });
});
