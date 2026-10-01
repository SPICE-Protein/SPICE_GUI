<script lang="ts">
  // Single physical metric readout bar with a stability threshold.
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';

  let {
    label = '',
    value = 0,
    threshold = 1,
    unit = '',
    goodWhen = 'below' as 'below' | 'above',
    tooltip = '',
  } = $props<{ label: string; value: number; threshold: number; unit?: string; goodWhen?: 'below' | 'above'; tooltip?: string }>();

  const ok = $derived(goodWhen === 'below' ? value < threshold : value > threshold);
  // normalized position (log-ish clamp for m1's huge range)
  const frac = $derived(Math.min(1, Math.max(0, value / (threshold * 1.5))));
  const cls = $derived(ok ? 'good' : 'bad');
</script>

<div class="mbar {tooltip ? 'pix-tooltip' : ''}" data-lang={currentLocale.value} data-tooltip={tooltip}>
  <div class="mbar-head">
    <span class="mbar-label pix-dim">{label}</span>
    <span class="mbar-val pix-num {cls}">
      {value.toExponential(2)} {unit}
    </span>
  </div>
  <div class="mbar-track">
    <div class="mbar-fill {cls}" style="width: {frac * 100}%"></div>
    <div class="mbar-thresh" style="left: {(1 / 1.5) * 100}%" title="{m.metricThresh({ v: threshold.toExponential(1) })}"></div>
  </div>
  <div class="mbar-foot pix-dim">{m.metricThresh({ v: threshold.toExponential(1) })} · {ok ? m.metricOk() : m.metricOver()}</div>
</div>

<style>
  .mbar {
    margin-bottom: 10px;
  }
  .mbar-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 2px;
  }
  .mbar-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .mbar-val {
    font-size: 12px;
  }
  .mbar-track {
    position: relative;
    height: 12px;
    background: #0b0e14;
    border: 2px solid var(--pix-border);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  }
  .mbar-fill {
    height: 100%;
  }
  .mbar-fill.good {
    background: var(--pix-green);
  }
  .mbar-fill.bad {
    background: var(--pix-red);
  }
  .mbar-thresh {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--pix-accent-2);
    box-shadow: 0 0 4px var(--pix-accent-2);
  }
  .mbar-foot {
    font-size: 9px;
    margin-top: 1px;
  }
</style>
