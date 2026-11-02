import { describe, expect, it } from 'vitest';
import {
  buildHistogram,
  cfuCi95,
  computeCfu,
  computeStats,
  countClasses,
  formatArea,
  formatInterval,
  formatScientific,
  markersToCsv,
  median,
  nextMarkerId,
  numberMarkers,
  poissonCi95,
  statisticsToCsv,
} from '$lib/tools/colony/markers';
import type { ColonyMarker } from '$lib/tools/colony/types';

function marker(partial: Partial<ColonyMarker> & { id: number; x: number; y: number }): ColonyMarker {
  return {
    id: partial.id,
    x: partial.x,
    y: partial.y,
    radius: partial.radius ?? Math.sqrt(partial.area ?? 100 / Math.PI),
    area: partial.area ?? 100,
    meanIntensity: partial.meanIntensity ?? 120,
    circularity: partial.circularity ?? 0.9,
    included: partial.included ?? true,
    source: partial.source ?? 'auto',
    meanR: partial.meanR ?? 128,
    meanG: partial.meanG ?? 128,
    meanB: partial.meanB ?? 128,
    hue: partial.hue ?? -1,
    saturation: partial.saturation ?? 0,
    colonyClass: partial.colonyClass ?? 'unclassified',
    classManual: partial.classManual ?? false,
  };
}

describe('median', () => {
  it('handles odd, even and empty inputs without mutating', () => {
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('numberMarkers', () => {
  it('numbers only included markers top-to-bottom then left-to-right', () => {
    const markers = [
      marker({ id: 1, x: 20, y: 10 }),
      marker({ id: 2, x: 5, y: 10 }),
      marker({ id: 3, x: 50, y: 4 }),
      marker({ id: 4, x: 1, y: 1, included: false }),
    ];
    const { labels } = numberMarkers(markers);
    expect([...labels.entries()]).toEqual([
      [3, 1],
      [2, 2],
      [1, 3],
    ]);
    expect(labels.has(4)).toBe(false);
  });
});

describe('computeStats', () => {
  it('summarizes included markers and counts manual ones', () => {
    const markers = [
      marker({ id: 1, x: 0, y: 0, area: 100, meanIntensity: 100, circularity: 1 }),
      marker({ id: 2, x: 0, y: 0, area: 200, meanIntensity: 200, circularity: 0.8 }),
      marker({ id: 3, x: 0, y: 0, area: 300, meanIntensity: 300, circularity: 0.6, included: false }),
      marker({ id: 4, x: 0, y: 0, area: 400, meanIntensity: 400, circularity: 1, source: 'manual' }),
    ];
    const stats = computeStats(markers);
    expect(stats).toMatchObject({
      total: 4,
      included: 3,
      excluded: 1,
      manual: 1,
      meanArea: 700 / 3,
      medianArea: 200,
      meanIntensity: 700 / 3,
      meanCircularity: (1 + 0.8 + 1) / 3,
    });
  });

  it('uses zeroes for an empty marker list', () => {
    expect(computeStats([])).toEqual({
      total: 0,
      included: 0,
      excluded: 0,
      manual: 0,
      meanArea: 0,
      medianArea: 0,
      meanIntensity: 0,
      meanCircularity: 0,
    });
  });
});

describe('buildHistogram', () => {
  it('bins values with a fixed width and clamps the maximum into the last bin', () => {
    const histogram = buildHistogram([1, 2, 3, 4]);
    expect(histogram).toEqual({
      counts: [1, 0, 1, 0, 1, 1],
      min: 1,
      max: 4,
      binWidth: 0.5,
      peak: 1,
      total: 4,
    });
    expect(histogram.counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('expands a constant range around the single value', () => {
    const histogram = buildHistogram([5, 5, 5]);
    expect(histogram.min).toBe(4);
    expect(histogram.max).toBe(6);
    expect(histogram.counts[3]).toBe(3);
    expect(histogram.peak).toBe(3);
  });

  it('returns an empty histogram for no areas', () => {
    expect(buildHistogram([])).toEqual({ counts: [], min: 0, max: 0, binWidth: 0, peak: 0, total: 0 });
  });

  it('respects the bin-count bounds', () => {
    const many = Array.from({ length: 1000 }, (_, i) => i);
    // Default cap is 18 bins; an explicit cap is honoured up to the sqrt rule.
    expect(buildHistogram(many).counts).toHaveLength(18);
    const wide = buildHistogram(many, 100);
    expect(wide.counts).toHaveLength(36);
    expect(wide.total).toBe(1000);
    expect(wide.counts.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe('markersToCsv', () => {
  it('writes one line per marker with numbering and numeric precision', () => {
    const markers = [
      marker({ id: 1, x: 10.1234, y: 20.5555, area: 100, radius: 5.638, meanIntensity: 120.456, circularity: 0.91234 }),
      marker({ id: 2, x: 1, y: 2, area: 50, radius: 4, meanIntensity: 90, circularity: 0.5, included: false }),
    ];
    const { labels } = numberMarkers(markers);
    const csv = markersToCsv(markers, { labels });
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'id,number,x,y,area_px2,radius_px,mean_intensity,circularity,included,source,class,mean_r,mean_g,mean_b,hue,saturation,class_manual'
    );
    expect(lines[1]).toBe('1,1,10.12,20.56,100.00,5.64,120.46,0.9123,1,auto,unclassified,128.0,128.0,128.0,-1.0,0.000,0');
    expect(lines[2]).toBe('2,,1.00,2.00,50.00,4.00,90.00,0.5000,0,auto,unclassified,128.0,128.0,128.0,-1.0,0.000,0');
  });
});

describe('CFU and formatting', () => {
  it('computes CFU per mL from count, dilution and plated volume', () => {
    expect(computeCfu(50, 1e4, 0.1)).toBe(5e6);
    expect(computeCfu(0, 1e4, 0.1)).toBe(0);
  });

  it('rejects non-finite and non-positive factors', () => {
    expect(computeCfu(10, 0, 0.1)).toBeNull();
    expect(computeCfu(10, 1e4, 0)).toBeNull();
    expect(computeCfu(10, -1, 0.1)).toBeNull();
    expect(computeCfu(Number.NaN, 1e4, 0.1)).toBeNull();
    expect(computeCfu(10, Infinity, 0.1)).toBeNull();
  });

  it('formats scientific and area values for the report', () => {
    expect(formatScientific(1234)).toBe('1.23 × 10^3');
    expect(formatScientific(0.00123)).toBe('1.23 × 10^-3');
    expect(formatScientific(0)).toBe('0');
    expect(formatScientific(null)).toBe('—');
    expect(formatScientific(Number.NaN)).toBe('—');
    expect(formatArea(12345)).toBe('12,345');
    expect(formatArea(150)).toBe('150');
    expect(formatArea(12.34)).toBe('12.3');
    expect(formatArea(0)).toBe('0');
    expect(formatArea(-2)).toBe('0');
  });

  it('computes exact Poisson 95% intervals from chi-square quantiles', () => {
    const zero = poissonCi95(0);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(3.688879454, 6);

    const hundred = poissonCi95(100);
    expect(hundred.low).toBeCloseTo(81.363991251, 6);
    expect(hundred.high).toBeCloseTo(121.626793792, 6);

    // Counts are floored and invalid values behave like zero.
    expect(poissonCi95(5.9)).toEqual(poissonCi95(5));
    expect(poissonCi95(-3)).toEqual(poissonCi95(0));
    expect(poissonCi95(Number.NaN)).toEqual(poissonCi95(0));
  });

  it('scales Poisson intervals to CFU per mL', () => {
    const interval = cfuCi95(100, 1000, 0.1)!;
    expect(interval.low).toBeCloseTo(813639.9125, 2);
    expect(interval.high).toBeCloseTo(1216267.9379, 2);
    expect(cfuCi95(100, 0, 0.1)).toBeNull();
    expect(cfuCi95(100, 1000, 0)).toBeNull();
    // An invalid count is treated as zero by the Poisson helper.
    const zeroCfu = cfuCi95(Number.NaN, 1000, 0.1)!;
    expect(zeroCfu.low).toBe(0);
    expect(zeroCfu.high).toBeCloseTo(36888.79454113933, 6);
  });

  it('formats intervals for reports', () => {
    expect(formatInterval(poissonCi95(100))).toBe('8.14 × 10^1 – 1.22 × 10^2');
    expect(formatInterval(null)).toBe('—');
  });

  it('counts blue, white and unclassified included markers', () => {
    const markers = [
      { ...marker({ id: 1, x: 0, y: 0 }), colonyClass: 'blue' },
      { ...marker({ id: 2, x: 0, y: 0 }), colonyClass: 'white' },
      { ...marker({ id: 3, x: 0, y: 0 }), colonyClass: 'unclassified' },
      { ...marker({ id: 4, x: 0, y: 0, included: false }), colonyClass: 'blue' },
    ] as ColonyMarker[];
    expect(countClasses(markers)).toEqual({ blue: 1, white: 1, unclassified: 1 });
  });

  it('writes the statistics CSV used by batch exports', () => {
    const csv = statisticsToCsv([
      {
        label: 'Plate, A',
        count: 5,
        countLow: 1.623486,
        countHigh: 11.668332,
        blue: 3,
        white: 2,
        unclassified: 0,
        cfu: 5e4,
        cfuLow: 1.6e4,
        cfuHigh: 1.16e5,
      },
    ]);
    expect(csv.split('\n')[0]).toBe(
      'label,count,count_ci95_low,count_ci95_high,blue,white,unclassified,cfu_per_ml,cfu_ci95_low,cfu_ci95_high',
    );
    expect(csv.split('\n')[1]).toBe('"Plate, A",5,1.62,11.67,3,2,0,50000.0000,16000.0000,116000.0000');
  });

  it('appends class columns when markers carry class data', () => {
    const markerWithClass = {
      ...marker({ id: 1, x: 1, y: 2 }),
      colonyClass: 'blue',
      meanR: 12.34,
      meanG: 56.78,
      meanB: 200.1,
      hue: 210.4,
      saturation: 0.8123,
      classManual: false,
    } as ColonyMarker;
    const csv = markersToCsv([markerWithClass], { labels: new Map([[1, 1]]) });
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'id,number,x,y,area_px2,radius_px,mean_intensity,circularity,included,source,class,mean_r,mean_g,mean_b,hue,saturation,class_manual',
    );
    expect(lines[1]).toBe('1,1,1.00,2.00,100.00,5.64,120.00,0.9000,1,auto,blue,12.3,56.8,200.1,210.4,0.812,0');
  });

  it('increments marker ids beyond the current maximum', () => {
    const first = nextMarkerId([{ id: 10 } as ColonyMarker]);
    const second = nextMarkerId([]);
    expect(first).toBe(11);
    expect(second).toBe(12);
  });
});
