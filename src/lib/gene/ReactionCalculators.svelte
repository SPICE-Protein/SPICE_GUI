<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import {
    calculateDilution,
    calculateLigationMass,
    calculatePcrMasterMix,
    convertDnaConcentration,
    optimizeGradientPcr,
    estimateGelBandSizes,
    fitElisaStandardCurve,
    calculateEnzymeKinetics
  } from '$lib/genome';

  let {
    showCalculatorsPanel = $bindable(false),
    drag
  } = $props<{
    showCalculatorsPanel: boolean;
    drag: any;
  }>();

  let calcTab = $state<'dilution' | 'ligation' | 'pcr' | 'conc' | 'gradient' | 'gelEstimator' | 'elisa' | 'kinetics'>('dilution');

  // Dilution states
  let calcDilutionC1 = $state(100);
  let calcDilutionC2 = $state(10);
  let calcDilutionV2 = $state(50);

  // Ligation states
  let calcLigationVSize = $state(5000);
  let calcLigationISize = $state(1000);
  let calcLigationVMass = $state(100);
  let calcLigationRatio = $state(3);

  // PCR states
  let calcPcrWells = $state(8);
  let calcPcrVol = $state(50);
  let calcPcrPolymerase = $state<'Taq' | 'Phusion' | 'Q5'>('Q5');

  // Concentration states
  let calcDnaConcValue = $state(50);
  let calcDnaConcDirection = $state<'ng_to_nM' | 'nM_to_ng'>('ng_to_nM');
  let calcDnaConcLength = $state(3000);
  let calcDnaConcIsDs = $state(true);

  // Gradient states
  let calcGradP1Tm = $state(58.5);
  let calcGradP2Tm = $state(59.2);

  // Gel Band states
  let calcGelStandardDist1 = $state(20);
  let calcGelStandardSize1 = $state(10000);
  let calcGelStandardDist2 = $state(45);
  let calcGelStandardSize2 = $state(5000);
  let calcGelStandardDist3 = $state(80);
  let calcGelStandardSize3 = $state(2000);
  let calcGelUnknownDist = $state(55);

  // ELISA states
  let calcElisaConc1 = $state(1000);
  let calcElisaOd1 = $state(2.4);
  let calcElisaConc2 = $state(250);
  let calcElisaOd2 = $state(0.85);
  let calcElisaConc3 = $state(62.5);
  let calcElisaOd3 = $state(0.22);
  let calcElisaUnknownOd = $state(1.15);

  // Kinetics states
  let calcKinSub1 = $state(10);
  let calcKinVel1 = $state(4.2);
  let calcKinSub2 = $state(2.5);
  let calcKinVel2 = $state(2.1);
  let calcKinSub3 = $state(0.5);
  let calcKinVel3 = $state(0.65);
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 80px; width: 340px; z-index: 60; max-height: 480px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.reactionCalculators()}</span>
    <button class="pix-btn-reset" onclick={() => showCalculatorsPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {calcTab === 'dilution' ? 'ok' : ''}" onclick={() => calcTab = 'dilution'} style="padding: 2px; font-size: 8px;">{m.tabCalcDilution()}</button>
    <button class="pix-btn {calcTab === 'ligation' ? 'ok' : ''}" onclick={() => calcTab = 'ligation'} style="padding: 2px; font-size: 8px;">{m.tabCalcLigation()}</button>
    <button class="pix-btn {calcTab === 'pcr' ? 'ok' : ''}" onclick={() => calcTab = 'pcr'} style="padding: 2px; font-size: 8px;">{m.tabCalcPcr()}</button>
    <button class="pix-btn {calcTab === 'conc' ? 'ok' : ''}" onclick={() => calcTab = 'conc'} style="padding: 2px; font-size: 8px;">{m.tabCalcConc()}</button>
    <button class="pix-btn {calcTab === 'gradient' ? 'ok' : ''}" onclick={() => calcTab = 'gradient'} style="padding: 2px; font-size: 8px;">{m.tabCalcGradient()}</button>
    <button class="pix-btn {calcTab === 'gelEstimator' ? 'ok' : ''}" onclick={() => calcTab = 'gelEstimator'} style="padding: 2px; font-size: 8px;">{m.tabCalcGel()}</button>
    <button class="pix-btn {calcTab === 'elisa' ? 'ok' : ''}" onclick={() => calcTab = 'elisa'} style="padding: 2px; font-size: 8px;">{m.tabCalcElisa()}</button>
    <button class="pix-btn {calcTab === 'kinetics' ? 'ok' : ''}" onclick={() => calcTab = 'kinetics'} style="padding: 2px; font-size: 8px;">{m.tabCalcKinetics()}</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
    <!-- TAB 1: DILUTION -->
    {#if calcTab === 'dilution'}
      {@const dil = calculateDilution({ sourceConc: calcDilutionC1, targetConc: calcDilutionC2, targetVol: calcDilutionV2 })}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcDilutionTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcSourceConcLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcDilutionC1} style="width: 70px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcTargetConcLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcDilutionC2} style="width: 70px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcTargetVolLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcDilutionV2} style="width: 70px; text-align: center; height: 18px;" />
          </label>
        </div>

        <div class="pix-panel" style="padding: 6px; margin-top: 2px; border-color: var(--pix-green); background: rgba(0, 255, 100, 0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-green); font-size: 9.5px; margin-bottom: 2px;">{m.rcDilutionRecipe()}</div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcAddSourceVol()}</span>
            <span class="pix-num" style="font-weight: bold; color: var(--pix-green);">{dil.sourceVol} uL</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcAddWaterVol()}</span>
            <span class="pix-num" style="font-weight: bold; color: var(--pix-green);">{dil.waterVol} uL</span>
          </div>
        </div>
      </div>

    <!-- TAB 2: LIGATION -->
    {:else if calcTab === 'ligation'}
      {@const insertMass = calculateLigationMass({ vectorSizeBp: calcLigationVSize, insertSizeBp: calcLigationISize, vectorMassNg: calcLigationVMass, molarRatio: calcLigationRatio })}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcLigationTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcVectorSizeLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcLigationVSize} style="width: 75px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcInsertSizeLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcLigationISize} style="width: 75px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcVectorMassLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcLigationVMass} style="width: 75px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
            <span class="pix-dim">{m.rcMolarRatioLabel()}</span>
            <select class="pix-select" bind:value={calcLigationRatio} style="width: 75px; padding: 1px 3px; height: 18px; font-size: 9px;">
              <option value={1}>1 : 1</option>
              <option value={3}>{m.rcRatio3Recommended()}</option>
              <option value={5}>5 : 1</option>
              <option value={10}>10 : 1</option>
            </select>
          </label>
        </div>

        <div class="pix-panel" style="padding: 6px; margin-top: 2px; border-color: var(--pix-cyan); background: rgba(76, 214, 255, 0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-cyan); font-size: 9.5px; margin-bottom: 2px;">{m.rcLigationMixTitle()}</div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>{m.rcInsertMassNeeded()}</span>
            <span class="pix-num" style="font-weight: bold; color: var(--pix-cyan); font-size: 11px;">{insertMass} ng</span>
          </div>
          <div class="pix-dim" style="font-size: 7.5px; margin-top: 2px;">* {m.rcT4LigaseHint()}</div>
        </div>
      </div>

    <!-- TAB 3: PCR -->
    {:else if calcTab === 'pcr'}
      {@const pcrRows = calculatePcrMasterMix({ reactionsCount: calcPcrWells, totalVolume: calcPcrVol, polymeraseType: calcPcrPolymerase })}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcPcrTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <label style="display: flex; flex-direction: column; gap: 1px;">
              <span class="pix-dim">{m.rcReactionsLabel()}</span>
              <input class="pix-input" type="number" bind:value={calcPcrWells} style="width: 100%; text-align: center; height: 18px;" />
            </label>
            <label style="display: flex; flex-direction: column; gap: 1px;">
              <span class="pix-dim">{m.rcTubeVolLabel()}</span>
              <input class="pix-input" type="number" bind:value={calcPcrVol} style="width: 100%; text-align: center; height: 18px;" />
            </label>
          </div>
          <label style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
            <span class="pix-dim">{m.rcPolymeraseLabel()}</span>
            <select class="pix-select" bind:value={calcPcrPolymerase} style="width: 100px; padding: 1px; height: 18px; font-size: 9px;">
              <option value="Q5">NEB Q5 High-Fidelity</option>
              <option value="Phusion">Thermo Phusion</option>
              <option value="Taq">Standard Taq</option>
            </select>
          </label>
        </div>

        <!-- Recipe table -->
        <div style="border: 1px solid var(--pix-border); border-radius: 3px; background: #000; overflow: hidden; margin-top: 2px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 8.5px; text-align: left;">
            <thead>
              <tr style="background: var(--pix-bg-3); border-bottom: 1px solid var(--pix-border); color: var(--pix-cyan);">
                <th style="padding: 3px;">{m.rcComponentCol()}</th>
                <th style="padding: 3px; text-align: center; width: 50px;">{m.rcWellUlCol()}</th>
                <th style="padding: 3px; text-align: center; width: 65px;">{m.rcMasterMixUlabel()}</th>
              </tr>
            </thead>
            <tbody>
              {#each pcrRows as row}
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                  <td style="padding: 3px; font-weight: bold; color: var(--pix-fg-dim);">{row.component}</td>
                  <td style="padding: 3px; text-align: center;" class="pix-num">{row.volumePerWell}</td>
                  <td style="padding: 3px; text-align: center; color: var(--pix-green);" class="pix-num">{row.totalVolume}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="pix-dim" style="font-size: 7.5px; text-align: center; line-height: 1.2;">* {m.rcPcrMixNote()}</div>
      </div>

    <!-- TAB 4: DNA CONCENTRATION CONVERTER -->
    {:else if calcTab === 'conc'}
      {@const concRes = convertDnaConcentration({ value: calcDnaConcValue, direction: calcDnaConcDirection, lengthBp: calcDnaConcLength, isDoubleStranded: calcDnaConcIsDs })}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcConcTitle()}</div>
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 3px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcDirectionLabel()}</span>
            <select class="pix-select" bind:value={calcDnaConcDirection} style="width: 110px; height: 18px; padding: 1px; font-size: 9px;">
              <option value="ng_to_nM">ng/µL ➔ nM</option>
              <option value="nM_to_ng">nM ➔ ng/µL</option>
            </select>
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcValueLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcDnaConcValue} style="width: 110px; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcChainTypeLabel()}</span>
            <select class="pix-select" bind:value={calcDnaConcIsDs} style="width: 110px; height: 18px; padding: 1px; font-size: 9px;">
              <option value={true}>{m.rcDsDnaOption()}</option>
              <option value={false}>{m.rcSsOption()}</option>
            </select>
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcLengthLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcDnaConcLength} style="width: 110px; text-align: center; height: 18px;" />
          </label>
        </div>

        <div class="pix-panel" style="padding: 6px; border-color: var(--pix-green); background: rgba(0,255,100,0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-green); font-size: 9px; margin-bottom: 2px;">{m.rcResultTitle()}</div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcMwLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green);">{concRes.molWt} g/mol</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span>{calcDnaConcDirection === 'ng_to_nM' ? m.rcMolarConcLabel() : m.rcMassConcLabel()}</span>
            <span style="color: var(--pix-green);">{calcDnaConcDirection === 'ng_to_nM' ? concRes.nM + ' nM' : concRes.ngPerUl + ' ng/µL'}</span>
          </div>
        </div>
      </div>

    <!-- TAB 5: GRADIENT PCR OPTIMIZER -->
    {:else if calcTab === 'gradient'}
      {@const grad = optimizeGradientPcr(calcGradP1Tm, calcGradP2Tm, 50, 66)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcGradientTitle()}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.rcPrimer1TmLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcGradP1Tm} style="width: 100%; text-align: center; height: 18px;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 1px;">
            <span class="pix-dim">{m.rcPrimer2TmLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcGradP2Tm} style="width: 100%; text-align: center; height: 18px;" />
          </label>
        </div>

        <div style="font-size: 8px; color: var(--pix-green); font-weight: bold; text-align: center; background: rgba(0,255,100,0.05); padding: 2px; border-radius: 3px; border: 1px solid var(--pix-green);">
          {m.rcGradientRangeLine({ v1: grad.optimalTempRange, v2: grad.bestColumn })}
        </div>

        <div style="max-height: 120px; overflow-y: auto; border: 1px solid var(--pix-border); border-radius: 3px; background: #000;">
          <table style="width: 100%; border-collapse: collapse; font-size: 8px; text-align: left;">
            <thead>
              <tr style="background: var(--pix-bg-3); border-bottom: 1px solid var(--pix-border); color: var(--pix-cyan);">
                <th style="padding: 2px;">{m.rcWellCol()}</th>
                <th style="padding: 2px; text-align: center;">{m.rcSetTempCol()}</th>
                <th style="padding: 2px;">{m.rcEfficiencyCol()}</th>
              </tr>
            </thead>
            <tbody>
              {#each grad.columns as col}
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); background: {col.column === grad.bestColumn ? 'rgba(0,255,100,0.08)' : 'transparent'}">
                  <td style="padding: 2px; font-weight: bold;">{m.rcWellNumber({ v1: col.column })}</td>
                  <td style="padding: 2px; text-align: center;" class="pix-num">{col.temperature} °C</td>
                  <td style="padding: 2px; color: {col.efficiencyRating === 'Optimal' ? 'var(--pix-green)' : col.efficiencyRating === 'Good' ? 'var(--pix-cyan)' : 'var(--pix-fg-dim)'}">{col.efficiencyRating}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

    <!-- TAB 6: GEL BAND ESTIMATOR -->
    {:else if calcTab === 'gelEstimator'}
      {@const gelStandards = [{ distanceMm: calcGelStandardDist1, sizeBp: calcGelStandardSize1 }, { distanceMm: calcGelStandardDist2, sizeBp: calcGelStandardSize2 }, { distanceMm: calcGelStandardDist3, sizeBp: calcGelStandardSize3 }]}
      {@const gelEst = estimateGelBandSizes(gelStandards, [calcGelUnknownDist])}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcGelEstTitle()}</div>
        
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px;">
          <div style="font-size: 8px; font-weight: bold; color: var(--pix-accent-2);">{m.rcGelStep1()}</div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcBandLabel({ v1: 1 })}</span>
            <input class="pix-input" type="number" bind:value={calcGelStandardDist1} placeholder={m.rcMigrationMmPlaceholder()} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcGelStandardSize1} placeholder=m.sizeBp() style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcBandLabel({ v1: 2 })}</span>
            <input class="pix-input" type="number" bind:value={calcGelStandardDist2} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcGelStandardSize2} style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcBandLabel({ v1: 3 })}</span>
            <input class="pix-input" type="number" bind:value={calcGelStandardDist3} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcGelStandardSize3} style="width: 100%; height: 18px; text-align: center;" />
          </div>

          <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 3px; padding-top: 3px;"></div>
          <div style="font-size: 8px; font-weight: bold; color: var(--pix-accent-2);">{m.rcGelStep2()}</div>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcUnknownDistLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcGelUnknownDist} style="width: 80px; text-align: center; height: 18px;" />
          </label>
        </div>

        <div class="pix-panel" style="padding: 6px; border-color: var(--pix-cyan); background: rgba(76,214,255,0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-cyan); font-size: 9px; margin-bottom: 2px;">{m.rcGelEstResultTitle()}</div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcFitR2Label()}</span>
            <span class="pix-num" style="color: var(--pix-cyan);">{gelEst.rSquared}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 11px;">
            <span>{m.rcEstSizeLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green);">{gelEst.estimatedSizes[0]} bp</span>
          </div>
        </div>
      </div>

    <!-- TAB 7: ELISA STANDARD CURVE FITTER -->
    {:else if calcTab === 'elisa'}
      {@const elisaStds = [{ concentration: calcElisaConc1, odValue: calcElisaOd1 }, { concentration: calcElisaConc2, odValue: calcElisaOd2 }, { concentration: calcElisaConc3, odValue: calcElisaOd3 }]}
      {@const elisaRes = fitElisaStandardCurve(elisaStds, [calcElisaUnknownOd])}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcElisaTitle()}</div>
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px; font-size: 8.5px;">
          <div style="font-weight: bold; color: var(--pix-accent-2);">{m.rcElisaStep1()}</div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcStandardLabel({ v1: 1 })}</span>
            <input class="pix-input" type="number" bind:value={calcElisaConc1} placeholder={m.rcConcPlaceholder()} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcElisaOd1} placeholder={m.rcOdPlaceholder()} style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcStandardLabel({ v1: 2 })}</span>
            <input class="pix-input" type="number" bind:value={calcElisaConc2} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcElisaOd2} style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcStandardLabel({ v1: 3 })}</span>
            <input class="pix-input" type="number" bind:value={calcElisaConc3} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcElisaOd3} style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 3px; padding-top: 3px;"></div>
          <div style="font-weight: bold; color: var(--pix-accent-2);">{m.rcElisaStep2()}</div>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.rcUnknownOdLabel()}</span>
            <input class="pix-input" type="number" bind:value={calcElisaUnknownOd} style="width: 80px; text-align: center; height: 18px;" />
          </label>
        </div>

        <div class="pix-panel" style="padding: 5px; border-color: var(--pix-purple); background: rgba(183, 99, 255, 0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-purple); font-size: 9px; margin-bottom: 2px;">{m.rcFittedParamsTitle()}</div>
          <div style="display: flex; justify-content: space-between; font-size: 7.5px;">
            <span>EC50 (c): {elisaRes.parameters.c} | Hill Slope (b): {elisaRes.parameters.b}</span>
            <span class="pix-num" style="color: var(--pix-purple);">R²: {elisaRes.rSquared}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 10.5px; border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 2px; padding-top: 2px;">
            <span>{m.rcFittedConcLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green);">{elisaRes.fittedConcentrations[0]} pg/mL</span>
          </div>
        </div>
      </div>

    <!-- TAB 8: ENZYME KINETICS -->
    {:else if calcTab === 'kinetics'}
      {@const kineticsPoints = [{ substrateConc: calcKinSub1, velocity: calcKinVel1 }, { substrateConc: calcKinSub2, velocity: calcKinVel2 }, { substrateConc: calcKinSub3, velocity: calcKinVel3 }]}
      {@const kineticRes = calculateEnzymeKinetics(kineticsPoints)}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.rcKineticsTitle()}</div>
        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.15); padding: 5px; border-radius: 3px; font-size: 8.5px;">
          <div style="font-weight: bold; color: var(--pix-accent-2);">{m.rcKinStep1()}</div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcKinWellLabel({ v1: 1 })}</span>
            <input class="pix-input" type="number" bind:value={calcKinSub1} placeholder="[S] (mM)" style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcKinVel1} placeholder="v (uM/min)" style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcKinWellLabel({ v1: 2 })}</span>
            <input class="pix-input" type="number" bind:value={calcKinSub2} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcKinVel2} style="width: 100%; height: 18px; text-align: center;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1.2fr 1.2fr; gap: 4px; align-items: center;">
            <span class="pix-dim">{m.rcKinWellLabel({ v1: 3 })}</span>
            <input class="pix-input" type="number" bind:value={calcKinSub3} style="width: 100%; height: 18px; text-align: center;" />
            <input class="pix-input" type="number" bind:value={calcKinVel3} style="width: 100%; height: 18px; text-align: center;" />
          </div>
        </div>

        <div class="pix-panel" style="padding: 5px; border-color: var(--pix-green); background: rgba(0,255,100,0.02); line-height: 1.4;">
          <div style="font-weight: bold; color: var(--pix-green); font-size: 9px; margin-bottom: 2px;">{m.rcKinFitTitle()}</div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcVmaxLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{kineticRes.vMax} uM/min</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>{m.rcKmLabel()}</span>
            <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{kineticRes.kM} mM</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 7.5px; opacity: 0.6; border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 2px; padding-top: 2px;">
            <span>{m.rcR2Label({ v1: kineticRes.rSquared })}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
