<script lang="ts">
  import { currentLocale } from '$lib/i18n.svelte.ts';
  function t(zh: string, en: string): string {
    return currentLocale.value === 'zh' ? zh : en;
  }
  import * as m from '$lib/paraglide/messages.js';

  import { GitBranch, Clock, ArrowDown, ChevronRight } from 'lucide-svelte';

  // Standard cloning history element interface
  interface HistoryNode {
    productName: string;
    size: number;
    timestamp: string;
    parentVector: string;
    parentVectorSize: number;
    insertName: string;
    insertSize: number;
    leftEnzyme: string;
    rightEnzyme: string;
  }

  let {
    historyList = [] as HistoryNode[],
    onNodeClick = null
  } = $props<{
    historyList: HistoryNode[];
    onNodeClick?: (event: { type: 'vector' | 'insert' | 'product'; name: string; size: number; fullNode: HistoryNode }) => void;
  }>();

  // Selected/Expanded state for details (Feature 4/20)
  let expandedNodes = $state<Record<number, boolean>>({});

  const ENZYME_OVERHANGS: Record<string, { top: string; bot: string; type: '5prime' | '3prime'; len: number }> = {
    EcoRI: { top: 'G', bot: 'AATTC', type: '5prime', len: 4 },
    BamHI: { top: 'G', bot: 'GATCC', type: '5prime', len: 4 },
    HindIII: { top: 'A', bot: 'AGCTT', type: '5prime', len: 4 },
    SalI: { top: 'G', bot: 'TCGAC', type: '5prime', len: 4 },
    XhoI: { top: 'C', bot: 'TCGAG', type: '5prime', len: 4 },
    NdeI: { top: 'CA', bot: 'TATG', type: '5prime', len: 2 },
    SacI: { top: 'GAGCT', bot: 'C', type: '3prime', len: 4 },
    KpnI: { top: 'GGTAC', bot: 'C', type: '3prime', len: 4 },
  };
</script>

<style>
  .clickable-node {
    cursor: pointer;
    transition: all 0.2s ease-in-out;
  }
  .clickable-node:hover {
    filter: brightness(1.2);
    box-shadow: 0 0 8px var(--pix-accent-2);
    transform: scale(1.02);
  }
</style>

<div class="history-tree-box" style="display: flex; flex-direction: column; gap: 6px; font-family: var(--pix-font);">
  <div class="pix-title" style="color: var(--pix-cyan); font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
    <GitBranch size={11} /> {m.labelCloningLineageTree()}
  </div>

  <div class="history-workspace" style="background: #080a10; border: 2px solid var(--pix-border); padding: 8px; border-radius: 4px; box-shadow: inset 0 0 15px rgba(0,0,0,0.8); min-height: 120px; max-height: 200px; overflow-y: auto;">
    {#if historyList.length === 0}
      <!-- Initial Parent State (Standard Vector) -->
      <div style="display: flex; align-items: center; justify-content: center; height: 100px; flex-direction: column; gap: 4px;">
        <svg width="60" height="60" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="14" fill="none" stroke="var(--pix-accent-2)" stroke-width="2" stroke-dasharray="3 3" />
          <text x="20" y="22" fill="var(--pix-fg)" font-size="4px" font-family="var(--pix-font)" text-anchor="middle">WildType</text>
        </svg>
        <span class="pix-dim" style="font-size: 10px;">{m.labelNoCloningHistory()}</span>
      </div>
    {:else}
      <!-- Ancestor Genealogy Flow Diagram using vector SVGs -->
      <div style="display: flex; flex-direction: column; gap: 12px; align-items: center; padding: 4px 0;">
        {#each historyList as node, idx}
          <!-- Node box -->
          <div style="display: flex; gap: 12px; align-items: center; justify-content: center; width: 100%;">
            <!-- Left parent (Vector) -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="pix-panel clickable-node" style="padding: 4px 8px; text-align: center; width: 100px; border-color: rgba(255,255,255,0.15);" onclick={() => onNodeClick?.({ type: 'vector', name: node.parentVector, size: node.parentVectorSize, fullNode: node })}>
              <div class="pix-dim" style="font-size: 8px;">{m.vector()}</div>
              <div style="font-size: 9px; color: var(--pix-cyan); font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{node.parentVector}</div>
              <div class="pix-num" style="font-size: 8px;">{node.parentVectorSize} bp</div>
            </div>

            <div style="font-size: 12px; color: var(--pix-dim);">+</div>

            <!-- Right parent (Insert) -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="pix-panel clickable-node" style="padding: 4px 8px; text-align: center; width: 100px; border-color: var(--pix-accent-2);" onclick={() => onNodeClick?.({ type: 'insert', name: node.insertName, size: node.insertSize, fullNode: node })}>
              <div class="pix-dim" style="font-size: 8px;">{m.insert()}</div>
              <div style="font-size: 9px; color: var(--pix-accent-2); font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{node.insertName.split(' ')[0]}</div>
              <div class="pix-num" style="font-size: 8px;">{node.insertSize} bp</div>
            </div>
          </div>

          <!-- Operation and junction info -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <ArrowDown size={12} style="color: var(--pix-dim);" />
            <div style="font-size: 8px; background: #1a1e2a; color: var(--pix-green); border: 1px solid var(--pix-border); padding: 1px 6px; border-radius: 2px; text-align: center;">
              {m.physicalDigestionLigation()} [T4 Ligation] / {node.leftEnzyme} + {node.rightEnzyme}
            </div>
            <ArrowDown size={12} style="color: var(--pix-dim);" />
          </div>

          <!-- Resulting Product Node -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="pix-panel clickable-node" style="padding: 6px 12px; border-color: var(--pix-green); text-align: center; width: 180px; box-shadow: 0 0 5px rgba(83, 215, 105, 0.2);" onclick={() => onNodeClick?.({ type: 'product', name: node.productName, size: node.size, fullNode: node })}>
            <div class="pix-dim" style="font-size: 8px; color: var(--pix-green); font-weight: bold;">{m.labelRecombinantProduct()}</div>
            <div style="font-size: 10px; color: var(--pix-green); font-weight: bold;">{node.productName}</div>
            <div class="pix-num" style="font-size: 9px; color: var(--pix-fg);">{node.size} bp</div>
            <div class="pix-dim" style="font-size: 7px; display: inline-flex; align-items: center; gap: 2px; margin-top: 2px;">
              <Clock size={8} /> {new Date(node.timestamp).toLocaleTimeString()}
            </div>
          </div>

          <!-- Collapsible Ligation Overhang Detail Block (Feature 4/20) -->
          <button 
            class="pix-btn-reset" 
            onclick={() => expandedNodes[idx] = !expandedNodes[idx]} 
            style="font-size: 8.5px; color: var(--pix-cyan); cursor: pointer; display: inline-flex; align-items: center; gap: 2px; margin-top: 1px;"
          >
            <ChevronRight size={10} style="transform: rotate({expandedNodes[idx] ? '90deg' : '0deg'}); transition: transform 0.2s;" />
            {expandedNodes[idx] ? m.labelCancel() : m.labelJunctionDetails()}
          </button>

          {#if expandedNodes[idx]}
            <div class="pix-panel" style="width: 220px; font-family: monospace; font-size: 7.5px; background: rgba(0,0,0,0.5); padding: 5px; margin-top: 2px; border-color: rgba(255,255,255,0.05); line-height: 1.25; display: flex; flex-direction: column; gap: 3.5px; text-align: left;">
              <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 8px;">{m.labelJunctionLeft()} ({node.leftEnzyme}):</div>
              {#if ENZYME_OVERHANGS[node.leftEnzyme]}
                {@const o = ENZYME_OVERHANGS[node.leftEnzyme]}
                {#if o.type === '5prime'}
                  <div style="color: var(--pix-green);">Vec  5'-... {o.top}      [Ligate]      {o.bot.slice(0, o.len)}... -3'</div>
                  <div style="opacity: 0.3; letter-spacing: 1px;">            |                    |</div>
                  <div style="color: var(--pix-cyan);">Ins  3'-... {o.bot.slice(0, o.len)}   [Ligate]   {o.top}... -5'</div>
                {:else}
                  <div style="color: var(--pix-green);">Vec  5'-... {o.top}   [Ligate]   {o.top.slice(-o.len)}... -3'</div>
                  <div style="opacity: 0.3; letter-spacing: 1px;">            |                    |</div>
                  <div style="color: var(--pix-cyan);">Ins  3'-... {o.bot.slice(-o.len)}      [Ligate]      {o.bot}... -5'</div>
                {/if}
              {:else}
                <div class="pix-dim" style="text-align: center;">({m.labelBluntJunction()})</div>
              {/if}

              <div style="border-top: 1px dashed rgba(255,255,255,0.08); margin: 2px 0;"></div>

              <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 8px;">{m.labelJunctionRight()} ({node.rightEnzyme}):</div>
              {#if ENZYME_OVERHANGS[node.rightEnzyme]}
                {@const o = ENZYME_OVERHANGS[node.rightEnzyme]}
                {#if o.type === '5prime'}
                  <div style="color: var(--pix-cyan);">Ins  5'-... {o.top}      [Ligate]      {o.bot.slice(0, o.len)}... -3'</div>
                  <div style="opacity: 0.3; letter-spacing: 1px;">            |                    |</div>
                  <div style="color: var(--pix-green);">Vec  3'-... {o.bot.slice(0, o.len)}   [Ligate]   {o.top}... -5'</div>
                {:else}
                  <div style="color: var(--pix-cyan);">Ins  5'-... {o.top}   [Ligate]   {o.top.slice(-o.len)}... -3'</div>
                  <div style="opacity: 0.3; letter-spacing: 1px;">            |                    |</div>
                  <div style="color: var(--pix-green);">Vec  3'-... {o.bot.slice(-o.len)}      [Ligate]      {o.bot}... -5'</div>
                {/if}
              {:else}
                <div class="pix-dim" style="text-align: center;">({m.labelBluntJunction()})</div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
