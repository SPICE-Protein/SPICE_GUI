<script lang="ts">
  import { onMount, tick } from 'svelte';

  let {
    dna = '',
    geneFeatures = [] as any[],
    selectionStart = 1,
    selectionEnd = 1,
    scrollTop = 0,
    totalContentH = 1000,
    canvasH = 300,
    onMinimapClick = (pct: number) => {}
  } = $props<{
    dna: string;
    geneFeatures: any[];
    selectionStart: number;
    selectionEnd: number;
    scrollTop: number;
    totalContentH: number;
    canvasH: number;
    onMinimapClick: (pct: number) => void;
  }>();

  let canvas = $state<HTMLCanvasElement | null>(null);

  // Clamp a [left, left+width] interval to [0, maxW]
  function clampInterval(left: number, width: number, maxW: number): { x: number; w: number } {
    const clampedLeft = Math.max(0, Math.min(left, maxW - 1));
    const clampedRight = Math.min(maxW, left + width);
    return { x: clampedLeft, w: Math.max(0, clampedRight - clampedLeft) };
  }

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // SnapGene dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (dna.length === 0 || w <= 0) return;

    // Feature blocks (SnapGene-style: colored bars matching main view)
    for (const feat of geneFeatures) {
      const left = ((feat.start - 1) / dna.length) * w;
      const fw = ((feat.end - feat.start + 1) / dna.length) * w;
      const { x, w: cw } = clampInterval(left, Math.max(fw, 2), w);
      if (cw > 0) {
        ctx.fillStyle = feat.color;
        ctx.fillRect(x, 3, cw, h - 6);
      }
    }

    // Selection overlay (blue semi-transparent)
    if (selectionStart !== 1 || selectionEnd !== 1) {
      const selLeft = ((selectionStart - 1) / dna.length) * w;
      const selW = ((selectionEnd - selectionStart + 1) / dna.length) * w;
      const { x, w: cw } = clampInterval(selLeft, selW, w);
      if (cw > 0) {
        ctx.fillStyle = 'rgba(10, 132, 255, 0.4)';
        ctx.fillRect(x, 0, cw, h);
      }
    }

    // Viewport indicator (SnapGene-style: semi-transparent white box)
    if (totalContentH > canvasH && totalContentH > 0) {
      const viewStartPct = Math.max(0, Math.min(scrollTop / totalContentH, 1));
      const viewVisiblePct = Math.min(1, canvasH / totalContentH);
      const viewLeft = viewStartPct * w;
      const viewW = Math.max(12, viewVisiblePct * w);
      const { x, w: cw } = clampInterval(viewLeft, viewW, w);
      if (cw > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(x, 0, cw, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, 0, cw, h);
      }
    } else {
      // Content fits in viewport — show full-width indicator
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, w, h);
    }
  }

  function handleMinimapClick(event: MouseEvent) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onMinimapClick(pct);
  }

  $effect(() => {
    void dna; void geneFeatures; void selectionStart; void selectionEnd;
    void scrollTop; void totalContentH; void canvasH;
    tick().then(() => draw());
  });

  onMount(() => {
    const observer = new ResizeObserver(() => draw());
    if (canvas) observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="minimap-bar-wrapper" style="position: relative; height: 22px; border-bottom: 1px solid #222; cursor: pointer; overflow: hidden;" onclick={handleMinimapClick}>
  <canvas bind:this={canvas} style="width: 100%; height: 100%; display: block;"></canvas>
</div>
