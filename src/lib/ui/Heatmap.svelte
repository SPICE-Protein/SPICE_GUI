<script lang="ts">
  // Canvas heatmap with pixel styling. Modes:
  //  - 'distance': blue→red diverging scale (Å)
  //  - 'contact':  green = contact, dark = none
  //  - 'phase':    cells are 1 = stable, 0 = crashed/unstable, -1 = build failed, null = pending
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';

  let {
    values = [] as (number | null)[], // row-major [rows*cols]
    rows = 0,
    cols = 0,
    rowLabels = [] as string[],
    colLabels = [] as string[],
    mode = 'distance',
    min = 3,
    max = 48,
    title = '',
  } = $props<{
    values: (number | null)[];
    rows: number;
    cols: number;
    rowLabels?: string[];
    colLabels?: string[];
    mode?: 'distance' | 'contact' | 'phase';
    min?: number;
    max?: number;
    title?: string;
  }>();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let hover = $state<string>('');

  function draw() {
    const cv = canvas;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.max(2, Math.floor(W * dpr));
    cv.height = Math.max(2, Math.floor(H * dpr));
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1120';
    ctx.fillRect(0, 0, W, H);

    if (rows === 0 || cols === 0) return;
    const padX = 6;
    const padTop = 16;
    const padY = 6;
    const cw = (W - padX * 2) / cols;
    const ch = (H - padTop - padY) / rows;

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const v = values[i * cols + j];
        let fill = '#0d1120';
        if (v !== null && v !== undefined) {
          if (mode === 'phase') {
            if (v === 1) fill = '#1f9d4d';
            else if (v === 0) fill = '#c0392b';
            else if (v === -1) fill = '#5a3d99';
          } else if (mode === 'contact') {
            fill = v > 0.5 ? '#39c25f' : '#18233a';
          } else {
            const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
            const h = 232 - 232 * t;
            const s = 70;
            const l = 24 + 32 * (1 - Math.abs(t - 0.5) * 2);
            fill = `hsl(${h} ${s}% ${l}%)`;
          }
        }
        ctx.fillStyle = fill;
        ctx.fillRect(padX + j * cw, padTop + i * ch, Math.max(1, cw - 0.5), Math.max(1, ch - 0.5));
        // pixel grid
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(padX + j * cw + 0.25, padTop + i * ch + 0.25, cw - 0.5, ch - 0.5);
      }
    }

    // axis labels
    ctx.fillStyle = '#8b96b5';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    if (colLabels.length === cols) {
      const step = Math.max(1, Math.ceil(cols / 12));
      for (let j = 0; j < cols; j += step) {
        ctx.fillText(colLabels[j], padX + j * cw + cw / 2, H - 1);
      }
    }
    ctx.textAlign = 'right';
    if (rowLabels.length === rows) {
      const step = Math.max(1, Math.ceil(rows / 12));
      for (let i = 0; i < rows; i += step) {
        ctx.fillText(rowLabels[i], padX - 3, padTop + i * ch + ch / 2 + 3);
      }
    }
    if (title) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(title, 6, 11);
    }
  }

  function readCell(clientX: number, clientY: number) {
    const cv = canvas;
    if (!cv || rows === 0 || cols === 0) return;
    const rect = cv.getBoundingClientRect();
    const padX = 6;
    const padTop = 16;
    const cw = (rect.width - padX * 2) / cols;
    const ch = (rect.height - padTop - 6) / rows;
    const j = Math.floor((clientX - rect.left - padX) / cw);
    const i = Math.floor((clientY - rect.top - padTop) / ch);
    if (i < 0 || i >= rows || j < 0 || j >= cols) {
      hover = '';
      return;
    }
    const v = values[i * cols + j];
    const rl = rowLabels[i] ?? String(i);
    const cl = colLabels[j] ?? String(j);
    if (mode === 'phase') {
      const label = v === 1 ? m.legendStable() : v === 0 ? m.legendCrash() : v === -1 ? m.legendBuildFailed() : '—';
      hover = `${rl} × ${cl} → ${label}`;
    } else if (v !== null && v !== undefined) {
      hover = `(${rl}, ${cl}) = ${v.toFixed(2)}`;
    } else {
      hover = '';
    }
  }

  // Live hover is mouse-only; touch has no hover, so a tap reads the cell
  // (see onpointerdown in the template) and the chip stays until the next tap.
  function onMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    readCell(e.clientX, e.clientY);
  }

  onMount(() => {
    draw();
  });
  $effect(() => {
    draw();
  });
</script>

<div class="heat" data-lang={currentLocale.value}>
  {#if values.length}
    <canvas
      bind:this={canvas}
      onpointermove={onMove}
      onpointerdown={(e) => readCell(e.clientX, e.clientY)}
      onmouseleave={() => (hover = '')}
    ></canvas>
    {#if hover}
      <div class="heat-hover pix-num">{hover}</div>
    {/if}
  {:else}
    <div class="heat-empty pix-dim">{m.heatEmpty()}</div>
  {/if}
</div>

<style>
  .heat {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    min-height: 140px;
    background: #0d1120;
    border: 2px solid var(--pix-border);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
  }
  .heat-hover {
    position: absolute;
    top: 2px;
    right: 2px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid var(--pix-border-hi);
    padding: 2px 6px;
    font-size: 10px;
  }
  .heat-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: 1px;
  }
</style>
