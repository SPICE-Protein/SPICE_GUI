import { describe, expect, it } from 'vitest';
import {
  assignPlate,
  manualAuxAssignment,
  manualSampleAssignment,
  validateLayout,
  BLANK_GROUP,
  CONTROL_GROUP,
} from '$lib/tools/plate/assign';
import {
  buildWellCells,
  clampInt,
  defaultRules,
  formatGeometry,
  isEdgeWell,
  normalizeColor,
  requiredReplicates,
  rowLabel,
  wellId,
  type PlateFormat,
  type PlateRules,
  type SampleRow,
  type WellAssignment,
} from '$lib/tools/plate/types';

function sample(id: string, replicates: number | null = null, group = 'G'): SampleRow {
  return { id, name: id.toUpperCase(), group, color: '', replicates };
}

function rules(overrides: Partial<PlateRules> = {}): PlateRules {
  return { ...defaultRules(), ...overrides };
}

describe('plate geometry and labels', () => {
  it('maps plate formats to row/column geometry', () => {
    expect(formatGeometry(6)).toEqual({ format: 6, rows: 2, cols: 3, total: 6 });
    expect(formatGeometry(96)).toEqual({ format: 96, rows: 8, cols: 12, total: 96 });
    expect(formatGeometry(384).total).toBe(384);
  });

  it('generates spreadsheet-style row labels', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(rowLabel)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
    ]);
    expect(wellId(0, 0)).toBe('A1');
    expect(wellId(7, 11)).toBe('H12');
  });

  it('identifies edge wells', () => {
    expect(isEdgeWell(0, 4, 8, 12)).toBe(true);
    expect(isEdgeWell(7, 4, 8, 12)).toBe(true);
    expect(isEdgeWell(3, 0, 8, 12)).toBe(true);
    expect(isEdgeWell(3, 11, 8, 12)).toBe(true);
    expect(isEdgeWell(3, 4, 8, 12)).toBe(false);
    const cells = buildWellCells(formatGeometry(96));
    expect(cells.filter((c) => c.edge)).toHaveLength(36);
  });

  it('normalizes colours and clamps integers', () => {
    expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeColor('#abc')).toBe('#aabbcc');
    expect(normalizeColor('red')).toBe('');
    expect(clampInt(3.6, 1, 12, 1)).toBe(4);
    expect(clampInt(Number.NaN, 1, 12, 5)).toBe(5);
    expect(clampInt(99, 1, 12, 5)).toBe(12);
  });

  it('uses per-sample replicates or the global rule', () => {
    const base = rules({ replicates: 3 });
    expect(requiredReplicates(sample('a', null), base)).toBe(3);
    expect(requiredReplicates(sample('a', 0), base)).toBe(1);
    expect(requiredReplicates(sample('a', 99), base)).toBe(12);
  });
});

describe('assignPlate', () => {
  it('is fully deterministic for a fixed seed', () => {
    const samples = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id, i) =>
      sample(id, 2 + (i % 2)),
    );
    const config = rules({ seed: 20261102 });
    const first = assignPlate(96, samples, config);
    const second = assignPlate(96, samples, config);
    expect(second.assignments).toEqual(first.assignments);
    expect(second.issues).toEqual(first.issues);
    expect(second.stats).toEqual(first.stats);

    const other = assignPlate(96, samples, rules({ seed: 7 }));
    const signature = (result: typeof first) =>
      Object.values(result.assignments)
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((a) => a.sampleId)
        .join(',');
    expect(signature(other)).not.toBe(signature(first));
  });

  it('places exactly the requested number of replicates', () => {
    const samples = [sample('A', 2), sample('B', null), sample('C', 4)];
    const result = assignPlate(96, samples, rules({ replicates: 3, controls: 2, blanks: 2 }));
    const requested = samples.map((s) => requiredReplicates(s, rules({ replicates: 3 })));
    expect(result.stats.sampleWells).toBe(requested.reduce((a, b) => a + b, 0));
    expect(result.stats.controlWells).toBe(2);
    expect(result.stats.blankWells).toBe(2);
    expect(result.stats.assigned).toBe(result.stats.sampleWells + 4);
    expect(result.unplaced).toEqual([]);
    expect(new Set(Object.keys(result.assignments)).size).toBe(result.stats.assigned);

    for (const s of samples) {
      const placed = Object.values(result.assignments).filter(
        (a) => a.type === 'sample' && a.sampleId === s.id,
      );
      expect(placed).toHaveLength(requiredReplicates(s, rules({ replicates: 3 })));
      expect(placed.map((a) => a.replicate).sort((a, b) => a - b)).toEqual(
        Array.from({ length: placed.length }, (_, i) => i + 1),
      );
    }
  });

  it('keeps sample replicates orthogonally connected when asked', () => {
    const result = assignPlate(96, [sample('A', 4)], rules({ keepTogether: true, randomize: false }));
    const cells = Object.values(result.assignments).filter(
      (a) => a.type === 'sample' && a.sampleId === 'A',
    );
    expect(cells).toHaveLength(4);
    // No split-group warning: every pair is reachable at unit steps.
    expect(result.issues.some((i) => i.key === 'plateIssueGroupSplit')).toBe(false);
  });

  it('places controls and blanks on the edge ring first', () => {
    const result = assignPlate(
      96,
      [],
      rules({ controls: 2, blanks: 2, randomize: false, reserveEdge: false }),
    );
    const controls = Object.values(result.assignments).filter((a) => a.type === 'control');
    const blanks = Object.values(result.assignments).filter((a) => a.type === 'blank');
    expect(controls.map((a) => a.well)).toEqual(['A1', 'A2']);
    expect(blanks.map((a) => a.well)).toEqual(['A3', 'A4']);
    for (const a of [...controls, ...blanks]) {
      expect(isEdgeWell(a.row, a.col, 8, 12)).toBe(true);
      expect(a.group).toBe(a.type === 'control' ? CONTROL_GROUP : BLANK_GROUP);
    }
  });

  it('reports unplaced replicates instead of silently dropping them', () => {
    const result = assignPlate(6, [sample('A', 12)], rules({ randomize: false, controls: 0, blanks: 0 }));
    expect(result.stats.sampleWells).toBe(6);
    expect(result.unplaced).toEqual([
      { sampleId: 'A', name: 'A', requested: 12, placed: 6, missing: 6 },
    ]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'plateIssueReplicatesMissing', severity: 'error' }),
        expect.objectContaining({ key: 'plateIssueCapacity', severity: 'error' }),
      ]),
    );
  });

  it('marks reserved edge wells when reserveEdge is set', () => {
    const samples = Array.from({ length: 6 }, (_, i) => sample(`S${i}`, 12));
    const result = assignPlate(
      96,
      samples,
      rules({ reserveEdge: true, avoidEdge: true, controls: 0, blanks: 0, randomize: false }),
    );
    expect(result.stats.sampleWells).toBe(60);
    expect(result.reservedCount).toBe(36);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]).toMatchObject({ requested: 12, placed: 0, missing: 12 });
    expect(result.issues.some((i) => i.key === 'plateIssueCapacity')).toBe(true);
  });
});

describe('validateLayout', () => {
  function assignment(well: string, overrides: Partial<WellAssignment> = {}): WellAssignment {
    return {
      well,
      row: 0,
      col: 0,
      type: 'sample',
      sampleId: 'A',
      sampleName: 'A',
      group: 'G',
      replicate: 1,
      color: '',
      manual: false,
      ...overrides,
    };
  }

  it('detects duplicate wells in an imported map', () => {
    const result = validateLayout({
      format: 96,
      samples: [],
      rules: rules(),
      assignments: {
        one: assignment('A1'),
        two: assignment('A1'),
      },
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'plateIssueDuplicate', severity: 'error' }),
      ]),
    );
  });

  it('reports missing replicates, duplicate sample names and blank names', () => {
    const samples = [sample('A', 3), { ...sample('B', 1), name: 'A' }, { ...sample('C', 1), name: '' }];
    const result = validateLayout({
      format: 96,
      samples,
      rules: rules({ controls: 0, blanks: 0 }),
      assignments: { one: assignment('A1', { sampleId: 'A' }) },
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'plateIssueReplicatesMissing' }),
        expect.objectContaining({ key: 'plateDuplicateName' }),
        expect.objectContaining({ key: 'plateSampleNameRequired' }),
      ]),
    );
    expect(result.unplaced).toEqual([
      expect.objectContaining({ sampleId: 'A', requested: 3, placed: 1, missing: 2 }),
      expect.objectContaining({ sampleId: 'B', requested: 1, placed: 0, missing: 1 }),
      expect.objectContaining({ sampleId: 'C', requested: 1, placed: 0, missing: 1 }),
    ]);
  });

  it('warns when grouped replicates are split and edge wells are used', () => {
    const result = validateLayout({
      format: 96,
      samples: [sample('A', 2)],
      rules: rules({ keepTogether: true, avoidEdge: true, controls: 0, blanks: 0 }),
      assignments: {
        one: assignment('A1', { row: 0, col: 0 }),
        two: assignment('H12', { row: 7, col: 11 }),
      },
    });
    expect(result.issues.some((i) => i.key === 'plateIssueGroupSplit')).toBe(true);
    expect(result.issues.some((i) => i.key === 'plateIssueEdgeUsed')).toBe(true);
  });

  it('returns an informational issue for an empty sample list', () => {
    const result = validateLayout({
      format: 96,
      samples: [],
      rules: rules({ controls: 0, blanks: 0 }),
      assignments: {},
    });
    expect(result.issues).toContainEqual({ key: 'plateIssueNoSamples', severity: 'info' });
  });
});

describe('manual assignments', () => {
  it('builds a manual sample assignment at the requested well', () => {
    const result = manualSampleAssignment(formatGeometry(96), sample('A'), 3, 5, 2);
    expect(result).toMatchObject({
      well: 'D6',
      row: 3,
      col: 5,
      type: 'sample',
      sampleId: 'A',
      sampleName: 'A',
      replicate: 2,
      manual: true,
    });
  });

  it('names manual controls and blanks', () => {
    const control = manualAuxAssignment(formatGeometry(96), 'control', 0, 0, 1);
    const blank = manualAuxAssignment(formatGeometry(96), 'blank', 0, 1, 2);
    expect(control.sampleName).toBe('CTRL-1');
    expect(control.group).toBe(CONTROL_GROUP);
    expect(blank.sampleName).toBe('BLANK-2');
    expect(blank.group).toBe(BLANK_GROUP);
  });
});

describe('plate formats remain type-safe', () => {
  it('covers every supported format', () => {
    const formats: PlateFormat[] = [6, 12, 24, 48, 96, 384];
    for (const format of formats) {
      const geometry = formatGeometry(format);
      expect(geometry.total).toBe(geometry.rows * geometry.cols);
      expect(buildWellCells(geometry)).toHaveLength(geometry.total);
    }
  });
});
