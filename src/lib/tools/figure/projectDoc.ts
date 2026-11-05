// SPICE_PROJECT adapter for Figure Studio.
//
// Converts a FigureDocument into the small pieces the project hub and
// reproducibility bundle need: a one-line summary, parameters.json content,
// a draft methods paragraph, a citation block and a standalone file name.
// Kept free of Svelte state so it can be tested and reused by the tool page.

import { normalizeFigureDocument } from './normalize';
import {
  documentHeightPx,
  documentWidthPx,
  type AssetNode,
  type FigureDocument,
  type FigureNode,
} from './types';

export const FIGURE_DOC_KIND = 'figure' as const;

export function normalizeFigurePayload(value: unknown): FigureDocument | null {
  return normalizeFigureDocument(value);
}

export function figureDocName(doc: FigureDocument): string {
  const name = doc.name.trim();
  return name || 'Figure';
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function assetNodes(doc: FigureDocument): AssetNode[] {
  return doc.nodes.filter((node): node is AssetNode => node.type === 'asset');
}

/** One-line hub/ELN summary. */
export function figureSummary(doc: FigureDocument): string {
  const assets = assetNodes(doc);
  return [
    `${doc.widthMm.toFixed(1)} x ${doc.heightMm.toFixed(1)} mm`,
    plural(doc.nodes.length, 'object'),
    plural(assets.length, 'asset'),
    plural(doc.groups.length, 'group'),
  ].join('; ');
}

function nodeRecord(node: FigureNode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    name: node.name,
    x: Number(node.x.toFixed(3)),
    y: Number(node.y.toFixed(3)),
    w: Number(node.w.toFixed(3)),
    h: Number(node.h.toFixed(3)),
    rotation: node.rotation,
    opacity: node.opacity,
    locked: node.locked,
    hidden: node.hidden,
    groupId: node.groupId ?? null,
  };
  switch (node.type) {
    case 'text':
      return {
        ...base,
        text: node.text,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        italic: node.italic,
        align: node.align,
        color: node.color,
      };
    case 'line':
    case 'arrow':
      return {
        ...base,
        direction: node.direction,
        headStart: node.headStart,
        headEnd: node.headEnd,
      };
    case 'asset':
      return {
        ...base,
        assetId: node.assetId,
        label: node.label,
        svgFile: node.svgFile,
      };
    case 'image':
      return {
        ...base,
        mime: node.mime,
        fit: node.fit,
        crop: node.crop ?? null,
        lockAspect: node.lockAspect ?? false,
      };
    case 'chart':
      return {
        ...base,
        chartType: node.chartType,
        labels: node.labels,
        series: node.series.map((series) => ({
          name: series.name,
          color: series.color,
          values: series.values,
          errors: series.errors,
        })),
        xLabel: node.xLabel,
        yLabel: node.yLabel,
        yMin: node.yMin,
        yMax: node.yMax,
        showLegend: node.showLegend,
        showGrid: node.showGrid,
        showValues: node.showValues,
        showErrorBars: node.showErrorBars,
        significance: node.significance,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
      };
    case 'scalebar':
      return {
        ...base,
        label: node.label,
        thickness: node.thickness,
        ticks: node.ticks,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
      };
    case 'path':
      return {
        ...base,
        points: node.points,
        closed: node.closed,
        headStart: node.headStart,
        headEnd: node.headEnd,
        headSize: node.headSize,
      };
    default:
      return base;
  }
}

/** Processing settings recorded in parameters.json. */
export function figureParameters(doc: FigureDocument): Record<string, unknown> {
  const nodeCounts: Record<string, number> = {};
  for (const node of doc.nodes) {
    nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
  }
  const assets = assetNodes(doc).map((node) => ({
    nodeId: node.id,
    assetId: node.assetId,
    label: node.label || node.name,
    svgFile: node.svgFile,
    sourceUrl: node.sourceUrl,
    license: node.license,
    creator: node.creator,
    credit: node.credit,
    citation: node.citation,
  }));

  return {
    figure: {
      name: figureDocName(doc),
      format: doc.format,
      version: doc.version,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
    page: {
      widthMm: doc.widthMm,
      heightMm: doc.heightMm,
      widthPx: Number(documentWidthPx(doc).toFixed(3)),
      heightPx: Number(documentHeightPx(doc).toFixed(3)),
      background: doc.background,
    },
    grid: {
      show: doc.grid.show,
      snap: doc.grid.snap,
      sizeMm: doc.grid.sizeMm,
    },
    nodeCount: doc.nodes.length,
    groupCount: doc.groups.length,
    nodeCounts,
    nodes: doc.nodes.map(nodeRecord),
    assets,
  };
}

/** Draft methods paragraph included in the reproducible bundle. */
export function figureMethods(doc: FigureDocument): string {
  const assets = assetNodes(doc);
  const lines = [
    `Figure "${figureDocName(doc)}" (${doc.widthMm.toFixed(1)} x ${doc.heightMm.toFixed(
      1,
    )} mm) was assembled in SPICE Figure Studio as a vector scene containing ${plural(
      doc.nodes.length,
      'object',
    )} in ${plural(doc.groups.length, 'group')}.`,
    'Shape geometry, text and connectors are stored parametrically with physical page dimensions in millimetres, so the same document renders to SVG and PDF without rasterisation; PNG and PPTX exports rasterise the scene at the resolution selected during export.',
  ];
  if (assets.length) {
    lines.push(
      `The figure includes ${plural(
        assets.length,
        'third-party asset',
      )} from the bundled BioArt library. Every asset retains its creator, credit, licence and citation metadata; check that each licence permits the intended publication and include the generated citation block in the figure legend or references.`,
    );
  } else {
    lines.push(
      'No bundled third-party assets were used; all visible elements were drawn with native vector shapes and text.',
    );
  }
  lines.push(
    'Export formats: SVG (vector), PDF (vector), PNG (raster at the chosen DPI) and PPTX (editable slide objects with raster fallbacks where required).',
  );
  return lines.join(' ');
}

/** Markdown citation block for the assets used in the figure. Duplicate nodes
 *  that reference the same asset are collapsed to one citation. */
export function figureCitationMarkdown(doc: FigureDocument): string {
  const seen = new Map<string, AssetNode>();
  for (const node of assetNodes(doc)) {
    const key = node.assetId || `${node.label}|${node.citation}`;
    if (!seen.has(key)) seen.set(key, node);
  }
  if (seen.size === 0) {
    return 'This figure does not use any bundled assets.';
  }

  const lines = [
    '### Asset citations',
    '',
    'The figure uses the following third-party assets. Include this block in the figure legend or references.',
    '',
  ];
  let index = 1;
  for (const node of seen.values()) {
    const title = node.label || node.name || node.assetId || 'Untitled asset';
    const parts = [`${index}. **${title}**`];
    if (node.creator) parts.push(`Creator: ${node.creator}.`);
    if (node.license) parts.push(`Licence: ${node.license}.`);
    if (node.credit) parts.push(`Credit: ${node.credit}.`);
    if (node.citation) parts.push(`Citation: ${node.citation}.`);
    if (node.sourceUrl) parts.push(`Source: ${node.sourceUrl}`);
    lines.push(parts.join(' '));
    index += 1;
  }
  return lines.join('\n');
}

/** File name used when a figure is exported outside a SPICE_PROJECT. */
export function standaloneFigureName(doc: FigureDocument): string {
  const safe = figureDocName(doc)
    .replace(/\.spicefig$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
  return `${safe || 'figure'}.spicefig`;
}
