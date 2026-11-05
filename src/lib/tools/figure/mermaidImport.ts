// Mermaid -> Figure Studio import.
//
// Only flowchart/graph syntax is accepted: Mermaid renders it as plain SVG
// shapes and text, which maps cleanly onto the node model. Other Mermaid
// diagram types render to specialised structures we cannot edit as shapes, so
// the dialog points the user at the SVG route instead.
//
// The renderer is loaded lazily so Figure Studio does not pay for Mermaid in
// the initial bundle.

import { importSvgMarkup, type VectorImportResult } from './importVector';
import { createFigureId } from './types';

/** Small flowchart used by the dialog's "load example" button. */
export const MERMAID_EXAMPLE = `flowchart TD
  A[Sample] --> B[QC]
  B -->|pass| C[Analyze]
  B -->|fail| D[Repeat]
  D --> A`;

const FLOWCHART_KEYWORDS = new Set(['flowchart', 'graph', 'flowchart-beta']);

function firstKeyword(source: string): string {
  let text = source.replace(/^﻿/, '').trim();
  // Mermaid frontmatter (--- config ---) precedes the diagram keyword.
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) {
      text = text.slice(end + 4);
    }
  }
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Directives (%%{init: ...}%%) and comments carry no diagram keyword.
    if (line.startsWith('%%')) continue;
    return line.split(/\s+/)[0];
  }
  return '';
}

function assertFlowchart(source: string): void {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Mermaid source is empty.');
  }
  const keyword = firstKeyword(source);
  if (!keyword) {
    throw new Error('Mermaid source is empty.');
  }
  const normalized = keyword.toLowerCase();
  if (FLOWCHART_KEYWORDS.has(normalized) || normalized.startsWith('flowchart-')) return;
  throw new Error(
    `Mermaid "${keyword}" diagrams cannot be imported as editable shapes. ` +
      'Save the diagram as an SVG file and import it through the SVG tab instead.',
  );
}

/**
 * Render a Mermaid flowchart to SVG and convert it into Figure Studio nodes.
 * Requires a browser environment (Mermaid renders into a DOM node).
 */
export async function importMermaid(source: string): Promise<VectorImportResult> {
  assertFlowchart(source);
  if (typeof document === 'undefined') {
    throw new Error('Mermaid import requires a browser environment.');
  }

  const module = await import('mermaid');
  const mermaid = module.default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    flowchart: { htmlLabels: false },
  });

  const renderId = createFigureId('mermaid-import');
  let svg: string;
  try {
    const rendered = await mermaid.render(renderId, source);
    svg = rendered.svg;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Mermaid could not render this diagram: ${detail}`);
  }

  if (!svg || !svg.trim()) {
    throw new Error('Mermaid returned an empty diagram.');
  }
  return importSvgMarkup(svg);
}
