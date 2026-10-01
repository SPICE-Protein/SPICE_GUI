<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import {
    polarToCartesian,
    normalizeAngle,
    relaxLabelAngles,
    getTextLengthWithCollapseSpace,
    type OveLabel
  } from './utils/geometry';
  import { drawOvePiePiece } from './utils/circularOve';
  import {
    getPositionFromAngle,
    getRangeLength,
    getOverlapsOfPotentiallyCircularRanges,
    normalizePositionByRangeLength,
    rotateBpsToPosition
  } from '$lib/genome';
  // Svelte 5 props
  let {
    plasmidName = '',
    dnaSeq = $bindable(''),
    geneFeatures = [],
    restrictionSites = [],
    primers = [],
    selectionNotes = [],
    activeFeatureId = $bindable(null),
    selectionStart = $bindable(1),
    selectionEnd = $bindable(1),
    exportPng = $bindable(null),
    activeTool = 'select',
    mapRef = $bindable<{ zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null>(null)
  } = $props<{
    plasmidName: string;
    dnaSeq: string;
    geneFeatures: any[];
    restrictionSites: any[];
    primers: any[];
    selectionNotes?: { start: number; end: number; text: string }[];
    activeFeatureId: number | null;
    selectionStart: number;
    selectionEnd: number;
    exportPng: (() => Promise<void>) | null;
    activeTool: 'select' | 'pan' | 'rotate';
    mapRef: { zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null;
  }>();
 // OVE States
let zoomLevel = $state(1);
let rotationRadians = $state(0); // 0 radians is at 12 o'clock
let panX = $state(0); // canvas translate X (for pan tool)
let panY = $state(0); // canvas translate Y (for pan tool)
let dragState = $state<{ startX: number; startRot: number; dragging: boolean } | null>(null);
  let selectDrag = $state<{ startBp: number; dragging: boolean } | null>(null);
 let panDrag = $state<{ startX: number; startY: number; startPanX: number; startPanY: number; dragging: boolean } | null>(null);
  // Reverse-sequence strand is not rendered in the SPICE circular view.
  const showReverseSequence = false;
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let canvasW = $state(420);
  let canvasH = $state(420);
  let dpr = $state(1);
  let shotBusy = $state(false);
  // Constants
  const CX = 200;
  const CY = 200;
  const BASE_RADIUS = 70;
  const SVG_W = 400;
  const seqLen = $derived(dnaSeq.length);
  // Math helpers
  function normPos1Based(pos: number): number {
    if (seqLen <= 0) return 0;
    return (((pos - 1) % seqLen) + seqLen) % seqLen;
  }
  function angleFor0Based(pos: number): number {
    return (pos / Math.max(seqLen, 1)) * 2 * Math.PI;
  }
  function shouldFlip(centerAngle: number): boolean {
    const a = (((centerAngle + rotationRadians) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return a > Math.PI * 0.5 && a < Math.PI * 1.5;
  }
  // ---- 1:1 OVE getRangeAngles (special) ----
  // Computes start/total/end/center angles for a 0-based inclusive circular
  // range. Mirrors `getRangeAnglesSpecial` which subtracts a tiny epsilon from
  // endAngle/totalAngle so a full-circle arc doesn't collapse to nothing.
  function getRangeAnglesSpecial(range: { start: number; end: number }) {
    const len = Math.max(seqLen, 1);
    const rangeLength = (((range.end - range.start + 1) % len) + len) % len;
    const startAngle = 2 * Math.PI * (range.start / len);
    const totalAngle = (rangeLength / len) * Math.PI * 2;
    const endAngle = (2 * Math.PI * (range.end + 1)) / len;
    return {
      startAngle,
      totalAngle: totalAngle - 0.00001,
      endAngle: endAngle - 0.00001,
      centerAngle: startAngle + totalAngle / 2
    };
  }
  const dnaColorMap: Record<string, string> = {
    A: '#10b981', C: '#3b82f6', G: '#eab308', T: '#ef4444', N: '#64748b'
  };
 // Zooming calculations
 const percentOfCircle = $derived((1 / zoomLevel) * Math.min(SVG_W, 800) / 800);
 const isZoomedIn = $derived(zoomLevel !== 1);
const visibleAngle = $derived(Math.PI * percentOfCircle);
 // Radius grows as zoom increases so the visible arc spans the canvas width.
 // This is the OVE formula: SVG_W / sin(visibleAngle/2) / 2
 // Radius grows as zoom increases so the visible arc spans the canvas width.
 // This is the OVE formula: SVG_W / sin(visibleAngle/2) / 2
 const initialRadius = $derived.by(() => {
   if (!isZoomedIn) return BASE_RADIUS;
   return Math.max(BASE_RADIUS, SVG_W / Math.sin(visibleAngle / 2) / 2);
 });
 const maxZoomLevel = $derived(Math.max(5, Math.floor(seqLen / 100)));
  const rangeToShow = $derived.by(() => {
    if (seqLen === 0) return { start: 0, end: 0, length: 0 };
    if (!isZoomedIn) return { start: 0, end: seqLen - 1, length: seqLen };
    const visibleStart = getPositionFromAngle(rotationRadians - visibleAngle / 2, seqLen);
    const visibleEnd = getPositionFromAngle(rotationRadians + visibleAngle / 2, seqLen);
    const start = normalizePositionByRangeLength(visibleStart, seqLen);
    const end = normalizePositionByRangeLength(visibleEnd, seqLen);
    const length = getRangeLength({ start, end }, seqLen);
    return { start, end, length };
  });
  const showSeq = $derived(rangeToShow.length < 140 && (isZoomedIn || seqLen < 50));
  const showSeqText = $derived(rangeToShow.length < 80);
  const tickSpacing = $derived.by(() => {
    const len = rangeToShow.length;
    if (len < 10) return 2;
    if (len < 50) return Math.ceil(len / 25) * 5;
    return Math.ceil(len / 100) * 10;
  });
  const tickMarks = $derived.by(() => {
    if (seqLen === 0) return [];
    const marks: number[] = [];
    if (rangeToShow.start === 0) marks.push(0);
    const spacer = rangeToShow.start;
    const firstTick = spacer + tickSpacing - (rangeToShow.start % tickSpacing);
    for (let tick = firstTick - 1; tick < spacer + rangeToShow.length; tick += tickSpacing) {
      marks.push(normalizePositionByRangeLength(tick, seqLen));
    }
    return marks;
  });
  // ---- 1:1 OVE Circular Overlap Tracking Algorithms ----
  interface CircularRange {
    start: number;
    end: number;
  }
  function circularRangesOverlap(r1: CircularRange, r2: CircularRange): boolean {
    const split1 = r1.start > r1.end ? [{start: r1.start, end: seqLen - 1}, {start: 0, end: r1.end}] : [r1];
    const split2 = r2.start > r2.end ? [{start: r2.start, end: seqLen - 1}, {start: 0, end: r2.end}] : [r2];
    return split1.some(s1 => split2.some(s2 => {
      return Math.max(s1.start, s2.start) <= Math.min(s1.end, s2.end);
    }));
  }
  function calculateYOffsets(annotations: any[]): { annotation: any; yOffset: number }[] {
    const sorted = [...annotations].sort((a, b) => {
      const lenA = (a.end - a.start + seqLen) % seqLen;
      const lenB = (b.end - b.start + seqLen) % seqLen;
      return lenB - lenA; // Longest first
    });
    const levels: any[][] = [];
    const results = sorted.map(ann => {
      let yOffset = 0;
      while (yOffset < levels.length) {
        const blocked = levels[yOffset].some(other => circularRangesOverlap(ann, other));
        if (!blocked) break;
        yOffset++;
      }
      if (yOffset === levels.length) {
        levels.push([]);
      }
      levels[yOffset].push(ann);
      return { annotation: ann, yOffset };
    });
    return results;
  }
  // ---- High Performance Canvas Directed Pie Piece Painter (OVE 1:1 port) ----
  function drawDirectedPiePiece(
    ctx: CanvasRenderingContext2D,
    radius: number,
    annotationHeight: number,
    sAngle: number,
    eAngle: number,
    forward: boolean,
    color: string,
    strokeColor?: string,
    tailThickness = 0.55
  ) {
    const totalAngle = (eAngle - sAngle + 2 * Math.PI) % (2 * Math.PI);
    drawOvePiePiece(
      ctx,
      CX,
      CY,
      radius,
      annotationHeight,
      sAngle,
      eAngle,
      totalAngle,
      forward,
      color,
      strokeColor,
      { tailThickness }
    );
  }
  // ---- OVE getInternalLabel helpers ----
  // Ellipsizes the name to fit the arc length, mirroring OVE's
  // getEllipsizedName (arcLength / 55 - 3 chars).
  function getInternalEllipsizedName(
    name: string,
    radius: number,
    annotationHeight: number,
    totalAngle: number
  ): string | undefined {
    if (!name) return undefined;
    const arcLength = 2 * Math.PI * (radius - annotationHeight) * totalAngle;
    const annLength = Math.max(0, Math.floor(arcLength / 55 - 3));
    let ellipsizedName: string | undefined = name.slice(0, annLength);
    if (ellipsizedName && ellipsizedName !== name) {
      if (ellipsizedName.length >= name.length - 2) {
        ellipsizedName = name;
      } else if (ellipsizedName.length > 3) {
        ellipsizedName += '..';
      } else {
        ellipsizedName = undefined;
      }
    }
    return ellipsizedName;
  }
  // Draws the feature name along the arc center (labelNeedsFlip => bottom half).
  function drawInternalLabel(
    ctx: CanvasRenderingContext2D,
    radius: number,
    text: string,
    startAngle: number,
    endAngle: number,
    labelNeedsFlip: boolean,
    color: string
  ) {
    const midAngle = (startAngle + endAngle) / 2;
    const p = polarToCartesian(radius, midAngle);
    ctx.save();
    ctx.translate(p.x, p.y);
    // Tangent direction of the circle at a polar angle (12-o'clock convention)
    // is the angle itself in canvas space. Add PI to flip when on the bottom.
    ctx.rotate(midAngle + (labelNeedsFlip ? Math.PI : 0));
    // Pick readable text color: light on dark fills, dark on light fills
    // (mirrors OVE's Color(colorToUse).isDark() ? white : black).
    ctx.fillStyle = isDarkColor(color) ? '#ffffff' : '#111827';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  // Simple perceived-luminance test for choosing label contrast.
  function isDarkColor(hex: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return true;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum < 128;
  }
  // ---- Dynamic Cumulative Track Radii Stacking Layout ----
  interface LayerDrawInfo {
    radius: number;
    height: number;
  }
  // Computes the dynamic layout of annotations
  const layout = $derived.by(() => {
    let r = initialRadius;
    const info: Record<string, LayerDrawInfo> = {};
    // 1. Sequence layer
    if (showSeq) {
      info['sequence'] = { radius: r, height: showSeqText && showReverseSequence ? 24 : 12 };
      r += info['sequence'].height + 10;
    }
    // 2. Axis / Backbone layer
    info['axis'] = { radius: r, height: 6 };
    r += 12;
    // 3. AxisNumbers / Ticks layer
    info['axisNumbers'] = { radius: r, height: 14 };
    r += 14;
    // 4. ORFs layer
    if (primers.length || geneFeatures.length || primers.length) { // Check active or visible
      // Simply prepare the radiuses dynamically
    }
    // Let's compute stacked levels for each active category
    const mergedFeatures = [
      ...geneFeatures,
      ...(selectionNotes || []).map((n: any, i: number) => ({
        id: `note_${i}`,
        name: n.text,
        start: n.start,
        end: n.end,
        type: 'note',
        color: '#4cd6ff',
        forward: true
      }))
    ];
    const activeFeatures = mergedFeatures.filter((f: any) => {
      return !isZoomedIn || getOverlapsOfPotentiallyCircularRanges(f, rangeToShow, seqLen, true)?.length;
    });
    const stackedFeatures = calculateYOffsets(activeFeatures);
    const maxFeatOffset = stackedFeatures.reduce((max, cur) => Math.max(max, cur.yOffset), -1);
    const featuresHeight = maxFeatOffset >= 0 ? (maxFeatOffset + 1) * 14 : 0;
    info['features'] = { radius: r, height: featuresHeight };
    r += featuresHeight > 0 ? featuresHeight + 10 : 0;
    // Primers track
    const activePrimers = primers.filter((p: any) => {
      return !isZoomedIn || getOverlapsOfPotentiallyCircularRanges(p, rangeToShow, seqLen, true)?.length;
    });
    const stackedPrimers = calculateYOffsets(activePrimers);
    const maxPrimOffset = stackedPrimers.reduce((max, cur) => Math.max(max, cur.yOffset), -1);
    const primersHeight = maxPrimOffset >= 0 ? (maxPrimOffset + 1) * 14 : 0;
    info['primers'] = { radius: r, height: primersHeight };
    r += primersHeight > 0 ? primersHeight + 10 : 0;
    return {
      stackedFeatures,
      stackedPrimers,
      info,
      finalRadius: r
    };
  });
  // Calculate relaxed label coordinates conformed to OVE quadrant guidelines
  const relaxedLabels = $derived.by(() => {
    if (seqLen === 0) return [];
    const labelSize = 7.5;
    const fontWidth = labelSize;
    const fontHeight = fontWidth * 2.2;
    // Set labels outer track cleanly outside the final stacked radius!
    const outerRadius = layout.finalRadius + 22;
    const outerPointRadius = layout.finalRadius + 10;
    const labels: OveLabel[] = [];
    // Enzymes (Cutsites) always sit on the axis
    const axisRadius = layout.info['axis']?.radius || initialRadius;
    restrictionSites.forEach((site: any, i: number) => {
      const baseAngle = angleFor0Based(normPos1Based(site.pos));
      const screenAngle = baseAngle + rotationRadians;
      labels.push({
        id: 'enz' + i,
        text: site.name,
        color: String(site.color).startsWith('var(') ? '#ef4444' : String(site.color),
        angle: normalizeAngle(screenAngle),
        annotationCenterAngle: screenAngle,
        annotationCenterRadius: axisRadius,
        width: getTextLengthWithCollapseSpace(site.name) * fontWidth,
        x: 0,
        y: 0,
        innerPoint: polarToCartesian(axisRadius, screenAngle),
        outerPoint: polarToCartesian(outerPointRadius, screenAngle)
      });
    });
    // OVE draws feature/part names as INTERNAL labels (inside the arc) rather
    // than radial leaders, so we do not emit external labels for features here.
    // Set center coordinate relative offsets
    labels.forEach(l => {
      const p = polarToCartesian(outerRadius, l.angle);
      l.x = p.x - CX;
      l.y = p.y - CY;
    });
    const relaxed = relaxLabelAngles(labels, fontHeight, outerRadius);
    return relaxed.map(l => {
      const labelOnLeft = l.angle > Math.PI;
      const subCount = (l.labelAndSublabels?.length ?? 0) - 1;
      const prefix = subCount > 0 ? `+${subCount},` : '';
      const text = prefix + l.text;
      const labelLength = text.length * fontWidth;
      const labelXStart = CX + l.x - (labelOnLeft ? labelLength : 0);
      const textY = CY + l.y + fontHeight / 4;
      const anchor = { x: labelOnLeft ? labelXStart + labelLength : labelXStart, y: CY + l.y };
      return {
        text,
        color: l.color,
        labelXStart,
        textY,
        fontWidth,
        leaderPoints: [l.innerPoint, l.outerPoint, anchor],
        annotationCenterAngle: l.annotationCenterAngle
      };
    });
  });
 // Gesture handlings
 // Convert a pointer event to a 1-based base pair position on the circle.
 // Accounts for canvas transform (scale, pan, zoom yOffset) and current rotation.
 function getMouseBpOnCircle(e: PointerEvent): number {
   if (!canvasEl || seqLen === 0) return 1;
   const rect = canvasEl.getBoundingClientRect();
   const mx = e.clientX - rect.left;
   const my = e.clientY - rect.top;
   const scale = Math.min(canvasW, canvasH) / 400;
   const yOffset = isZoomedIn ? initialRadius - 50 : 0;
   const cx = canvasW / 2 + panX;
   const cy = canvasH / 2 + yOffset * scale + panY;
   const dx = mx - cx;
   const dy = my - cy;
   // mathAngle: 0 = 3 o'clock, PI/2 = 6 o'clock (canvas y is down)
   const mathAngle = Math.atan2(dy, dx);
   // Convert to OVE angle: 0 = 12 o'clock (clockwise)
   const oveAngle = ((mathAngle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
   // Remove current rotation to get the base angle
   const baseAngle = ((oveAngle - rotationRadians + 2 * Math.PI) % (2 * Math.PI));
   // Convert to 0-based bp, then 1-based
   const bp0 = Math.round((baseAngle / (2 * Math.PI)) * seqLen) % seqLen;
   return bp0 + 1;
 }
function handleWheel(e: WheelEvent) {
   e.preventDefault();
   const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
   zoomLevel = Math.min(maxZoomLevel, Math.max(1, zoomLevel * delta));
 }
  function zoomIn() { zoomLevel = Math.min(maxZoomLevel, zoomLevel * 1.3); }
  function zoomOut() { zoomLevel = Math.max(1, zoomLevel / 1.3); }
  function resetView() { zoomLevel = 1; rotationRadians = 0; panX = 0; panY = 0; }
 function handlePointerDown(e: PointerEvent) {
   if (e.button !== 0) return;
   if (activeTool === 'select') {
     const bp = getMouseBpOnCircle(e);
     selectDrag = { startBp: bp, dragging: true };
     selectionStart = bp;
     selectionEnd = bp;
   } else if (activeTool === 'pan') {
     panDrag = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY, dragging: true };
   } else {
     // rotate tool
     dragState = { startX: e.clientX, startRot: rotationRadians, dragging: true };
   }
   canvasEl?.setPointerCapture(e.pointerId);
 }
 function handlePointerMove(e: PointerEvent) {
   if (selectDrag?.dragging) {
     const currentBp = getMouseBpOnCircle(e);
     selectionStart = selectDrag.startBp;
     selectionEnd = currentBp;
     return;
   }
    if (panDrag?.dragging) {
      const dx = e.clientX - panDrag.startX;
      const dy = e.clientY - panDrag.startY;
      panX = panDrag.startPanX + dx;
      panY = panDrag.startPanY + dy;
      return;
    }
    if (!dragState?.dragging) return;
    const dx = e.clientX - dragState.startX;
    rotationRadians = ((dragState.startRot + (dx / 160) * Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  }
  function handlePointerUp() {
    selectDrag = null;
    dragState = null;
    panDrag = null;
  }
  // Draw circular map routine
  function drawCircularMap(ctx: CanvasRenderingContext2D, scale: number, w: number, h: number) {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, w / scale, h / scale);
    // When zoomed in, the circle radius is very large. We offset the
    // center downward by (initialRadius - 50) so the visible arc (at the
    // 12 o'clock position, i.e. the top of the circle) stays inside the
    // canvas viewport. Without this offset the arc would be pushed far
    // above the canvas and become invisible — the root cause of the
    // "invisible zoom" bug.
    const yOffset = isZoomedIn ? initialRadius - 50 : 0;
    ctx.translate(
      (w / 2) / scale - CX + panX / scale,
      (h / 2) / scale - CY + yOffset + panY / scale
    );
    // ---- 1. DNA Bases ----
    if (showSeq && layout.info['sequence']) {
      const seqRadius = layout.info['sequence'].radius;
      const count = Math.min(rangeToShow.length, seqLen);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < count; i++) {
        const pos = normalizePositionByRangeLength(rangeToShow.start + i, seqLen);
        const letter = (dnaSeq[pos] || 'N').toUpperCase();
        const baseAngle = angleFor0Based(pos);
        const screenAngle = baseAngle + rotationRadians;
        const p = polarToCartesian(seqRadius, screenAngle);
        ctx.fillStyle = dnaColorMap[letter] || '#888';
        ctx.globalAlpha = 0.85;
        ctx.fillRect(p.x - 3.5, p.y - 7, 7, showSeqText ? 14 : 11);
        ctx.globalAlpha = 1.0;
        if (showSeqText) {
          ctx.fillStyle = '#0f172a'; // dark text inside bases
          ctx.font = 'bold 5.5px monospace';
          ctx.fillText(letter, p.x, p.y);
        }
      }
    }
    // ---- 2. Backbone Outer and Inner Circles (Axis) ----
    if (layout.info['axis']) {
      const axisRadius = layout.info['axis'].radius;
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = '#475569'; // var(--pix-fg-dim)
      ctx.beginPath();
      ctx.arc(CX, CY, axisRadius + 3, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(CX, CY, axisRadius - 3, 0, 2 * Math.PI);
      ctx.stroke();
    }
  // ---- 2b. Selection Highlight Arc ----
  if (selectionStart !== 1 || selectionEnd !== 1) {
    const selAxisRadius = layout.info['axis']?.radius || initialRadius;
    const selStartAngle = angleFor0Based(selectionStart - 1) + rotationRadians;
    const selEndAngle = angleFor0Based(selectionEnd - 1) + rotationRadians;
    // polarToCartesian applies -PI/2 offset, but ctx.arc() does not
    const a0 = selStartAngle - Math.PI / 2;
    const a1 = selEndAngle - Math.PI / 2;
    // ctx.arc with anticlockwise=false handles wrap-around automatically:
    // if a1 < a0, it draws clockwise through 2*PI to reach a1.
    // Outer wide glow
    ctx.strokeStyle = 'rgba(10, 132, 255, 0.22)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(CX, CY, selAxisRadius, a0, a1, false);
    ctx.stroke();
    // Inner solid highlight
    ctx.strokeStyle = 'rgba(10, 132, 255, 0.55)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(CX, CY, selAxisRadius, a0, a1, false);
    ctx.stroke();
    // End tick markers at selection boundaries — radial lines (not vertical)
    ctx.strokeStyle = 'rgba(10, 132, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Radial tick at start: from inner to outer of the axis
    const p0inner = polarToCartesian(selAxisRadius - 8, selStartAngle);
    const p0outer = polarToCartesian(selAxisRadius + 8, selStartAngle);
    ctx.moveTo(p0inner.x, p0inner.y);
    ctx.lineTo(p0outer.x, p0outer.y);
    // Radial tick at end
    const p1inner = polarToCartesian(selAxisRadius - 8, selEndAngle);
    const p1outer = polarToCartesian(selAxisRadius + 8, selEndAngle);
    ctx.moveTo(p1inner.x, p1inner.y);
    ctx.lineTo(p1outer.x, p1outer.y);
    ctx.stroke();
  }
    // ---- 3. Coordinate Ticks & Numbers (AxisNumbers) ----
    if (layout.info['axis'] && layout.info['axisNumbers']) {
      const axisRadius = layout.info['axis'].radius;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      tickMarks.forEach((tick) => {
        const baseAngle = angleFor0Based(tick);
        const screenAngle = baseAngle + rotationRadians;
        const p1 = polarToCartesian(axisRadius - 6, screenAngle);
        const p2 = polarToCartesian(axisRadius + 6, screenAngle);
        const pl = polarToCartesian(axisRadius + 14, screenAngle);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '6.5px monospace';
        ctx.fillText(String(tick + 1), pl.x, pl.y);
      });
    }
    // ---- 4. Stacked Features ----
    if (layout.info['features']) {
      const featBaseRadius = layout.info['features'].radius;
      layout.stackedFeatures.forEach(({ annotation, yOffset }) => {
        const isActive = activeFeatureId === annotation.id;
        const r = featBaseRadius + yOffset * 14;
        const { startAngle, endAngle, totalAngle, centerAngle } =
          getRangeAnglesSpecial({ start: annotation.start - 1, end: annotation.end - 1 });
        const fwd = annotation.forward !== false;
        drawDirectedPiePiece(
          ctx,
          r,
          10, // Height
          startAngle + rotationRadians,
          endAngle + rotationRadians,
          fwd,
          annotation.color,
          isActive ? '#ffffff' : undefined,
          0.7
        );
        // OVE internal label: draw feature name along the arc (flipped when
        // the feature sits on the bottom half of the screen).
        const ellipsizedName = getInternalEllipsizedName(
          annotation.name,
          r,
          10,
          totalAngle
        );
        if (ellipsizedName) {
          const labelNeedsFlip = shouldFlip(centerAngle);
          drawInternalLabel(
            ctx,
            r,
            ellipsizedName,
            startAngle + rotationRadians,
            endAngle + rotationRadians,
            labelNeedsFlip,
            annotation.color
          );
        }
      });
    }
    // ---- 5. Stacked Primers ----
    if (layout.info['primers']) {
      const primBaseRadius = layout.info['primers'].radius;
      layout.stackedPrimers.forEach(({ annotation, yOffset }) => {
        const r = primBaseRadius + yOffset * 14;
        const { startAngle, endAngle } =
          getRangeAnglesSpecial({ start: annotation.start - 1, end: annotation.end - 1 });
        const fwd = annotation.forward !== false;
        drawDirectedPiePiece(
          ctx,
          r,
          9,
          startAngle + rotationRadians,
          endAngle + rotationRadians,
          fwd,
          'rgba(6, 182, 212, 0.45)', // Cyan tinted fill
          '#06b6d4',
          0.6
        );
      });
    }
    // ---- 6. Axis Enzymes (Cutsites) ----
    if (layout.info['axis']) {
      const axisRadius = layout.info['axis'].radius;
      restrictionSites.forEach((site: any) => {
        const angle = angleFor0Based(normPos1Based(site.pos)) + rotationRadians;
        const p = polarToCartesian(axisRadius, angle);
        const color = String(site.color).startsWith('var(') ? '#ef4444' : String(site.color);
        ctx.save();
        ctx.translate(p.x, p.y);
        // Perpendicular (radial) tick. polarToCartesian already offsets by
        // -PI/2, so the radial direction is at `angle - PI/2` in canvas space.
        ctx.rotate(angle - Math.PI / 2);
        ctx.fillStyle = color;
        ctx.fillRect(-0.5, -6, 1, 12);
        ctx.restore();
      });
    }
    // ---- 7. Faint Concentric Guideway Tracks (OVE design style) ----
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    const gRadiusStart = layout.finalRadius + 10;
    const gRadiusEnd = layout.finalRadius + 22;
    ctx.beginPath(); ctx.arc(CX, CY, gRadiusStart, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, gRadiusEnd, 0, 2 * Math.PI); ctx.stroke();
    // ---- 8. External Labels with Radial-to-Horizontal bent leaders ----
    relaxedLabels.forEach((l) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      l.leaderPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      // Draw anchor dot at label start
      const lastPt = l.leaderPoints[l.leaderPoints.length - 1];
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(lastPt.x, lastPt.y, 1.2, 0, 2 * Math.PI);
      ctx.fill();
      // Text drawing
      ctx.fillStyle = l.color;
      ctx.font = `bold ${l.fontWidth}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(l.text, l.labelXStart, l.textY);
    });
    // ---- 9. Center Text ----
    if (!isZoomedIn) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#38bdf8'; // var(--pix-accent-2)
      ctx.font = 'bold 9.5px monospace';
      ctx.fillText(plasmidName, CX, CY - 4);
      ctx.fillStyle = '#94a3b8'; // var(--pix-fg-dim)
      ctx.font = '7px monospace';
      ctx.fillText(`${seqLen} bps`, CX, CY + 8);
      ctx.fillText('circular', CX, CY + 15);
    }
  }
  // Redraw triggers
 const drawTrigger = $derived([
   dnaSeq, geneFeatures, selectionNotes, restrictionSites, primers, initialRadius, zoomLevel,
    rotationRadians, activeFeatureId, selectionStart, selectionEnd, canvasW, canvasH, dpr,
    panX, panY
 ]);
  $effect(() => {
    drawTrigger;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(canvasW, canvasH) / 400;
    drawCircularMap(ctx, scale, canvasW, canvasH);
  });
  // Watch size
  $effect(() => {
    if (!canvasEl) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      canvasW = Math.round(rect.width);
      canvasH = Math.round(rect.height);
      dpr = window.devicePixelRatio || 1;
      if (canvasEl) {
        canvasEl.width = Math.round(canvasW * dpr);
        canvasEl.height = Math.round(canvasH * dpr);
      }
    });
    ro.observe(canvasEl);
    return () => ro.disconnect();
  });
  // PNG Export routine
  async function triggerExport() {
    if (!canvasEl || shotBusy) return;
    shotBusy = true;

    // Save live panning/zooming state
    const savedPanX = panX;
    const savedPanY = panY;
    const savedZoomLevel = zoomLevel;

    // Reset panning/zooming for export
    panX = 0;
    panY = 0;
    zoomLevel = 1;

    try {
      const multStr = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4';
      const multiplier = parseInt(multStr) || 4;

      const exportSize = 400;
      const cv = document.createElement('canvas');
      cv.width = exportSize * multiplier * dpr;
      cv.height = exportSize * multiplier * dpr;
      const ctx = cv.getContext('2d')!;
      
      // Clean deep background
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, cv.width, cv.height);
      
      drawCircularMap(ctx, multiplier, exportSize * multiplier, exportSize * multiplier);
      
      // Watermark
      const pad = Math.round(cv.width * 0.03);
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'right';
      ctx.fillText('Designed by SPICE', cv.width - pad, cv.height - pad);
      
      const png = cv.toDataURL('image/png');
      const bin = atob(png.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      
      const r = await backend.saveExport(`${plasmidName}_map.png`, bytes);
      if (r.data?.path) {
        pushToast('success', m.exportSaved(), r.data.path);
      }
    } catch (e: any) {
      pushToast('error', m.exportPng(), String(e?.message ?? e));
    } finally {
      // Restore live panning/zooming state
      panX = savedPanX;
      panY = savedPanY;
      zoomLevel = savedZoomLevel;
      shotBusy = false;
    }
  }
 onMount(() => {
   exportPng = triggerExport;
   mapRef = { zoomIn, zoomOut, resetView };
  return () => {
    exportPng = null;
    mapRef = null;
  };
 });
</script>
<canvas
  bind:this={canvasEl}
  style="width: 100%; height: 100%; background: transparent; touch-action: none; cursor: {activeTool === 'pan' ? 'grab' : activeTool === 'rotate' ? 'ew-resize' : 'crosshair'}; display: block;"
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
></canvas>
