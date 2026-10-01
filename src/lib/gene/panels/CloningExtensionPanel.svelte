<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import { 
    getReverseComplementSequenceString,
    simulateRecombinaseCloning,
    designSsrMarkers,
    designSnpGenotypingPrimers,
    analyzeRflp
  } from '$lib/genome';
  import { backend } from '$lib/backend/api';

  let {
    showCloningExtensionPanel = $bindable(false),
    drag,
    dnaSeq = $bindable(),
    pushLog,
    pushToast
  } = $props<{
    showCloningExtensionPanel: boolean;
    drag: any;
    dnaSeq: string;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let cloneExtTab = $state<'goldengate' | 'recombinase' | 'ssr' | 'snp' | 'rflp'>('goldengate');
  let recomSystem = $state<'Cre-lox' | 'FLP-FRT'>('Cre-lox');
  let recomInsertSeq = $state('GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC');
  let snpIndexInput = $state(100);
  let snpAllele1 = $state('A');
  let snpAllele2 = $state('G');
  let rflpEnzymeName = $state('EcoRI');
  let rflpEnzymeSite = $state('GAATTC');
  let rflpMutantSeq = $state('GAATTC');

  // Golden Gate Assembly State
  let ggEnzyme = $state<'BsaI' | 'BsmBI' | 'BbsI'>('BsaI');
  let ggFragmentsText = $state(`Fragment_1_Vector,GCAGGGTCTCTTAAACGATGCTAGCGGAAATGGAGAGACCGCTG
Fragment_2_Insert_1,AGTCGGTCTCTATGGCGCAACGGCCCCGAGAGACCATGC
Fragment_3_Insert_2,TTACGGTCTCTCCCGCGTGCGTTTTAAAGAGACCGATC`);
  let ggResult = $state<any | null>(null);
  let isGgLoading = $state(false);

  async function runGoldenGateAssembly() {
    if (isGgLoading) return;
    isGgLoading = true;
    ggResult = null;

    try {
      const frags = ggFragmentsText.trim().split('\n').map(line => {
        const parts = line.split(',');
        const seqPart = parts.length > 1 ? parts[1] : parts[0];
        return seqPart.toUpperCase().replace(/[^ATGCN]/g, '');
      }).filter(Boolean);

      if (frags.length < 2) {
        pushToast('error', m.tooFewFragments(), m.ggToastTooFew());
        isGgLoading = false;
        return;
      }

      const res = await backend.simulateGoldenGateAssembly(frags, ggEnzyme);
      if (!res.error) {
        ggResult = res.data;
        if (ggResult.success) {
          pushLog(m.cloningExtGgSuccessLog({ v1: ggResult.fragments.length, v2: ggResult.productSeq.length }));
          pushToast('success', m.assemblySuccess(), m.ggToastSuccess());
        } else {
          pushToast('error', m.assemblyFailed(), m.ggToastFail());
        }
      }
    } catch (e: any) {
      pushToast('error', 'Tauri Call Error', String(e));
    } finally {
      isGgLoading = false;
    }
  }

  function applyGgProduct() {
    if (ggResult && ggResult.success) {
      dnaSeq = ggResult.productSeq;
      pushLog(m.cloningExtGgApplyLog({ v1: dnaSeq.length }));
      pushToast('success', m.plasmidLoaded(), m.ggToastApplied());
    }
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 140px; width: 335px; z-index: 60; max-height: 485px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.advancedCloningMarkers()}</span>
    <button class="pix-btn-reset" onclick={() => showCloningExtensionPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: flex; gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {cloneExtTab === 'goldengate' ? 'ok' : ''}" onclick={() => cloneExtTab = 'goldengate'} style="flex: 1; padding: 2px; font-size: 8px; color: var(--pix-accent-2); font-weight: bold;">{m.tabExtGoldenGate()}</button>
    <button class="pix-btn {cloneExtTab === 'recombinase' ? 'ok' : ''}" onclick={() => cloneExtTab = 'recombinase'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabExtRecombinase()}</button>
    <button class="pix-btn {cloneExtTab === 'ssr' ? 'ok' : ''}" onclick={() => cloneExtTab = 'ssr'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabExtSsr()}</button>
    <button class="pix-btn {cloneExtTab === 'snp' ? 'ok' : ''}" onclick={() => cloneExtTab = 'snp'} style="flex: 1.2; padding: 2px; font-size: 8px;">{m.tabExtSnp()}</button>
    <button class="pix-btn {cloneExtTab === 'rflp' ? 'ok' : ''}" onclick={() => cloneExtTab = 'rflp'} style="flex: 0.8; padding: 2px; font-size: 8px;">{m.tabExtRflp()}</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 5px; padding-right: 2px;">
    <!-- TAB 0: GOLDEN GATE ASSEMBLY SIMULATOR -->
    {#if cloneExtTab === 'goldengate'}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.ggTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 3px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <label style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span class="pix-dim">{m.ggSelectEnzyme()}</span>
            <select class="pix-select" bind:value={ggEnzyme} style="width: 100px; height: 18px; padding: 1px; font-size: 9px;">
              <option value="BsaI">BsaI (GGTCTC)</option>
              <option value="BsmBI">BsmBI (CGTCTC)</option>
              <option value="BbsI">BbsI (GAAGAC)</option>
            </select>
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.ggInputFragments()}</span>
            <textarea class="pix-input mono" bind:value={ggFragmentsText} placeholder={m.ggPlaceholder()} rows={4} style="font-size: 8px; line-height: 1.2;"></textarea>
          </label>
        </div>

        <button class="pix-btn ok" onclick={runGoldenGateAssembly} style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%; margin-top: 2px;">
          {#if isGgLoading}{m.ggRunning()}{:else}{m.ggBtnRun()}{/if}
        </button>

        {#if ggResult}
          {#if ggResult.success}
            <div class="pix-panel" style="padding: 5px; margin-top: 4px; background: rgba(0,255,0,0.02); border-color: var(--pix-green);">
              <div style="font-weight: bold; color: var(--pix-green); font-size: 9px; display: flex; align-items: center; gap: 3px;">
                <span>✓</span> {m.ggSuccess()}
              </div>
              <div class="pix-dim" style="font-size: 8px; margin-top: 3px; line-height: 1.35;">
                {m.ggOrder()} {ggResult.sortedIndices.map((i: number) => `Frag_${i+1}`).join(' ➔ ')}<br>
                {m.ggOverhangs()} {ggResult.overhangs.join(' · ')}
              </div>
              <button class="pix-btn-reset" onclick={applyGgProduct} style="margin-top: 4px; padding: 2px 6px; font-size: 8px; font-weight: bold; color: var(--pix-green); border: 1.5px solid var(--pix-green); border-radius: 2px; cursor: pointer;">
                {m.ggBtnApply()}
              </button>
            </div>
          {:else}
            <div class="pix-panel" style="padding: 5px; margin-top: 4px; background: rgba(255,0,0,0.03); border-color: var(--pix-red);">
              <div style="font-weight: bold; color: var(--pix-red); font-size: 9px;">{m.ggFail()}</div>
              <ul style="margin: 3px 0 0 10px; padding: 0; font-size: 8px; color: var(--pix-fg-dim); line-height: 1.35;">
                {#each ggResult.errors as err}
                  <li>{err}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if ggResult.warnings.length > 0}
            <div class="pix-panel" style="padding: 5px; margin-top: 3px; background: rgba(255,255,0,0.02); border-color: var(--pix-yellow); font-size: 8px; color: var(--pix-yellow); line-height: 1.3;">
              {#each ggResult.warnings as warn}
                <div>⚠ {warn}</div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

    <!-- TAB 1: SITE-SPECIFIC RECOMBINASE CLONING -->
    {:else if cloneExtTab === 'recombinase'}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.cloningExtRecomTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 3px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.cloningExtRecomSystemLabel()}</span>
            <select class="pix-select" bind:value={recomSystem} style="width: 100px; height: 18px; padding: 1px; font-size: 9px;">
              <option value="Cre-lox">Cre-loxP (34 bp loxP)</option>
              <option value="FLP-FRT">FLP-FRT (34 bp FRT)</option>
            </select>
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px; margin-top: 2px;">
            <span class="pix-dim">{m.cloningExtRecomInsertLabel()}</span>
            <textarea class="pix-input mono" bind:value={recomInsertSeq} placeholder={m.cloningExtRecomInsertPlaceholder()} rows={2} style="font-size: 8.5px;"></textarea>
          </label>
        </div>

        <!-- Test Pre-sets for Recombinase Cloning -->
        <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 3px; background: rgba(255,255,255,0.05); padding: 5px; border-radius: 3px; margin-bottom: 4px;">
          <span class="pix-dim" style="font-size: 8px; font-weight: bold; color: var(--pix-accent-2);">{m.cloningExtRecomPresetsTitle()}</span>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;">
            <button class="pix-btn" onclick={() => {
              const site = recomSystem === "Cre-lox" ? "ATAACTTCGTATAATGTATGCTATACGAAGTTAT" : "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC";
              dnaSeq = "GATCTTCG" + site + "A".repeat(100);
              recomInsertSeq = site + "T".repeat(50);
              pushToast('info', m.sceneLoaded(), m.cloningExtRecomIntegrateToast());
            }} style="padding: 1.5px; font-size: 8px;">{m.cloningExtRecomIntegrateBtn()}</button>
            <button class="pix-btn" onclick={() => {
              const site = recomSystem === "Cre-lox" ? "ATAACTTCGTATAATGTATGCTATACGAAGTTAT" : "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC";
              dnaSeq = "GATCTTCG" + site + "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG" + site + "A".repeat(50);
              recomInsertSeq = "";
              pushToast('info', m.sceneLoaded(), m.cloningExtRecomExciseToast());
            }} style="padding: 1.5px; font-size: 8px;">{m.cloningExtRecomExciseBtn()}</button>
            <button class="pix-btn" onclick={() => {
              const site = recomSystem === "Cre-lox" ? "ATAACTTCGTATAATGTATGCTATACGAAGTTAT" : "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC";
              const siteRc = getReverseComplementSequenceString(site);
              dnaSeq = "GATCTTCG" + site + "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG" + siteRc + "A".repeat(50);
              recomInsertSeq = "";
              pushToast('info', m.sceneLoaded(), m.cloningExtRecomInvertToast());
            }} style="padding: 1.5px; font-size: 8px;">{m.cloningExtRecomInvertBtn()}</button>
          </div>
        </div>

        <button class="pix-btn ok" onclick={() => {
          const res = simulateRecombinaseCloning(dnaSeq, recomInsertSeq, recomSystem);
          if (res.reactionType === "no_reaction") {
            pushToast('warn', m.cloningExtRecomNoneTitle(), m.cloningExtRecomNoneDesc());
            pushLog(m.cloningExtRecomNoneLog({ v1: recomSystem }));
            return;
          }
          dnaSeq = res.productSequence;
          res.log.forEach(pushLog);
          pushToast('success', m.cloningExtRecomSuccessTitle(), m.cloningExtRecomTypeValue({ v1: res.reactionType }));
        }} style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%;">{m.cloningExtRecomRunBtn()}</button>
      </div>

    <!-- TAB 2: SSR MARKERS FLANKING DESIGN -->
    {:else if cloneExtTab === 'ssr'}
      {@const ssrs = designSsrMarkers(dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.cloningExtSsrTitle()}</div>
        <div style="max-height: 160px; overflow-y: auto; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px; display: flex; flex-direction: column; gap: 3px;">
          {#each ssrs as ssr}
            <div class="pix-panel" style="padding: 4px; border-color: var(--pix-border); background: rgba(183,99,255,0.03);">
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-purple); font-size: 8.5px;">
                <span>SSR: {ssr.repeatPattern} ({ssr.repeatCount}x)</span>
                <span class="pix-num">{m.modelLength()}: {ssr.productSize} bp</span>
              </div>
              <div class="mono" style="font-size: 7.5px; color: var(--pix-fg-dim); margin-top: 2px; line-height: 1.2;">
                F-Primer: {ssr.forwardPrimer} (Tm {ssr.tm}°C)<br>
                R-Primer: {ssr.reversePrimer} (Tm {ssr.tm}°C)
              </div>
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 25px 0;">{m.cloningExtSsrNone()}</div>
          {/each}
        </div>
      </div>

    <!-- TAB 3: SNP GENOTYPING PRIMERS -->
    {:else if cloneExtTab === 'snp'}
      {@const snpRes = designSnpGenotypingPrimers(dnaSeq, snpIndexInput, snpAllele1, snpAllele2) as any}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.cloningExtSnpTitle()}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; background: rgba(0,0,0,0.15); padding: 4px; border-radius: 3px; margin-bottom: 2px;">
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.cloningExtSnpPositionLabel()}</span>
            <input class="pix-input" type="number" bind:value={snpIndexInput} style="width: 100%; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.cloningExtSnpAllele1Label()}</span>
            <input class="pix-input" type="text" bind:value={snpAllele1} style="width: 100%; text-align: center; height: 18px; text-transform: uppercase;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.cloningExtSnpAllele2Label()}</span>
            <input class="pix-input" type="text" bind:value={snpAllele2} style="width: 100%; text-align: center; height: 18px; text-transform: uppercase;" />
          </label>
        </div>

        <div class="pix-panel" style="padding: 4px; border-color: var(--pix-border); background: rgba(0,0,0,0.2);">
          {#if snpRes.compatible}
            <div style="font-weight: bold; color: var(--pix-green); margin-bottom: 2.5px;">✓ {m.cloningExtSnpCompatibleTitle()}</div>
            <div style="font-size: 8px; line-height: 1.3; display: flex; flex-direction: column; gap: 1.5px;">
              <div><b style="color: var(--pix-green);">{m.cloningExtSnpAsp1Label()}</b> <span class="mono">{snpRes.asp1Primer.sequence}</span> {m.cloningExtSnpAspTmLength({ v1: snpRes.asp1Primer.tm, v2: snpRes.asp1Primer.sequence.length })}</div>
              <div><b style="color: var(--pix-purple);">{m.cloningExtSnpAsp2Label()}</b> <span class="mono">{snpRes.asp2Primer.sequence}</span> {m.cloningExtSnpAspTmLength({ v1: snpRes.asp2Primer.tm, v2: snpRes.asp2Primer.sequence.length })}</div>
              <div><b style="color: var(--pix-cyan);">Common-Rev:</b> <span class="mono">{snpRes.commonReversePrimer.sequence}</span> (Tm {snpRes.commonReversePrimer.tm}°C)</div>
            </div>
          {:else}
            <div style="color: var(--pix-red); font-size: 8px;">⚠️ {snpRes.message}</div>
          {/if}
        </div>
      </div>

    <!-- TAB 4: RFLP POLYMORPHISM ANALYSIS -->
    {:else if cloneExtTab === 'rflp'}
      {@const rflp = analyzeRflp(dnaSeq, rflpMutantSeq, { name: rflpEnzymeName, site: rflpEnzymeSite }) as any}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.cloningExtRflpTitle()}</div>
        <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 4px; background: rgba(0,0,0,0.15); padding: 4px; border-radius: 3px; margin-bottom: 2px;">
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.cloningExtRflpEnzymeNameLabel()}</span>
            <input class="pix-input" type="text" bind:value={rflpEnzymeName} style="width: 100%; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.cloningExtRflpSiteLabel()}</span>
            <input class="pix-input mono" type="text" bind:value={rflpEnzymeSite} style="width: 100%; text-align: center; height: 18px; text-transform: uppercase;" />
          </label>
        </div>
        <label style="display: flex; flex-direction: column; gap: 1px; margin-bottom: 2px;">
          <span class="pix-dim">{m.cloningExtRflpMutantLabel()}</span>
          <textarea class="pix-input mono" bind:value={rflpMutantSeq} placeholder={m.cloningExtRflpMutantPlaceholder()} rows={2} style="font-size: 8.5px;"></textarea>
        </label>

        <div class="pix-panel" style="padding: 4px; border-color: var(--pix-border); background: rgba(0,0,0,0.2); font-size: 8.5px; line-height: 1.35;">
          <div style="display: flex; justify-content: space-between;">
            <span class="pix-dim">{m.cloningExtRflpWtFragmentsLabel()}</span>
            <span class="pix-num">{m.cloningExtRflpFragmentCount({ v1: rflp.wildTypeFragments.length, v2: rflp.wildTypeFragments.join(', ') })}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="pix-dim">{m.cloningExtRflpMutFragmentsLabel()}</span>
            <span class="pix-num" style="color: var(--pix-accent-2);">{m.cloningExtRflpFragmentCount({ v1: rflp.mutantFragments.length, v2: rflp.mutantFragments.join(', ') })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: bold; margin-top: 1px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 1px;">
            <span class="pix-dim">{m.cloningExtRflpPolymorphicLabel()}</span>
            <span style="color: {rflp.polymorphicDetected ? 'var(--pix-red)' : 'var(--pix-fg-dim)'};">{rflp.polymorphicDetected ? m.cloningExtRflpPolymorphicYes() : m.cloningExtRflpPolymorphicNo()}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
