<script lang="ts">
  // SnapGene-style high-performance Canvas RowItem renderer with dynamic vertical layout
  import { onMount, tick } from 'svelte';
  import {
    drawSequenceRowOnCanvas,
    calculateRowYOffsets,
    getAnnotationLabelHeight,
    getAnnotationStackHeight,
    getCutsiteLabelHeight,
    getBasePixelX,
    CHAR_W,
    BLOCK_GAP,
    BLOCK_SIZE,
    LEFT_MARGIN,
    RIGHT_MARGIN
  } from './utils/rowRender';

  // Svelte 5 props
  let {
    row,
    dna = '',
    showEnzymes = true,
    showFeatures = true,
    showTranslations = false,
    restrictionSites = [],
    geneFeatures = [],
    parts = [],
    primers = [],
    selectionStart = $bindable(1),
    selectionEnd = $bindable(1),
    containerWidth = 700,
    hoveredFeature = $bindable(null),
    onMouseDown = (pos: number, e: MouseEvent) => {},
    onMouseMove = (pos: number, e: MouseEvent) => {},
    onMouseUp = () => {},
    originOffset = 0,
    relativeNumbering = false,
    showSingleStrand = false,
    colorTheme = 'monochrome',
    modifiedRanges = [] as { start: number; end: number }[],
    seqTool = 'browse'
  } = $props<{
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
    parts: { name: string; start: number; end: number }[];
    primers: { name: string; start: number; end: number; forward?: boolean }[];
    selectionStart: number;
    selectionEnd: number;
    containerWidth: number;
    hoveredFeature: any;
    onMouseDown: (pos: number, e: MouseEvent, row?: any, y?: number) => void;
    onMouseMove: (pos: number, e: MouseEvent) => void;
    onMouseUp: () => void;
    originOffset?: number;
    relativeNumbering?: boolean;
    showSingleStrand?: boolean;
    colorTheme?: string;
    modifiedRanges?: { start: number; end: number }[];
    seqTool?: 'browse' | 'edit' | 'annotate';
  }>();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let dpr = $state(1);

  // ---- Pure Reactive Height Calculator (matches drawSequenceRowOnCanvas layout) ----
  const rowHeight = $derived.by(() => {
    let h = 8; // Top spacer

    // 1. Ruler
    h += 22 + 4; // RULER_HEIGHT + gap

    // 2. Enzyme labels
    const rowSites = restrictionSites.filter((s: any) => s.pos >= row.start && s.pos <= row.end);
    if (showEnzymes && rowSites.length) {
      h += getCutsiteLabelHeight(rowSites, row) + 2;
    }

    // 3. Selection info bar (if selection overlaps this row)
    if (selectionStart !== 1 || selectionEnd !== 1) {
      const selStart = Math.max(selectionStart, row.start);
      const selEnd = Math.min(selectionEnd, row.end);
      if (selStart <= selEnd) h += 18;
    }

    // 4. Sequence container (top strand + plus marks + bottom strand)
    h += showSingleStrand ? 24 : 52;

    // 5. Translations
    if (showTranslations) {
      h += 18;
    }

    // 6. Features
    const rowFeats = geneFeatures.filter((f: any) => !(f.end < row.start || f.start > row.end));
    if (showFeatures && rowFeats.length) {
      h += getAnnotationLabelHeight(rowFeats, row);
      h += getAnnotationStackHeight(rowFeats) + 5;
    }

    // 7. Parts
    const rowParts = parts.filter((p: any) => !(p.end < row.start || p.start > row.end));
    if (rowParts.length) {
      h += getAnnotationLabelHeight(rowParts, row);
      h += getAnnotationStackHeight(rowParts) + 5;
    }

    return h + 8; // Bottom padding
  });

  // Feature track Y offset for hover hit-testing
  function getFeatureTrackY(): number {
    let y = 8;
    y += 22 + 4; // Ruler

    const rowSites = restrictionSites.filter((s: any) => s.pos >= row.start && s.pos <= row.end);
    if (showEnzymes && rowSites.length) {
      y += getCutsiteLabelHeight(rowSites, row) + 2;
    }

    if (selectionStart !== 1 || selectionEnd !== 1) {
      const selStart = Math.max(selectionStart, row.start);
      const selEnd = Math.min(selectionEnd, row.end);
      if (selStart <= selEnd) y += 18;
    }

    y += 52; // Sequence container

    if (showTranslations) {
      y += 18;
    }

    return y;
  }

  // Map mouse coordinate to 1-based base pair position
  function resolveBaseIndexFromEvent(event: MouseEvent, canvas: HTMLCanvasElement): number | null {
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const relX = localX - LEFT_MARGIN;
    if (relX < 0) {
      return row.start;
    }

    // Since BLOCK_GAP is 0, we can calculate the character index directly using CHAR_W
    const charIdx = Math.floor(relX / CHAR_W);
    const pos = row.start + charIdx;
    
    // In edit mode, we allow the cursor to stand after the last base (row.end + 1),
    // which maps to dna.length + 1 for the very last base.
    const maxPos = seqTool === 'edit' ? (row.end + 1) : row.end;
    
    return Math.max(row.start, Math.min(pos, maxPos));
  }

  function handleMouseDown(e: MouseEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pos = resolveBaseIndexFromEvent(e, canvasEl);
    if (pos !== null) onMouseDown(pos, e, row, y);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;

    const pos = resolveBaseIndexFromEvent(e, canvasEl);
    if (pos !== null) {
      onMouseMove(pos, e);
    }

    // Feature hover hit-testing
    const featBaseY = getFeatureTrackY();
    const rowFeats = geneFeatures.filter((f: any) => !(f.end < row.start || f.start > row.end));
    const maxOffset = calculateRowYOffsets(rowFeats).reduce((max, cur) => Math.max(max, cur.yOffset), -1);
    const featMaxY = featBaseY + (maxOffset + 1) * 18;

    if (showFeatures && mouseY >= featBaseY && mouseY <= featMaxY && pos !== null) {
      const hitFeat = geneFeatures.find((feat: any) => {
        return pos >= feat.start && pos <= feat.end;
      });
      if (hitFeat) {
        if (hoveredFeature?.id !== hitFeat.id) {
          hoveredFeature = hitFeat;
        }
      } else {
        if (hoveredFeature !== null) {
          hoveredFeature = null;
        }
      }
    } else {
      if (hoveredFeature !== null) {
        hoveredFeature = null;
      }
    }
  }

  function handleMouseLeave() {
    if (hoveredFeature !== null) {
      hoveredFeature = null;
    }
  }

  const redrawTrigger = $derived([
    row, dna, showEnzymes, showFeatures, showTranslations,
    restrictionSites, geneFeatures, parts, primers,
    selectionStart, selectionEnd, containerWidth, hoveredFeature, dpr, rowHeight
  ]);

  $effect(() => {
    redrawTrigger;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(containerWidth * dpr);
    canvasEl.height = Math.round(rowHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawSequenceRowOnCanvas(ctx, {
      row,
      dna,
      showEnzymes,
      showFeatures,
      showTranslations,
      restrictionSites,
      geneFeatures,
      parts,
      primers,
      selectionStart,
      selectionEnd,
      containerWidth,
      hoveredFeatureId: hoveredFeature?.id ?? null,
      dpr,
      originOffset,
      relativeNumbering,
      showSingleStrand,
      colorTheme,
      modifiedRanges,
      seqTool
    });
  });
</script>

<div 
  class="sequence-row" 
  style="position: relative; height: {rowHeight}px; min-width: 100%; flex: 0 0 auto; user-select: none;"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Pointer events + capture: mouse keeps cross-row drag via the container's
       global resolver (events bubble even while captured here); touch gets
       horizontal drag-select while pan-y leaves vertical scrolling to the browser.
       A browser-stolen pan fires pointercancel → we end the drag cleanly. -->
  <canvas
    bind:this={canvasEl}
    style="width: 100%; height: {rowHeight}px; display: block; cursor: text; touch-action: pan-y;"
    onpointerdown={(e) => { canvasEl?.setPointerCapture(e.pointerId); handleMouseDown(e); }}
    onpointermove={handleMouseMove}
    onpointerup={(e) => { try { canvasEl?.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ } onMouseUp(); }}
    onpointercancel={() => onMouseUp()}
    onpointerleave={handleMouseLeave}
  ></canvas>
</div>
