import { describe, expect, it } from 'vitest';
import {
  checkFigure,
  complianceCounts,
  type ComplianceIssue,
  type ImagePixelSize,
} from '$lib/tools/figure/compliance';
import {
  createAssetNode,
  createChartNode,
  createFigureDocument,
  createImageNode,
  createRectNode,
  createScaleBarNode,
  createTextNode,
  type AssetManifestEntry,
  type ChartNode,
  type FigureDocument,
  type FigureNode,
} from '$lib/tools/figure/types';

const ASSET: AssetManifestEntry = {
  id: 'asset_mito',
  title: 'Mitochondrion',
  category: 'organelle',
  tags: ['cell'],
  file: 'assets/mitochondrion.svg',
  license: 'CC BY 4.0',
  creator: 'Jane Doe',
  credit: 'Jane Doe / SPICE',
  citation: 'Doe J. (2024) Organelle atlas.',
  sourceUrl: 'https://example.org/mito',
  sha256: 'abc123',
  width: 200,
  height: 100,
};

function makeDoc(nodes: FigureNode[] = []): FigureDocument {
  const doc = createFigureDocument('Compliance test', 180, 120);
  doc.nodes = nodes;
  return doc;
}

function codes(doc: FigureDocument, sizes: Map<string, ImagePixelSize> = new Map()) {
  return checkFigure(doc, sizes).map((issue) => issue.code);
}

describe('font size checks', () => {
  it('flags text below 5 pt as an error and below 6 pt as a warning', () => {
    const tiny = createTextNode(0, 0, 'Tiny');
    tiny.fontSize = 4.9;
    const small = createTextNode(0, 60, 'Small');
    small.fontSize = 5;
    const doc = makeDoc([tiny, small]);

    const issues = checkFigure(doc);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      id: `fontTiny:${tiny.id}`,
      severity: 'error',
      code: 'fontTiny',
      nodeId: tiny.id,
      params: { name: tiny.name, size: 4.9 },
    });
    expect(issues[1]).toMatchObject({
      id: `fontSmall:${small.id}`,
      severity: 'warn',
      code: 'fontSmall',
      nodeId: small.id,
      params: { name: small.name, size: 5 },
    });
  });

  it('accepts 6 pt and above', () => {
    const text = createTextNode(0, 0, 'Readable');
    text.fontSize = 6;
    expect(codes(makeDoc([text]))).toEqual([]);
  });

  it('treats a zero font size as an error', () => {
    const text = createTextNode(0, 0, 'Invisible');
    text.fontSize = 0;
    const issues = checkFigure(makeDoc([text]));
    expect(issues.map((issue) => issue.code)).toEqual(['fontTiny']);
    expect(issues[0].params.size).toBe(0);
  });

  it('checks chart and scale-bar typography but emits only one issue per node', () => {
    const chart = createChartNode(0, 0);
    chart.fontSize = 4;
    const bar = createScaleBarNode(0, 100);
    bar.fontSize = 5.5;
    const doc = makeDoc([chart, bar]);

    const issues = checkFigure(doc);
    expect(issues.map((issue) => issue.code)).toEqual(['fontTiny', 'fontSmall']);
    expect(issues.every((issue) => issue.nodeId === chart.id || issue.nodeId === bar.id)).toBe(true);
    expect(issues.filter((issue) => issue.nodeId === chart.id)).toHaveLength(1);
    expect(issues.filter((issue) => issue.nodeId === bar.id)).toHaveLength(1);
  });

  it('skips hidden nodes and hidden groups', () => {
    const hidden = createTextNode(0, 0, 'Hidden');
    hidden.fontSize = 3;
    hidden.hidden = true;

    const grouped = createTextNode(0, 60, 'Grouped');
    grouped.fontSize = 3;
    grouped.groupId = 'group_1';

    const doc = makeDoc([hidden, grouped]);
    doc.groups = [{ id: 'group_1', name: 'Hidden group', hidden: true, locked: false }];
    expect(checkFigure(doc)).toEqual([]);
  });
});

describe('stroke width checks', () => {
  it('warns below 0.25 pt and accepts wider strokes', () => {
    const thin = createRectNode(0, 0);
    thin.stroke = '#000000';
    thin.strokeWidth = 0.2; // 0.15 pt
    const ok = createRectNode(0, 60);
    ok.strokeWidth = 0.4; // 0.3 pt
    const doc = makeDoc([thin, ok]);

    const issues = checkFigure(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: `strokeThin:${thin.id}`,
      severity: 'warn',
      code: 'strokeThin',
      params: { name: thin.name, size: 0.15 },
    });
  });

  it('ignores nodes without a stroke and text/asset/image outlines', () => {
    const noStroke = createRectNode(0, 0);
    noStroke.stroke = 'none';
    noStroke.strokeWidth = 0.1;

    const text = createTextNode(0, 60, 'Text');
    text.stroke = '#000000';
    text.strokeWidth = 0.1;

    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 0, 120);
    image.stroke = '#000000';
    image.strokeWidth = 0.1;

    const asset = createAssetNode(ASSET, 0, 200);
    asset.stroke = '#000000';
    asset.strokeWidth = 0.1;

    expect(checkFigure(makeDoc([noStroke, text, image, asset]))).toEqual([]);
  });

  it('applies to charts and scale bars as well as shapes', () => {
    const chart = createChartNode(0, 0);
    chart.strokeWidth = 0.1;
    const bar = createScaleBarNode(0, 240);
    bar.stroke = 'none';
    bar.strokeWidth = 0.1;

    const issues = checkFigure(makeDoc([chart, bar]));
    expect(issues.map((issue) => issue.nodeId)).toEqual([chart.id]);
  });
});

describe('image resolution checks', () => {
  const size = (width: number, height: number): ImagePixelSize => ({ width, height });

  it('errors below 150 dpi, warns below 300 dpi and accepts 300 dpi', () => {
    const veryLow = createImageNode('data:image/png;base64,AAAA', 'image/png', 0, 0, 96, 96);
    const low = createImageNode('data:image/png;base64,AAAB', 'image/png', 0, 100, 96, 96);
    const fine = createImageNode('data:image/png;base64,AAAC', 'image/png', 0, 200, 96, 96);
    const doc = makeDoc([veryLow, low, fine]);
    const sizes = new Map<string, ImagePixelSize>([
      [veryLow.id, size(100, 100)],
      [low.id, size(200, 200)],
      [fine.id, size(300, 300)],
    ]);

    const issues = checkFigure(doc, sizes);
    expect(issues.map((issue) => issue.code)).toEqual(['imageVeryLowDpi', 'imageLowDpi']);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      params: { name: veryLow.name, dpi: 100 },
    });
    expect(issues[1]).toMatchObject({
      severity: 'warn',
      params: { name: low.name, dpi: 200 },
    });
  });

  it('uses the worse of the horizontal and vertical resolution', () => {
    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 0, 0, 96, 96);
    const doc = makeDoc([image]);
    const issues = checkFigure(doc, new Map([[image.id, size(300, 100)]]));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('imageVeryLowDpi');
    expect(issues[0].params.dpi).toBe(100);
  });

  it('skips images without metadata and vector assets even when a size exists', () => {
    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 0, 0, 96, 96);
    const asset = createAssetNode(ASSET, 0, 120);
    const doc = makeDoc([image, asset]);
    const assetOnly = new Map<string, ImagePixelSize>([[asset.id, size(10, 10)]]);
    expect(checkFigure(doc, new Map())).toEqual([]);
    expect(checkFigure(doc, assetOnly)).toEqual([]);
  });
});

function chartWithSeries(): ChartNode {
  const chart = createChartNode(0, 0);
  chart.series = [
    {
      id: 'series_a',
      name: 'Control',
      color: '#2563eb',
      values: [1, 2],
      errors: [0, 0],
    },
    {
      id: 'series_b',
      name: 'Treatment',
      color: '#2f6be8',
      values: [2, 3],
      errors: [0, 0],
    },
    {
      id: 'series_c',
      name: 'Rescue',
      color: '#ff0000',
      values: [1, 1],
      errors: [0, 0],
    },
  ];
  return chart;
}

describe('chart series colour checks', () => {
  it('warns for perceptually close colours and reports the series names', () => {
    const chart = chartWithSeries();
    const issues = checkFigure(makeDoc([chart]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: `seriesColorsClose:${chart.id}:0-1`,
      severity: 'warn',
      code: 'seriesColorsClose',
      nodeId: chart.id,
      params: { a: 'Control', b: 'Treatment' },
    });
  });

  it('accepts clearly distinct colours', () => {
    const chart = chartWithSeries();
    chart.series[1].color = '#0000ff';
    chart.series[2].color = '#dc2626';
    expect(checkFigure(makeDoc([chart]))).toEqual([]);
  });

  it('does not emit duplicate pairs', () => {
    const chart = chartWithSeries();
    chart.series[2].color = '#2a63ea';
    const issues = checkFigure(makeDoc([chart]));
    // 0-1, 0-2 and 1-2 are all distinct pairs; none repeats.
    expect(issues).toHaveLength(3);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(3);
  });
});

describe('text overflow checks', () => {
  it('warns when the longest line exceeds the box by more than 10 percent', () => {
    const text = createTextNode(0, 0, 'A'.repeat(20));
    text.w = 80;
    text.padding = 4;
    text.fontSize = 12;

    const issues = checkFigure(makeDoc([text]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: `textOverflow:${text.id}`,
      severity: 'warn',
      code: 'textOverflow',
      params: { name: text.name },
    });
  });

  it('measures each line independently and ignores short text', () => {
    const text = createTextNode(0, 0, `OK\n${'A'.repeat(20)}`);
    text.w = 80;
    text.padding = 4;
    text.fontSize = 12;

    const short = createTextNode(0, 100, 'Hi');
    short.w = 80;
    short.fontSize = 12;

    const issues = checkFigure(makeDoc([text, short]));
    expect(issues.map((issue) => issue.code)).toEqual(['textOverflow']);
  });

  it('skips empty text and treats a non-positive available width as overflow', () => {
    const empty = createTextNode(0, 0, '   ');
    const cramped = createTextNode(0, 60, 'x');
    cramped.w = 5;
    cramped.padding = 10;

    const issues = checkFigure(makeDoc([empty, cramped]));
    expect(issues.map((issue) => issue.nodeId)).toEqual([cramped.id]);
  });
});

describe('ordering and counts', () => {
  it('sorts errors before warnings, then follows document order', () => {
    const firstWarn = createTextNode(0, 0, 'Warn one');
    firstWarn.fontSize = 5.5;
    const secondWarn = createTextNode(0, 60, 'Warn two');
    secondWarn.fontSize = 5.5;
    const lastError = createTextNode(0, 120, 'Error later');
    lastError.fontSize = 4;

    const doc = makeDoc([firstWarn, secondWarn, lastError]);
    const issues = checkFigure(doc);
    expect(issues.map((issue) => issue.id)).toEqual([
      `fontTiny:${lastError.id}`,
      `fontSmall:${firstWarn.id}`,
      `fontSmall:${secondWarn.id}`,
    ]);
  });

  it('counts each severity', () => {
    const issues: ComplianceIssue[] = [
      {
        id: 'a',
        severity: 'error',
        code: 'fontTiny',
        name: 'A',
        params: {},
      },
      {
        id: 'b',
        severity: 'warn',
        code: 'fontSmall',
        name: 'B',
        params: {},
      },
      {
        id: 'c',
        severity: 'info',
        code: 'strokeThin',
        name: 'C',
        params: {},
      },
    ];
    expect(complianceCounts(issues)).toEqual({ errors: 1, warns: 1, infos: 1, total: 3 });
    expect(complianceCounts([])).toEqual({ errors: 0, warns: 0, infos: 0, total: 0 });
  });
});
