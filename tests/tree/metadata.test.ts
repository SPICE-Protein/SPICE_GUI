import { describe, expect, it } from 'vitest';
import {
  MetadataParseError,
  metadataToCsv,
  parseMetadataTable,
  resolveMetadata,
  sanitizeColor,
} from '$lib/tools/tree/metadata';
import { PALETTES, type TreeMetadata } from '$lib/tools/tree/types';

describe('sanitizeColor', () => {
  it('accepts hex colours and known names', () => {
    expect(sanitizeColor('#abc')).toBe('#abc');
    expect(sanitizeColor('#A1B2C3')).toBe('#A1B2C3');
    expect(sanitizeColor('#11223344')).toBe('#11223344');
    expect(sanitizeColor('SteelBlue')).toBe('steelblue');
    expect(sanitizeColor(' red ')).toBe('red');
  });

  it('rejects invalid, empty and unknown values', () => {
    expect(sanitizeColor('not-a-colour')).toBeNull();
    expect(sanitizeColor('#12')).toBeNull();
    expect(sanitizeColor('')).toBeNull();
    expect(sanitizeColor(null)).toBeNull();
    expect(sanitizeColor(undefined)).toBeNull();
  });
});

describe('parseMetadataTable', () => {
  it('parses a headed comma table with colours', () => {
    const entries = parseMetadataTable(
      'leaf,group,color\nAlpha,G1,#ff0000\nBeta,G1,blue\nGamma,G2,not-a-colour\n',
    );
    expect(entries).toEqual([
      { leaf: 'Alpha', group: 'G1', color: '#ff0000' },
      { leaf: 'Beta', group: 'G1', color: 'blue' },
      { leaf: 'Gamma', group: 'G2', color: null },
    ]);
  });

  it('detects TSV and accepts alternative headers', () => {
    const entries = parseMetadataTable('taxon\tclade\tcolour\nA\tX\t#abc\n');
    expect(entries).toEqual([{ leaf: 'A', group: 'X', color: '#abc' }]);
  });

  it('parses headerless tables positionally', () => {
    const entries = parseMetadataTable('Alpha,G1,#00ff00\nBeta,G2\n');
    expect(entries).toEqual([
      { leaf: 'Alpha', group: 'G1', color: '#00ff00' },
      { leaf: 'Beta', group: 'G2', color: null },
    ]);
  });

  it('skips comments and blank lines and unquotes cells', () => {
    const entries = parseMetadataTable('# comment\nleaf,group\n"A, one",G1\n\nB,G2\n');
    expect(entries).toEqual([
      { leaf: 'A, one', group: 'G1', color: null },
      { leaf: 'B', group: 'G2', color: null },
    ]);
  });

  it('lets a later row replace an earlier row for the same leaf', () => {
    const entries = parseMetadataTable('leaf,group,color\nA,G1,#111111\nB,G2,\nA,G3,#222222\n');
    expect(entries).toEqual([
      { leaf: 'A', group: 'G3', color: '#222222' },
      { leaf: 'B', group: 'G2', color: null },
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseMetadataTable('   \n\n')).toEqual([]);
    expect(parseMetadataTable('# only a comment\n')).toEqual([]);
  });

  it('throws a row-numbered error for unclosed quotes and short rows', () => {
    let error: unknown;
    try {
      parseMetadataTable('leaf,group\n"A,G1\n');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MetadataParseError);
    expect((error as MetadataParseError).row).toBe(2);

    expect(() => parseMetadataTable('leaf,group,color\nA\n')).toThrow(MetadataParseError);
    expect(() => parseMetadataTable('leaf,group\nA\n')).toThrow(MetadataParseError);
  });

  it('throws when a headed table lacks a group column', () => {
    expect(() => parseMetadataTable('leaf,color\nA,#fff\n')).toThrow(MetadataParseError);
  });
});

describe('resolveMetadata', () => {
  const metadata: TreeMetadata = {
    entries: [
      { leaf: 'A', group: 'G1', color: '#123456' },
      { leaf: 'B', group: 'G1' },
      { leaf: 'C', group: 'G2', color: '#abcdef' },
      { leaf: 'D', group: '' },
      { leaf: 'E', group: '' },
    ],
    paletteId: 'default',
  };
  const resolved = resolveMetadata(metadata);

  it('builds leaf records and group order', () => {
    expect(resolved.groupOrder).toEqual(['G1', 'G2']);
    expect(resolved.groupCounts).toEqual({ G1: 2, G2: 1 });
    expect(resolved.ungrouped).toBe(2);
    expect(resolved.byLeaf.A).toEqual({ group: 'G1', color: '#123456' });
    expect(resolved.byLeaf.D).toEqual({ group: '', color: '' });
  });

  it('uses explicit group colours and fills the rest from the palette', () => {
    expect(resolved.groupColors.G1).toBe('#123456');
    expect(resolved.groupColors.G2).toBe('#abcdef');
    // B has no colour of its own, so it inherits its group colour.
    expect(resolved.byLeaf.B.color).toBe('#123456');
    expect(resolved.byLeaf.C.color).toBe('#abcdef');
  });

  it('assigns palette colours when no group colour is given', () => {
    const plain = resolveMetadata({
      entries: [
        { leaf: 'A', group: 'X' },
        { leaf: 'B', group: 'Y' },
        { leaf: 'C', group: 'Z' },
      ],
      paletteId: 'warm',
    });
    expect(plain.groupColors).toEqual({
      X: PALETTES.warm[0],
      Y: PALETTES.warm[1],
      Z: PALETTES.warm[2],
    });
    expect(plain.byLeaf.A.color).toBe(PALETTES.warm[0]);
  });

  it('falls back to the default palette for an unknown id', () => {
    const plain = resolveMetadata({
      entries: [{ leaf: 'A', group: 'X' }],
      paletteId: 'nope' as never,
    });
    expect(plain.groupColors.X).toBe(PALETTES.default[0]);
  });
});

describe('metadataToCsv', () => {
  it('writes a header and escapes commas and quotes', () => {
    const csv = metadataToCsv({
      entries: [
        { leaf: 'A, one', group: 'G"1', color: '#000000' },
        { leaf: 'B', group: 'G2', color: null },
      ],
      paletteId: 'default',
    });
    expect(csv).toBe(
      [
        'leaf,group,color',
        '"A, one","G""1",#000000',
        'B,G2,',
      ].join('\n'),
    );
  });
});
