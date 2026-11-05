import { describe, expect, it } from 'vitest';
import { renderPptx } from '../../src/lib/tools/figure/pptx';
import {
  createFigureDocument,
  createRectNode,
  createTextNode,
} from '../../src/lib/tools/figure/types';

describe('Figure Studio PPTX export', () => {
  it('writes a non-empty editable PowerPoint package', async () => {
    const doc = createFigureDocument('PPTX smoke', 120, 80);
    const rect = createRectNode(20, 20, 160, 80);
    rect.fill = '#ffcc00';
    rect.stroke = '#333333';
    const text = createTextNode(24, 24, 'Editable label');
    text.fontSize = 14;
    text.fontWeight = 700;
    doc.nodes = [rect, text];

    const bytes = await renderPptx(doc, new Map());
    expect(bytes.length).toBeGreaterThan(1000);
    // ZIP local-file header for the first OOXML part.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const textDecoder = new TextDecoder();
    const head = textDecoder.decode(bytes.slice(0, 4096));
    expect(head).toContain('[Content_Types].xml');
  });
});
