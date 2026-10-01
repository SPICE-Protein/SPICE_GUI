/**
 * SPICE Gene Editor - SnapGene-style Sequence Row Canvas Painter
 * Redesigned to match SnapGene Sequence View dark-mode aesthetic:
 *  - Gray-white uppercase DNA bases on dark charcoal background
 *  - Teal ruler ticks with gray position numbers
 *  - Blue semi-transparent selection highlight with rounded corners
 *  - Enzyme labels with vertical connector lines, staggered
 *  - Feature shapes: arrow-tipped CDS/gene, arrow promoters, small boxes
 *  - Blue rounded feature labels, inline white labels for CDS
 */

import { DNAComplementMap, getAminoAcidFromSequenceTriplet } from '$lib/genome';
import { calculateNebTm } from '$lib/genome';

export interface DrawRowOptions {
  row: {
    rowIdx: number;
    start: number;
    end: number;
    blocks: { blockIdx: number; bases: string[]; startPos: number }[];
  };
  dna: string;
  showEnzymes: boolean;
  showFeatures: boolean;
  showTranslations: boolean;
  restrictionSites: any[];
  geneFeatures: any[];
  parts: any[];
  primers: any[];
  selectionStart: number;
  selectionEnd: number;
  containerWidth: number;
  hoveredFeatureId: number | null;
  dpr: number;
  originOffset?: number;
  relativeNumbering?: boolean;
  showSingleStrand?: boolean;
  colorTheme?: string;
  modifiedRanges?: { start: number; end: number }[];
  seqTool?: 'browse' | 'edit' | 'annotate';
}

// SnapGene-style Layout Constants
export const CHAR_W = 9;
export const BLOCK_GAP = 0;
export const BLOCK_SIZE = 10;
export const LEFT_MARGIN = 58;
export const RIGHT_MARGIN = 24;

// SnapGene color palette
const COLOR_BG = '#0a0a0a';
const COLOR_BASE = '#cccccc';
const COLOR_BASE_COMP = '#9a9a9a';
const COLOR_RULER_TICK = '#4a90a4';
const COLOR_RULER_NUM = '#8a8a8a';
const COLOR_PLUS_MARK = '#444444';
const COLOR_AXIS_LINE = '#333333';
const COLOR_SELECTION_FILL = 'rgba(10, 132, 255, 0.35)';
const COLOR_SELECTION_BORDER = 'rgba(10, 132, 255, 0.6)';
const COLOR_ENZYME_LABEL = '#e0e0e0';
const COLOR_ENZYME_SPECIAL = '#ff453a';
const COLOR_ENZYME_CONNECTOR = '#555555';
const COLOR_ENZYME_SNIP = '#8a9ba8';
const COLOR_FEATURE_LABEL_BG = '#0a84ff';
const COLOR_FEATURE_LABEL_TEXT = '#ffffff';
const COLOR_PRIMER = '#b48cff';

const PART_COLOR = '#ac68cc';
const FEATURE_BODY_H = 11;
const FEATURE_TRACK_H = 18;
const LABEL_H = 12;
const DNA_FONT_SIZE = 13;
const RULER_HEIGHT = 22;
const STRAND_SPACING = 30;

export function getBasePixelX(blockIdx: number, charIdx: number): number {
  const absoluteIndex = blockIdx * BLOCK_SIZE + charIdx;
  return LEFT_MARGIN + absoluteIndex * CHAR_W;
}

// ---- OVE-style Interval Stacking ----
export function checkRangesOverlap(
  r1: { start: number; end: number },
  r2: { start: number; end: number }
): boolean {
  return Math.max(r1.start, r2.start) <= Math.min(r1.end, r2.end);
}

export function calculateRowYOffsets(annotations: any[]): { annotation: any; yOffset: number }[] {
  const sorted = [...annotations].sort((a, b) => b.end - b.start - (a.end - a.start));
  const levels: any[][] = [];
  const results = sorted.map((ann) => {
    let yOffset = 0;
    while (yOffset < levels.length) {
      const blocked = levels[yOffset].some((other) => checkRangesOverlap(ann, other));
      if (!blocked) break;
      yOffset++;
    }
    if (yOffset === levels.length) levels.push([]);
    levels[yOffset].push(ann);
    return { annotation: ann, yOffset };
  });
  return results;
}

// ---- OVE getAnnotationRangeType equivalent ----
export function getAnnotationRangeType(
  rowStart: number,
  rowEnd: number,
  annStart: number,
  annEnd: number
): 'middle' | 'start' | 'end' | 'beginningAndEnd' {
  const startInside = annStart >= rowStart && annStart <= rowEnd;
  const endInside = annEnd >= rowStart && annEnd <= rowEnd;
  if (startInside && endInside) return 'beginningAndEnd';
  if (startInside) return 'start';
  if (endInside) return 'end';
  return 'middle';
}

// ---- SnapGene feature type classification for shape rendering ----
export function getFeatureShapeType(type: string): 'arrow' | 'box' | 'promoter' {
  const t = (type || '').toLowerCase();
  if (['cds', 'gene', 'exon', 'mat_peptide', 'sig_peptide', 'signal_peptide'].includes(t)) return 'arrow';
  if (['promoter', 'enhancer', 'operator', 'caat_signal', 'gc_signal', '-35_signal', '-10_signal', 'tata_box'].includes(t)) return 'promoter';
  return 'box';
}

interface LabelBox<T = any> {
  x0: number;
  x1: number;
  yOffset: number;
  data: T;
}

export function calculateLabelYOffsets<T extends { x0: number; x1: number; text: string }>(
  items: T[]
): (T & { yOffset: number })[] {
  const sorted = items
    .map((it) => ({ ...it, x0: it.x0, x1: Math.max(it.x1, it.x0 + it.text.length * 6) }))
    .sort((a, b) => a.x0 - b.x0);
  const levels: { x0: number; x1: number }[][] = [];
  const out: (T & { yOffset: number })[] = [];
  for (const it of sorted) {
    let yOffset = 0;
    while (yOffset < levels.length) {
      const overlap = levels[yOffset].some((box) => it.x0 <= box.x1 && it.x1 >= box.x0);
      if (!overlap) break;
      yOffset++;
    }
    if (yOffset === levels.length) levels.push([{ x0: it.x0, x1: it.x1 }]);
    else levels[yOffset].push({ x0: it.x0, x1: it.x1 });
    out.push({ ...it, yOffset });
  }
  return out;
}

export function getAnnotationStackHeight(annotations: any[]): number {
  const stacked = calculateRowYOffsets(annotations);
  const maxOffset = stacked.reduce((m, cur) => Math.max(m, cur.yOffset), -1);
  return (maxOffset + 1) * FEATURE_TRACK_H + 5;
}

export function getAnnotationLabelHeight(
  annotations: any[],
  row: { start: number; end: number }
): number {
  const items = annotations
    .filter((a) => !(a.end < row.start || a.start > row.end))
    .map((a) => {
      const x0 = getBasePixelX(0, Math.max(a.start, row.start) - row.start);
      const x1 = getBasePixelX(0, Math.min(a.end, row.end) - row.start) + CHAR_W;
      const tw = (String(a.name || '').length + 2) * 6;
      const mid = (x0 + x1) / 2;
      return { x0: mid - tw / 2, x1: mid + tw / 2, text: String(a.name || '') };
    });
  const boxes = calculateLabelYOffsets(items);
  const maxOffset = boxes.reduce((m, b) => Math.max(m, b.yOffset), -1);
  return (maxOffset + 1) * LABEL_H;
}

// Compute the pixel x-coordinate for a cutsite label center.
// OVE-style: center on the recognition site range midpoint rather than the
// cut position. Falls back to the cut position for backward compatibility.
function getCutsiteLabelCenterX(s: any, row: { start: number; end: number }): number {
  const rowLen = row.end - row.start + 1;
  let xc: number;
  if (s.recognitionSiteRange) {
    const rs = s.recognitionSiteRange;
    const midPos = (rs.start + rs.end + 1) / 2;
    const relIdx = midPos - (row.start - 1);
    if (relIdx >= 1 && relIdx <= rowLen) {
      xc = LEFT_MARGIN + relIdx * CHAR_W + CHAR_W / 2;
    } else {
      // The recognition range straddles a line boundary, so its midpoint sits on a
      // neighbouring row. Anchor the label to the cut position (always on this row)
      // so a line-crossing enzyme is still annotated instead of being clipped away.
      xc = getBasePixelX(0, s.pos - row.start) + CHAR_W / 2;
    }
  } else {
    // Fallback: center on cut position (1-based pos)
    xc = getBasePixelX(0, s.pos - row.start) + CHAR_W / 2;
  }
  // Clamp into the row's visible width so edge/cross-line labels stay on-canvas.
  const left = LEFT_MARGIN + 16;
  const right = LEFT_MARGIN + rowLen * CHAR_W - 16;
  if (right >= left) xc = Math.min(right, Math.max(left, xc));
  return xc;
}

// Compute cutsite label height with proper x-coordinate collision detection.
// Each label is centered above its recognition site; the interval [x0, x1] is
// the label's pixel span, used by calculateLabelYOffsets for stacking.
export function getCutsiteLabelHeight(
  sites: any[],
  row: { start: number; end: number }
): number {
  const items = sites
    .filter((s) => s.pos >= row.start && s.pos <= row.end)
    .map((s) => {
      const xCenter = getCutsiteLabelCenterX(s, row);
      const tw = (String(s.name || '').length + 2) * 6;
      return { x0: xCenter - tw / 2, x1: xCenter + tw / 2, text: s.name };
    });
  const boxes = calculateLabelYOffsets(items);
  const maxOffset = boxes.reduce((m, b) => Math.max(m, b.yOffset), -1);
  return (maxOffset + 1) * LABEL_H;
}

function fitLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  maxWidth: number
): string {
  if (maxWidth < 12) return '';
  let w = ctx.measureText(name).width;
  if (w <= maxWidth) return name;
  for (let i = name.length; i > 3; i--) {
    const candidate = name.slice(0, i - 2) + '..';
    w = ctx.measureText(candidate).width;
    if (w <= maxWidth) return candidate;
  }
  return '';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---- SnapGene-style feature shape drawing ----
function drawFeatureShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rangeType: 'middle' | 'start' | 'end' | 'beginningAndEnd',
  forward: boolean,
  color: string,
  shapeType: 'arrow' | 'box' | 'promoter',
  isHovered: boolean
) {
  const h = height;
  const arrowW = Math.min(width / 2, 7);

  ctx.save();
  if (!forward) {
    ctx.translate(x * 2 + width, 0);
    ctx.scale(-1, 1);
  }

  ctx.beginPath();

  if (shapeType === 'box') {
    // Simple rectangle, no arrow tip (binding sites, misc features)
    ctx.rect(x, y, width, h);
  } else if (shapeType === 'promoter') {
    // Promoter: arrow shape (pentagon-like, pointed at the transcription start)
    const tipX = x + width;
    const bodyEnd = x + Math.max(0, width - arrowW);
    if (rangeType === 'middle') {
      ctx.rect(x, y, width, h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(bodyEnd, y);
      ctx.lineTo(tipX, y + h / 2);
      ctx.lineTo(bodyEnd, y + h);
      if (rangeType === 'beginningAndEnd') {
        ctx.lineTo(x, y + h);
        ctx.closePath();
      } else {
        ctx.lineTo(x, y + h);
        ctx.closePath();
      }
    }
  } else {
    // CDS/gene: arrow-tipped rectangle
    const tipX = x + width;
    const bodyEnd = x + Math.max(0, width - arrowW);
    if (rangeType === 'middle') {
      ctx.rect(x, y, width, h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(bodyEnd, y);
      ctx.lineTo(tipX, y + h / 2);
      ctx.lineTo(bodyEnd, y + h);
      if (rangeType === 'beginningAndEnd') {
        ctx.lineTo(x, y + h);
        ctx.closePath();
      } else {
        ctx.lineTo(x, y + h);
        ctx.closePath();
      }
    }
  }

  ctx.fillStyle = color;
  ctx.globalAlpha = isHovered ? 1 : 0.88;
  ctx.fill();
  ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0,0,0,0.25)';
  ctx.lineWidth = isHovered ? 1 : 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawAnnotationLabels(
  ctx: CanvasRenderingContext2D,
  annotations: any[],
  row: { start: number; end: number },
  baseY: number,
  getColor: (a: any) => string,
  useRoundedBg: boolean
) {
  const items = annotations.map((a) => {
    const x0 = getBasePixelX(0, Math.max(a.start, row.start) - row.start);
    const x1 = getBasePixelX(0, Math.min(a.end, row.end) - row.start) + CHAR_W;
    const mid = (x0 + x1) / 2;
    const text = String(a.name || '');
    return { x0: mid - 3, x1: mid + 3, text, width: x1 - x0, midX: mid, annotation: a, color: getColor(a) };
  });

  const boxes = calculateLabelYOffsets(items);
  ctx.font = '10px -apple-system, "SF Pro", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  boxes.forEach((box, idx) => {
    const info = items[idx];
    const maxWidth = info.width + 20;
    const label = fitLabel(ctx, info.text, maxWidth);
    if (!label) return;
    const y = baseY - 2 - box.yOffset * LABEL_H;

    if (useRoundedBg) {
      // SnapGene-style: blue rounded label background
      const tw = ctx.measureText(label).width;
      const padX = 4;
      const bgX = info.midX - tw / 2 - padX;
      const bgW = tw + padX * 2;
      const bgH = LABEL_H - 2;
      ctx.fillStyle = COLOR_FEATURE_LABEL_BG;
      roundRect(ctx, bgX, y - bgH + 1, bgW, bgH, 3);
      ctx.fill();
      ctx.fillStyle = COLOR_FEATURE_LABEL_TEXT;
    } else {
      ctx.fillStyle = info.color;
    }
    ctx.fillText(label, info.midX, y);
    // leader line
    ctx.strokeStyle = useRoundedBg ? 'rgba(10, 132, 255, 0.4)' : info.color;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(info.midX, y + 1);
    ctx.lineTo(info.midX, baseY + 5);
    ctx.stroke();
  });
}

function drawAnnotationTrack(
  ctx: CanvasRenderingContext2D,
  annotations: any[],
  row: { start: number; end: number },
  baseY: number,
  getColor: (a: any) => string,
  hoveredId: number | null
) {
  const stacked = calculateRowYOffsets(annotations);
  stacked.forEach(({ annotation, yOffset }) => {
    const fStart = Math.max(annotation.start, row.start);
    const fEnd = Math.min(annotation.end, row.end);
    const x0 = getBasePixelX(0, fStart - row.start);
    const x1 = getBasePixelX(0, fEnd - row.start) + CHAR_W;
    const fw = Math.max(x1 - x0, 4);
    const fwd = annotation.forward !== false;
    const itemY = baseY + yOffset * FEATURE_TRACK_H;
    const rangeType = getAnnotationRangeType(row.start, row.end, annotation.start, annotation.end);
    const isHovered = hoveredId === annotation.id;
    const shapeType = getFeatureShapeType(annotation.type);

    drawFeatureShape(ctx, x0, itemY, fw, FEATURE_BODY_H, rangeType, fwd, getColor(annotation), shapeType, isHovered);

    // For CDS/gene, draw the name inside the shape
    if (shapeType === 'arrow' && fw > 30) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px -apple-system, "SF Pro", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = fitLabel(ctx, String(annotation.name || ''), fw - 8);
      if (label) {
        ctx.fillText(label, (x0 + x1) / 2, itemY + FEATURE_BODY_H / 2);
      }
      ctx.restore();
    }
  });
  return baseY + (stacked.reduce((m, c) => Math.max(m, c.yOffset), -1) + 1) * FEATURE_TRACK_H;
}

// ---- SnapGene-style ruler with teal ticks ----
function drawRuler(
  ctx: CanvasRenderingContext2D,
  row: { start: number; end: number },
  baseY: number,
  originOffset = 0,
  relativeNumbering = false
) {
  ctx.strokeStyle = COLOR_RULER_TICK;
  ctx.lineWidth = 0.8;
  ctx.fillStyle = COLOR_RULER_NUM;
  ctx.font = '10px -apple-system, "SF Pro", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Baseline
  ctx.strokeStyle = COLOR_AXIS_LINE;
  ctx.lineWidth = 0.5;
  const startX = getBasePixelX(0, 0);
  const endX = getBasePixelX(0, row.end - row.start + 1);
  ctx.beginPath();
  ctx.moveTo(startX, baseY + RULER_HEIGHT - 2);
  ctx.lineTo(endX, baseY + RULER_HEIGHT - 2);
  ctx.stroke();

  // Tick marks
  for (let pos = row.start; pos <= row.end; pos++) {
    const relIdx = pos - row.start;
    const x = getBasePixelX(0, relIdx) + CHAR_W / 2;
    const tickH = (pos % 10 === 0) ? 10 : (pos % 5 === 0) ? 6 : 0;
    if (tickH === 0) continue;

    ctx.strokeStyle = COLOR_RULER_TICK;
    ctx.lineWidth = (pos % 10 === 0) ? 1 : 0.6;
    ctx.beginPath();
    ctx.moveTo(x, baseY + RULER_HEIGHT - 2);
    ctx.lineTo(x, baseY + RULER_HEIGHT - 2 - tickH);
    ctx.stroke();

    if (pos % 10 === 0) {
      let displayText = "";
      if (relativeNumbering && originOffset > 0) {
        const offsetFromTss = pos - originOffset;
        if (offsetFromTss >= 0) {
          displayText = `+${offsetFromTss + 1}`;
        } else {
          displayText = `${offsetFromTss}`;
        }
      } else if (originOffset > 0) {
        const shifted = pos - originOffset + 1;
        displayText = String(shifted > 0 ? shifted : shifted - 1);
      } else {
        displayText = String(pos);
      }

      ctx.fillStyle = COLOR_RULER_NUM;
      ctx.fillText(displayText, x, baseY);
    }
  }
}

// ---- Main row painter ----
export function drawSequenceRowOnCanvas(ctx: CanvasRenderingContext2D, opt: DrawRowOptions): number {
  const {
    row,
    dna,
    showEnzymes,
    showFeatures,
    showTranslations,
    restrictionSites,
    geneFeatures,
    parts,
    selectionStart,
    selectionEnd,
    hoveredFeatureId
  } = opt;

  const complement = (base: string) => DNAComplementMap[base] ?? 'N';
  let curY = 8; // Top spacer

  const rowParts = parts.filter((p) => !(p.end < row.start || p.start > row.end));
  const rowSites = restrictionSites.filter((s) => s.pos >= row.start && s.pos <= row.end);
  const rowFeats = geneFeatures.filter((f) => !(f.end < row.start || f.start > row.end));

  // Clear background
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, opt.containerWidth, ctx.canvas.height / (opt.dpr || 1));

  // ---- 1. Ruler ----
  drawRuler(ctx, row, curY, opt.originOffset, opt.relativeNumbering);
  curY += RULER_HEIGHT + 4;

  // Pre-calculate selection bar height so we know DNA Y before drawing enzyme labels.
  const hasSelection = selectionStart !== 1 || selectionEnd !== 1;
  const selStart = hasSelection ? Math.max(selectionStart, row.start) : 0;
  const selEnd = hasSelection ? Math.min(selectionEnd, row.end) : 0;
  const selInRow = hasSelection && selStart <= selEnd;
  const selBarH = selInRow ? 18 : 0;

  // Pre-calculate enzyme label height
  const enzymeLabelH = (showEnzymes && rowSites.length) ? getCutsiteLabelHeight(rowSites, row) : 0;


  // ---- 2. Enzyme labels (above sequence, with connector lines to DNA) ----
  // Stores label info for connector line drawing after DNA is rendered.
  const enzymeLabelPositions: { x: number; labelBottomY: number; color: string; site: any }[] = [];

 if (showEnzymes && rowSites.length && enzymeLabelH > 0) {
  // Build label items centered on each cut position for collision avoidance
   const items = rowSites.map((s) => {
    const xCenter = getCutsiteLabelCenterX(s, row);
     const tw = (String(s.name || '').length + 2) * 6;
     return { x0: xCenter - tw / 2, x1: xCenter + tw / 2, text: s.name, xCenter, site: s };
   });
    const boxes = calculateLabelYOffsets(items);

    ctx.font = 'bold 10px -apple-system, "SF Pro", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    boxes.forEach((box) => {
      const xCenter = (box as any).xCenter;
      const site = (box as any).site;
      const y = curY + enzymeLabelH - box.yOffset * LABEL_H;
      const isSpecial = site.methylated || String(site.color).includes('ff453a') || String(site.color).includes('ff5d5d');
      const color = isSpecial
        ? COLOR_ENZYME_SPECIAL
        : (String(site.color).startsWith('var(') ? COLOR_ENZYME_LABEL : String(site.color));

      // Label background for special enzymes (red bordered box)
      if (isSpecial) {
        const tw = ctx.measureText(site.name).width;
        ctx.fillStyle = 'rgba(255, 69, 58, 0.12)';
        roundRect(ctx, xCenter - tw / 2 - 3, y - 11, tw + 6, 13, 2);
        ctx.fill();
        ctx.strokeStyle = COLOR_ENZYME_SPECIAL;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.fillText(site.name, xCenter, y);

      enzymeLabelPositions.push({
        x: xCenter,
        labelBottomY: y + 1,
        color: isSpecial ? COLOR_ENZYME_SPECIAL : (String(site.color).startsWith('var(') ? COLOR_ENZYME_CONNECTOR : String(site.color)),
        site
      });
    });

    curY += enzymeLabelH + 2;
  }

  // ---- 3. Selection info bar (floating above selection) ----
  let selectionInfoY = -1;
  if (selInRow) {
    const x0 = getBasePixelX(0, selStart - row.start);
    const x1 = getBasePixelX(0, selEnd - row.start) + CHAR_W;
    const midX = (x0 + x1) / 2;
    const infoText = `${selStart}..${selEnd} = ${selEnd - selStart + 1} bp`;
    const selLen = selEnd - selStart + 1;
    const segSeq = dna.slice(selStart - 1, selEnd);
    let tmText = '';
    if (selLen >= 4 && selLen <= 50) {
      try {
        const tm = calculateNebTm(segSeq, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
        if (typeof tm === 'number' && !isNaN(tm)) {
          tmText = `Tm = ${Math.round(tm)}\u00b0C`;
        }
      } catch {}
    }
    ctx.font = '10px -apple-system, "SF Pro", sans-serif';
    const tw = ctx.measureText(infoText).width;
    const tmW = tmText ? ctx.measureText(tmText).width + 10 : 0;
    const barW = tw + tmW + 16;
    const barX = Math.max(LEFT_MARGIN, Math.min(midX - barW / 2, opt.containerWidth - RIGHT_MARGIN - barW));
    const barH = 16;
    const barY = curY;
    selectionInfoY = barY;

    // Dark semi-transparent background bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();

    // Info text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(infoText, barX + 6, barY + barH / 2);

    // Tm label (purple rounded background)
    if (tmText) {
      const tmX = barX + 6 + tw + 4;
      ctx.fillStyle = '#b84c7a';
      roundRect(ctx, tmX, barY + 2, tmW, barH - 4, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tmText, tmX + 5, barY + barH / 2);
    }
    curY += barH + 2;
  }

  // ---- 4. DNA Sequence Container ----
  const seqContainerY = curY;
  const showSingle = opt.showSingleStrand === true;
  const topStrandY = seqContainerY + 10;
  const bottomStrandY = showSingle ? topStrandY : seqContainerY + 10 + STRAND_SPACING;
  const plusY = (topStrandY + bottomStrandY) / 2;

  // Render edit history highlights (Feature 5)
  if (opt.modifiedRanges && opt.modifiedRanges.length > 0) {
    opt.modifiedRanges.forEach((range) => {
      const start = Math.max(range.start, row.start);
      const end = Math.min(range.end, row.end);
      if (start <= end) {
        const x0 = getBasePixelX(0, start - row.start);
        const x1 = getBasePixelX(0, end - row.start) + CHAR_W;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.18)'; // Soft red highlight for modifications
        const highlightH = showSingle ? 20 : (bottomStrandY - topStrandY + 12);
        roundRect(ctx, x0, topStrandY - 6, x1 - x0, highlightH, 2);
        ctx.fill();
      }
    });
  }

  // Selection highlight (behind bases)
  if (selInRow) {
    const x0 = getBasePixelX(0, selStart - row.start);
    const x1 = getBasePixelX(0, selEnd - row.start) + CHAR_W;
    ctx.fillStyle = COLOR_SELECTION_FILL;
    const highlightH = showSingle ? 20 : (bottomStrandY - topStrandY + 12);
    roundRect(ctx, x0, topStrandY - 6, x1 - x0, highlightH, 3);
    ctx.fill();
    ctx.strokeStyle = COLOR_SELECTION_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Caret cursor for insertion mode (Edit tool)
  if (opt.seqTool === 'edit' && selectionStart === selectionEnd && selectionStart >= row.start && selectionStart <= row.end + 1) {
    const relPos = selectionStart - row.start;
    const x = LEFT_MARGIN + relPos * CHAR_W; // Exactly between bases!
    ctx.strokeStyle = '#ffb703'; // Bright yellow/gold cursor!
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(x, topStrandY - 6);
    ctx.lineTo(x, bottomStrandY + 6);
    ctx.stroke();
  }

  // DNA bases - SnapGene style: uppercase, gray-white, monospace
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  row.blocks.forEach((block) => {
    block.bases.forEach((base, charIdx) => {
      const x = getBasePixelX(block.blockIdx, charIdx) + CHAR_W / 2;
      const upperBase = base.toUpperCase();

      // Base color according to theme (Gap 13)
      let baseColor = COLOR_BASE;
      const theme = opt.colorTheme || 'monochrome';
      if (theme === 'atcg') {
        if (upperBase === 'A') baseColor = '#53d769';
        else if (upperBase === 'T') baseColor = '#ff453a';
        else if (upperBase === 'C') baseColor = '#0a84ff';
        else if (upperBase === 'G') baseColor = '#ff9f1c';
      } else if (theme === 'snapgene') {
        if (upperBase === 'A') baseColor = '#ff453a'; // Red
        else if (upperBase === 'T') baseColor = '#53d769'; // Green
        else if (upperBase === 'C') baseColor = '#0a84ff'; // Blue
        else if (upperBase === 'G') baseColor = '#ffd23f'; // Yellow-Orange
      } else if (theme === 'benchling') {
        if (upperBase === 'A') baseColor = '#94ebd4'; // Pastel Green
        else if (upperBase === 'T') baseColor = '#fdb5c9'; // Pastel Pink
        else if (upperBase === 'C') baseColor = '#9ac8fc'; // Pastel Blue
        else if (upperBase === 'G') baseColor = '#ffe29a'; // Pastel Yellow
      } else if (theme === 'sanger') {
        if (upperBase === 'A') baseColor = '#10af10'; // ABI Green
        else if (upperBase === 'T') baseColor = '#df1010'; // ABI Red
        else if (upperBase === 'C') baseColor = '#1010df'; // ABI Blue
        else if (upperBase === 'G') baseColor = '#dfaf10'; // ABI Black/Yellow
      } else if (theme === 'purine_pyrimidine') {
        if (upperBase === 'A' || upperBase === 'G') baseColor = '#c084fc'; // Purines (Purple)
        else if (upperBase === 'C' || upperBase === 'T') baseColor = '#38bdf8'; // Pyrimidines (Sky Blue)
      } else if (theme === 'gc') {
        if (upperBase === 'G' || upperBase === 'C') baseColor = '#4cd6ff';
        else baseColor = '#475569';
      }

      // 5' strand (top)
      ctx.fillStyle = baseColor;
      ctx.font = `${DNA_FONT_SIZE}px "SF Mono", "Monaco", "Menlo", "Courier New", monospace`;
      ctx.fillText(upperBase, x, topStrandY);

      if (!showSingle) {
        // + marks between strands (every 5bp)
        if ((block.startPos + charIdx - row.start) % 5 === 0) {
          ctx.fillStyle = COLOR_PLUS_MARK;
          ctx.font = '10px "SF Mono", "Monaco", monospace';
          ctx.fillText('+', x, plusY);
        }

        // 3' strand (bottom complement)
        ctx.fillStyle = COLOR_BASE_COMP;
        ctx.font = `${DNA_FONT_SIZE}px "SF Mono", "Monaco", "Menlo", "Courier New", monospace`;
        ctx.fillText(complement(upperBase), x, bottomStrandY);
      }
    });
  });

 // ---- 4b. Enzyme snip marks on DNA strands + connectors ----
 // OVE-style: vertical snip lines at the cut position on each strand,
 // a horizontal connector between the two snips, and a connector line
 // from each enzyme label down to the top-strand snip.
 if (showEnzymes && rowSites.length) {
   rowSites.forEach((site) => {
     // OVE-style: separate top and bottom snip positions (0-based "between" positions).
     // The snip is drawn as a vertical line at the gap between bases, not centered on a base.
     // topSnipPosition/bottomSnipPosition are 0-based; row.start is 1-based.
     // Relative index: snipRel = snipPosition - (row.start - 1)
     // Pixel: x = LEFT_MARGIN + snipRel * CHAR_W (no +CHAR_W/2 since it's between bases)
     const hasOveFields = typeof site.topSnipPosition === 'number' && typeof site.bottomSnipPosition === 'number';
     const topSnipRel = hasOveFields
       ? site.topSnipPosition - (row.start - 1)
       : site.pos - row.start;
     const botSnipRel = hasOveFields
       ? site.bottomSnipPosition - (row.start - 1)
       : site.pos - row.start;
     const xTop = LEFT_MARGIN + topSnipRel * CHAR_W;
     const xBot = LEFT_MARGIN + botSnipRel * CHAR_W;
     const color = String(site.color).startsWith('var(') ? COLOR_ENZYME_SNIP : String(site.color);
     const isSpecial = site.methylated || String(site.color).includes('ff453a') || String(site.color).includes('ff5d5d');
     const snipColor = isSpecial ? COLOR_ENZYME_SPECIAL : color;

     // Top strand snip: vertical line through the top strand
     ctx.strokeStyle = snipColor;
     ctx.lineWidth = 1.5;
     ctx.beginPath();
     ctx.moveTo(xTop, topStrandY - 8);
     ctx.lineTo(xTop, topStrandY + 8);
     ctx.stroke();

     // Bottom strand snip: vertical line through the bottom strand
     ctx.beginPath();
     ctx.moveTo(xBot, bottomStrandY - 8);
     ctx.lineTo(xBot, bottomStrandY + 8);
     ctx.stroke();

     // Snip connector: horizontal line between top and bottom snip positions.
     // OVE draws this in the gap between the two strands, connecting the two
     // snip x-positions so the overhang is visually represented.
     const xLeft = Math.min(xTop, xBot);
     const xRight = Math.max(xTop, xBot);
     if (xRight > xLeft) {
       ctx.strokeStyle = snipColor;
       ctx.lineWidth = 1.5;
       ctx.globalAlpha = 0.5;
       ctx.beginPath();
       ctx.moveTo(xLeft, (topStrandY + bottomStrandY) / 2);
       ctx.lineTo(xRight, (topStrandY + bottomStrandY) / 2);
       ctx.stroke();
       ctx.globalAlpha = 1;
     } else {
       // Blunt cut: vertical line connecting strands
       ctx.lineWidth = 1;
       ctx.globalAlpha = 0.45;
       ctx.beginPath();
       ctx.moveTo(xTop, topStrandY + 8);
       ctx.lineTo(xBot, bottomStrandY - 8);
       ctx.stroke();
       ctx.globalAlpha = 1;
     }
   });

  // Connector lines from enzyme labels to top-strand snip positions.
  // Target the x of the top strand snip (or the cut pos as fallback).
  enzymeLabelPositions.forEach(({ x, labelBottomY, color, site }) => {
    const hasOve = site && typeof site.topSnipPosition === 'number';
    const snipRel = hasOve ? site.topSnipPosition - (row.start - 1) : site.pos - row.start;
    let snipX = hasOve ? LEFT_MARGIN + snipRel * CHAR_W : x;
    // Keep the connector target on-canvas for sites whose cut/snip crosses a line boundary.
    const rowRight = LEFT_MARGIN + (row.end - row.start + 1) * CHAR_W;
    snipX = Math.min(rowRight, Math.max(LEFT_MARGIN, snipX));
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x, labelBottomY);
    ctx.lineTo(snipX, topStrandY - 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
 }

  // 5'/3' end labels
  ctx.textAlign = 'right';
  ctx.fillStyle = '#888888';
  ctx.font = '11px -apple-system, "SF Pro", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText("5'", LEFT_MARGIN - 6, topStrandY);
  if (!showSingle) {
    ctx.fillText("3'", LEFT_MARGIN - 6, bottomStrandY);
  }

  // Row start/end position labels on right
  ctx.textAlign = 'left';
  ctx.fillStyle = '#666666';
  ctx.font = '10px -apple-system, "SF Pro", sans-serif';
  ctx.fillText(String(row.end), opt.containerWidth - RIGHT_MARGIN + 4, topStrandY);

 curY = bottomStrandY + 12;

 // ---- 5. Amino Acid Translations ----
 if (showTranslations) {
   const aaY = curY;
   ctx.textAlign = 'center';
   ctx.textBaseline = 'middle';

   row.blocks.forEach((block) => {
     block.bases.forEach((_, charIdx) => {
       const globalPos = block.startPos + charIdx;
       if ((globalPos - 1) % 3 === 0) {
         const codon = dna.slice(globalPos - 1, globalPos + 2);
         if (codon.length === 3) {
           const aa = getAminoAcidFromSequenceTriplet(codon.toUpperCase())?.value ?? '?';
           const x0 = getBasePixelX(block.blockIdx, charIdx);
           const x1 = x0 + CHAR_W * 3;
           const xMid = (x0 + x1) / 2;

           ctx.fillStyle = 'rgba(219, 39, 119, 0.2)';
           ctx.strokeStyle = 'rgba(219, 39, 119, 0.5)';
           ctx.lineWidth = 0.5;
           roundRect(ctx, x0 + 1, aaY, CHAR_W * 3 - 1, 13, 2);
           ctx.fill();
           ctx.stroke();

           ctx.fillStyle = '#aaaaaa';
           ctx.font = '10px "SF Mono", "Monaco", monospace';
           ctx.fillText(aa, xMid, aaY + 6.5);
         }
       }
     });
   });
   curY += 18;
 }

 // ---- 6. Feature tracks ----
 if (showFeatures && rowFeats.length) {
   // Reserve label height so labels draw below the DNA, not overlapping the
   // complementary strand. drawAnnotationLabels draws upward from baseY, so
   // we must advance curY past the label zone first.
   const featLabelH = getAnnotationLabelHeight(rowFeats, row);
   curY += featLabelH;
  drawAnnotationLabels(ctx, rowFeats, row, curY, (a) => a.color, true);
   // Labels drawn upward from curY (into the reserved space above).
   // Track shapes drawn downward from curY.
  drawAnnotationTrack(ctx, rowFeats, row, curY, (a) => a.color, hoveredFeatureId);
   curY += getAnnotationStackHeight(rowFeats) + 5;
 }

 // ---- 7. Parts (bottom, if any) ----
 if (rowParts.length) {
   const partLabelH = getAnnotationLabelHeight(rowParts, row);
   curY += partLabelH;
   drawAnnotationLabels(ctx, rowParts, row, curY, () => PART_COLOR, false);
   drawAnnotationTrack(ctx, rowParts, row, curY, () => PART_COLOR, -1);
   curY += getAnnotationStackHeight(rowParts) + 5;
 }

  return curY + 8;
}
