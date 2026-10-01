<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { 
    calculateRbsStrength,
    predictTfbsMotifs,
    predictPromoters,
    getAminoAcidStringFromSequenceString,
    predictSignalPeptide,
    predictTransmembraneHelices,
    calculateSkew,
    detectCpGIslands,
    detectTandemRepeats,
    parseGFF3,
    parseGTF,
    parseBED
  } from '$lib/genome';

  let {
    showGenomicsTools = $bindable(false),
    drag,
    dnaSeq,
    geneFeatures = $bindable(),
    pushLog,
    pushToast
  } = $props<{
    showGenomicsTools: boolean;
    drag: any;
    dnaSeq: string;
    geneFeatures: any[];
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let rbsAtgIndex = $state(100);

  const rbs = $derived(calculateRbsStrength(dnaSeq, rbsAtgIndex - 1));
  const tfbsMatches = $derived(predictTfbsMotifs(dnaSeq));
  const promoters = $derived(predictPromoters(dnaSeq));
  const aaSeq = $derived(getAminoAcidStringFromSequenceString(dnaSeq));
  const localization = $derived(predictSignalPeptide(aaSeq));
  const tmHelices = $derived(predictTransmembraneHelices(aaSeq));
  const sk = $derived(calculateSkew(dnaSeq, 'gc', 100, 20));
  const cpgs = $derived(detectCpGIslands(dnaSeq));
  const tReps = $derived(detectTandemRepeats(dnaSeq));
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 120px; width: 350px; z-index: 60; max-height: 480px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.advancedGenomicsTranscription()}</span>
    <button class="pix-btn-reset" onclick={() => showGenomicsTools = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
    <!-- GFF3/GTF/BED parser section -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 3px;">{m.stepImportAnnotation()}</div>
      <div style="display: flex; gap: 4px;">
        <input 
          type="file" 
          accept=".gff,.gff3,.gtf,.bed" 
          onchange={async (e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) return;
            const text = await f.text();
            let parsed: any[] = [];
            try {
              if (f.name.endsWith('.gff') || f.name.endsWith('.gff3')) {
                parsed = parseGFF3(text);
              } else if (f.name.endsWith('.gtf')) {
                parsed = parseGTF(text);
              } else if (f.name.endsWith('.bed')) {
                parsed = parseBED(text);
              }
              if (parsed.length > 0) {
                geneFeatures = [...geneFeatures, ...parsed.map((feat, idx) => ({
                  id: geneFeatures.length + idx + 1,
                  name: feat.name,
                  start: feat.start + 1,
                  end: feat.end + 1,
                  type: feat.type,
                  color: feat.type === 'cds' ? '#b48cff' : '#ff9f1c'
                }))];
                pushToast('success', m.importGeneGroupAnnotationSuccess(), m.genomicsParsedFeaturesToast({ v1: parsed.length }));
                pushLog(m.genomicsImportLog({ v1: f.name, v2: parsed.length }));
              } else {
                pushToast('warn', m.importWarning(), m.genomicsNoAnnotationLines());
              }
            } catch (err: any) {
              pushToast('error', m.genomicsParseErrorTitle(), err.message);
            }
          }} 
          style="font-size: 8.5px; width: 100%; color: var(--pix-fg-dim);"
        />
      </div>
    </div>

    <!-- Salis-style RBS Strength calculator -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.stepSalisRbs()}</div>
      <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 3px;">
        <span class="pix-dim">{m.genomicsRbsAtgPositionLabel()}</span>
        <input type="number" bind:value={rbsAtgIndex} min={25} style="background: #000; border: 1px solid var(--pix-border); color: #fff; width: 50px; font-size: 9px; text-align: center;" />
      </div>
      <div style="background: rgba(0,0,0,0.2); padding: 4px; border-radius: 2px; font-size: 8.5px; line-height: 1.3;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.genomicsTirScoreLabel()}</span>
          <span style="color: var(--pix-green); font-weight: bold;">{rbs.tirScore} (Arbitrary units)</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.genomicsSdBindingEnergyLabel()}</span>
          <span class="pix-num">{rbs.deltaGSD} kcal/mol</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.genomicsSpacerPenaltyLabel()}</span>
          <span class="pix-num">{rbs.deltaGSpacer} kcal/mol {m.genomicsSpacerLengthValue({ v1: rbs.spacerLength })}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: bold;">
          <span class="pix-dim">{m.genomicsTotalFreeEnergyLabel()}</span>
          <span class="pix-num" style="color: var(--pix-cyan);">{rbs.totalDeltaG} kcal/mol</span>
        </div>
        <div style="font-size: 7.5px; color: var(--pix-fg-dim); margin-top: 1px;">
          {m.genomicsSdOverhangLabel()} <span style="font-family: monospace; color: var(--pix-cyan);">{rbs.sdOverhangSequence}</span> ({m.genomicsAntiSdSeq()})
        </div>
      </div>
    </div>

    <!-- Promoter consensus and Motif scans -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.genomicsSigma70SectionTitle()}</div>
      
      <div style="max-height: 90px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; background: rgba(0,0,0,0.1); padding: 2px;">
        <div class="pix-dim" style="font-size: 7.5px; font-weight: bold; color: var(--pix-cyan); border-bottom: 1px dashed rgba(255,255,255,0.1);">{m.genomicsSigma70PromoterRegionsLabel()}</div>
        {#each promoters.slice(0, 3) as prom}
          <div style="font-size: 8px; display: flex; justify-content: space-between;">
            <span>pos {prom.pos + 1} bp</span>
            <span class="mono" style="color: var(--pix-green);">{prom.sequence}</span>
            <span>Score: {prom.score}%</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center;">{m.genomicsNoStrongPromoter()}</div>
        {/each}

        <div class="pix-dim" style="font-size: 7.5px; font-weight: bold; color: var(--pix-cyan); border-bottom: 1px dashed rgba(255,255,255,0.1); margin-top: 3px;">{m.genomicsTfbsMotifsLabel()}</div>
        {#each tfbsMatches.slice(0, 5) as tf}
          <div style="font-size: 8px; display: flex; justify-content: space-between;">
            <span style="color: var(--pix-accent-2);">{tf.name} ({tf.strand})</span>
            <span>pos {tf.pos + 1} bp</span>
            <span class="mono" style="color: var(--pix-cyan);">{tf.matchSeq}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center;">{m.genomicsNoTfbsFound()}</div>
        {/each}
      </div>
    </div>

    <!-- Protein Localization / Tripartite Signal Peptide -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.genomicsLocalizationSectionTitle()}</div>
      
      <div style="display: flex; flex-direction: column; gap: 3px; font-size: 8.5px; line-height: 1.2;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.genomicsSignalPeptideLabel()}</span>
          <span style="color: {localization.hasSignal ? 'var(--pix-green)' : 'var(--pix-fg-dim)'}; font-weight: bold;">
            {localization.hasSignal ? `YES (Cleaved at pos ${localization.cleavagePos})` : 'NO'}
          </span>
        </div>
        <div style="font-size: 7.5px; color: var(--pix-fg-dim); background: rgba(0,0,0,0.1); padding: 2px;">{localization.details}</div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 1px 0;"></div>

        <div class="pix-dim" style="font-weight: bold;">{m.genomicsTmhmmTitle()}</div>
        {#each tmHelices as tm}
          <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-orange);">
            <span>{m.genomicsTmHelixRange({ v1: tm.start + 1, v2: tm.end + 1 })}</span>
            <span>{m.genomicsTmHydrophobicity({ v1: tm.averageHydro })}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center;">{m.genomicsNoTmHelices()}</div>
        {/each}
      </div>
    </div>

    <!-- Features 11, 12, 13: Skew, CpG, Tandem scan -->
    <div class="pix-panel" style="padding: 5px; border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.01);">
      <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8.5px; margin-bottom: 2px;">{m.genomicsSkewCpgSectionTitle()}</div>
      <div style="display: flex; flex-direction: column; gap: 3px; font-size: 8.5px; line-height: 1.2;">
        <div style="display: flex; justify-content: space-between;">
          <span class="pix-dim">{m.genomicsAvgGcSkewLabel()}</span>
          <span class="pix-num" style="color: var(--pix-cyan); font-weight: bold;">
            {(sk.reduce((acc, p) => acc + p.skew, 0) / Math.max(1, sk.length)).toFixed(3)}
          </span>
        </div>
        
        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 1px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.genomicsCpgIslandsTitle({ v1: cpgs.length })}</div>
        {#each cpgs.slice(0, 3) as cpg}
          <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-green);">
            <span>{m.range()} {cpg.start + 1}-{cpg.end + 1} bp ({cpg.length}bp)</span>
            <span>GC%: {cpg.gcContent}% | Obs/Exp: {cpg.obsExpRatio}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center;">✓ {m.genomicsNoCpgIslands()}</div>
        {/each}

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 1px 0;"></div>
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-orange);">{m.genomicsTandemRepeatsTitle({ v1: tReps.length })}</div>
        {#each tReps.slice(0, 3) as rep}
          <div style="font-size: 8px; display: flex; justify-content: space-between; color: var(--pix-orange);">
            <span>{m.genomicsTandemRepeatItem({ v1: rep.start + 1, v2: rep.end + 1, v3: rep.pattern, v4: rep.repeatCount })}</span>
            <span>{m.genomicsTandemTotalLength({ v1: rep.totalLength })}</span>
          </div>
        {:else}
          <div class="pix-dim" style="font-size: 7.5px; text-align: center;">✓ {m.genomicsNoTandemRepeats()}</div>
        {/each}
      </div>
    </div>
  </div>
</div>
