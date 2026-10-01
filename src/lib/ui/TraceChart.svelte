<script lang="ts">
  // SVG line chart for the potential-energy trajectory (pixel style).
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';

  let {
    data = [] as number[],
    color = '#4cd6ff',
    label = 'U (kcal/mol)',
    height = 130,
  } = $props<{ data: number[]; color?: string; label?: string; height?: number }>();

  const W = 300;
  const padL = 46;
  const padR = 8;
  const padT = 8;
  const padB = 18;

  let pts = $derived.by(() => {
    const n = data.length;
    const points: [number, number][] = [];
    let lo = 0;
    let hi = 0;
    if (n >= 2) {
      let loV = Infinity;
      let hiV = -Infinity;
      for (const v of data) {
        if (v < loV) loV = v;
        if (v > hiV) hiV = v;
      }
      const span = hiV - loV || 1;
      lo = loV - span * 0.05;
      hi = hiV + span * 0.05;
      const px = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
      const py = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);
      data.forEach((v: number, i: number) => points.push([px(i), py(v)]));
    }
    return { points, lo, hi };
  });

  const poly = $derived(pts.points.map((p) => p.join(',')).join(' '));
  const last = $derived(pts.points[pts.points.length - 1]);
</script>

<div class="chart" data-lang={currentLocale.value}>
  {#if pts.points.length >= 2}
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <!-- grid -->
      {#each [0, 1, 2, 3] as g}
        <line
          x1={padL} x2={W - padR}
          y1={padT + (g / 3) * (height - padT - padB)}
          y2={padT + (g / 3) * (height - padT - padB)}
          stroke="#26304b" stroke-width="1"
        />
      {/each}
      <polyline points={poly} fill="none" stroke={color} stroke-width="2" />
      {#if last}
        <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
      {/if}
      <!-- y labels -->
      {#each [0, 3] as g}
        <text x={padL - 4} y={padT + (g / 3) * (height - padT - padB) + 3}
          text-anchor="end" font-size="9" fill="#8b96b5" font-family="monospace">
          {g === 0 ? pts.hi.toFixed(0) : pts.lo.toFixed(0)}
        </text>
      {/each}
      <text x={padL + 4} y={height - 5} font-size="9" fill="#8b96b5" font-family="monospace">
        {m.traceStepsCaption({ label, n: data.length })}
      </text>
    </svg>
  {:else}
    <div class="chart-empty pix-dim">{m.traceEmpty()}</div>
  {/if}
</div>

<style>
  .chart {
    width: 100%;
    background: #0d1120;
    border: 2px solid var(--pix-border);
    padding: 4px;
    box-sizing: border-box;
  }
  svg {
    display: block;
  }
  .chart-empty {
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: 1px;
  }
</style>
