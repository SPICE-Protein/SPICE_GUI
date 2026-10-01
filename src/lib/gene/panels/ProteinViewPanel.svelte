<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import { 
    getAminoAcidStringFromSequenceString,
    buildProteinView,
    formatMw,
    predictChouFasman,
    calculateKyteDoolittleProfile,
    predictSolubilityAndAggregation,
    predictProteinDomains,
    buildLifecyleTraceMap,
    predictMutationalStabilityDdG,
    applyBackMutationWithOptimization,
    predictPeptideMassFingerprint,
    predictDisulfideBonds,
    predictImmunogenicityAndAntigenicity,
    calculateProteinChargeDistribution
  } from '$lib/genome';

  let {
    showProteinView = $bindable(false),
    drag,
    dnaSeq = $bindable(),
    selectionStart = $bindable(),
    selectionEnd = $bindable(),
    pushLog,
    pushToast
  } = $props<{
    showProteinView: boolean;
    drag: any;
    dnaSeq: string;
    selectionStart: number;
    selectionEnd: number;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let proteinViewTab = $state<'properties' | 'structure' | 'domains' | 'lifecycle' | 'advanced'>('properties');
  let selectedAaIndex = $state<number | null>(null);
  let backMutationAa = $state('A');
  let backMutationHost = $state<'ecoli' | 'yeast' | 'human'>('ecoli');

  const aaSeq = $derived(getAminoAcidStringFromSequenceString(dnaSeq));
  const protData = $derived(buildProteinView(dnaSeq));
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 10px; top: 180px; width: 335px; z-index: 60; max-height: 480px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 3px;">{m.biophysicsCabin()}</span>
    <button class="pix-btn-reset" onclick={() => showProteinView = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: flex; gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {proteinViewTab === 'properties' ? 'ok' : ''}" onclick={() => proteinViewTab = 'properties'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabProtProperties()}</button>
    <button class="pix-btn {proteinViewTab === 'structure' ? 'ok' : ''}" onclick={() => proteinViewTab = 'structure'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabProtStructure()}</button>
    <button class="pix-btn {proteinViewTab === 'domains' ? 'ok' : ''}" onclick={() => proteinViewTab = 'domains'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabProtDomains()}</button>
    <button class="pix-btn {proteinViewTab === 'lifecycle' ? 'ok' : ''}" onclick={() => proteinViewTab = 'lifecycle'} style="flex: 1; padding: 2px; font-size: 8px; color: var(--pix-cyan);">{m.tabProtLifecycle()}</button>
    <button class="pix-btn {proteinViewTab === 'advanced' ? 'ok' : ''}" onclick={() => proteinViewTab = 'advanced'} style="flex: 1; padding: 2px; font-size: 8px; color: var(--pix-accent-2);">{m.tabProtAdvanced()}</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 4px; padding-right: 2px;">
    <!-- TAB 1: PROPERTIES -->
    {#if proteinViewTab === 'properties'}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.labelProteinLength()}</span>
          <span class="pix-num">{protData.properties.length} aa</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.protViewMwLabel()}</span>
          <span class="pix-num">{formatMw(protData.properties.molecularWeight)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.protViewPiLabel()}</span>
          <span class="pix-num">{protData.properties.isoelectricPoint}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.protViewExtinctionLabel()}</span>
          <span class="pix-num">{protData.properties.extinctionCoeff}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.protViewAromaticityLabel()}</span>
          <span class="pix-num">{protData.properties.aromaticity}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.protViewGravyLabel()}</span>
          <span class="pix-num {protData.properties.gravy > 0 ? 'warn' : 'good'}">{protData.properties.gravy}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.labelProteinCharge()}</span>
          <span class="pix-num">{protData.properties.charge}</span>
        </div>
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; font-size: 9px; color: var(--pix-cyan);">{m.protViewPtmTitle()}</div>
        <div style="max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 3px;">
          {#each protData.ptms.slice(0, 15) as ptm}
            <div style="font-size: 8.5px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03); padding: 1px 0;">
              <span style="color: var(--pix-accent-2);">{ptm.type}</span>
              <span class="pix-num">pos {ptm.position + 1} ({ptm.residue})</span>
            </div>
          {:else}
            <div class="pix-dim" style="font-size: 8px; text-align: center;">{m.protViewNoPtmMotif()}</div>
          {/each}
        </div>
      </div>

    <!-- TAB 2: STRUCTURE & FOLDING -->
    {:else if proteinViewTab === 'structure'}
      {@const cfRes = predictChouFasman(aaSeq)}
      {@const totalHelix = cfRes.filter(r => r.structure === 'H').length}
      {@const totalSheet = cfRes.filter(r => r.structure === 'E').length}
      {@const totalCoil = cfRes.filter(r => r.structure === 'C').length}
      {@const helixPct = Math.round(totalHelix / Math.max(1, aaSeq.length) * 100)}
      {@const sheetPct = Math.round(totalSheet / Math.max(1, aaSeq.length) * 100)}
      {@const coilPct = 100 - helixPct - sheetPct}
      {@const kdProfile = calculateKyteDoolittleProfile(aaSeq, 9)}
      {@const solData = predictSolubilityAndAggregation(aaSeq)}
      
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewChouFasmanTitle()}</div>
        <div style="display: flex; gap: 4px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 3px;">
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 8px; color: var(--pix-green);">{m.protViewAlphaHelixLabel()}</div>
            <div style="font-size: 11px; font-weight: bold; color: var(--pix-green);">{helixPct}%</div>
          </div>
          <div style="flex: 1; text-align: center; border-left: 1px dashed rgba(255,255,255,0.1); border-right: 1px dashed rgba(255,255,255,0.1);">
            <div style="font-size: 8px; color: var(--pix-cyan);">{m.labelBetaSheet()}</div>
            <div style="font-size: 11px; font-weight: bold; color: var(--pix-cyan);">{sheetPct}%</div>
          </div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 8px; color: var(--pix-fg-dim);">{m.protViewRandomCoilLabel()}</div>
            <div style="font-size: 11px; font-weight: bold; color: var(--pix-fg-dim);">{coilPct}%</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px;">
          <span class="pix-dim" style="font-weight: bold;">{m.protViewFoldIndexLabel()}</span>
          <span class="pix-num" style="color: var(--pix-purple); font-weight: bold;">{(protData.properties.gravy < -1.2 ? 0.75 : 0.12).toFixed(2)}</span>
        </div>

        <!-- Feature 16: Protein Solubility & Aggregation -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 3px 0;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="pix-dim" style="font-weight: bold;">{m.protViewEcoliSolubilityLabel()}</span>
          <span class="pix-num" style="color: {solData.solubilityScore >= 50 ? 'var(--pix-green)' : 'var(--pix-red)'}; font-weight: bold;">{solData.solubilityScore}%</span>
        </div>

        <div class="pix-dim" style="font-weight: bold; color: var(--pix-accent-2); margin-top: 2px;">{m.protViewTangoTitle()}</div>
        <div style="max-height: 55px; overflow-y: auto; background: rgba(0,0,0,0.1); padding: 2px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.05);">
          {#each solData.aggregationHotspots as spot}
            <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-red);">
              <span>AA {spot.start + 1}-{spot.end + 1}: <span class="mono">{spot.sequence}</span></span>
              <span>{m.protViewTendencyLabel({ v1: spot.score })}</span>
            </div>
          {:else}
            <div class="pix-dim" style="font-size: 7.5px; text-align: center; padding: 2px 0; color: var(--pix-green);">✓ {m.protViewNoAggCore()}</div>
          {/each}
        </div>

        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan); margin-top: 2px;">{m.protViewKdProfileTitle()}</div>
        <!-- Sparkline rendering of Kd profile using simple divs -->
        <div style="width: 100%; height: 32px; background: rgba(0,0,0,0.4); border: 1px solid var(--pix-border); display: flex; align-items: flex-end; gap: 1px; padding: 2px; border-radius: 2px;">
          {#each kdProfile.filter((_, i) => i % Math.max(1, Math.floor(kdProfile.length / 45)) === 0) as score}
            {@const rawH = ((score + 4.5) / 9.0) * 100}
            {@const hColor = score > 1.5 ? 'var(--pix-red)' : score > 0 ? 'var(--pix-orange)' : 'var(--pix-cyan)'}
            <div style="flex: 1; height: {rawH}%; background: {hColor}; min-width: 3px;" title={m.pvScoreTooltip({ v1: score })}></div>
          {/each}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 7.5px; color: var(--pix-fg-dim);">
          <span>N-terminal</span>
          <span>C-terminal</span>
        </div>
      </div>

    <!-- TAB 3: DOMAINS -->
    {:else if proteinViewTab === 'domains'}
      {@const domains = predictProteinDomains(aaSeq)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewPfamTitle()}</div>
        <div style="max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 3px; display: flex; flex-direction: column; gap: 3px;">
          {#each domains as dom}
            <div class="pix-panel" style="padding: 4px; border-color: rgba(255,255,255,0.05); background: rgba(76,214,255,0.03);">
              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-accent-2); font-size: 9px;">
                <span>{dom.name}</span>
                <span class="pix-num" style="color: var(--pix-cyan);">AA {dom.start + 1}-{dom.end + 1}</span>
              </div>
              <div style="font-size: 8px; color: var(--pix-fg-dim); margin-top: 1px; line-height: 1.2;">{dom.desc}</div>
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 15px; font-size: 9px;">{m.protViewNoDomainSig()}</div>
          {/each}
        </div>
      </div>

    <!-- TAB 4: LIFECYCLE TRACE (B) -->
    {:else if proteinViewTab === 'lifecycle'}
      {@const traceMap = buildLifecyleTraceMap(dnaSeq, 0, dnaSeq.length - 1)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewTraceTitle()}</div>
        <div class="pix-dim" style="line-height: 1.3;">{m.protViewTraceDesc()}</div>

        <!-- Horizontal residues scroller -->
        <div style="display: flex; gap: 2px; overflow-x: auto; background: #000; padding: 4px; border: 1.5px solid var(--pix-border); border-radius: 3px; max-height: 52px; white-space: nowrap;">
          {#each traceMap as tm, idx}
            <button 
              class="pix-btn-reset" 
              onclick={() => {
                selectedAaIndex = tm.codonIndex;
                selectionStart = tm.dnaStart + 1;
                selectionEnd = tm.dnaEnd + 1;
                pushToast('info', m.protViewNtLocateTitle(), m.protViewNtLocateDesc({ v1: tm.aminoAcid, v2: idx + 1, v3: tm.codonSeq, v4: tm.dnaStart + 1, v5: tm.dnaEnd + 1 }));
              }}
              style="display: inline-block; width: 18px; height: 32px; text-align: center; background: {selectedAaIndex === tm.codonIndex ? 'var(--pix-accent)' : 'rgba(255,255,255,0.03)'}; border: 1px solid {selectedAaIndex === tm.codonIndex ? '#fff' : 'rgba(255,255,255,0.1)'}; color: {selectedAaIndex === tm.codonIndex ? '#000' : '#fff'}; cursor: pointer; border-radius: 2px; font-family: monospace;"
            >
              <div style="font-size: 8px; font-weight: bold;">{tm.aminoAcid}</div>
              <div style="font-size: 7px; opacity: 0.6;">{idx + 1}</div>
            </button>
          {/each}
        </div>

        {#if selectedAaIndex !== null}
          {@const currentTrace = traceMap[selectedAaIndex]}
          {@const ddg = predictMutationalStabilityDdG(currentTrace.aminoAcid, selectedAaIndex + 1, backMutationAa)}
          <div class="pix-panel" style="padding: 6px; margin-top: 2px; border-color: var(--pix-border-hi); background: rgba(76,214,255,0.02); display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: bold; color: var(--pix-cyan);">
              <span>{m.protViewSelectedResidue({ v1: currentTrace.aminoAcid, v2: currentTrace.codonIndex + 1 })}</span>
              <span class="mono">{m.protViewCurrentCodon({ v1: currentTrace.codonSeq })}</span>
            </div>
            <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>
            
            <!-- Back-mutation layout -->
            <div style="display: flex; flex-direction: column; gap: 3px; font-size: 9px;">
              <div style="font-weight: bold; color: var(--pix-accent-2);">{m.protViewBackMutTitle()}</div>
              <div style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 4px;">
                <div>
                  <span class="pix-dim">{m.protViewTargetAaLabel()}</span>
                  <select class="pix-select" bind:value={backMutationAa} style="padding: 1px 3px; font-size: 9px; width: 100%;">
                    {#each 'ACDEFGHIKLMNPQRSTVWY*'.split('') as aa}
                      <option value={aa}>{aa}</option>
                    {/each}
                  </select>
                </div>
                <div>
                  <span class="pix-dim">{m.protViewOptHostLabel()}</span>
                  <select class="pix-select" bind:value={backMutationHost} style="padding: 1px 3px; font-size: 9px; width: 100%;">
                    <option value="ecoli">{m.protViewHostEcoli()}</option>
                    <option value="yeast">{m.protViewHostYeast()}</option>
                    <option value="human">{m.protViewHostHuman()}</option>
                  </select>
                </div>
              </div>

              <button 
                class="pix-btn ok" 
                onclick={() => {
                  try {
                    const res = applyBackMutationWithOptimization({
                      dnaSequence: dnaSeq,
                      cdsStartIdx: 0, // Assume simple single ORF start
                      aaPosition: selectedAaIndex!,
                      targetAa: backMutationAa,
                      host: backMutationHost
                    });
                    dnaSeq = res.updatedDna;
                    pushToast('success', m.codonReverseMutationApplySuccess(), m.proteinBackMutLog({ aminoAcid: currentTrace.aminoAcid, selectedAaIndex: selectedAaIndex! + 1, backMutationAa: backMutationAa, originalCodon: res.originalCodon, introducedCodon: res.introducedCodon }));
                    pushLog(m.protViewBackMutLog({ v1: currentTrace.aminoAcid, v2: selectedAaIndex! + 1, v3: backMutationAa, v4: backMutationHost, v5: res.introducedCodon }));
                    selectedAaIndex = null;
                  } catch (err: any) {
                    pushToast('error', m.mutationFailed(), err.message);
                  }
                }}
                style="padding: 3px; font-size: 9px; font-weight: bold; width: 100%; margin-top: 3px;"
              >
                🚀 {m.protViewBackMutBtn()}
              </button>

              <!-- Feature 17: Mutational Stability ddG Predictor -->
              <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 4px; padding-top: 4px;">
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 8.5px;">
                  <span style="color: var(--pix-cyan);">{m.protViewDdgTitle()}</span>
                  <span style="color: {ddg.ddG < -0.2 ? 'var(--pix-green)' : ddg.ddG > 0.2 ? 'var(--pix-red)' : 'var(--pix-fg)'};">{ddg.ddG} kcal/mol</span>
                </div>
                <div style="font-size: 7.5px; opacity: 0.7; line-height: 1.2; margin-top: 2px;">
                  {ddg.details}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    <!-- TAB 5: PMF / DISULFIDE / IMMUNO / CHARGE -->
    {:else if proteinViewTab === 'advanced'}
      {@const pmf = predictPeptideMassFingerprint(aaSeq)}
      {@const disulfide = predictDisulfideBonds(aaSeq)}
      {@const immuno = predictImmunogenicityAndAntigenicity(aaSeq, 7)}
      {@const pIDist = calculateProteinChargeDistribution(aaSeq, 30)}
      
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <!-- Feature 7: Trypsin PMF -->
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewPmfTitle()}</div>
        <div style="max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 3px; border: 1.5px solid var(--pix-border); font-size: 8px;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="color: var(--pix-cyan); border-bottom: 1px solid rgba(255,255,255,0.1);">
                <th style="padding: 1px;">{m.protViewPmfRangeTh()}</th>
                <th style="padding: 1px;">{m.protViewPmfSeqTh()}</th>
                <th style="padding: 1px; text-align: right;">{m.protViewPmfMassTh()}</th>
              </tr>
            </thead>
            <tbody>
              {#each pmf.slice(0, 20) as p}
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                  <td style="padding: 1px;" class="pix-num">{p.start}-{p.end}</td>
                  <td style="padding: 1px; font-family: monospace; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={p.sequence}>{p.sequence}</td>
                  <td style="padding: 1px; text-align: right; color: var(--pix-green);" class="pix-num">{p.mass}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Feature 8: Disulfide Bonds -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewDisulfideTitle()}</div>
        <div style="max-height: 55px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 3px;">
          {#each disulfide as bond}
            <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-green);">
              <span>Cys{bond.cys1} - Cys{bond.cys2}</span>
              <span class="pix-num">{bond.score.toFixed(2)}</span>
            </div>
          {:else}
            <div class="pix-dim" style="font-size: 7.5px; text-align: center; color: var(--pix-fg-dim);">✓ {m.protViewNoDisulfide()}</div>
          {/each}
        </div>

        <!-- Feature 9: Antigenicity epitopes -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewImmunoTitle()}</div>
        <div style="max-height: 55px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 3px;">
          {#each immuno.epitopes as ep}
            <div style="font-size: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03);">
              <span style="color: var(--pix-accent-2);">AA {ep.start}-{ep.end}: <span class="mono" style="font-size: 7.5px; font-weight: bold;">{ep.sequence}</span></span>
              <span style="color: var(--pix-green);">Score: {ep.averageScore}</span>
            </div>
          {:else}
            <div class="pix-dim" style="font-size: 7.5px; text-align: center;">{m.protViewNoImmuno()}</div>
          {/each}
        </div>

        <!-- Feature 10: Multi-domain pI -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.protViewDomainPiTitle()}</div>
        <div style="max-height: 55px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 3px; display: flex; flex-direction: column; gap: 2px;">
          {#each pIDist as d}
            <div style="font-size: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.02);">
              <span class="pix-dim">{m.protViewDomainPosLabel({ v1: d.position })}</span>
              <span>{m.protViewPiInlineLabel()} <b style="color: var(--pix-cyan);">{d.pI.toFixed(1)}</b> | {m.labelProteinCharge()} <b style="color: {d.chargeAtPh7 > 0 ? 'var(--pix-red)' : 'var(--pix-green)'}">{d.chargeAtPh7 > 0 ? '+' : ''}{d.chargeAtPh7.toFixed(1)}</b></span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
