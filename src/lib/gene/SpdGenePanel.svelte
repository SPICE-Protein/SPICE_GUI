<script lang="ts">
  // SPD library panel for the gene workbench. Three tabs share one floating
  // window: public genes, BioBrick parts, and the signed-in user's own SPD
  // records (GET /user/me/activity, which includes batch imports).
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { spdToken } from '$lib/spd/client';
  import { configureSpdClient } from '$lib/spd/store.svelte';
  import { loadGene, publishGene, type GeneWorkspaceInput, type LoadedSpdGene } from '$lib/spd/genes';
  import {
    BIOBRICK_PART_TYPES, loadBiobrick, publishBiobrick,
    type LoadedSpdBiobrick,
  } from '$lib/spd/biobricks';
  import { loadVectorTemplate, type LoadedVectorTemplate } from '$lib/spd/vectors';
  import { spdInspector } from '$lib/spd/inspector.svelte';
  import { riskCatalogStore } from '$lib/biosec/store.svelte';
  import { screenSequence } from '$lib/biosec/screen';
  import type { SpdActivitySubmission, SpdBiobrickSummary, SpdGeneListRow } from '$lib/spd/types';

  let {
    getWorkspace,
    onLoadGene,
    onLoadVector,
    onLoadBiobrick,
    pushLog,
    pushToast,
  } = $props<{
    getWorkspace: () => GeneWorkspaceInput;
    onLoadGene: (loaded: LoadedSpdGene) => void;
    onLoadVector?: (loaded: LoadedVectorTemplate) => void;
    onLoadBiobrick?: (loaded: LoadedSpdBiobrick) => void;
    pushLog?: (msg: string) => void;
    pushToast?: (type: 'success' | 'error' | 'info', title: string, text?: string) => void;
  }>();

  type Tab = 'genes' | 'biobricks' | 'mine';
  let tab = $state<Tab>('genes');

  let nameInput = $state('');
  let symbolInput = $state('');
  let geneTypeInput = $state('other');

  onMount(() => {
    const ws = getWorkspace();
    nameInput = ws.name || '';
    symbolInput = ws.symbol || '';
    geneTypeInput = ws.geneType || 'other';
    brickNameInput = ws.name || '';
    brickPartType = inferPartType(ws);
  });

  function inferPartType(ws: GeneWorkspaceInput): string {
    const types = (ws.features ?? []).map((f) => String(f.type ?? '').toLowerCase());
    for (const candidate of ['promoter', 'rbs', 'terminator', 'cds', 'protein_tag', 'regulatory']) {
      if (types.some((t) => t === candidate || (candidate === 'cds' && t === 'gene'))) return candidate;
    }
    return 'other';
  }

  // ---------------- Genes ----------------
  let publishing = $state(false);
  let publishMessage = $state('');
  let publishedId = $state('');

  let searchQ = $state('');
  let rows = $state<SpdGeneListRow[]>([]);
  let rowsBusy = $state(false);
  let searched = $state(false);
  let listError = $state('');
  let loadBusyId = $state('');
  /** gene id → encoded protein label, filled by one graph query per search. */
  let rowProteins = $state<Record<string, string>>({});

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
    const exact = screenSequence(ws.sequence, riskCatalogStore.catalogs, {
      circular: ws.circular,
    });
    const biorisk = await riskCatalogStore.screenBiorisk(ws.sequence, ws.circular);
    const blocking = [...exact, ...biorisk].filter(
      (finding) => finding.severity === 'blocking',
    );
    if (blocking.length > 0) {
      publishMessage = m.riskExportBlockedBody({ v1: blocking.length });
      return;
    }

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

  /** One graph read hydrates the visible rows with the protein each gene
   *  encodes. It is a supplement to the list: a failure leaves the rows as
   *  they are instead of turning the search into an error. */
  async function hydrateProteins(rows: SpdGeneListRow[]) {
    if (!rows.length) { rowProteins = {}; return; }
    try {
      const data = await configureSpdClient().graphQuery({
        roots: rows.slice(0, 25).map((row) => ({
          type: 'gene', id: row.id, select: ['id'],
          expand: { proteins: { select: ['id', 'preferredName', 'geneName'], limit: 1 } },
        })),
      });
      const map: Record<string, string> = {};
      for (const node of data.results) {
        const proteins = (node as { proteins?: Array<Record<string, unknown>> }).proteins;
        const protein = Array.isArray(proteins) ? proteins[0] : undefined;
        const label = protein && (protein.preferredName ?? protein.geneName ?? protein.id);
        if (node.id && label) map[node.id] = String(label);
      }
      rowProteins = map;
    } catch {
      rowProteins = {};
    }
  }

  async function query() {
    rowsBusy = true;
    listError = '';
    searched = false;
    rowProteins = {};
    try {
      const client = configureSpdClient();
      const q = searchQ.trim();
      rows = q ? await client.searchGenes(q) : await client.listGenes();
      searched = true;
      void hydrateProteins(rows);
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

  // ---------------- BioBricks ----------------
  let brickNameInput = $state('');
  let brickDescription = $state('');
  let brickPartType = $state('other');
  let brickPublishing = $state(false);
  let brickMessage = $state('');
  let publishedBrickId = $state('');

  let brickQ = $state('');
  let brickFilter = $state('');
  let bricks = $state<SpdBiobrickSummary[]>([]);
  let bricksBusy = $state(false);
  let bricksSearched = $state(false);
  let bricksError = $state('');
  let brickLoadId = $state('');

  function partTypeLabel(partType: string): string {
    switch (partType) {
      case 'promoter': return m.spdBrickPartPromoter();
      case 'rbs': return m.spdBrickPartRbs();
      case 'terminator': return m.spdBrickPartTerminator();
      case 'cds': return m.spdBrickPartCds();
      case 'protein_tag': return m.spdBrickPartProteinTag();
      case 'regulatory': return m.spdBrickPartRegulatory();
      default: return m.spdBrickPartOther();
    }
  }

  async function publishBrick() {
    if (!spdToken()) { brickMessage = m.spdNeedToken(); return; }
    const ws = getWorkspace();
    if (!ws.sequence.trim()) { brickMessage = m.spdBrickNoSeq(); return; }
    const name = brickNameInput.trim() || ws.name.trim();
    if (!name) { brickMessage = m.spdBrickNoName(); return; }

    brickPublishing = true;
    brickMessage = '';
    publishedBrickId = '';
    try {
      const receipt = await publishBiobrick({
        name,
        sequence: ws.sequence,
        description: brickDescription,
        partType: brickPartType,
        metadata: { source: 'SPICE GUI', tool: 'gene workbench', host: ws.host },
      });
      publishedBrickId = receipt.id;
      brickMessage = m.spdBrickPublishOk({ id: receipt.id });
      pushToast?.('success', m.spdBrickPublishTitle(), brickMessage);
      pushLog?.(`[SPD] BioBrick ${receipt.id} partType=${receipt.partType} length=${receipt.length ?? ws.sequence.length}`);
      await queryBricks();
    } catch (error) {
      brickMessage = error instanceof Error ? error.message : String(error);
      pushToast?.('error', m.spdBrickPublishTitle(), brickMessage);
      pushLog?.(`[SPD] BioBrick publish failed: ${brickMessage}`);
    } finally {
      brickPublishing = false;
    }
  }

  async function queryBricks() {
    bricksBusy = true;
    bricksError = '';
    bricksSearched = false;
    try {
      const client = configureSpdClient();
      const q = brickQ.trim();
      let result = q
        ? await client.searchBiobricks(q)
        : await client.listBiobricks(brickFilter || undefined);
      if (q && brickFilter) result = result.filter((row) => row.partType === brickFilter);
      bricks = result;
      bricksSearched = true;
    } catch (error) {
      bricksError = error instanceof Error ? error.message : String(error);
      bricks = [];
      pushLog?.(`[SPD] BioBrick search failed: ${bricksError}`);
    } finally {
      bricksBusy = false;
    }
  }

  async function loadBrick(row: SpdBiobrickSummary) {
    if (brickLoadId) return;
    brickLoadId = row.id;
    try {
      const loaded = await loadBiobrick(row.id);
      onLoadBiobrick?.(loaded);
      let message: string = m.spdBrickLoadOk({
        name: loaded.record.name || row.name,
        length: String(loaded.sequence.length),
      });
      if (loaded.sourceMolecule === 'rna') message += ` · ${m.spdBrickLoadRna()}`;
      if (loaded.vectors.length) message += ` · ${m.spdBrickVectorCount({ count: String(loaded.vectors.length) })}`;
      pushToast?.('success', m.spdBrickLoadTitle(), message);
      pushLog?.(`[SPD] Loaded BioBrick ${row.id} (${loaded.sourceMolecule}, ${loaded.sequence.length} bp, ${loaded.vectors.length} linked vector(s))`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast?.('error', m.spdBrickLoadTitle(), message);
      pushLog?.(`[SPD] BioBrick load failed: ${message}`);
    } finally {
      brickLoadId = '';
    }
  }

  // ---------------- My entries ----------------
  let mine = $state<SpdActivitySubmission[]>([]);
  let mineBusy = $state(false);
  let mineError = $state('');
  let mineLoaded = $state(false);

  function isLoadable(type: string): boolean {
    return type === 'gene' || type === 'vector' || type === 'biobrick';
  }

  async function loadMine() {
    if (!spdToken()) { mineError = m.spdNeedToken(); return; }
    mineBusy = true;
    mineError = '';
    try {
      const activity = await configureSpdClient().myActivity();
      const merged = [...(activity.submissions ?? []), ...(activity.imports ?? [])];
      const seen = new Set<string>();
      mine = merged
        .filter((row) => {
          if (!row?.id || seen.has(`${row.entityType}:${row.id}`)) return false;
          seen.add(`${row.entityType}:${row.id}`);
          return true;
        })
        .sort((a, b) => activityTime(b) - activityTime(a));
      mineLoaded = true;
      pushLog?.(`[SPD] Personal entries: ${mine.length} record(s)`);
    } catch (error) {
      mineError = error instanceof Error ? error.message : String(error);
      mine = [];
      pushLog?.(`[SPD] Personal entry load failed: ${mineError}`);
    } finally {
      mineBusy = false;
    }
  }

  function activityTime(row: SpdActivitySubmission): number {
    const raw = row.createdAt;
    if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function activityWhen(row: SpdActivitySubmission): string {
    const ms = activityTime(row);
    return ms ? new Date(ms).toLocaleDateString() : '';
  }

  async function loadMineRow(row: SpdActivitySubmission) {
    if (!isLoadable(row.entityType) || loadBusyId || brickLoadId) return;
    try {
      if (row.entityType === 'gene') {
        loadBusyId = row.id;
        const loaded = await loadGene(row.id);
        onLoadGene(loaded);
        pushToast?.('success', m.spdGeneLoadTitle(), m.spdGeneLoadOk({ name: row.title, length: String(loaded.sequence.length) }));
        pushLog?.(`[SPD] Loaded my gene ${row.id}`);
      } else if (row.entityType === 'biobrick') {
        brickLoadId = row.id;
        const loaded = await loadBiobrick(row.id);
        onLoadBiobrick?.(loaded);
        pushToast?.('success', m.spdBrickLoadTitle(), m.spdBrickLoadOk({ name: row.title, length: String(loaded.sequence.length) }));
        pushLog?.(`[SPD] Loaded my BioBrick ${row.id}`);
      } else if (row.entityType === 'vector') {
        if (!onLoadVector) return;
        brickLoadId = row.id;
        const loaded = await loadVectorTemplate(row.id);
        onLoadVector(loaded);
        pushToast?.('success', m.spdMineLoadTitle(), m.spdMineLoadOk({ name: row.title }));
        pushLog?.(`[SPD] Loaded my vector ${row.id}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast?.('error', m.spdMineLoadTitle(), message);
      pushLog?.(`[SPD] Personal entry load failed: ${message}`);
    } finally {
      loadBusyId = '';
      brickLoadId = '';
    }
  }

  function openTab(next: Tab) {
    tab = next;
    if (next === 'biobricks' && !bricksSearched && !bricksBusy) void queryBricks();
    if (next === 'mine' && !mineLoaded && !mineBusy) void loadMine();
  }
</script>

<div class="spd-gene-panel" data-testid="spd-gene-panel">
  <div class="spd-tabs" role="tablist">
    <button class="pix-btn {tab === 'genes' ? 'ok' : ''}" type="button" role="tab" aria-selected={tab === 'genes'}
      data-testid="spd-tab-genes" onclick={() => openTab('genes')}>{m.spdTabGenes()}</button>
    <button class="pix-btn {tab === 'biobricks' ? 'ok' : ''}" type="button" role="tab" aria-selected={tab === 'biobricks'}
      data-testid="spd-tab-biobricks" onclick={() => openTab('biobricks')}>{m.spdTabBiobricks()}</button>
    <button class="pix-btn {tab === 'mine' ? 'ok' : ''}" type="button" role="tab" aria-selected={tab === 'mine'}
      data-testid="spd-tab-mine" onclick={() => openTab('mine')}>{m.spdTabMine()}</button>
  </div>

  {#if tab === 'genes'}
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
                {#if rowProteins[row.id]}
                  <span class="gene-protein" title={rowProteins[row.id]}>→ {rowProteins[row.id]}</span>
                {/if}
              </div>
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
  {:else if tab === 'biobricks'}
    <div class="hint pix-dim">{m.spdBrickHint()}</div>

    <div class="publish-box">
      <div class="form-row">
        <label>{m.spdBrickNameLabel()}
          <input class="pix-input" data-testid="spd-brick-name" type="text" bind:value={brickNameInput} />
        </label>
        <label>{m.spdBrickTypeLabel()}
          <select class="pix-select" data-testid="spd-brick-type" bind:value={brickPartType}>
            {#each BIOBRICK_PART_TYPES as partType}
              <option value={partType}>{partTypeLabel(partType)}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="form-row">
        <label>{m.spdBrickDescriptionLabel()}
          <input class="pix-input" type="text" bind:value={brickDescription} />
        </label>
        <button class="pix-btn ok" data-testid="spd-brick-publish" type="button" disabled={brickPublishing} onclick={publishBrick}>
          {brickPublishing ? m.spdBrickPublishing() : m.spdBrickPublishBtn()}
        </button>
      </div>
      {#if brickMessage}<div class="message">{brickMessage}</div>{/if}
      {#if publishedBrickId}
        <div class="published-row">
          <span class="pix-dim">{m.spdBrickPublishedLabel()}</span>
          <code data-testid="spd-brick-published-id">{publishedBrickId}</code>
        </div>
      {/if}
    </div>

    <div class="search-box">
      <div class="load-row">
        <input class="pix-input" data-testid="spd-brick-search" type="search" placeholder={m.spdBrickSearchPlaceholder()} bind:value={brickQ}
          onkeydown={(event) => { if (event.key === 'Enter') void queryBricks(); }} />
        <select class="pix-select" bind:value={brickFilter} onchange={() => void queryBricks()}>
          <option value="">{m.spdBrickTypeAll()}</option>
          {#each BIOBRICK_PART_TYPES as partType}
            <option value={partType}>{partTypeLabel(partType)}</option>
          {/each}
        </select>
        <button class="pix-btn" type="button" disabled={bricksBusy} onclick={queryBricks}>
          {bricksBusy ? m.spdGeneListLoading() : m.spdGeneSearchBtn()}
        </button>
      </div>
      {#if bricksError}<div class="message error">{bricksError}</div>{/if}
      {#if bricks.length}
        <ul class="gene-list">
          {#each bricks as row (row.id)}
            <li>
              <div class="gene-main">
                <span class="gene-name">{row.name}</span>
                <span class="pix-dim">{partTypeLabel(row.partType)}{typeof row.length === 'number' ? ` · ${row.length} bp` : ''}{row.description ? ` · ${row.description}` : ''}</span>
              </div>
              <button class="pix-btn" data-testid="spd-brick-load" type="button" disabled={brickLoadId !== ''} onclick={() => loadBrick(row)}>
                {brickLoadId === row.id ? m.spdGeneListLoading() : m.spdGeneLoadBtn()}
              </button>
            </li>
          {/each}
        </ul>
      {:else if bricksSearched && !bricksBusy && !bricksError}
        <div class="pix-dim empty">{m.spdBrickEmpty()}</div>
      {/if}
    </div>
  {:else}
    <div class="hint pix-dim">{m.spdMineHint()}</div>
    <div class="load-row">
      <button class="pix-btn" type="button" disabled={mineBusy} onclick={loadMine}>
        {mineBusy ? m.spdGeneListLoading() : m.spdMineRefresh()}
      </button>
      <span class="pix-dim">{m.spdMineCount({ count: String(mine.length) })}</span>
    </div>
    {#if mineError}<div class="message error">{mineError}</div>{/if}
    {#if mine.length}
      <ul class="gene-list mine-list">
        {#each mine as row (`${row.entityType}:${row.id}`)}
          <li>
            <div class="gene-main">
              <span class="gene-name">{row.title || row.id}</span>
              <span class="pix-dim">{row.entityType}{row.status ? ` · ${row.status}` : ''}{activityWhen(row) ? ` · ${activityWhen(row)}` : ''}</span>
            </div>
            {#if isLoadable(row.entityType)}
              <button class="pix-btn" type="button" data-testid={`spd-mine-load-${row.entityType}`}
                disabled={loadBusyId !== '' || brickLoadId !== ''} onclick={() => loadMineRow(row)}>
                {m.spdGeneLoadBtn()}
              </button>
            {:else}
              <span class="pix-dim type-chip">{row.entityType}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if mineLoaded && !mineBusy && !mineError}
      <div class="pix-dim empty">{m.spdMineEmpty()}</div>
    {/if}
  {/if}
</div>

<style>
  .spd-gene-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px; font-family: var(--pix-font); font-size: 10px; }
  .spd-tabs { display: flex; gap: 4px; }
  .spd-tabs button { flex: 1; padding: 3px 6px; font-size: 9.5px; height: 22px; }
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
  .load-row select { max-width: 120px; height: 20px; font-size: 9px; }
  .message { padding: 4px 6px; border: 1px solid var(--pix-border); color: var(--pix-fg-dim); word-break: break-word; }
  .message.error { color: var(--pix-red); border-color: var(--pix-red); }
  .published-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .published-row code { flex: 1; min-width: 0; color: var(--pix-cyan); font-size: 9px; word-break: break-all; }
  .gene-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow: auto; }
  .gene-list li { display: flex; align-items: center; gap: 5px; border: 1px solid var(--pix-border); padding: 3px 5px; background: rgba(0, 0, 0, 0.25); }
  .gene-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .gene-name { color: var(--pix-cyan); font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gene-main .pix-dim { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gene-protein { color: var(--pix-cyan); font-size: 8.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 3px 1px; }
  .mine-list { max-height: 300px; }
  .type-chip { font-size: 8.5px; border: 1px solid var(--pix-border); padding: 1px 4px; }
</style>
