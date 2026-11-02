// Data model for the scientific image annotator and multi-panel composer.
// Everything is plain JSON so the whole project can be exported, autosaved in
// localStorage and restored without any binary sidecar files.

export const PX_PER_MM = 96 / 25.4;
export const PT_TO_PX = 96 / 72;

export type Unit = 'um' | 'mm' | 'nm' | 'px';
export type TemplateFlow = 'row' | 'column';
export type LabelStyle = 'upper' | 'lower' | 'number';
export type LabelPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';

const UNIT_SYMBOL: Record<Unit, string> = {
  um: 'µm',
  mm: 'mm',
  nm: 'nm',
  px: 'px',
};

/** SI factors for conversion. Pixels are not a physical unit. */
const UNIT_FACTOR: Record<Exclude<Unit, 'px'>, number> = {
  nm: 1e-9,
  um: 1e-6,
  mm: 1e-3,
};

export function unitSymbol(unit: Unit): string {
  return UNIT_SYMBOL[unit];
}

export function isPhysicalUnit(unit: Unit): unit is Exclude<Unit, 'px'> {
  return unit !== 'px';
}

export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Calibration {
  unit: Unit;
  /** Source-image pixels per one display unit. */
  pxPerUnit: number;
}

export interface Panel {
  id: string;
  name: string;
  /** Embedded raster, always a data URL (TIFF is re-encoded to PNG). */
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
  crop: CropRect;
  /** Magnification inside the frame. 1 shows the whole crop. */
  zoom: number;
  /** Pan expressed relative to the maximum shift for the current zoom. */
  offsetX: number;
  offsetY: number;
  brightness: number;
  contrast: number;
  calibration: Calibration | null;
}

export interface LayoutSettings {
  columns: number;
  flow: TemplateFlow;
  gapMm: number;
  marginMm: number;
  figureWidthMm: number;
  labelStyle: LabelStyle;
  labelPosition: LabelPosition;
  labelFontSizePt: number;
  labelColor: string;
  background: string;
  fontFamily: string;
  exportDpi: 300 | 600;
}

interface AnnotationBase {
  id: string;
  color: string;
}

export interface ArrowAnnotation extends AnnotationBase {
  kind: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidthPt: number;
  headSizePt: number;
}

export interface RectAnnotation extends AnnotationBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  strokeWidthPt: number;
  fill: string;
}

export interface EllipseAnnotation extends AnnotationBase {
  kind: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  strokeWidthPt: number;
  fill: string;
}

export interface TextAnnotation extends AnnotationBase {
  kind: 'text';
  /** Top-left corner of the text block, in figure CSS pixels. */
  x: number;
  y: number;
  text: string;
  fontSizePt: number;
  background: string;
  paddingPt: number;
}

export interface ScaleBarAnnotation extends AnnotationBase {
  kind: 'scalebar';
  x: number;
  y: number;
  mode: 'calibrated' | 'fixed';
  /** Physical length in `unit` (calibrated) or millimetres (fixed). */
  value: number;
  unit: Unit;
  panelId: string;
  thicknessPt: number;
  fontSizePt: number;
  showLabel: boolean;
}

export interface PanelBarAnnotation extends AnnotationBase {
  kind: 'panelbar';
  panelId: string;
  /** Normalized start position inside the panel frame. */
  nx: number;
  ny: number;
  value: number;
  unit: Unit;
  thicknessPt: number;
  fontSizePt: number;
  showLabel: boolean;
}

export type Annotation =
  | ArrowAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | TextAnnotation
  | ScaleBarAnnotation
  | PanelBarAnnotation;

export type DrawTool = 'select' | 'pan' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'scalebar' | 'panelbar';
export type ActiveTool = DrawTool | 'calibrate';

export interface AnnotateProject {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  panels: Panel[];
  annotations: Annotation[];
  layout: LayoutSettings;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  columns: 2,
  flow: 'row',
  gapMm: 2,
  marginMm: 2,
  figureWidthMm: 180,
  labelStyle: 'upper',
  labelPosition: 'tl',
  labelFontSizePt: 12,
  labelColor: '#111111',
  background: '#ffffff',
  fontFamily: 'Arial',
  exportDpi: 300,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultLayout(): LayoutSettings {
  return { ...DEFAULT_LAYOUT };
}

export function createDefaultProject(): AnnotateProject {
  const now = new Date().toISOString();
  return {
    version: 1,
    name: 'Figure',
    createdAt: now,
    updatedAt: now,
    panels: [],
    annotations: [],
    layout: createDefaultLayout(),
  };
}

/** Crop values are normalized and kept inside a valid non-empty region. */
export function safeCrop(panel: Panel): CropRect {
  const left = clamp(panel.crop.left, 0, 0.9);
  const right = clamp(panel.crop.right, 0, 0.9 - left);
  const top = clamp(panel.crop.top, 0, 0.9);
  const bottom = clamp(panel.crop.bottom, 0, 0.9 - top);
  return { left, top, right, bottom };
}

export interface VisibleRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Visible source region (normalized 0..1) after crop, zoom and pan. */
export function visibleRect(panel: Panel): VisibleRect {
  const crop = safeCrop(panel);
  const cw = 1 - crop.left - crop.right;
  const ch = 1 - crop.top - crop.bottom;
  const zoom = clamp(panel.zoom, 1, 12);
  const vw = cw / zoom;
  const vh = ch / zoom;
  const mx = (cw - vw) / 2;
  const my = (ch - vh) / 2;
  const ox = clamp(panel.offsetX, -1, 1);
  const oy = clamp(panel.offsetY, -1, 1);
  return {
    sx: crop.left + mx + ox * mx,
    sy: crop.top + my + oy * my,
    sw: vw,
    sh: vh,
  };
}

/** Source pixels per figure pixel for the current panel view. */
export function sourcePixelsPerFigurePixel(panel: Panel, frameWidth: number): number {
  const vis = visibleRect(panel);
  return (vis.sw * panel.width) / Math.max(1, frameWidth);
}

/**
 * Convert a physical length into source-image pixels. When the requested unit
 * is pixels the value is used as-is; otherwise the panel calibration is used.
 */
export function sourcePixelsFor(cal: Calibration | null, value: number, unit: Unit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'px') return value;
  if (!cal || !Number.isFinite(cal.pxPerUnit) || cal.pxPerUnit <= 0) return null;
  if (cal.unit === 'px') return null;
  return (value * UNIT_FACTOR[unit] * cal.pxPerUnit) / UNIT_FACTOR[cal.unit];
}

/** Convert a calibration value from one unit to another without changing scale. */
export function convertCalibration(cal: Calibration, nextUnit: Unit): Calibration | null {
  if (nextUnit === 'px' || cal.unit === 'px') {
    return cal.unit === nextUnit ? { ...cal } : null;
  }
  if (cal.unit === nextUnit) return { ...cal };
  return {
    unit: nextUnit,
    pxPerUnit: (cal.pxPerUnit * UNIT_FACTOR[cal.unit]) / UNIT_FACTOR[nextUnit],
  };
}

/** Convert an annotation value when the display unit changes. */
export function convertValue(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  if (from === 'px' || to === 'px') return value;
  return (value * UNIT_FACTOR[from]) / UNIT_FACTOR[to];
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return value
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function letterLabel(index: number, lower: boolean): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode((lower ? 97 : 65) + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function panelLabel(index: number, style: LabelStyle): string {
  if (style === 'number') return String(index + 1);
  return letterLabel(index, style === 'lower');
}

export function emptyPanel(
  name: string,
  dataUrl: string,
  width: number,
  height: number,
  mime: string,
): Panel {
  return {
    id: createId('panel'),
    name,
    dataUrl,
    width,
    height,
    mime,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    brightness: 100,
    contrast: 100,
    calibration: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function validUnit(value: unknown): value is Unit {
  return value === 'um' || value === 'mm' || value === 'nm' || value === 'px';
}

function parseCalibration(value: unknown): Calibration | null {
  if (!isRecord(value) || !validUnit(value.unit)) return null;
  const pxPerUnit = num(value.pxPerUnit, 0);
  if (pxPerUnit <= 0) return null;
  return { unit: value.unit, pxPerUnit };
}

function parsePanel(value: unknown): Panel | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.dataUrl !== 'string') return null;
  if (!/^data:image\//i.test(value.dataUrl)) return null;
  const width = num(value.width, 0);
  const height = num(value.height, 0);
  if (width <= 0 || height <= 0) return null;
  const crop = isRecord(value.crop) ? value.crop : {};
  const cropLeft = clamp(num(crop.left, 0), 0, 0.9);
  const cropRight = clamp(num(crop.right, 0), 0, 0.9 - cropLeft);
  const cropTop = clamp(num(crop.top, 0), 0, 0.9);
  const cropBottom = clamp(num(crop.bottom, 0), 0, 0.9 - cropTop);
  return {
    id: value.id,
    name: str(value.name, 'Panel'),
    dataUrl: value.dataUrl,
    width,
    height,
    mime: str(value.mime, 'image/png'),
    crop: {
      left: cropLeft,
      top: cropTop,
      right: cropRight,
      bottom: cropBottom,
    },
    zoom: clamp(num(value.zoom, 1), 1, 12),
    offsetX: clamp(num(value.offsetX, 0), -1, 1),
    offsetY: clamp(num(value.offsetY, 0), -1, 1),
    brightness: clamp(num(value.brightness, 100), 10, 300),
    contrast: clamp(num(value.contrast, 100), 10, 300),
    calibration: parseCalibration(value.calibration),
  };
}

function parseAnnotation(value: unknown): Annotation | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const color = str(value.color, '#111111');
  switch (value.kind) {
    case 'arrow':
      return {
        kind: 'arrow',
        id: value.id,
        color,
        x1: num(value.x1, 0),
        y1: num(value.y1, 0),
        x2: num(value.x2, 0),
        y2: num(value.y2, 0),
        strokeWidthPt: clamp(num(value.strokeWidthPt, 1.5), 0.25, 12),
        headSizePt: clamp(num(value.headSizePt, 8), 2, 40),
      };
    case 'rect':
      return {
        kind: 'rect',
        id: value.id,
        color,
        x: num(value.x, 0),
        y: num(value.y, 0),
        w: Math.max(2, num(value.w, 40)),
        h: Math.max(2, num(value.h, 30)),
        strokeWidthPt: clamp(num(value.strokeWidthPt, 1.5), 0.25, 12),
        fill: str(value.fill, 'none'),
      };
    case 'ellipse':
      return {
        kind: 'ellipse',
        id: value.id,
        color,
        x: num(value.x, 0),
        y: num(value.y, 0),
        w: Math.max(2, num(value.w, 40)),
        h: Math.max(2, num(value.h, 30)),
        strokeWidthPt: clamp(num(value.strokeWidthPt, 1.5), 0.25, 12),
        fill: str(value.fill, 'none'),
      };
    case 'text':
      return {
        kind: 'text',
        id: value.id,
        color,
        x: num(value.x, 0),
        y: num(value.y, 0),
        text: str(value.text, ''),
        fontSizePt: clamp(num(value.fontSizePt, 10), 4, 96),
        background: str(value.background, 'none'),
        paddingPt: clamp(num(value.paddingPt, 2), 0, 20),
      };
    case 'scalebar': {
      const unit = validUnit(value.unit) ? value.unit : 'mm';
      const mode = value.mode === 'fixed' ? 'fixed' : 'calibrated';
      return {
        kind: 'scalebar',
        id: value.id,
        color,
        x: num(value.x, 0),
        y: num(value.y, 0),
        mode,
        value: Math.max(0, num(value.value, mode === 'fixed' ? 5 : 10)),
        unit: mode === 'fixed' ? 'mm' : unit,
        panelId: str(value.panelId, ''),
        thicknessPt: clamp(num(value.thicknessPt, 2), 0.25, 16),
        fontSizePt: clamp(num(value.fontSizePt, 9), 4, 48),
        showLabel: value.showLabel !== false,
      };
    }
    case 'panelbar': {
      const unit = validUnit(value.unit) ? value.unit : 'um';
      return {
        kind: 'panelbar',
        id: value.id,
        color,
        panelId: str(value.panelId, ''),
        nx: clamp(num(value.nx, 0.08), 0, 1),
        ny: clamp(num(value.ny, 0.9), 0, 1),
        value: Math.max(0, num(value.value, 10)),
        unit,
        thicknessPt: clamp(num(value.thicknessPt, 2), 0.25, 16),
        fontSizePt: clamp(num(value.fontSizePt, 9), 4, 48),
        showLabel: value.showLabel !== false,
      };
    }
    default:
      return null;
  }
}

function parseLayout(value: unknown): LayoutSettings {
  const src = isRecord(value) ? value : {};
  const labelStyle = src.labelStyle === 'lower' || src.labelStyle === 'number' ? src.labelStyle : 'upper';
  const labelPosition =
    src.labelPosition === 'tc' ||
    src.labelPosition === 'tr' ||
    src.labelPosition === 'bl' ||
    src.labelPosition === 'bc' ||
    src.labelPosition === 'br'
      ? src.labelPosition
      : 'tl';
  return {
    columns: Math.round(clamp(num(src.columns, DEFAULT_LAYOUT.columns), 1, 12)),
    flow: src.flow === 'column' ? 'column' : 'row',
    gapMm: clamp(num(src.gapMm, DEFAULT_LAYOUT.gapMm), 0, 30),
    marginMm: clamp(num(src.marginMm, DEFAULT_LAYOUT.marginMm), 0, 40),
    figureWidthMm: clamp(num(src.figureWidthMm, DEFAULT_LAYOUT.figureWidthMm), 40, 400),
    labelStyle,
    labelPosition,
    labelFontSizePt: clamp(num(src.labelFontSizePt, DEFAULT_LAYOUT.labelFontSizePt), 4, 36),
    labelColor: str(src.labelColor, DEFAULT_LAYOUT.labelColor),
    background: str(src.background, DEFAULT_LAYOUT.background),
    fontFamily: str(src.fontFamily, DEFAULT_LAYOUT.fontFamily),
    exportDpi: src.exportDpi === 600 ? 600 : 300,
  };
}

/** Accepts untrusted JSON and returns a sanitized project, or null. */
export function normalizeProject(value: unknown): AnnotateProject | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels)) return null;
  const panels: Panel[] = [];
  const panelIds = new Set<string>();
  for (const raw of value.panels) {
    const panel = parsePanel(raw);
    if (panel && !panelIds.has(panel.id)) {
      panelIds.add(panel.id);
      panels.push(panel);
    }
  }
  const annotations: Annotation[] = [];
  const annotationIds = new Set<string>();
  if (Array.isArray(value.annotations)) {
    for (const raw of value.annotations) {
      const ann = parseAnnotation(raw);
      if (ann && !annotationIds.has(ann.id)) {
        annotationIds.add(ann.id);
        annotations.push(ann);
      }
    }
  }
  const ids = new Set(panels.map((p) => p.id));
  for (const ann of annotations) {
    if (ann.kind === 'panelbar' && !ids.has(ann.panelId)) ann.panelId = panels[0]?.id ?? '';
    if (ann.kind === 'scalebar' && ann.panelId && !ids.has(ann.panelId)) ann.panelId = panels[0]?.id ?? '';
  }
  return {
    version: 1,
    name: str(value.name, 'Figure'),
    createdAt: str(value.createdAt, new Date().toISOString()),
    updatedAt: str(value.updatedAt, new Date().toISOString()),
    panels,
    annotations,
    layout: parseLayout(value.layout),
  };
}
