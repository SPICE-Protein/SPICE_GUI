<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 
  import {
    assembleVector,
    validateVectorAssembly,
    type ExpressionCassette,
    type VectorTemplate,
    type AssemblyResult,
    type ValidationResult
  } from '$lib/genome/expressionCassette';
  import ExpressionCassetteBuilder from './ExpressionCassetteBuilder.svelte';
  import { spdToken } from '$lib/spd/client';
  import { configureSpdClient } from '$lib/spd/store.svelte';
  import { publishVector, loadVectorTemplate, type VectorWorkspaceInput, type LoadedVectorTemplate } from '$lib/spd/vectors';
  import type { SpdVectorSummary, SpdVectorValidation } from '$lib/spd/types';

  let {
    template = { id: 'vector-1', name: 'Vector template', topology: 'circular', features: [], insertionSites: [] },
    cassette,
    onAssembled,
    onChange,
    compact = false,
    getWorkspace,
    onLoadTemplate,
    pushLog,
    pushToast,
  } = $props<{
    template?: VectorTemplate;
    cassette?: ExpressionCassette;
    onAssembled?: (result: AssemblyResult, validation: ValidationResult) => void;
    onChange?: (cassette: ExpressionCassette) => void;
    compact?: boolean;
    /** Snapshot of the live gene workbench, captured when the user publishes. */
    getWorkspace?: () => VectorWorkspaceInput;
    /** Hand a loaded SPD template (detail + parsed sequence) back to the page. */
    onLoadTemplate?: (t: LoadedVectorTemplate) => void;
    pushLog?: (msg: string) => void;
    pushToast?: (type: 'success' | 'error' | 'info', title: string, text?: string) => void;
  }>();

  // ---- SPD cloud sync ----
  let pubBusy = $state(false);
  let pubMessage = $state('');
  let lastValidation = $state<SpdVectorValidation | null>(null);
  let publishedId = $state('');
  let rowsBusy = $state(false);
  let loadBusyId = $state('');
  let searchQ = $state('');
  let templateRows = $state<SpdVectorSummary[]>([]);
  let listError = $state('');

  async function publishToSpd() {
    if (!spdToken()) { pubMessage = m.spdNeedToken(); return; }
    const ws = getWorkspace?.();
    if (!ws || !ws.sequence) { pubMessage = m.vtpSpdNoWorkspace(); return; }
    pubBusy = true; pubMessage = ''; lastValidation = null; publishedId = '';
    try {
      const r = await publishVector(ws);
      publishedId = r.vectorId;
      lastValidation = r.validation;
      pubMessage = m.vtpSpdPublished({ id: r.vectorId.slice(-8) });
      pushToast?.('success', m.vtpSpdPublishTitle(), pubMessage);
      pushLog?.(m.vtpSpdLogPublish({ v1: ws.name, v2: r.vectorId.slice(-8), v3: r.validation.valid ? 'PASS' : 'CHECKS' }));
    } catch (e) {
      pubMessage = e instanceof Error ? e.message : String(e);
      pushToast?.('error', m.vtpSpdPublishTitle(), pubMessage);
      pushLog?.(m.vtpSpdLogPublishFail({ msg: pubMessage }));
    } finally {
      pubBusy = false;
    }
  }

  async function refreshList() {
    rowsBusy = true; listError = '';
    try {
      templateRows = await configureSpdClient().listVectors(searchQ.trim() || undefined);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
      templateRows = [];
    } finally {
      rowsBusy = false;
    }
  }

  async function loadTemplate(row: SpdVectorSummary) {
    if (!onLoadTemplate) return;
    loadBusyId = row.id;
    try {
      const t = await loadVectorTemplate(row.id);
      onLoadTemplate(t);
      pushLog?.(m.vtpSpdLogLoaded({ v1: row.name, v2: t.sequence.length }));
    } catch (e) {
      pushToast?.('error', m.vtpSpdLoadTitle(), e instanceof Error ? e.message : String(e));
    } finally {
      loadBusyId = '';
    }
  }

  const label = (key: string, fallback: string) => {
    const candidate = (m as unknown as Record<string, unknown>)[key];
    return typeof candidate === 'function' ? (candidate as () => string)() : fallback;
  };
  let localTemplate = $state<VectorTemplate>({ ...template, features: [...(template.features ?? [])], insertionSites: [...(template.insertionSites ?? [])] });
  let localCassette = $state<ExpressionCassette>(cassette ?? { id: 'cassette-1', parts: [], topology: 'linear' });
  let result = $state<AssemblyResult | null>(null);
  let validation = $state<ValidationResult | null>(null);
  let siteId = $state(localTemplate.insertionSites?.[0]?.id ?? '');
  let sequence = $state(localTemplate.sequence ?? '');
  let error = $state('');

  function assemble() {
    error = '';
    if (!/^[ACGTN]*$/i.test(sequence)) { error = m.vtpInvalidDnaChars(); return; }
    localTemplate = { ...localTemplate, sequence };
    result = assembleVector(localTemplate, localCassette, siteId || undefined);
    validation = validateVectorAssembly(result);
    onAssembled?.(result, validation);
  }
  function setCassette(next: ExpressionCassette) { localCassette = next; onChange?.(next); }
</script>

<section class="vector-panel pix-panel compact" class:full={!compact} aria-label={m.vtpPanelTitle()}>
  <header class="panel-header"><strong>{m.vtpPanelTitle()}</strong><span class="pix-dim">{localTemplate.name ?? localTemplate.id}</span></header>
  <div class="template-fields">
    <label>{m.vtpVectorName()}<input class="pix-input" value={localTemplate.name ?? ''} oninput={(e) => localTemplate = { ...localTemplate, name: e.currentTarget.value }} /></label>
    <label>{m.vtpTemplateSequence()}<textarea class="pix-input template-sequence" bind:value={sequence} placeholder="ACGT..."></textarea></label>
    <label>{m.vtpInsertionSite()}<select class="pix-select" bind:value={siteId} disabled={!localTemplate.insertionSites?.length}>
      <option value="">{m.vtpDefaultSite()}</option>
      {#each localTemplate.insertionSites ?? [] as site}<option value={site.id}>{site.id}</option>{/each}
    </select></label>
  </div>

  <ExpressionCassetteBuilder cassette={localCassette} {compact} onChange={setCassette} onAssembled={() => {}} />
  {#if error}<div class="issue error">{error}</div>{/if}
  <div class="actions"><button class="pix-btn ok" type="button" onclick={assemble}>{m.vtpAssembleValidate()}</button>{#if result}<span class="pix-dim">{result.sequence.length} bp · {result.features.length} {m.vtpFeatures()}</span>{/if}</div>
  {#if validation}
    <div class:valid={validation.valid} class:invalid={!validation.valid} class="validation">
      <strong>{validation.valid ? m.vtpValidationPassed() : m.vtpNeedsAttention()}</strong>
      {#if validation.issues.length}
        <ul>{#each validation.issues as issue}<li class:error={issue.severity === 'error'}>{issue.message}</li>{/each}</ul>
      {:else}<span class="pix-dim">{m.vtpNoIssues()}</span>{/if}
    </div>
  {/if}

  <!-- ─────────── SPD cloud: publish this plasmid / load published templates ─────────── -->
  <div class="spd-cloud">
    <header class="panel-header"><strong>{m.vtpSpdCloudTitle()}</strong><span class="pix-dim">{m.vtpSpdCloudHint()}</span></header>
    <button class="pix-btn ok" type="button" disabled={pubBusy} onclick={publishToSpd}>
      {pubBusy ? m.vtpSpdPublishing() : m.vtpSpdPublishBtn()}
    </button>
    {#if pubMessage}
      <div class="spd-msg" class:error={lastValidation === null && pubMessage !== '' && !publishedId}>{pubMessage}</div>
    {/if}
    {#if lastValidation}
      <div class:valid={lastValidation.valid} class:invalid={!lastValidation.valid} class="validation">
        <strong>{lastValidation.valid ? m.vtpSpdValidateOk() : m.vtpSpdValidateIssues()}</strong>
        {#if lastValidation.checks.length}<ul>{#each lastValidation.checks as c}<li class:error>{c}</li>{/each}</ul>{/if}
        {#if lastValidation.warnings.length}<ul>{#each lastValidation.warnings as w}<li>{w}</li>{/each}</ul>{/if}
      </div>
    {/if}

    <div class="load-row">
      <input class="pix-input" type="search" placeholder={m.vtpSpdSearchPlaceholder()} bind:value={searchQ}
        onkeydown={(e) => { if (e.key === 'Enter') void refreshList(); }} />
      <button class="pix-btn" type="button" disabled={rowsBusy} onclick={refreshList}>{rowsBusy ? m.vtpSpdLoading() : m.vtpSpdListBtn()}</button>
    </div>
    {#if listError}<div class="spd-msg error">{listError}</div>{/if}
    {#if templateRows.length}
      <ul class="tpl-list">
        {#each templateRows as row (row.id)}
          <li>
            <span class="tpl-name">{row.name || m.vtpSpdUnnamed()}</span>
            <span class="pix-dim">{row.topology === 'linear' ? m.topologyLinear() : m.topologyCircular()} · …{row.id.slice(-6)}</span>
            <button class="pix-btn" type="button" disabled={loadBusyId !== ''} onclick={() => loadTemplate(row)}>
              {loadBusyId === row.id ? m.vtpSpdLoading() : m.vtpSpdLoadBtn()}
            </button>
          </li>
        {/each}
      </ul>
    {:else if !rowsBusy && !listError}<span class="pix-dim">{m.vtpSpdListEmpty()}</span>{/if}
  </div>
</section>

<style>
  .vector-panel { display:flex; flex-direction:column; gap:8px; padding:8px; color:var(--pix-fg,#e8edf5); font-family:var(--pix-font,monospace); font-size:10px; min-width:430px; }.full{width:100%;}
  .panel-header,.actions { display:flex; align-items:center; justify-content:space-between; gap:6px; border-bottom:1px solid var(--pix-border); padding-bottom:5px; }.template-fields { display:grid; grid-template-columns:1fr 2fr 1fr; gap:6px; }.template-fields label { display:flex; flex-direction:column; gap:3px; color:var(--pix-fg-dim); }.template-sequence { min-height:36px; resize:vertical; font-family:monospace; text-transform:uppercase; }.issue { padding:5px; }.error { color:var(--pix-red); border-color:var(--pix-red); }.validation { padding:6px; border:1px solid var(--pix-border); display:flex; flex-direction:column; gap:4px; }.validation.valid { color:var(--pix-green); border-color:var(--pix-green); }.validation.invalid { color:var(--pix-warning); border-color:var(--pix-warning); }.validation ul { margin:0; padding-left:18px; }.validation li.error { color:var(--pix-red); }
  .spd-cloud { display:flex; flex-direction:column; gap:6px; margin-top:6px; padding-top:6px; border-top:1.5px solid var(--pix-border); }
  .load-row { display:flex; gap:4px; align-items:center; }
  .load-row input { flex:1; min-width:0; padding:2px 4px; font-size:9.5px; height:20px; }
  .tpl-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; max-height:140px; overflow:auto; }
  .tpl-list li { display:flex; align-items:center; gap:6px; border:1px solid var(--pix-border); border-radius:3px; padding:2px 5px; background:rgba(0,0,0,0.25); }
  .tpl-name { font-weight:bold; color:var(--pix-cyan); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .spd-msg { padding:4px 6px; border:1px solid var(--pix-border); border-radius:3px; color:var(--pix-fg-dim); word-break:break-all; }
  .spd-msg.error { color:var(--pix-red); border-color:var(--pix-red); }
</style>
