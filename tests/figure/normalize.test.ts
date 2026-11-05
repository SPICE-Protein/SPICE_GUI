import { describe, expect, it } from 'vitest';
import {
  figureDocumentJson,
  normalizeFigureDocument,
  parseFigureDocumentText,
} from '$lib/tools/figure/normalize';
import {
  FIGURE_FORMAT,
  FIGURE_VERSION,
  createFigureDocument,
  type FigureDocument,
} from '$lib/tools/figure/types';

function baseDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createFigureDocument('Test', 180, 120))) as Record<string, unknown>;
}

function withNodes(nodes: unknown[], groups: unknown[] = []): Record<string, unknown> {
  return { ...baseDocument(), nodes, groups };
}

function rect(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'n1', type: 'rect', x: 10, y: 20, w: 100, h: 50, ...overrides };
}

function chartNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chart1',
    type: 'chart',
    chartType: 'bar',
    labels: ['Control', 'Treatment'],
    series: [
      { id: 's1', name: 'Signal', color: '#123456', values: [1, 2], errors: [0.1, 0.2] },
    ],
    significance: [{ id: 'sig1', from: 0, to: 1, label: '*' }],
    yMin: null,
    yMax: null,
    ...overrides,
  };
}

function normalize(value: unknown): FigureDocument {
  const doc = normalizeFigureDocument(value);
  expect(doc).not.toBeNull();
  return doc as FigureDocument;
}

describe('normalizeFigureDocument envelope', () => {
  it('rejects non-objects, wrong formats and unsupported versions', () => {
    expect(normalizeFigureDocument(null)).toBeNull();
    expect(normalizeFigureDocument('SPICE_FIGURE')).toBeNull();
    expect(normalizeFigureDocument([])).toBeNull();
    expect(normalizeFigureDocument({ ...baseDocument(), format: 'OTHER' })).toBeNull();
    expect(normalizeFigureDocument({ ...baseDocument(), version: 2 })).toBeNull();
  });

  it('requires finite page dimensions and node/group arrays', () => {
    expect(normalizeFigureDocument({ ...baseDocument(), widthMm: '180' })).toBeNull();
    expect(normalizeFigureDocument({ ...baseDocument(), heightMm: Number.NaN })).toBeNull();
    expect(normalizeFigureDocument({ ...baseDocument(), nodes: undefined })).toBeNull();
    expect(normalizeFigureDocument({ ...baseDocument(), groups: null })).toBeNull();
  });

  it('clamps page dimensions into the printable range', () => {
    const small = normalize({ ...baseDocument(), widthMm: 2, heightMm: 5000 });
    expect(small.widthMm).toBe(10);
    expect(small.heightMm).toBe(2000);
    const ok = normalize(baseDocument());
    expect(ok.widthMm).toBe(180);
    expect(ok.heightMm).toBe(120);
  });

  it('fills optional document fields with defaults', () => {
    const raw = baseDocument();
    delete raw.name;
    delete raw.background;
    delete raw.grid;
    const doc = normalize(raw);
    expect(doc.name).toBe('Figure');
    expect(doc.background).toBe('#ffffff');
    expect(doc.grid).toEqual({ show: true, snap: true, sizeMm: 2 });
    expect(doc.format).toBe(FIGURE_FORMAT);
    expect(doc.version).toBe(FIGURE_VERSION);
  });

  it('sanitises grid settings', () => {
    const doc = normalize({ ...baseDocument(), grid: { show: false, snap: 'yes', sizeMm: 999 } });
    expect(doc.grid.show).toBe(false);
    expect(doc.grid.snap).toBe(true);
    expect(doc.grid.sizeMm).toBe(50);
  });
});

describe('normalizeFigureDocument nodes', () => {
  it('clamps geometry, rotation, opacity and stroke values', () => {
    const doc = normalize(
      withNodes([
        rect({
          x: -40,
          y: -10,
          w: 0.2,
          h: -30,
          rotation: 720,
          opacity: 3,
          strokeWidth: 100,
          cornerRadius: 999,
          dash: 'wavy',
        }),
      ]),
    );
    const node = doc.nodes[0];
    expect(node.x).toBe(-40);
    expect(node.y).toBe(-10);
    expect(node.w).toBe(1);
    expect(node.h).toBe(1);
    expect(node.rotation).toBe(360);
    expect(node.opacity).toBe(1);
    expect(node.strokeWidth).toBe(40);
    expect(node.cornerRadius).toBe(200);
    expect(node.dash).toBe('solid');
  });

  it('normalises text typography and drops text without a string body', () => {
    const doc = normalize(
      withNodes([
        {
          id: 't1',
          type: 'text',
          text: 'Hello',
          fontSize: 999,
          lineHeight: 0.1,
          padding: 500,
          fontWeight: 900,
          align: 'justify',
          color: 12,
        },
        { id: 't2', type: 'text', text: 42 },
      ]),
    );
    expect(doc.nodes).toHaveLength(1);
    const node = doc.nodes[0];
    expect(node.type).toBe('text');
    if (node.type !== 'text') return;
    expect(node.fontSize).toBe(300);
    expect(node.lineHeight).toBe(0.8);
    expect(node.padding).toBe(80);
    expect(node.fontWeight).toBe(400);
    expect(node.align).toBe('left');
    expect(node.color).toBe('#111827');
    expect(node.fontFamily).toBe('Arial');
  });

  it('drops unknown node types, missing ids and duplicate ids', () => {
    const doc = normalize(
      withNodes([
        rect({ id: 'a' }),
        rect({ id: 'a', x: 999 }),
        rect({ id: '' }),
        rect({ type: 'triangle' }),
        'not a node',
        rect({ id: 'b' }),
      ]),
    );
    expect(doc.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(doc.nodes[0].x).toBe(10);
  });

  it('accepts line/arrow nodes and repairs invalid directions', () => {
    const doc = normalize(
      withNodes([
        { id: 'l1', type: 'line', direction: 'sideways', headEnd: true },
        { id: 'a1', type: 'arrow', direction: 'vertical', headSize: 500 },
      ]),
    );
    expect(doc.nodes).toHaveLength(2);
    const line = doc.nodes[0];
    const arrow = doc.nodes[1];
    expect(line.type).toBe('line');
    expect(arrow.type).toBe('arrow');
    if (line.type !== 'line' || arrow.type !== 'arrow') return;
    expect(line.direction).toBe('diagonal');
    expect(line.headEnd).toBe(true);
    expect(arrow.direction).toBe('vertical');
    expect(arrow.headEnd).toBe(true);
    expect(arrow.headSize).toBe(200);
  });

  it('requires asset identity and a bundled svg path', () => {
    const doc = normalize(
      withNodes([
        { id: 'good', type: 'asset', assetId: 'dna', svgFile: 'assets/dna.svg' },
        { id: 'no-file', type: 'asset', assetId: 'dna' },
        { id: 'no-id', type: 'asset', svgFile: 'assets/dna.svg' },
      ]),
    );
    expect(doc.nodes.map((node) => node.id)).toEqual(['good']);
    const node = doc.nodes[0];
    expect(node.type).toBe('asset');
    if (node.type !== 'asset') return;
    expect(node.assetId).toBe('dna');
    expect(node.svgFile).toBe('assets/dna.svg');
    expect(node.flipX).toBe(false);
  });

  it('requires an image data url and defaults its fit mode', () => {
    const doc = normalize(
      withNodes([
        { id: 'img', type: 'image', dataUrl: 'data:image/png;base64,AAAA', fit: 'squish' },
        { id: 'bad', type: 'image', dataUrl: 'https://example.test/a.png' },
      ]),
    );
    expect(doc.nodes.map((node) => node.id)).toEqual(['img']);
    const node = doc.nodes[0];
    expect(node.type).toBe('image');
    if (node.type !== 'image') return;
    expect(node.dataUrl.startsWith('data:image/')).toBe(true);
    expect(node.fit).toBe('contain');
    expect(node.mime).toBe('image/png');
  });

  it('keeps any CSS colour string but replaces non-strings', () => {
    const doc = normalize(
      withNodes([
        rect({ fill: 'color(display-p3 1 0.5 0)', stroke: 7 }),
        rect({ id: 'n2', fill: '', stroke: 'none' }),
      ]),
    );
    expect(doc.nodes[0].fill).toBe('color(display-p3 1 0.5 0)');
    expect(doc.nodes[0].stroke).toBe('#1f6f8b');
    expect(doc.nodes[1].fill).toBe('#e8f1f8');
    expect(doc.nodes[1].stroke).toBe('none');
  });
});

describe('normalizeFigureDocument groups', () => {
  it('deduplicates group ids and drops references to missing groups', () => {
    const doc = normalize(
      withNodes(
        [
          rect({ id: 'a', groupId: 'g1' }),
          rect({ id: 'b', groupId: 'ghost' }),
          rect({ id: 'c', groupId: 42 }),
        ],
        [
          { id: 'g1', name: 'Panel', locked: true },
          { id: 'g1', name: 'Duplicate' },
          { id: '', name: 'Invalid' },
        ],
      ),
    );
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0]).toEqual({ id: 'g1', name: 'Panel', hidden: false, locked: true });
    expect(doc.nodes.find((node) => node.id === 'a')?.groupId).toBe('g1');
    expect(doc.nodes.find((node) => node.id === 'b')?.groupId).toBeUndefined();
    expect(doc.nodes.find((node) => node.id === 'c')?.groupId).toBeUndefined();
  });
});

describe('normalizeFigureDocument charts', () => {
  it('round-trips chart type, labels, series, significance and bounds', () => {
    const doc = normalize(
      withNodes([
        chartNode({
          chartType: 'line',
          labels: ['A', 'B', 'C'],
          series: [
            { id: 's1', name: 'S1', color: '#111111', values: [1, 2, 3], errors: [0.1, 0.2, 0.3] },
            { id: 's2', name: 'S2', values: ['x', 4, null], errors: [-0.5, 0, 1] },
          ],
          significance: [{ id: 'g1', from: 2, to: 0, label: '**' }],
          yMin: -1.5,
          yMax: 10,
        }),
      ]),
    );
    const node = doc.nodes[0];
    expect(node.type).toBe('chart');
    if (node.type !== 'chart') return;
    expect(node.chartType).toBe('line');
    expect(node.labels).toEqual(['A', 'B', 'C']);
    expect(node.series).toHaveLength(2);
    expect(node.series[0]).toMatchObject({
      id: 's1',
      name: 'S1',
      color: '#111111',
      values: [1, 2, 3],
      errors: [0.1, 0.2, 0.3],
    });
    // Non-numeric values become 0 and error magnitudes are absolute.
    expect(node.series[1].values).toEqual([0, 4, 0]);
    expect(node.series[1].errors).toEqual([0.5, 0, 1]);
    // from/to are ordered min/max.
    expect(node.significance).toEqual([{ id: 'g1', from: 0, to: 2, label: '**' }]);
    expect(node.yMin).toBe(-1.5);
    expect(node.yMax).toBe(10);
  });

  it('defaults omitted chart fields safely', () => {
    const doc = normalize(withNodes([{ id: 'c2', type: 'chart' }]));
    const node = doc.nodes[0];
    expect(node.type).toBe('chart');
    if (node.type !== 'chart') return;
    expect(node.chartType).toBe('bar');
    expect(node.labels).toEqual([]);
    expect(node.series).toEqual([]);
    expect(node.significance).toEqual([]);
    expect(node.yMin).toBeNull();
    expect(node.yMax).toBeNull();
    expect(node.fontSize).toBe(10);
  });

  it('clamps and drops malformed chart fields', () => {
    const doc = normalize(
      withNodes([
        chartNode({
          id: 'bad-chart',
          chartType: 'pie',
          labels: ['A', 'B', 'C'],
          series: 'not an array',
          significance: [
            { id: 'keep', from: -4, to: 99, label: 'x' },
            { id: 'drop', from: 1, to: 1 },
            'bad',
          ],
          fontSize: 1000,
        }),
        chartNode({ id: 'small-chart', chartType: 'scatter', fontSize: 1 }),
      ]),
    );
    expect(doc.nodes).toHaveLength(2);

    const bad = doc.nodes[0];
    expect(bad.type).toBe('chart');
    if (bad.type !== 'chart') return;
    expect(bad.chartType).toBe('bar');
    expect(bad.series).toEqual([]);
    expect(bad.significance).toEqual([{ id: 'keep', from: 0, to: 2, label: 'x' }]);
    expect(bad.fontSize).toBe(72);

    const small = doc.nodes[1];
    expect(small.type).toBe('chart');
    if (small.type !== 'chart') return;
    expect(small.chartType).toBe('scatter');
    expect(small.fontSize).toBe(5);
  });
});

describe('normalizeFigureDocument scale bars', () => {
  it('normalises thickness, font size and tick flags', () => {
    const doc = normalize(
      withNodes([
        { id: 'sb1', type: 'scalebar', thickness: 100, fontSize: 0.5, ticks: 'yes' },
        { id: 'sb2', type: 'scalebar', thickness: 0.1, fontSize: 200, ticks: false },
      ]),
    );
    expect(doc.nodes).toHaveLength(2);

    const first = doc.nodes[0];
    expect(first.type).toBe('scalebar');
    if (first.type !== 'scalebar') return;
    expect(first.thickness).toBe(40);
    expect(first.fontSize).toBe(5);
    expect(first.ticks).toBe(true);

    const second = doc.nodes[1];
    expect(second.type).toBe('scalebar');
    if (second.type !== 'scalebar') return;
    expect(second.thickness).toBe(0.5);
    expect(second.fontSize).toBe(72);
    expect(second.ticks).toBe(false);
  });
});

describe('normalizeFigureDocument image crops', () => {
  it('clamps crops into 0..1 and drops legacy images without one', () => {
    const doc = normalize(
      withNodes([
        {
          id: 'img1',
          type: 'image',
          dataUrl: 'data:image/png;base64,AAAA',
          crop: { x: -2, y: 5, w: 5, h: 0 },
          lockAspect: true,
        },
        { id: 'img2', type: 'image', dataUrl: 'data:image/png;base64,BBBB' },
        {
          id: 'img3',
          type: 'image',
          dataUrl: 'data:image/png;base64,CCCC',
          crop: 'not a crop',
        },
      ]),
    );
    expect(doc.nodes).toHaveLength(3);

    const cropped = doc.nodes[0];
    expect(cropped.type).toBe('image');
    if (cropped.type !== 'image') return;
    expect(cropped.crop).toEqual({ x: 0, y: 0.99, w: 1, h: 0.01 });
    expect(cropped.lockAspect).toBe(true);

    const legacy = doc.nodes[1];
    expect(legacy.type).toBe('image');
    if (legacy.type !== 'image') return;
    expect(legacy.crop).toBeUndefined();
    expect(legacy.lockAspect).toBe(false);

    const malformed = doc.nodes[2];
    expect(malformed.type).toBe('image');
    if (malformed.type !== 'image') return;
    expect(malformed.crop).toBeUndefined();
  });
});

describe('normalizeFigureDocument unknown nodes', () => {
  it('still drops unknown node types while keeping valid frame nodes', () => {
    const doc = normalize(
      withNodes([
        { id: 'hex', type: 'hexagon' },
        chartNode(),
        { id: 'sb', type: 'scalebar' },
      ]),
    );
    expect(doc.nodes.map((node) => node.id)).toEqual(['chart1', 'sb']);
  });
});

describe('figure document serialisation', () => {
  it('writes two-space pretty JSON that round-trips', () => {
    const doc = normalize(withNodes([rect()]));
    const text = figureDocumentJson(doc);
    expect(text).toContain('\n  "format": "SPICE_FIGURE"');
    expect(text.split('\n').length).toBeGreaterThan(5);
    const parsed = parseFigureDocumentText(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.nodes).toHaveLength(1);
  });

  it('returns null for invalid JSON, empty text and invalid envelopes', () => {
    expect(parseFigureDocumentText('{ nope')).toBeNull();
    expect(parseFigureDocumentText('')).toBeNull();
    expect(parseFigureDocumentText('{"format":"SPICE_FIGURE","version":9}')).toBeNull();
    expect(parseFigureDocumentText('null')).toBeNull();
  });
});
