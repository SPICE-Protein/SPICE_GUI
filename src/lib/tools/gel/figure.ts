// Figure layout shared by the on-screen preview, PNG/TIFF/SVG/PPTX exports and
// hit testing. Build a list of primitives once, then rasterise or serialise it;
// this keeps every output identical to what the user sees.
import type { Annotation, GelLane, GelProject } from './types';
import { createCanvas } from '$lib/tools/shared/canvas';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Hit =
  | { kind: 'laneName'; laneId: string }
  | { kind: 'band'; laneId: string; bandIndex: number }
  | { kind: 'conditionCell'; rowId: string; laneId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'annotation'; annotationId: string }
  | { kind: 'laneGuide'; laneId: string };

export interface TextStyle {
  family: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  color: string;
  angle?: number;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'alphabetic' | 'bottom';
}

export type FigureItem =
  | { kind: 'image'; x: number; y: number; w: number; h: number; source: 'gel' }
  | { kind: 'image'; x: number; y: number; w: number; h: number; source: 'box'; box: Box }
  | { kind: 'text'; x: number; y: number; text: string; style: TextStyle; bbox: Box; halo?: boolean; hit?: Hit }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: number[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number; fill?: string; hit?: Hit }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; head: number };

export interface FigureLayout {
  width: number;
  height: number;
  gel: Box;
  crop: GelProject['crop'];
  gelDark: boolean;
  fontFamily: string;
  items: FigureItem[];
}

const PX_PER_MM = 96 / 25.4;
const MARGIN = 8;
const UNIT_ROW = 13;
const GEL_HALO = '#ffffff';

const DEFAULT_INK = '#111111';
const DEFAULT_ON_GEL_LIGHT = '#111111';
const DEFAULT_ON_GEL_DARK = '#f4f4f4';
const RED = '#d21f2a';

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = createCanvas().getContext('2d')!;
  return measureCtx;
}

export function fontString(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${style.family}`;
}

export function measureWidth(text: string, style: TextStyle): number {
  const c = ctx();
  c.font = fontString(style);
  return c.measureText(text).width;
}

function wrapLabel(text: string, maxWidth: number, style: TextStyle, mode: 'wrap' | 'shrink' | 'one'): { lines: string[]; style: TextStyle } {
  if (!text) return { lines: [''], style };
  const width = measureWidth(text, style);
  if (width <= maxWidth || mode === 'one') return { lines: [text], style };
  if (mode === 'shrink') {
    let size = style.size;
    while (size > 5 && measureWidth(text, { ...style, size }) > maxWidth) size -= 0.5;
    return { lines: [text], style: { ...style, size } };
  }
  // Wrap at spaces when possible, otherwise per character (CJK).
  const words = text.includes(' ') ? text.split(/(\s+)/) : [...text];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line + word;
    if (line && measureWidth(next, style) > maxWidth) {
      lines.push(line.trimEnd());
      line = word.trimStart();
    } else {
      line = next;
    }
    if (!text.includes(' ') && measureWidth(line, style) > maxWidth && line.length > 1) {
      lines.push(line.slice(0, -1));
      line = line.slice(-1);
    }
  }
  if (line) lines.push(line.trimEnd());
  return { lines: lines.slice(0, 4), style };
}

function annotationColor(a: Annotation, gelDark: boolean): string {
  if (a.color === 'red') return RED;
  return gelDark ? DEFAULT_ON_GEL_DARK : DEFAULT_ON_GEL_LIGHT;
}

function laneColor(lane: GelLane, gelDark: boolean): string {
  if (lane.style?.red) return RED;
  return gelDark ? DEFAULT_ON_GEL_DARK : DEFAULT_ON_GEL_LIGHT;
}

export interface FigureOptions {
  /** Print width override in millimetres; defaults to the project layout. */
  widthMm?: number;
}

export function buildFigure(project: GelProject, processed: HTMLCanvasElement, opts: FigureOptions = {}): FigureLayout {
  const crop = project.crop;
  const visW = Math.max(0.05, 1 - crop.left - crop.right);
  const visH = Math.max(0.05, 1 - crop.top - crop.bottom);
  const family = project.layout.fontFamily;
  const layout = project.layout;
  const widthMm = opts.widthMm ?? layout.figureWidthMm;
  const width = Math.max(280, widthMm * PX_PER_MM);

  const sideTexts = project.annotations.filter((a): a is Extract<Annotation, { type: 'sideText' }> => a.type === 'sideText');
  const arrows = project.annotations.filter((a): a is Extract<Annotation, { type: 'arrow' }> => a.type === 'arrow');
  const brackets = project.annotations.filter((a): a is Extract<Annotation, { type: 'bracket' }> => a.type === 'bracket');
  const hasTop = sideTexts.some((a) => a.side === 'top');
  const enlargeBoxes = project.annotations.filter((a): a is Extract<Annotation, { type: 'box' }> => a.type === 'box' && a.enlarge);
  const labelFs0 = layout.labelFontSize;

  // Reserve a column on each side for side text, brackets and arrow labels;
  // otherwise those annotations would be clipped at the figure edge.
  const laneById = new Map(project.lanes.map((l) => [l.id, l]));
  const arrowWidth = (side: 'left' | 'right') => {
    let w = 0;
    for (const a of arrows) {
      if (a.side !== side) continue;
      const lane = laneById.get(a.laneId);
      const band = lane?.bands[a.bandIndex];
      const text = a.label || (band?.size !== undefined ? `${band.approx ? '≈' : ''}${formatSize(band.size)}` : '');
      w = Math.max(w, measureWidth(text, { family, size: a.fontSize ?? labelFs0, color: '#000' }));
    }
    return w ? w + 10 : 0;
  };
  const sideTextW = (side: 'left' | 'right') =>
    sideTexts.some((a) => a.side === side) ? 14 + labelFs0 : 0;
  const bracketW = (side: 'left' | 'right') =>
    brackets.some((a) => a.side === side) ? 14 + labelFs0 : 0;
  const leftW = Math.max(sideTextW('left'), arrowWidth('left'), bracketW('left'));
  const rightW = Math.max(sideTextW('right'), arrowWidth('right'), bracketW('right'));

  // The gel occupies the full width between side columns; enlarged boxes take
  // a column on the right, so the gel shrinks to leave room for them.
  const gelArea = width - MARGIN * 2 - leftW - rightW;
  const enlargeW = enlargeBoxes.length ? Math.max(60, gelArea * 0.34) + 12 : 0;
  const gelW = Math.max(120, gelArea - enlargeW);
  const gelH = gelW / ((processed.width * visW) / Math.max(1, processed.height * visH));
  const gelX = MARGIN + leftW;
  const gelY = MARGIN + UNIT_ROW + (hasTop ? layout.labelFontSize * 1.7 : 0);

  const gelDark = isDark(processed);
  const inK = gelDark ? DEFAULT_ON_GEL_DARK : DEFAULT_ON_GEL_LIGHT;
  const visible = project.lanes.filter((l) => !l.removed && inCropX(l.x, crop));

  // --- rows under the gel -------------------------------------------------
  const nameFs = layout.nameFontSize;
  const labelFs = layout.labelFontSize;
  const angle = Math.max(0, Math.min(90, layout.nameAngle));
  const nameRowBase = nameFs * 1.55 + (angle ? maxNameWidth(visible, family, nameFs) * Math.sin((angle * Math.PI) / 180) : 0);

  // Lane names can collide at the chosen width; stagger them onto two rows.
  const nameSlots = placeNames(visible, crop, gelX, gelW, nameRowBase, nameFs, family);
  const nameRowH = nameSlots.twoRows ? nameRowBase * 1.9 : nameRowBase;

  const condRows = project.conditionRows;
  const condH = condRows.length * labelFs * 1.45;
  const namesFirst = !layout.conditionsNearestGel;
  const namesY = gelY + gelH + (namesFirst ? 0 : condH) + nameFs * 0.95;
  const condY = gelY + gelH + (namesFirst ? nameRowH : 0);
  const below = gelY + gelH + nameRowH + condH;

  // --- groups -------------------------------------------------------------
  const groupItems: FigureItem[] = [];
  const groupBottom = placeGroups(project, visible, crop, gelX, gelW, below + 4, labelFs, family, gelDark, groupItems);
  let cursorY = groupBottom + 6;

  // --- bottom caption -----------------------------------------------------
  const bottomText = sideTexts.find((a) => a.side === 'bottom');
  if (bottomText) cursorY += labelFs * 1.6;
  let height = cursorY + MARGIN;

  const items: FigureItem[] = [];
  items.push({ kind: 'image', x: gelX, y: gelY, w: gelW, h: gelH, source: 'gel' });

  // Unit heading beside the upper edge.
  items.push({
    kind: 'text',
    x: gelX,
    y: gelY - 4,
    text: project.unit,
    style: { family, size: labelFs, bold: true, color: DEFAULT_INK, align: 'left', baseline: 'alphabetic' },
    bbox: { x: gelX, y: gelY - 4 - labelFs, w: 40, h: labelFs + 2 },
  });

  // Lane guides, band labels and band marks.
  for (const lane of visible) {
    const x = mapX(lane.x, crop, gelX, gelW);
    const nameHit: Hit = { kind: 'laneName', laneId: lane.id };
    const namePlace = nameSlots.positions.get(lane.id);
    if (namePlace) {
      const style: TextStyle = {
        family,
        size: lane.style?.fontSize ?? nameFs,
        italic: lane.style?.italic,
        color: laneColor(lane, gelDark),
        angle,
        align: 'center',
        baseline: 'top',
      };
      const baseY = namesY + namePlace.row * nameRowBase;
      const w = measureWidth(lane.name || '', style);
      const hitW = Math.max(18, w + 6);
      items.push({
        kind: 'text',
        x,
        y: baseY,
        text: lane.name,
        style,
        bbox: { x: x - hitW / 2, y: baseY, w: hitW, h: nameFs * 1.3 },
        hit: nameHit,
      });
    }

    // Faint guide under the name to the gel.
    if (lane.name) {
      items.push({ kind: 'line', x1: x, y1: gelY + gelH, x2: x, y2: gelY + gelH + 3, color: inK, width: 0.6 });
    }

    // Band labels, pushed apart so they never overlap.
    const labels = lane.bands
      .map((band, index) => ({ band, index }))
      .filter(({ band }) => !band.hidden && band.showSize && band.size !== undefined && inCropY(band.y, crop))
      .map(({ band, index }) => ({ band, index, y: mapY(band.y, crop, gelY, gelH) }))
      .sort((a, b) => a.y - b.y);
    const step = labelFs + 1.2;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y < labels[i - 1].y + step) labels[i].y = labels[i - 1].y + step;
    }
    const overflow = labels.length ? labels[labels.length - 1].y - (gelY + gelH - 2) : 0;
    if (overflow > 0) for (const l of labels) l.y = Math.max(gelY + 2, l.y - overflow);

    for (const { band, index, y } of labels) {
      const approx = band.approx ? '≈' : '';
      const text = `${approx}${formatSize(band.size!)}`;
      const style: TextStyle = { family, size: lane.style?.fontSize ? Math.max(6, lane.style.fontSize - 0.5) : labelFs, color: inK, align: 'left', baseline: 'middle' };
      const w = measureWidth(text, style);
      const bx = x + 5;
      items.push({
        kind: 'text',
        x: bx,
        y,
        text,
        style,
        bbox: { x: bx, y: y - labelFs * 0.8, w, h: labelFs * 1.4 },
        halo: true,
        hit: { kind: 'band', laneId: lane.id, bandIndex: index },
      });
      if (band.mark) {
        const mw = measureWidth(band.mark, { ...style, bold: true });
        items.push({
          kind: 'text',
          x: bx + w + 3,
          y,
          text: band.mark,
          style: { ...style, bold: true },
          bbox: { x: bx + w + 2, y: y - labelFs, w: mw + 2, h: labelFs * 2 },
          halo: true,
        });
      }
    }

    // A small tick where each band was detected (even if the label is hidden).
    for (const [index, band] of lane.bands.entries()) {
      if (band.hidden || !inCropY(band.y, crop)) continue;
      const y = mapY(band.y, crop, gelY, gelH);
      items.push({
        kind: 'line',
        x1: x - 2,
        y1: y,
        x2: x + 2,
        y2: y,
        color: lane.isMarker ? inK : 'rgba(0,0,0,0.35)',
        width: lane.isMarker ? 0.9 : 0.5,
      });
      items.push({
        kind: 'rect',
        x: x - 4,
        y: y - 4,
        w: 8,
        h: 8,
        color: 'transparent',
        width: 0,
        hit: { kind: 'band', laneId: lane.id, bandIndex: index },
      });
    }
  }

  // Condition matrix.
  condRows.forEach((row, ri) => {
    const y = condY + ri * labelFs * 1.45 + labelFs * 0.9;
    const style: TextStyle = { family, size: labelFs, color: DEFAULT_INK, align: 'right', baseline: 'middle' };
    const lw = measureWidth(row.label, style);
    items.push({
      kind: 'text',
      x: gelX - 3,
      y,
      text: row.label,
      style,
      bbox: { x: gelX - 3 - lw, y: y - labelFs, w: lw, h: labelFs * 2 },
    });
    for (const lane of visible) {
      const cell = row.cells[lane.id] ?? '';
      const x = mapX(lane.x, crop, gelX, gelW);
      items.push({
        kind: 'text',
        x,
        y,
        text: cell,
        style: { ...style, align: 'center', bold: true },
        bbox: { x: x - 6, y: y - labelFs, w: 12, h: labelFs * 2 },
        hit: { kind: 'conditionCell', rowId: row.id, laneId: lane.id },
      });
    }
  });

  // --- annotations --------------------------------------------------------
  placeArrows(arrows, project, visible, crop, items, gelX, gelW, gelY, gelH, family, labelFs, gelDark);

  for (const b of brackets) {
    const sideX = b.side === 'left' ? gelX - 6 : gelX + gelW + 6;
    const color = annotationColor(b, gelDark);
    const vertical = b.side === 'left' || b.side === 'right';
    if (vertical) {
      const y0 = mapY(Math.min(b.start, b.end), crop, gelY, gelH);
      const y1 = mapY(Math.max(b.start, b.end), crop, gelY, gelH);
      items.push({ kind: 'line', x1: sideX, y1, x2: sideX, y2: y0, color, width: 1 });
      items.push({ kind: 'line', x1: sideX - 3, y1: y0, x2: sideX + 3, y2: y0, color, width: 1 });
      items.push({ kind: 'line', x1: sideX - 3, y1: y1, x2: sideX + 3, y2: y1, color, width: 1 });
      const style: TextStyle = { family, size: b.fontSize ?? labelFs, color, angle: 90, align: 'center', baseline: 'middle' };
      const w = measureWidth(b.label, style);
      const tx = b.side === 'left' ? sideX - 5 : sideX + 5;
      items.push({
        kind: 'text',
        x: tx,
        y: (y0 + y1) / 2,
        text: b.label,
        style,
        bbox: { x: tx - labelFs * 0.7, y: (y0 + y1) / 2 - w / 2, w: labelFs * 1.4, h: w },
        hit: { kind: 'annotation', annotationId: b.id },
      });
    } else {
      const x0 = mapX(Math.min(b.start, b.end), crop, gelX, gelW);
      const x1 = mapX(Math.max(b.start, b.end), crop, gelX, gelW);
      const by = b.side === 'top' ? gelY - 6 : gelY + gelH + 6;
      items.push({ kind: 'line', x1: x0, y1: by, x2: x1, y2: by, color, width: 1 });
      items.push({ kind: 'line', x1: x0, y1: by - 3, x2: x0, y2: by + 3, color, width: 1 });
      items.push({ kind: 'line', x1: x1, y1: by - 3, x2: x1, y2: by + 3, color, width: 1 });
      const style: TextStyle = { family, size: b.fontSize ?? labelFs, color, align: 'center', baseline: b.side === 'top' ? 'bottom' : 'top' };
      items.push({
        kind: 'text',
        x: (x0 + x1) / 2,
        y: b.side === 'top' ? by - 5 : by + labelFs,
        text: b.label,
        style,
        bbox: { x: x0, y: b.side === 'top' ? by - labelFs - 5 : by, w: Math.max(20, x1 - x0), h: labelFs * 2 },
        hit: { kind: 'annotation', annotationId: b.id },
      });
    }
  }

  const boxes = project.annotations.filter((a): a is Extract<Annotation, { type: 'box' }> => a.type === 'box');
  for (const box of boxes) {
    const bx = mapX(box.x, crop, gelX, gelW);
    const by = mapY(box.y, crop, gelY, gelH);
    const bw = (box.w / visW) * gelW;
    const bh = (box.h / visH) * gelH;
    const visibleBox = clipRect({ x: bx, y: by, w: bw, h: bh }, { x: gelX, y: gelY, w: gelW, h: gelH });
    if (!visibleBox) continue;
    const color = annotationColor(box, gelDark);
    items.push({ ...visibleBox, kind: 'rect', color, width: 1.2, hit: { kind: 'annotation', annotationId: box.id } });
    if (box.label) {
      const style: TextStyle = { family, size: box.fontSize ?? labelFs, color, align: 'left', baseline: 'alphabetic' };
      const w = measureWidth(box.label, style);
      items.push({
        kind: 'text',
        x: visibleBox.x,
        y: visibleBox.y - 3,
        text: box.label,
        style,
        bbox: { x: visibleBox.x, y: visibleBox.y - 3 - labelFs, w, h: labelFs + 2 },
        halo: true,
        hit: { kind: 'annotation', annotationId: box.id },
      });
    }
    if (box.enlarge) {
      // An enlarged copy sits to the right of the figure and adds width.
      const ew = enlargeW - 12;
      const eh = ew * (bh / Math.max(1, bw));
      const ex = gelX + gelW + 8;
      const ey = gelY + Math.min(gelH - eh, Math.max(0, by - gelY));
      items.push({ kind: 'image', x: ex, y: ey, w: ew, h: eh, source: 'box', box: { x: box.x, y: box.y, w: box.w, h: box.h } });
      items.push({ kind: 'rect', x: ex, y: ey, w: ew, h: eh, color, width: 1, hit: { kind: 'annotation', annotationId: box.id } });
      if (box.label) {
        const style: TextStyle = { family, size: labelFs, color, align: 'center', baseline: 'alphabetic' };
        items.push({
          kind: 'text',
          x: ex + ew / 2,
          y: ey + eh + labelFs + 2,
          text: box.label,
          style,
          bbox: { x: ex, y: ey + eh, w: ew, h: labelFs * 2 },
        });
      }
      // The enlarged copy may extend past the nominal width.
      height = Math.max(height, ey + eh + labelFs * 2 + MARGIN);
    }
  }

  for (const t of sideTexts) {
    const style: TextStyle = { family, size: t.fontSize ?? labelFs, color: annotationColor(t, gelDark) };
    if (t.side === 'top') {
      const w = measureWidth(t.text, style);
      const y = gelY - UNIT_ROW - labelFs * 0.4;
      items.push({
        kind: 'text',
        x: gelX + gelW / 2,
        y,
        text: t.text,
        style: { ...style, align: 'center', baseline: 'alphabetic' },
        bbox: { x: gelX + gelW / 2 - w / 2, y: y - labelFs, w, h: labelFs * 2 },
        hit: { kind: 'annotation', annotationId: t.id },
      });
    } else if (t.side === 'bottom') {
      const w = measureWidth(t.text, style);
      const y = height - MARGIN - labelFs * 1.4;
      items.push({
        kind: 'text',
        x: gelX + gelW / 2,
        y,
        text: t.text,
        style: { ...style, align: 'center' },
        bbox: { x: gelX + gelW / 2 - w / 2, y: y - labelFs, w, h: labelFs * 2 },
        hit: { kind: 'annotation', annotationId: t.id },
      });
    } else {
      const edge = t.side === 'left' ? gelX - leftW / 2 : gelX + gelW + rightW / 2;
      const y = gelY + visH * gelH * t.pos;
      const angle = t.side === 'left' ? -90 : 90;
      const w = measureWidth(t.text, style);
      items.push({
        kind: 'text',
        x: edge,
        y,
        text: t.text,
        style: { ...style, angle, align: 'center', baseline: 'middle' },
        bbox: { x: edge - labelFs, y: y - w / 2, w: labelFs * 2, h: w },
        hit: { kind: 'annotation', annotationId: t.id },
      });
    }
  }

  // Splice marks for removed lanes (never silently delete evidence).
  for (const lane of project.lanes) {
    if (!lane.removed || !inCropX(lane.x, crop)) continue;
    const x = mapX(lane.x, crop, gelX, gelW);
    const color = lane.splice === 'line' ? inK : '#ffffff';
    items.push({ kind: 'line', x1: x, y1: gelY, x2: x, y2: gelY + gelH, color, width: lane.splice === 'line' ? 1.4 : 4 });
  }

  groupItems.forEach((i) => items.push(i));
  return { width, height, gel: { x: gelX, y: gelY, w: gelW, h: gelH }, crop, gelDark, fontFamily: family, items };
}

function maxNameWidth(lanes: GelLane[], family: string, size: number): number {
  let w = 0;
  for (const l of lanes) w = Math.max(w, measureWidth(l.name, { family, size, color: '#000' }));
  return w;
}

function placeNames(
  lanes: GelLane[],
  crop: GelProject['crop'],
  gelX: number,
  gelW: number,
  rowH: number,
  size: number,
  family: string,
): { positions: Map<string, { row: number }>; twoRows: boolean } {
  const positions = new Map<string, { row: number }>();
  const occupied: { row: number; x0: number; x1: number }[] = [];
  let twoRows = false;
  for (const lane of [...lanes].sort((a, b) => a.x - b.x)) {
    const x = mapX(lane.x, crop, gelX, gelW);
    const w = Math.max(8, measureWidth(lane.name || '', { family, size: lane.style?.fontSize ?? size, color: '#000' }));
    const box = { x0: x - w / 2 - 1, x1: x + w / 2 + 1 };
    let row = 0;
    while (occupied.some((o) => o.row === row && !(box.x1 < o.x0 || box.x0 > o.x1))) row++;
    if (row > 1) row = 1;
    if (row === 1) twoRows = true;
    occupied.push({ row, ...box });
    positions.set(lane.id, { row });
  }
  return { positions, twoRows };
}

function placeGroups(
  project: GelProject,
  visible: GelLane[],
  crop: GelProject['crop'],
  gelX: number,
  gelW: number,
  startY: number,
  fs: number,
  family: string,
  gelDark: boolean,
  out: FigureItem[],
): number {
  const lanesById = new Map(visible.map((l) => [l.id, l]));
  const rows: { x0: number; x1: number }[][] = [];
  let y = startY;
  for (const group of project.groups) {
    const xs = group.laneIds
      .map((id) => lanesById.get(id))
      .filter((l): l is GelLane => !!l)
      .map((l) => mapX(l.x, crop, gelX, gelW));
    if (!xs.length) continue;
    const x0 = Math.min(...xs) - 6;
    const x1 = Math.max(...xs) + 6;
    const baseStyle: TextStyle = { family, size: fs, color: gelDark ? DEFAULT_ON_GEL_DARK : DEFAULT_INK, align: 'center' };
    const fitted = wrapLabel(group.name, Math.max(20, x1 - x0), baseStyle, project.layout.groupLabelFit);
    const labelW = Math.max(...fitted.lines.map((l) => measureWidth(l, fitted.style)));
    let row = 0;
    while (
      rows[row] &&
      rows[row].some((r) => !(x1 < r.x0 || x0 > r.x1) || Math.abs((x0 + x1) / 2 - (r.x0 + r.x1) / 2) < labelW)
    ) {
      row++;
    }
    if (!rows[row]) rows[row] = [];
    rows[row].push({ x0, x1 });
    const gy = startY + row * (fs * (fitted.lines.length + 1.8));
    out.push({ kind: 'line', x1: x0, y1: gy + 4, x2: x0, y2: gy, color: DEFAULT_INK, width: 0.9 });
    out.push({ kind: 'line', x1: x0, y1: gy, x2: x1, y2: gy, color: DEFAULT_INK, width: 0.9 });
    out.push({ kind: 'line', x1: x1, y1: gy, x2: x1, y2: gy + 4, color: DEFAULT_INK, width: 0.9 });
    fitted.lines.forEach((line, i) => {
      out.push({
        kind: 'text',
        x: (x0 + x1) / 2,
        y: gy + fs * (1.1 + i),
        text: line,
        style: { ...fitted.style, align: 'center', baseline: 'top' },
        bbox: { x: (x0 + x1) / 2 - labelW / 2, y: gy, w: labelW, h: fs * 1.3 },
        hit: { kind: 'group', groupId: group.id },
      });
    });
    y = Math.max(y, gy + fs * (fitted.lines.length + 2.1));
  }
  return y;
}

function placeArrows(
  arrows: Extract<Annotation, { type: 'arrow' }>[],
  project: GelProject,
  visible: GelLane[],
  crop: GelProject['crop'],
  out: FigureItem[],
  gelX: number,
  gelW: number,
  gelY: number,
  gelH: number,
  family: string,
  fs: number,
  gelDark: boolean,
) {
  const lanesById = new Map(visible.map((l) => [l.id, l]));
  const rows: { y: number }[] = [];
  for (const a of arrows) {
    const lane = lanesById.get(a.laneId);
    if (!lane) continue;
    const band = lane.bands[a.bandIndex];
    if (!band || band.hidden || !inCropY(band.y, crop)) continue;
    const tx = mapX(lane.x, crop, gelX, gelW);
    const ty = mapY(band.y, crop, gelY, gelH);
    const color = annotationColor(a, gelDark);
    const label = a.label || (band.size !== undefined ? `${band.approx ? '≈' : ''}${formatSize(band.size)}` : '');
    const size = a.fontSize ?? fs;
    const labelW = label ? measureWidth(label, { family, size, color }) : 0;
    const edge = a.side === 'left' ? gelX - 4 : gelX + gelW + 4;
    const tail = edge;
    // Stack arrows that would otherwise collide.
    let labelY = ty;
    for (const r of rows) if (Math.abs(r.y - labelY) < size + 1.5) labelY = r.y + size + 1.5;
    rows.push({ y: labelY });
    out.push({ kind: 'arrow', x1: tail, y1: labelY, x2: tx, y2: ty, color, width: 0.9, head: 3.2 });
    if (label) {
      out.push({
        kind: 'text',
        x: a.side === 'left' ? edge - labelW - 3 : edge + 3,
        y: labelY,
        text: label,
        style: { family, size, color, align: a.side === 'left' ? 'left' : 'left', baseline: 'middle' },
        bbox: { x: a.side === 'left' ? edge - labelW - 3 : edge + 3, y: labelY - size * 0.7, w: labelW + 2, h: size * 1.4 },
        hit: { kind: 'annotation', annotationId: a.id },
      });
    }
  }
}

function formatSize(size: number): string {
  if (size >= 1000) {
    const k = size / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  if (size >= 100) return String(Math.round(size));
  if (size >= 10) return String(Math.round(size * 10) / 10);
  return String(Math.round(size * 100) / 100);
}

export function mapX(x: number, crop: GelProject['crop'], gelX: number, gelW: number): number {
  return gelX + ((x - crop.left) / Math.max(0.05, 1 - crop.left - crop.right)) * gelW;
}

export function mapY(y: number, crop: GelProject['crop'], gelY: number, gelH: number): number {
  return gelY + ((y - crop.top) / Math.max(0.05, 1 - crop.top - crop.bottom)) * gelH;
}

export function unmapX(px: number, crop: GelProject['crop'], gelX: number, gelW: number): number {
  return crop.left + ((px - gelX) / gelW) * Math.max(0.05, 1 - crop.left - crop.right);
}

export function unmapY(py: number, crop: GelProject['crop'], gelY: number, gelH: number): number {
  return crop.top + ((py - gelY) / gelH) * Math.max(0.05, 1 - crop.top - crop.bottom);
}

function inCropX(x: number, crop: GelProject['crop']): boolean {
  return x >= crop.left - 0.01 && x <= 1 - crop.right + 0.01;
}

function inCropY(y: number, crop: GelProject['crop']): boolean {
  return y >= crop.top - 0.01 && y <= 1 - crop.bottom + 0.01;
}

function clipRect(r: Box, bounds: Box): Box | null {
  const x0 = Math.max(r.x, bounds.x);
  const y0 = Math.max(r.y, bounds.y);
  const x1 = Math.min(r.x + r.w, bounds.x + bounds.w);
  const y1 = Math.min(r.y + r.h, bounds.y + bounds.h);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function isDark(canvas: HTMLCanvasElement): boolean {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return false;
  const w = Math.min(64, canvas.width);
  const h = Math.min(64, canvas.height);
  const data = c.getImageData(0, 0, w, h).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  return sum / (data.length / 4) < 110;
}

// Exposed for the editor: nearest hit at a point in figure coordinates.
export function hitTest(layout: FigureLayout, x: number, y: number): Hit | null {
  for (let i = layout.items.length - 1; i >= 0; i--) {
    const item = layout.items[i];
    if (item.kind === 'text') {
      if (!item.hit) continue;
      const b = item.bbox;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return item.hit;
    } else if (item.kind === 'rect') {
      if (!item.hit) continue;
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) return item.hit;
    }
  }
  return null;
}

export { RED as RED_ANNOTATION, DEFAULT_INK };
