<script lang="ts">
  // SPD Gene library panel for the gene workbench: publish the current DNA
  // record, search public genes, and load a gene plus its DNA regions back
  // into the editor.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { spdToken } from '$lib/spd/client';
  import { configureSpdClient } from '$lib/spd/store.svelte';
  import { loadGene, publishGene, type GeneWorkspaceInput, type LoadedSpdGene } from '$lib/spd/genes';
  import { spdInspector } from '$lib/spd/inspector.svelte';
  import type { SpdGeneListRow } from '$lib/spd/types';

  let {
    getWorkspace,
    onLoadGene,
    pushLog,
    pushToast,
  } = $props<{
    getWorkspace: () => GeneWorkspaceInput;
    onLoadGene: (loaded: LoadedSpdGene) => void;
    pushLog?: (msg: string) => void;
    pushToast?: (type: 'success' | 'error' | 'info', title: string, text?: string) => void;
  }>();

  let nameInput = $state('');
  let symbolInput = $state('');
  let geneTypeInput = $state('other');

  onMount(() => {
    const ws = getWorkspace();
    nameInput = ws.name || '';
    symbolInput = ws.symbol || '';
    geneTypeInput = ws.geneType || 'other';
  });

  let publishing = $state(false);
  let publishMessage = $state('');
  let publishedId = $state('');

  let searchQ = $state('');
  let rows = $state<SpdGeneListRow[]>([]);
  let rowsBusy = $state(false);
  let searched = $state(false);
  let listError = $state('');
  let loadBusyId = $state('');

  function rowName(row: SpdGeneListRow): string {
    return row.symbol || row.name || m.spdGeneUnnamed();
  }

  function rowOrganism(row: SpdGeneListRow): string {
    return row.organism?.scientificName || row.organismScientificName || '';
  }

  function rowLength(row: SpdGeneListRow): string {
    const length = row.dnaLength ?? row.rnaLength;
    return typeof length === 'number' ? `${length} bp` : '';
  }

  async function publish() {
    if (!spdToken()) { publishMessage = m.spdNeedToken(); return; }
    const ws = getWorkspace();
    if (!ws.sequence.trim()) { publishMessage = m.spdGenePublishNoSeq(); return; }
    const name = nameInput.trim() || ws.name.trim();
    if (!name) { publishMessage = m.spdGenePublishNoName(); return; }

    publishing = true;
    publishMessage = '';
    publishedId = '';
    try {
      const result = await publishGene({
        ...ws,
        name,
        symbol: symbolInput.trim() || undefined,
        geneType: geneTypeInput,
      });
      publishedId = result.geneId;
      publishMessage = m.spdGenePublishOk({
        id: result.geneId.slice(-8),
        count: String(result.regionCount),
      });
      if (result.regionError) {
        publishMessage += ` · ${m.spdGenePublishRegionWarn({ msg: result.regionError })}`;
      } else if (result.skippedCount) {
        publishMessage += ` · ${m.spdGenePublishSkipped({ count: String(result.skippedCount) })}`;
      }
      pushToast?.('success', m.spdGenePublishTitle(), publishMessage);
      pushLog?.(`[SPD] gene ${result.geneId} regions=${result.regionCount} duplicates=${result.duplicateCount} skipped=${result.skippedCount}`);
    } catch (error) {
      publishMessage = error instanceof Error ? error.message : String(error);
      pushToast?.('error', m.spdGenePublishTitle(), publishMessage);
      pushLog?.(`[SPD] Gene publish failed: ${publishMessage}`);
    } finally {
      publishing = false;
    }
  }

  async function query() {
    rowsBusy = true;
    listError = '';
    searched = false;
    try {
      const client = configureSpdClient();
      const q = searchQ.trim();
      rows = q ? await client.searchGenes(q) : await client.listGenes();
      searched = true;
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error);
      rows = [];
      pushLog?.(`[SPD] Gene search failed: ${listError}`);
    } finally {
      rowsBusy = false;
    }
  }

  async function load(row: SpdGeneListRow) {
    if (loadBusyId) return;
    loadBusyId = row.id;
    try {
      const loaded = await loadGene(row.id);
      onLoadGene(loaded);
      nameInput = row.name || nameInput;
      symbolInput = row.symbol || '';
      geneTypeInput = row.geneType || 'other';
      let loadedMessage: string = m.spdGeneLoadOk({
        name: rowName(row),
        length: String(loaded.sequence.length),
      });
      if (loaded.sourceMolecule === 'rna') loadedMessage += ` · ${m.spdGeneLoadRna()}`;
      pushToast?.('success', m.spdGeneLoadTitle(), loadedMessage);
      pushLog?.(`[SPD] Loaded gene ${row.id} (${loaded.sourceMolecule}, ${loaded.sequence.length} bp, ${loaded.features.length} regions)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast?.('error', m.spdGeneLoadTitle(), message);
      pushLog?.(`[SPD] Gene load failed: ${message}`);
    } finally {
      loadBusyId = '';
    }
  }
</script>

<div class="spd-gene-panel" data-testid="spd-gene-panel">
  <div class="hint pix-dim">{m.spdGeneHint()}</div>

  <div class="publish-box">
    <div class="form-row">
      <label>{m.spdGeneNameLabel()}
        <input class="pix-input" data-testid="spd-gene-name" type="text" bind:value={nameInput} />
      </label>
      <label>{m.spdGeneSymbolLabel()}
        <input class="pix-input" type="text" bind:value={symbolInput} />
      </label>
    </div>
    <div class="form-row type-row">
      <label>{m.spdGeneTypeLabel()}
        <select class="pix-select" bind:value={geneTypeInput}>
          <option value="protein_coding">{m.spdGeneTypeProteinCoding()}</option>
          <option value="non_coding">{m.spdGeneTypeNonCoding()}</option>
          <option value="regulatory">{m.spdGeneTypeRegulatory()}</option>
          <option value="other">{m.spdGeneTypeOther()}</option>
        </select>
      </label>
      <button class="pix-btn ok" type="button" disabled={publishing} onclick={publish}>
        {publishing ? m.spdGenePublishing() : m.spdGenePublishBtn()}
      </button>
    </div>
    {#if publishMessage}<div class="message">{publishMessage}</div>{/if}
    {#if publishedId}
      <div class="published-row">
        <span class="pix-dim">{m.spdGenePublishedLabel()}</span>
        <code>{publishedId}</code>
        <button class="pix-btn" type="button" onclick={() => spdInspector.open('gene', publishedId)}>
          {m.spdInspectorDetails()}
        </button>
      </div>
    {/if}
  </div>

  <div class="search-box">
    <div class="load-row">
      <input class="pix-input" data-testid="spd-gene-search" type="search" placeholder={m.spdGeneSearchPlaceholder()} bind:value={searchQ}
        onkeydown={(event) => { if (event.key === 'Enter') void query(); }} />
      <button class="pix-btn" data-testid="spd-gene-search-btn" type="button" disabled={rowsBusy} onclick={query}>
        {rowsBusy ? m.spdGeneListLoading() : m.spdGeneSearchBtn()}
      </button>
    </div>
    {#if listError}<div class="message error">{listError}</div>{/if}
    {#if rows.length}
      <ul class="gene-list">
        {#each rows as row (row.id)}
          <li>
            <div class="gene-main">
              <span class="gene-name">{rowName(row)}</span>
              <span class="pix-dim">{row.geneType || m.spdGeneTypeOther()} · {rowOrganism(row)}{rowLength(row) ? ` · ${rowLength(row)}` : ''}</span>
            </div>
            <button class="pix-btn" type="button" onclick={() => spdInspector.open('gene', row.id, rowName(row))}>
              {m.spdInspectorDetails()}
            </button>
            <button class="pix-btn" data-testid="spd-gene-load" type="button" disabled={loadBusyId !== ''} onclick={() => load(row)}>
              {loadBusyId === row.id ? m.spdGeneListLoading() : m.spdGeneLoadBtn()}
            </button>
          </li>
        {/each}
      </ul>
    {:else if searched && !rowsBusy && !listError}
      <div class="pix-dim empty">{m.spdGeneSearchEmpty()}</div>
    {/if}
  </div>
</div>

<style>
  .spd-gene-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px; font-family: var(--pix-font); font-size: 10px; }
  .hint { font-size: 9px; }
  .publish-box, .search-box { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--pix-border); padding: 6px; }
  .form-row { display: flex; gap: 6px; align-items: flex-end; }
  .form-row label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; color: var(--pix-fg-dim); }
  .form-row input, .form-row select { min-width: 0; padding: 2px 4px; font-size: 10px; height: 22px; }
  .type-row { align-items: flex-end; }
  .type-row label { flex: 0 0 180px; }
  .type-row button { flex: 1; height: 22px; padding: 2px 8px; font-size: 10px; }
  .load-row { display: flex; gap: 4px; align-items: center; }
  .load-row input { flex: 1; min-width: 0; padding: 2px 4px; font-size: 9.5px; height: 20px; }
  .message { padding: 4px 6px; border: 1px solid var(--pix-border); color: var(--pix-fg-dim); word-break: break-word; }
  .message.error { color: var(--pix-red); border-color: var(--pix-red); }
  .published-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .published-row code { flex: 1; min-width: 0; color: var(--pix-cyan); font-size: 9px; word-break: break-all; }
  .gene-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow: auto; }
  .gene-list li { display: flex; align-items: center; gap: 5px; border: 1px solid var(--pix-border); padding: 3px 5px; background: rgba(0, 0, 0, 0.25); }
  .gene-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .gene-name { color: var(--pix-cyan); font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gene-main .pix-dim { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 3px 1px; }
</style>
