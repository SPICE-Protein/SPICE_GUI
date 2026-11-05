// Export entry points for Figure Studio. These helpers only build bytes; the
// caller decides where to save them (typically `backend.saveExport`). No
// download or filesystem side effects happen here.
import { renderPng, renderSvg, type ResolvedAssets } from './render';
import { renderPdf } from './pdf';
import { renderPptx } from './pptx';
import { renderTiff } from './tiff';
import type { AssetNode, FigureDocument } from './types';

export interface ExportedFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

const MIME = {
  svg: 'image/svg+xml',
  png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
} as const;

/** Base filename derived from the document title, with a safe fallback. */
export function figureFileBase(doc: FigureDocument): string {
  const base = (doc.name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return base || 'figure.spicefig';
}

export function exportSvgFile(doc: FigureDocument, assets?: ResolvedAssets): ExportedFile {
  return {
    name: `${figureFileBase(doc)}.svg`,
    bytes: new TextEncoder().encode(renderSvg(doc, assets)),
    mime: MIME.svg,
  };
}

export async function exportPngFile(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 300,
): Promise<ExportedFile> {
  return {
    name: `${figureFileBase(doc)}_${dpi}dpi.png`,
    bytes: await renderPng(doc, assets, dpi),
    mime: MIME.png,
  };
}

export async function exportTiffFile(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 300,
): Promise<ExportedFile> {
  return {
    name: `${figureFileBase(doc)}_${dpi}dpi.tiff`,
    bytes: await renderTiff(doc, assets, dpi),
    mime: 'image/tiff',
  };
}

export async function exportPptxFile(doc: FigureDocument, assets?: ResolvedAssets): Promise<ExportedFile> {
  return {
    name: `${figureFileBase(doc)}.pptx`,
    bytes: await renderPptx(doc, assets),
    mime: MIME.pptx,
  };
}

export async function exportPdfFile(
  doc: FigureDocument,
  assets?: ResolvedAssets,
  dpi = 300,
): Promise<ExportedFile> {
  return {
    name: `${figureFileBase(doc)}_${dpi}dpi.pdf`,
    bytes: await renderPdf(doc, assets, dpi),
    mime: MIME.pdf,
  };
}

/**
 * Provenance block for the used third-party assets. Only asset nodes that
 * actually appear in the document are listed, deduplicated by assetId (or by
 * title/citation when an asset has no id).
 */
export function citationMarkdown(doc: FigureDocument, generatedAt = new Date().toISOString()): string {
  const used: AssetNode[] = [];
  const seen = new Set<string>();
  for (const node of doc.nodes) {
    if (node.type !== 'asset') continue;
    const key = node.assetId || `${node.label}|${node.sourceUrl}|${node.citation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    used.push(node);
  }

  const lines: string[] = [
    '# Figure Studio — asset provenance',
    '',
    `_${doc.name || 'Figure'} — generated ${generatedAt}_`,
    '',
  ];
  if (!used.length) {
    lines.push('No third-party assets used.');
    return `${lines.join('\n')}\n`;
  }
  used.forEach((asset, index) => {
    lines.push(`${index + 1}. **${asset.label || asset.name || asset.assetId}**`);
    if (asset.creator) lines.push(`   - Creator: ${asset.creator}`);
    if (asset.credit) lines.push(`   - Credit: ${asset.credit}`);
    if (asset.license) lines.push(`   - License: ${asset.license}`);
    if (asset.sourceUrl) lines.push(`   - Source: ${asset.sourceUrl}`);
    if (asset.citation) lines.push(`   - Citation: ${asset.citation}`);
  });
  return `${lines.join('\n')}\n`;
}
