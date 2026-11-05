import { describe, expect, it } from 'vitest';
import { buildPdfFromRgb, mmToPt, renderPdf } from '$lib/tools/figure/pdf';
import { createFigureDocument } from '$lib/tools/figure/types';

const LATIN1 = new TextDecoder('latin1');

function pdfText(bytes: Uint8Array): string {
  return LATIN1.decode(bytes);
}

describe('mmToPt', () => {
  it('converts millimetres to PDF points', () => {
    expect(mmToPt(0)).toBe(0);
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
    expect(mmToPt(180)).toBeCloseTo(510.236220472, 8);
    expect(mmToPt(120)).toBeCloseTo(340.157480315, 8);
  });
});

describe('buildPdfFromRgb', () => {
  it('writes a minimal PDF 1.4 with one RGB image page', async () => {
    // 2x2 RGB: red, green / blue, white.
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const bytes = await buildPdfFromRgb(rgb, 2, 2, mmToPt(180), mmToPt(120), 'Tiny <Fig> & "co"');
    const text = pdfText(bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/Type /Page ');
    expect(text).toContain('/MediaBox [0 0 510.2362 340.1575]');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Width 2 /Height 2');
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/BitsPerComponent 8');
    expect(text).toContain('/Filter /FlateDecode');
    expect(text).toContain('/XObject << /Im0 5 0 R >>');
    expect(text).toContain('/Title (Tiny <Fig> & "co")');
    expect(text).toContain('/Producer (SPICE Figure Studio)');
    expect(text).toContain('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>');
    expect(text).toContain('xref\n0 7\n0000000000 65535 f');
    expect(text).toContain('startxref');
  });

  it('writes UTF-16BE hex strings for non-ASCII titles', async () => {
    const rgb = new Uint8Array([0, 0, 0, 255, 255, 255]);
    const bytes = await buildPdfFromRgb(rgb, 2, 1, 100, 50, 'Größe µ');
    expect(pdfText(bytes)).toMatch(/\/Title <FEFF[0-9A-F]+>/);
  });

  it('rejects malformed RGB buffers', async () => {
    await expect(buildPdfFromRgb(new Uint8Array(5), 2, 2, 100, 100)).rejects.toThrow(/Invalid RGB buffer/);
    await expect(buildPdfFromRgb(new Uint8Array(), 0, 2, 100, 100)).rejects.toThrow(/Invalid RGB buffer/);
  });
});

describe('renderPdf', () => {
  it('fails clearly when canvas rendering is unavailable', async () => {
    const doc = createFigureDocument('No canvas', 100, 50);
    await expect(renderPdf(doc, undefined, 72)).rejects.toThrow(/canvas/i);
  });
});
