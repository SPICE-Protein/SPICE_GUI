// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  importSvgMarkup,
  placeVectorImport,
  type VectorImportResult,
} from '$lib/tools/figure/importVector';
import { createTextNode, type PathNode, type TextNode } from '$lib/tools/figure/types';

function markup(body: string, viewBox = '0 0 200 100'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}

describe('importSvgMarkup primitives', () => {
  it('converts a rect, preserves paint and normalises the origin', async () => {
    const result = await importSvgMarkup(
      markup('<rect x="10" y="20" width="30" height="40" fill="#ff0000" stroke="#00ff00" stroke-width="2"/>'),
    );

    expect(result.warnings).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.width).toBeCloseTo(30);
    expect(result.height).toBeCloseTo(40);

    const node = result.nodes[0];
    expect(node.type).toBe('rect');
    expect(node.x).toBeCloseTo(0);
    expect(node.y).toBeCloseTo(0);
    expect(node.w).toBeCloseTo(30);
    expect(node.h).toBeCloseTo(40);
    expect(node.fill).toBe('#ff0000');
    expect(node.stroke).toBe('#00ff00');
    expect(node.strokeWidth).toBeCloseTo(2);
    expect(node.rotation).toBeCloseTo(0);
  });

  it('converts circles and ellipses to ellipse nodes', async () => {
    const result = await importSvgMarkup(
      markup('<ellipse cx="100" cy="50" rx="20" ry="10" fill="#123456"/>'),
    );

    const node = result.nodes[0];
    expect(node.type).toBe('ellipse');
    expect(node.x).toBeCloseTo(0);
    expect(node.y).toBeCloseTo(0);
    expect(node.w).toBeCloseTo(40);
    expect(node.h).toBeCloseTo(20);
    expect(node.fill).toBe('#123456');
    expect(result.width).toBeCloseTo(40);
    expect(result.height).toBeCloseTo(20);
  });

  it('converts text with font, weight, alignment and colour', async () => {
    const result = await importSvgMarkup(
      markup(
        '<text x="10" y="40" font-size="16" font-family="Arial" font-weight="bold" font-style="italic" fill="#112233" text-anchor="middle">Hello</text>',
      ),
    );

    const node = result.nodes[0] as TextNode;
    expect(node.type).toBe('text');
    expect(node.text).toBe('Hello');
    // 16 px at 96 dpi -> 12 pt.
    expect(node.fontSize).toBeCloseTo(12);
    expect(node.fontFamily).toBe('Arial');
    expect(node.fontWeight).toBe(700);
    expect(node.italic).toBe(true);
    expect(node.align).toBe('center');
    expect(node.color).toBe('#112233');
    expect(node.strokeWidth).toBe(0);
  });

  it('joins tspan lines with newlines', async () => {
    const result = await importSvgMarkup(
      markup('<text x="0" y="10"><tspan x="0" y="10">Line one</tspan><tspan x="0" y="24">Line two</tspan></text>'),
    );

    const node = result.nodes[0] as TextNode;
    expect(node.text).toBe('Line one\nLine two');
    expect(node.align).toBe('left');
  });

  it('flattens a closed path and keeps the polygon closed', async () => {
    const result = await importSvgMarkup(
      markup('<path d="M0 0 L10 0 L10 10 Z" fill="#abcdef" stroke="none"/>'),
    );

    const node = result.nodes[0] as PathNode;
    expect(node.type).toBe('path');
    expect(node.closed).toBe(true);
    expect(node.fill).toBe('#abcdef');
    expect(node.stroke).toBe('none');
    expect(node.headEnd).toBe(false);
    expect(node.points.length).toBeGreaterThanOrEqual(4);
    expect(node.points.length).toBeLessThanOrEqual(200);
    expect(node.points[0].x).toBeCloseTo(0);
    expect(node.points[0].y).toBeCloseTo(0);
    expect(node.w).toBeCloseTo(10);
    expect(node.h).toBeCloseTo(10);
  });

  it('maps marker-end to a path arrow head', async () => {
    const result = await importSvgMarkup(
      markup(
        '<path d="M0 0 L20 0" fill="none" stroke="#000000" stroke-width="2" marker-end="url(#arrow)"/>',
      ),
    );

    const node = result.nodes[0] as PathNode;
    expect(node.headEnd).toBe(true);
    expect(node.headStart).toBe(false);
    expect(node.headSize).toBeGreaterThan(0);
  });

  it('keeps polyline and line geometry', async () => {
    const result = await importSvgMarkup(
      markup(
        '<polyline points="0,0 20,0 20,10" fill="none" stroke="#000000"/><line x1="0" y1="20" x2="20" y2="20" stroke="#333333"/>',
      ),
    );

    expect(result.nodes).toHaveLength(2);
    const [polyline, line] = result.nodes as PathNode[];
    expect(polyline.closed).toBe(false);
    expect(polyline.points).toHaveLength(3);
    expect(line.closed).toBe(false);
    expect(line.points).toHaveLength(2);
  });
});

describe('transforms and groups', () => {
  it('applies translate and scale from ancestor groups', async () => {
    const result = await importSvgMarkup(
      markup(
        '<g transform="translate(100 50) scale(2)"><rect x="0" y="0" width="10" height="5" fill="#eeeeee"/></g>',
      ),
    );

    const node = result.nodes[0];
    expect(node.w).toBeCloseTo(20);
    expect(node.h).toBeCloseTo(10);
    expect(node.x).toBeCloseTo(0);
    expect(node.y).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(20);
    expect(result.height).toBeCloseTo(10);
  });

  it('decomposes rotation and keeps non-rotated local dimensions', async () => {
    const result = await importSvgMarkup(
      markup('<rect x="0" y="0" width="20" height="10" transform="rotate(90 5 5)" fill="#eeeeee"/>'),
    );

    const node = result.nodes[0];
    expect(node.rotation).toBeCloseTo(90, 4);
    expect(node.w).toBeCloseTo(20);
    expect(node.h).toBeCloseTo(10);
    // The rotated 20x10 rect occupies a 10x20 axis-aligned box.
    expect(result.width).toBeCloseTo(10);
    expect(result.height).toBeCloseTo(20);
  });

  it('groups a Mermaid node shape and label under one group', async () => {
    const result = await importSvgMarkup(
      markup(`
        <g class="node default" id="flowchart-A-0" transform="translate(20 10)">
          <rect x="0" y="0" width="40" height="20" fill="#eeeeee" stroke="#333333"/>
          <g class="label"><text x="20" y="15" text-anchor="middle" fill="#111111">Sample</text></g>
        </g>
      `),
    );

    expect(result.nodes).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group.name).toBe('Sample');
    expect(result.nodes[0].groupId).toBe(group.id);
    expect(result.nodes[1].groupId).toBe(group.id);
    expect(result.nodes[0].type).toBe('rect');
    expect(result.nodes[1].type).toBe('text');
  });

  it('drops empty groups but keeps groups that have members', async () => {
    const result = await importSvgMarkup(
      markup(`
        <g id="empty"></g>
        <g id="kept"><rect x="0" y="0" width="10" height="10" fill="#000000"/></g>
      `),
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('kept');
    expect(result.nodes[0].groupId).toBe(result.groups[0].id);
  });
});

describe('style resolution', () => {
  it('reads inline CSS colours and converts rgb() to hex', async () => {
    const result = await importSvgMarkup(
      markup(
        '<rect x="0" y="0" width="10" height="10" style="fill: rgb(255, 0, 0); stroke: rgb(0, 128, 0); stroke-width: 3"/>',
      ),
    );

    const node = result.nodes[0];
    expect(node.fill).toBe('#ff0000');
    expect(node.stroke).toBe('#008000');
    expect(node.strokeWidth).toBeCloseTo(3);
  });

  it('resolves gradients to their first stop colour', async () => {
    const result = await importSvgMarkup(
      markup(`
        <defs>
          <linearGradient id="grad">
            <stop offset="0" stop-color="#123456"/>
            <stop offset="1" stop-color="#654321"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="10" height="10" fill="url(#grad)"/>
      `),
    );

    expect(result.nodes[0].fill).toBe('#123456');
    expect(result.warnings).toEqual([]);
  });

  it('inherits paint from ancestor groups', async () => {
    const result = await importSvgMarkup(
      markup('<g fill="#ff00ff"><rect x="0" y="0" width="10" height="10"/></g>'),
    );

    expect(result.nodes[0].fill).toBe('#ff00ff');
  });

  it('multiplies group opacity into nodes', async () => {
    const result = await importSvgMarkup(
      markup('<g opacity="0.5"><rect x="0" y="0" width="10" height="10" opacity="0.5" fill="#000000"/></g>'),
    );

    expect(result.nodes[0].opacity).toBeCloseTo(0.25);
  });

  it('maps stroke-dasharray onto the dash style', async () => {
    const result = await importSvgMarkup(
      markup(
        '<rect x="0" y="0" width="10" height="10" stroke="#000000" stroke-width="1" stroke-dasharray="6 3"/><rect x="20" y="0" width="10" height="10" stroke="#000000" stroke-width="1" stroke-dasharray="1 1"/>',
      ),
    );

    expect(result.nodes[0].dash).toBe('dashed');
    expect(result.nodes[1].dash).toBe('dotted');
  });
});

describe('warnings and malformed input', () => {
  it('warns once for unsupported elements that have no editable equivalent', async () => {
    const result = await importSvgMarkup(
      markup(
        '<use href="#shape"/><foreignObject width="10" height="10"/><rect x="0" y="0" width="10" height="10" fill="#000000"/>',
      ),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some((warning) => warning.includes('<use>'))).toBe(true);
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('foreignobject'))).toBe(
      true,
    );
  });

  it('warns about images that are not embedded data URLs', async () => {
    const result = await importSvgMarkup(
      markup(
        '<image x="0" y="0" width="10" height="10" href="photo.png"/><rect x="0" y="0" width="10" height="10" fill="#000000"/>',
      ),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('data:'))).toBe(true);
  });

  it('rejects empty, non-SVG and malformed input', async () => {
    await expect(importSvgMarkup('')).rejects.toThrow(/empty/i);
    await expect(importSvgMarkup('   ')).rejects.toThrow(/empty/i);
    await expect(importSvgMarkup('not svg at all')).rejects.toThrow(/parse/i);
    await expect(importSvgMarkup('<div>hello</div>')).rejects.toThrow(/not an SVG/i);
    await expect(
      importSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'),
    ).rejects.toThrow(/parse/i);
  });

  it('rejects SVGs with no supported drawables', async () => {
    await expect(
      importSvgMarkup(markup('<defs><rect x="0" y="0" width="10" height="10"/></defs>')),
    ).rejects.toThrow(/No supported vector elements/i);
  });
});

describe('placeVectorImport', () => {
  it('uniformly scales, centres and scales strokes', async () => {
    const result = await importSvgMarkup(
      markup('<rect x="10" y="10" width="100" height="50" fill="#000000" stroke="#111111" stroke-width="2"/>'),
    );
    const placed = placeVectorImport(result, 1000, 500, 0.1);

    // 100x50 source inside a 800x400 safe area -> scale 8, centred.
    expect(placed.nodes).toHaveLength(1);
    const node = placed.nodes[0];
    expect(node.x).toBeCloseTo(100);
    expect(node.y).toBeCloseTo(50);
    expect(node.w).toBeCloseTo(800);
    expect(node.h).toBeCloseTo(400);
    expect(node.strokeWidth).toBeCloseTo(16);
  });

  it('scales font size and padding with the geometry', () => {
    const text = createTextNode(0, 0, 'Hi');
    text.w = 100;
    text.h = 50;
    text.fontSize = 12;
    text.padding = 4;
    text.strokeWidth = 2;
    const result: VectorImportResult = {
      nodes: [text],
      groups: [],
      width: 100,
      height: 50,
      warnings: [],
    };

    const placed = placeVectorImport(result, 200, 100, 0);
    const node = placed.nodes[0] as TextNode;
    expect(node.x).toBeCloseTo(0);
    expect(node.y).toBeCloseTo(0);
    expect(node.w).toBeCloseTo(200);
    expect(node.h).toBeCloseTo(100);
    expect(node.fontSize).toBeCloseTo(24);
    expect(node.padding).toBeCloseTo(8);
    expect(node.strokeWidth).toBeCloseTo(4);
  });

  it('centres a square import on a wide page', async () => {
    const result = await importSvgMarkup(
      markup('<rect x="0" y="0" width="100" height="100" fill="#000000"/>'),
    );
    const placed = placeVectorImport(result, 400, 200, 0);

    expect(placed.nodes[0].w).toBeCloseTo(200);
    expect(placed.nodes[0].h).toBeCloseTo(200);
    expect(placed.nodes[0].x).toBeCloseTo(100);
    expect(placed.nodes[0].y).toBeCloseTo(0);
  });
});
