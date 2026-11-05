import { describe, expect, it } from 'vitest';
import {
  ROTATE_HANDLE_OFFSET,
  alignmentGuides,
  alignRects,
  clampToPage,
  distributeRects,
  groupSelection,
  handlePoints,
  hitTestHandle,
  hitTestNode,
  imageNaturalRect,
  moveNodes,
  nodesBounds,
  resizeRect,
  snapNodeRect,
  snapPoint,
  snapScalar,
  ungroupSelection,
  zoomToFit,
} from '$lib/tools/figure/geometry';
import { createEllipseNode, createRectNode, type FigureNode, type RectNode } from '$lib/tools/figure/types';

function rect(overrides: Partial<RectNode> = {}): RectNode {
  return { ...createRectNode(10, 20, 100, 50), id: 'n1', ...overrides };
}

describe('bounds and hit testing', () => {
  it('returns null for an empty selection and unions rotated bounds', () => {
    expect(nodesBounds([])).toBeNull();
    const a = rect({ id: 'a', x: 10, y: 20, w: 100, h: 50 });
    const b = rect({ id: 'b', x: 200, y: 100, w: 50, h: 40 });
    expect(nodesBounds([a, b])).toEqual({ x: 10, y: 20, w: 240, h: 120 });

    const rotated = rect({ id: 'r', x: 0, y: 0, w: 100, h: 20, rotation: 90 });
    const bounds = nodesBounds([rotated]);
    expect(bounds?.w).toBeCloseTo(20);
    expect(bounds?.h).toBeCloseTo(100);
    expect(bounds?.x).toBeCloseTo(40);
    expect(bounds?.y).toBeCloseTo(-40);
  });

  it('hit tests axis-aligned nodes with inclusive edges', () => {
    const node = rect();
    expect(hitTestNode(node, 10, 20)).toBe(true);
    expect(hitTestNode(node, 110, 70)).toBe(true);
    expect(hitTestNode(node, 9.9, 20)).toBe(false);
    expect(hitTestNode(node, 60, 90)).toBe(false);
  });

  it('inverse-rotates the pointer around the node centre', () => {
    const node = rect({ x: 100, y: 100, w: 100, h: 20, rotation: 90 });
    // After a 90 degree rotation the long axis is vertical.
    expect(hitTestNode(node, 150, 140)).toBe(true);
    expect(hitTestNode(node, 150, 60)).toBe(true);
    // These points are inside the unrotated rect but outside once rotated.
    expect(hitTestNode(node, 110, 110)).toBe(false);
    expect(hitTestNode(node, 190, 110)).toBe(false);
  });
});

describe('selection handles', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 50 };

  it('places corner, edge and rotate handles around the bounds', () => {
    const points = handlePoints(bounds);
    expect(points.nw).toEqual({ x: 0, y: 0 });
    expect(points.ne).toEqual({ x: 100, y: 0 });
    expect(points.se).toEqual({ x: 100, y: 50 });
    expect(points.sw).toEqual({ x: 0, y: 50 });
    expect(points.n).toEqual({ x: 50, y: 0 });
    expect(points.e).toEqual({ x: 100, y: 25 });
    expect(points.s).toEqual({ x: 50, y: 50 });
    expect(points.w).toEqual({ x: 0, y: 25 });
    expect(points.rotate).toEqual({ x: 50, y: -ROTATE_HANDLE_OFFSET });
  });

  it('rotates handle positions around the centre', () => {
    const points = handlePoints(bounds, 90);
    expect(points.nw.x).toBeCloseTo(75);
    expect(points.nw.y).toBeCloseTo(-25);
    expect(points.se.x).toBeCloseTo(25);
    expect(points.se.y).toBeCloseTo(75);
  });

  it('finds the nearest handle within the radius only', () => {
    const node = rect({ x: 0, y: 0, w: 100, h: 50 });
    expect(hitTestHandle(node, 1, 1)).toBe('nw');
    expect(hitTestHandle(node, 101, 49)).toBe('se');
    expect(hitTestHandle(node, 50, -ROTATE_HANDLE_OFFSET)).toBe('rotate');
    expect(hitTestHandle(node, 50, 25)).toBeNull();
    expect(hitTestHandle(node, 10, 10, 2)).toBeNull();
  });
});

describe('resizeRect', () => {
  const start = { x: 10, y: 20, w: 100, h: 60 };

  it('resizes from each corner while anchoring the opposite corner', () => {
    expect(resizeRect(start, 'se', 10, 5)).toEqual({ x: 10, y: 20, w: 110, h: 65 });
    expect(resizeRect(start, 'nw', 10, 5)).toEqual({ x: 20, y: 25, w: 90, h: 55 });
    expect(resizeRect(start, 'ne', 10, 5)).toEqual({ x: 10, y: 25, w: 110, h: 55 });
    expect(resizeRect(start, 'sw', 10, 5)).toEqual({ x: 20, y: 20, w: 90, h: 65 });
  });

  it('resizes from each edge', () => {
    expect(resizeRect(start, 'n', 0, -10)).toEqual({ x: 10, y: 10, w: 100, h: 70 });
    expect(resizeRect(start, 's', 0, 10)).toEqual({ x: 10, y: 20, w: 100, h: 70 });
    expect(resizeRect(start, 'e', 20, 0)).toEqual({ x: 10, y: 20, w: 120, h: 60 });
    expect(resizeRect(start, 'w', -20, 0)).toEqual({ x: -10, y: 20, w: 120, h: 60 });
  });

  it('enforces a two pixel minimum size', () => {
    expect(resizeRect(start, 'e', -500, 0)).toEqual({ x: 10, y: 20, w: 2, h: 60 });
    expect(resizeRect(start, 'w', 500, 0)).toEqual({ x: 108, y: 20, w: 2, h: 60 });
    expect(resizeRect(start, 's', 0, -500).h).toBe(2);
  });

  it('preserves aspect ratio when asked', () => {
    const square = { x: 0, y: 0, w: 100, h: 50 };
    expect(resizeRect(square, 'se', 50, 0, true)).toEqual({ x: 0, y: 0, w: 150, h: 75 });
    expect(resizeRect(square, 'nw', 50, 0, true)).toEqual({ x: 50, y: 25, w: 50, h: 25 });
    expect(resizeRect(square, 'rotate', 10, 10)).toEqual(square);
  });
});

describe('snapping', () => {
  it('snaps scalars and points to a grid step', () => {
    expect(snapScalar(13, 10)).toBe(10);
    expect(snapScalar(16, 10)).toBe(20);
    expect(snapScalar(13, 0)).toBe(13);
    expect(snapPoint(13, 27, 5)).toEqual({ x: 15, y: 25 });
  });

  it('only snaps edges that are within the threshold', () => {
    const rect0 = { x: 23, y: 28, w: 104, h: 54 };
    expect(snapNodeRect(rect0, 10, 3)).toEqual({ x: 20, y: 30, w: 110, h: 50 });
    // 23 is 3 from 20 and 28 is 2 from 30; both snap. Far edges are 3 and 4 away.
    expect(snapNodeRect({ x: 24, y: 26, w: 100, h: 50 }, 10, 1)).toEqual({
      x: 24,
      y: 26,
      w: 100,
      h: 50,
    });
    expect(snapNodeRect(rect0, 0, 3)).toEqual(rect0);
  });

  it('clamps rects inside the page', () => {
    expect(clampToPage({ x: -30, y: 900, w: 50, h: 50 }, 200, 1000)).toEqual({
      x: 0,
      y: 900,
      w: 50,
      h: 50,
    });
    expect(clampToPage({ x: 10, y: 10, w: 500, h: 500 }, 200, 100)).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });
});

describe('alignment guides', () => {
  it('snaps a left edge to another left edge and spans both rects', () => {
    const result = alignmentGuides(
      { x: 18, y: 0, w: 10, h: 10 },
      [{ x: 20, y: 50, w: 30, h: 40 }],
      5,
    );
    expect(result.rect).toEqual({ x: 20, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 20, from: 0, to: 90, kind: 'start' },
    ]);
  });

  it('snaps horizontal centres together', () => {
    const result = alignmentGuides(
      { x: 12, y: 0, w: 10, h: 10 },
      [{ x: 0, y: 50, w: 30, h: 10 }],
      5,
    );
    expect(result.rect).toEqual({ x: 10, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 15, from: 0, to: 60, kind: 'center' },
    ]);
  });

  it('snaps right edges together', () => {
    const result = alignmentGuides(
      { x: 48, y: 0, w: 10, h: 10 },
      [{ x: 30, y: 50, w: 30, h: 10 }],
      5,
    );
    expect(result.rect).toEqual({ x: 50, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 60, from: 0, to: 60, kind: 'end' },
    ]);
  });

  it('snaps top edges together', () => {
    const result = alignmentGuides(
      { x: 0, y: 18, w: 10, h: 10 },
      [{ x: 50, y: 20, w: 10, h: 30 }],
      5,
    );
    expect(result.rect).toEqual({ x: 0, y: 20, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'y', position: 20, from: 0, to: 60, kind: 'start' },
    ]);
  });

  it('snaps vertical middles together', () => {
    const result = alignmentGuides(
      { x: 0, y: 12, w: 10, h: 8 },
      [{ x: 50, y: 0, w: 10, h: 30 }],
      5,
    );
    expect(result.rect).toEqual({ x: 0, y: 11, w: 10, h: 8 });
    expect(result.guides).toEqual([
      { axis: 'y', position: 15, from: 0, to: 60, kind: 'center' },
    ]);
  });

  it('snaps bottom edges together', () => {
    const result = alignmentGuides(
      { x: 0, y: 88, w: 10, h: 10 },
      [{ x: 50, y: 0, w: 10, h: 100 }],
      5,
    );
    expect(result.rect).toEqual({ x: 0, y: 90, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'y', position: 100, from: 0, to: 60, kind: 'end' },
    ]);
  });

  it('chooses the nearest candidate when several are in range', () => {
    const result = alignmentGuides(
      { x: 10, y: 0, w: 10, h: 10 },
      [
        { x: 7, y: 100, w: 60, h: 10 },
        { x: 5, y: 200, w: 60, h: 10 },
      ],
      6,
    );
    expect(result.rect).toEqual({ x: 7, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 7, from: 0, to: 110, kind: 'start' },
    ]);
  });

  it('leaves the rect untouched outside the threshold', () => {
    const moving = { x: 10, y: 0, w: 10, h: 10 };
    const result = alignmentGuides(moving, [{ x: 30, y: 50, w: 30, h: 10 }], 5);
    expect(result.rect).toEqual(moving);
    expect(result.guides).toEqual([]);
  });

  it('returns guides on both axes when both snap', () => {
    const result = alignmentGuides(
      { x: 18, y: 18, w: 10, h: 10 },
      [{ x: 20, y: 20, w: 30, h: 40 }],
      5,
    );
    expect(result.rect).toEqual({ x: 20, y: 20, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 20, from: 20, to: 60, kind: 'start' },
      { axis: 'y', position: 20, from: 20, to: 50, kind: 'start' },
    ]);
  });

  it('merges duplicate positions into one guide with a union extent', () => {
    const result = alignmentGuides(
      { x: 18, y: 0, w: 10, h: 10 },
      [
        { x: 20, y: 20, w: 30, h: 10 },
        { x: 20, y: 50, w: 30, h: 10 },
      ],
      5,
    );
    expect(result.rect).toEqual({ x: 20, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 20, from: 0, to: 60, kind: 'start' },
    ]);
  });

  it('reports several aligned edges on the same axis', () => {
    const result = alignmentGuides(
      { x: 10, y: 0, w: 10, h: 10 },
      [
        { x: 10, y: 50, w: 30, h: 10 },
        { x: 0, y: 100, w: 20, h: 10 },
      ],
      5,
    );
    expect(result.rect).toEqual({ x: 10, y: 0, w: 10, h: 10 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 10, from: 0, to: 110, kind: 'start' },
      { axis: 'x', position: 20, from: 0, to: 110, kind: 'end' },
    ]);
  });

  it('never treats the moving rect itself as a target', () => {
    const moving = { x: 10, y: 10, w: 10, h: 10 };
    const result = alignmentGuides(moving, [moving], 10);
    expect(result.rect).toEqual(moving);
    expect(result.guides).toEqual([]);
  });
});

describe('alignment and distribution', () => {
  const items = [
    { id: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'b', rect: { x: 50, y: 20, w: 20, h: 30 } },
  ];

  it('aligns left, right and horizontal centres', () => {
    expect(alignRects(items, 'left')).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 20 } });
    expect(alignRects(items, 'right')).toEqual({ a: { x: 60, y: 0 }, b: { x: 50, y: 20 } });
    expect(alignRects(items, 'hcenter')).toEqual({ a: { x: 30, y: 0 }, b: { x: 25, y: 20 } });
  });

  it('aligns top, bottom and vertical centres', () => {
    expect(alignRects(items, 'top')).toEqual({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } });
    expect(alignRects(items, 'bottom')).toEqual({ a: { x: 0, y: 40 }, b: { x: 50, y: 20 } });
    expect(alignRects(items, 'vcenter')).toEqual({ a: { x: 0, y: 20 }, b: { x: 50, y: 10 } });
    expect(alignRects([], 'left')).toEqual({});
  });

  it('distributes equal gaps and keeps the ends fixed', () => {
    const row = [
      { id: 'a', rect: { x: 0, y: 0, w: 10, h: 5 } },
      { id: 'b', rect: { x: 30, y: 0, w: 20, h: 5 } },
      { id: 'c', rect: { x: 100, y: 0, w: 10, h: 5 } },
    ];
    expect(distributeRects(row, 'x')).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 45, y: 0 },
      c: { x: 100, y: 0 },
    });

    const column = [
      { id: 'a', rect: { x: 0, y: 0, w: 5, h: 10 } },
      { id: 'b', rect: { x: 0, y: 40, w: 5, h: 20 } },
      { id: 'c', rect: { x: 0, y: 120, w: 5, h: 10 } },
    ];
    expect(distributeRects(column, 'y')).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 0, y: 55 },
      c: { x: 0, y: 120 },
    });
    expect(distributeRects(row, 'x')).not.toEqual({});
    expect(distributeRects(row.slice(0, 2), 'x')).toEqual({});
  });
});

describe('selection operations', () => {
  const nodes: FigureNode[] = [
    rect({ id: 'a', groupId: 'g1' }),
    rect({ id: 'b', groupId: 'g1' }),
    rect({ id: 'c', locked: true }),
    rect({ id: 'd', hidden: true }),
    rect({ id: 'e' }),
  ];

  it('expands groups and skips locked or hidden nodes', () => {
    const moved = moveNodes(nodes, ['a', 'c', 'd'], 5, -3);
    expect(moved.find((node) => node.id === 'a')?.x).toBe(15);
    expect(moved.find((node) => node.id === 'b')?.x).toBe(15);
    expect(moved.find((node) => node.id === 'c')?.x).toBe(10);
    expect(moved.find((node) => node.id === 'd')?.x).toBe(10);
    expect(moved.find((node) => node.id === 'e')?.x).toBe(10);
    expect(moved.find((node) => node.id === 'a')?.y).toBe(17);
  });

  it('groups and ungroups nodes immutably', () => {
    const grouped = groupSelection(nodes, ['c', 'e'], 'g2');
    expect(nodes.find((node) => node.id === 'c')?.groupId).toBeUndefined();
    expect(grouped.find((node) => node.id === 'c')?.groupId).toBe('g2');
    expect(grouped.find((node) => node.id === 'e')?.groupId).toBe('g2');

    const ungrouped = ungroupSelection(nodes, 'g1');
    expect(ungrouped.find((node) => node.id === 'a')?.groupId).toBeUndefined();
    expect(ungrouped.find((node) => node.id === 'b')?.groupId).toBeUndefined();
    expect(ungrouped.find((node) => node.id === 'e')?.groupId).toBeUndefined();
    expect(nodes.find((node) => node.id === 'a')?.groupId).toBe('g1');
  });

  it('leaves nodes untouched for a zero or invalid move', () => {
    const same = moveNodes(nodes, ['a'], 0, 0);
    expect(same).not.toBe(nodes);
    expect(same[0]).toBe(nodes[0]);
  });
});

describe('viewport and image fitting', () => {
  it('fits a page into the viewport with padding', () => {
    const fit = zoomToFit(1000, 500, 800, 600, 0);
    expect(fit.scale).toBeCloseTo(0.8);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo(100);

    const padded = zoomToFit(1000, 500, 800, 600, 32);
    expect(padded.scale).toBeCloseTo(0.736);
    expect(padded.offsetX).toBeCloseTo(32);
    expect(padded.offsetY).toBeCloseTo(116);
  });

  it('clamps the zoom scale to a usable range', () => {
    expect(zoomToFit(1_000_000, 1_000_000, 100, 100, 0).scale).toBe(0.05);
    expect(zoomToFit(1, 1, 10_000, 10_000, 0).scale).toBe(8);
  });

  it('fits images with contain, cover and stretch', () => {
    expect(imageNaturalRect(200, 100, 100, 100, 'contain')).toEqual({
      x: 50,
      y: 0,
      w: 100,
      h: 100,
    });
    expect(imageNaturalRect(200, 100, 100, 100, 'cover')).toEqual({
      x: 0,
      y: -50,
      w: 200,
      h: 200,
    });
    expect(imageNaturalRect(200, 100, 100, 100, 'stretch')).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    expect(imageNaturalRect(200, 100, 0, 100, 'contain')).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  it('handles non-rect nodes through the shared bounds helper', () => {
    const ellipse = createEllipseNode(30, 30, 40, 20);
    const bounds = nodesBounds([ellipse]);
    expect(bounds).toEqual({ x: 30, y: 30, w: 40, h: 20 });
    expect(hitTestNode(ellipse, 50, 40)).toBe(true);
  });
});
