import { describe, expect, it } from 'vitest';
import { groupMetricStats, measureBand, metricValue, quantify, roiForBand } from '$lib/tools/blot/quant';
import { emptyProject, type BlotBand, type BlotLane, type BlotProject } from '$lib/tools/blot/types';

function plane(width: number, height: number, fill = 1): Float32Array {
  return new Float32Array(width * height).fill(fill);
}

function paintRect(
  gray: Float32Array,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  value: number,
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[y * width + x] = value;
  }
}

function band(id: string, y: number, height: number, width: number): BlotBand {
  return { id, y, height, width, manual: false, excluded: false };
}

function lane(
  id: string,
  x: number,
  width: number,
  group: string,
  bands: BlotBand[],
  overrides: Partial<BlotLane> = {},
): BlotLane {
  return { id, x, width, name: id, sample: id, group, bands, ...overrides };
}

function project(overrides: Partial<BlotProject> = {}): BlotProject {
  return { ...emptyProject(), imageDataUrl: 'data:image/png;base64,AA==', ...overrides };
}

describe('roiForBand', () => {
  it('maps normalised lane and band coordinates to a pixel rectangle', () => {
    const roi = roiForBand(
      lane('L', 0.5, 0.2, 'G', []),
      band('b', 0.5, 0.2, 0.2),
      100,
      100,
    );
    expect(roi).toEqual({ x0: 40, y0: 40, x1: 60, y1: 60 });
  });

  it('clamps ROIs that fall outside the image', () => {
    const roi = roiForBand(
      lane('L', 0.98, 0.3, 'G', []),
      band('b', 0.01, 0.3, 0.3),
      100,
      100,
    );
    expect(roi.x0).toBeGreaterThanOrEqual(0);
    expect(roi.y0).toBeGreaterThanOrEqual(0);
    expect(roi.x1).toBeLessThanOrEqual(100);
    expect(roi.y1).toBeLessThanOrEqual(100);
    expect(roi.x1).toBeGreaterThan(roi.x0);
    expect(roi.y1).toBeGreaterThan(roi.y0);
  });
});

describe('measureBand', () => {
  const width = 100;
  const height = 100;
  const gray = plane(width, height, 1);
  paintRect(gray, width, 40, 60, 40, 60, 0.2);
  const testLane = lane('L1', 0.5, 0.2, 'G', []);
  const testBand = band('b1', 0.5, 0.2, 0.2);

  it('integrates inverted intensity with a manual background', () => {
    const measured = measureBand(testLane, testBand, 0, 0, {
      gray,
      width,
      height,
      project: project({ backgroundMode: 'manual', manualBackground: 0 }),
      globalBg: 0,
    });
    expect(measured.area).toBe(400);
    expect(measured.meanSignal).toBeCloseTo(0.8, 6);
    // The analysed plane is Float32, so allow a few 1e-6 units.
    expect(measured.netVolume).toBeCloseTo(320, 3);
    expect(measured.background).toBe(0);
    expect(measured.clippedFraction).toBe(0);
    expect(measured.saturated).toBe(false);
    expect(measured.laneName).toBe('L1');
    expect(measured.included).toBe(true);
    expect(measured.normalized).toBe(0);
  });

  it('subtracts a manual background floor and never integrates negative signal', () => {
    const measured = measureBand(testLane, testBand, 0, 0, {
      gray,
      width,
      height,
      project: project({ backgroundMode: 'manual', manualBackground: 0.5 }),
      globalBg: 0,
    });
    expect(measured.netVolume).toBeCloseTo((0.8 - 0.5) * 400, 3);
  });

  it('estimates the ring background from the ROI border', () => {
    const ringPlane = plane(width, height, 1);
    // Leave a white border inside the ROI and darken only the centre.
    paintRect(ringPlane, width, 46, 54, 46, 54, 0.2);
    const measured = measureBand(testLane, testBand, 0, 0, {
      gray: ringPlane,
      width,
      height,
      project: project({ backgroundMode: 'ring' }),
      globalBg: 0.9,
    });
    // The border ring is white, so the inverted background is zero despite a
    // misleading global estimate.
    expect(measured.background).toBe(0);
    expect(measured.netVolume).toBeCloseTo(0.8 * 8 * 8, 3);
  });

  it('honours a global background', () => {
    const measured = measureBand(testLane, testBand, 0, 0, {
      gray,
      width,
      height,
      project: project({ backgroundMode: 'global' }),
      globalBg: 0.25,
    });
    expect(measured.background).toBe(0.25);
    expect(measured.netVolume).toBeCloseTo((0.8 - 0.25) * 400, 3);
  });

  it('flags saturated pixels and excluded bands', () => {
    const saturatedPlane = plane(width, height, 1);
    paintRect(saturatedPlane, width, 40, 60, 40, 60, 0);
    const measured = measureBand(testLane, { ...testBand, excluded: true }, 0, 0, {
      gray: saturatedPlane,
      width,
      height,
      project: project({ backgroundMode: 'manual', manualBackground: 0 }),
      globalBg: 0,
    });
    expect(measured.clippedFraction).toBeCloseTo(1, 8);
    expect(measured.saturated).toBe(true);
    expect(measured.included).toBe(false);
  });
});

describe('quantify', () => {
  it('computes fold change against the control group without normalisation', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 1);
    paintRect(gray, width, 20, 30, 40, 60, 0.2);
    paintRect(gray, width, 70, 80, 40, 60, 0.6);
    const lanes = [
      lane('L1', 0.25, 0.1, 'control', [band('b1', 0.5, 0.2, 0.1)]),
      lane('L2', 0.75, 0.1, 'treated', [band('b2', 0.5, 0.2, 0.1)]),
    ];
    const blot = project({
      lanes,
      backgroundMode: 'manual',
      manualBackground: 0,
      normalization: { mode: 'none', loadingLaneId: null, controlGroup: 'control' },
    });
    const result = quantify(blot, { gray, width, height, project: blot });
    expect(result.hasData).toBe(true);
    // ROIs are 10 x 20 px: 0.8 and 0.4 signal per pixel.
    expect(result.rows.map((r) => r.netVolume)).toEqual([
      expect.closeTo(160, 2),
      expect.closeTo(80, 2),
    ]);
    expect(result.controlMean).toBeCloseTo(160, 2);
    expect(result.rows[0].fold).toBeCloseTo(1, 6);
    expect(result.rows[1].fold).toBeCloseTo(0.5, 6);
    expect(result.totalVolume).toBeCloseTo(240, 2);
    expect(result.groups.map((g) => g.name)).toEqual(['control', 'treated']);
    expect(result.groups[0]).toMatchObject({ n: 1, laneCount: 1 });
    expect(result.groups[1].mean).toBeCloseTo(80, 2);
    expect(metricValue(result.rows[0], 'fold')).toBeCloseTo(1, 8);
    expect(metricValue(result.rows[1], 'normalized')).toBeCloseTo(80, 2);
  });

  it('normalises each band to its lane total', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 1);
    paintRect(gray, width, 20, 30, 20, 30, 0.2);
    paintRect(gray, width, 20, 30, 70, 80, 0.6);
    const testLane = lane('L1', 0.25, 0.1, 'G', [
      band('top', 0.25, 0.1, 0.1),
      band('bottom', 0.75, 0.1, 0.1),
    ]);
    const blot = project({
      lanes: [testLane],
      backgroundMode: 'manual',
      manualBackground: 0,
      normalization: { mode: 'total', loadingLaneId: null, controlGroup: '' },
    });
    const result = quantify(blot, { gray, width, height, project: blot });
    const top = result.rows.find((r) => r.bandId === 'top')!;
    const bottom = result.rows.find((r) => r.bandId === 'bottom')!;
    expect(top.netVolume).toBeCloseTo(80, 2);
    expect(bottom.netVolume).toBeCloseTo(40, 2);
    expect(top.normalized).toBeCloseTo(80 / 120, 6);
    expect(bottom.normalized).toBeCloseTo(40 / 120, 6);
    expect(top.normalized + bottom.normalized).toBeCloseTo(1, 6);
  });

  it('normalises all bands to a loading-control lane', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 1);
    paintRect(gray, width, 20, 30, 40, 60, 0.2);
    paintRect(gray, width, 70, 80, 40, 60, 0.6);
    const lanes = [
      lane('load', 0.25, 0.1, 'load', [band('b1', 0.5, 0.2, 0.1)]),
      lane('sample', 0.75, 0.1, 'sample', [band('b2', 0.5, 0.2, 0.1)]),
    ];
    const blot = project({
      lanes,
      backgroundMode: 'manual',
      manualBackground: 0,
      normalization: { mode: 'loading', loadingLaneId: 'load', controlGroup: '' },
    });
    const result = quantify(blot, { gray, width, height, project: blot });
    expect(result.rows[0].normalized).toBeCloseTo(1, 6);
    expect(result.rows[1].normalized).toBeCloseTo(80 / 160, 6);
  });

  it('reports no data for an empty lane list', () => {
    const result = quantify(project({ lanes: [] }), {
      gray: plane(10, 10, 1),
      width: 10,
      height: 10,
      project: project(),
    });
    expect(result.hasData).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.totalVolume).toBe(0);
  });

  it('computes metric means and SEM per group', () => {
    const rows = [
      { included: true, group: 'G', normalized: 1, fold: 1 },
      { included: true, group: 'G', normalized: 3, fold: 2 },
      { included: false, group: 'G', normalized: 99, fold: 99 },
    ] as never as Parameters<typeof groupMetricStats>[1];
    const stats = groupMetricStats({ name: 'G' } as never, rows, 'normalized');
    expect(stats.mean).toBe(2);
    expect(stats.values).toEqual([1, 3]);
    expect(stats.sem).toBeCloseTo(1, 12);
  });
});
