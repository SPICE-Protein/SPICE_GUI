<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { 
    simulatePCR, 
    simulateOverlapExtensionPCR, 
    simulateSiteDirectedMutagenesis 
  } from '$lib/genome';

  let {
    showPcrPanel = $bindable(false),
    drag,
    dnaSeq = $bindable(),
    linear,
    gelLanes = $bindable(),
    showVirtualGel = $bindable(false),
    pushLog,
    pushToast,
    pushHistory
  } = $props<{
    showPcrPanel: boolean;
    drag: any;
    dnaSeq: string;
    linear: boolean;
    gelLanes: any[];
    showVirtualGel: boolean;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
    pushHistory: (desc: string, actionType: any) => void;
  }>();

  let pcrMode = $state<'standard' | 'overlap' | 'mutagenesis'>('standard');
  let pcrFwd = $state('');
  let pcrRev = $state('');
  let pcrResult = $state<any>(null);
  let mutagenesisPos = $state(0);
  let mutagenesisBase = $state('A');

  function sendPcrToGel() {
    if (!pcrResult || !pcrResult.productLength) return;
    const idx = gelLanes.length + 1;
    gelLanes = [...gelLanes, {
      id: `pcr_lane_${Date.now()}`,
      name: `PCR Prod ${idx}`,
      bands: [pcrResult.productLength],
      color: '#4cd6ff'
    }];
    showVirtualGel = true;
    pushLog(m.pcrGelLaneLog({ productLength: pcrResult.productLength, idx }));
    pushToast('success', m.pcrAddedToGelLane(), m.pcrLaneInfo({ idx, productLength: pcrResult.productLength }));
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 350px; width: 360px; z-index: 60;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;">{m.pcrSimulation()}</span>
    <button class="pix-btn-reset" onclick={() => showPcrPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>
  <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
    <div style="display: flex; gap: 4px;">
      <button class="pix-btn {pcrMode === 'standard' ? 'ok' : ''}" onclick={() => pcrMode = 'standard'} style="padding: 2px 6px; font-size: 9px;">{m.pcrStandardBtn()}</button>
      <button class="pix-btn {pcrMode === 'overlap' ? 'ok' : ''}" onclick={() => pcrMode = 'overlap'} style="padding: 2px 6px; font-size: 9px;">{m.pcrOverlapExtBtn()}</button>
      <button class="pix-btn {pcrMode === 'mutagenesis' ? 'ok' : ''}" onclick={() => pcrMode = 'mutagenesis'} style="padding: 2px 6px; font-size: 9px;">{m.pcrMutagenesisModeBtn()}</button>
    </div>

    {#if pcrMode === 'standard'}
      <div style="display: flex; gap: 4px; align-items: center;">
        <span class="pix-dim">Fwd (5'->3'):</span>
        <input class="pix-input mono" bind:value={pcrFwd} placeholder={m.primerSequence53()} style="padding: 2px 4px; font-size: 9px; font-family: monospace;" />
      </div>
      <div style="display: flex; gap: 4px; align-items: center;">
        <span class="pix-dim">Rev (5'->3'):</span>
        <input class="pix-input mono" bind:value={pcrRev} placeholder={m.primerSequence53()} style="padding: 2px 4px; font-size: 9px; font-family: monospace;" />
      </div>
      <button class="pix-btn ok" onclick={() => {
        if (pcrFwd && pcrRev) {
          pcrResult = simulatePCR(dnaSeq, pcrFwd, pcrRev, { circular: !linear });
          if (pcrResult.product) {
            pushLog(m.pcrProductSuccessLog({ productLength: pcrResult.productLength, toFixed: pcrResult.meltingTemp.toFixed(1), arg0: pcrResult.gcContent.toFixed(1) }));
            pushToast('success', m.pcrAmplificationSuccess(), m.pcrSuccessDetails({ productLength: pcrResult.productLength, tm: pcrResult.meltingTemp.toFixed(1) }));
          } else {
            pushLog(m.pcrProductFailLog({ join: pcrResult.warnings.join('; ') }));
            pushToast('error', m.pcrAmplificationFailed(), pcrResult.warnings.join('; ') || m.pcrNoPrimerBindingSite());
          }
        } else {
          pushToast('error', m.pcrFailed(), m.pcrEnterCompletePrimers());
        }
      }} style="padding: 3px; font-size: 10px;">{m.pcrRunBtn()}</button>
    {:else if pcrMode === 'overlap'}
      <div class="pix-dim" style="font-size: 9px;">{m.pcrOverlapExtDesc()}</div>
      <button class="pix-btn ok" onclick={() => {
        pcrResult = simulateOverlapExtensionPCR([{ seq: dnaSeq.slice(0, Math.floor(dnaSeq.length/2)), name: 'Frag1' }, { seq: dnaSeq.slice(Math.floor(dnaSeq.length/2)), name: 'Frag2' }], 20);
        if (pcrResult && pcrResult.product) {
          pushLog(m.pcrOverlapExtSuccessLog({ productLength: pcrResult.productLength, length: pcrResult.warnings.length }));
          pushToast('success', m.pcrOverlapExtSuccess(), m.pcrOverlapExtProductLength({ productLength: pcrResult.productLength }));
        } else {
          pushLog(m.pcrOverlapExtFailLog());
          pushToast('error', m.pcrOverlapExtFailed(), m.pcrOverlapExtNoHomology());
        }
      }} style="padding: 3px; font-size: 10px;">{m.pcrRunOeBtn()}</button>
    {:else if pcrMode === 'mutagenesis'}
      <div style="display: flex; gap: 4px; align-items: center;">
        <span class="pix-dim">{m.pcrPosition()}</span>
        <input class="pix-input" type="number" bind:value={mutagenesisPos} style="width: 50px; padding: 2px; font-size: 9px;" />
        <span class="pix-dim">{m.pcrBase()}</span>
        <input class="pix-input" type="text" bind:value={mutagenesisBase} style="width: 30px; padding: 2px; font-size: 9px; text-transform: uppercase;" />
      </div>
      <button class="pix-btn ok" onclick={() => {
        if (mutagenesisPos === null || !mutagenesisBase) {
          pushToast('error', m.pcrMutagenesisFailed(), m.pcrMutagenesisInvalidParams());
          return;
        }
        pcrResult = simulateSiteDirectedMutagenesis(dnaSeq, { position: mutagenesisPos, newBase: mutagenesisBase.toUpperCase() });
        if (pcrResult && pcrResult.mutatedSequence) {
          pushLog(m.pcrMutagenesisSuccessLog({ mutagenesisPos: mutagenesisPos, mutagenesisBase: mutagenesisBase, length: pcrResult.mutatedSequence.length }));
          pushToast('success', m.pcrMutagenesisSuccess(), m.pcrMutagenesisProductLength({ length: pcrResult.mutatedSequence.length }));
        } else {
          pushLog(m.pcrMutagenesisFailLog());
          pushToast('error', m.pcrMutagenesisFailed(), m.pcrMutagenesisOutOfRange());
        }
      }} style="padding: 3px; font-size: 10px;">{m.pcrMutagenesisBtn()}</button>
    {/if}

    {#if pcrResult}
      <div class="pix-panel" style="padding: 4px; border-color: var(--pix-green);">
        {#if pcrMode === 'mutagenesis'}
          <button class="pix-btn ok" onclick={() => {
            if (pcrResult.mutatedSequence) {
              pushHistory('Site-directed mutagenesis', 'edit');
              dnaSeq = pcrResult.mutatedSequence;
              pushLog(m.pcrMutagenesisAppliedLog());
              pushToast('success', m.pcrMutagenesisAppliedToast(), m.pcrMutagenesisAppliedDetails({ pos: mutagenesisPos, base: mutagenesisBase }));
            }
          }} style="padding: 2px; font-size: 9px; margin-top: 3px;">{m.pcrApplyMutation()}</button>
        {:else}
          <div style="display: flex; justify-content: space-between;">
            <span class="pix-dim">{m.pcrProductLength()}</span>
            <span class="pix-num">{pcrResult.productLength} bp</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="pix-dim">{m.pcrProductTm()}</span>
            <span class="pix-num">{pcrResult.meltingTemp?.toFixed(1)}°C</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="pix-dim">{m.pcrProductGc()}</span>
            <span class="pix-num">{pcrResult.gcContent?.toFixed(1)}%</span>
          </div>
          {#if pcrResult.warnings?.length > 0}
            <div style="font-size: 8px; color: var(--pix-accent); margin-top: 2px;">{pcrResult.warnings.join('; ')}</div>
          {/if}
          {#if pcrResult.product}
            <div style="display: flex; gap: 4px; margin-top: 3px;">
              <button class="pix-btn ok" onclick={() => {
                if (pcrResult.product) {
                  pushHistory('PCR product applied', 'edit');
                  dnaSeq = pcrResult.product;
                  pushLog(m.pcrProductAppliedLog());
                  pushToast('success', m.pcrProductAppliedToast(), `${pcrResult.productLength} bp`);
                }
              }} style="padding: 2px; font-size: 9px; flex: 1;">{m.pcrApplyProduct()}</button>
              <button class="pix-btn ok" onclick={sendPcrToGel} style="padding: 2px; font-size: 9px; flex: 1; background: var(--pix-blue);">{m.pcrSendToGel()}</button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>
