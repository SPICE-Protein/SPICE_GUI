import { describe, expect, it } from 'vitest';
import {
  autoMap,
  buildWells,
  mappedColumnCount,
  missingRequiredColumns,
  parseCtCell,
  parseDelimited,
  parseEfficiencyCell,
  parseNumericCell,
  parseQuantityCell,
  parseReplicateCell,
} from '$lib/tools/qpcr/parse';
import { emptyMapping, type ColumnMapping } from '$lib/tools/qpcr/types';

describe('parseDelimited', () => {
  it('detects tabs and unquotes fields', () => {
    const table = parseDelimited('Sample\tCt\n"A, one"\t35.2\n"quote ""x"""\tUndetermined\n');
    expect(table.delimiter).toBe('\t');
    expect(table.headers).toEqual(['Sample', 'Ct']);
    expect(table.rows).toEqual([
      ['A, one', '35.2'],
      ['quote "x"', 'Undetermined'],
    ]);
  });

  it('honours quoted commas when detecting the delimiter', () => {
    const table = parseDelimited('name,ct\n"alpha,beta",30\n');
    expect(table.delimiter).toBe(',');
    expect(table.rows).toEqual([['alpha,beta', '30']]);
  });

  it('strips a UTF-8 BOM and handles CRLF', () => {
    const table = parseDelimited('﻿a,b\r\n1,2\r\n3,4\r\n');
    expect(table.headers).toEqual(['a', 'b']);
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('pads short rows and truncates extra cells to the header width', () => {
    const table = parseDelimited('a,b,c\n1\n1,2,3,4\n');
    expect(table.rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
  });

  it('skips fully empty rows and accepts an explicit delimiter', () => {
    const table = parseDelimited('a;b\n\n1;2\n   \n', ';');
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['a', 'b']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('returns an empty table for blank input', () => {
    expect(parseDelimited('   \n\n')).toEqual({ headers: [], rows: [], delimiter: ',' });
  });
});

describe('autoMap', () => {
  it('maps common instrument header synonyms exactly', () => {
    const mapping = autoMap(['Well', 'Sample Name', 'Target', 'Ct', 'Group', 'Rep', 'Efficiency', 'Tm', 'Quantity']);
    expect(mapping).toEqual({
      well: 0,
      sample: 1,
      target: 2,
      ct: 3,
      group: 4,
      replicate: 5,
      efficiency: 6,
      tm: 7,
      quantity: 8,
    });
    expect(missingRequiredColumns(mapping)).toEqual([]);
    expect(mappedColumnCount(mapping)).toBe(9);
  });

  it('uses containment only for unmatched columns and never reuses a column', () => {
    const mapping = autoMap(['Sample ID (plate)', 'Gene name', 'Cq mean']);
    expect(mapping.sample).toBe(0);
    expect(mapping.target).toBe(1);
    expect(mapping.ct).toBe(2);
    expect(new Set([mapping.sample, mapping.target, mapping.ct]).size).toBe(3);
  });

  it('reports missing required columns', () => {
    const mapping = autoMap(['well', 'group']);
    expect(missingRequiredColumns(mapping)).toEqual(['sample', 'target', 'ct']);
    expect(mappedColumnCount(mapping)).toBe(2);
  });

  it('does not map blank headers', () => {
    const mapping = autoMap(['', '', '']);
    expect(mappedColumnCount(mapping)).toBe(0);
  });
});

describe('cell parsers', () => {
  it('parses numeric and decimal-comma cells', () => {
    expect(parseNumericCell(' 12.5 ')).toBe(12.5);
    expect(parseNumericCell('1,5')).toBe(1.5);
    // A single comma is treated as a decimal separator by the parser.
    expect(parseNumericCell('1,234')).toBe(1.234);
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('abc')).toBeNull();
  });

  it('treats undetermined Ct spellings as null', () => {
    for (const raw of ['', '-', '--', 'N/A', 'NaN', 'Undetermined', 'No Ct', 'not detected']) {
      expect(parseCtCell(raw)).toBeNull();
    }
    expect(parseCtCell(' 35.25 ')).toBe(35.25);
    expect(parseCtCell('35,25')).toBe(35.25);
  });

  it('converts percentage efficiencies and rejects non-positive values', () => {
    expect(parseEfficiencyCell('95')).toBeCloseTo(0.95, 12);
    expect(parseEfficiencyCell('95%')).toBeCloseTo(0.95, 12);
    expect(parseEfficiencyCell('195')).toBeCloseTo(1.95, 12);
    expect(parseEfficiencyCell('1.95')).toBeCloseTo(1.95, 12);
    expect(parseEfficiencyCell('0')).toBeNull();
    expect(parseEfficiencyCell('-10')).toBeNull();
    expect(parseEfficiencyCell('')).toBeNull();
  });

  it('parses replicate and quantity cells', () => {
    expect(parseReplicateCell('3')).toBe(3);
    expect(parseReplicateCell('x')).toBeNull();
    expect(parseQuantityCell('1e6')).toBe(1e6);
    expect(parseQuantityCell('')).toBeNull();
  });
});

describe('buildWells', () => {
  it('builds wells, parses each column and preserves prior include flags', () => {
    const table = parseDelimited(
      'well,sample,target,ct,group,replicate,efficiency,tm,quantity\n' +
        'A1,S1,T,30.5,G1,1,95%,60.1,1e5\n' +
        'A2,S2,T,Undetermined,G2,2,,,\n',
    );
    const mapping: ColumnMapping = {
      ...emptyMapping(),
      well: 0,
      sample: 1,
      target: 2,
      ct: 3,
      group: 4,
      replicate: 5,
      efficiency: 6,
      tm: 7,
      quantity: 8,
    };
    const wells = buildWells(table, mapping, [
      {
        id: 'r0',
        row: 0,
        well: 'A1',
        sample: 'S1',
        target: 'T',
        group: 'G1',
        replicate: 1,
        ct: 30.5,
        tm: 60.1,
        efficiency: 0.95,
        quantity: 1e5,
        include: false,
      },
    ]);
    expect(wells).toHaveLength(2);
    expect(wells[0]).toMatchObject({
      id: 'r0',
      row: 0,
      well: 'A1',
      sample: 'S1',
      target: 'T',
      group: 'G1',
      replicate: 1,
      ct: 30.5,
      tm: 60.1,
      quantity: 1e5,
      include: false,
    });
    expect(wells[0].efficiency).toBeCloseTo(0.95, 12);
    expect(wells[1]).toMatchObject({
      id: 'r1',
      well: 'A2',
      sample: 'S2',
      group: 'G2',
      replicate: 2,
      ct: null,
      tm: null,
      efficiency: null,
      quantity: null,
      include: true,
    });
  });

  it('leaves unmapped columns blank', () => {
    const table = parseDelimited('sample,target,ct\nS,T,20\n');
    const mapping = autoMap(table.headers);
    const wells = buildWells(table, mapping);
    expect(wells[0].well).toBe('');
    expect(wells[0].group).toBe('');
    expect(wells[0].replicate).toBeNull();
  });
});
