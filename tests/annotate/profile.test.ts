import { describe, expect, it } from 'vitest';
import {
  PROFILE_DEFAULT_SAMPLES,
  PROFILE_MAX_SAMPLES,
  PROFILE_MIN_SAMPLES,
  profileCsv,
  profilePlotPath,
  profileStatsText,
  sampleProfile,
} from '$lib/tools/annotate/profile';
import type { ProfileAnnotation } from '$lib/tools/annotate/types';

function annotation(partial: Partial<ProfileAnnotation> = {}): ProfileAnnotation {
  return {
    id: 'profile_1',
    kind: 'profile',
    color: '#ff0000',
    x1: 0,
    y1: 0,
    x2: 16,
    y2: 0,
    samples: 17,
    strokeWidthPt: 1,
    ...partial,
  };
}

function lineBuffer(values: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  });
  return data;
}

describe('sampleProfile', () => {
  it('samples one pixel per tick and reports luminance statistics', () => {
    const values = new Array(17).fill(0);
    values[8] = 255;
    const series = sampleProfile(annotation(), lineBuffer(values), 17, 1, 'Line');
    expect(series.name).toBe('Line');
    expect(series.points).toHaveLength(17);
    expect(series.points[8].x).toBe(8);
    expect(series.points[8].intensity).toBeCloseTo(255, 8);
    expect(series.min).toBe(0);
    expect(series.max).toBeCloseTo(255, 8);
    expect(series.mean).toBeCloseTo(15, 8);
    expect(series.points[16].distancePx).toBeCloseTo(16, 8);
  });

  it('clamps sample count and coordinates to the buffer', () => {
    const tooMany = sampleProfile(annotation({ samples: 5000 }), lineBuffer(new Array(17).fill(50)), 17, 1);
    const tooFew = sampleProfile(annotation({ samples: 1 }), lineBuffer(new Array(17).fill(50)), 17, 1);
    expect(tooMany.points).toHaveLength(PROFILE_MAX_SAMPLES);
    expect(tooFew.points).toHaveLength(PROFILE_MIN_SAMPLES);
    expect(tooFew.points.every((point) => Number.isFinite(point.intensity))).toBe(true);
  });
});

describe('profile exports', () => {
  it('writes a CSV row per sample with a header', () => {
    const series = sampleProfile(
      annotation({ samples: PROFILE_DEFAULT_SAMPLES }),
      lineBuffer(new Array(17).fill(128)),
      17,
      1,
      'P1',
    );
    const csv = profileCsv([series]);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(series.points.length + 1);
    expect(lines[0]).toContain('intensity_0_255');
    expect(lines[1]).toContain('P1');
    expect(lines[1]).toContain('profile_1');
  });

  it('builds a bounded plot path and a readable stats line', () => {
    const series = sampleProfile(annotation(), lineBuffer(new Array(17).fill(64)), 17, 1);
    const path = profilePlotPath(series, 120, 40);
    expect(path.startsWith('M')).toBe(true);
    expect((path.match(/L/g) ?? []).length).toBe(series.points.length - 1);
    expect(profileStatsText(series)).toBe('64.0 / 64.0 / 64.0');
  });
});
