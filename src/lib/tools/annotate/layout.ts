// Figure geometry shared by the live canvas preview, hit testing and the
// raster/vector exporters. Coordinates are CSS pixels at 96 dpi; one figure
// millimetre is therefore PX_PER_MM pixels in both screen and export space.
import {
  PX_PER_MM,
  PT_TO_PX,
  formatValue,
  panelLabel,
  safeCrop,
  sourcePixelsFor,
  unitSymbol,
  visibleRect,
  type Annotation,
  type AnnotateProject,
  type Panel,
  type PanelBarAnnotation,
  type ScaleBarAnnotation,
  type Unit,
} from './types';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameLabel {
  text: string;
  x: number;
  y: number;
  fontPx: number;
  align: 'left' | 'center' | 'right';
  baseline: 'top' | 'bottom';
}

export interface PanelFrame {
  panel: Panel;
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: FrameLabel;
}

export interface FigureGeometry {
  width: number;
  height: number;
  frames: PanelFrame[];
  frameById: Map<string, PanelFrame>;
  rowCount: number;
  colCount: number;
}

export interface AnnotationMeta {
  id: string;
  box: Box;
  fontPx: number;
  lines: string[];
  barLength: number | null;
  frame: PanelFrame | null;
}

export interface BarLayout {
  x: number;
  y: number;
  length: number;
  label: string;
  fontPx: number;
  frame: PanelFrame | null;
  panel: Panel | null;
}

let measureCanvas: HTMLCanvasElement | null = null;

function measureCtx(): CanvasRenderingContext2D {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  return ctx;
}

export function measureWidth(text: string, fontPx: number, family: string): number {
  if (!text) return 0;
  const ctx = measureCtx();
  ctx.font = `${fontPx}px ${family}`;
  return ctx.measureText(text).width;
}

export function normalizeBox(a: Box): Box {
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  return { x, y, w: Math.abs(a.w), h: Math.abs(a.h) };
}

export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.w, b.x + b.w);
  const d = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: r - x, h: d - y };
}

export function panelAspect(panel: Panel): number {
  const crop = safeCrop(panel);
  const cw = 1 - crop.left - crop.right;
  const ch = 1 - crop.top - crop.bottom;
  return (cw * panel.width) / Math.max(1, ch * panel.height);
}

function frameLabel(
  frame: Omit<PanelFrame, 'label'>,
  text: string,
  layout: AnnotateProject['layout'],
): FrameLabel {
  const fontPx = layout.labelFontSizePt * PT_TO_PX;
  const pad = Math.max(2, fontPx * 0.2);
  const pos = layout.labelPosition;
  const left = pos === 'tl' || pos === 'bl';
  const right = pos === 'tr' || pos === 'br';
  const top = pos === 'tl' || pos === 'tc' || pos === 'tr';
  const x = left ? frame.x + pad : right ? frame.x + frame.w - pad : frame.x + frame.w / 2;
  const y = top ? frame.y + pad : frame.y + frame.h - pad;
  return {
    text,
    x,
    y,
    fontPx,
    align: left ? 'left' : right ? 'right' : 'center',
    baseline: top ? 'top' : 'bottom',
  };
}

/** Lay panels out in a uniform grid while preserving each cropped aspect. */
export function buildFigureGeometry(project: AnnotateProject): FigureGeometry {
  const layout = project.layout;
  const width = layout.figureWidthMm * PX_PER_MM;
  const margin = layout.marginMm * PX_PER_MM;
  const gap = layout.gapMm * PX_PER_MM;
  const n = project.panels.length;
  if (n === 0) {
    return {
      width,
      height: width * 0.6,
      frames: [],
      frameById: new Map(),
      rowCount: 0,
      colCount: 0,
    };
  }

  const colCount = Math.max(1, Math.min(Math.round(layout.columns), n));
  const rowCount = Math.ceil(n / colCount);
  const cellW = Math.max(4, (width - 2 * margin - (colCount - 1) * gap) / colCount);
  const colOf = (index: number) =>
    layout.flow === 'row' ? index % colCount : Math.floor(index / rowCount);
  const rowOf = (index: number) =>
    layout.flow === 'row' ? Math.floor(index / colCount) : index % rowCount;

  const items = project.panels.map((panel, index) => {
    const w = cellW;
    const h = w / Math.max(0.05, panelAspect(panel));
    return { panel, index, col: colOf(index), row: rowOf(index), w, h };
  });

  const rowHeights = new Array<number>(rowCount).fill(0);
  for (const item of items) {
    rowHeights[item.row] = Math.max(rowHeights[item.row], item.h);
  }
  const rowTops: number[] = [];
  let cursor = margin;
  for (let r = 0; r < rowCount; r++) {
    rowTops.push(cursor);
    cursor += rowHeights[r] + (r < rowCount - 1 ? gap : 0);
  }
  const height = cursor + margin;

  const frames: PanelFrame[] = items.map((item) => {
    const x = margin + item.col * (cellW + gap);
    const y = rowTops[item.row] + (rowHeights[item.row] - item.h) / 2;
    const partial: Omit<PanelFrame, 'label'> = {
      panel: item.panel,
      index: item.index,
      row: item.row,
      col: item.col,
      x,
      y,
      w: item.w,
      h: item.h,
    };
    const text = panelLabel(item.index, layout.labelStyle);
    return { ...partial, label: frameLabel(partial, text, layout) };
  });

  const frameById = new Map(frames.map((frame) => [frame.panel.id, frame]));
  return { width, height, frames, frameById, rowCount, colCount };
}

/** Physical bar length in figure pixels, or null when calibration is missing. */
function barLengthFigure(
  value: number,
  unit: Unit,
  mode: 'calibrated' | 'fixed',
  panel: Panel | null,
  frame: PanelFrame | null,
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === 'fixed') return value * PX_PER_MM;
  if (!panel || !frame) return null;
  const sourcePx = sourcePixelsFor(panel.calibration, value, unit);
  if (sourcePx == null) return null;
  const vis = visibleRect(panel);
  const sourceWidth = vis.sw * panel.width;
  if (sourceWidth <= 0) return null;
  return (sourcePx * frame.w) / sourceWidth;
}

function barText(value: number, unit: Unit, showLabel: boolean): string {
  return showLabel ? `${formatValue(value)} ${unitSymbol(unit)}` : '';
}

/** Position and label of a scale bar, shared by drawing, hit testing and export. */
export function barLayout(
  ann: ScaleBarAnnotation | PanelBarAnnotation,
  geom: FigureGeometry,
): BarLayout | null {
  const frame = ann.panelId ? geom.frameById.get(ann.panelId) ?? null : null;
  const panel = frame?.panel ?? null;
  if (ann.kind === 'panelbar') {
    if (!frame || !panel) return null;
    const length = barLengthFigure(ann.value, ann.unit, 'calibrated', panel, frame);
    if (length == null) return null;
    return {
      x: frame.x + ann.nx * frame.w,
      y: frame.y + ann.ny * frame.h,
      length,
      label: barText(ann.value, ann.unit, ann.showLabel),
      fontPx: ann.fontSizePt * PT_TO_PX,
      frame,
      panel,
    };
  }
  const length = barLengthFigure(ann.value, ann.unit, ann.mode, panel, frame);
  if (length == null) return null;
  return {
    x: ann.x,
    y: ann.y,
    length,
    label: barText(ann.value, ann.unit, ann.showLabel),
    fontPx: ann.fontSizePt * PT_TO_PX,
    frame,
    panel,
  };
}

function textMetrics(text: string, fontPx: number, family: string) {
  const lines = text.split('\n');
  let width = 0;
  for (const line of lines) width = Math.max(width, measureWidth(line, fontPx, family));
  const lineHeight = fontPx * 1.25;
  return { lines, width, height: Math.max(lineHeight, lines.length * lineHeight), lineHeight };
}

/** Bounding boxes and derived metrics for every annotation. */
export function buildAnnotationMeta(project: AnnotateProject, geom: FigureGeometry): Map<string, AnnotationMeta> {
  const out = new Map<string, AnnotationMeta>();
  const family = project.layout.fontFamily;
  for (const ann of project.annotations) {
    let box: Box = { x: 0, y: 0, w: 0, h: 0 };
    let fontPx = 0;
    let lines: string[] = [];
    let barLength: number | null = null;
    let frame: PanelFrame | null = null;

    switch (ann.kind) {
      case 'arrow': {
        const pad = Math.max(ann.strokeWidthPt * PT_TO_PX, ann.headSizePt * PT_TO_PX) * 0.6;
        box = normalizeBox({
          x: ann.x1 - pad,
          y: ann.y1 - pad,
          w: ann.x2 - ann.x1 + pad * 2,
          h: ann.y2 - ann.y1 + pad * 2,
        });
        break;
      }
      case 'rect':
      case 'ellipse': {
        box = normalizeBox({ x: ann.x, y: ann.y, w: ann.w, h: ann.h });
        break;
      }
      case 'text': {
        fontPx = ann.fontSizePt * PT_TO_PX;
        const metrics = textMetrics(ann.text || ' ', fontPx, family);
        lines = metrics.lines;
        const pad = ann.paddingPt * PT_TO_PX;
        box = {
          x: ann.x - pad,
          y: ann.y - pad,
          w: metrics.width + pad * 2,
          h: metrics.height + pad * 2,
        };
        break;
      }
      case 'scalebar':
      case 'panelbar': {
        const bar = barLayout(ann, geom);
        frame = bar?.frame ?? (ann.panelId ? geom.frameById.get(ann.panelId) ?? null : null);
        if (bar) {
          barLength = bar.length;
          fontPx = bar.fontPx;
          const labelWidth = bar.label ? measureWidth(bar.label, bar.fontPx, family) : 0;
          const thickness = ann.thicknessPt * PT_TO_PX;
          const barBox: Box = {
            x: bar.x - thickness,
            y: bar.y - thickness / 2 - 2,
            w: bar.length + thickness * 2,
            h: thickness + 4,
          };
          const labelBox: Box = bar.label
            ? {
                x: bar.x + bar.length / 2 - labelWidth / 2,
                y: bar.y - bar.fontPx * 1.2,
                w: labelWidth,
                h: bar.fontPx * 1.2,
              }
            : { x: bar.x, y: bar.y, w: 0, h: 0 };
          box = unionBox(barBox, labelBox);
        } else {
          fontPx = ann.fontSizePt * PT_TO_PX;
          box = { x: ann.kind === 'scalebar' ? ann.x : 0, y: ann.kind === 'scalebar' ? ann.y - fontPx : 0, w: 80, h: fontPx * 1.3 };
        }
        break;
      }
    }
    out.set(ann.id, { id: ann.id, box, fontPx, lines, barLength, frame });
  }
  return out;
}

export interface HandleDef {
  id: string;
  x: number;
  y: number;
}

export function annotationHandles(ann: Annotation, meta: AnnotationMeta | undefined): HandleDef[] {
  if (!meta) return [];
  switch (ann.kind) {
    case 'arrow':
      return [
        { id: 'start', x: ann.x1, y: ann.y1 },
        { id: 'end', x: ann.x2, y: ann.y2 },
      ];
    case 'rect':
    case 'ellipse':
      return [
        { id: 'nw', x: meta.box.x, y: meta.box.y },
        { id: 'ne', x: meta.box.x + meta.box.w, y: meta.box.y },
        { id: 'sw', x: meta.box.x, y: meta.box.y + meta.box.h },
        { id: 'se', x: meta.box.x + meta.box.w, y: meta.box.y + meta.box.h },
      ];
    case 'text':
      return [{ id: 'se', x: meta.box.x + meta.box.w, y: meta.box.y + meta.box.h }];
    case 'scalebar':
      return meta.barLength != null ? [{ id: 'end', x: ann.x + meta.barLength, y: ann.y }] : [];
    case 'panelbar': {
      if (meta.barLength == null || !meta.frame) return [];
      const x = meta.frame.x + ann.nx * meta.frame.w;
      const y = meta.frame.y + ann.ny * meta.frame.h;
      return [
        { id: 'start', x, y },
        { id: 'end', x: x + meta.barLength, y },
      ];
    }
  }
}

export function findHandleAt(
  ann: Annotation,
  meta: AnnotationMeta | undefined,
  point: Point,
  tolerance: number,
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const handle of annotationHandles(ann, meta)) {
    const d = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (d <= tolerance && (!best || d < best.d)) best = { id: handle.id, d };
  }
  return best?.id ?? null;
}

export function findFrameAt(geom: FigureGeometry, point: Point): PanelFrame | null {
  for (let i = geom.frames.length - 1; i >= 0; i--) {
    const frame = geom.frames[i];
    if (
      point.x >= frame.x &&
      point.x <= frame.x + frame.w &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.h
    ) {
      return frame;
    }
  }
  return null;
}

export function findAnnotationAt(
  project: AnnotateProject,
  meta: Map<string, AnnotationMeta>,
  point: Point,
  pad = 2,
): string | null {
  for (let i = project.annotations.length - 1; i >= 0; i--) {
    const ann = project.annotations[i];
    const box = meta.get(ann.id)?.box;
    if (!box) continue;
    if (
      point.x >= box.x - pad &&
      point.x <= box.x + box.w + pad &&
      point.y >= box.y - pad &&
      point.y <= box.y + box.h + pad
    ) {
      return ann.id;
    }
  }
  return null;
}

export function mmFromPx(px: number): number {
  return px / PX_PER_MM;
}

export function pxFromMm(mm: number): number {
  return mm * PX_PER_MM;
}
