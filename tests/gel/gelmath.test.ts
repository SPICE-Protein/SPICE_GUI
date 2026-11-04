import { describe, expect, it } from 'vitest';
import { detectBandsInLane, detectLanesAuto } from '$lib/tools/gel/detect';
import {
  autoCropRect,
  binarizeGray,
  clippedFraction,
  collapseFlatPeaks,
  columnProfile,
  detectLanes,
  findPeaks,
  fitLadder,
  meanRgb,
  percentile,
  polyAt,
  robustFit,
  rowProfile,
  rotationScore,
  sizeFromY,
  toGrayPlane,
  type Peak,
} from '$lib/tools/gel/gelmath';

function profile(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('profiles', () => {
  it('averages columns and rows exactly', () => {
    const gray = new Float32Array([1, 2, 3, 4, 5, 6]);
    expect(Array.from(columnProfile(gray, 3, 2))).toEqual([2.5, 3.5, 4.5]);
    expect(Array.from(rowProfile(gray, 3, 2, 0, 3))).toEqual([2, 5]);
  });

  it('clamps profile bounds', () => {
    const gray = new Float32Array([1, 2, 3, 4]);
    // A 2x2 plane has two columns and two rows. Out-of-range bounds clamp to
    // the valid span.
    expect(Array.from(columnProfile(gray, 2, 2, -5, 10))).toEqual([2, 3]);
    expect(Array.from(rowProfile(gray, 2, 2, -5, 1))).toEqual([1, 3]);
    expect(Array.from(rowProfile(gray, 2, 2, 1, 5))).toEqual([2, 4]);
  });

  it('computes a row-difference sharpness score', () => {
    const flat = new Float32Array(9).fill(0.5);
    expect(rotationScore(flat, 3, 3)).toBe(0);
    const steps = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0]);
    expect(rotationScore(steps, 3, 3)).toBe(2);
  });

  it('converts RGBA pixels to luminance', () => {
    const fake = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
    } as unknown as ImageData;
    const gray = toGrayPlane(fake);
    expect(gray[0]).toBeCloseTo(0.299, 4);
    expect(gray[1]).toBeCloseTo(0.587, 4);
  });

  it('summarizes mean RGB and saturation', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const result = meanRgb(rgba);
    expect(result.r).toBeCloseTo(127.5, 6);
    expect(result.g).toBeCloseTo(127.5, 6);
    expect(result.b).toBeCloseTo(127.5, 6);
    expect(result.sat).toBeCloseTo(0.75, 6);
  });
});

describe('findPeaks', () => {
  it('finds a single sharp peak at its exact bucket', () => {
    const peaks = findPeaks(profile([0, 0, 0, 1, 0, 0, 0]), {
      smooth: 1,
      prominenceStd: 0.5,
      minProminence: 0.1,
      minGap: 1,
    });
    expect(peaks).toHaveLength(1);
    expect(peaks[0].frac).toBeCloseTo(0.5, 12);
    expect(peaks[0].value).toBeCloseTo(1, 12);
    expect(peaks[0].prominence).toBeCloseTo(1, 12);
  });

  it('suppresses nearby peaks in favour of the more prominent one', () => {
    const peaks = findPeaks(profile([0, 0, 1, 0, 0, 0.8, 0, 0]), {
      smooth: 1,
      prominenceStd: 0.5,
      minProminence: 0.1,
      minGap: 6,
    });
    expect(peaks).toHaveLength(1);
    expect(peaks[0].value).toBeCloseTo(1, 12);
  });

  it('ignores peaks below the prominence threshold and flat profiles', () => {
    expect(findPeaks(profile([0, 0, 0.1, 0, 0]), { smooth: 1, minProminence: 0.5 })).toEqual([]);
    expect(findPeaks(profile([1, 1, 1, 1]), { smooth: 1 })).toEqual([]);
    expect(findPeaks(profile([1, 2]), { smooth: 1 })).toEqual([]);
  });

  it('merges flat-topped clusters at their prominence-weighted centroid', () => {
    const values = new Array(100).fill(0);
    for (let i = 35; i <= 50; i++) values[i] = 1;
    values[42] = 0.8; // shallow dip that must not split the cluster
    const peaks: Peak[] = [
      { frac: 0.4, value: 1, prominence: 1 },
      { frac: 0.45, value: 0.95, prominence: 0.8 },
    ];
    const merged = collapseFlatPeaks(profile(values), peaks);
    expect(merged).toHaveLength(1);
    expect(merged[0].frac).toBeCloseTo(0.4222, 3);
  });

  it('keeps well-separated peaks', () => {
    const values = new Array(100).fill(0);
    values[20] = 1;
    values[70] = 1;
    const peaks: Peak[] = [
      { frac: 0.2, value: 1, prominence: 1 },
      { frac: 0.7, value: 1, prominence: 1 },
    ];
    expect(collapseFlatPeaks(profile(values), peaks)).toHaveLength(2);
  });
});

/** Synthetic slab with an uneven background and vertical lane bands, used to
 *  exercise the binarizer on both contrast polarities. */
function gelPlane(bandValue: number, background: [number, number] = [0.08, 0.12]) {
  const width = 200;
  const height = 160;
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = background[0] + (background[1] - background[0]) * (x / (width - 1));
    }
  }
  const lanes = [0.15, 0.38, 0.62, 0.85];
  for (const lane of lanes) {
    const x0 = Math.round((lane - 0.04) * width);
    const x1 = Math.round((lane + 0.04) * width);
    for (const band of [0.3, 0.5, 0.7]) {
      const y0 = Math.round((band - 0.03) * height);
      const y1 = Math.round((band + 0.03) * height);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) gray[y * width + x] = bandValue;
      }
    }
  }
  return { gray, width, height, lanes };
}

describe('binarization', () => {
  it('detects bright bands on a dark, uneven background', () => {
    const { gray, width, height } = gelPlane(0.85);
    const result = binarizeGray(gray, width, height);
    expect(result.polarity).toBe(1);
    let on = 0;
    for (const v of result.signal) on += v;
    // Four lanes x three bands x 16px wide x 10px tall, with slack.
    expect(on).toBeGreaterThan(4 * 3 * 100);
    expect(on).toBeLessThan(gray.length * 0.2);
  });

  it('flips polarity for dark bands on a light background', () => {
    const { gray, width, height } = gelPlane(0.1, [0.88, 0.94]);
    const result = binarizeGray(gray, width, height);
    expect(result.polarity).toBe(-1);
    let on = 0;
    for (const v of result.signal) on += v;
    expect(on).toBeGreaterThan(4 * 3 * 100);
  });

  it('returns an empty mask for an empty gradient', () => {
    const width = 80;
    const height = 60;
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) gray[y * width + x] = 0.2 + 0.4 * (x / width);
    }
    const result = binarizeGray(gray, width, height);
    expect(result.signal.every((v) => v === 0)).toBe(true);
  });
});

describe('binary lane detection', () => {
  it('finds lanes with bright bands regardless of background glow', () => {
    const { gray, width, height, lanes } = gelPlane(0.85);
    const found = detectLanesAuto(gray, width, height);
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const expected of lanes) {
      expect(found.some((lane) => Math.abs(lane.x - expected) < 0.04)).toBe(true);
    }
  });

  it('finds lanes with dark bands on a light background', () => {
    const { gray, width, height, lanes } = gelPlane(0.1, [0.88, 0.94]);
    const found = detectLanesAuto(gray, width, height);
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const expected of lanes) {
      expect(found.some((lane) => Math.abs(lane.x - expected) < 0.04)).toBe(true);
    }
  });

  it('finds the bands inside a detected lane', () => {
    const { gray, width, height } = gelPlane(0.85);
    const lane = detectLanesAuto(gray, width, height)[1];
    const bands = detectBandsInLane(gray, width, height, lane, 'dna');
    expect(bands.length).toBeGreaterThanOrEqual(3);
    for (const expected of [0.3, 0.5, 0.7]) {
      expect(bands.some((band) => Math.abs(band.y - expected) < 0.04)).toBe(true);
    }
  });
});

describe('lane detection', () => {
  it('finds bright lanes on a dark background', () => {
    const width = 100;
    const height = 50;
    const gray = new Float32Array(width * height).fill(0.1);
    for (const [x0, x1] of [
      [14, 22],
      [44, 52],
      [74, 82],
    ]) {
      for (let y = 0; y < height; y++) {
        for (let x = x0; x < x1; x++) gray[y * width + x] = 0.9;
      }
    }
    const lanes = detectLanes(gray, width, height);
    expect(lanes).toHaveLength(3);
    expect(lanes[0].x).toBeGreaterThan(0.15);
    expect(lanes[0].x).toBeLessThan(0.24);
    expect(lanes[1].x).toBeGreaterThan(0.46);
    expect(lanes[1].x).toBeLessThan(0.55);
    expect(lanes[2].x).toBeGreaterThan(0.76);
    expect(lanes[2].x).toBeLessThan(0.85);
    expect(lanes.every((l) => l.width > 0 && l.width <= 0.2)).toBe(true);
  });

  it('returns no lanes for a uniform plane', () => {
    expect(detectLanes(new Float32Array(400).fill(0.5), 20, 20)).toEqual([]);
  });
});

describe('ladder fitting', () => {
  const points = [
    { y: 0.1, size: 1000 },
    { y: 0.4, size: 100 },
    { y: 0.7, size: 10 },
    { y: 1.0, size: 1 },
  ];

  it('recovers an exact log-linear ladder', () => {
    const fit = fitLadder(points)!;
    expect(fit.a).toBeCloseTo(-10 / 3, 8);
    expect(fit.b).toBeCloseTo(10 / 3, 8);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.n).toBe(4);
    expect(sizeFromY(fit, 0.1)).toBeCloseTo(1000, 6);
    expect(sizeFromY(fit, 0.4)).toBeCloseTo(100, 6);
    expect(sizeFromY(fit, 0.7)).toBeCloseTo(10, 6);
  });

  it('rejects insufficient or degenerate ladders', () => {
    expect(fitLadder([])).toBeNull();
    expect(fitLadder([{ y: 0.5, size: 100 }])).toBeNull();
    expect(
      fitLadder([
        { y: 0.5, size: 100 },
        { y: 0.5, size: 200 },
      ]),
    ).toBeNull();
  });

  it('fits a clean linear ladder and rejects one gross outlier', () => {
    const linear = robustFit(points, 1)!;
    expect(linear.degree).toBe(1);
    expect(linear.r2).toBeCloseTo(1, 10);
    expect(polyAt(linear, 0.4)).toBeCloseTo(2, 8);

    // log10 sizes 3,2,1,0 at y .1,.3,.5,.7 fit log(size) = 3.5 - 5y exactly.
    const withOutlier = [
      { y: 0.1, size: 1000 },
      { y: 0.3, size: 100 },
      { y: 0.5, size: 10 },
      { y: 0.7, size: 1 },
      { y: 0.9, size: 1e6 },
    ];
    const robust = robustFit(withOutlier, 1)!;
    expect(robust.r2).toBeCloseTo(1, 8);
    expect(robust.b).toBeCloseTo(-5, 6);
    expect(polyAt(robust, 0.9)).toBeCloseTo(-1, 6); // ignores the 1e6 outlier
  });
});

describe('image summary helpers', () => {
  it('computes percentiles with the documented rounding', () => {
    const values = [10, 20, 30, 40];
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 0.5)).toBe(30);
    expect(percentile(values, 1)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('measures clipped dark and bright fractions', () => {
    const result = clippedFraction(new Float32Array([0, 0.002, 0.5, 0.998, 1]));
    expect(result.dark).toBeCloseTo(0.4, 12);
    expect(result.bright).toBeCloseTo(0.4, 12);
  });

  it('locates a bright slab against a dark scanner border', () => {
    const width = 100;
    const height = 100;
    const gray = new Float32Array(width * height).fill(0.1);
    for (let y = 0; y < height; y++) {
      for (let x = 10; x < 90; x++) gray[y * width + x] = 0.9;
    }
    const crop = autoCropRect(gray, width, height);
    expect(crop.left).toBeGreaterThan(0.05);
    expect(crop.left).toBeLessThan(0.12);
    expect(crop.right).toBeGreaterThan(0.05);
    expect(crop.right).toBeLessThan(0.12);
    expect(crop.top).toBe(0);
    expect(crop.bottom).toBe(0);
  });
});

describe('polynomial fits', () => {
  it('recovers an exact quadratic ladder curve', () => {
    const points = [0, 0.25, 0.5, 0.75, 1].map((y) => ({
      y,
      size: 10 ** (1.5 + 0.8 * y - 0.4 * y * y),
    }));
    const fit = robustFit(points, 2);
    expect(fit).not.toBeNull();
    expect(fit?.degree).toBe(2);
    expect(fit!.r2).toBeCloseTo(1, 8);
    for (const point of points) {
      expect(polyAt(fit!, point.y)).toBeCloseTo(Math.log10(point.size), 8);
    }
  });
});
