<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js'; 

  import { Sparkles, Scan, ChevronDown, Check, AlertTriangle, HelpCircle, ArrowRight, RefreshCw, Copy, Layers } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { findGrnaCandidates, designHdrDonor, designPegRna, type GrnaCandidate, type CasType, PAM_DATABASE } from '$lib/genome/crispr';

  let {
    dnaSeq = $bindable(''),
    onApplyLog = (msg: string) => {}
  } = $props<{
    dnaSeq: string;
    onApplyLog: (msg: string) => void;
  }>();

  // Selected Cas Endonuclease
  let selectedCas = $state<CasType>('SpCas9');

  // gRNA scanner state
  let gRnas = $state<GrnaCandidate[]>([]);
  let selectedGrnaIdx = $state<number>(0);
  let showScanResults = $state(false);

  // Sub-workflows
  let activeTab = $state<'hdr' | 'prime' | 'base'>('hdr');

  // HDR Design inputs
  let insertSeq = $state('ATGGTGTCTAAGGGCGAA'); // GFP starter tag
  let homologyArmLen = $state(50);
  let hdrResult = $state<any>(null);

  // Prime Editing inputs
  let pbsLength = $state(13);
  let rttLength = $state(16);
  let editStartIndex = $state(0);
  let editSequence = $state('T');
  let pegRnaResult = $state<any>(null);

  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      const savedConfig = localStorage.getItem('spice_crispr_designer_config');
      if (savedConfig) {
        try {
          const config = JSON.parse(savedConfig);
          if (config.selectedCas !== undefined) selectedCas = config.selectedCas;
          if (config.insertSeq !== undefined) insertSeq = config.insertSeq;
          if (config.homologyArmLen !== undefined) homologyArmLen = config.homologyArmLen;
          if (config.pbsLength !== undefined) pbsLength = config.pbsLength;
          if (config.rttLength !== undefined) rttLength = config.rttLength;
          if (config.editStartIndex !== undefined) editStartIndex = config.editStartIndex;
          if (config.editSequence !== undefined) editSequence = config.editSequence;
          if (config.activeTab !== undefined) activeTab = config.activeTab;
        } catch (e) {
          console.error("Error loading persisted CRISPR config:", e);
        }
      }
    }
  });

  // Save CRISPR configuration on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      const config = {
        selectedCas,
        insertSeq,
        homologyArmLen,
        pbsLength,
        rttLength,
        editStartIndex,
        editSequence,
        activeTab
      };
      localStorage.setItem('spice_crispr_designer_config', JSON.stringify(config));
    }
  });

  // Derived selected gRNA
  const selectedGrna = $derived(gRnas[selectedGrnaIdx] || null);

  // Scan sequence for gRNA
  function runCrisprScan() {
    if (!dnaSeq || dnaSeq.length < 30) {
      pushToast('error', m.crisprScanFailed(), m.crisprDnaTooShort());
      return;
    }
    // We scan using our newly-created engine
    const candidates = findGrnaCandidates(dnaSeq, selectedCas, dnaSeq); // Pass self as mock genome for self-target/off-target scoring
    gRnas = candidates;
    selectedGrnaIdx = 0;
    showScanResults = true;
    
    // Automatically trigger updates for tools
    updateHdrDonor();
    updatePegRna();

    pushToast('success', m.crisprScanComplete(), m.crisprScanSuccessDetails({ cas: selectedCas, count: candidates.length }));
    onApplyLog(m.crisprScanLog({ count: candidates.length, cas: selectedCas }));
  }

  // Design HDR Donor
  function updateHdrDonor() {
    if (!selectedGrna) return;
    try {
      const res = designHdrDonor({
        template: dnaSeq,
        cutIndex: selectedGrna.cutIndex,
        insertSequence: insertSeq,
        homologyArmLength: homologyArmLen,
        gRNA: selectedGrna
      });
      hdrResult = res;
    } catch (e: any) {
      hdrResult = null;
    }
  }

  // Design Prime Editing pegRNA
  function updatePegRna() {
    if (!selectedGrna) return;
    try {
      const res = designPegRna({
        template: dnaSeq,
        gRNA: selectedGrna,
        editStartIndex: selectedGrna.cutIndex + editStartIndex,
        editSequence: editSequence,
        pbsLength,
        rttLength
      });
      pegRnaResult = res;
    } catch (e: any) {
      pegRnaResult = null;
    }
  }

  // React to gRNA choice or inputs changes
  $effect(() => {
    if (selectedGrna) {
      updateHdrDonor();
      updatePegRna();
    }
  });

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    pushToast('success', m.copy(), m.crisprCopiedToClipboard({ label }));
  }
</script>

<div class="crispr-box" style="display: flex; flex-direction: column; gap: 8px; color: var(--pix-fg); font-family: var(--pix-font), monospace;">
  <!-- Header / Cas Selector -->
  <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
      <span class="pix-dim" style="font-size: 11px;">{m.endonucleaseSystem()}</span>
      <select 
        bind:value={selectedCas} 
        style="background: var(--pix-bg-3); border: 2px solid var(--pix-border); color: #fff; padding: 2px 4px; font-size: 10px; cursor: pointer; outline: none;"
      >
        <option value="SpCas9">SpCas9 (NGG, 20nt)</option>
        <option value="SpCas9_VQR">SpCas9-VQR (NGA, 20nt)</option>
        <option value="SaCas9">SaCas9 (NNGRRT, 21nt)</option>
        <option value="Cas12a">Cas12a/Cpf1 (TTTN, 23nt)</option>
      </select>
    </div>

    <button 
      class="pix-btn" 
      onclick={runCrisprScan}
      style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 4px; padding: 5px; font-size: 11px; cursor: pointer;"
    >
      <Scan size={12} /> {m.scanGRNAs()}
    </button>
  </div>

  <!-- Scan Results Table -->
  {#if showScanResults}
    {#if gRnas.length === 0}
      <div style="background: var(--pix-bg-3); border: 1px dashed var(--pix-border); padding: 12px; text-align: center; font-size: 10px; color: var(--pix-red);">
        {m.crisprNoTargetsFound()}
      </div>
    {:else}
      <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px;">
        <span class="pix-dim" style="font-size: 10px; font-weight: bold; color: var(--pix-accent-2);">{m.grnaCandidates()}</span>
        
        <div style="max-height: 120px; overflow-y: auto; border: 1px solid var(--pix-border); background: var(--pix-bg-3);">
          <table style="width: 100%; border-collapse: collapse; font-size: 9px; text-align: left;">
            <thead style="background: var(--pix-bg-2); position: sticky; top: 0; border-bottom: 1px solid var(--pix-border);">
              <tr>
                <th style="padding: 3px;">{m.crisprColId()}</th>
                <th style="padding: 3px;">{m.crisprColSeq()}</th>
                <th style="padding: 3px; text-align: center;">{m.crisprColStrand()}</th>
                <th style="padding: 3px; text-align: right;">{m.crisprColEfficiency()}</th>
                <th style="padding: 3px; text-align: right;">{m.crisprColSpecificity()}</th>
                <th style="padding: 3px; text-align: right;">{m.crisprColScore()}</th>
              </tr>
            </thead>
            <tbody>
              {#each gRnas as grna, idx}
                <tr 
                  class="grna-row {selectedGrnaIdx === idx ? 'selected' : ''}" 
                  onclick={() => selectedGrnaIdx = idx}
                  style="cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); {selectedGrnaIdx === idx ? 'background: rgba(0,255,255,0.15); color: #fff;' : ''}"
                >
                  <td style="padding: 3px; font-weight: bold;">#{idx + 1}</td>
                  <td style="padding: 3px; font-family: monospace; color: var(--pix-green);">{grna.sequence}</td>
                  <td style="padding: 3px; text-align: center;">{grna.strand}</td>
                  <td style="padding: 3px; text-align: right; color: var(--pix-cyan);">{grna.scores.efficiency}</td>
                  <td style="padding: 3px; text-align: right; color: var(--pix-accent);">{grna.scores.specificity}</td>
                  <td style="padding: 3px; text-align: right; font-weight: bold; color: var(--pix-green);">{grna.scores.finalScore}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Selected gRNA Detailed Biophysical Analysis -->
        {#if selectedGrna}
          <div style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
            <div style="display: flex; justify-content: space-between;">
              <span class="pix-dim">{m.crisprSelectedPam()}</span>
              <span style="font-weight: bold; font-family: monospace; color: var(--pix-accent-2);">{selectedGrna.pam} {m.crisprCutPosition({ index: selectedGrna.cutIndex })}</span>
            </div>

            <div style="display: flex; gap: 8px; justify-content: space-between;">
              <span>{m.crisprGcContentLabel()} <span style="font-weight: bold; color: #fff;">{selectedGrna.scores.gcContent}%</span></span>
              <span>{m.crisprPolyTTerminator()} 
                {#if selectedGrna.scores.polyT}
                  <span style="color: var(--pix-red); font-weight: bold;">{m.crisprYesAbnormal()}</span>
                {:else}
                  <span style="color: var(--pix-green);">{m.crisprNoSafe()}</span>
                {/if}
              </span>
              <span>{m.crisprHairpinStructure()} 
                {#if selectedGrna.scores.hairpin}
                  <span style="color: var(--pix-yellow); font-weight: bold;">{m.crisprHasSelfComplementary()}</span>
                {:else}
                  <span style="color: var(--pix-green);">{m.crisprNoSafe()}</span>
                {/if}
              </span>
            </div>
          </div>

          <!-- Tabs -->
          <div style="display: flex; gap: 2px; border-bottom: 1px solid var(--pix-border); margin-bottom: 6px;">
            <button 
              class="pix-btn-reset tab-btn {activeTab === 'hdr' ? 'active' : ''}" 
              onclick={() => activeTab = 'hdr'}
              style="padding: 4px 8px; font-size: 10px; cursor: pointer; border: 1px solid var(--pix-border); border-bottom: none; background: {activeTab === 'hdr' ? 'var(--pix-bg-2)' : 'rgba(0,0,0,0.3)'}; color: {activeTab === 'hdr' ? '#fff' : 'var(--pix-dim)'};"
            >
              {m.crisprTabHdr()}
            </button>
            <button 
              class="pix-btn-reset tab-btn {activeTab === 'prime' ? 'active' : ''}" 
              onclick={() => activeTab = 'prime'}
              style="padding: 4px 8px; font-size: 10px; cursor: pointer; border: 1px solid var(--pix-border); border-bottom: none; background: {activeTab === 'prime' ? 'var(--pix-bg-2)' : 'rgba(0,0,0,0.3)'}; color: {activeTab === 'prime' ? '#fff' : 'var(--pix-dim)'};"
            >
              {m.crisprTabPrime()}
            </button>
            <button 
              class="pix-btn-reset tab-btn {activeTab === 'base' ? 'active' : ''}" 
              onclick={() => activeTab = 'base'}
              style="padding: 4px 8px; font-size: 10px; cursor: pointer; border: 1px solid var(--pix-border); border-bottom: none; background: {activeTab === 'base' ? 'var(--pix-bg-2)' : 'rgba(0,0,0,0.3)'}; color: {activeTab === 'base' ? '#fff' : 'var(--pix-dim)'};"
            >
              {m.crisprTabBase()}
            </button>
          </div>

          <div style="margin-top: 6px;">
            {#if activeTab === 'hdr'}
              <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
                <span style="font-weight: bold; color: var(--pix-accent-2);">{m.crisprHdrTitle()}</span>
                
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  <label style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="pix-dim">{m.crisprHdrInsertSeq()}</span>
                    <input 
                      type="text" 
                      bind:value={insertSeq} 
                      oninput={updateHdrDonor}
                      style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: var(--pix-green); padding: 1px 4px; font-size: 10px; width: 140px; font-family: monospace;"
                    />
                </label>
                <label style="display: flex; justify-content: space-between; align-items: center;">
                  <span class="pix-dim">{m.crisprHdrArmLen()}</span>
                  <input 
                    type="number" 
                    bind:value={homologyArmLen} 
                    oninput={updateHdrDonor}
                    style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; padding: 1px 4px; font-size: 10px; width: 60px;"
                  />
                </label>
              </div>

              {#if hdrResult}
                <div style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; display: flex; flex-direction: column; gap: 4px; font-size: 9px; line-height: 1.3;">
                  <div>
                    <span style="color: var(--pix-cyan); font-weight: bold;">{m.crisprHdrFullDonor()}</span> 
                    <span style="font-family: monospace; word-break: break-all; color: #fff;">{hdrResult.fullDonor}</span>
                    <button class="pix-btn-reset" onclick={() => copyToClipboard(hdrResult.fullDonor, m.crisprHdrFullDonorLabel())} style="margin-left: 4px; color: var(--pix-accent-2); cursor: pointer; display: inline-flex; align-items: center;"><Copy size={8} /></button>
                  </div>

                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <span style="color: var(--pix-green);">{m.crisprHdrLeftArm()} ({hdrResult.leftArm.length}bp):</span>
                      <div style="font-family: monospace; word-break: break-all; background: rgba(0,0,0,0.2); padding: 2px;">{hdrResult.leftArm}</div>
                    </div>
                    <div style="flex: 1;">
                      <span style="color: var(--pix-green);">{m.crisprHdrRightArm()} ({hdrResult.rightArm.length}bp):</span>
                      <div style="font-family: monospace; word-break: break-all; background: rgba(0,0,0,0.2); padding: 2px;">{hdrResult.rightArm}</div>
                    </div>
                  </div>

                  <!-- Evasion Logic report -->
                  <div style="border-top: 1px dashed var(--pix-border); padding-top: 4px;">
                    <span style="font-weight: bold; color: var(--pix-green);">{m.crisprHdrEvasionTitle()}</span>
                    {#if hdrResult.silentMutationsIntroduced.length === 0}
                      <div style="color: var(--pix-yellow); font-size: 9px; display: flex; align-items: center; gap: 3px;">
                        <AlertTriangle size={10} /> {m.crisprHdrEvasionNone()}
                      </div>
                    {:else}
                      <div style="color: var(--pix-green); font-size: 9px;">
                        {m.crisprHdrEvasionSuccess({ count: hdrResult.silentMutationsIntroduced.length })}
                        {#each hdrResult.silentMutationsIntroduced as mut}
                          <div style="font-family: monospace; margin-left: 8px; color: #fff;">• {m.crisprSilentMutPos({ v1: mut.position })}: {mut.codonChange} ({mut.reason === 'PAM_destruction' ? m.crisprReasonPamDestruction() : m.crisprReasonGrnaDisruption()})</div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Tab Content: Prime Editing pegRNA -->
          {#if activeTab === 'prime'}
            <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
              <span style="font-weight: bold; color: var(--pix-accent-2);">{m.crisprPrimeTitle()}</span>
              
              <div style="display: flex; gap: 4px; justify-content: space-between; align-items: center;">
                <label style="display: flex; align-items: center; gap: 4px;">
                  <span class="pix-dim">{m.crisprPrimePbsLen()}</span>
                  <input type="number" bind:value={pbsLength} oninput={updatePegRna} style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; width: 40px; text-align: center;" />
                </label>
                <label style="display: flex; align-items: center; gap: 4px;">
                  <span class="pix-dim">{m.crisprPrimeRttLen()}</span>
                  <input type="number" bind:value={rttLength} oninput={updatePegRna} style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; width: 40px; text-align: center;" />
                </label>
              </div>
              <div style="display: flex; gap: 4px; justify-content: space-between; align-items: center;">
                <label style="display: flex; align-items: center; gap: 4px;">
                  <span class="pix-dim">{m.crisprPrimeOffset()}</span>
                  <input type="number" bind:value={editStartIndex} oninput={updatePegRna} style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: #fff; width: 40px; text-align: center;" />
                </label>
                <label style="display: flex; align-items: center; gap: 4px;">
                  <span class="pix-dim">{m.crisprPrimeEditSeq()}</span>
                  <input type="text" bind:value={editSequence} oninput={updatePegRna} style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: var(--pix-green); width: 60px; font-family: monospace; text-align: center;" />
                </label>
              </div>

              {#if pegRnaResult}
                <div style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; display: flex; flex-direction: column; gap: 4px; font-size: 9px; line-height: 1.3;">
                  <div>
                    <span style="color: var(--pix-cyan); font-weight: bold;">{m.crisprPrimeFullPegrna()}</span>
                    <div style="font-family: monospace; word-break: break-all; color: #fff; max-height: 50px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 2px;">{pegRnaResult.pegRnaSequence}</div>
                    <button class="pix-btn-reset" onclick={() => copyToClipboard(pegRnaResult.pegRnaSequence, m.pegrnaSequence())} style="color: var(--pix-accent-2); cursor: pointer; display: inline-flex; align-items: center; margin-top: 2px;"><Copy size={8} /> {m.crisprPrimeCopyBtn()}</button>
                  </div>

                  <div style="display: flex; gap: 10px; border-top: 1px dashed var(--pix-border); padding-top: 4px;">
                    <div style="flex: 1;">
                      <span style="color: var(--pix-green); font-weight: bold;">{m.crisprPrimePbsLabel()}</span>
                      <div style="font-family: monospace; word-break: break-all; color: #fff;">{pegRnaResult.pbs}</div>
                      <div style="color: var(--pix-dim); font-size: 8px;">Tm: {pegRnaResult.pbsTm}°C</div>
                    </div>
                    <div style="flex: 1;">
                      <span style="color: var(--pix-green); font-weight: bold;">{m.crisprPrimeRttLabel()}</span>
                      <div style="font-family: monospace; word-break: break-all; color: #fff;">{pegRnaResult.rtt}</div>
                      <div style="color: var(--pix-dim); font-size: 8px;">{m.crisprPrimeRttDesc()}</div>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Tab Content: Base Editing -->
          {#if activeTab === 'base'}
            <div style="background: var(--pix-bg-2); border: 1px solid var(--pix-border); padding: 8px; border-radius: 4px; display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
              <span style="font-weight: bold; color: var(--pix-accent-2);">{m.crisprBaseTitle()}</span>
              
              <div style="background: var(--pix-bg-3); border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px;">
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 4px;">
                  {m.crisprBaseDesc()}
                </span>

                <div style="display: flex; gap: 8px;">
                  <div style="flex: 1; border-right: 1px solid var(--pix-border); padding-right: 4px;">
                    <span style="color: var(--pix-cyan); font-weight: bold; display: block; margin-bottom: 2px;">{m.crisprBaseCbe()}</span>
                    {#if selectedGrna.baseEditingWindows?.cbeCandidates.length === 0}
                      <span class="pix-dim" style="font-size: 8px;">{m.crisprBaseCbeNone()}</span>
                    {:else}
                      {#each selectedGrna.baseEditingWindows?.cbeCandidates || [] as cand}
                        <div style="font-family: monospace; font-size: 9px; color: #fff;">
                          {m.crisprBaseCbeRow({ windowPosition: cand.windowPosition, efficiency: cand.efficiency })}
                        </div>
                      {/each}
                    {/if}
                  </div>

                  <div style="flex: 1; padding-left: 4px;">
                    <span style="color: var(--pix-accent-2); font-weight: bold; display: block; margin-bottom: 2px;">{m.crisprBaseAbe()}</span>
                    {#if selectedGrna.baseEditingWindows?.abeCandidates.length === 0}
                      <span class="pix-dim" style="font-size: 8px;">{m.crisprBaseAbeNone()}</span>
                    {:else}
                      {#each selectedGrna.baseEditingWindows?.abeCandidates || [] as cand}
                        <div style="font-family: monospace; font-size: 9px; color: #fff;">
                          {m.crisprBaseAbeRow({ windowPosition: cand.windowPosition, efficiency: cand.efficiency })}
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .grna-row:hover {
    background: rgba(255,255,255,0.05);
  }
</style>
