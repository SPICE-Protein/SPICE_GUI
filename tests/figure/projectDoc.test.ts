import { describe, expect, it } from 'vitest';
import {
  FIGURE_DOC_KIND,
  figureCitationMarkdown,
  figureDocName,
  figureMethods,
  figureParameters,
  figureSummary,
  normalizeFigurePayload,
  standaloneFigureName,
} from '$lib/tools/figure/projectDoc';
import {
  createAssetNode,
  createFigureDocument,
  createRectNode,
  type AssetManifestEntry,
  type FigureDocument,
} from '$lib/tools/figure/types';

const ASSET: AssetManifestEntry = {
  id: 'bioart_actin',
  title: 'Actin filament',
  category: 'cell-biology',
  tags: ['cytoskeleton'],
  file: 'static/bioart/actin.svg',
  license: 'CC BY 4.0',
  creator: 'SPICE BioArt',
  credit: 'SPICE BioArt team',
  citation: 'SPICE BioArt (2026). Actin filament. SPICE asset library.',
  sourceUrl: 'https://spice.example/bioart/actin',
  sha256: 'abc123',
  width: 100,
  height: 100,
};

function sampleDoc(): FigureDocument {
  const doc = createFigureDocument('  Test figure  ', 180, 120);
  const group = { id: 'grp_test', name: 'Main panel', hidden: false, locked: false };
  doc.groups.push(group);
  const rect = createRectNode(10, 10, 80, 60);
  rect.groupId = group.id;
  doc.nodes.push(rect);
  const asset = createAssetNode(ASSET, 100, 20, 50);
  doc.nodes.push(asset);
  doc.nodes.push(createAssetNode(ASSET, 100, 80, 50));
  return doc;
}

describe('figure project adapter', () => {
  it('declares the project document kind', () => {
    expect(FIGURE_DOC_KIND).toBe('figure');
  });

  it('normalizes a serialized document round-trip', () => {
    const doc = sampleDoc();
    const restored = normalizeFigurePayload(JSON.parse(JSON.stringify(doc)));
    expect(restored).not.toBeNull();
    expect(restored?.format).toBe('SPICE_FIGURE');
    expect(restored?.version).toBe(1);
    expect(restored?.name).toBe('  Test figure  ');
    expect(restored?.widthMm).toBe(180);
    expect(restored?.heightMm).toBe(120);
    expect(restored?.nodes).toHaveLength(3);
    expect(restored?.groups).toHaveLength(1);
  });

  it('rejects malformed payloads', () => {
    expect(normalizeFigurePayload(null)).toBeNull();
    expect(normalizeFigurePayload({})).toBeNull();
    expect(normalizeFigurePayload({ format: 'SPICE_FIGURE', version: 1 })).toBeNull();
    expect(normalizeFigurePayload({ format: 'OTHER', version: 1, nodes: [], groups: [] })).toBeNull();
  });

  it('falls back to a generic name', () => {
    const doc = createFigureDocument('   ');
    expect(figureDocName(doc)).toBe('Figure');
    expect(figureDocName({ ...doc, name: ' Real ' })).toBe('Real');
  });

  it('summarizes size, nodes, assets and groups', () => {
    const summary = figureSummary(sampleDoc());
    expect(summary).toContain('180.0 x 120.0 mm');
    expect(summary).toContain('3 objects');
    expect(summary).toContain('2 assets');
    expect(summary).toContain('1 group');
  });

  it('records page, grid, node counts and asset provenance', () => {
    const doc = sampleDoc();
    const params = figureParameters(doc) as {
      page: { widthMm: number; heightMm: number; background: string };
      grid: { show: boolean; snap: boolean; sizeMm: number };
      nodeCount: number;
      groupCount: number;
      nodeCounts: Record<string, number>;
      assets: Array<Record<string, unknown>>;
    };
    expect(params.page.widthMm).toBe(180);
    expect(params.page.heightMm).toBe(120);
    expect(params.page.background).toBe('#ffffff');
    expect(params.grid.snap).toBe(true);
    expect(params.grid.sizeMm).toBe(2);
    expect(params.nodeCount).toBe(3);
    expect(params.groupCount).toBe(1);
    expect(params.nodeCounts.rect).toBe(1);
    expect(params.nodeCounts.asset).toBe(2);
    expect(params.assets).toHaveLength(2);
    expect(params.assets[0]).toMatchObject({
      assetId: 'bioart_actin',
      label: 'Actin filament',
      license: 'CC BY 4.0',
      creator: 'SPICE BioArt',
      citation: ASSET.citation,
      sourceUrl: ASSET.sourceUrl,
      svgFile: ASSET.file,
    });
  });

  it('writes a methods paragraph covering vectors, assets and exports', () => {
    const methods = figureMethods(sampleDoc());
    expect(methods).toContain('Test figure');
    expect(methods).toContain('180.0 x 120.0 mm');
    expect(methods).toMatch(/vector scene/i);
    expect(methods).toContain('BioArt');
    expect(methods).toMatch(/licen[cs]e/i);
    expect(methods).toMatch(/citation/i);
    for (const format of ['SVG', 'PDF', 'PNG', 'PPTX']) {
      expect(methods).toContain(format);
    }
  });

  it('notes when no bundled assets were used', () => {
    const doc = createFigureDocument('Plain', 90, 60);
    doc.nodes.push(createRectNode(5, 5, 40, 30));
    expect(figureMethods(doc)).toContain('No bundled third-party assets');
    expect(figureCitationMarkdown(doc)).toContain('does not use any bundled assets');
  });

  it('deduplicates asset citations and includes provenance', () => {
    const markdown = figureCitationMarkdown(sampleDoc());
    const numbered = markdown.match(/^\d+\./gm) ?? [];
    expect(numbered).toHaveLength(1);
    expect(markdown).toContain('Asset citations');
    expect(markdown).toContain('**Actin filament**');
    expect(markdown).toContain('Creator: SPICE BioArt');
    expect(markdown).toContain('Licence: CC BY 4.0');
    expect(markdown).toContain('Citation: SPICE BioArt (2026)');
    expect(markdown).toContain(ASSET.sourceUrl);
  });

  it('builds a safe standalone file name', () => {
    const doc = createFigureDocument('My Figure / v2');
    expect(standaloneFigureName(doc)).toBe('My-Figure-v2.spicefig');

    const blank = createFigureDocument('   ');
    expect(standaloneFigureName(blank)).toBe('Figure.spicefig');

    const already = createFigureDocument('result.spicefig');
    expect(standaloneFigureName(already)).toBe('result.spicefig');
  });
});
