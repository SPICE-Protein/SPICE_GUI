import { describe, expect, it } from 'vitest';
import { pathNodePoints, renderPathNode } from '$lib/tools/figure/paths';
import { createFigureDocument, createPathNode } from '$lib/tools/figure/types';
import { normalizeFigureDocument } from '$lib/tools/figure/normalize';
import { renderSvg } from '$lib/tools/figure/render';

describe('path nodes', () => {
  it('maps normalised points into node bounds', () => {
    const node = createPathNode(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.25 },
        { x: 1, y: 1 },
      ],
      10,
      20,
      100,
      80,
    );
    expect(pathNodePoints(node)).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 40 },
      { x: 110, y: 100 },
    ]);
  });

  it('renders an open polyline with end arrow and escapes stroke colours', () => {
    const node = createPathNode(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0.5 },
      ],
      0,
      0,
      100,
      50,
    );
    node.stroke = '#123456';
    node.headEnd = true;
    const svg = renderPathNode(node);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('<polygon');
  });

  it('renders closed polygons with fill and no default arrow', () => {
    const node = createPathNode(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
      0,
      0,
      100,
      100,
      true,
    );
    node.fill = '#ffeeaa';
    const svg = renderPathNode(node);
    expect(svg).toContain('<polygon');
    expect(svg).toContain('fill="#ffeeaa"');
    expect(svg).not.toContain('<polyline');
  });

  it('renders inside a document and survives normalisation', () => {
    const doc = createFigureDocument('Path', 100, 100);
    const path = createPathNode(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      5,
      5,
      80,
      60,
    );
    doc.nodes = [path];
    expect(renderSvg(doc)).toContain('data-node-type="path"');

    const normalized = normalizeFigureDocument(JSON.parse(JSON.stringify(doc)));
    expect(normalized?.nodes[0].type).toBe('path');
  });

  it('rejects malformed path payloads during normalisation', () => {
    const doc = createFigureDocument('Bad', 100, 100) as unknown as Record<string, unknown>;
    doc.nodes = [
      { id: 'p1', type: 'path', points: [{ x: 0, y: 0 }] },
      { id: 'p2', type: 'path', points: 'nope' },
    ];
    const normalized = normalizeFigureDocument(doc);
    expect(normalized?.nodes).toEqual([]);
  });
});
