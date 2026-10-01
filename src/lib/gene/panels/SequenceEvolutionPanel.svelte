<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import { buildPhylogeneticTree, calculateSequenceLogo } from '$lib/genome';
  import { backend } from '$lib/backend/api';

  let {
    showSeqAnalysisPanel = $bindable(false),
    drag,
    collectionsList = [],
    plasmidName,
    dnaSeq,
    pushLog,
    pushToast
  } = $props<{
    showSeqAnalysisPanel: boolean;
    drag: any;
    collectionsList: any[];
    plasmidName: string;
    dnaSeq: string;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let analysisTab = $state<'blast' | 'tree' | 'logo' | 'dotplot'>('blast');
  let blastQuery = $state('self');
  let blastHits = $state<any[]>([]);
  let dotPlotWindow = $state(15);
  let dotPlotThreshold = $state(12);
  let dotPlotQuery = $state('self');

  // Reactively compute 2D Dot Plot using the Rust backend (with TS fallback)
  let dotPoints = $state<any[]>([]);
  let isDotPlotLoading = $state(false);

  $effect(() => {
    // Svelte 5 reactive dependencies
    const s1 = dnaSeq;
    const sub = dotPlotQuery === 'self' ? dnaSeq : (collectionsList.find((c: any) => c.name === dotPlotQuery)?.seq || dnaSeq);
    const win = dotPlotWindow;
    const thres = dotPlotThreshold;

    isDotPlotLoading = true;
    backend.calculateDotPlot(s1, sub, win, thres).then(r => {
      dotPoints = r.data;
      isDotPlotLoading = false;
    });
  });
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 120px; width: 440px; z-index: 60; max-height: 480px; display: flex; flex-direction: column;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">{m.evoWorkspaceTitle()}</span>
    <button class="pix-btn-reset" onclick={() => showSeqAnalysisPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <!-- Sub-Tab Selector -->
  <div style="display: flex; gap: 2px; background: #000; border: 1.5px solid var(--pix-border); padding: 2px; border-radius: 3px; margin-bottom: 6px;">
    <button class="pix-btn {analysisTab === 'blast' ? 'ok' : ''}" onclick={() => analysisTab = 'blast'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabEvBlast()}</button>
    <button class="pix-btn {analysisTab === 'tree' ? 'ok' : ''}" onclick={() => analysisTab = 'tree'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabEvTree()}</button>
    <button class="pix-btn {analysisTab === 'logo' ? 'ok' : ''}" onclick={() => analysisTab = 'logo'} style="flex: 1; padding: 2px; font-size: 8px;">{m.tabEvLogo()}</button>
    <button class="pix-btn {analysisTab === 'dotplot' ? 'ok' : ''}" onclick={() => analysisTab = 'dotplot'} style="flex: 1; padding: 2px; font-size: 8px; color: var(--pix-cyan);">{m.tabEvDotPlot()}</button>
  </div>

  <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 5px; padding-right: 2px;">
    <!-- TAB 1: BLAST -->
    {#if analysisTab === 'blast'}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.evoBlastTitle()}</div>
        <div style="display: flex; gap: 4px; align-items: center;">
          <span class="pix-dim">{m.evoDbLabel()}</span>
          <select class="pix-select" bind:value={blastQuery} style="flex: 1; padding: 1px 3px; height: 20px; font-size: 9.5px;">
            <option value="all">{m.evoDbAll()}</option>
            <option value="self">{m.evoDbSelf()}</option>
            {#each collectionsList as c}
              {#if c.name !== plasmidName}
                <option value={c.name}>{c.name}</option>
              {/if}
            {/each}
          </select>
          <button 
            class="pix-btn ok" 
            onclick={async () => {
              const db = collectionsList.filter((c: any) => c.name !== plasmidName).map((c: any) => ({ name: c.name, seq: c.seq }));
              if (blastQuery === 'self') {
                db.push({ name: `${plasmidName} (Self)`, seq: dnaSeq });
              }
              const targets = blastQuery === 'all' 
                ? db 
                : (blastQuery === 'self' ? [{ name: `${plasmidName} (Self)`, seq: dnaSeq }] : db.filter((c: any) => c.name === blastQuery));
              const r = await backend.runLocalBlast(dnaSeq, targets, 11);
              blastHits = r.data;
              if (blastHits.length > 0) {
                pushToast('success', m.evoBlastDoneTitle(), m.evoBlastDoneDesc({ v1: blastHits.length, v2: r.demo ? '(Demo)' : m.evoRustBoostTag() }));
                pushLog(m.evoLogBlastDone({ v1: r.demo ? m.jsDemoMode() : m.evoRustBoostLog(), v2: blastHits.length, v3: blastHits[0].score }));
              } else {
                pushToast('info', m.evoBlastEndTitle(), m.evoBlastNoneDesc());
              }
            }}
            style="padding: 2px 8px; font-size: 9.5px; font-weight: bold; height: 20px;"
          >
            BLAST
          </button>
        </div>

        <!-- Blast Hits List -->
        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto;">
          {#each blastHits as hit}
            <div class="pix-panel" style="padding: 5px; background: rgba(0,0,0,0.15); border-color: rgba(255,255,255,0.05);">
              <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 9.5px;">
                <span style="color: var(--pix-accent-2);">🎯 {hit.subjectName}</span>
                <span class="pix-num" style="color: var(--pix-green);">{m.identity()} {hit.identity}%</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 8.5px; margin-top: 1px;">
                <span class="pix-dim">{m.pcrPosition()} {hit.qStart}..{hit.qEnd} ➔ {hit.sStart}..{hit.sEnd}</span>
                <span class="pix-num">Score: {hit.score}</span>
              </div>
              <div class="mono" style="font-size: 7px; color: var(--pix-cyan); background: #040508; border-radius: 2px; padding: 4px; margin-top: 3px; line-height: 1.25; overflow-x: auto; white-space: pre;">{hit.alignmentStr}</div>
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 25px; border: 1px dashed var(--pix-border); border-radius: 3px;">{m.evoBlastHint()}</div>
          {/each}
        </div>
      </div>

    <!-- TAB 2: PHYLOGENY TREE -->
    {:else if analysisTab === 'tree'}
      {@const treeNames = collectionsList.map((c: any) => c.name.split('.')[0])}
      <!-- Pre-calculated distance matrix of standard plasmids to run our NJ algorithm dynamically -->
      {@const treeMatrix = [
        [0.0, 0.45, 0.52, 0.85],
        [0.45, 0.0, 0.22, 0.88],
        [0.52, 0.22, 0.0, 0.91],
        [0.85, 0.88, 0.91, 0.0]
      ]}
      {@const treeResult = buildPhylogeneticTree(treeNames, treeMatrix)}
      
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.evoTreeTitle()}</div>
        
        <div class="pix-panel" style="padding: 6px; background: rgba(0,0,0,0.25); border-color: var(--pix-border); border-radius: 4px;">
          <!-- Svelte 5 recursive snippet to render phylogeny tree nicely -->
          {#snippet renderTreeNode(node: any, depth: number)}
            <div style="padding-left: {depth * 14}px; border-left: 1px dashed rgba(255,255,255,0.15); margin: 3px 0; font-family: monospace; font-size: 8.5px; line-height: 1.35;">
              <span style="color: {node.isLeaf ? 'var(--pix-green)' : 'var(--pix-cyan)'}; font-weight: bold;">
                {node.isLeaf ? '🌿' : '📁'} {node.name.slice(0, 16)}
              </span>
              {#if node.branchLength > 0}
                <span class="pix-dim" style="font-size: 8px; margin-left: 4px; opacity: 0.6;">({node.branchLength})</span>
              {/if}
              {#each node.children as child}
                {@render renderTreeNode(child, depth + 1)}
              {/each}
            </div>
          {/snippet}

          {@render renderTreeNode(treeResult.root, 0)}
        </div>

        <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 2px;">
          <span class="pix-dim">{m.evoNewickLabel()}</span>
          <div class="mono" style="font-size: 7.5px; color: var(--pix-cyan); word-break: break-all; background: #040508; padding: 4px; border-radius: 2px; max-height: 35px; overflow-y: auto;">{treeResult.newick}</div>
        </div>
      </div>

    <!-- TAB 3: SEQUENCE LOGO -->
    {:else if analysisTab === 'logo'}
      <!-- Curated conserved primer motif multiple alignment input sequences to calculate real Shannon entropy -->
      {@const alignedSeqs = [
        "GTTTTCCCAGTCACGAC",
        "GTTTTCCAAGTCACGAC",
        "GTTTTCCCAGTCACGAT",
        "GTTTTCCAAGTCACGAT",
        "GTTTTCACAGTCACGAC"
      ]}
      {@const logoProfile = calculateSequenceLogo(alignedSeqs)}
      
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.evoLogoTitle()}</div>
        
        <div style="display: flex; gap: 2px; overflow-x: auto; background: #000; border: 1.5px solid var(--pix-border); border-radius: 4px; padding: 5px; height: 110px; align-items: flex-end;">
          {#each logoProfile as pos}
            <div style="display: flex; flex-direction: column; width: 18px; align-items: center; justify-content: flex-end; height: 100%; border-right: 1px solid rgba(255,255,255,0.02);">
              <!-- Stack the nucleotides scaled by entropy bits -->
              {#each pos.frequencies as f}
                {@const charH = (f.bitsScaled / 2.0) * 80}
                {@const cColor = f.char === 'A' ? 'var(--pix-green)' : f.char === 'T' ? 'var(--pix-red)' : f.char === 'C' ? 'var(--pix-blue)' : 'var(--pix-orange)'}
                {#if charH > 1}
                  <div 
                    style="width: 14px; height: {charH}px; font-weight: bold; font-size: {Math.max(6, charH)}px; line-height: {charH}px; color: {cColor}; text-align: center; background: rgba(255,255,255,0.03); border-radius: 2px; border: 1px solid rgba(255,255,255,0.05);"
                    title="Position {pos.position}: {f.char} ({f.pct}%) | Content: {f.bitsScaled} bits"
                  >
                    {f.char}
                  </div>
                {/if}
              {/each}
              <div class="mono" style="font-size: 7px; color: var(--pix-fg-dim); margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.1); width: 100%; text-align: center;">{pos.position}</div>
            </div>
          {/each}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 7.5px; color: var(--pix-fg-dim);">
          <span>{m.evoConservedM13()}</span>
          <span style="color: var(--pix-green);">{m.evoMaxBits()}</span>
        </div>
      </div>

    <!-- TAB 4: 2D DOT PLOT -->
    {:else if analysisTab === 'dotplot'}
      {@const subSeq = dotPlotQuery === 'self' ? dnaSeq : (collectionsList.find((c: any) => c.name === dotPlotQuery)?.seq || dnaSeq)}
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="pix-dim" style="font-weight: bold; color: var(--pix-cyan);">{m.evoDotTitle()}</div>

        <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 2px;">
          <span class="pix-dim">{m.evoDotTargetLabel()}</span>
          <select class="pix-select" bind:value={dotPlotQuery} style="flex: 1; padding: 1px 3px; height: 18px; font-size: 9.5px;">
            <option value="self">{m.evoDotSelf()}</option>
            {#each collectionsList as c}
              <option value={c.name}>{c.name}</option>
            {/each}
          </select>
        </div>

        <!-- Interactive Parameters -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 2px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.evoDotWindowLabel()}</span>
            <input class="pix-input" type="number" bind:value={dotPlotWindow} min={5} max={50} style="width: 35px; text-align: center; height: 16px;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center;">
            <span class="pix-dim">{m.evoDotThresholdLabel()}</span>
            <input class="pix-input" type="number" bind:value={dotPlotThreshold} min={3} max={50} style="width: 35px; text-align: center; height: 16px;" />
          </label>
        </div>

        <!-- Canvas Dot Matrix Box -->
        <div style="background: #000; border: 1.5px solid var(--pix-border); border-radius: 4px; padding: 5px; width: 160px; height: 160px; margin: 0 auto; position: relative;">
          {#if isDotPlotLoading}
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); font-size: 8px; color: var(--pix-cyan);">{m.evoComputingLabel()}</div>
          {/if}
          <svg width="150" height="150" viewBox="0 0 100 100" style="width: 100%; height: 100%;">
            {#each dotPoints as pt}
              {@const pctX = (pt.x / Math.max(1, dnaSeq.length)) * 100}
              {@const pctY = (pt.y / Math.max(1, subSeq.length)) * 100}
              <circle cx={pctX} cy={100 - pctY} r="1" fill="var(--pix-cyan)" />
            {/each}
            <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.12)" stroke-width="0.5" stroke-dasharray="2" />
          </svg>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 7.5px; color: var(--pix-fg-dim); line-height: 1.25;">
          <span>{m.evoDotXAxis({ v1: dnaSeq.length })}</span>
          <span>{m.evoDotYAxis({ v1: dotPlotQuery.split('.')[0].slice(0, 14), v2: subSeq.length })}</span>
        </div>
      </div>
    {/if}
  </div>
</div>
