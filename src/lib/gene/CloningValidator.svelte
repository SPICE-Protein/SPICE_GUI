<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';
  function t(zh: string, en: string): string {
    return currentLocale.value === 'zh' ? zh : en;
  }

  import { CheckCircle2, AlertTriangle, XCircle, FileUp, Sparkles, RefreshCw, BarChart2 } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { validateClone, type VariantEffect, type CdsFeature } from '$lib/genome/cloningValidation';

  let {
    referenceSeq = '',
    referenceFeatures = [] as { name: string; start: number; end: number; type: string }[],
    onValidationLog = (msg: string) => {}
  } = $props<{
    referenceSeq: string;
    referenceFeatures: { name: string; start: number; end: number; type: string }[];
    onValidationLog: (msg: string) => void;
  }>();

  // Inputs
  let querySeq = $state('TCGACATGGTGTCTAAGGGCGAAGAGCTGATTAAGGAGAACATGCACATGAAGCTGTACATGGAGGGCACCGTGGACAACCATCACTTCAAGTGCACATCCGAGGGCGAAGGCAAGCCCTACGAGGGCACCCAGACCATGAGAATCAAGGTGGTCGAGGGCGGCCCTCTCCCCTTCGCCTTCGACATCCTGGCTACTAGCTTCCTCTACGGCAGCAAGACCTTCATCAACCACACCCAGGGCATCCCCGACTTCTTCAAGCAGTCCTTCCCTGAGGGCTTCACATGGGAGAGAGTCACCACATACGAAGACGGGGGCGTGCTGACCGCTACCCAGGACACCAGCCTCCAGGACGGCTGCCTCATCTACAACGTCAAGATCAGAGGGGTGAACTTCACATCCAATGGCCCTGTGATGCAGAAGAAAACACTCGGCTGGGAGGCCTTCACCGAGACGCTGTACCCCGCTGACGGCGGCCTGGAAGGCAGAAACGACATGGCCCTGAAGCTCGTGGGCGGGAGCCATCTGATCGCAAACATCAAGACCACATATAGATCCAAGAAACCCGCTAAGAACCTCAAGATGCCCGGCGTCTACTATGTGGACTACAGACTGGAAAGAATCAAGGAGGCCAACAACGAGACCTACGTCGAGCAGCACGAGGTGGCAGTGGCCAGATACTGCGACCTCCCTAGCAAACTGGGGCACAAACTTAATGGTACC'); // Default matches blue fluorescent protein
  let minIdentity = $state(99.0);
  let minCoverage = $state(90.0);
  let allowSynonymous = $state(true);

  // Result state
  let result = $state<any>(null);
  let isRun = $state(false);

  // Map reference features to CDS features for VEP
  const cdsFeatures = $derived.by(() => {
    return referenceFeatures
      .filter((f: any) => f.type.toLowerCase() === 'cds' || f.type.toLowerCase() === 'feature')
      .map((f: any) => ({
        name: f.name || 'CDS_Feature',
        start: f.start,
        end: f.end,
        forward: true // Simplification
      }));
  });

  function runValidation() {
    if (!referenceSeq || referenceSeq.length < 10) {
      pushToast('error', m.validationFailed(), m.cloneSeqEmptyWarn());
      return;
    }
    if (!querySeq || querySeq.length < 10) {
      pushToast('error', m.validationFailed(), m.seqQueryEmptyWarn());
      return;
    }

    try {
      const res = validateClone({
        referenceSequence: referenceSeq,
        querySequence: querySeq,
        cdsFeatures,
        minIdentityToPass: minIdentity,
        minCoverageToPass: minCoverage,
        allowSynonymousMutations: allowSynonymous
      });

      result = res;
      isRun = true;

      if (res.passed) {
        pushToast('success', m.cloneValPass(), `${m.identity()}: ${res.identity}% | ${m.variants()}: ${res.variants.length}`);
        onValidationLog(m.valPassLog({ identity: res.identity, coverage: res.coverage }));
      } else {
        if (res.status === 'WARNING') {
          pushToast('info', m.cloneValidationWarning(), `${m.detected()} ${res.variants.length} ${m.synonymousVariants()}`);
          onValidationLog(m.valWarnLog({ length: res.variants.length }));
        } else {
          pushToast('error', m.cloneValFail(), m.cloneValCritical());
          onValidationLog(m.valFailLog());
        }
      }
    } catch (e: any) {
      pushToast('error', m.runtimeException(), e.message);
    }
  }

  // Utility to get badge styles
  function getBadgeStyles(status: string) {
    if (status === 'PASS') return { bg: 'rgba(0, 255, 100, 0.15)', border: 'var(--pix-green)', text: 'var(--pix-green)' };
    if (status === 'WARNING') return { bg: 'rgba(255, 200, 0, 0.15)', border: 'var(--pix-yellow)', text: 'var(--pix-yellow)' };
    return { bg: 'rgba(255, 50, 50, 0.15)', border: 'var(--pix-red)', text: 'var(--pix-red)' };
  }
</script>

<div class="validator-box" style="display: flex; flex-direction: column; gap: 8px; color: var(--pix-fg); font-family: var(--pix-font), monospace;">
  <!-- Setup Inputs -->
  <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
    <div style="font-weight: bold; color: var(--pix-accent-2);">{m.sangerCloneValidationWizard()}</div>
    
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <span class="pix-dim">{m.cvSangerInputHint()}</span>
      <textarea 
        bind:value={querySeq} 
        rows="3" 
        style="width: 100%; background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; padding: 4px; font-size: 9px; font-family: monospace; resize: vertical; outline: none;"
        placeholder={m.sangerPastePlaceholder()}
      ></textarea>
    </div>

    <div style="display: flex; gap: 8px; justify-content: space-between; align-items: center;">
      <label style="display: flex; align-items: center; gap: 3px;">
        <span class="pix-dim">{m.minIdentityThreshold()}</span>
        <input type="number" step="0.1" bind:value={minIdentity} style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; width: 45px; text-align: center; font-size: 9px;" />
      </label>
      <label style="display: flex; align-items: center; gap: 3px;">
        <span class="pix-dim">{m.allowSynonymousMutations()}</span>
        <input type="checkbox" bind:checked={allowSynonymous} style="cursor: pointer;" />
      </label>
    </div>

    <button 
      class="pix-btn" 
      onclick={runValidation}
      style="width: 100%; padding: 5px; font-size: 11px; font-weight: bold; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 4px;"
    >
      <CheckCircle2 size={12} /> {m.autoCloneAnnotationValidation()}
    </button>
  </div>

  <!-- Validation Report -->
  {#if isRun && result}
    {@const badge = getBadgeStyles(result.status)}
    <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px;">
      <!-- Main Status Badge -->
      <div style="background: {badge.bg}; border: 2px solid {badge.border}; border-radius: 4px; padding: 6px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 6px;">
          {#if result.status === 'PASS'}
            <CheckCircle2 size={24} style="color: {badge.text};" />
          {:else}
            <AlertTriangle size={24} style="color: {badge.text};" />
          {/if}
          <div>
            <div style="font-size: 12px; font-weight: bold; color: {badge.text};">{m.cloneSequencingResult()}{result.status}</div>
            <div style="font-size: 9px; color: var(--pix-dim);">{m.valIdentityLabel()} {result.identity}% | {m.coverage()} {result.coverage}%</div>
          </div>
        </div>
        <div style="font-size: 10px; text-align: right;">
          <span style="font-weight: bold; color: #fff;">{result.variants.length}</span> {m.valVariantsLabel()}
        </div>
      </div>

      <!-- Warnings/Logs -->
      {#if result.warnings.length > 0}
        <div style="background: rgba(255,50,50,0.05); border-left: 3px solid var(--pix-red); padding: 4px 8px; font-size: 9px; display: flex; flex-direction: column; gap: 2px;">
          {#each result.warnings as warn}
            <div style="color: var(--pix-yellow);">• {warn}</div>
          {/each}
        </div>
      {/if}

      <!-- Variants VEP Grid -->
      <div style="font-size: 10px;">
        <span class="pix-dim" style="font-weight: bold; display: block; margin-bottom: 3px; color: var(--pix-accent-2);">{m.variantEffectPredictionVEP()}</span>
        
        {#if result.variants.length === 0}
          <div style="background: var(--pix-bg-3); border: 1px dashed var(--pix-border); color: var(--pix-green); text-align: center; padding: 10px; font-size: 9px;">
            {m.cloneValPerfect()}
          </div>
        {:else}
          <div style="max-height: 110px; overflow-y: auto; border: 1px solid var(--pix-border); background: var(--pix-bg-3);">
            <table style="width: 100%; border-collapse: collapse; font-size: 9px; text-align: left;">
              <thead style="background: var(--pix-bg-2); border-bottom: 1px solid var(--pix-border); position: sticky; top: 0;">
                <tr>
                  <th style="padding: 2px 4px;">{m.position()}</th>
                  <th style="padding: 2px 4px;">{m.variant()}</th>
                  <th style="padding: 2px 4px;">{m.codingRegion()}</th>
                  <th style="padding: 2px 4px;">{m.proteinChange()}</th>
                  <th style="padding: 2px 4px;">{m.classification()}</th>
                </tr>
              </thead>
              <tbody>
                {#each result.variants as variant}
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 2px 4px; font-family: monospace;">{variant.refPos + 1} bp</td>
                    <td style="padding: 2px 4px; font-family: monospace; color: var(--pix-accent);">{variant.refSeq || '-'} ➔ {variant.querySeq || '-'}</td>
                    <td style="padding: 2px 4px; color: var(--pix-dim);">{variant.inCds ? variant.cdsName : m.nonCoding()}</td>
                    <td style="padding: 2px 4px; font-family: monospace;">
                      {#if variant.inCds && variant.originalAminoAcid}
                        {variant.originalAminoAcid}{variant.codonIndex! + 1}{variant.mutatedAminoAcid}
                      {:else}
                        -
                      {/if}
                    </td>
                    <td style="padding: 2px 4px; font-weight: bold; color: {variant.classification === 'Synonymous' ? 'var(--pix-green)' : variant.classification === 'Intronic/Intergenic' ? 'var(--pix-dim)' : 'var(--pix-red)'}">
                      {variant.classification}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- Sanger Quality Chart (Mocked/Simulated Trace Quality) -->
      {#if result.traceQuality}
        <div style="font-size: 10px; border-top: 1px dashed var(--pix-border); padding-top: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span class="pix-dim" style="font-weight: bold;">{m.sangerChromatogramQualityProfile()}</span>
            <span style="font-size: 9px; color: var(--pix-green);">{m.meanQScore()}: <b>{result.traceQuality.averageQ}</b> ({m.highQuality()} Q30+: <b>{result.traceQuality.highQualityPercent}%</b>)</span>
          </div>

          <!-- Micro bar chart showing Q-score sequence profile -->
          <div style="width: 100%; height: 24px; background: rgba(0,0,0,0.3); border: 1px solid var(--pix-border); display: flex; align-items: flex-end; gap: 1px; padding: 2px; border-radius: 2px;">
            {#each result.traceQuality.qScores.filter((_: any, i: number) => i % Math.max(1, Math.floor(result.traceQuality.qScores.length / 60)) === 0) as q}
              {@const heightPct = (q / 60) * 100}
              {@const qColor = q >= 30 ? 'var(--pix-green)' : q >= 20 ? 'var(--pix-yellow)' : 'var(--pix-red)'}
              <div 
                style="flex: 1; height: {heightPct}%; background: {qColor}; min-width: 2px;" 
                title="Q-score: {q}"
              ></div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
