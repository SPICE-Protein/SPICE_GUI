<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { Dna } from 'lucide-svelte';
  import { simulateRibosomalSlippage } from '$lib/genome';

  let {
    showSlippagePanel = $bindable(false),
    drag,
    dnaSeq,
    plasmidName,
    geneFeatures = $bindable([]),
    pushLog,
    pushToast
  } = $props<{
    showSlippagePanel: boolean;
    drag: any;
    dnaSeq: string;
    plasmidName: string;
    geneFeatures: any[];
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let slippageStartPos = $state(1);
  let slippageSitePattern = $state('TTTAAAC');
  let slippageShift = $state(-1);
  let slippageResult = $state<any>(null);

  function runSlippageTranslation() {
    try {
      slippageResult = simulateRibosomalSlippage(dnaSeq, {
        startPosition: slippageStartPos,
        slipperySite: slippageSitePattern,
        shift: slippageShift
      });
      pushLog(m.riboLogSimSuccess({ v1: slippageResult.slipperySitePosition, v2: slippageResult.slipperySiteSequence, v3: `${slippageShift > 0 ? '+' : ''}${slippageShift}`, v4: slippageResult.fullProtein.length }));
      pushToast('success', m.riboSimSuccessTitle(), m.riboFullProteinAa({ length: slippageResult.fullProtein.length }));
    } catch (e: any) {
      pushLog(m.riboLogSimFail({ v1: e.message }));
      pushToast('error', m.riboSimFailTitle(), e.message);
    }
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 360px; top: 180px; width: 340px; z-index: 60;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Dna size={12} /> {m.ribosomalSlippage()}</span>
    <button class="pix-btn-reset" onclick={() => showSlippagePanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>
  <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
    
    <!-- Preset dropdown -->
    <div style="display: flex; gap: 4px; align-items: center;">
      <span class="pix-dim" style="width: 70px;">{m.riboTemplateLabel()}</span>
      <select class="pix-select" style="flex: 1; padding: 1px 4px; font-size: 9px; height: 18px;" onchange={(e) => {
        const val = e.currentTarget.value;
        if (val === 'sarscov2') {
          slippageSitePattern = 'TTTAAAC';
          slippageShift = -1;
          slippageStartPos = 1;
        } else if (val === 'hiv1') {
          slippageSitePattern = 'TTTTTTA';
          slippageShift = -1;
          slippageStartPos = 1;
        } else if (val === 'ecoli_prfb') {
          slippageSitePattern = 'CTTTG';
          slippageShift = 1;
          slippageStartPos = 1;
        }
      }}>
        <option value="sarscov2">SARS-CoV-2 ORF1ab (-1 PRF)</option>
        <option value="hiv1">HIV-1 Gag-Pol (-1 PRF)</option>
        <option value="ecoli_prfb">E. coli Release Factor 2 (+1 PRF)</option>
      </select>
    </div>

    <div style="display: flex; gap: 8px;">
      <div style="flex: 1;">
        <span class="pix-dim" style="font-size: 9px;">{m.riboStartLabel()}</span>
        <input class="pix-input" type="number" bind:value={slippageStartPos} style="width: 100%; padding: 2px 4px; font-size: 9px;" />
      </div>
      <div style="flex: 1;">
        <span class="pix-dim" style="font-size: 9px;">{m.riboSiteLabel()}</span>
        <input class="pix-input" type="text" bind:value={slippageSitePattern} placeholder="e.g. TTTAAAC" style="width: 100%; padding: 2px 4px; font-size: 9px; font-family: monospace;" />
      </div>
    </div>

    <div style="display: flex; gap: 8px; align-items: center;">
      <span class="pix-dim" style="width: 70px;">{m.riboShiftLabel()}</span>
      <select class="pix-select" bind:value={slippageShift} style="flex: 1; padding: 1px 4px; font-size: 9px; height: 18px;">
        <option value={-1}>{m.riboShiftM1()}</option>
        <option value={1}>{m.riboShiftP1()}</option>
        <option value={-2}>{m.riboShiftM2()}</option>
        <option value={2}>{m.riboShiftP2()}</option>
      </select>
    </div>

    <button class="pix-btn ok" onclick={runSlippageTranslation} style="padding: 3px; font-size: 10px;">{m.riboRunBtn()}</button>

    {#if slippageResult}
      <div class="pix-panel" style="padding: 4px; border-color: var(--pix-green);">
        <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.riboSlipPointLabel()}</span><span class="pix-num" style="color: var(--pix-green);">{slippageResult.slipperySiteSequence} (bp {slippageResult.slipperySitePosition})</span></div>
        <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.riboPrePeptideLabel()}</span><span class="pix-num">{slippageResult.preSlippageProtein.length} aa</span></div>
        <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.riboPostPeptideLabel()}</span><span class="pix-num">{slippageResult.postSlippageProtein.length} aa</span></div>
        <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.riboTotalFusionLabel()}</span><span class="pix-num" style="color: var(--pix-cyan); font-weight: bold;">{slippageResult.fullProtein.length} aa</span></div>
        
        <div class="mono" style="font-size: 7.5px; color: var(--pix-cyan); word-break: break-all; background: #040508; padding: 4px; border-radius: 3px; margin-top: 4px; white-space: pre; line-height: 1.25; overflow-x: auto;">{slippageResult.visualAlignment}</div>
        
        <div style="display: flex; gap: 4px; margin-top: 4px;">
          <button class="pix-btn ok" onclick={() => {
            const text = `Slippage Translation Report\nTemplate: ${plasmidName}\nSlippery Site: ${slippageResult.slipperySiteSequence} at bp ${slippageResult.slipperySitePosition}\nFull Fusion Protein (${slippageResult.fullProtein.length} aa):\n${slippageResult.fullProtein}`;
            navigator.clipboard.writeText(text);
            pushToast('success', m.copySuccess(), m.riboCopiedDesc());
          }} style="padding: 2px; font-size: 8.5px; flex: 1;">{m.riboCopyBtn()}</button>
          <button class="pix-btn" onclick={() => {
            const start = slippageResult.slipperySitePosition;
            const end = dnaSeq.length;
            const newId = Math.max(0, ...geneFeatures.map((f: any) => f.id)) + 1;
            geneFeatures = [...geneFeatures, {
              id: newId,
              name: `PRF Fusion (${slippageResult.slipperySiteSequence})`,
              start,
              end,
              type: 'CDS',
              color: '#ff5df6',
              forward: true
            }];
            pushLog(m.riboLogCdsCreated({ v1: start, v2: end }));
            pushToast('success', m.createSuccess(), m.riboCdsCreatedDesc());
          }} style="padding: 2px; font-size: 8.5px; flex: 1; color: var(--pix-green);">{m.riboGenFeatureBtn()}</button>
        </div>
      </div>
    {/if}
  </div>
</div>
