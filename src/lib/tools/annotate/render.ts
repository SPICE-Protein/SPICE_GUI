// Canvas preview and publication export. The preview, PNG and SVG all derive
// their coordinates from the same FigureGeometry and annotation bounds, so the
// exported figure matches what the user arranged on screen.
import {
  PT_TO_PX,
  PX_PER_MM,
  visibleRect,
  type Annotation,
  type AnnotateProject,
  type Panel,
} from './types';
import {
  barLayout,
  type AnnotationMeta,
  type FigureGeometry,
  type PanelFrame,
  type Point,
} from './layout';
import type { PanelArt } from './decode';

export type ArtResolver = (panel: Panel) => PanelArt | null;

function fontString(size: number, family: string): string {
  return `${size}px ${family}`;
}

function lineWidth(pt: number): number {
  return Math.max(0.35, pt * PT_TO_PX);
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [Point, Point, Point] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.42;
  return [
    { x: x2, y: y2 },
    { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) },
    { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) },
  ];
}

function drawPanelImage(
  ctx: CanvasRenderingContext2D,
  frame: PanelFrame,
  art: PanelArt,
) {
  const vis = visibleRect(frame.panel);
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.w, frame.h);
  ctx.clip();
  ctx.drawImage(
    art.source,
    vis.sx * art.width,
    vis.sy * art.height,
    vis.sw * art.width,
    vis.sh * art.height,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
  );
  ctx.restore();
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  ann: Extract<Annotation, { kind: 'text' }>,
  meta: AnnotationMeta,
  family: string,
) {
  if (ann.background !== 'none') {
    const box = meta.box;
    ctx.save();
    ctx.fillStyle = ann.background;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
  const metrics = meta.lines.length ? meta.lines : [''];
  const lineHeight = meta.fontPx * 1.25;
  ctx.save();
  ctx.font = fontString(meta.fontPx, family);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ann.color;
  metrics.forEach((line, i) => {
    ctx.fillText(line, ann.x, ann.y + i * lineHeight);
  });
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, ann: Extract<Annotation, { kind: 'arrow' }>) {
  const width = lineWidth(ann.strokeWidthPt);
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(ann.x1, ann.y1);
  ctx.lineTo(ann.x2, ann.y2);
  ctx.stroke();
  const head = ann.headSizePt * PT_TO_PX;
  const [tip, a, b] = arrowHead(ann.x1, ann.y1, ann.x2, ann.y2, head);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  ann: Extract<Annotation, { kind: 'scalebar' | 'panelbar' }>,
  geom: FigureGeometry,
  family: string,
) {
  const bar = barLayout(ann, geom);
  if (!bar) return;
  const thickness = lineWidth(ann.thicknessPt);
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(bar.x, bar.y);
  ctx.lineTo(bar.x + bar.length, bar.y);
  ctx.stroke();
  if (bar.label) {
    ctx.font = fontString(bar.fontPx, family);
    ctx.fillStyle = ann.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(bar.label, bar.x + bar.length / 2, bar.y - thickness / 2 - 2);
  }
  ctx.restore();
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  meta: AnnotationMeta | undefined,
  project: AnnotateProject,
  geom: FigureGeometry,
) {
  const family = project.layout.fontFamily;
  switch (ann.kind) {
    case 'arrow':
      drawArrow(ctx, ann);
      break;
    case 'rect': {
      ctx.save();
      ctx.lineWidth = lineWidth(ann.strokeWidthPt);
      ctx.strokeStyle = ann.color;
      if (ann.fill !== 'none') {
        ctx.fillStyle = ann.fill;
        ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
      }
      ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
      ctx.restore();
      break;
    }
    case 'ellipse': {
      ctx.save();
      ctx.lineWidth = lineWidth(ann.strokeWidthPt);
      ctx.strokeStyle = ann.color;
      ctx.beginPath();
      ctx.ellipse(ann.x + ann.w / 2, ann.y + ann.h / 2, Math.abs(ann.w / 2), Math.abs(ann.h / 2), 0, 0, Math.PI * 2);
      if (ann.fill !== 'none') {
        ctx.fillStyle = ann.fill;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'text':
      if (meta) drawTextBlock(ctx, ann, meta, family);
      break;
    case 'scalebar':
    case 'panelbar':
      drawBar(ctx, ann, geom, family);
      break;
  }
}

export function drawFigure(
  ctx: CanvasRenderingContext2D,
  project: AnnotateProject,
  geom: FigureGeometry,
  resolve: ArtResolver,
  meta: Map<string, AnnotationMeta>,
) {
  const layout = project.layout;
  ctx.save();
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, geom.width, geom.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const frame of geom.frames) {
    const art = resolve(frame.panel);
    if (art) drawPanelImage(ctx, frame, art);
  }

  for (const frame of geom.frames) {
    const label = frame.label;
    if (!label.text) continue;
    ctx.save();
    ctx.font = `bold ${label.fontPx}px ${layout.fontFamily}`;
    ctx.textAlign = label.align;
    ctx.textBaseline = label.baseline;
    ctx.lineWidth = Math.max(2, label.fontPx * 0.18);
    ctx.strokeStyle = '#ffffff';
    ctx.lineJoin = 'round';
    ctx.strokeText(label.text, label.x, label.y);
    ctx.fillStyle = layout.labelColor;
    ctx.fillText(label.text, label.x, label.y);
    ctx.restore();
  }

  for (const ann of project.annotations) {
    drawAnnotation(ctx, ann, meta.get(ann.id), project, geom);
  }
  ctx.restore();
}

export interface SelectionInfo {
  annotationId: string | null;
  panelId: string | null;
}

export function drawSelection(
  ctx: CanvasRenderingContext2D,
  project: AnnotateProject,
  geom: FigureGeometry,
  meta: Map<string, AnnotationMeta>,
  selection: SelectionInfo,
  viewScale: number,
) {
  const unit = 1 / Math.max(0.0001, viewScale);
  ctx.save();

  if (selection.panelId) {
    const frame = geom.frameById.get(selection.panelId);
    if (frame) {
      ctx.strokeStyle = 'rgba(76, 214, 255, 0.55)';
      ctx.lineWidth = 1 * unit;
      ctx.setLineDash([5 * unit, 4 * unit]);
      ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
      ctx.setLineDash([]);
    }
  }

  const ann = selection.annotationId
    ? project.annotations.find((item) => item.id === selection.annotationId) ?? null
    : null;
  if (ann) {
    const info = meta.get(ann.id);
    if (info) {
      ctx.strokeStyle = '#4cd6ff';
      ctx.lineWidth = 1.5 * unit;
      ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.strokeRect(info.box.x, info.box.y, info.box.w, info.box.h);
      ctx.setLineDash([]);
      const size = 7 * unit;
      const handles: Point[] = [];
      const push = (x: number, y: number) => handles.push({ x, y });
      switch (ann.kind) {
        case 'arrow':
          push(ann.x1, ann.y1);
          push(ann.x2, ann.y2);
          break;
        case 'rect':
        case 'ellipse':
          push(info.box.x, info.box.y);
          push(info.box.x + info.box.w, info.box.y);
          push(info.box.x, info.box.y + info.box.h);
          push(info.box.x + info.box.w, info.box.y + info.box.h);
          break;
        case 'text':
          push(info.box.x + info.box.w, info.box.y + info.box.h);
          break;
        case 'scalebar':
          if (info.barLength != null) push(ann.x + info.barLength, ann.y);
          break;
        case 'panelbar': {
          const frame = geom.frameById.get(ann.panelId);
          if (frame && info.barLength != null) {
            const x = frame.x + ann.nx * frame.w;
            const y = frame.y + ann.ny * frame.h;
            push(x, y);
            push(x + info.barLength, y);
          }
          break;
        }
      }
      for (const handle of handles) {
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
        ctx.strokeStyle = '#4cd6ff';
        ctx.lineWidth = 1.5 * unit;
        ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
      }
    }
  }
  ctx.restore();
}

export interface DraftShape {
  kind: 'arrow' | 'rect' | 'ellipse' | 'line';
  start: Point;
  end: Point;
}

export function drawDraft(
  ctx: CanvasRenderingContext2D,
  draft: DraftShape,
  viewScale: number,
) {
  const unit = 1 / Math.max(0.0001, viewScale);
  const color = draft.kind === 'line' ? '#ffd23f' : '#ff9f1c';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 * unit;
  ctx.setLineDash([5 * unit, 3 * unit]);
  const x = Math.min(draft.start.x, draft.end.x);
  const y = Math.min(draft.start.y, draft.end.y);
  const w = Math.abs(draft.end.x - draft.start.x);
  const h = Math.abs(draft.end.y - draft.start.y);
  if (draft.kind === 'rect') {
    ctx.strokeRect(x, y, w, h);
  } else if (draft.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(draft.start.x, draft.start.y);
    ctx.lineTo(draft.end.x, draft.end.y);
    ctx.stroke();
    if (draft.kind === 'arrow') {
      const head = 8 * unit;
      const [tip, a, b] = arrowHead(draft.start.x, draft.start.y, draft.end.x, draft.end.y, head);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Render the complete figure at a target dots-per-inch. */
export function renderFigurePng(
  project: AnnotateProject,
  geom: FigureGeometry,
  resolve: ArtResolver,
  meta: Map<string, AnnotationMeta>,
  dpi: number,
): HTMLCanvasElement {
  const scale = dpi / 96;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(geom.width * scale));
  canvas.height = Math.max(1, Math.round(geom.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawFigure(ctx, project, geom, resolve, meta);
  return canvas;
}

// ------------------------------------------------------------------- PNG metadata

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Add a pHYs chunk (physical resolution) and a UTF-8 description to a PNG. */
export async function encodePngWithDpi(
  canvas: HTMLCanvasElement,
  dpi: number,
  description: string,
): Promise<Uint8Array> {
  const png = await canvasPngBytes(canvas);
  const encoder = new TextEncoder();
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  const ppm = Math.round(dpi / 0.0254);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  phys[8] = 1;
  const chunks: Uint8Array[] = [pngChunk('pHYs', phys), pngChunk('sRGB', new Uint8Array([0]))];
  const keyword = encoder.encode('Description');
  const text = encoder.encode(description);
  const itxt = new Uint8Array(keyword.length + 5 + text.length);
  itxt.set(keyword, 0);
  let offset = keyword.length;
  itxt[offset++] = 0;
  itxt[offset++] = 0;
  itxt[offset++] = 0;
  itxt[offset++] = 0;
  itxt[offset++] = 0;
  itxt.set(text, offset);
  chunks.push(pngChunk('iTXt', itxt));

  const ihdrEnd = 8 + 25;
  const extra = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(png.length + extra);
  out.set(png.subarray(0, ihdrEnd), 0);
  let cursor = ihdrEnd;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(png.subarray(ihdrEnd), cursor);
  return out;
}

// ------------------------------------------------------------------- SVG

function esc(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgAttrs(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}="${esc(String(value))}"`)
    .join(' ');
}

function svgNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0';
}

function svgPanel(frame: PanelFrame, art: PanelArt): string[] {
  if (!art.dataUrl) return [];
  const vis = visibleRect(frame.panel);
  const viewBox = [
    svgNumber(vis.sx * art.width),
    svgNumber(vis.sy * art.height),
    svgNumber(vis.sw * art.width),
    svgNumber(vis.sh * art.height),
  ].join(' ');
  return [
    `<svg x="${svgNumber(frame.x)}" y="${svgNumber(frame.y)}" width="${svgNumber(frame.w)}" height="${svgNumber(frame.h)}" viewBox="${viewBox}" preserveAspectRatio="none" overflow="hidden"><image href="${art.dataUrl}" width="${svgNumber(art.width)}" height="${svgNumber(art.height)}" preserveAspectRatio="none"/></svg>`,
  ];
}

function svgAnnotation(
  ann: Annotation,
  meta: AnnotationMeta | undefined,
  project: AnnotateProject,
  geom: FigureGeometry,
): string[] {
  const out: string[] = [];
  const family = project.layout.fontFamily;
  switch (ann.kind) {
    case 'arrow': {
      out.push(
        `<line ${svgAttrs({
          x1: svgNumber(ann.x1),
          y1: svgNumber(ann.y1),
          x2: svgNumber(ann.x2),
          y2: svgNumber(ann.y2),
          stroke: ann.color,
          'stroke-width': lineWidth(ann.strokeWidthPt),
        })}/>`,
      );
      const head = ann.headSizePt * PT_TO_PX;
      const [tip, a, b] = arrowHead(ann.x1, ann.y1, ann.x2, ann.y2, head);
      out.push(
        `<polygon points="${svgNumber(tip.x)},${svgNumber(tip.y)} ${svgNumber(a.x)},${svgNumber(a.y)} ${svgNumber(b.x)},${svgNumber(b.y)}" fill="${esc(ann.color)}"/>`,
      );
      break;
    }
    case 'rect':
      out.push(
        `<rect ${svgAttrs({
          x: svgNumber(ann.x),
          y: svgNumber(ann.y),
          width: svgNumber(ann.w),
          height: svgNumber(ann.h),
          fill: ann.fill === 'none' ? 'none' : ann.fill,
          stroke: ann.color,
          'stroke-width': lineWidth(ann.strokeWidthPt),
        })}/>`,
      );
      break;
    case 'ellipse':
      out.push(
        `<ellipse ${svgAttrs({
          cx: svgNumber(ann.x + ann.w / 2),
          cy: svgNumber(ann.y + ann.h / 2),
          rx: svgNumber(Math.abs(ann.w / 2)),
          ry: svgNumber(Math.abs(ann.h / 2)),
          fill: ann.fill === 'none' ? 'none' : ann.fill,
          stroke: ann.color,
          'stroke-width': lineWidth(ann.strokeWidthPt),
        })}/>`,
      );
      break;
    case 'text': {
      if (!meta) break;
      if (ann.background !== 'none') {
        out.push(
          `<rect ${svgAttrs({
            x: svgNumber(meta.box.x),
            y: svgNumber(meta.box.y),
            width: svgNumber(meta.box.w),
            height: svgNumber(meta.box.h),
            fill: ann.background,
          })}/>`,
        );
      }
      const lineHeight = meta.fontPx * 1.25;
      const lines = meta.lines.length ? meta.lines : [''];
      lines.forEach((line, index) => {
        out.push(
          `<text ${svgAttrs({
            x: svgNumber(ann.x),
            y: svgNumber(ann.y + index * lineHeight),
            'font-family': family,
            'font-size': svgNumber(meta.fontPx),
            fill: ann.color,
            'dominant-baseline': 'text-before-edge',
          })}>${esc(line)}</text>`,
        );
      });
      break;
    }
    case 'scalebar':
    case 'panelbar': {
      const bar = barLayout(ann, geom);
      if (!bar) break;
      const thickness = lineWidth(ann.thicknessPt);
      out.push(
        `<line ${svgAttrs({
          x1: svgNumber(bar.x),
          y1: svgNumber(bar.y),
          x2: svgNumber(bar.x + bar.length),
          y2: svgNumber(bar.y),
          stroke: ann.color,
          'stroke-width': thickness,
        })}/>`,
      );
      if (bar.label) {
        out.push(
          `<text ${svgAttrs({
            x: svgNumber(bar.x + bar.length / 2),
            y: svgNumber(bar.y - thickness / 2 - 2),
            'font-family': family,
            'font-size': svgNumber(bar.fontPx),
            fill: ann.color,
            'text-anchor': 'middle',
          })}>${esc(bar.label)}</text>`,
        );
      }
      break;
    }
  }
  return out;
}

/** Hand-built SVG: images stay embedded and all labels remain real text. */
export function figureToSvg(
  project: AnnotateProject,
  geom: FigureGeometry,
  resolve: ArtResolver,
  meta: Map<string, AnnotationMeta>,
): string {
  const out: string[] = [];
  const heightMm = geom.height / PX_PER_MM;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(project.layout.figureWidthMm)}mm" height="${svgNumber(heightMm)}mm" viewBox="0 0 ${svgNumber(geom.width)} ${svgNumber(geom.height)}">`,
  );
  out.push(`<title>${esc(project.name)}</title>`);
  out.push(`<rect width="100%" height="100%" fill="${esc(project.layout.background)}"/>`);

  for (const frame of geom.frames) {
    const art = resolve(frame.panel);
    if (art) out.push(...svgPanel(frame, art));
  }

  for (const frame of geom.frames) {
    const label = frame.label;
    if (!label.text) continue;
    out.push(
      `<text ${svgAttrs({
        x: svgNumber(label.x),
        y: svgNumber(label.y),
        'font-family': project.layout.fontFamily,
        'font-size': svgNumber(label.fontPx),
        'font-weight': 'bold',
        fill: project.layout.labelColor,
        'text-anchor': label.align === 'left' ? 'start' : label.align === 'right' ? 'end' : 'middle',
        'dominant-baseline': label.baseline === 'top' ? 'text-before-edge' : 'text-after-edge',
        'paint-order': 'stroke',
        stroke: '#ffffff',
        'stroke-width': Math.max(2, label.fontPx * 0.18),
        'stroke-linejoin': 'round',
      })}>${esc(label.text)}</text>`,
    );
  }

  for (const ann of project.annotations) {
    out.push(...svgAnnotation(ann, meta.get(ann.id), project, geom));
  }
  out.push('</svg>');
  return out.join('\n');
}

export function figureSummary(project: AnnotateProject, geom: FigureGeometry, dpi: number): string {
  const heightMm = geom.height / PX_PER_MM;
  return [
    `SPICE annotator figure`,
    `panels: ${project.panels.length}`,
    `size: ${project.layout.figureWidthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm`,
    `resolution: ${dpi} dpi`,
    `export pixels: ${Math.round(geom.width * (dpi / 96))} x ${Math.round(geom.height * (dpi / 96))}`,
  ].join('; ');
}
