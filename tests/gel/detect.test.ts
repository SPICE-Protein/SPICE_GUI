import { describe, expect, it } from 'vitest';
import {
  detectBandsInLane,
  detectGelType,
  detectLanesAuto,
  estimateBandSizes,
  findMarkerMatches,
  identifyMarkers,
  isOutOfRange,
} from '$lib/tools/gel/detect';
import type { LadderDef } from '$lib/tools/gel/ladders';
import { defaultDetectConfig } from '$lib/tools/gel/presets';

const LADDER: LadderDef = {
  id: 'test-ladder',
  name: 'Test ladder',
  kind: 'dna',
  sizes: [10000, 1000, 100, 10],
  ref: [],
};

const LADDER3: LadderDef = {
  id: 'test-ladder-3',
  name: 'Test ladder (3 bands)',
  kind: 'dna',
  sizes: [1000, 100, 10],
  ref: [],
};

function plane(width: number, height: number, fill = 0.1): Float32Array {
  return new Float32Array(width * height).fill(fill);
}

function paintColumn(gray: Float32Array, width: number, x0: number, x1: number, height: number, value: number) {
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) gray[y * width + x] = value;
  }
}

function paintRows(
  gray: Float32Array,
  width: number,
  x0: number,
  x1: number,
  rows: Array<[number, number]>,
  value: number,
) {
  for (const [y0, y1] of rows) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) gray[y * width + x] = value;
    }
  }
}

describe('detectLanesAuto', () => {
  it('finds lane centres from the well row and body signal', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 0.1);
    for (const [x0, x1] of [
      [14, 22],
      [44, 52],
      [74, 82],
    ]) {
      paintColumn(gray, width, x0, x1, height, 0.9);
    }
    const lanes = detectLanesAuto(gray, width, height, false);
    expect(lanes).toHaveLength(3);
    expect(lanes[0].x).toBeGreaterThan(0.15);
    expect(lanes[0].x).toBeLessThan(0.24);
    expect(lanes[1].x).toBeGreaterThan(0.46);
    expect(lanes[1].x).toBeLessThan(0.55);
    expect(lanes[2].x).toBeGreaterThan(0.76);
    expect(lanes[2].x).toBeLessThan(0.85);
    expect(lanes.every((l) => l.width > 0 && l.width <= 0.2)).toBe(true);
  });

  it('returns no lanes for a featureless plane', () => {
    expect(detectLanesAuto(new Float32Array(10000).fill(0.4), 100, 100)).toEqual([]);
  });
});

describe('detectBandsInLane', () => {
  it('finds bright bands down a lane', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 0.1);
    paintRows(gray, width, 40, 60, [
      [19, 22],
      [49, 52],
      [79, 82],
    ], 0.9);
    const bands = detectBandsInLane(gray, width, height, { x: 0.5, width: 0.2 }, 'dna');
    expect(bands).toHaveLength(3);
    expect(bands[0].y).toBeCloseTo(0.21, 1);
    expect(bands[1].y).toBeCloseTo(0.51, 1);
    expect(bands[2].y).toBeCloseTo(0.81, 1);
    expect(bands.every((b) => b.intensity > 0.8 && b.width > 0)).toBe(true);
  });

  it('returns no bands for a blank lane', () => {
    expect(detectBandsInLane(plane(50, 50, 0.1), 50, 50, { x: 0.5, width: 0.2 }, 'dna')).toEqual([]);
  });

  it('lets a wider minimum gap merge close bands', () => {
    const width = 100;
    const height = 100;
    const gray = plane(width, height, 0.1);
    paintRows(gray, width, 40, 60, [
      [19, 22],
      [49, 52],
      [79, 82],
    ], 0.9);
    const config = defaultDetectConfig();
    config.bands.minGap = 0.5;
    const merged = detectBandsInLane(gray, width, height, { x: 0.5, width: 0.2 }, 'dna', config);
    expect(merged.length).toBeLessThan(3);
    expect(merged.length).toBeGreaterThan(0);
  });
});

describe('detectGelType', () => {
  it('classifies a blue-stained image as protein', () => {
    const rgba = new Uint8ClampedArray([50, 50, 200, 255]);
    const guess = detectGelType(rgba, 4, 2, 0.02);
    expect(guess.kind).toBe('protein');
    expect(guess.reasons).toContain('blue');
  });

  it('classifies a red-stained image as DNA', () => {
    const rgba = new Uint8ClampedArray([200, 50, 50, 255]);
    const guess = detectGelType(rgba, 4, 2, 0);
    expect(guess.kind).toBe('dna');
    expect(guess.reasons).toContain('red');
  });

  it('ignores a purple UV background when the band mask is available', () => {
    // A UV transilluminator floods the frame with purple; the pink DNA bands
    // are a minority of the pixels. The whole-image mean votes blue (protein),
    // the band-only mean votes red (DNA).
    const pixels = 144;
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      const band = i >= pixels - 64;
      const [r, g, b] = band ? [255, 80, 140] : [60, 20, 200];
      rgba.set([r, g, b, 255], i * 4);
    }
    expect(detectGelType(rgba, 3, 2, 0).kind).toBe('protein');
    const mask = new Float32Array(pixels);
    for (let i = pixels - 64; i < pixels; i++) mask[i] = 1;
    const guess = detectGelType(rgba, 3, 2, 0, mask);
    expect(guess.kind).toBe('dna');
    expect(guess.reasons).toContain('red');
  });

  it('uses band density and width as fallbacks for neutral images', () => {
    const neutral = new Uint8ClampedArray([128, 128, 128, 255]);
    const many = detectGelType(neutral, 12, 3, 0);
    expect(many.kind).toBe('dna');
    expect(many.reasons).toContain('many');

    const wide = detectGelType(neutral, 5, 2, 0.02);
    expect(wide.kind).toBe('protein');
    expect(wide.reasons).toContain('wide');

    const plain = detectGelType(neutral, 2, 2, 0);
    expect(plain.kind).toBe('dna');
    expect(plain.reasons).toEqual(['neutral']);
  });
});

describe('marker matching', () => {
  const lanes = [
    {
      id: 'm1',
      bands: [
        { y: 0.2, size: 10000 },
        { y: 0.4, size: 1000 },
        { y: 0.6, size: 100 },
        { y: 0.8, size: 10 },
      ],
    },
    {
      id: 'm2',
      bands: [
        { y: 0.2, size: 10000 },
        { y: 0.4, size: 1000 },
        { y: 0.6, size: 100 },
        { y: 0.8, size: 10 },
      ],
    },
  ];

  it('matches a lane to a ladder and gives a near-perfect score', () => {
    const matches = findMarkerMatches([lanes[0]], { kind: 'dna', ladders: [LADDER] });
    expect(matches).toHaveLength(1);
    expect(matches[0].ladder.id).toBe('test-ladder');
    expect(matches[0].sizes).toEqual([10000, 1000, 100, 10]);
    expect(matches[0].score).toBeCloseTo(1, 8);
    expect(matches[0].fit.degree).toBe(1);
    expect(matches[0].fit.b).toBeCloseTo(-5, 8);
  });

  it('rejects lanes whose ladder kind or band count cannot fit', () => {
    expect(findMarkerMatches([lanes[0]], { kind: 'protein', ladders: [LADDER] })).toEqual([]);
    const partial = [{ id: 'p', bands: [{ y: 0.2 }, { y: 0.4 }, { y: 0.6 }] }];
    expect(findMarkerMatches(partial, { kind: 'dna', ladders: [LADDER] })).toEqual([]);
  });

  it('identifies one ladder jointly across marker lanes', () => {
    const bands = [
      { y: 0.2 },
      { y: 0.5 },
      { y: 0.8 },
    ];
    const markerLanes = [
      { id: 'm1', bands },
      { id: 'm2', bands },
    ];
    const result = identifyMarkers(markerLanes, { kind: 'dna', ladders: [LADDER3] })!;
    expect(result).not.toBeNull();
    expect(result.ladder.id).toBe('test-ladder-3');
    expect(result.laneIds.sort()).toEqual(['m1', 'm2']);
    expect(result.assignments.m1).toEqual([1000, 100, 10]);
    expect(result.fit.degree).toBe(1);
    expect(result.fit.r2).toBeCloseTo(1, 8);
    // A 3-band DNA match pays the "few bands" penalty of 0.12.
    expect(result.score).toBeCloseTo(0.88, 8);
  });

  it('returns null when no lane can be matched', () => {
    expect(identifyMarkers([{ id: 'x', bands: [] }], { kind: 'dna', ladders: [LADDER] })).toBeNull();
  });
});

describe('band size estimation', () => {
  const fit = { a: 5, b: -5, c: 0, degree: 1 as const, r2: 1, n: 4 };

  it('interpolates sizes and flags out-of-range positions', () => {
    const sizes = estimateBandSizes(
      [{ y: 0.5 }, { y: 1.0 }],
      fit,
      LADDER,
    );
    expect(sizes[0].size).toBeCloseTo(10 ** 2.5, 6);
    expect(sizes[0].approx).toBe(false);
    expect(sizes[1].size).toBeCloseTo(1, 6);
    expect(sizes[1].approx).toBe(true);
  });

  it('flags disagreement between alternative fits', () => {
    const alt = { a: 4, b: -5, c: 0, degree: 1 as const, r2: 1, n: 4 };
    const [size] = estimateBandSizes([{ y: 0.5 }], fit, LADDER, [alt]);
    expect(size.approx).toBe(true);
  });

  it('detects sizes outside the ladder range', () => {
    expect(isOutOfRange(5, fit, LADDER)).toBe(true);
    expect(isOutOfRange(20000, fit, LADDER)).toBe(true);
    expect(isOutOfRange(316, fit, LADDER)).toBe(false);
  });
});
