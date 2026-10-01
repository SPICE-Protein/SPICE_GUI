<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import {
    detectCrypticSpliceSites,
    detectCrypticPolyASignals,
    eliminateCrypticSpliceSites,
    eliminateCrypticPolyASignals,
    analyzeKozak,
    optimizeKozak,
    detectPrematureStopCodons,
    calculateCpbScore,
    optimizeCodonPairs,
    detectLowComplexityRegions,
    maskLowComplexityRegions
  } from '$lib/genome';

  let {
    dnaSeq = $bindable(''),
    geneFeatures = [],
    pushLog = (msg: string) => {},
    pushToast = (kind: any, title: string, body?: string) => {},
    showSyntheticGeneQc = $bindable(false)
  } = $props<{
    dnaSeq: string;
    geneFeatures: any[];
    pushLog: (msg: string) => void;
    pushToast: (kind: any, title: string, body?: string) => void;
    showSyntheticGeneQc: boolean;
  }>();

  let qcTab = $state<'splice_polyA' | 'kozak' | 'ptc' | 'cpb' | 'dust'>('splice_polyA');
</script>

<div class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 100px; width: 345px; z-index: 60; max-height: 485px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.syntheticGeneDesignerQC()}</span>
    <button class="pix-btn-reset" onpointerdown={(e) => e.stopPropagation()} onclick={() => showSyntheticGeneQc = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: flex; gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {qcTab === 'splice_polyA' ? 'ok' : ''}" onclick={() => qcTab = 'splice_polyA'} style="flex: 1.2; padding: 2px; font-size: 8px;">{m.tabQcSplice()}</button>
    <button class="pix-btn {qcTab === 'kozak' ? 'ok' : ''}" onclick={() => qcTab = 'kozak'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabQcKozak()}</button>
    <button class="pix-btn {qcTab === 'ptc' ? 'ok' : ''}" onclick={() => qcTab = 'ptc'} style="flex: 0.8; padding: 2px; font-size: 8px;">{m.tabQcPtc()}</button>
    <button class="pix-btn {qcTab === 'cpb' ? 'ok' : ''}" onclick={() => qcTab = 'cpb'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabQcCpb()}</button>
    <button class="pix-btn {qcTab === 'dust' ? 'ok' : ''}" onclick={() => qcTab = 'dust'} style="flex: 0.8; padding: 2px; font-size: 8px;">DUST</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
    <!-- TAB 1: SPLICE & POLYA -->
    {#if qcTab === 'splice_polyA'}
      {@const splices = detectCrypticSpliceSites(dnaSeq)}
      {@const polyas = detectCrypticPolyASignals(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.sgqSplicePolyATitle()}</div>
        
        <div style="background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <div style="font-weight: bold; color: var(--pix-accent-2);">{m.sgqSpliceSection()}</div>
          <div style="max-height: 55px; overflow-y: auto; margin-top: 2px;">
            {#each splices as s}
              <div style="font-size: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <span style="color: var(--pix-red);">Intron {s.type === 'donor' ? m.sgqGtDonor() : m.sgqAgAcceptor()} (pos {s.position + 1})</span>
                <span class="mono" style="color: var(--pix-cyan);">{s.sequence}</span>
                <span>{m.sgqConfidenceScore({ v1: s.score })}</span>
              </div>
            {:else}
              <div style="color: var(--pix-green); font-size: 8px;">✓ {m.sgqNoSpliceFound()}</div>
            {/each}
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <div style="font-weight: bold; color: var(--pix-accent-2);">{m.sgqPolyASection()}</div>
          <div style="max-height: 55px; overflow-y: auto; margin-top: 2px;">
            {#each polyas as p}
              <div style="font-size: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <span style="color: var(--pix-red);">{m.sgqSignalLabel({ v1: p.signal })}</span>
                <span class="pix-num">{m.sgqPositionBp({ v1: p.position + 1 })}</span>
              </div>
            {:else}
              <div style="color: var(--pix-green); font-size: 8px;">✓ {m.sgqNoPolyAFound()}</div>
            {/each}
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <button class="pix-btn ok" disabled={splices.length === 0} onclick={() => {
            const res = eliminateCrypticSpliceSites(dnaSeq);
            dnaSeq = res.modifiedSequence;
            res.log.forEach(pushLog);
            pushToast('success', m.sgqSpliceFixTitle(), m.sgqSpliceFixBody({ v1: res.mutationsCount }));
          }} style="padding: 3px; font-size: 9px; font-weight: bold;">{m.sgqSpliceFixBtn()}</button>

          <button class="pix-btn ok" disabled={polyas.length === 0} onclick={() => {
            const res = eliminateCrypticPolyASignals(dnaSeq);
            dnaSeq = res.modifiedSequence;
            res.log.forEach(pushLog);
            pushToast('success', m.sgqPolyAFixTitle(), m.sgqPolyAFixBody({ v1: res.mutationsCount }));
          }} style="padding: 3px; font-size: 9px; font-weight: bold;">{m.sgqPolyAFixBtn()}</button>
        </div>
      </div>

    <!-- TAB 2: KOZAK CONSENSUS -->
    {:else if qcTab === 'kozak'}
      {@const firstCds = geneFeatures.find((f: any) => f.type?.toLowerCase() === 'cds')}
      {@const startIdx = firstCds ? firstCds.start - 1 : (dnaSeq.toUpperCase().indexOf('ATG') >= 0 ? dnaSeq.toUpperCase().indexOf('ATG') : 0)}
      {@const kozak = analyzeKozak(dnaSeq, startIdx)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.sgqKozakTitle()}</div>
        
        <div style="background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px; display: flex; flex-direction: column; gap: 3px;">
          <div style="display: flex; justify-content: space-between;">
            <span>{m.sgqKozakContext()}</span>
            <span class="mono" style="font-weight: bold;">{kozak.upstreamSeq} <span style="color: var(--pix-green);">{kozak.startCodon}</span> {kozak.downstreamSeq}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.sgqKozakRating()}</span>
            <span style="font-weight: bold; color: {kozak.strength === 'Strong' ? 'var(--pix-green)' : kozak.strength === 'Adequate' ? 'var(--pix-cyan)' : 'var(--pix-red)'}">{kozak.strength} {m.sgqScorePoints({ v1: kozak.score })}</span>
          </div>
        </div>

        <div class="pix-panel" style="padding: 5px; border-color: var(--pix-border); background: rgba(0,0,0,0.2); max-height: 80px; overflow-y: auto;">
          <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 8.5px; margin-bottom: 2px;">{m.sgqRecommendations()}</div>
          {#each kozak.recommendations as rec}
            <div style="font-size: 7.5px; border-bottom: 1px solid rgba(255,255,255,0.03); padding: 1px 0; line-height: 1.25;">{rec}</div>
          {:else}
            <div style="font-size: 7.5px; color: var(--pix-green);">✓ {m.sgqKozakPerfect()}</div>
          {/each}
        </div>

        <button class="pix-btn ok" disabled={kozak.strength === 'Strong'} onclick={() => {
          const res = optimizeKozak(dnaSeq, startIdx);
          dnaSeq = res.optimizedSequence;
          res.log.forEach(pushLog);
          pushToast('success', m.sgqKozakOptDone(), m.sgqKozakOptBody({ v1: startIdx + 1 }));
        }} style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%; margin-top: 2px;">{m.sgqKozakOptBtn()}</button>
      </div>

    <!-- TAB 3: PTC / PREMATURE STOP CODON -->
    {:else if qcTab === 'ptc'}
      {@const ptc = detectPrematureStopCodons(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.sgqPtcTitle()}</div>
        
        <div style="background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px; max-height: 140px; overflow-y: auto;">
          {#each ptc.stops as s}
            <div class="pix-panel" style="padding: 4px; border-color: var(--pix-red); background: rgba(255,0,0,0.03); margin-bottom: 3px;">
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-red); font-size: 9px;">
                <span>{m.sgqPtcLabel()}</span>
                <span class="mono">[{s.codon}]</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 8px; margin-top: 2px; color: var(--pix-fg-dim);">
                <span>{m.sgqPtcPosition({ v1: s.position + 1, v2: s.aaPosition })}</span>
                <span style="color: {s.triggerNmd ? 'var(--pix-red)' : 'var(--pix-cyan)'}">{s.triggerNmd ? m.sgqNmdHighRisk() : m.sgqNmdLowRisk()}</span>
              </div>
            </div>
          {:else}
            <div style="color: var(--pix-green); font-size: 9.5px; text-align: center; padding: 25px 0;">
              ✓ {m.sgqNoPtcFound()}
            </div>
          {/each}
        </div>
      </div>

    <!-- TAB 4: CODON PAIR BIAS (CPB) -->
    {:else if qcTab === 'cpb'}
      {@const cpbVal = calculateCpbScore(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.sgqCpbTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>{m.sgqCpbValueLabel()}</span>
            <span class="pix-num" style="font-size: 12px; font-weight: bold; color: {cpbVal >= 0.1 ? 'var(--pix-green)' : cpbVal >= 0 ? 'var(--pix-cyan)' : 'var(--pix-red)'}">{cpbVal}</span>
          </div>
          <div style="font-size: 7.5px; color: var(--pix-fg-dim); line-height: 1.25;">
            {m.sgqCpbExplain()}
          </div>
        </div>

        <button class="pix-btn ok" disabled={cpbVal >= 0.18} onclick={() => {
          const res = optimizeCodonPairs(dnaSeq);
          dnaSeq = res.optimizedSequence;
          res.log.forEach(pushLog);
          pushToast('success', m.sgqCpbOptDone(), m.sgqCpbOptBody({ v1: res.optimizedCpb }));
        }} style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%; margin-top: 4px;">{m.sgqCpbOptBtn()}</button>
      </div>

    <!-- TAB 5: LOW COMPLEXITY DUST -->
    {:else if qcTab === 'dust'}
      {@const dust = detectLowComplexityRegions(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.sgqDustTitle()}</div>
        
        <div style="max-height: 125px; overflow-y: auto; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          {#each dust as r}
            <div style="font-size: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03); padding: 2px 0;">
              <span style="color: var(--pix-accent-2); font-weight: bold;">[{r.type.toUpperCase()}] pos {r.start + 1}-{r.end + 1} bp</span>
              <span class="mono" style="color: var(--pix-cyan); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={r.sequence}>{r.sequence}</span>
              <span class="pix-num">{m.sgqEntropy({ v1: r.entropy })}</span>
            </div>
          {:else}
            <div style="color: var(--pix-green); font-size: 8.5px; text-align: center; padding: 20px 0;">✓ {m.sgqNoDustFound()}</div>
          {/each}
        </div>

        <button class="pix-btn ok" disabled={dust.length === 0} onclick={() => {
          const res = maskLowComplexityRegions(dnaSeq);
          dnaSeq = res.maskedSequence;
          pushToast('success', m.sgqDustMaskTitle(), m.sgqDustMaskBody({ v1: res.regions.length }));
          pushLog(m.sgqDustMaskLog({ v1: res.regions.length }));
        }} style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%;">{m.sgqDustMaskBtn()}</button>
      </div>
    {/if}
  </div>
</div>
