import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SENSITIVITY,
  channelPlane,
  defaultDetectConfig,
  detectConfigKey,
  nativeBinarizeOptions,
  presetById,
  sanitizeDetectConfig,
} from '$lib/tools/gel/presets';
import { binarizeGray } from '$lib/tools/gel/gelmath';
import { emptyProject } from '$lib/tools/gel/types';
import { normalizeProject, sanitizeGelProject } from '$lib/tools/gel/projectDoc';

function gradient(width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = 0.1 + (0.2 * x) / (width - 1);
  }
  return gray;
}

function paintBand(gray: Float32Array, width: number, x0: number, x1: number, y0: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[y * width + x] = 0.75;
  }
}

describe('detection presets', () => {
  it('keeps the shipped thresholds as the auto defaults', () => {
    const config = defaultDetectConfig();
    expect(config.presetId).toBe('auto');
    expect(config.type).toBe('auto');
    expect(config.channel).toBe('auto');
    expect(config.polarity).toBe('auto');
    expect(config.sensitivity).toBe(DEFAULT_SENSITIVITY);
    expect(config.lanes.cut).toBe(0.08);
    expect(config.bands.prominence).toBe(0.5);
    expect(nativeBinarizeOptions(config)).toEqual({ polarity: 0, delta: -8, openRadius: 1 });
  });

  it('bundles a stain channel, polarity, type and display mode', () => {
    const uv = presetById('uv');
    expect(uv?.display).toBe('color');
    expect(uv?.config.type).toBe('dna');
    expect(uv?.config.channel).toBe('red-blue');
    expect(uv?.config.polarity).toBe('bright');
    expect(nativeBinarizeOptions(uv!.config).polarity).toBe(1);

    const coomassie = presetById('coomassie');
    expect(coomassie?.display).toBe('gray');
    expect(coomassie?.config.type).toBe('protein');
    expect(coomassie?.config.polarity).toBe('dark');
    expect(nativeBinarizeOptions(coomassie!.config).polarity).toBe(-1);
  });

  it('clamps hand-edited values and fills missing fields from the preset', () => {
    const config = sanitizeDetectConfig({
      presetId: 'uv',
      sensitivity: 9,
      denoise: -3,
      lanes: { cut: 0, minWidth: 1 },
      bands: { prominence: 0 },
    });
    expect(config.presetId).toBe('uv');
    expect(config.channel).toBe('red-blue');
    expect(config.sensitivity).toBe(1);
    expect(config.denoise).toBe(0);
    expect(config.lanes.cut).toBe(0.02);
    expect(config.lanes.minWidth).toBe(0.02);
    expect(config.bands.prominence).toBe(0.1);
  });

  it('changes the cache key only for binarizer fields', () => {
    const a = defaultDetectConfig();
    const b = { ...a, sensitivity: 0.8 };
    const c = { ...a, lanes: { ...a.lanes, cut: 0.2 } };
    expect(detectConfigKey(a)).not.toBe(detectConfigKey(b));
    expect(detectConfigKey(a)).toBe(detectConfigKey(c));
  });

  it('extracts an explicit colour channel', () => {
    const rgba = new Uint8ClampedArray([200, 50, 100, 255, 10, 20, 30, 255]);
    const red = channelPlane(rgba, 2, 1, 'red');
    expect(red[0]).toBeCloseTo(200 / 255, 5);
    expect(red[1]).toBeCloseTo(10 / 255, 5);
    const rb = channelPlane(rgba, 2, 1, 'red-blue');
    expect(rb[0]).toBeCloseTo(0.5 + 100 / 510, 5);
    expect(rb[1]).toBeCloseTo(0.5 - 20 / 510, 5);
    const luma = channelPlane(rgba, 2, 1, 'luma');
    expect(luma[0]).toBeCloseTo((200 * 0.299 + 50 * 0.587 + 100 * 0.114) / 255, 5);
  });

  it('honours a forced polarity and sensitivity in the JS fallback', () => {
    const width = 100;
    const height = 100;
    const gray = gradient(width, height);
    paintBand(gray, width, 20, 30, 30, 40);
    paintBand(gray, width, 60, 70, 60, 70);

    const bright = defaultDetectConfig();
    expect(binarizeGray(gray, width, height, bright).polarity).toBe(1);
    const dark = { ...bright, polarity: 'dark' as const };
    expect(binarizeGray(gray, width, height, dark).polarity).toBe(-1);

    const strict = { ...bright, sensitivity: 0 };
    const loose = { ...bright, sensitivity: 1 };
    expect(binarizeGray(gray, width, height, loose).threshold).toBeLessThan(
      binarizeGray(gray, width, height, strict).threshold,
    );
  });
});

describe('project detection migration', () => {
  it('gives legacy projects the neutral auto config', () => {
    const project = emptyProject();
    delete (project as { detect?: unknown }).detect;
    const normalized = normalizeProject(project);
    expect(normalized.detect.presetId).toBe('auto');
    expect(normalized.detect.channel).toBe('auto');
  });

  it('sanitizes the config carried by a project document', () => {
    const project = emptyProject();
    project.detect = sanitizeDetectConfig({
      presetId: 'coomassie',
      sensitivity: 2,
      lanes: { cut: -1 },
    });
    const parsed = sanitizeGelProject(JSON.parse(JSON.stringify(project)));
    expect(parsed?.detect.presetId).toBe('coomassie');
    expect(parsed?.detect.type).toBe('protein');
    expect(parsed?.detect.sensitivity).toBe(1);
    expect(parsed?.detect.lanes.cut).toBe(0.02);
  });
});
