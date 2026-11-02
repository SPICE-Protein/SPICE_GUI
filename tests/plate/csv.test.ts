import { describe, expect, it } from 'vitest';
import {
  buildPlateRows,
  fileBaseName,
  parseSampleTable,
  plateRowsToCsv,
  plateRowsToTsv,
} from '$lib/tools/plate/csv';
import { assignmentsToMap, normalizeProject, type WellAssignment } from '$lib/tools/plate/types';

describe('parseSampleTable', () => {
  it('parses a headed CSV with colours and replicates', () => {
    const result = parseSampleTable(
      'sample,group,color,replicates\nAlpha,G1,#ABC,3\nBeta,G2,red,20\n',
    );
    expect(result.hadHeader).toBe(true);
    expect(result.delimiter).toBe(',');
    expect(result.skipped).toBe(0);
    expect(result.rows).toEqual([
      { name: 'Alpha', group: 'G1', color: '#aabbcc', replicates: 3 },
      { name: 'Beta', group: 'G2', color: '', replicates: 12 },
    ]);
  });

  it('detects TSV input and honours quoted cells', () => {
    const result = parseSampleTable(
      'name\tcondition\tcolor\n"Alpha, one"\tG1\t#fff\n"quote ""A"""\tG2\ty\n',
    );
    expect(result.delimiter).toBe('\t');
    expect(result.rows[0]).toMatchObject({ name: 'Alpha, one', group: 'G1' });
    expect(result.rows[1].name).toBe('quote "A"');
  });

  it('parses headerless positional rows with default columns', () => {
    const result = parseSampleTable('Alpha,G1,#00ff00,2\nBeta,G2,,bad\n');
    expect(result.hadHeader).toBe(false);
    expect(result.rows).toEqual([
      { name: 'Alpha', group: 'G1', color: '#00ff00', replicates: 2 },
      { name: 'Beta', group: 'G2', color: '', replicates: null },
    ]);
  });

  it('skips comments, blank lines and nameless rows', () => {
    const result = parseSampleTable('# a comment\nsample,group\n\nAlpha,G1\n,G2\n');
    expect(result.hadHeader).toBe(true);
    expect(result.rows).toEqual([{ name: 'Alpha', group: 'G1', color: '', replicates: null }]);
    expect(result.skipped).toBe(1);
  });

  it('supports the minimal one-column sample list', () => {
    const result = parseSampleTable('Alpha\nBeta\n');
    expect(result.hadHeader).toBe(false);
    expect(result.rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(result.rows[0]).toMatchObject({ group: '', color: '', replicates: null });
  });

  it('handles a BOM and CRLF line endings', () => {
    const result = parseSampleTable('﻿sample,group\r\nAlpha,G1\r\n');
    expect(result.hadHeader).toBe(true);
    expect(result.rows).toEqual([{ name: 'Alpha', group: 'G1', color: '', replicates: null }]);
  });
});

describe('buildPlateRows and CSV export', () => {
  function assignment(overrides: Partial<WellAssignment>): WellAssignment {
    return {
      well: 'A1',
      row: 0,
      col: 0,
      type: 'sample',
      sampleId: 's1',
      sampleName: 'S1',
      group: 'G1',
      replicate: 1,
      color: '#ffffff',
      manual: false,
      ...overrides,
    };
  }

  const assignments = assignmentsToMap([
    assignment({ well: 'A1', row: 0, col: 0, sampleName: 'Alpha', group: 'G1' }),
    assignment({ well: 'A2', row: 0, col: 1, type: 'control', sampleId: '', sampleName: 'CTRL-1', group: 'Control', replicate: 1 }),
    assignment({ well: 'B1', row: 1, col: 0, type: 'reserved', sampleId: '', sampleName: '', group: '', replicate: 0 }),
  ]);

  it('emits a row for every well, including empty ones', () => {
    const rows = buildPlateRows(6, assignments);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ well: 'A1', sample: 'Alpha', group: 'G1', type: 'sample', replicate: 1 });
    expect(rows[1]).toMatchObject({ well: 'A2', type: 'control', sample: 'CTRL-1' });
    expect(rows[3]).toEqual({ well: 'B1', sample: '', group: '', type: 'reserved', replicate: null });
    expect(rows[5]).toEqual({ well: 'B3', sample: '', group: '', type: 'empty', replicate: null });
  });

  it('escapes cells that contain commas, quotes or newlines', () => {
    const rows = [
      { well: 'A1', sample: 'Alpha, "one"', group: 'G1', type: 'sample' as const, replicate: 2 },
    ];
    expect(plateRowsToCsv(rows)).toBe(
      'well,sample,group,type,replicate\nA1,"Alpha, ""one""",G1,sample,2',
    );
    expect(plateRowsToTsv(rows)).toBe('well\tsample\tgroup\ttype\treplicate\nA1\tAlpha, "one"\tG1\tsample\t2');
  });

  it('round-trips a plate map through the CSV columns the shared parser expects', () => {
    const csv = plateRowsToCsv(buildPlateRows(6, assignments));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('well,sample,group,type,replicate');
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe('A1,Alpha,G1,sample,1');
  });

  it('builds a safe ASCII file stem', () => {
    expect(fileBaseName('  My Plate: Run #1  ')).toBe('my-plate-run-1');
    expect(fileBaseName('')).toBe('plate-layout');
    expect(fileBaseName('***')).toBe('plate-layout');
    expect(fileBaseName('实验', 'fallback')).toBe('fallback');
    expect(fileBaseName('a'.repeat(80))).toHaveLength(60);
  });
});

describe('plate project normalization', () => {
  it('drops invalid wells and counts duplicate/dropped assignments', () => {
    const result = normalizeProject({
      format: 24,
      title: 'Test',
      samples: [
        { name: 'A', group: 'G', color: '#abc', replicates: 2 },
        { name: '', group: '' },
      ],
      rules: { replicates: 99, controls: -1, seed: 5 },
      assignments: [
        { well: 'a1', type: 'sample', sampleId: 's1', sampleName: 'A', replicate: 1 },
        { well: 'A1', type: 'sample', sampleId: 's1', sampleName: 'A', replicate: 1 },
        { well: 'Z99', type: 'sample' },
        { well: 'A2', type: 'bogus' },
        null,
      ],
    });
    expect(result.project).not.toBeNull();
    expect(result.project!.format).toBe(24);
    expect(result.project!.samples).toHaveLength(2);
    expect(result.project!.samples[0]).toMatchObject({ name: 'A', color: '#aabbcc', replicates: 2 });
    expect(result.project!.rules.replicates).toBe(12);
    expect(result.project!.rules.controls).toBe(0);
    expect(result.project!.assignments).toHaveLength(1);
    expect(result.project!.assignments[0].well).toBe('A1');
    expect(result.duplicateWells).toBe(1);
    expect(result.droppedAssignments).toBe(3);
  });

  it('rejects non-object input', () => {
    expect(normalizeProject(null).project).toBeNull();
    expect(normalizeProject('x').project).toBeNull();
  });
});
