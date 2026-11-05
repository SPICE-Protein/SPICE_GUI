import { describe, expect, it } from 'vitest';
import { FIGURE_TEMPLATES, applyFigureTemplate } from '$lib/tools/figure/templates';
import {
  FIGURE_FORMAT,
  FIGURE_VERSION,
  documentHeightPx,
  documentWidthPx,
  type FigureDocument,
} from '$lib/tools/figure/types';

const EXPECTED_IDS = [
  'single-column',
  'double-column',
  'slide',
  'graphical-abstract',
  'mechanism',
  'workflow',
  'comparison',
  'timeline',
];

function expectInsidePage(doc: FigureDocument): void {
  const width = documentWidthPx(doc);
  const height = documentHeightPx(doc);
  for (const node of doc.nodes) {
    expect(node.x, `${doc.name}/${node.name} x`).toBeGreaterThanOrEqual(-0.01);
    expect(node.y, `${doc.name}/${node.name} y`).toBeGreaterThanOrEqual(-0.01);
    expect(node.x + node.w, `${doc.name}/${node.name} right`).toBeLessThanOrEqual(width + 0.5);
    expect(node.y + node.h, `${doc.name}/${node.name} bottom`).toBeLessThanOrEqual(height + 0.5);
  }
}

describe('Figure Studio templates', () => {
  it('exposes the eight starter templates with local message keys', () => {
    expect(FIGURE_TEMPLATES.map((template) => template.id)).toEqual(EXPECTED_IDS);
    expect(new Set(FIGURE_TEMPLATES.map((template) => template.id)).size).toBe(8);
    expect(new Set(FIGURE_TEMPLATES.map((template) => template.nameKey)).size).toBe(8);
    expect(new Set(FIGURE_TEMPLATES.map((template) => template.descKey)).size).toBe(8);
    for (const template of FIGURE_TEMPLATES) {
      expect(template.nameKey).toMatch(/^figTemplate/);
      expect(template.descKey).toMatch(/^figTemplate.*Desc$/);
    }
  });

  for (const template of FIGURE_TEMPLATES) {
    it(`${template.id} builds a laid-out document inside the page`, () => {
      const doc = template.build();

      expect(doc.format).toBe(FIGURE_FORMAT);
      expect(doc.version).toBe(FIGURE_VERSION);
      expect(doc.widthMm).toBeGreaterThan(0);
      expect(doc.heightMm).toBeGreaterThan(0);
      expect(doc.nodes.length).toBeGreaterThanOrEqual(6);
      expect(doc.groups.length).toBeGreaterThanOrEqual(1);

      const ids = doc.nodes.map((node) => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const node of doc.nodes) {
        expect(node.name.trim().length).toBeGreaterThan(0);
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
      }
      for (const group of doc.groups) {
        expect(group.id.length).toBeGreaterThan(0);
        expect(group.name.trim().length).toBeGreaterThan(0);
      }

      expectInsidePage(doc);
    });
  }

  it('produces eight visually distinct documents', () => {
    const docs = FIGURE_TEMPLATES.map((template) => template.build());
    expect(new Set(docs.map((doc) => doc.name)).size).toBe(8);
    expect(new Set(docs.map((doc) => `${doc.widthMm}x${doc.heightMm}`)).size).toBeGreaterThanOrEqual(6);
    for (const doc of docs) {
      expect(doc.nodes.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('scales the page and layout to a requested width', () => {
    for (const template of FIGURE_TEMPLATES) {
      const doc = template.build(120);
      expect(doc.widthMm).toBe(120);
      expect(doc.heightMm).toBeGreaterThan(0);
      expect(doc.nodes.length).toBeGreaterThanOrEqual(6);
      expectInsidePage(doc);
    }
  });

  it('applies a template by id', () => {
    const doc = applyFigureTemplate('workflow');
    expect(doc.name).toBe('Workflow diagram');
    expect(doc.nodes.length).toBeGreaterThanOrEqual(6);
    expectInsidePage(doc);
  });

  it('falls back to the single-column starter for unknown ids', () => {
    const doc = applyFigureTemplate('not-a-template');
    const single = FIGURE_TEMPLATES[0].build();
    expect(doc.widthMm).toBe(single.widthMm);
    expect(doc.heightMm).toBe(single.heightMm);
    expect(doc.nodes.length).toBe(single.nodes.length);
    expect(doc.name).toBe(single.name);
  });

  it('honours a custom width in the fallback path', () => {
    const doc = applyFigureTemplate('not-a-template', 110);
    expect(doc.widthMm).toBe(110);
    expectInsidePage(doc);
  });
});
