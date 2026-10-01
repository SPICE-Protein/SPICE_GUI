<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import { backend } from '$lib/backend/api';
  import { autoIdentifyAndRemoveAdapters, detectCrisprArrays } from '$lib/genome';

  let {
    showNgsGenomicsPanel = $bindable(false),
    drag,
    dnaSeq,
    pushLog,
    pushToast
  } = $props<{
    showNgsGenomicsPanel: boolean;
    drag: any;
    dnaSeq: string;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let ngsTab = $state<'fastq_qc' | 'trimmer' | 'orf_gene' | 'crispr'>('fastq_qc');
  let fastqInputText = $state(`@SEQ_ID\nGATCGGAAGAGCACACGTCTGAACTCCAGTCAC\n+\n!''*((((***+))%%%++)(%%%%).1***-\n@SEQ_ID2\nAGATCGGAAGAGCACACGTCTGAACTCCAGTCA\n+\nI!IIIIIIIIIIIIIIIIIIIIIIIIIIIIIII`);
  let trimmerAdapterInput = $state('');

  // Reactively compute FASTQ QC using rust-bio backend (with TS fallback)
  let fastqReport = $state<any>(null);
  let isFastqLoading = $state(false);

  $effect(() => {
    const text = fastqInputText;
    isFastqLoading = true;
    backend.analyzeFastqQualityRust(text).then(r => {
      fastqReport = r.data;
      isFastqLoading = false;
    });
  });

  // Reactively compute high-performance ORFs using rust-bio seq_analysis::orf Finder (with TS fallback)
  let predictedOrfs = $state<any[]>([]);
  let isOrfLoading = $state(false);

  $effect(() => {
    const seq = dnaSeq;
    isOrfLoading = true;
    
    backend.findOrfsRust(seq, 90).then(r => {
      predictedOrfs = r.data.map((o: any, idx: number) => {
        const startPos = o.start;
        const upstreamStart = Math.max(0, startPos - 18);
        const upstreamSeq = seq.slice(upstreamStart, startPos).toUpperCase();
        
        let hasRbsMatch = false;
        let rbsBonus = 0;
        if (upstreamSeq.includes("AGGAGG") || upstreamSeq.includes("GGAGG") || upstreamSeq.includes("GAGG")) {
          hasRbsMatch = true;
          rbsBonus = 35;
        } else if (upstreamSeq.includes("GGAG") || upstreamSeq.includes("AGGA")) {
          hasRbsMatch = true;
          rbsBonus = 20;
        }

        const score = Math.min(99, 45 + rbsBonus + Math.min(45, (o.length / 300) * 10));

        return {
          id: idx + 1,
          start: o.start,
          end: o.end,
          strand: o.strand,
          startCodon: o.startCodon || 'ATG',
          stopCodon: o.stopCodon || 'TAA',
          hasRbsMatch,
          score: Math.round(score)
        };
      });
      isOrfLoading = false;
    }).catch(err => {
      console.error(err);
      isOrfLoading = false;
    });
  });
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 120px; width: 335px; z-index: 60; max-height: 485px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.ngsGenomicsEngine()}</span>
    <button class="pix-btn-reset" onpointerdown={(e) => e.stopPropagation()} onclick={() => showNgsGenomicsPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: flex; gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {ngsTab === 'fastq_qc' ? 'ok' : ''}" onclick={() => ngsTab = 'fastq_qc'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabNgsQc()}</button>
    <button class="pix-btn {ngsTab === 'trimmer' ? 'ok' : ''}" onclick={() => ngsTab = 'trimmer'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabNgsTrimmer()}</button>
    <button class="pix-btn {ngsTab === 'orf_gene' ? 'ok' : ''}" onclick={() => ngsTab = 'orf_gene'} style="flex: 1.2; padding: 2px; font-size: 8px;">{m.tabNgsOrf()}</button>
    <button class="pix-btn {ngsTab === 'crispr' ? 'ok' : ''}" onclick={() => ngsTab = 'crispr'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabNgsCrispr()}</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 5px; padding-right: 2px;">
    <!-- TAB 1: FASTQ QC -->
    {#if ngsTab === 'fastq_qc' && fastqReport}
      <div style="display: flex; flex-direction: column; gap: 4px; position: relative;">
        {#if isFastqLoading}
          <div style="position: absolute; right: 5px; top: 2px; font-size: 8px; color: var(--pix-cyan); font-weight: bold;">{m.ngsRustComputing()}</div>
        {/if}
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.ngsFastqcTitle()}</div>
        <textarea class="pix-input mono" bind:value={fastqInputText} placeholder={m.ngsFastqPlaceholder()} rows={4} style="font-size: 8px; line-height: 1.25; resize: vertical;"></textarea>
        
        <div class="pix-panel" style="padding: 5px; border-color: var(--pix-border); background: rgba(0,0,0,0.25); line-height: 1.4; display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; justify-content: space-between;">
            <span>{m.ngsTotalReadsLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green);">{m.ngsReadsCount({ v1: fastqReport.totalReads })}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.ngsAvgReadLengthLabel()}</span>
            <span class="pix-num">{fastqReport.averageReadLength} bp</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.ngsAvgGcLabel()}</span>
            <span class="pix-num" style="color: var(--pix-cyan);">{fastqReport.gcContentPercent}%</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.ngsDuplicateRatioLabel()}</span>
            <span class="pix-num" style="color: {fastqReport.duplicateReadsPercent > 20 ? 'var(--pix-red)' : 'var(--pix-green)'};">{fastqReport.duplicateReadsPercent}%</span>
          </div>
        </div>
      </div>

    <!-- TAB 2: TRIMMER -->
    {:else if ngsTab === 'trimmer'}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.ngsAdapterTitle()}</div>
        <label style="display: flex; flex-direction: column; gap: 1px;">
          <span class="pix-dim">{m.ngsAdapterSeqLabel()}</span>
          <input class="pix-input mono" type="text" bind:value={trimmerAdapterInput} placeholder={m.ngsAdapterPlaceholder()} style="font-size: 9px; height: 18px;" />
        </label>

        <button class="pix-btn ok" onclick={() => {
          const lines = fastqInputText.split('\n');
          const reads: string[] = [];
          const quals: string[] = [];
          for (let i = 0; i < lines.length - 3; i += 4) {
            if (lines[i].startsWith('@') && lines[i+2].startsWith('+')) {
              reads.push(lines[i+1]);
              quals.push(lines[i+3]);
            }
          }
          const res = autoIdentifyAndRemoveAdapters(reads, quals, trimmerAdapterInput || undefined);
          res.log.forEach(pushLog);
          pushToast('success', m.ngsTrimSuccessTitle(), m.ngsTrimSuccessDesc({ v1: res.trimmedCount }));
        }} style="padding: 3px; font-weight: bold; font-size: 9.5px; margin-top: 3px;">✂️ {m.ngsTrimButton()}</button>
      </div>

    <!-- TAB 3: PROKARYOTIC GENE PREDICTOR -->
    {:else if ngsTab === 'orf_gene'}
      <div style="display: flex; flex-direction: column; gap: 4px; position: relative;">
        {#if isOrfLoading}
          <div style="position: absolute; right: 5px; top: 2px; font-size: 8px; color: var(--pix-cyan); font-weight: bold;">{m.ngsRustFindingGenes()}</div>
        {/if}
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.ngsOrfTitle()}</div>
        <div style="max-height: 160px; overflow-y: auto; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px; display: flex; flex-direction: column; gap: 3px;">
          {#each predictedOrfs as g}
            <div class="pix-panel" style="padding: 4px; border-color: var(--pix-border); background: rgba(76,214,255,0.03);">
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-accent-2); font-size: 8.5px;">
                <span>🧬 Gene ID: {g.id}</span>
                <span class="pix-num">{m.range()} {g.start + 1}-{g.end + 1} bp ({g.strand})</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 7.5px; color: var(--pix-fg-dim); margin-top: 2px;">
                <span>{m.ngsStartStopCodons({ v1: g.startCodon, v2: g.stopCodon })}</span>
                <span style="color: {g.hasRbsMatch ? 'var(--pix-green)' : 'var(--pix-fg-dim)'}">{g.hasRbsMatch ? '✓ ' + m.ngsRbsMatched() : m.ngsRbsNone()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 7.5px; font-weight: bold; margin-top: 2px;">
                <span>{m.ngsConfidenceScoreLabel()}</span>
                <span class="pix-num" style="color: var(--pix-cyan);">{g.score} / 100</span>
              </div>
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 20px 0;">{m.ngsNoOrfFound()}</div>
          {/each}
        </div>
      </div>

    <!-- TAB 4: CRISPR ARRAY FINDER -->
    {:else if ngsTab === 'crispr'}
      {@const crisprs = detectCrisprArrays(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.ngsCrisprTitle()}</div>
        <div style="max-height: 160px; overflow-y: auto; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px; display: flex; flex-direction: column; gap: 3px;">
          {#each crisprs as c}
            <div class="pix-panel" style="padding: 5px; border-color: var(--pix-green); background: rgba(0,255,100,0.03);">
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-green); font-size: 8.5px;">
                <span>🦠 CRISPR Array (Repeats: {c.repeatCount})</span>
                <span class="pix-num">{m.range()} {c.start + 1}-{c.end + 1} bp</span>
              </div>
              <div class="mono" style="font-size: 7.5px; color: var(--pix-cyan); word-break: break-all; margin-top: 2px;">
                DR Consensus: {c.repeatConsensus}
              </div>
              <div style="font-size: 7.5px; color: var(--pix-fg-dim); margin-top: 2px;">
                {m.ngsSpacerCount({ v1: c.spacers.length })}
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 7.5px; font-weight: bold; margin-top: 2px;">
                <span>{m.ngsArrayConservationLabel()}</span>
                <span class="pix-num" style="color: var(--pix-green);">{c.confidence}%</span>
              </div>
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 25px 0;">{m.ngsNoCrisprFound()}</div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
