// Vector figure model for Figure Studio.
//
// The document is plain JSON. Geometry is stored in CSS pixels at 96 dpi;
// physical page dimensions live in millimetres so exports can target print
// sizes while the editor keeps one consistent coordinate system.

export const FIGURE_FORMAT = 'SPICE_FIGURE';
export const FIGURE_VERSION = 1;
export const MM_TO_PX = 96 / 25.4;
export const PX_TO_MM = 25.4 / 96;
export const PT_TO_PX = 96 / 72;

export type FigureNodeType =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'asset'
  | 'image'
  | 'chart'
  | 'scalebar'
  | 'path';

export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
export type ImageFit = 'contain' | 'cover' | 'stretch';
export type ChartKind = 'bar' | 'line' | 'scatter';

/** Source rectangle in 0..1 fractions of the original image. */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  values: number[];
  /** Absolute error per value; ignored unless the chart enables error bars. */
  errors: number[];
}

export interface ChartSignificance {
  id: string;
  /** Category index the bracket starts at. */
  from: number;
  /** Category index the bracket ends at. */
  to: number;
  label: string;
}

export interface FigureGroup {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
}

export interface FigureNodeBase {
  id: string;
  type: FigureNodeType;
  name: string;
  /** Top-left in figure CSS pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise around the node centre. */
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  groupId?: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  cornerRadius: number;
}

export interface RectNode extends FigureNodeBase {
  type: 'rect';
}

export interface EllipseNode extends FigureNodeBase {
  type: 'ellipse';
}

/** A straight segment inside its bounding box. `direction` chooses the
 *  diagonal used, so resizing and rotation stay predictable. */
export interface LineNode extends FigureNodeBase {
  type: 'line' | 'arrow';
  direction: 'diagonal' | 'horizontal' | 'vertical';
  headStart: boolean;
  headEnd: boolean;
  headSize: number;
}

export interface TextNode extends FigureNodeBase {
  type: 'text';
  text: string;
  fontFamily: string;
  /** Points, like SVG/print typography. */
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  italic: boolean;
  align: TextAlign;
  lineHeight: number;
  padding: number;
  /** Text colour; separate from the outline `stroke`. */
  color: string;
  background: string;
}

export interface AssetNode extends FigureNodeBase {
  type: 'asset';
  assetId: string;
  label: string;
  sourceUrl: string;
  license: string;
  creator: string;
  credit: string;
  citation: string;
  /** Bundled SVG path, relative to the app root. */
  svgFile: string;
  flipX: boolean;
  flipY: boolean;
  /** Optional tint applied with an SVG filter during rendering. */
  tint: string;
}

export interface ImageNode extends FigureNodeBase {
  type: 'image';
  dataUrl: string;
  mime: string;
  fit: ImageFit;
  flipX: boolean;
  flipY: boolean;
  /** Missing on older documents, which means the full image. */
  crop?: ImageCrop;
  /** Keep width and height proportional while resizing. */
  lockAspect?: boolean;
}

export interface ChartNode extends FigureNodeBase {
  type: 'chart';
  chartType: ChartKind;
  labels: string[];
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  /** null lets the renderer choose a sensible domain. */
  yMin: number | null;
  yMax: number | null;
  showLegend: boolean;
  showGrid: boolean;
  showValues: boolean;
  showErrorBars: boolean;
  significance: ChartSignificance[];
  fontFamily: string;
  fontSize: number;
  textColor: string;
  plotBackground: string;
}

export interface PathPoint {
  /** Normalised 0..1 inside the node bounds, so resizing scales the path. */
  x: number;
  y: number;
}

export interface PathNode extends FigureNodeBase {
  type: 'path';
  points: PathPoint[];
  closed: boolean;
  headStart: boolean;
  headEnd: boolean;
  headSize: number;
}

export interface ScaleBarNode extends FigureNodeBase {
  type: 'scalebar';
  label: string;
  thickness: number;
  /** Draw end caps at both ends of the bar. */
  ticks: boolean;
  fontFamily: string;
  fontSize: number;
  textColor: string;
}

export type FigureNode =
  | RectNode
  | EllipseNode
  | LineNode
  | TextNode
  | AssetNode
  | ImageNode
  | ChartNode
  | ScaleBarNode
  | PathNode;

export interface FigureGrid {
  show: boolean;
  snap: boolean;
  sizeMm: number;
}

export interface FigureDocument {
  format: typeof FIGURE_FORMAT;
  version: typeof FIGURE_VERSION;
  name: string;
  widthMm: number;
  heightMm: number;
  background: string;
  grid: FigureGrid;
  nodes: FigureNode[];
  groups: FigureGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetManifestEntry {
  id: string;
  title: string;
  category: string;
  tags: string[];
  file: string;
  license: string;
  creator: string;
  credit: string;
  citation: string;
  sourceUrl: string;
  sha256: string;
  width: number;
  height: number;
}

export interface AssetManifest {
  version: 1;
  generatedAt: string;
  source: string;
  licenseNote: string;
  assets: AssetManifestEntry[];
}

export const FIGURE_PRESETS = [
  { id: 'single', label: 'Single column', widthMm: 90, heightMm: 120 },
  { id: 'double', label: 'Double column', widthMm: 180, heightMm: 120 },
  { id: 'slide', label: 'Slide 16:9', widthMm: 338.7, heightMm: 190.5 },
  { id: 'poster', label: 'Poster A0', widthMm: 841, heightMm: 1189 },
  { id: 'square', label: 'Square', widthMm: 120, heightMm: 120 },
] as const;

export const FIGURE_FONTS = [
  'Arial',
  'Helvetica',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
] as const;

export const DEFAULT_FIGURE_FONT = 'Arial';

export function createFigureId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

export function pxToMm(px: number): number {
  return px * PX_TO_MM;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createFigureDocument(
  name = 'Figure',
  widthMm = 180,
  heightMm = 120,
): FigureDocument {
  const now = new Date().toISOString();
  return {
    format: FIGURE_FORMAT,
    version: FIGURE_VERSION,
    name,
    widthMm,
    heightMm,
    background: '#ffffff',
    grid: { show: true, snap: true, sizeMm: 2 },
    nodes: [],
    groups: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function documentWidthPx(doc: FigureDocument): number {
  return Math.max(1, mmToPx(doc.widthMm));
}

export function documentHeightPx(doc: FigureDocument): number {
  return Math.max(1, mmToPx(doc.heightMm));
}

export function baseNode(
  type: FigureNodeType,
  x: number,
  y: number,
  w: number,
  h: number,
): FigureNodeBase {
  return {
    id: createFigureId('node'),
    type,
    name: type,
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: '#e8f1f8',
    stroke: '#1f6f8b',
    strokeWidth: 1.5,
    dash: 'solid',
    cornerRadius: 0,
  };
}

export function createRectNode(x: number, y: number, w = 160, h = 90): RectNode {
  return { ...baseNode('rect', x, y, w, h), type: 'rect', name: 'Rectangle' };
}

export function createEllipseNode(x: number, y: number, w = 120, h = 80): EllipseNode {
  return {
    ...baseNode('ellipse', x, y, w, h),
    type: 'ellipse',
    name: 'Ellipse',
    fill: '#fdf0e6',
    stroke: '#c46a1b',
  };
}

export function createLineNode(
  x: number,
  y: number,
  w: number,
  h: number,
  arrow = true,
): LineNode {
  return {
    ...baseNode(arrow ? 'arrow' : 'line', x, y, w, h),
    type: arrow ? 'arrow' : 'line',
    name: arrow ? 'Arrow' : 'Line',
    fill: 'none',
    stroke: '#263238',
    strokeWidth: 2,
    direction: Math.abs(w) >= Math.abs(h) ? 'horizontal' : 'vertical',
    headStart: false,
    headEnd: arrow,
    headSize: 12,
  };
}

export function createTextNode(x: number, y: number, text = 'Text'): TextNode {
  const node = baseNode('text', x, y, 180, 48);
  return {
    ...node,
    type: 'text',
    name: text.slice(0, 28) || 'Text',
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    text,
    fontFamily: DEFAULT_FIGURE_FONT,
    fontSize: 12,
    fontWeight: 400,
    italic: false,
    align: 'left',
    lineHeight: 1.25,
    padding: 4,
    color: '#111827',
    background: 'none',
  };
}

export function createAssetNode(
  asset: AssetManifestEntry,
  x: number,
  y: number,
  w = 150,
  h = 150,
): AssetNode {
  const ratio = asset.height > 0 ? asset.width / asset.height : 1;
  const height = Math.max(20, w / Math.max(0.05, ratio));
  const node = baseNode('asset', x, y, w, height);
  return {
    ...node,
    type: 'asset',
    name: asset.title,
    w,
    h: height,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    assetId: asset.id,
    label: asset.title,
    sourceUrl: asset.sourceUrl,
    license: asset.license,
    creator: asset.creator,
    credit: asset.credit,
    citation: asset.citation,
    svgFile: asset.file,
    flipX: false,
    flipY: false,
    tint: '',
  };
}

export function createImageNode(
  dataUrl: string,
  mime: string,
  x: number,
  y: number,
  w = 200,
  h = 150,
): ImageNode {
  const node = baseNode('image', x, y, w, h);
  return {
    ...node,
    type: 'image',
    name: 'Image',
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    dataUrl,
    mime,
    fit: 'contain',
    flipX: false,
    flipY: false,
  };
}

export const CHART_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be185d',
  '#65a30d',
] as const;

export function createChartNode(x: number, y: number, w = 320, h = 220): ChartNode {
  const node = baseNode('chart', x, y, w, h);
  return {
    ...node,
    type: 'chart',
    name: 'Chart',
    fill: 'none',
    stroke: '#475569',
    strokeWidth: 1,
    chartType: 'bar',
    labels: ['Control', 'Treatment', 'Rescue'],
    series: [
      {
        id: createFigureId('series'),
        name: 'Relative signal',
        color: CHART_PALETTE[0],
        values: [1, 1.8, 1.2],
        errors: [0.1, 0.18, 0.14],
      },
    ],
    xLabel: '',
    yLabel: 'Relative signal',
    yMin: null,
    yMax: null,
    showLegend: true,
    showGrid: true,
    showValues: false,
    showErrorBars: true,
    significance: [{ id: createFigureId('sig'), from: 0, to: 1, label: '*' }],
    fontFamily: DEFAULT_FIGURE_FONT,
    fontSize: 10,
    textColor: '#334155',
    plotBackground: 'none',
  };
}

export function createPathNode(
  points: PathPoint[],
  x: number,
  y: number,
  w: number,
  h: number,
  closed = false,
): PathNode {
  const node = baseNode('path', x, y, w, h);
  return {
    ...node,
    type: 'path',
    name: 'Path',
    fill: closed ? '#e8f1f8' : 'none',
    stroke: '#263238',
    strokeWidth: 2,
    points: points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    closed,
    headStart: false,
    headEnd: !closed,
    headSize: 12,
  };
}

export function createScaleBarNode(x: number, y: number, w = 120, h = 38): ScaleBarNode {
  const node = baseNode('scalebar', x, y, w, h);
  return {
    ...node,
    type: 'scalebar',
    name: 'Scale bar',
    fill: 'none',
    stroke: '#111827',
    strokeWidth: 4,
    label: '10 µm',
    thickness: 4,
    ticks: true,
    fontFamily: DEFAULT_FIGURE_FONT,
    fontSize: 10,
    textColor: '#111827',
  };
}

/** Axis-aligned bounds of a rotated node, in figure coordinates. */
export function nodeBounds(node: FigureNode): { x: number; y: number; w: number; h: number } {
  if (!node.rotation) return { x: node.x, y: node.y, w: node.w, h: node.h };
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const rad = (node.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = node.w * cos + node.h * sin;
  const h = node.w * sin + node.h * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function groupMembers(doc: FigureDocument, groupId: string): FigureNode[] {
  return doc.nodes.filter((node) => node.groupId === groupId);
}

export function selectionWithGroups(doc: FigureDocument, ids: string[]): string[] {
  const out = new Set<string>();
  const selectedGroups = new Set<string>();
  for (const id of ids) {
    const node = doc.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    if (node.groupId) selectedGroups.add(node.groupId);
    out.add(id);
  }
  for (const groupId of selectedGroups) {
    for (const node of groupMembers(doc, groupId)) out.add(node.id);
  }
  return [...out];
}

export function dedupeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}
