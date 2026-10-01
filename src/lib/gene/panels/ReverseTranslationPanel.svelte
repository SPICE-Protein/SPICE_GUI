<script lang="ts">
  import { Dna } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { reverseTranslate, type ReverseTranslateResult } from '$lib/genome';

  let { showReverseTranslatePanel = $bindable(false), drag, pushLog = () => {}, pushToast = () => {} } = $props<{
    showReverseTranslatePanel: boolean;
    drag?: any;
    pushLog?: (message: string) => void;
    pushToast?: (type: any, title: string, text?: string) => void;
  }>();

  let protein = $state('MKT');
  let host = $state<'ecoli' | 'yeast' | 'human'>('ecoli');
  let includeStop = $state(false);
  let output = $state<'both' | 'dna' | 'mrna'>('both');
  let result = $state<ReverseTranslateResult | null>(null);

  function run() {
    if (!protein.trim()) return pushToast('error', m.reverseTranslationErrorTitle(), m.reverseTranslationErrorEmpty());
    try {
      result = reverseTranslate(protein, { host, optimizeGc: false, includeStop, output });
      pushLog(`[RevTrans] ${result.proteinSequence.length} aa -> ${result.dnaSequence.length} bp; validation ${result.validation.valid ? 'OK' : 'FAILED'}`);
      pushToast(result.validation.valid ? 'success' : 'warn', m.reverseTranslationComplete(), `${result.dnaSequence.length} ${m.reverseTranslationGenerated()}`);
    } catch (error) {
      pushToast('error', m.reverseTranslationFailed(), error instanceof Error ? error.message : String(error));
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    pushToast('success', m.reverseTranslationCopied(), label);
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 360px; top: 180px; width: 390px; z-index: 60;">
  <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--pix-border); padding-bottom:4px; margin-bottom:6px;">
    <span style="font-weight:bold; color:var(--pix-accent-2); font-size:10.5px; display:inline-flex; align-items:center; gap:4px;"><Dna size={12}/> {m.reverseTranslation()}</span>
    <button class="pix-btn-reset" onclick={() => showReverseTranslatePanel = false} style="font-size:11px; color:var(--pix-red);">{m.close()}</button>
  </div>
  <div style="display:flex; flex-direction:column; gap:6px; font-size:10px;">
    <label class="pix-dim">{m.reverseTranslationEnterProtein()}
      <textarea class="pix-input" bind:value={protein} rows="3" style="width:100%; resize:vertical; font-family:monospace;" placeholder={m.placeholderSeq()}></textarea>
    </label>
    <div style="display:flex; gap:6px; align-items:center;">
      <span class="pix-dim">{m.reverseTranslationHost()}:</span>
      <select class="pix-select" bind:value={host} style="flex:1;"><option value="ecoli">{m.hostEcoli()}</option><option value="yeast">{m.hostYeast()}</option><option value="human">{m.hostHuman()}</option></select>
      <select class="pix-select" bind:value={output}><option value="both">{m.reverseTranslationOutputBoth()}</option><option value="dna">{m.reverseTranslationOutputDna()}</option><option value="mrna">{m.reverseTranslationOutputMrna()}</option></select>
      <label><input type="checkbox" bind:checked={includeStop}/> {m.reverseTranslationStop()}</label>
    </div>
    <button class="pix-btn ok" onclick={run} style="padding:3px;">{m.reverseTranslationGenerate()}</button>
    {#if result}
      <div class="pix-panel" style="padding:5px; border-color:var(--pix-green);">
        <div class="pix-dim">{m.reverseTranslationValidation()}: <b style="color:{result.validation.valid ? 'var(--pix-green)' : 'var(--pix-red)'}">{result.validation.valid ? m.reverseTranslationPass() : m.reverseTranslationFail()}</b> · {result.codonTrace.length} {m.reverseTranslationCodons()}</div>
        {#if output !== 'mrna'}<div class="mono" style="word-break:break-all; margin-top:4px;">{m.reverseTranslationCdna()}: {result.cdnaSequence}</div>{/if}
        {#if output !== 'dna'}<div class="mono" style="word-break:break-all; margin-top:4px;">{m.reverseTranslationMrna()}: {result.mrnaSequence}</div>{/if}
        <div style="display:flex; gap:4px; margin-top:5px;"><button class="pix-btn" onclick={() => copy(result!.cdnaSequence, m.reverseTranslationCdnaCopied())}>{m.reverseTranslationCopyCdna()}</button><button class="pix-btn" onclick={() => copy(result!.mrnaSequence, m.reverseTranslationMrnaCopied())}>{m.reverseTranslationCopyMrna()}</button></div>
        <details style="margin-top:5px;"><summary>{m.reverseTranslationCodonTrace()}</summary><div class="mono" style="font-size:8px; max-height:120px; overflow:auto;">{result.codonTrace.map(t => `${t.index + 1}. ${t.aminoAcid} ${t.codon} [${t.dnaStart + 1}-${t.dnaEnd}]`).join('\n')}</div></details>
        {#if result.warnings.length}<div style="color:var(--pix-yellow); margin-top:4px;">{result.warnings.join(' · ')}</div>{/if}
      </div>
    {/if}
  </div>
</div>
