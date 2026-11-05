// Publication-compliance checks for Figure Studio documents.
//
// The module is intentionally pure: it inspects the document model plus an
// optional map of source pixel sizes and returns structured issues. It never
// localises text or touches the DOM, so it can run in tests, workers and the
// UI alike. The UI maps each issue code and its params to a translated
// sentence.

import { PT_TO_PX, type FigureDocument, type FigureNode, type TextNode } from './types';

export type ComplianceSeverity = 'error' | 'warn' | 'info';

export type ComplianceCode =
  | 'fontTiny'
  | 'fontSmall'
  | 'strokeThin'
  | 'imageVeryLowDpi'
  | 'imageLowDpi'
  | 'seriesColorsClose'
  | 'textOverflow';

export interface ComplianceIssue {
  id: string;
  severity: ComplianceSeverity;
  code: ComplianceCode;
  nodeId?: string;
  /** Human-readable node label; not localised. */
  name: string;
  params: Record<string, string | number>;
}

export interface ImagePixelSize {
  width: number;
  height: number;
}

interface Counts {
  errors: number;
  warns: number;
  infos: number;
  total: number;
}

const SEVERITY_RANK: Record<ComplianceSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

/** Minimum print sizes. 5 pt is treated as unreadable, 6 pt as the house floor. */
const FONT_TINY_PT = 5;
const FONT_SMALL_PT = 6;

/** Minimum printable stroke widths in points. */
const STROKE_MIN_PT = 0.25;

/** Effective image resolution thresholds in dots per inch. */
const IMAGE_VERY_LOW_DPI = 150;
const IMAGE_LOW_DPI = 300;

/** CIE76 distance below which two series colours are hard to tell apart. */
const SERIES_COLOR_DISTANCE = 18;

/** Conservative average glyph width as a fraction of the em size. */
const GLYPH_WIDTH_FACTOR = 0.58;
const OVERFLOW_TOLERANCE = 1.1;

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nodeLabel(node: FigureNode): string {
  return node.name?.trim() || node.type;
}

function isNone(value: string | undefined | null): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return !text || text === 'none' || text === 'transparent';
}

function isVisible(doc: FigureDocument, node: FigureNode): boolean {
  if (node.hidden || node.opacity <= 0) return false;
  if (!node.groupId) return true;
  const group = doc.groups.find((candidate) => candidate.id === node.groupId);
  return !group?.hidden;
}

// ------------------------------------------------------------------ typography

function fontPt(node: FigureNode): number | null {
  if (node.type === 'text' || node.type === 'chart' || node.type === 'scalebar') {
    return Number.isFinite(node.fontSize) ? node.fontSize : null;
  }
  return null;
}

function checkFont(node: FigureNode): ComplianceIssue | null {
  const size = fontPt(node);
  if (size === null) return null;
  const params = { name: nodeLabel(node), size: round(size) };
  if (size < FONT_TINY_PT) {
    return {
      id: `fontTiny:${node.id}`,
      severity: 'error',
      code: 'fontTiny',
      nodeId: node.id,
      name: nodeLabel(node),
      params,
    };
  }
  if (size < FONT_SMALL_PT) {
    return {
      id: `fontSmall:${node.id}`,
      severity: 'warn',
      code: 'fontSmall',
      nodeId: node.id,
      name: nodeLabel(node),
      params,
    };
  }
  return null;
}

// --------------------------------------------------------------------- strokes

function checkStroke(node: FigureNode): ComplianceIssue | null {
  // Text has its own colour field and no outline; assets and images never
  // stroke their boxes in the renderer.
  if (node.type === 'text' || node.type === 'asset' || node.type === 'image') return null;
  if (isNone(node.stroke)) return null;
  const widthPx = node.strokeWidth;
  if (!Number.isFinite(widthPx) || widthPx <= 0) return null;
  const widthPt = widthPx * 0.75;
  if (widthPt >= STROKE_MIN_PT) return null;
  return {
    id: `strokeThin:${node.id}`,
    severity: 'warn',
    code: 'strokeThin',
    nodeId: node.id,
    name: nodeLabel(node),
    params: { name: nodeLabel(node), size: round(widthPt) },
  };
}

// ---------------------------------------------------------------------- images

function checkImage(
  node: FigureNode,
  imageSizes: Map<string, ImagePixelSize>,
): ComplianceIssue | null {
  if (node.type !== 'image') return null;
  // Node id is the canonical key; data URLs are accepted as a convenience for
  // callers that measure images before creating the node-level cache.
  const pixels = imageSizes.get(node.id) ?? (node.dataUrl ? imageSizes.get(node.dataUrl) : undefined);
  if (!pixels) return null;
  if (
    !Number.isFinite(pixels.width) ||
    !Number.isFinite(pixels.height) ||
    pixels.width <= 0 ||
    pixels.height <= 0 ||
    node.w <= 0 ||
    node.h <= 0
  ) {
    return null;
  }
  const dpiX = pixels.width / (node.w / 96);
  const dpiY = pixels.height / (node.h / 96);
  const dpi = Math.min(dpiX, dpiY);
  if (!Number.isFinite(dpi) || dpi <= 0) return null;

  const params = { name: nodeLabel(node), dpi: Math.round(dpi) };
  if (dpi < IMAGE_VERY_LOW_DPI) {
    return {
      id: `imageVeryLowDpi:${node.id}`,
      severity: 'error',
      code: 'imageVeryLowDpi',
      nodeId: node.id,
      name: nodeLabel(node),
      params,
    };
  }
  if (dpi < IMAGE_LOW_DPI) {
    return {
      id: `imageLowDpi:${node.id}`,
      severity: 'warn',
      code: 'imageLowDpi',
      nodeId: node.id,
      name: nodeLabel(node),
      params,
    };
  }
  return null;
}

// ------------------------------------------------------------------ colour math

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  let rgb: [number, number, number];
  if (value.length === 3 || value.length === 4) {
    rgb = [
      parseInt(value[0] + value[0], 16),
      parseInt(value[1] + value[1], 16),
      parseInt(value[2] + value[2], 16),
    ];
  } else if (value.length === 6 || value.length === 8) {
    rgb = [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  } else {
    return null;
  }
  return rgb;
}

/** Parse the common CSS colour forms used by chart series. */
function parseColor(input: string | undefined): [number, number, number] | null {
  const text = (input ?? '').trim().toLowerCase();
  if (!text || text === 'none' || text === 'transparent') return null;
  if (text.startsWith('#')) return parseHex(text);
  const match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/.exec(text);
  if (match) {
    const rgb: [number, number, number] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    return rgb.every((channel) => Number.isFinite(channel)) ? rgb : null;
  }
  return NAMED_COLORS[text] ?? null;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labFromRgb([r, g, b]: [number, number, number]): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // sRGB (D65) to XYZ.
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;

  const fx = labF(x / 0.95047);
  const fy = labF(y / 1);
  const fz = labF(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labF(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const la = labFromRgb(a);
  const lb = labFromRgb(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

function checkSeriesColors(node: FigureNode): ComplianceIssue[] {
  if (node.type !== 'chart') return [];
  const issues: ComplianceIssue[] = [];
  for (let i = 0; i < node.series.length; i++) {
    const first = node.series[i];
    const firstColor = parseColor(first.color);
    if (!firstColor) continue;
    for (let j = i + 1; j < node.series.length; j++) {
      const second = node.series[j];
      const secondColor = parseColor(second.color);
      if (!secondColor) continue;
      if (colorDistance(firstColor, secondColor) >= SERIES_COLOR_DISTANCE) continue;
      issues.push({
        id: `seriesColorsClose:${node.id}:${i}-${j}`,
        severity: 'warn',
        code: 'seriesColorsClose',
        nodeId: node.id,
        name: nodeLabel(node),
        params: {
          a: first.name?.trim() || `Series ${i + 1}`,
          b: second.name?.trim() || `Series ${j + 1}`,
        },
      });
    }
  }
  return issues;
}

// ----------------------------------------------------------------- text fit

function longestLineWidthPx(node: TextNode): number {
  const fontSizePx = Math.max(0, node.fontSize) * PT_TO_PX;
  let longest = 0;
  for (const raw of node.text.split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const chars = [...line].length;
    longest = Math.max(longest, chars * fontSizePx * GLYPH_WIDTH_FACTOR);
  }
  return longest;
}

function checkTextOverflow(node: FigureNode): ComplianceIssue | null {
  if (node.type !== 'text') return null;
  if (!node.text.trim()) return null;
  const padding = Math.max(0, node.padding);
  const available = node.w - padding * 2;
  const longest = longestLineWidthPx(node);
  if (available <= 0 || longest > available * OVERFLOW_TOLERANCE) {
    return {
      id: `textOverflow:${node.id}`,
      severity: 'warn',
      code: 'textOverflow',
      nodeId: node.id,
      name: nodeLabel(node),
      params: { name: nodeLabel(node) },
    };
  }
  return null;
}

// --------------------------------------------------------------------- driver

/**
 * Run every publication check against a document.
 *
 * `imageSizes` is keyed by image node id. Images without an entry are skipped,
 * as are vector asset nodes; their resolution is not meaningful.
 */
export function checkFigure(
  doc: FigureDocument,
  imageSizes: Map<string, ImagePixelSize> = new Map(),
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const node of doc.nodes) {
    if (!isVisible(doc, node)) continue;
    const font = checkFont(node);
    if (font) issues.push(font);
    const stroke = checkStroke(node);
    if (stroke) issues.push(stroke);
    const image = checkImage(node, imageSizes);
    if (image) issues.push(image);
    issues.push(...checkSeriesColors(node));
    const overflow = checkTextOverflow(node);
    if (overflow) issues.push(overflow);
  }

  // Stable sort: severity first, then document order. Issues for the same node
  // keep the order in which the checks produced them.
  const order = new Map<string, number>();
  doc.nodes.forEach((node, index) => order.set(node.id, index));
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const severity =
        SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity];
      if (severity !== 0) return severity;
      const aIndex = a.issue.nodeId ? (order.get(a.issue.nodeId) ?? Infinity) : Infinity;
      const bIndex = b.issue.nodeId ? (order.get(b.issue.nodeId) ?? Infinity) : Infinity;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.index - b.index;
    })
    .map(({ issue }) => issue);
}

export function complianceCounts(issues: ComplianceIssue[]): Counts {
  let errors = 0;
  let warns = 0;
  let infos = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors++;
    else if (issue.severity === 'warn') warns++;
    else infos++;
  }
  return { errors, warns, infos, total: issues.length };
}
