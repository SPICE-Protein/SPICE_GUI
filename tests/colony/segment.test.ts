import { describe, expect, it } from 'vitest';
import {
  buildMask,
  distanceTransform,
  estimateBackground,
  gaussianBlur,
  otsuThreshold,
  resolvePolarity,
  segmentGray,
  type SegmentRequest,
} from '$lib/tools/colony/segment';

function plane(width: number, height: number, fill = 0): Float32Array {
  return new Float32Array(width * height).fill(fill);
}

function fillRect(
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

function request(overrides: Partial<SegmentRequest> = {}): SegmentRequest {
  return {
    threshold: 128,
    polarity: 'dark',
    blurRadius: 0,
    minArea: 10,
    maxArea: 0,
    minCircularity: 0,
    splitTouching: false,
    ...overrides,
  };
}

describe('gaussianBlur', () => {
  it('leaves a constant plane constant and returns the input for radius 0', () => {
    const gray = plane(30, 20, 0.4);
    expect(gaussianBlur(gray, 30, 20, 0)).toBe(gray);
    const blurred = gaussianBlur(gray, 30, 20, 2);
    for (const value of blurred) expect(value).toBeCloseTo(0.4, 5);
  });

  it('preserves the mean of a step edge within a small tolerance', () => {
    const width = 20;
    const height = 10;
    const gray = plane(width, height, 0);
    fillRect(gray, width, 10, 20, 0, height, 1);
    const blurred = gaussianBlur(gray, width, height, 2);
    const mean = blurred.reduce((sum, v) => sum + v, 0) / blurred.length;
    expect(mean).toBeCloseTo(0.5, 3);
    expect(blurred[0]).toBeLessThan(0.5);
    expect(blurred[width - 1]).toBeGreaterThan(0.5);
  });
});

describe('otsuThreshold and background', () => {
  it('separates a two-level histogram at the lower level', () => {
    const gray = new Float32Array(100);
    gray.fill(20, 0, 50);
    gray.fill(220, 50);
    expect(otsuThreshold(gray)).toBe(20);
  });

  it('returns the default for an empty plane', () => {
    expect(otsuThreshold(new Float32Array(0))).toBe(128);
  });

  it('estimates the background from the border ring, not the interior', () => {
    const width = 20;
    const height = 20;
    const gray = plane(width, height, 240);
    fillRect(gray, width, 8, 12, 8, 12, 20);
    expect(estimateBackground(gray, width, height)).toBe(240);
  });

  it('resolves auto polarity from the background/threshold relationship', () => {
    expect(resolvePolarity('dark', 240, 128)).toBe('dark');
    expect(resolvePolarity('bright', 20, 128)).toBe('bright');
    expect(resolvePolarity('auto', 240, 128)).toBe('dark');
    expect(resolvePolarity('auto', 20, 128)).toBe('bright');
  });
});

describe('buildMask', () => {
  it('selects the dark or bright side of the threshold', () => {
    const gray = new Float32Array([0, 100, 200]);
    expect(Array.from(buildMask(gray, 100, 'dark'))).toEqual([1, 1, 0]);
    expect(Array.from(buildMask(gray, 100, 'bright'))).toEqual([0, 1, 1]);
  });
});

describe('distanceTransform', () => {
  it('computes Euclidean distance to the nearest background pixel', () => {
    const width = 5;
    const height = 5;
    const bin = new Uint8Array(width * height);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) bin[y * width + x] = 1;
    const dt = distanceTransform(bin, width, height);
    expect(dt[2 * width + 2]).toBeCloseTo(2, 5);
    expect(dt[1 * width + 1]).toBeCloseTo(1, 5);
    expect(dt[0]).toBe(0);
    expect(dt[2 * width + 0]).toBe(0);
  });

  it('returns all zeroes for an empty mask', () => {
    const dt = distanceTransform(new Uint8Array(12), 4, 3);
    expect(Array.from(dt)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('segmentGray', () => {
  it('finds two separated dark colonies and reports their geometry', () => {
    const width = 64;
    const height = 64;
    const gray = plane(width, height, 240);
    fillRect(gray, width, 15, 25, 15, 25, 20); // 10x10 square centred at (20,20)
    fillRect(gray, width, 45, 55, 45, 55, 20); // 10x10 square centred at (50,50)

    const result = segmentGray(gray, width, height, request({ minArea: 50 }));
    expect(result.colonies).toHaveLength(2);
    expect(result.mask).toHaveLength(width * height);
    expect(result.threshold).toBe(128);
    expect(result.background).toBe(240);
    expect(result.polarity).toBe('dark');

    const colonies = [...result.colonies].sort((a, b) => a.x - b.x);
    for (const [colony, centre] of colonies.map((c, i) => [c, [20, 50][i]] as const)) {
      expect(colony.area).toBe(100);
      expect(colony.x).toBeCloseTo(centre, 6);
      expect(colony.y).toBeCloseTo(centre, 6);
      expect(colony.radius).toBeCloseTo(Math.sqrt(100 / Math.PI), 6);
      expect(colony.meanIntensity).toBeCloseTo(20, 6);
      expect(colony.circularity).toBeCloseTo((4 * Math.PI * 100) / (40 * 40), 6);
    }
  });

  it('supports bright colonies on a dark background', () => {
    const width = 40;
    const height = 40;
    const gray = plane(width, height, 10);
    fillRect(gray, width, 10, 20, 10, 20, 240);
    const result = segmentGray(gray, width, height, request({ polarity: 'auto', minArea: 20 }));
    expect(result.polarity).toBe('bright');
    expect(result.colonies).toHaveLength(1);
    expect(result.colonies[0].area).toBe(100);
    expect(result.colonies[0].meanIntensity).toBeCloseTo(240, 6);
  });

  it('applies the area and circularity filters', () => {
    const width = 40;
    const height = 40;
    const gray = plane(width, height, 240);
    fillRect(gray, width, 15, 25, 15, 25, 20);
    expect(segmentGray(gray, width, height, request({ minArea: 150 })).colonies).toHaveLength(0);
    expect(segmentGray(gray, width, height, request({ maxArea: 50 })).colonies).toHaveLength(0);
    expect(segmentGray(gray, width, height, request({ minCircularity: 0.9 })).colonies).toHaveLength(0);
  });

  it('uses Otsu automatically when no threshold is supplied', () => {
    const width = 40;
    const height = 40;
    const gray = plane(width, height, 230);
    fillRect(gray, width, 15, 25, 15, 25, 30);
    const result = segmentGray(gray, width, height, request({ threshold: null, minArea: 20 }));
    expect(result.threshold).toBe(result.otsu);
    expect(result.colonies).toHaveLength(1);
  });

  it('keeps a touching object whole when splitting is disabled', () => {
    const width = 60;
    const height = 40;
    const gray = plane(width, height, 240);
    fillRect(gray, width, 15, 35, 15, 25, 20); // 20x10 bar
    const result = segmentGray(gray, width, height, request({ minArea: 20, splitTouching: false }));
    expect(result.colonies).toHaveLength(1);
    expect(result.colonies[0].area).toBe(200);
  });

  it('splits two lobes joined by a narrow neck while preserving total area', () => {
    const width = 60;
    const height = 40;
    const gray = plane(width, height, 240);
    // Two 10x10 squares joined by a one-pixel-high bridge.
    fillRect(gray, width, 15, 25, 15, 25, 20);
    fillRect(gray, width, 30, 40, 15, 25, 20);
    fillRect(gray, width, 25, 30, 19, 20, 20);
    const result = segmentGray(gray, width, height, request({ minArea: 10, splitTouching: true }));
    expect(result.colonies.length).toBeGreaterThanOrEqual(2);
    const totalArea = result.colonies.reduce((sum, c) => sum + c.area, 0);
    expect(totalArea).toBe(205);
    expect(result.colonies.every((c) => c.area > 0)).toBe(true);
  });

  it('returns an empty result for a uniform bright plane', () => {
    const result = segmentGray(plane(30, 30, 240), 30, 30, request({ minArea: 10 }));
    expect(result.colonies).toEqual([]);
  });
});
