<script lang="ts"> 

  import * as m from '$lib/paraglide/messages.js';
  import { Sparkles, RefreshCw, Zap } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { calculateCai, BEST_CODONS } from '$lib/genome';

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

  // Calculate Codon Adaptation Index (CAI) using the ported genome core
  const caiScore = $derived.by(() => {
    if (dnaSeq.length < 3) return 0;
    return calculateCai(dnaSeq, codonHost).cai;
  });

  // Synonymous Codon Optimization
  function optimizeCodons() {
    if (!translatedProtein) {
      pushToast('error', m.optimizationFailed(), m.translatedProteinSequenceIsEmpty());
      return;
    }

    const hostKey = codonHost as 'ecoli' | 'yeast' | 'human';
    const hostBest = BEST_CODONS[hostKey] || BEST_CODONS.ecoli;
    let optimizedDna = '';

    for (let i = 0; i < translatedProtein.length; i++) {
      const aa = translatedProtein[i];
      optimizedDna += hostBest[aa] || 'ATG';
    }

    const prevCai = caiScore;
    dnaSeq = optimizedDna;

    const msg = m.codonOptimizeSuccessLog({ toUpperCase: codonHost.toUpperCase(), toFixed: prevCai.toFixed(3) });
    onOptimizeLog(msg);
    pushToast('success', m.codonOptimizationSuccessful(), `${m.host()}: ${codonHost.toUpperCase()}`);
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

    <button 
      class="pix-btn" 
      onclick={optimizeCodons} 
      style="margin-top: 4px; padding: 4px; font-size: 11px; display: inline-flex; justify-content: center; align-items: center; gap: 6px;"
    >
      <RefreshCw size={11} /> {m.synonymousCodonOptimizationCAI10()}
    </button>
  </div>
</div>
