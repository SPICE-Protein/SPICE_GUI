// Sanitising layer for Figure Studio documents.
//
// Documents arrive as untrusted JSON: local `.spicefig` files, clipboard
// payloads and autosaved drafts from older releases. This module validates the
// envelope, clamps every numeric field into a renderable range, drops malformed
// nodes and repairs dangling group references. Nothing here touches the DOM.
import {
  DEFAULT_FIGURE_FONT,
  FIGURE_FORMAT,
  FIGURE_VERSION,
  clamp,
  type AssetNode,
  type ChartKind,
  type ChartNode,
  type ChartSeries,
  type ChartSignificance,
  type DashStyle,
  type EllipseNode,
  type FigureDocument,
  type FigureGroup,
  type FigureNode,
  type FigureNodeBase,
  type FigureNodeType,
  type ImageCrop,
  type ImageFit,
  type ImageNode,
  type LineNode,
  type PathNode,
  type PathPoint,
  type RectNode,
  type ScaleBarNode,
  type TextAlign,
  type TextNode,
} from './types';

const MIN_PAGE_MM = 10;
const MAX_PAGE_MM = 2000;
const MIN_NODE_SIZE = 1;

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function num(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function numClamped(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(num(value, fallback), min, max);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? value : null;
}

/** Accept any CSS colour string; only non-string values fall back. */
function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.trim() ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isValidType(value: unknown): value is FigureNodeType {
  return (
    value === 'rect' ||
    value === 'ellipse' ||
    value === 'line' ||
    value === 'arrow' ||
    value === 'text' ||
    value === 'asset' ||
    value === 'image' ||
    value === 'chart' ||
    value === 'scalebar' ||
    value === 'path'
  );
}

function isValidChartKind(value: unknown): value is ChartKind {
  return value === 'bar' || value === 'line' || value === 'scatter';
}

function isValidDash(value: unknown): value is DashStyle {
  return value === 'solid' || value === 'dashed' || value === 'dotted';
}

function validAlign(value: unknown): value is TextAlign {
  return value === 'left' || value === 'center' || value === 'right';
}

function validFit(value: unknown): value is ImageFit {
  return value === 'contain' || value === 'cover' || value === 'stretch';
}

function defaultFill(type: FigureNodeType): string {
  if (type === 'rect') return '#e8f1f8';
  if (type === 'ellipse') return '#fdf0e6';
  return 'none';
}

function defaultStroke(type: FigureNodeType): string {
  if (type === 'rect') return '#1f6f8b';
  if (type === 'ellipse') return '#c46a1b';
  if (type === 'line' || type === 'arrow') return '#263238';
  if (type === 'chart') return '#475569';
  if (type === 'scalebar') return '#111827';
  if (type === 'path') return '#263238';
  return 'none';
}

function defaultStrokeWidth(type: FigureNodeType): number {
  if (type === 'line' || type === 'arrow') return 2;
  if (type === 'rect' || type === 'ellipse') return 1.5;
  if (type === 'chart') return 1;
  if (type === 'scalebar') return 4;
  if (type === 'path') return 2;
  return 0;
}

function parseBase(src: AnyRecord, type: FigureNodeType, id: string): FigureNodeBase {
  const groupId = nonEmptyString(src.groupId);
  return {
    id,
    type,
    name: str(src.name, type),
    x: num(src.x, 0),
    y: num(src.y, 0),
    w: Math.max(MIN_NODE_SIZE, num(src.w, 40)),
    h: Math.max(MIN_NODE_SIZE, num(src.h, 30)),
    rotation: numClamped(src.rotation, 0, -360, 360),
    opacity: numClamped(src.opacity, 1, 0, 1),
    locked: bool(src.locked, false),
    hidden: bool(src.hidden, false),
    ...(groupId ? { groupId } : {}),
    fill: color(src.fill, defaultFill(type)),
    stroke: color(src.stroke, defaultStroke(type)),
    strokeWidth: numClamped(src.strokeWidth, defaultStrokeWidth(type), 0, 40),
    dash: isValidDash(src.dash) ? src.dash : 'solid',
    cornerRadius: numClamped(src.cornerRadius, 0, 0, 200),
  };
}

function parseLine(src: AnyRecord, base: FigureNodeBase, type: 'line' | 'arrow'): LineNode {
  const direction =
    src.direction === 'horizontal' || src.direction === 'vertical' || src.direction === 'diagonal'
      ? src.direction
      : 'diagonal';
  return {
    ...base,
    type,
    direction,
    headStart: bool(src.headStart, false),
    headEnd: bool(src.headEnd, type === 'arrow'),
    headSize: numClamped(src.headSize, 12, 1, 200),
  };
}

function parseText(src: AnyRecord, base: FigureNodeBase): TextNode {
  const weight = src.fontWeight;
  const fontWeight: TextNode['fontWeight'] =
    weight === 400 || weight === 500 || weight === 600 || weight === 700 || weight === 800
      ? weight
      : 400;
  return {
    ...base,
    type: 'text',
    text: src.text as string,
    fontFamily: str(src.fontFamily, DEFAULT_FIGURE_FONT),
    fontSize: numClamped(src.fontSize, 12, 4, 300),
    fontWeight,
    italic: bool(src.italic, false),
    align: validAlign(src.align) ? src.align : 'left',
    lineHeight: numClamped(src.lineHeight, 1.25, 0.8, 3),
    padding: numClamped(src.padding, 4, 0, 80),
    color: color(src.color, '#111827'),
    background: color(src.background, 'none'),
  };
}

function parseAsset(src: AnyRecord, base: FigureNodeBase, assetId: string, svgFile: string): AssetNode {
  return {
    ...base,
    type: 'asset',
    assetId,
    label: str(src.label, ''),
    sourceUrl: str(src.sourceUrl, ''),
    license: str(src.license, ''),
    creator: str(src.creator, ''),
    credit: str(src.credit, ''),
    citation: str(src.citation, ''),
    svgFile,
    flipX: bool(src.flipX, false),
    flipY: bool(src.flipY, false),
    tint: color(src.tint, ''),
  };
}

function parseCrop(value: unknown): ImageCrop | undefined {
  if (!isRecord(value)) return undefined;
  const x = numClamped(value.x, 0, 0, 0.99);
  const y = numClamped(value.y, 0, 0, 0.99);
  const w = numClamped(value.w, 1, 0.01, 1 - x);
  const h = numClamped(value.h, 1, 0.01, 1 - y);
  return { x, y, w, h };
}

function parseImage(src: AnyRecord, base: FigureNodeBase, dataUrl: string): ImageNode {
  const crop = parseCrop(src.crop);
  return {
    ...base,
    type: 'image',
    dataUrl,
    mime: str(src.mime, 'image/png'),
    fit: validFit(src.fit) ? src.fit : 'contain',
    flipX: bool(src.flipX, false),
    flipY: bool(src.flipY, false),
    ...(crop ? { crop } : {}),
    lockAspect: bool(src.lockAspect, false),
  };
}

function parseSeries(value: unknown, index: number): ChartSeries | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id) ?? `series_${index + 1}`;
  const values = Array.isArray(value.values)
    ? value.values.slice(0, 500).map((item) => num(item, 0))
    : [];
  const errors = Array.isArray(value.errors)
    ? value.errors.slice(0, 500).map((item) => Math.abs(num(item, 0)))
    : [];
  return {
    id,
    name: str(value.name, `Series ${index + 1}`),
    color: color(value.color, '#2563eb'),
    values,
    errors,
  };
}

function parseSignificance(value: unknown, count: number, index: number): ChartSignificance | null {
  if (!isRecord(value)) return null;
  if (count < 2) return null;
  const from = clamp(Math.round(num(value.from, 0)), 0, count - 1);
  const to = clamp(Math.round(num(value.to, count - 1)), 0, count - 1);
  if (from === to) return null;
  return {
    id: nonEmptyString(value.id) ?? `sig_${index + 1}`,
    from: Math.min(from, to),
    to: Math.max(from, to),
    label: str(value.label, '*'),
  };
}

function parseChart(src: AnyRecord, base: FigureNodeBase): ChartNode {
  const labels = Array.isArray(src.labels)
    ? src.labels.slice(0, 200).map((label) => String(label ?? ''))
    : [];
  const series: ChartSeries[] = [];
  if (Array.isArray(src.series)) {
    for (const [index, raw] of src.series.slice(0, 24).entries()) {
      const parsed = parseSeries(raw, index);
      if (parsed) series.push(parsed);
    }
  }
  const significance: ChartSignificance[] = [];
  if (Array.isArray(src.significance)) {
    for (const [index, raw] of src.significance.slice(0, 100).entries()) {
      const parsed = parseSignificance(raw, labels.length, index);
      if (parsed) significance.push(parsed);
    }
  }
  return {
    ...base,
    type: 'chart',
    chartType: isValidChartKind(src.chartType) ? src.chartType : 'bar',
    labels,
    series,
    xLabel: str(src.xLabel, ''),
    yLabel: str(src.yLabel, ''),
    yMin: isFiniteNumber(src.yMin) ? src.yMin : null,
    yMax: isFiniteNumber(src.yMax) ? src.yMax : null,
    showLegend: bool(src.showLegend, true),
    showGrid: bool(src.showGrid, true),
    showValues: bool(src.showValues, false),
    showErrorBars: bool(src.showErrorBars, true),
    significance,
    fontFamily: str(src.fontFamily, DEFAULT_FIGURE_FONT),
    fontSize: numClamped(src.fontSize, 10, 5, 72),
    textColor: color(src.textColor, '#334155'),
    plotBackground: color(src.plotBackground, 'none'),
  };
}

function parsePathPoint(value: unknown): PathPoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y)
      ? { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
      : null;
  }
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
}

function parsePath(src: AnyRecord, base: FigureNodeBase): PathNode | null {
  if (!Array.isArray(src.points)) return null;
  const points: PathPoint[] = [];
  for (const raw of src.points.slice(0, 5000)) {
    const point = parsePathPoint(raw);
    if (point) points.push(point);
  }
  if (points.length < 2) return null;
  return {
    ...base,
    type: 'path',
    fill: color(src.fill, 'none'),
    stroke: color(src.stroke, '#263238'),
    strokeWidth: numClamped(src.strokeWidth, 2, 0, 40),
    points,
    closed: bool(src.closed, false),
    headStart: bool(src.headStart, false),
    headEnd: bool(src.headEnd, !bool(src.closed, false)),
    headSize: numClamped(src.headSize, 12, 1, 200),
  };
}

function parseScaleBar(src: AnyRecord, base: FigureNodeBase): ScaleBarNode {
  return {
    ...base,
    type: 'scalebar',
    label: str(src.label, ''),
    thickness: numClamped(src.thickness, 4, 0.5, 40),
    ticks: bool(src.ticks, true),
    fontFamily: str(src.fontFamily, DEFAULT_FIGURE_FONT),
    fontSize: numClamped(src.fontSize, 10, 5, 72),
    textColor: color(src.textColor, '#111827'),
  };
}

/** Returns a sanitised node, or null when the payload is unusable. */
function parseNode(value: unknown): FigureNode | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  if (!id) return null;
  if (!isValidType(value.type)) return null;
  const type = value.type;
  const base = parseBase(value, type, id);

  switch (type) {
    case 'rect':
      return { ...base, type: 'rect' } satisfies RectNode;
    case 'ellipse':
      return { ...base, type: 'ellipse' } satisfies EllipseNode;
    case 'line':
    case 'arrow':
      return parseLine(value, base, type);
    case 'text':
      if (typeof value.text !== 'string') return null;
      return parseText(value, base);
    case 'asset': {
      const assetId = nonEmptyString(value.assetId);
      const svgFile = nonEmptyString(value.svgFile);
      if (!assetId || !svgFile) return null;
      return parseAsset(value, base, assetId, svgFile);
    }
    case 'image': {
      if (typeof value.dataUrl !== 'string' || !/^data:image\//i.test(value.dataUrl)) return null;
      return parseImage(value, base, value.dataUrl);
    }
    case 'chart':
      return parseChart(value, base);
    case 'scalebar':
      return parseScaleBar(value, base);
    case 'path':
      return parsePath(value, base);
  }
}

function parseGroup(value: unknown): FigureGroup | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  if (!id) return null;
  return {
    id,
    name: str(value.name, 'Group'),
    hidden: bool(value.hidden, false),
    locked: bool(value.locked, false),
  };
}

function parseGrid(value: unknown): FigureDocument['grid'] {
  const src = isRecord(value) ? value : {};
  return {
    show: bool(src.show, true),
    snap: bool(src.snap, true),
    sizeMm: numClamped(src.sizeMm, 2, 0.5, 50),
  };
}

/**
 * Accepts untrusted JSON and returns a sanitised document, or null when the
 * envelope is not a supported Figure Studio file.
 */
export function normalizeFigureDocument(value: unknown): FigureDocument | null {
  if (!isRecord(value)) return null;
  if (value.format !== FIGURE_FORMAT || value.version !== FIGURE_VERSION) return null;
  if (!isFiniteNumber(value.widthMm) || !isFiniteNumber(value.heightMm)) return null;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.groups)) return null;

  const groups: FigureGroup[] = [];
  const groupIds = new Set<string>();
  for (const raw of value.groups) {
    const group = parseGroup(raw);
    if (group && !groupIds.has(group.id)) {
      groupIds.add(group.id);
      groups.push(group);
    }
  }

  const nodes: FigureNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of value.nodes) {
    const node = parseNode(raw);
    if (!node || nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    // Dangling groups would keep the node moving with an invisible selection.
    if (node.groupId && !groupIds.has(node.groupId)) {
      const { groupId: _dangling, ...rest } = node;
      nodes.push(rest as FigureNode);
    } else {
      nodes.push(node);
    }
  }

  const now = new Date().toISOString();
  return {
    format: FIGURE_FORMAT,
    version: FIGURE_VERSION,
    name: str(value.name, 'Figure'),
    widthMm: clamp(value.widthMm, MIN_PAGE_MM, MAX_PAGE_MM),
    heightMm: clamp(value.heightMm, MIN_PAGE_MM, MAX_PAGE_MM),
    background: color(value.background, '#ffffff'),
    grid: parseGrid(value.grid),
    nodes,
    groups,
    createdAt: str(value.createdAt, now),
    updatedAt: str(value.updatedAt, now),
  };
}

/** Pretty JSON suitable for a `.spicefig` download. */
export function figureDocumentJson(doc: FigureDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Parse a `.spicefig` text payload, returning null on invalid JSON. */
export function parseFigureDocumentText(text: string): FigureDocument | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return normalizeFigureDocument(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
