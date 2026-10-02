<script lang="ts">
  import { onMount } from 'svelte';
  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { calculateRowYOffsets } from '$lib/gene/utils/rowRender';
  type Tool = 'select' | 'pan' | 'rotate';
  let {
    plasmidName = 'plasmid',
    dnaSeq = $bindable(''),
    geneFeatures = [],
    restrictionSites = [],
    selectionNotes = [],
    activeFeatureId = $bindable(null),
    selectionStart = $bindable(1),
    selectionEnd = $bindable(1),
    exportPng = $bindable(null),
    onEnzymeClick = null,
    activeTool = 'select',
    mapRef = $bindable<{ zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null>(null)
  } = $props<{
    plasmidName: string;
    dnaSeq: string;
    geneFeatures: any[];
    restrictionSites: any[];
    selectionNotes?: { start: number; end: number; text: string }[];
    activeFeatureId: number | null;
    selectionStart: number;
    selectionEnd: number;
    exportPng: (() => Promise<void>) | null;
    onEnzymeClick?: ((site: { name: string; pos: number }) => void) | null;
    activeTool: Tool;
    mapRef: { zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null;
  }>();
  // Internal Canvas states
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let canvasW = $state(500);
  let canvasH = $state(220);
  let dpr = $state(1);
  let shotBusy = $state(false);
  // View transform state
  let zoomScale = $state(1);
  let panBp = $state(0);
  let dragState = $state<{ kind: 'pan' | 'select'; startX: number; startBp: number; startPan: number } | null>(null);
  const seqLen = $derived(dnaSeq.length);
  const LIN_X0 = 40;
  const TOP_PAD = 18;
  const BACKBONE_Y = $derived(Math.max(100, Math.round(canvasH * 0.55)));
  const LIN_X1 = $derived(canvasW - 40);
  const LIN_W = $derived(Math.max(10, LIN_X1 - LIN_X0));
  const bpPixel = $derived((LIN_W * zoomScale) / Math.max(1, seqLen));
  const maxZoom = $derived(Math.max(1, seqLen / 5));
  // Visible range in base pairs (1-based inclusive)
  function visibleBps(): { start: number; end: number } {
    if (seqLen <= 0) return { start: 0, end: 0 };
    const span = seqLen / zoomScale;
    const start = Math.max(1, panBp + 1);
    const end = Math.min(seqLen, panBp + span);
    return { start, end };
  }
  function clampPan() {
    if (seqLen <= 0) {
      panBp = 0;
      return;
    }
    const maxPan = Math.max(0, seqLen - seqLen / zoomScale);
    panBp = Math.max(0, Math.min(maxPan, panBp));
  }
  // Base position to pixel (CSS pixels)
  function linX(pos: number): number {
    if (seqLen <= 0) return LIN_X0;
    return LIN_X0 + ((pos - 1 - panBp) / seqLen) * LIN_W * zoomScale;
  }
  // Pixel to base position
  function xToBp(x: number): number {
    if (seqLen <= 0) return 1;
    const pos = panBp + 1 + ((x - LIN_X0) / (LIN_W * zoomScale)) * seqLen;
    return Math.max(1, Math.min(seqLen, Math.round(pos)));
  }
  function zoomIn() {
    const newZoom = Math.min(maxZoom, zoomScale * 1.3);
    zoomScale = newZoom;
    clampPan();
  }
  function zoomOut() {
    const newZoom = Math.max(1, zoomScale / 1.3);
    zoomScale = newZoom;
    clampPan();
  }
  function resetView() {
    zoomScale = 1;
    panBp = 0;
  }
  function niceTickStep(): number {
    const span = seqLen / zoomScale;
    if (span <= 0) return 1;
    const raw = span / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }
  // ---- OVE-style interval stacking for labels ----
  interface LabelBox {
    x0: number;
    x1: number;
    yOffset: number;
    text: string;
  }
  function calculateLabelBoxes(items: { x0: number; x1: number; text: string; minWidth?: number }[]): LabelBox[] {
    // Sort by x0, then greedily assign the lowest yOffset where intervals do not overlap
    const sorted = items
      .map(it => ({ ...it, x0: it.x0, x1: Math.max(it.x1, it.x0 + (it.minWidth ?? 0)) }))
      .sort((a, b) => a.x0 - b.x0);
    const levels: LabelBox[][] = [];
    const results: LabelBox[] = [];
    for (const it of sorted) {
      let yOffset = 0;
      while (yOffset < levels.length) {
        const overlap = levels[yOffset].some(box => it.x0 <= box.x1 && it.x1 >= box.x0);
        if (!overlap) break;
        yOffset++;
      }
      if (yOffset === levels.length) levels.push([]);
      const box = { x0: it.x0, x1: it.x1, yOffset, text: it.text };
      levels[yOffset].push(box);
      results.push(box);
    }
    return results;
  }
  interface HitZone {
    site: any;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  let hitZones = $state<HitZone[]>([]);
  // Pointer event handlers
  // --- Two-finger pinch zoom (touch) ---
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { dist: number; zoom: number } | null = null;

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      // Second finger: take over as pinch, abandoning whatever single drag ran.
      const [a, b] = [...activePointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: zoomScale };
      dragState = null;
      canvasEl?.setPointerCapture(e.pointerId);
      return;
    }
    if (pinchStart || activePointers.size > 2) return;
    const rect = canvasEl?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // Check enzyme label hit testing first
    const clickedZone = hitZones.find(z => mouseX >= z.x0 && mouseX <= z.x1 && mouseY >= z.y0 && mouseY <= z.y1);
    if (clickedZone) {
      onEnzymeClick?.(clickedZone.site);
      return;
    }
    if (activeTool === 'pan') {
      dragState = { kind: 'pan', startX: e.clientX, startBp: 0, startPan: panBp };
    } else {
      const bp = xToBp(mouseX);
      dragState = { kind: 'select', startX: e.clientX, startBp: bp, startPan: 0 };
      selectionStart = bp;
      selectionEnd = bp;
    }
    canvasEl?.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: PointerEvent) {
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart && activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomScale = Math.min(maxZoom, Math.max(1, pinchStart.zoom * (dist / pinchStart.dist)));
      clampPan();
      return;
    }
    if (pinchStart) return;
    if (!dragState) return;
    const rect = canvasEl?.getBoundingClientRect();
    if (!rect) return;
    if (dragState.kind === 'pan') {
      const dx = e.clientX - dragState.startX;
      const bpShift = (-dx / (LIN_W * zoomScale)) * seqLen;
      panBp = dragState.startPan + bpShift;
      clampPan();
    } else {
      const mouseX = e.clientX - rect.left;
      const bp = xToBp(mouseX);
      if (bp >= dragState.startBp) {
        selectionStart = dragState.startBp;
        selectionEnd = bp;
      } else {
        selectionStart = bp;
        selectionEnd = dragState.startBp;
      }
    }
  }
  function handlePointerUp(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStart = null;
    dragState = null;
  }
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(maxZoom, Math.max(1, zoomScale * delta));
    // Zoom toward cursor position
    const rect = canvasEl?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const bpAtCursor = xToBp(mouseX);
      zoomScale = newZoom;
      // Adjust pan so the same bp stays under the cursor
      const newPixelX = LIN_X0 + ((bpAtCursor - 1 - panBp) / seqLen) * LIN_W * zoomScale;
      const bpShift = ((mouseX - newPixelX) / (LIN_W * zoomScale)) * seqLen;
      panBp = Math.max(0, panBp + bpShift);
      clampPan();
    } else {
      zoomScale = newZoom;
      clampPan();
    }
  }
  // Canvas drawing routine
  function drawLinearMap(ctx: CanvasRenderingContext2D, w: number, h: number, scale = 1) {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, w / scale, h / scale);
    if (seqLen === 0) return;
    clampPan();
    const visible = visibleBps();
    // ---- 1. Selection Layer Highlight ----
    if (selectionStart !== 1 || selectionEnd !== 1) {
      const x0 = linX(selectionStart);
      const x1 = linX(selectionEnd);
      ctx.fillStyle = 'rgba(83, 215, 105, 0.18)'; // Green semi-transparent
      ctx.fillRect(x0, BACKBONE_Y - 45, x1 - x0, 95);
      ctx.strokeStyle = 'rgba(83, 215, 105, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, BACKBONE_Y - 45, x1 - x0, 95);
    }
    // ---- 2. Backbone Spine ----
    ctx.strokeStyle = '#1e293b'; // var(--pix-bg-3)
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(LIN_X0, BACKBONE_Y);
    ctx.lineTo(LIN_X1, BACKBONE_Y);
    ctx.stroke();
    ctx.lineCap = 'butt'; // Reset
    // ---- 3. Coordinate Ticks & Numbers ----
    const tickStep = niceTickStep();
    const firstTick = Math.ceil((visible.start - 1) / tickStep) * tickStep + 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#64748b'; // var(--pix-fg-dim)
    for (let p = firstTick; p <= visible.end; p += tickStep) {
      const x = linX(p);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, BACKBONE_Y - 8);
      ctx.lineTo(x, BACKBONE_Y + 4);
      ctx.stroke();
      ctx.font = '6.5px monospace';
      ctx.fillText(String(Math.round(p)), x, BACKBONE_Y - 14);
    }
    // ---- 4. Base letters when zoomed in ----
    if (bpPixel > 6) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 6px monospace';
      const dnaColorMap: Record<string, string> = {
        A: '#10b981', C: '#3b82f6', G: '#eab308', T: '#ef4444', N: '#64748b'
      };
      const startIdx = Math.max(1, Math.floor(visible.start));
      const endIdx = Math.min(seqLen, Math.ceil(visible.end));
      for (let i = startIdx; i <= endIdx; i++) {
        const letter = (dnaSeq[i - 1] || 'N').toUpperCase();
        const x = linX(i);
        if (x < LIN_X0 - 5 || x > LIN_X1 + 5) continue;
        ctx.fillStyle = dnaColorMap[letter] || '#888';
        ctx.fillRect(x - bpPixel / 2 + 0.5, BACKBONE_Y - 9, bpPixel - 1, 18);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(letter, x, BACKBONE_Y);
      }
    }
    // ---- 5. Staggered Feature Tracks (OVE interval stacking) ----
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
    const featuresStack = calculateRowYOffsets(mergedFeatures);
    const featureLabels = featuresStack.map(({ annotation }) => {
      const x0 = linX(annotation.start);
      const x1 = linX(annotation.end);
      const width = x1 - x0;
      const midX = (x0 + x1) / 2;
      const text = String(annotation.name || '');
      return { x0: midX - text.length * 3.5, x1: midX + text.length * 3.5, text, annotation, bodyX0: x0, bodyX1: x1 };
    });
    const labelBoxes = calculateLabelBoxes(featureLabels);
    const maxFeatureY = featuresStack.reduce((m, cur) => Math.max(m, cur.yOffset), -1);
    featuresStack.forEach(({ annotation, yOffset }) => {
      const isActive = activeFeatureId === annotation.id;
      const x0 = linX(annotation.start);
      const x1 = linX(annotation.end);
      const fw = Math.max(x1 - x0, 6);
      const fwd = annotation.forward !== false;
      const trackY = BACKBONE_Y - 28 - yOffset * 14;
      ctx.globalAlpha = isActive ? 1.0 : 0.85;
      ctx.fillStyle = annotation.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(x0, trackY - 5, fw, 10, 2);
      ctx.fill();
      ctx.stroke();
      if (fwd) {
        const tip = x0 + fw;
        ctx.beginPath();
        ctx.moveTo(tip, trackY);
        ctx.lineTo(tip - 6, trackY - 5);
        ctx.lineTo(tip - 6, trackY + 5);
        ctx.closePath();
        ctx.fillStyle = annotation.color;
        ctx.fill();
      } else {
        const tip = x0;
        ctx.beginPath();
        ctx.moveTo(tip, trackY);
        ctx.lineTo(tip + 6, trackY - 5);
        ctx.lineTo(tip + 6, trackY + 5);
        ctx.closePath();
        ctx.fillStyle = annotation.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    });
    // ---- 6. Feature labels with collision avoidance ----
    const maxLabelOffset = labelBoxes.reduce((m, b) => Math.max(m, b.yOffset), 0);
    labelBoxes.forEach((box, idx) => {
      const info = featureLabels[idx];
      const trackY = BACKBONE_Y - 28 - (maxFeatureY + 1) * 14;
      const labelY = trackY - 8 - box.yOffset * 12;
      ctx.fillStyle = info.annotation.color;
      ctx.font = 'bold 6.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const midX = (info.bodyX0 + info.bodyX1) / 2;
      ctx.fillText(info.text, midX, labelY);
      // Leader line from label to feature body
      ctx.strokeStyle = info.annotation.color;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(midX, labelY + 1);
      ctx.lineTo(midX, trackY + 5);
      ctx.stroke();
    });
    // ---- 7. Enzyme Cut Lines & Labels ----
    const sortedSites = [...restrictionSites].sort((a, b) => a.pos - b.pos);
    const siteLabelItems = sortedSites.map(site => {
      const x = linX(site.pos);
      return { x0: x - 20, x1: x + 20, text: String(site.name), site };
    });
    const siteLabelBoxes = calculateLabelBoxes(siteLabelItems);
    const zones: HitZone[] = [];
    siteLabelBoxes.forEach((box, i) => {
      const site = sortedSites[i];
      const x = linX(site.pos);
      const color = String(site.color).startsWith('var(') ? '#ef4444' : String(site.color);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, BACKBONE_Y - 10);
      ctx.lineTo(x, BACKBONE_Y + 12);
      ctx.stroke();
      const labelY = BACKBONE_Y + 18 + box.yOffset * 12;
      ctx.fillStyle = color;
      ctx.font = 'bold 6.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(site.name, x, labelY);
      zones.push({
        site,
        x0: x - 25,
        y0: labelY - 2,
        x1: x + 25,
        y1: labelY + 10
      });
    });
    hitZones = zones;
  }
  // Dynamic trigger for redraw
  const drawTrigger = $derived([
    dnaSeq, geneFeatures, selectionNotes, restrictionSites, activeFeatureId,
    selectionStart, selectionEnd, canvasW, canvasH, dpr, zoomScale, panBp, activeTool
  ]);
  $effect(() => {
    drawTrigger;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    drawLinearMap(ctx, canvasW, canvasH);
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
  // Expose export PNG trigger to parent
  async function triggerExport() {
    if (!canvasEl || shotBusy) return;
    shotBusy = true;

    // Save live panning/zooming state
    const savedZoomScale = zoomScale;
    const savedPanBp = panBp;

    // Reset panning/zooming for export
    zoomScale = 1;
    panBp = 0;

    try {
      const multStr = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4';
      const multiplier = parseInt(multStr) || 4;

      const cv = document.createElement('canvas');
      cv.width = canvasW * multiplier * dpr;
      cv.height = canvasH * multiplier * dpr;
      const ctx = cv.getContext('2d')!;
      
      // Background
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, cv.width, cv.height);
      
      drawLinearMap(ctx, canvasW * multiplier, canvasH * multiplier, multiplier);
      
      // Watermark
      const pad = Math.round(cv.width * 0.03);
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'right';
      ctx.fillText('Designed by SPICE', cv.width - pad, cv.height - pad);
      
      const png = cv.toDataURL('image/png');
      const bin = atob(png.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      
      const r = await backend.saveExport(`${plasmidName}_linear_map.png`, bytes);
      if (r.data?.path) {
        pushToast('success', m.exportSaved(), r.data.path);
      }
    } catch (e: any) {
      pushToast('error', m.exportPng(), String(e?.message ?? e));
    } finally {
      // Restore live panning/zooming state
      zoomScale = savedZoomScale;
      panBp = savedPanBp;
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
  style="width: 100%; height: 100%; background: transparent; touch-action: none; cursor: {activeTool === 'pan' ? 'grab' : 'crosshair'}; display: block;"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onwheel={handleWheel}
></canvas>
