import { describe, expect, it } from 'vitest';
import {
  hitTest,
  fontString,
  mapX,
  mapY,
  unmapX,
  unmapY,
  type FigureLayout,
  type FigureItem,
  type TextStyle,
} from '$lib/tools/gel/figure';

const CROP = { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 };

const STYLE: TextStyle = { family: 'Arial', size: 10, color: '#111111' };

describe('coordinate mapping', () => {
  it('maps normalised image coordinates into the gel box', () => {
    expect(mapX(0.1, CROP, 10, 70)).toBeCloseTo(10, 12);
    expect(mapX(0.45, CROP, 10, 70)).toBeCloseTo(45, 12);
    expect(mapX(0.8, CROP, 10, 70)).toBeCloseTo(80, 12);
  });

  it('maps y coordinates with independent crop fractions', () => {
    expect(mapY(0.05, CROP, 20, 80)).toBeCloseTo(20, 12);
    expect(mapY(0.45, CROP, 20, 80)).toBeCloseTo(60, 12);
    expect(mapY(0.85, CROP, 20, 80)).toBeCloseTo(100, 12);
  });

  it('round-trips through unmap', () => {
    for (const x of [0.1, 0.3, 0.55, 0.8]) {
      expect(unmapX(mapX(x, CROP, 10, 70), CROP, 10, 70)).toBeCloseTo(x, 12);
    }
    for (const y of [0.05, 0.2, 0.5, 0.85]) {
      expect(unmapY(mapY(y, CROP, 20, 80), CROP, 20, 80)).toBeCloseTo(y, 12);
    }
  });

  it('guards against a degenerate visible span', () => {
    const full = { left: 0.6, top: 0.6, right: 0.6, bottom: 0.6 };
    expect(mapX(1, full, 0, 100)).toBeCloseTo(0 + (0.4 / 0.05) * 100, 8);
  });
});

describe('fontString', () => {
  it('composes standard canvas font strings', () => {
    expect(fontString(STYLE)).toBe('10px Arial');
    expect(fontString({ ...STYLE, bold: true })).toBe('bold 10px Arial');
    expect(fontString({ ...STYLE, italic: true })).toBe('italic 10px Arial');
    expect(fontString({ ...STYLE, bold: true, italic: true })).toBe('italic bold 10px Arial');
  });
});

describe('hitTest', () => {
  const textItem: FigureItem = {
    kind: 'text',
    x: 10,
    y: 20,
    text: 'label',
    style: STYLE,
    bbox: { x: 10, y: 10, w: 40, h: 12 },
    hit: { kind: 'laneName', laneId: 'L1' },
  };
  const rectItem: FigureItem = {
    kind: 'rect',
    x: 30,
    y: 5,
    w: 20,
    h: 20,
    color: '#000',
    width: 1,
    hit: { kind: 'band', laneId: 'L1', bandIndex: 2 },
  };
  const inertText: FigureItem = {
    kind: 'text',
    x: 0,
    y: 0,
    text: 'caption',
    style: STYLE,
    bbox: { x: 0, y: 0, w: 200, h: 200 },
  };
  const layout = {
    width: 100,
    height: 100,
    gel: { x: 0, y: 0, w: 100, h: 100 },
    crop: CROP,
    gelDark: false,
    fontFamily: 'Arial',
    items: [inertText, textItem, rectItem],
  } as unknown as FigureLayout;

  it('returns hits inside text and rectangle bounds', () => {
    expect(hitTest(layout, 15, 15)).toEqual({ kind: 'laneName', laneId: 'L1' });
    expect(hitTest(layout, 35, 10)).toEqual({ kind: 'band', laneId: 'L1', bandIndex: 2 });
  });

  it('prefers the topmost item and ignores items without hits', () => {
    expect(hitTest(layout, 35, 15)).toEqual({ kind: 'band', laneId: 'L1', bandIndex: 2 });
    expect(hitTest(layout, 50, 50)).toBeNull();
  });

  it('treats bounding boxes as inclusive', () => {
    expect(hitTest(layout, 10, 10)).toEqual({ kind: 'laneName', laneId: 'L1' });
    expect(hitTest(layout, 10, 22)).toEqual({ kind: 'laneName', laneId: 'L1' });
    expect(hitTest(layout, 50.01, 12)).toBeNull();
  });
});
