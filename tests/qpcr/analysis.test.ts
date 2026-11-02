import { describe, expect, it } from 'vitest';
import {
  chartDataFromDdct,
  chartDataFromStandard,
  computeDdct,
  computeQc,
  computeStandard,
  listGroups,
  listSamples,
  listTargets,
  normKey,
  resolveInfo,
  usableWell,
} from '$lib/tools/qpcr/analysis';
import { defaultSettings, sanitizeSettings, type QpcrSettings, type Well } from '$lib/tools/qpcr/types';

let rowCounter = 0;

function well(partial: Partial<Well> & { sample: string; target: string; ct: number | null }): Well {
  const row = rowCounter++;
  return {
    id: `w${row}`,
    row,
    well: partial.well ?? `A${row + 1}`,
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

function settings(overrides: Partial<QpcrSettings> = {}): QpcrSettings {
  return { ...defaultSettings(), ...overrides };
}

describe('qPCR label normalization', () => {
  it('trims, collapses whitespace and lowercases keys', () => {
    expect(normKey('  GAP   DH ')).toBe('gap dh');
  });

  it('lists unique labels and resolves case-insensitively', () => {
    const wells = [
      well({ sample: ' Control ', target: 'GAPDH', ct: 20 }),
      well({ sample: 'control', target: ' gapdh ', ct: 20 }),
      well({ sample: 'Treated', target: 'IL6', ct: 25 }),
    ];
    expect(listSamples(wells)).toEqual([
      { key: 'control', label: 'Control' },
      { key: 'treated', label: 'Treated' },
    ]);
    expect(listTargets(wells).map((t) => t.key)).toEqual(['gapdh', 'il6']);
    expect(resolveInfo('GAPDH', listTargets(wells))?.key).toBe('gapdh');
    expect(resolveInfo('missing', listTargets(wells))).toBeNull();
  });
});

describe('quality control', () => {
  it('flags missing Ct, invalid identity, high Ct and duplicate wells', () => {
    const wells = [
      well({ sample: 'S1', target: 'T', ct: null, well: 'A1' }),
      well({ sample: '', target: 'T', ct: 20, well: 'A2' }),
      well({ sample: 'S1', target: 'T', ct: 36, well: 'A3' }),
      well({ sample: 'S1', target: 'T', ct: 21, well: 'A3' }),
    ];
    const qc = computeQc(wells, settings({ highCt: 35 }));
    expect(qc[wells[0].id].flags).toContain('missingCt');
    expect(qc[wells[1].id].flags).toContain('invalid');
    expect(qc[wells[2].id].flags).toContain('highCt');
    expect(qc[wells[2].id].flags).toContain('duplicateWell');
    // Three measured replicates with a wide spread also trips the SD limit.
    expect(qc[wells[2].id].flags).toContain('replicateSd');
    // Only the high-Ct and duplicate wells carry a numeric Ct in this group.
    expect(qc[wells[2].id].replicateN).toBe(2);
  });

  it('flags a single outlying replicate instead of erasing the group', () => {
    const wells = [
      well({ sample: 'S', target: 'T', ct: 20, well: 'A1' }),
      well({ sample: 'S', target: 'T', ct: 20.1, well: 'A2' }),
      well({ sample: 'S', target: 'T', ct: 24, well: 'A3' }),
    ];
    const qc = computeQc(wells, settings({ outlierLimit: 0.5, sdLimit: 5 }));
    const outliers = wells.filter((w) => qc[w.id].flags.includes('outlier'));
    expect(outliers).toHaveLength(1);
    expect(outliers[0].ct).toBe(24);
  });

  it('does not call outliers from only two replicates', () => {
    const wells = [
      well({ sample: 'S', target: 'T', ct: 20 }),
      well({ sample: 'S', target: 'T', ct: 26 }),
    ];
    const qc = computeQc(wells, settings({ outlierLimit: 0.5 }));
    expect(qc[wells[0].id].flags).not.toContain('outlier');
    expect(qc[wells[1].id].flags).not.toContain('outlier');
  });

  it('gates usability on inclusion, identity, Ct and outlier policy', () => {
    const w = well({ sample: 'S', target: 'T', ct: 22 });
    expect(usableWell(w, { flags: [], replicateN: 1, replicateMean: 22, replicateSd: null }, settings())).toBe(true);
    expect(usableWell({ ...w, include: false }, undefined, settings())).toBe(false);
    expect(usableWell({ ...w, ct: null }, undefined, settings())).toBe(false);
    expect(
      usableWell(
        w,
        { flags: ['outlier'], replicateN: 3, replicateMean: 22, replicateSd: 1 },
        settings({ excludeOutliers: true }),
      ),
    ).toBe(false);
  });
});

describe('Delta Delta Ct analysis', () => {
  // Control: R=20, T=25 -> dCt 5. Treated: R=20, T=27 -> dCt 7.
  // ddCt = 2 -> fold change = 2^-2 = 0.25 with perfect doubling.
  const wells = [
    well({ sample: 'Control', target: 'R', group: 'control', ct: 20, replicate: 1 }),
    well({ sample: 'Control', target: 'R', group: 'control', ct: 20, replicate: 2 }),
    well({ sample: 'Control', target: 'T', group: 'control', ct: 25, replicate: 1 }),
    well({ sample: 'Control', target: 'T', group: 'control', ct: 25, replicate: 2 }),
    well({ sample: 'Treated', target: 'R', group: 'treated', ct: 20, replicate: 1 }),
    well({ sample: 'Treated', target: 'R', group: 'treated', ct: 20, replicate: 2 }),
    well({ sample: 'Treated', target: 'T', group: 'treated', ct: 27, replicate: 1 }),
    well({ sample: 'Treated', target: 'T', group: 'treated', ct: 27, replicate: 2 }),
  ];
  const projectSettings = settings({ referenceTarget: 'R', controlGroup: 'control' });
  const ddct = computeDdct(wells, projectSettings, computeQc(wells, projectSettings));

  it('picks the reference target and control group', () => {
    expect(ddct.reference?.label).toBe('R');
    expect(ddct.hasGroups).toBe(true);
    expect(ddct.controlLabel).toBe('control');
    expect(ddct.controlSampleKeys).toEqual(['control']);
    expect(ddct.missingReference).toBe(false);
    expect(ddct.controlFallback).toBe(false);
  });

  it('computes dCt and ddCt for every sample', () => {
    const control = ddct.matrix.find((m) => m.sample === 'Control')!;
    const treated = ddct.matrix.find((m) => m.sample === 'Treated')!;
    // The reference Ct is a geometric mean, so exact integers are not promised.
    expect(control.refCt).toBeCloseTo(20, 8);
    expect(control.dCt.t).toBeCloseTo(5, 8);
    expect(control.ddCt.t).toBeCloseTo(0, 8);
    expect(treated.dCt.t).toBeCloseTo(7, 8);
    expect(treated.ddCt.t).toBeCloseTo(2, 8);
    expect(ddct.controlMeanDCt.t).toBeCloseTo(5, 8);
  });

  it('computes fold change per sample and per replicate', () => {
    const control = ddct.sampleResults.find((s) => s.sample === 'Control' && s.targetKey === 't')!;
    const treated = ddct.sampleResults.find((s) => s.sample === 'Treated' && s.targetKey === 't')!;
    expect(control.fold).toBeCloseTo(1, 12);
    expect(control.n).toBe(2);
    expect(treated.fold).toBeCloseTo(0.25, 12);
    expect(treated.foldValues).toHaveLength(2);
    expect(treated.foldValues.every((v) => Math.abs(v - 0.25) < 1e-12)).toBe(true);
    expect(ddct.replicates.filter((r) => r.targetKey === 't')).toHaveLength(4);
  });

  it('summarizes groups and exposes chart data', () => {
    const treatedGroup = ddct.groupResults.find((g) => g.category === 'treated')!;
    expect(treatedGroup.nSamples).toBe(1);
    expect(treatedGroup.meanFold).toBeCloseTo(0.25, 12);
    expect(treatedGroup.meanDCt).toBeCloseTo(7, 12);
    expect(treatedGroup.isControl).toBe(false);
    const chart = chartDataFromDdct(ddct)!;
    expect(chart.categories).toEqual(['control', 'treated']);
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].bars[1]!.value).toBeCloseTo(0.25, 12);
  });

  it('falls back to the first target and first sample without settings', () => {
    const fallbackSettings = settings();
    const analysis = computeDdct(wells, fallbackSettings, computeQc(wells, fallbackSettings));
    expect(analysis.reference).not.toBeNull();
    expect(analysis.referenceFallback).toBe(true);
    expect(analysis.controlFallback).toBe(true);
    expect(analysis.controlSampleKeys).toHaveLength(1);
  });

  it('ignores standard wells when selecting samples and targets', () => {
    const withStandard = [
      ...wells,
      well({ sample: 'STD', target: 'R', ct: 18, quantity: 1e6 }),
      well({ sample: 'STD', target: 'T', ct: 23, quantity: 1e6 }),
    ];
    const analysis = computeDdct(
      withStandard,
      projectSettings,
      computeQc(withStandard, projectSettings),
    );
    expect(analysis.samples.map((s) => s.key)).not.toContain('std');
    expect(analysis.matrix.some((m) => m.sample === 'STD')).toBe(false);
  });
});

describe('standard curve analysis', () => {
  // Ct = 35 - 3.32 * log10(copies), exactly linear.
  const standardWells: Well[] = [2, 3, 4, 5].flatMap((log, i) => [
    well({ sample: 'STD', target: 'T', ct: 35 - 3.32 * log, quantity: 10 ** log, replicate: i + 1 }),
  ]);
  const sampleWells = [
    well({ sample: 'Unknown', target: 'T', ct: 30 }),
    well({ sample: 'Unknown', target: 'T', ct: 30 }),
  ];
  const all = [...standardWells, ...sampleWells];
  const curveSettings = settings({ quantityIsLog10: false, highCt: 45 });
  const standard = computeStandard(all, curveSettings, computeQc(all, curveSettings));

  it('fits the standard curve and reports efficiency', () => {
    const fit = standard.fits.find((f) => f.targetKey === 't')!;
    expect(fit.valid).toBe(true);
    expect(fit.reason).toBe('ok');
    expect(fit.slope).toBeCloseTo(-3.32, 8);
    expect(fit.intercept).toBeCloseTo(35, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
    expect(fit.n).toBe(4);
    expect(fit.xMin).toBe(2);
    expect(fit.xMax).toBe(5);
    expect(fit.efficiency).toBeCloseTo(10 ** (1 / 3.32) - 1, 8);
  });

  it('interpolates the mean quantity of unknown samples', () => {
    expect(standard.samples).toHaveLength(1);
    const unknown = standard.samples[0];
    expect(unknown.sample).toBe('Unknown');
    expect(unknown.n).toBe(2);
    expect(unknown.log10Quantity).toBeCloseTo((30 - 35) / -3.32, 8);
    expect(unknown.quantity).toBeCloseTo(10 ** ((30 - 35) / -3.32), 6);
    const chart = chartDataFromStandard(standard)!;
    expect(chart.log).toBe(true);
    expect(chart.series[0].bars[0]!.value).toBeCloseTo(unknown.quantity, 6);
  });

  it('reports missing standards and too few points', () => {
    const noStandards = computeStandard(sampleWells, curveSettings, computeQc(sampleWells, curveSettings));
    expect(noStandards.missingStandards).toBe(true);

    const onePoint = [standardWells[0]];
    const few = computeStandard(onePoint, curveSettings, computeQc(onePoint, curveSettings));
    expect(few.fits[0].valid).toBe(false);
    expect(few.fits[0].reason).toBe('fewPoints');
  });

  it('accepts log10 quantities directly', () => {
    const logWells = [2, 3, 4].map((log, i) =>
      well({ sample: 'STD', target: 'T', ct: 35 - 3.32 * log, quantity: log, replicate: i + 1 }),
    );
    const logSettings = settings({ quantityIsLog10: true, highCt: 45 });
    const result = computeStandard(logWells, logSettings, computeQc(logWells, logSettings));
    expect(result.fits[0].xMin).toBe(2);
    expect(result.fits[0].slope).toBeCloseTo(-3.32, 8);
  });
});

describe('settings normalization', () => {
  it('clamps numeric values and coerces booleans/strings', () => {
    const sanitized = sanitizeSettings({
      highCt: 999,
      sdLimit: -3,
      outlierLimit: 99,
      excludeOutliers: true,
      efficiencyCorrection: 'yes' as unknown as boolean,
      defaultEfficiencyPct: 0,
      quantityIsLog10: true,
      showHeatmap: false,
      referenceTarget: 42 as unknown as string,
      controlGroup: 'G',
      controlSample: null as unknown as string,
    });
    expect(sanitized.highCt).toBe(45);
    expect(sanitized.sdLimit).toBe(0);
    expect(sanitized.outlierLimit).toBe(5);
    expect(sanitized.excludeOutliers).toBe(true);
    expect(sanitized.efficiencyCorrection).toBe(false);
    expect(sanitized.defaultEfficiencyPct).toBe(1);
    expect(sanitized.referenceTarget).toBe('');
    expect(sanitized.controlGroup).toBe('G');
    expect(sanitized.controlSample).toBe('');
  });

  it('lists groups in stable case-insensitive order', () => {
    const groups = listGroups([
      well({ sample: 'a', target: 't', group: 'Zeta', ct: 1 }),
      well({ sample: 'b', target: 't', group: 'alpha', ct: 1 }),
      well({ sample: 'c', target: 't', group: 'Alpha', ct: 1 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'Zeta']);
  });
});
