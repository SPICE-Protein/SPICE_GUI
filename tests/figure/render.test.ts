import { describe, expect, it } from 'vitest';
import { escapeXml, renderSvg, type ResolvedAssets } from '$lib/tools/figure/render';
import { citationMarkdown, exportSvgFile } from '$lib/tools/figure/exporters';
import {
  createAssetNode,
  createChartNode,
  createEllipseNode,
  createFigureDocument,
  createImageNode,
  createLineNode,
  createRectNode,
  createScaleBarNode,
  createTextNode,
  type AssetManifestEntry,
  type FigureDocument,
} from '$lib/tools/figure/types';

const MANIFEST_ENTRY: AssetManifestEntry = {
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

function svgFor(doc: FigureDocument, assets?: ResolvedAssets): string {
  return renderSvg(doc, assets);
}

describe('renderSvg document shell', () => {
  it('writes mm dimensions, a pixel viewBox, title, description and background', () => {
    const doc = createFigureDocument('Test <Figure>', 100, 50);
    doc.background = '#abcdef';
    const svg = svgFor(doc);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('width="100mm"');
    expect(svg).toContain('height="50mm"');
    expect(svg).toContain('viewBox="0 0 377.9528 188.9764"');
    expect(svg).toContain('<title>Test &lt;Figure&gt;</title>');
    expect(svg).toContain('<desc>Test &lt;Figure&gt; — 100 x 50 mm, 0 nodes.</desc>');
    expect(svg).toContain('<rect x="0" y="0" width="377.9528" height="188.9764" fill="#abcdef"/>');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});

describe('renderSvg shapes', () => {
  it('renders rect radius, opacity, rotation and dash pattern', () => {
    const doc = createFigureDocument('Shapes', 200, 100);
    const rect = createRectNode(10, 20, 80, 40);
    rect.cornerRadius = 6;
    rect.dash = 'dashed';
    rect.opacity = 0.5;
    rect.rotation = 30;
    rect.fill = '#00ff00';
    rect.stroke = '#112233';
    rect.strokeWidth = 2;
    doc.nodes = [rect];
    const svg = svgFor(doc);
    expect(svg).toContain('data-node-type="rect"');
    expect(svg).toContain('rx="6"');
    expect(svg).toContain('ry="6"');
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).toContain('stroke="#112233"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('transform="rotate(30 50 40)"');
  });

  it('renders ellipses inside their bounding box', () => {
    const doc = createFigureDocument('Shapes', 200, 100);
    doc.nodes = [createEllipseNode(10, 20, 60, 40)];
    const svg = svgFor(doc);
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('cx="40"');
    expect(svg).toContain('cy="40"');
    expect(svg).toContain('rx="30"');
    expect(svg).toContain('ry="20"');
  });

  it('renders arrows with head polygons', () => {
    const doc = createFigureDocument('Shapes', 200, 100);
    const arrow = createLineNode(0, 0, 100, 50, true);
    arrow.direction = 'diagonal';
    arrow.headEnd = true;
    arrow.headStart = true;
    arrow.dash = 'dotted';
    doc.nodes = [arrow];
    const svg = svgFor(doc);
    expect(svg).toContain('<line');
    expect(svg).toContain('x1="0" y1="0" x2="100" y2="50"');
    expect(svg.match(/<polygon /g)?.length).toBe(2);
    expect(svg).toContain('stroke-dasharray');
  });

  it('renders horizontal and vertical line endpoints', () => {
    const doc = createFigureDocument('Shapes', 200, 100);
    const horizontal = createLineNode(10, 20, 80, 40, false);
    horizontal.direction = 'horizontal';
    const vertical = createLineNode(10, 20, 80, 40, false);
    vertical.direction = 'vertical';
    doc.nodes = [horizontal, vertical];
    const svg = svgFor(doc);
    expect(svg).toContain('x1="10" y1="40" x2="90" y2="40"');
    expect(svg).toContain('x1="50" y1="20" x2="50" y2="60"');
  });
});

describe('renderSvg text', () => {
  it('keeps real escaped text in tspans with point-to-pixel sizing', () => {
    const doc = createFigureDocument('Text', 200, 100);
    const text = createTextNode(10, 20, 'Line 1\nA & <B>');
    text.fontSize = 12;
    text.fontWeight = 700;
    text.italic = true;
    text.align = 'center';
    text.lineHeight = 1.25;
    text.padding = 4;
    text.background = '#ffeecc';
    text.color = '#123456';
    doc.nodes = [text];
    const svg = svgFor(doc);
    expect(svg).toContain('font-size="16"');
    expect(svg).toContain('font-family="Arial"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('fill="#123456"');
    expect(svg.match(/<tspan/g)?.length).toBe(2);
    expect(svg).toContain('>Line 1</tspan>');
    expect(svg).toContain('>A &amp; &lt;B&gt;</tspan>');
    // Background rect covers the node box.
    expect(svg).toContain('fill="#ffeecc"');
    // First line sits at y + padding, the second one line-height later.
    expect(svg).toContain('x="100" y="24"');
    expect(svg).toContain('x="100" y="44"');
  });

  it('supports right alignment and empty text', () => {
    const doc = createFigureDocument('Text', 200, 100);
    const text = createTextNode(10, 20, '');
    text.align = 'right';
    text.padding = 5;
    text.w = 100;
    doc.nodes = [text];
    const svg = svgFor(doc);
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('x="105" y="25"');
    expect(svg).toContain('<tspan x="105" y="25"></tspan>');
  });
});

describe('renderSvg visibility', () => {
  it('omits hidden nodes and hides members of hidden groups without duplicating', () => {
    const doc = createFigureDocument('Visibility', 200, 100);
    const hidden = createRectNode(0, 0, 10, 10);
    hidden.hidden = true;
    const grouped = createRectNode(20, 20, 10, 10);
    grouped.groupId = 'group_a';
    const visible = createEllipseNode(40, 40, 10, 10);
    doc.groups = [{ id: 'group_a', name: 'Group A', hidden: true, locked: false }];
    doc.nodes = [hidden, grouped, visible];
    const svg = svgFor(doc);
    expect(svg).not.toContain('data-node-id="' + hidden.id + '"');
    expect(svg).not.toContain('data-node-id="' + grouped.id + '"');
    expect(svg).toContain('data-node-id="' + visible.id + '"');
    expect(svg.match(/data-node-id=/g)?.length).toBe(1);
  });

  it('shows nodes from visible groups', () => {
    const doc = createFigureDocument('Visibility', 200, 100);
    const grouped = createRectNode(20, 20, 10, 10);
    grouped.groupId = 'group_a';
    doc.groups = [{ id: 'group_a', name: 'Group A', hidden: false, locked: false }];
    doc.nodes = [grouped];
    expect(svgFor(doc)).toContain('data-node-id="' + grouped.id + '"');
  });
});

describe('renderSvg assets and images', () => {
  it('embeds a resolved asset data URL with contain semantics and tint filter', () => {
    const doc = createFigureDocument('Assets', 200, 100);
    const asset = createAssetNode(MANIFEST_ENTRY, 10, 10, 100, 50);
    asset.tint = '#ff0000';
    doc.nodes = [asset];
    const resolved: ResolvedAssets = new Map([
      [MANIFEST_ENTRY.id, { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', width: 200, height: 100 }],
    ]);
    const svg = svgFor(doc, resolved);
    expect(svg).toContain('href="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(svg).toContain('width="100"');
    expect(svg).toContain('height="50"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('<filter id="tint_0"');
    expect(svg).toContain('flood-color="#ff0000"');
    expect(svg).toContain('filter="url(#tint_0)"');
  });

  it('falls back to the bundled SVG path when no asset data is resolved', () => {
    const doc = createFigureDocument('Assets', 200, 100);
    doc.nodes = [createAssetNode(MANIFEST_ENTRY, 10, 10, 100, 50)];
    expect(svgFor(doc)).toContain('href="assets/mitochondrion.svg"');
  });

  it('maps image fit modes and flips around the node centre', () => {
    const doc = createFigureDocument('Images', 200, 100);
    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 10, 10, 100, 50);
    image.fit = 'cover';
    image.flipX = true;
    const stretch = createImageNode('data:image/png;base64,BBBB', 'image/png', 10, 70, 100, 20);
    stretch.fit = 'stretch';
    doc.nodes = [image, stretch];
    const svg = svgFor(doc);
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('transform="translate(60 35) scale(-1 1) translate(-60 -35)"');
  });
});

describe('escapeXml', () => {
  it('escapes markup characters and strips invalid control bytes', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
    expect(escapeXml('keep\u0009tab\u000a')).toBe('keep\u0009tab\u000a');
    expect(escapeXml('drop\u0000this')).toBe('dropthis');
  });
});

describe('renderSvg new node types', () => {
  it('renders chart and scale-bar nodes inside the document', () => {
    const doc = createFigureDocument('Composite', 200, 120);
    const chart = createChartNode(10, 10, 240, 180);
    chart.chartType = 'line';
    const scale = createScaleBarNode(10, 200, 120, 38);
    scale.label = '5 µm';
    doc.nodes = [chart, scale];

    const svg = svgFor(doc);
    expect(svg).toContain('data-node-type="chart"');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('data-node-type="scalebar"');
    expect(svg).toContain('5 µm');
    expect(svg).not.toContain('NaN');
  });

  it('clips a cropped image to its node bounds', () => {
    const doc = createFigureDocument('Crop', 120, 90);
    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 10, 10, 80, 60);
    image.crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 };
    doc.nodes = [image];

    const svg = svgFor(doc);
    expect(svg).toContain('<clipPath id="crop_0">');
    expect(svg).toContain('clip-path="url(#crop_0)"');
    expect(svg).toContain('x="-30"');
    expect(svg).toContain('width="160"');
    expect(svg).not.toContain('NaN');
  });

  it('keeps full-image behaviour for legacy images without a crop', () => {
    const doc = createFigureDocument('Legacy', 120, 90);
    const image = createImageNode('data:image/png;base64,AAAA', 'image/png', 10, 10, 80, 60);
    doc.nodes = [image];

    const svg = svgFor(doc);
    expect(svg).not.toContain('clipPath');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});

describe('exporters', () => {
  it('returns SVG bytes with a sanitised or fallback filename', () => {
    const named = createFigureDocument('My: Figure?', 90, 60);
    const file = exportSvgFile(named);
    expect(file.name).toBe('My_ Figure_.svg');
    expect(file.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(file.bytes)).toContain('<svg');

    const unnamed = createFigureDocument('   ', 90, 60);
    expect(exportSvgFile(unnamed).name).toBe('figure.spicefig.svg');
  });
});

describe('citationMarkdown', () => {
  it('lists only used assets, deduplicated, with full provenance', () => {
    const doc = createFigureDocument('Citations', 200, 100);
    const first = createAssetNode(MANIFEST_ENTRY, 0, 0);
    const duplicate = createAssetNode(MANIFEST_ENTRY, 20, 20);
    doc.nodes = [first, duplicate, createImageNode('data:image/png;base64,AAAA', 'image/png', 0, 0)];
    const markdown = citationMarkdown(doc, '2026-01-02T03:04:05.000Z');
    expect(markdown).toContain('# Figure Studio — asset provenance');
    expect(markdown).toContain('generated 2026-01-02T03:04:05.000Z');
    expect(markdown).toContain('**Mitochondrion**');
    expect(markdown).toContain('Creator: Jane Doe');
    expect(markdown).toContain('Credit: Jane Doe / SPICE');
    expect(markdown).toContain('License: CC BY 4.0');
    expect(markdown).toContain('Source: https://example.org/mito');
    expect(markdown).toContain('Citation: Doe J. (2024) Organelle atlas.');
    expect(markdown.match(/\*\*Mitochondrion\*\*/g)?.length).toBe(1);
    expect(markdown.trimEnd().split('\n').filter((line) => /^\d+\. /.test(line)).length).toBe(1);
  });

  it('reports when a figure uses no third-party assets', () => {
    const doc = createFigureDocument('Empty', 100, 100);
    expect(citationMarkdown(doc)).toContain('No third-party assets used.');
  });
});
