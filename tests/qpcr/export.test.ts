import { describe, expect, it } from 'vitest';
import { buildResultsCsv } from '$lib/tools/qpcr/export';
import { computeDdct, computeQc, computeStandard } from '$lib/tools/qpcr/analysis';
import { defaultSettings, type QpcrProject, type Well } from '$lib/tools/qpcr/types';

let counter = 0;
function well(partial: Partial<Well> & { sample: string; target: string; ct: number | null }): Well {
  const row = counter++;
  return {
    id: `w${row}`,
    row,
    well: `A${row + 1}`,
    sample: partial.sample,
    target: partial.target,
    group: partial.group ?? '',
    replicate: partial.replicate ?? null,
    ct: partial.ct,
    tm: partial.tm ?? null,
    efficiency: partial.efficiency ?? null,
    quantity: partial.quantity ?? null,
    include: partial.include ?? true,
  };
}

function makeProject(wells: Well[]): QpcrProject {
  const settings = {
    ...defaultSettings(),
    referenceTarget: 'R',
    controlGroup: 'control',
    highCt: 45,
  };
  return {
    format: 'SPICE_QPCR',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'experiment.csv',
    rawText: '',
    mapping: {
      well: 0,
      sample: 1,
      target: 2,
      ct: 3,
      group: 4,
      replicate: 5,
      efficiency: 6,
      tm: 7,
      quantity: 8,
    },
    wells,
    settings,
    mode: 'ddct',
  };
}

describe('buildResultsCsv', () => {
  const wells = [
    well({ sample: 'Control', target: 'R', group: 'control', ct: 20, replicate: 1 }),
    well({ sample: 'Control', target: 'T', group: 'control', ct: 25, replicate: 1 }),
    well({ sample: 'Treated, "B"', target: 'R', group: 'treated', ct: 20, replicate: 1 }),
    well({ sample: 'Treated, "B"', target: 'T', group: 'treated', ct: 27, replicate: 1 }),
    well({ sample: 'STD', target: 'T', ct: 30, quantity: 1e2, replicate: 1 }),
    well({ sample: 'STD', target: 'T', ct: 26.68, quantity: 1e3, replicate: 2 }),
    well({ sample: 'STD', target: 'T', ct: 23.36, quantity: 1e4, replicate: 3 }),
    well({ sample: 'Unknown', target: 'T', ct: 23.36 }),
  ];
  const project = makeProject(wells);
  const qc = computeQc(wells, project.settings);
  const ddct = computeDdct(wells, project.settings, qc);
  const standard = computeStandard(wells, project.settings, qc);
  const csv = buildResultsCsv(project, qc, ddct, standard);
  const lines = csv.split('\n');

  it('writes a metadata header with the input filename and mode', () => {
    expect(lines[0]).toBe('SPICE qPCR results');
    expect(csv).toContain('file,experiment.csv');
    expect(csv).toContain('mode,ddct');
    expect(csv).toContain('referenceTargets,R');
    expect(csv).toMatch(/generated,\d{4}-\d\d-\d\dT/);
  });

  it('contains every report section in order', () => {
    const sections = [
      'Raw data with QC',
      'Replicate results',
      'Sample results',
      'Group results',
      'Delta Ct matrix',
      'Delta Delta Ct matrix',
      'Control mean Delta Ct',
      'Standard curve fits',
      'Interpolated standard quantities',
    ];
    let cursor = 0;
    for (const section of sections) {
      const index = csv.indexOf(section, cursor);
      expect(index, `missing section ${section}`).toBeGreaterThan(-1);
      cursor = index;
    }
  });

  it('escapes commas and quotes in CSV cells', () => {
    expect(csv).toContain('"Treated, ""B"""');
  });

  it('writes fold change and QC columns with real values', () => {
    const sampleSection = csv.slice(csv.indexOf('Sample results'), csv.indexOf('Group results'));
    const treatedLine = sampleSection
      .split('\n')
      .find((line) => line.startsWith('"Treated, ""B""",T,treated'))!;
    // sample,target,group,category,n,meanCt,sdCt,dCt,ddCt,efficiency,foldChange,...
    // The sample name itself contains commas, so compare the stable tail.
    expect(treatedLine).toContain('T,treated,treated,1,27,,7,2,1,0.25,,,no');
    expect(treatedLine.endsWith(',no')).toBe(true);
    expect(csv).toContain('qcFlags');
  });

  it('writes standard-curve fits and interpolated quantities', () => {
    expect(csv).toContain('Standard curve fits');
    expect(csv).toContain('T,-3.32,36.64,1,1.000805,3,2,4,yes,ok');
    const interpolated = csv.slice(csv.indexOf('Interpolated standard quantities'));
    expect(interpolated).toContain('Unknown');
    expect(interpolated).toContain('quantity');
  });

  it('ends with a newline', () => {
    expect(csv.endsWith('\n')).toBe(true);
  });
});
