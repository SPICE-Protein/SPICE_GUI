<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';

  import {
    checkBioBrickCompatibility,
    verifyMoCloAssembly,
    estimateTransformationEfficiency,
    analyzeGeneticCircuits,
    estimateCopyNumberAndIncompatibility,
    exportToSBOL
  } from '$lib/genome';
  import { searchBioParts, fetchPartSequence, type StandardBioPart } from '$lib/backend/externalDbs';
  import { screenSequence } from '$lib/biosec/screen';
  import { riskCatalogStore } from '$lib/biosec/store.svelte';
  import type { DiagnosticFinding } from '$lib/diagnostics/types';

  let {
    showSynBioTools = $bindable(false),
    drag,
    plasmidName,
    dnaSeq,
    geneFeatures,
    pushLog,
    pushToast
  } = $props<{
    showSynBioTools: boolean;
    drag: any;
    plasmidName: string;
    dnaSeq: string;
    geneFeatures: any[];
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let synBioQuery = $state('');
  let synBioFilter = $state<'all' | 'promoter' | 'rbs' | 'cds' | 'terminator'>('all');
  let synBioResults = $state<StandardBioPart[]>([]);
  let searchingSynBio = $state(false);
  let importingPartId = $state('');

  async function performSynBioSearch() {
    searchingSynBio = true;
    try {
      const filter = synBioFilter === 'all' ? undefined : synBioFilter;
      const res = await searchBioParts(synBioQuery, filter);
      synBioResults = res.data;
      if (res.error) {
        pushToast('warning', m.synbioOfflineTitle(), m.synbioOfflineDesc());
      }
    } catch (e: any) {
      pushToast('error', m.synbioQueryFailTitle(), e.message);
    } finally {
      searchingSynBio = false;
    }
  }

  async function importPart(part: StandardBioPart) {
    importingPartId = part.partId;
    pushLog(m.synbioLogFetching({ v1: part.partId }));
    try {
      const seq = await fetchPartSequence(part.partId);
      if (seq && seq.length > 0) {
        const prevLen = dnaSeq.length;
        dnaSeq = dnaSeq + seq.toUpperCase();
        
        // Add feature annotation automatically
        const newFeat = {
          id: Math.floor(Math.random() * 100000),
          name: part.partId,
          type: part.partType,
          start: prevLen,
          end: prevLen + seq.length,
          color: part.partType === 'promoter' ? '#f59e0b' : part.partType === 'rbs' ? '#10b981' : part.partType === 'cds' ? '#3b82f6' : '#ec4899',
          notes: part.shortDesc
        };
        geneFeatures.push(newFeat);
        
        pushLog(m.synbioLogImportOk({ v1: part.partId, v2: seq.length, v3: part.partType }));
        pushToast('success', m.synbioImportOkTitle(), m.synbioImportOkDesc({ v1: part.partId, v2: seq.length }));
      } else {
        throw new Error(m.synbioEmptySeqError());
      }
    } catch (e: any) {
      pushLog(m.synbioLogImportFail({ v1: part.partId, v2: e.message }));
      pushToast('error', m.synbioImportFailTitle(), e.message);
    } finally {
      importingPartId = '';
    }
  }

  onMount(() => {
    void riskCatalogStore.ensureLoaded();
  });

  let mocloVL = $state('GGAG');
  let mocloVR = $state('CGCT');
  let mocloIL = $state('GGAG');
  let mocloIR = $state('CGCT');
  let transMethod = $state<'chemical' | 'electroporation'>('chemical');
  let transQuality = $state<'supercoiled' | 'ligation_product'>('ligation_product');

  const brick = $derived(checkBioBrickCompatibility(dnaSeq));
  const moclo = $derived(verifyMoCloAssembly({ vectorLeftOverhang: mocloVL, vectorRightOverhang: mocloVR, insertLeftOverhang: mocloIL, insertRightOverhang: mocloIR }));
  const trans = $derived(estimateTransformationEfficiency({ method: transMethod, dnaSizeBp: dnaSeq.length, quality: transQuality }));
  const gates = $derived(analyzeGeneticCircuits(geneFeatures));
  const copyEst = $derived(estimateCopyNumberAndIncompatibility(geneFeatures));
  const riskHits = $derived(
    screenSequence(dnaSeq, riskCatalogStore.catalogs, { circular: true })
  );
  const amrHits = $derived(riskHits.filter((hit) => hit.evidence?.category === 'amr'));
  const catalogueCoverage = $derived(riskCatalogStore.coverage);
  // A bundled sample or a missing catalogue must not read as a clean screen.
  const catalogueLevel = $derived(
    catalogueCoverage === 'none'
      ? 'N/A'
      : catalogueCoverage === 'sample'
        ? 'SAMPLE'
        : amrHits.length === 0
          ? 'SAFE'
          : 'MATCH DETECTED',
  );
  const catalogueColor = $derived(
    catalogueCoverage === 'none' || catalogueCoverage === 'sample'
      ? 'rgba(255,255,255,0.4)'
      : amrHits.length === 0
        ? 'var(--pix-green)'
        : 'var(--pix-warning)',
  );

  let bioriskHits = $state<DiagnosticFinding[]>([]);
  let bioriskToken = 0;
  $effect(() => {
    const sequence = dnaSeq;
    if (!riskCatalogStore.commec?.installed) {
      bioriskHits = [];
      return;
    }
    const token = ++bioriskToken;
    const timer = setTimeout(() => {
      void riskCatalogStore.screenBiorisk(sequence, true).then((findings) => {
        if (token === bioriskToken) bioriskHits = findings;
      });
    }, 700);
    return () => clearTimeout(timer);
  });
  const securityHits = $derived(bioriskHits);
  const bioriskReady = $derived(riskCatalogStore.commec?.installed === true);
  const securityLevel = $derived(
    !bioriskReady ? 'N/A' : securityHits.length === 0 ? 'LOW' : 'HIGH_RISK',
  );
  const securityColor = $derived(
    !bioriskReady
      ? 'rgba(255,255,255,0.4)'
      : securityHits.length === 0
        ? 'var(--pix-green)'
        : 'var(--pix-red)',
  );

  async function downloadSbol() {
    const blocking = [...amrHits, ...bioriskHits].filter(
      (finding) => finding.severity === 'blocking',
    );
    if (blocking.length > 0) {
      pushToast('error', m.riskExportBlocked(), m.riskExportBlockedBody({ v1: blocking.length }));
      return;
    }
    const xml = exportToSBOL(plasmidName || 'SPICE_Plasmid', dnaSeq, geneFeatures);
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plasmidName || 'SPICE_Plasmid'}_sbol2.xml`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', m.exportSuccess(), m.synbioSbolDownloadedDesc());
    pushLog(m.synbioLogSbolExport({ v1: plasmidName }));
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 180px; width: 350px; z-index: 60; max-height: 480px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.syntheticBiologyCAD()}</span>
    <button class="pix-btn-reset" onclick={() => showSynBioTools = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
    <!-- SBOL standard exporter -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 3px;">{m.stepSbolExport()}</div>
      <button
        class="pix-btn ok"
        onclick={downloadSbol}
        style="width: 100%; padding: 4px; font-weight: bold;"
      >
        📥 {m.synbioSbolExportBtn()}
      </button>
    </div>

    <!-- BioBrick constraint RFC 10 audit -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioBrickTitle()}</div>
      {#if brick.compatible}
        <div style="color: var(--pix-green); font-weight: bold; font-size: 8.5px; display: flex; align-items: center; gap: 3px;">
          ✔ {m.synbioBrickOk()}
        </div>
      {:else}
        <div style="color: var(--pix-red); font-weight: bold; font-size: 8.5px; margin-bottom: 2px;">
          ⚠ {m.synbioBrickWarn()}
        </div>
        <div style="max-height: 50px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 2px;">
          {#each brick.matchingSites as site}
            <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-red);">
              <span class="mono">{site.enzyme}</span>
              <span class="mono">{site.sequence}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- MoClo hierarchical assembly overhang compatibility -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioMocloTitle()}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 3px;">
        <div>
          <span class="pix-dim">{m.synbioMocloVecLabel()}</span>
          <div style="display: flex; gap: 2px;">
            <input class="pix-input" type="text" maxlength={4} bind:value={mocloVL} style="width: 100%; text-align: center; text-transform: uppercase;" />
            <input class="pix-input" type="text" maxlength={4} bind:value={mocloVR} style="width: 100%; text-align: center; text-transform: uppercase;" />
          </div>
        </div>
        <div>
          <span class="pix-dim">{m.synbioMocloInsLabel()}</span>
          <div style="display: flex; gap: 2px;">
            <input class="pix-input" type="text" maxlength={4} bind:value={mocloIL} style="width: 100%; text-align: center; text-transform: uppercase;" />
            <input class="pix-input" type="text" maxlength={4} bind:value={mocloIR} style="width: 100%; text-align: center; text-transform: uppercase;" />
          </div>
        </div>
      </div>
      <div style="background: rgba(0,0,0,0.2); padding: 4px; border-radius: 2px; font-size: 8.5px;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.synbioMocloLevelLabel()}</span>
          <span style="color: var(--pix-cyan); font-weight: bold;">{moclo.level}</span>
        </div>
        {#if moclo.compatible}
          <div style="color: var(--pix-green); font-weight: bold; margin-top: 2px;">✓ {m.synbioMocloOk()}</div>
        {:else}
          {#each moclo.errors as err}
            <div style="color: var(--pix-red); font-size: 8px;">⚠ {err}</div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Bacterial cell transformation efficiency estimator -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioTransTitle()}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 3px;">
        <div>
          <span class="pix-dim">{m.synbioTransMethodLabel()}</span>
          <select class="pix-select" bind:value={transMethod} style="padding: 1px 3px; font-size: 8.5px; width: 100%;">
            <option value="chemical">{m.synbioMethodChemical()}</option>
            <option value="electroporation">{m.synbioMethodElectro()}</option>
          </select>
        </div>
        <div>
          <span class="pix-dim">{m.synbioTransQualityLabel()}</span>
          <select class="pix-select" bind:value={transQuality} style="padding: 1px 3px; font-size: 8.5px; width: 100%;">
            <option value="supercoiled">{m.synbioQualitySupercoiled()}</option>
            <option value="ligation_product">{m.synbioQualityLigation()}</option>
          </select>
        </div>
      </div>
      <div style="background: rgba(0,0,0,0.2); padding: 4px; border-radius: 2px; font-size: 8.5px; line-height: 1.3;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.synbioEffLabel()}</span>
          <span class="pix-num" style="color: var(--pix-green);">{trans.efficiency.toExponential(1)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.synbioColonyLabel()}</span>
          <span class="pix-num" style="color: var(--pix-cyan); font-weight: bold;">{m.synbioColonyValue({ v1: trans.colonyEstimate })}</span>
        </div>
      </div>
    </div>

    <!-- Genetic Circuit logic gate detection -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioCircuitTitle()}</div>
      <div style="max-height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;">
        {#each gates as gate}
          <div style="font-size: 8.5px; background: rgba(0,0,0,0.1); padding: 2px 4px; display: flex; justify-content: space-between; border-left: 2.5px solid var(--pix-accent);">
            <span><b>{m.synbioGateLabel({ v1: gate.gateType })}</b>: {gate.outputCdsName}</span>
            <span class="pix-dim">{gate.status}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-family: var(--pix-font); font-size: 7.5px; text-align: center; padding: 10px;">{m.synbioNoCircuit()}</div>
        {/each}
      </div>
    </div>

    <!-- Features 18 & 19: Plasmid Copy Number & Biosecurity screening -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioCopyTitle()}</div>
      <div style="display: flex; flex-direction: column; gap: 3.5px; font-size: 8.5px; line-height: 1.2;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.synbioOriLabel()}</span>
          <span style="color: var(--pix-cyan); font-weight: bold;">{copyEst.oriName}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.synbioCopyNumLabel()}</span>
          <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{copyEst.copyNumberRange}</span>
        </div>
        <div style="font-size: 7.5px; color: var(--pix-fg-dim); background: rgba(0,0,0,0.1); padding: 2.5px; border-radius: 2px;">
          <b>{m.synbioCopyProfileLabel()}</b>: {copyEst.expressionProfile}<br/>
          <b>{m.synbioCopyIncompLabel()}</b>: {copyEst.incompatibilityGroup}
        </div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 1px 0;"></div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="pix-dim" style="font-weight: bold;">{m.synbioSecurityLevelLabel()}</span>
          <span class="pix-num" style="color: {securityColor}; font-weight: bold;">{securityLevel}</span>
        </div>
        {#each securityHits as hit}
          <div style="font-size: 7.5px; color: var(--pix-red); background: rgba(239, 68, 68, 0.08); border-left: 2px solid var(--pix-red); padding: 3px; margin-top: 2px; line-height: 1.3; border-radius: 2px;">
            <b>⚠️ {m.synbioRiskFlagLabel()}</b>: {hit.params?.name}<br/>
            <b>{m.synbioDescLabel()}</b>: {hit.params?.description}
          </div>
        {:else}
          {#if bioriskReady}
            <div class="pix-dim" style="font-size: 7.5px; text-align: center; color: var(--pix-green);">✓ {m.synbioSecurityOk()}</div>
          {:else}
            <div class="pix-dim" style="font-size: 7.5px; text-align: center;">{m.diagPanelBioriskMissing()}</div>
          {/if}
        {/each}

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 1px 0;"></div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="pix-dim" style="font-weight: bold;">{m.synbioAmrLabel()}</span>
          <span class="pix-num" style="color: {catalogueColor}; font-weight: bold;">{catalogueLevel}</span>
        </div>
        {#each amrHits as hit}
          <div style="font-size: 7.5px; color: var(--pix-warning); background: rgba(226, 180, 72, 0.08); border-left: 2px solid var(--pix-warning); padding: 3px; margin-top: 2px; line-height: 1.3; border-radius: 2px;">
            <b>⚠️ {m.synbioAmrFlagLabel()}</b>: {hit.params?.name}<br/>
            <b>{m.synbioAmrTypeLabel()}</b>: {hit.params?.description}<br/>
            <b>{m.synbioAmrMotifLabel()}</b>: <span class="mono">{hit.params?.pattern}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center; color: var(--pix-green);">✓ {m.synbioAmrOk()}</div>
        {/each}
      </div>
    </div>

    <!-- Section 7: SynBioHub & iGEM Registry -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01); margin-top: 4px;">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.synbioRegistryTitle()}</div>
      <div style="display: flex; gap: 3px; margin-bottom: 4px;">
        <input 
          class="pix-input" 
          type="text" 
          placeholder="J23100, GFP, B0015..." 
          bind:value={synBioQuery} 
          onkeydown={(e) => e.key === 'Enter' && performSynBioSearch()}
          style="flex: 1; padding: 1px 3px; font-size: 8.5px; height: 18px;" 
        />
        <select class="pix-select" bind:value={synBioFilter} style="font-size: 8px; padding: 1px; height: 18px; background: var(--pix-bg-2);">
          <option value="all">{m.synbioFilterAll()}</option>
          <option value="promoter">{m.synbioFilterPromoter()}</option>
          <option value="rbs">RBS</option>
          <option value="cds">CDS</option>
          <option value="terminator">{m.synbioFilterTerminator()}</option>
        </select>
        <button 
          class="pix-btn-reset" 
          onclick={performSynBioSearch} 
          disabled={searchingSynBio}
          style="padding: 0 4px; font-size: 8px; height: 18px; cursor: pointer; color: var(--pix-cyan); border: 1px solid var(--pix-border);"
        >
          {searchingSynBio ? '...' : m.synbioSearchBtn()}
        </button>
      </div>

      {#if synBioResults.length > 0}
        <div style="max-height: 100px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 3px; border-radius: 2px; display: flex; flex-direction: column; gap: 3px;">
          {#each synBioResults as part}
            <div style="display: flex; flex-direction: column; gap: 1px; padding: 2.5px; background: rgba(255,255,255,0.02); border-radius: 2px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="mono" style="font-weight: bold; color: var(--pix-green); font-size: 8px;">
                  BBa_{part.partId} 
                  <span style="font-weight: normal; color: var(--pix-fg-dim); font-size: 7px; text-transform: uppercase;">[{part.partType}]</span>
                </span>
                <button 
                  class="pix-btn-reset" 
                  disabled={importingPartId === part.partId}
                  onclick={() => importPart(part)}
                  style="font-size: 7.5px; color: var(--pix-accent-2); cursor: pointer; padding: 0 4px; border: 1px solid var(--pix-border); border-radius: 2px;"
                >
                  {importingPartId === part.partId ? m.synbioImportingLabel() : m.synbioImportBtn()}
                </button>
              </div>
              <div style="font-size: 7.5px; color: var(--pix-fg-dim); line-height: 1.2;">
                {part.shortDesc}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="pix-dim" style="font-size: 7.5px; text-align: center; padding: 4px;">
          {m.synbioRegistryHint()}
        </div>
      {/if}
    </div>
  </div>
</div>
