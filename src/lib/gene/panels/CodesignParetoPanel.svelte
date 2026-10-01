<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';
  import { backend } from '$lib/backend/api';
  import { Divider, Button, ProgressBar } from 'svelte-multistyle-ui';
  import { Sparkles, BarChart2, Layers, Check, RefreshCw } from 'lucide-svelte';

  let {
    showCodesignPanel = $bindable(false),
    drag,
    plasmidName,
    dnaSeq = $bindable(),
    features = [],
    codonHost = 'ecoli',
    pushLog,
    pushToast
  } = $props<{
    showCodesignPanel: boolean;
    drag: any;
    plasmidName: string;
    dnaSeq: string;
    features: any[];
    codonHost: 'ecoli' | 'yeast' | 'human';
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  // Try to find the first CDS or ORF feature in plasmid automatically
  let cdsStart = $state(0);
  let cdsEnd = $state(0);
  let cdsFeatureName = $state('');

  $effect(() => {
    // Automatically find CDS feature
    const cdsFeat = features.find((f: any) => f.type?.toUpperCase() === 'CDS' || f.ftype?.toUpperCase() === 'CDS');
    if (cdsFeat) {
      cdsStart = cdsFeat.start ?? 0;
      cdsEnd = cdsFeat.end ?? (dnaSeq.length - 1);
      cdsFeatureName = cdsFeat.name ?? 'CDS';
    } else {
      cdsStart = 0;
      cdsEnd = Math.floor(dnaSeq.length / 3) * 3 - 1;
      cdsFeatureName = 'Default CDS (Full)';
    }
  });

  // Candidate Mutants list for evaluation
  let candidatesText = $state(`Variant_V1,V15A,-4.5
Variant_V2,I32L + L45M,-1.2
Variant_V3,V15A + I32L,-5.8
Variant_V4,V15A + L45M + I32L,-6.2
Variant_V5,I32L + L45M + L50M,-2.1`);

  let variants = $state<any[]>([]);
  let isEvaluating = $state(false);

  // Parse mutations and send to Rust
  async function runParetoOptimization() {
    if (isEvaluating) return;
    isEvaluating = true;
    variants = [];

    try {
      const lines = candidatesText.trim().split('\n');
      const mutationsRequest: any[] = [];

      for (const line of lines) {
        if (!line.trim() || line.startsWith('#')) continue;
        const parts = line.split(',');
        if (parts.length < 3) continue;

        const id = parts[0].trim();
        const label = parts[1].trim();
        const energyDelta = parseFloat(parts[2].trim()) || 0;

        // Parse individual mutations (e.g., "V15A + L45M")
        const singleMuts = label.split('+');
        const aaPositions: number[] = [];
        const targetAas: string[] = [];

        for (const m of singleMuts) {
          const match = m.trim().match(/^([A-Z])(\d+)([A-Z])$/);
          if (match) {
            const from = match[1];
            // 1-based natural position converted to 0-based index
            const pos = parseInt(match[2]) - 1;
            const to = match[3];
            aaPositions.push(pos);
            targetAas.push(to);
          }
        }

        if (aaPositions.length > 0) {
          mutationsRequest.push({
            id,
            label,
            aaPositions,
            targetAas,
            proteinEnergyDelta: energyDelta
          });
        }
      }

      if (mutationsRequest.length === 0) {
        pushToast('error', m.parsingFailed(), m.pleaseCheckCandidateListFormat());
        isEvaluating = false;
        return;
      }

      // Call Rust Pareto solver
      const r = await backend.paretoCodesignEvaluate({
        dnaSequence: dnaSeq,
        cdsStart,
        cdsEnd,
        host: codonHost,
        mutations: mutationsRequest
      });

      if (r.error) {
        pushToast('warning', m.evaluationWarning(), r.error);
      }

      variants = r.data;
      const paretoCount = variants.filter(v => v.isParetoOptimal).length;
      pushLog(m.codesignDoneLog({ v1: variants.length, v2: codonHost, v3: paretoCount }));
      pushToast('success', m.coDesignComplete(), m.codesignParetoFound({ paretoCount: paretoCount }));

    } catch (e: any) {
      pushToast('error', m.optimizationError(), String(e));
    } finally {
      isEvaluating = false;
    }
  }

  function applyDnaVariant(v: any) {
    dnaSeq = v.updatedDna;
    pushLog(m.codesignApplyVariantLog({ v1: v.id, v2: v.mutations }));
    pushToast('success', m.dnaApplied(), m.variantVIdSequenceLoaded({ id: v.id }));
  }

  // Scatter plot SVG scaling variables
  const plotW = 380;
  const plotH = 140;
  const margin = { top: 15, right: 15, bottom: 25, left: 35 };

  const bounds = $derived.by(() => {
    if (variants.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = variants.map(v => v.proteinEnergyDelta);
    const ys = variants.map(v => v.cai);
    const minX = Math.min(...xs, 0) - 1.0;
    const maxX = Math.max(...xs, 0) + 1.0;
    const minY = Math.max(Math.min(...ys, 0.5) - 0.05, 0);
    const maxY = Math.min(Math.max(...ys, 1.0) + 0.05, 1.0);
    return { minX, maxX, minY, maxY };
  });

  function getSvgCoords(x: number, y: number) {
    const { minX, maxX, minY, maxY } = bounds;
    const px = margin.left + ((x - minX) / (maxX - minX)) * (plotW - margin.left - margin.right);
    const py = plotH - margin.bottom - ((y - minY) / (maxY - minY)) * (plotH - margin.top - margin.bottom);
    return { x: px, y: py };
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 20px; top: 160px; width: 440px; z-index: 85; max-height: 520px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">
      <Sparkles size={13} style="color: var(--pix-accent);" /> {m.codesignPanelTitle()}
    </span>
    <button class="pix-btn-reset" onclick={() => showCodesignPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 8px; padding-right: 2px;">
    
    <!-- Meta and Range Configuration -->
    <div class="pix-panel" style="padding: 6px; background: rgba(0,0,0,0.15); border-color: rgba(255,255,255,0.05);">
      <div style="display: flex; gap: 6px; justify-content: space-between; margin-bottom: 4px;">
        <span class="pix-dim">{m.codonHostLabel()}</span>
        <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{codonHost.toUpperCase()}</span>
      </div>
      <div style="display: flex; gap: 6px; justify-content: space-between;">
        <span class="pix-dim">{m.codesignDetectedCdsLabel()}</span>
        <span class="pix-num" style="color: var(--pix-cyan);">{cdsFeatureName} ({cdsStart} - {cdsEnd} bp)</span>
      </div>
    </div>

    <!-- Candidate Input Area -->
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="pix-dim" style="font-weight: bold;">{m.codesignCandidateInputLabel()}</span>
        <span class="pix-dim" style="font-size: 8px; color: var(--pix-accent-2);">{m.codesignMultiMutationHint()}</span>
      </div>
      <textarea 
        class="pix-textarea mono" 
        bind:value={candidatesText}
        rows="4" 
        style="width: 100%; box-sizing: border-box; background: #0c0800; border: 1.5px solid var(--pix-border); color: #fff; padding: 4px; font-size: 9px; line-height: 1.25;"
        placeholder="Variant_ID, Mutations, Protein_Delta_E\nVariant_1, V15A + I32L, -5.8"
      ></textarea>
    </div>

    <div style="display: flex; gap: 6px; align-items: center;">
      <Button style="pixel" theme="midnight" icon="" variant="filled" preset="primary" disabled={isEvaluating} onclick={runParetoOptimization} class="wide-btn">
        {#snippet children()}
          {#if isEvaluating}
            <RefreshCw size={11} class="spin" /> {m.codesignOptimizingBtn()}
          {:else}
            {m.codesignRunBtn()}
          {/if}
        {/snippet}
      </Button>
    </div>

    <!-- Scatter Plot Visualizer -->
    {#if variants.length > 0}
      <div class="pix-panel" style="padding: 8px; display: flex; flex-direction: column; align-items: center;">
        <div class="pix-title" style="color: var(--pix-accent-2); font-size: 10px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; width: 100%;">
          <BarChart2 size={12} /> {m.codesignPlotTitle()}
        </div>
        
        <svg width={plotW} height={plotH} style="background: #020202; border: 1.5px solid var(--pix-border); border-radius: 2px;">
          <!-- Grid lines -->
          {#each [0.2, 0.4, 0.6, 0.8] as gridY}
            {@const yPos = plotH - margin.bottom - gridY * (plotH - margin.top - margin.bottom)}
            <line x1={margin.left} y1={yPos} x2={plotW - margin.right} y2={yPos} stroke="rgba(255,255,255,0.05)" stroke-dasharray="1 3" />
          {/each}

          <!-- Axis Lines -->
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={plotH - margin.bottom} stroke="var(--pix-border)" />
          <line x1={margin.left} y1={plotH - margin.bottom} x2={plotW - margin.right} y2={plotH - margin.bottom} stroke="var(--pix-border)" />

          <!-- Axis Labels -->
          <text x={plotW / 2 + 10} y={plotH - 4} fill="var(--pix-fg-dim)" font-size="7px" text-anchor="middle">ΔE (kcal/mol)</text>
          <text x={5} y={plotH / 2 - 5} fill="var(--pix-fg-dim)" font-size="7px" transform="rotate(-90 5 {plotH / 2 - 5})" text-anchor="middle">CAI</text>

          <!-- Draw Points and Connections -->
          {#each variants as v}
            {@const pt = getSvgCoords(v.proteinEnergyDelta, v.cai)}
            <circle cx={pt.x} cy={pt.y} r={v.isParetoOptimal ? 4.5 : 3} fill={v.isParetoOptimal ? 'var(--pix-green)' : 'rgba(255,255,255,0.25)'} stroke={v.isParetoOptimal ? '#fff' : 'none'} stroke-width="1" />
            <text x={pt.x + 6} y={pt.y + 2.5} fill={v.isParetoOptimal ? 'var(--pix-green)' : 'var(--pix-fg-dim)'} font-size="7px">{v.id}</text>
          {/each}
        </svg>
        <div class="legend pix-dim" style="margin-top: 4px; font-size: 8.5px; display: flex; gap: 8px; justify-content: center; width: 100%;">
          <span><span style="color: var(--pix-green);">●</span> {m.codesignLegendPareto()}</span>
          <span><span style="color: rgba(255,255,255,0.3);">●</span> {m.codesignLegendDominated()}</span>
        </div>
      </div>

      <!-- Results Table -->
      <table class="mut-table" style="font-size: 9px; line-height: 1.2; width: 100%;">
        <thead>
          <tr>
            <th>ID</th>
            <th>{m.codesignColMutLabel()}</th>
            <th>{m.codesignColProteinDeltaE()}</th>
            <th>CAI</th>
            <th>5' mRNA ΔG</th>
            <th>{m.codesignColOptimal()}</th>
            <th>{m.codesignColAction()}</th>
          </tr>
        </thead>
        <tbody>
          {#each variants as v}
            <tr style="background: {v.isParetoOptimal ? 'rgba(0,255,0,0.03)' : 'transparent'}">
              <td class="pix-num" style="font-weight: bold; color: {v.isParetoOptimal ? 'var(--pix-green)' : 'var(--pix-fg)'}">{v.id}</td>
              <td class="mono" style="color: var(--pix-accent-2);">{v.mutations}</td>
              <td class="pix-num {v.proteinEnergyDelta <= -3 ? 'good' : ''}">{v.proteinEnergyDelta.toFixed(1)}</td>
              <td class="pix-num {v.cai >= 0.8 ? 'good' : ''}">{v.cai.toFixed(3)}</td>
              <td class="pix-num" style="color: {v.mrnaDeltaG <= -10 ? 'var(--pix-yellow)' : 'var(--pix-cyan)'}">{v.mrnaDeltaG.toFixed(1)}</td>
              <td>
                {#if v.isParetoOptimal}
                  <span class="pix-badge ok" style="padding: 1px 4px; font-size: 8px;">PARETO</span>
                {:else}
                  <span class="pix-dim" style="font-size: 8px;">{m.codesignLegendDominated()}</span>
                {/if}
              </td>
              <td>
                <button class="pix-btn-reset" onclick={() => applyDnaVariant(v)} style="padding: 1px 4px; font-size: 8px; font-weight: bold; cursor: pointer; color: var(--pix-green); border: 1px solid var(--pix-green); border-radius: 2px;">
                  [{m.apply()}]
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    
  </div>
</div>
