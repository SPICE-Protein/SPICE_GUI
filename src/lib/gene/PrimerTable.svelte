<script lang="ts"> 

  import * as m from '$lib/paraglide/messages.js';
  import { AlertTriangle, Check, Activity, Zap } from 'lucide-svelte';
  import { analyzePrimer, type PrimerAnalysis } from '$lib/genome';

  let {
    pcrPrimers = [] as { name: string; seq: string; tm: number; gc: number; len: number; phosphorylated?: boolean }[]
  } = $props<{
    pcrPrimers: { name: string; seq: string; tm: number; gc: number; len: number; phosphorylated?: boolean }[];
  }>();

  const analyses = $derived(pcrPrimers.map((p: any) => analyzePrimer(p.seq)));
</script>

<div class="primer-designer-box" style="display: flex; flex-direction: column; gap: 6px;">
  
  {#if pcrPrimers.length > 0}
    <div style="display: flex; flex-direction: column; gap: 8px;">
      {#each pcrPrimers as pr, idx}
        {@const analysis = analyses[idx]}
        <div class="pix-panel" style="padding: 6px; border-color: {analysis.score > 70 ? 'var(--pix-border-hi)' : 'var(--pix-accent)'}; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold;">
            <span style="color: var(--pix-accent-2);">{pr.name}</span>
            <span style="display: flex; align-items: center; gap: 4px;">
              <span class="pix-num">{pr.len} bp</span>
              <span style="font-size: 9px; padding: 1px 4px; border-radius: 2px; background: {analysis.score > 70 ? 'rgba(83,215,105,0.15)' : 'rgba(255,159,28,0.15)'}; color: {analysis.score > 70 ? 'var(--pix-green)' : 'var(--pix-accent)'};">
                Q:{analysis.score}
              </span>
            </span>
          </div>
          <div class="mono" style="word-break: break-all; font-size: 9px; margin: 2px 0; color: var(--pix-cyan);">
            {#if pr.phosphorylated}
              <span style="color: var(--pix-red); font-weight: bold; background: rgba(255,69,58,0.15); padding: 0px 3px; border-radius: 2px; margin-right: 4px;" title={m.ptPhosphoTitle()}>[5'-Phosphate]</span>
            {/if}
            {pr.seq}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px;" class="pix-dim">
            <span>Tm: <span class="pix-num" style="font-size:11px;">{pr.tm} °C</span></span>
            <span>GC: <span class="pix-num" style="font-size:11px;">{pr.gc.toFixed(0)}%</span></span>
            <span>GC clamp: {#if analysis.gcClamp}<Check size={9} style="color: var(--pix-green)" />{:else}<AlertTriangle size={9} style="color: var(--pix-accent)" />{/if}</span>
          </div>
          
          <!-- Secondary structure -->
          {#if analysis.hairpins.length > 0 || analysis.selfDimers.length > 0}
            <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 3px 0 2px; padding-top: 3px;">
              {#if analysis.hairpins.length > 0}
                <div style="font-size: 9px; color: var(--pix-accent); display: flex; align-items: center; gap: 3px;">
                  <Activity size={9} /> Hairpin: {analysis.hairpins[0].stemLength}bp stem, {analysis.hairpins[0].loopLength}nt loop (Tm {analysis.hairpins[0].meltingTemp.toFixed(1)}°C)
                </div>
              {/if}
              {#if analysis.selfDimers.length > 0}
                <div style="font-size: 9px; color: var(--pix-red); display: flex; align-items: center; gap: 3px;">
                  <AlertTriangle size={9} /> Self-dimer: {analysis.selfDimers[0].length}bp (Tm {analysis.selfDimers[0].meltingTemp.toFixed(1)}°C)
                </div>
              {/if}
            </div>
          {/if}
          
          {#if analysis.warnings.length > 0}
            <div style="font-size: 8px; color: var(--pix-fg-dim); margin-top: 2px;">
              {analysis.warnings.join('; ')}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty pix-dim" style="text-align: center; padding: 12px 0;">{m.sequenceTooShortToDesignPrimers()}</div>
  {/if}
</div>
