import { describe, expect, it } from 'vitest';
import {
  bandsFromDetection,
  columnSignal,
  detectBands,
  detectLanes,
  groupNames,
  lanesFromCount,
  lanesFromDetection,
  rowSignal,
} from '$lib/tools/blot/detect';
import type { BlotCrop, BlotLane } from '$lib/tools/blot/types';

const CROP: BlotCrop = { left: 0, top: 0, right: 0, bottom: 0 };

function plane(width: number, height: number, fill = 1): Float32Array {
  return new Float32Array(width * height).fill(fill);
}

function paintColumn(gray: Float32Array, width: number, x0: number, x1: number, height: number, value: number) {
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) gray[y * width + x] = value;
  }
}

function paintRow(gray: Float32Array, width: number, y0: number, y1: number, x0: number, x1: number, value: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[y * width + x] = value;
  }
}

describe('columnSignal / rowSignal', () => {
  it('averages inverted intensity over the requested band', () => {
    const width = 4;
    const height = 3;
    const gray = plane(width, height, 1);
    // Column 1 is fully dark in rows 0..1, column 2 fully dark in all rows.
    paintColumn(gray, width, 1, 2, 2, 0);
    paintColumn(gray, width, 2, 3, 3, 0);
    const cols = columnSignal(gray, width, height, 0, 2);
    expect(Array.from(cols)).toEqual([0, 1, 1, 0]);
    const rows = rowSignal(gray, width, height, 1, 3);
    expect(Array.from(rows)).toEqual([1, 1, 0.5]);
  });

  it('clamps out-of-range bands', () => {
    const gray = plane(4, 4, 1);
    expect(Array.from(columnSignal(gray, 4, 4, -10, 99))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rowSignal(gray, 4, 4, 99, -5))).toEqual([0, 0, 0, 0]);
  });
});

describe('detectLanes', () => {
  it('finds three lanes in a synthetic inverted column profile', () => {
    const width = 100;
    const height = 60;
    const gray = plane(width, height, 1);
    for (const [x0, x1] of [
      [14, 22],
      [44, 52],
      [74, 82],
    ]) {
      paintColumn(gray, width, x0, x1, height, 0.2);
    }
    const lanes = detectLanes(gray, width, height, CROP);
    expect(lanes).toHaveLength(3);
    expect(lanes[0].x).toBeGreaterThan(0.15);
    expect(lanes[0].x).toBeLessThan(0.24);
    expect(lanes[1].x).toBeGreaterThan(0.46);
    expect(lanes[1].x).toBeLessThan(0.55);
    expect(lanes[2].x).toBeGreaterThan(0.76);
    expect(lanes[2].x).toBeLessThan(0.85);
    expect(lanes.every((l) => l.width > 0 && l.width <= 0.16)).toBe(true);
  });

  it('returns no lanes for a uniform image', () => {
    expect(detectLanes(plane(50, 40, 1), 50, 40, CROP)).toEqual([]);
  });

  it('ignores a dark scan frame and keeps all five lanes', () => {
    const width = 500;
    const height = 300;
    const gray = plane(width, height, 1);
    paintColumn(gray, width, 0, 8, height, 0);
    paintColumn(gray, width, width - 8, width, height, 0);
    for (const center of [0.12, 0.32, 0.52, 0.7, 0.88]) {
      const x = Math.round(center * width);
      paintColumn(gray, width, x - 8, x + 8, height, 0.25);
    }
    const lanes = detectLanes(gray, width, height, CROP);
    expect(lanes.map((lane) => Math.round(lane.x * 100))).toEqual([12, 32, 52, 70, 88]);
  });

  it('merges the lobes of one smeared band into a single lane', () => {
    const width = 500;
    const height = 240;
    const gray = plane(width, height, 1);
    for (const [x0, x1] of [
      [86, 96],
      [206, 216],
      [246, 256],
      [396, 406],
    ]) {
      paintColumn(gray, width, x0, x1, height, 0.25);
    }
    const lanes = detectLanes(gray, width, height, CROP);
    expect(lanes).toHaveLength(3);
    expect(lanes[1].x).toBeGreaterThan(0.4);
    expect(lanes[1].x).toBeLessThan(0.52);
  });
});

describe('detectBands', () => {
  it('finds bands down a lane and clamps their normalised positions', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 1);
    for (const [y0, y1] of [
      [19, 22],
      [49, 52],
      [79, 82],
    ]) {
      paintRow(gray, width, y0, y1, 40, 60, 0.2);
    }
    const bands = detectBands(gray, width, height, { x: 0.5, width: 0.2 }, CROP);
    expect(bands).toHaveLength(3);
    const ys = bands.map((b) => b.y);
    expect(ys[0]).toBeCloseTo(0.21, 1);
    expect(ys[1]).toBeCloseTo(0.51, 1);
    expect(ys[2]).toBeCloseTo(0.81, 1);
    for (const band of bands) {
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.y).toBeLessThanOrEqual(1);
      expect(band.height).toBeGreaterThan(0);
    }
  });

  it('returns no bands for a blank lane', () => {
    expect(detectBands(plane(50, 50, 1), 50, 50, { x: 0.5, width: 0.2 }, CROP)).toEqual([]);
  });
});

describe('detection-to-model helpers', () => {
  it('creates bands with unique ids and lane-derived width', () => {
    const bands = bandsFromDetection(
      [
        { y: 0.2, height: 0.03 },
        { y: 0.6, height: 0.04 },
      ],
      0.1,
    );
    expect(bands).toHaveLength(2);
    expect(bands[0].id).toMatch(/^band_/);
    expect(bands[0].id).not.toBe(bands[1].id);
    expect(bands[0]).toMatchObject({ y: 0.2, height: 0.03, manual: false, excluded: false });
    expect(bands[0].width).toBeCloseTo(0.09, 12);
  });

  it('reuses lane names and samples from the previous layout by index', () => {
    const previous: BlotLane[] = [
      { id: 'old1', x: 0.1, width: 0.05, name: 'Ladder', sample: 'M', group: 'G0', bands: [] },
      { id: 'old2', x: 0.2, width: 0.05, name: 'WT', sample: 'S1', group: 'G1', bands: [] },
    ];
    const lanes = lanesFromDetection(
      [
        { x: 0.2, width: 0.06 },
        { x: 0.4, width: 0.06 },
        { x: 0.6, width: 0.06 },
      ],
      previous,
      'default-group',
    );
    // Detection order is left-to-right; prior lanes are sorted by x first.
    expect(lanes.map((l) => l.name)).toEqual(['Ladder', 'WT', '3']);
    expect(lanes.map((l) => l.group)).toEqual(['G0', 'G1', 'default-group']);
    expect(lanes[0].id).toMatch(/^lane_/);
  });

  it('spreads a requested number of lanes evenly in the crop', () => {
    const lanes = lanesFromCount(3, [], CROP, 'G');
    expect(lanes.map((l) => l.x)).toEqual([expect.closeTo(0.04, 10), expect.closeTo(0.5, 10), expect.closeTo(0.96, 10)]);
    expect(lanes.every((l) => l.width <= 0.12)).toBe(true);
    expect(lanes.map((l) => l.name)).toEqual(['1', '2', '3']);
    expect(lanesFromCount(1, [], CROP, 'G')[0].x).toBeCloseTo(0.5, 10);
  });

  it('collects unique non-empty group names in lane order', () => {
    const lanes: BlotLane[] = [
      { id: 'a', x: 0.1, width: 0.05, name: 'a', sample: '', group: ' WT ', bands: [] },
      { id: 'b', x: 0.2, width: 0.05, name: 'b', sample: '', group: 'KO', bands: [] },
      { id: 'c', x: 0.3, width: 0.05, name: 'c', sample: '', group: 'WT', bands: [] },
      { id: 'd', x: 0.4, width: 0.05, name: 'd', sample: '', group: '', bands: [] },
    ];
    expect(groupNames(lanes)).toEqual(['WT', 'KO']);
  });
});
