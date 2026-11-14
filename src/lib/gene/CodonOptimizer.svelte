<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { RefreshCw } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { calculateCai } from '$lib/genome';
  import { calculateGc, optimizeCodonsMultiObjective } from '$lib/genome/codonOptimization';

  let {
    dnaSeq = $bindable(''),
    codonHost = 'ecoli',
    translatedProtein = '',
    onOptimizeLog = (msg: string) => {}
  } = $props<{
    dnaSeq: string;
    codonHost: 'ecoli' | 'yeast' | 'human';
    translatedProtein: string;
    onOptimizeLog: (msg: string) => void;
  }>();

  // Multi-objective objectives exposed to the user. Empty values fall back to
  // the engine defaults (50% GC, 5-base homopolymer limit, no forbidden motifs).
  let targetGc = $state(50);
  let maxHomopolymer = $state(5);
  let forbiddenText = $state('');
  let lastResult = $state<{ cai: number; gc: number; violations: string[] } | null>(null);

  // Calculate Codon Adaptation Index (CAI) using the ported genome core
  const caiScore = $derived.by(() => {
    if (dnaSeq.length < 3) return 0;
    return calculateCai(dnaSeq, codonHost).cai;
  });
  const gcScore = $derived(calculateGc(dnaSeq));

  function parseMotifs(text: string): string[] {
    return text
      .split(/[,;\s]+/)
      .map((motif) => motif.toUpperCase().replace(/[^ACGT]/g, ''))
      .filter((motif) => motif.length > 0);
  }

  // Synonymous codon optimization under several simultaneous constraints.
  function optimizeCodons() {
    if (!translatedProtein) {
      pushToast('error', m.optimizationFailed(), m.translatedProteinSequenceIsEmpty());
      return;
    }

    const prevCai = caiScore;
    const result = optimizeCodonsMultiObjective(translatedProtein, {
      host: codonHost,
      targetGc,
      maxHomopolymer,
      forbiddenMotifs: parseMotifs(forbiddenText),
      iterations: 2000,
    });

    dnaSeq = result.sequence;
    lastResult = { cai: result.cai, gc: result.gc, violations: result.violations };

    const msg = m.codonOptimizeSuccessLog({ toUpperCase: codonHost.toUpperCase(), toFixed: prevCai.toFixed(3) });
    onOptimizeLog(msg);
    pushToast(
      'success',
      m.codonOptimizationSuccessful(),
      `${m.host()}: ${codonHost.toUpperCase()} · CAI ${result.cai.toFixed(3)} · GC ${result.gc.toFixed(1)}%`
    );
  }
</script>

<div class="opt-box" style="display: flex; flex-direction: column; gap: 6px;">
  <div class="opt-panel" style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; font-size: 11px; display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="pix-dim">{m.hostExpressionSystem()}</span>
      <span class="pix-num" style="color: var(--pix-cyan); text-transform: uppercase; font-weight: bold;">{codonHost}</span>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="pix-dim">{m.codonAdaptationIndexCAI()}</span>
      <span class="pix-num {caiScore > 0.8 ? 'good' : 'warn'}" style="font-weight: bold; font-size: 12px;">
        {caiScore.toFixed(4)}
      </span>
    </div>

    <!-- Progress bar for CAI -->
    <div style="width: 100%; height: 6px; background: var(--pix-bg-3); border-radius: 3px; overflow: hidden; border: 1px solid var(--pix-border);">
      <div style="height: 100%; width: {caiScore * 100}%; background: {caiScore > 0.8 ? 'var(--pix-green)' : 'var(--pix-accent)'}; transition: width 0.3s;"></div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span class="pix-dim">GC</span>
      <span class="pix-num" style="font-weight: bold;">{gcScore.toFixed(1)}%</span>
    </div>

    <div class="codon-objectives">
      <label class="codon-field">
        <span class="pix-dim">{m.codonTargetGc()}</span>
        <input class="pix-input" type="number" min="20" max="80" step="1" data-testid="codon-target-gc" bind:value={targetGc} />
      </label>
      <label class="codon-field">
        <span class="pix-dim">{m.codonMaxHomopolymer()}</span>
        <input class="pix-input" type="number" min="2" max="10" step="1" data-testid="codon-max-homopolymer" bind:value={maxHomopolymer} />
      </label>
      <label class="codon-field codon-field-wide">
        <span class="pix-dim">{m.codonForbiddenMotifs()}</span>
        <input class="pix-input" type="text" placeholder={m.codonForbiddenMotifsPh()} data-testid="codon-forbidden" bind:value={forbiddenText} />
      </label>
    </div>

    {#if lastResult}
      <div class="codon-result pix-dim" data-testid="codon-result">
        {m.codonOptimizeResult({ cai: lastResult.cai.toFixed(3), gc: lastResult.gc.toFixed(1) })}
        {#if lastResult.violations.length > 0}
          <div class="codon-violations">{m.codonViolations({ list: lastResult.violations.join(', ') })}</div>
        {/if}
      </div>
    {/if}

    <button
      class="pix-btn"
      onclick={optimizeCodons}
      style="margin-top: 4px; padding: 4px; font-size: 11px; display: inline-flex; justify-content: center; align-items: center; gap: 6px;"
    >
      <RefreshCw size={11} /> {m.synonymousCodonOptimizationCAI10()}
    </button>
  </div>
</div>

<style>
  .codon-objectives { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; }
  .codon-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .codon-field-wide { grid-column: 1 / -1; }
  .codon-field .pix-input { width: 100%; box-sizing: border-box; font-size: 10px; padding: 2px 4px; }
  .codon-result { font-size: 10px; line-height: 1.5; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .codon-violations { color: var(--pix-accent); }
</style>
