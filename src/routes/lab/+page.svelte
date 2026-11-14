<script lang="ts">
  // Lab operations: a local inventory registry and a protocol/run workspace.
  // Both layers are file-backed (JSON import/export) and live in localStorage
  // between sessions; protocol runs can link back to a project journal page.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    Boxes, ClipboardList, Plus, Trash2, Download, Upload, Search,
    Play, Check, X, ChevronRight, MapPin, Tag, FlaskConical, Dna,
    Package, Pause, FileText, Copy, Save, Link2, Timer, ArrowLeft
  } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import Toaster from '$lib/ui/Toaster.svelte';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import {
    inventoryStore,
    INVENTORY_LOW_THRESHOLD,
  } from '$lib/inventory/store.svelte.ts';
  import {
    INVENTORY_KINDS, INVENTORY_STATUSES, INVENTORY_QC_STATUSES,
    inventoryStats, itemLineage, locationLabel,
    type InventoryItem, type InventoryKind, type InventoryStatus, type QcStatus,
  } from '$lib/inventory/types';
  import {
    calculatePrimerTm, exportPrimerOrderFormat, generate2DGrid, matchQueryToStockPrimers,
  } from '$lib/genome';
  import {
    protocolStore,
  } from '$lib/protocol/store.svelte.ts';
  import {
    createProtocolTemplate, newProtocolId, protocolStats, runSheetMarkdown,
    type ProtocolParameter, type ProtocolParameterType, type ProtocolRun,
    type ProtocolTemplate, type RunStatus, type StepStatus,
  } from '$lib/protocol/types';

  let tab = $state<'inventory' | 'protocols'>('inventory');
  let protocolsTab = $state<'templates' | 'runs'>('templates');

  // ---------------- inventory state ----------------
  let invQuery = $state('');
  let invKind = $state<'' | InventoryKind>('');
  let invStatus = $state<'' | InventoryStatus>('');
  let invEditorOpen = $state(false);
  let invEditingId = $state<string | null>(null);
  let invForm = $state(emptyItemForm());
  let invFileInput = $state<HTMLInputElement | null>(null);

  // Primer tools replace the retired Gene Editor LIMS panel.
  let primerToolsOpen = $state(false);
  let primerOrderVendor = $state<'Sangon' | 'Tsingke' | 'IDT'>('Sangon');
  let primerGridType = $state<'96-well' | '10x10-freezer'>('96-well');
  let primerMatchQuery = $state('');
  let primerMatches = $state<InventoryItem[]>([]);
  let primerMatchDone = $state(false);
  const primerItems = $derived(inventoryStore.items.filter((item) => item.kind === 'primer'));
  const primerGrid = $derived(
    generate2DGrid(
      primerItems
        .filter((item) => item.location.position)
        .map((item) => ({
          sampleId: item.id,
          name: item.name,
          type: 'primer',
          position: item.location.position ?? '',
        })),
      primerGridType,
    ),
  );

  function emptyItemForm() {
    return {
      kind: 'plasmid' as InventoryKind,
      name: '',
      alias: '',
      description: '',
      organism: '',
      genotype: '',
      sequence: '',
      concentration: '',
      concentrationUnit: 'ng/µL',
      quantity: 1,
      quantityUnit: 'unit',
      freezer: '',
      rack: '',
      box: '',
      position: '',
      status: 'available' as InventoryStatus,
      qc: 'untested' as QcStatus,
      tagsText: '',
      parentIds: [] as string[],
      projectId: '',
      docId: '',
    };
  }

  const invItems = $derived(
    inventoryStore.search(invQuery, {
      kinds: invKind ? [invKind] : undefined,
      statuses: invStatus ? [invStatus] : undefined,
    }),
  );
  const invStats = $derived(inventoryStats(inventoryStore.items));
  const currentProject = $derived(projectStore.current);

  function kindLabel(kind: InventoryKind): string {
    switch (kind) {
      case 'strain': return m.invKindStrain();
      case 'plasmid': return m.invKindPlasmid();
      case 'primer': return m.invKindPrimer();
      case 'reagent': return m.invKindReagent();
      case 'sample': return m.invKindSample();
    }
  }

  function statusLabel(status: InventoryStatus): string {
    switch (status) {
      case 'available': return m.invStatusAvailable();
      case 'low': return m.invStatusLow();
      case 'depleted': return m.invStatusDepleted();
      case 'quarantine': return m.invStatusQuarantine();
      case 'archived': return m.invStatusArchived();
    }
  }

  function qcLabel(qc: QcStatus): string {
    switch (qc) {
      case 'untested': return m.invQcUntested();
      case 'passed': return m.invQcPassed();
      case 'failed': return m.invQcFailed();
    }
  }

  function openNewItem() {
    invEditingId = null;
    invForm = emptyItemForm();
    invEditorOpen = true;
  }

  function openEditItem(item: InventoryItem) {
    invEditingId = item.id;
    invForm = {
      kind: item.kind,
      name: item.name,
      alias: item.alias ?? '',
      description: item.description ?? '',
      organism: item.organism ?? '',
      genotype: item.genotype ?? '',
      sequence: item.sequence ?? '',
      concentration: item.concentration === undefined ? '' : String(item.concentration),
      concentrationUnit: item.concentrationUnit ?? '',
      quantity: item.quantity,
      quantityUnit: item.quantityUnit,
      freezer: item.location.freezer ?? '',
      rack: item.location.rack ?? '',
      box: item.location.box ?? '',
      position: item.location.position ?? '',
      status: item.status,
      qc: item.qc,
      tagsText: item.tags.join(', '),
      parentIds: [...item.parentIds],
      projectId: item.projectId ?? '',
      docId: item.docId ?? '',
    };
    invEditorOpen = true;
  }

  function saveItem() {
    const name = invForm.name.trim();
    if (!name) {
      pushToast('error', m.invNameRequiredTitle(), m.invNameRequiredBody());
      return;
    }
    const payload: Partial<InventoryItem> = {
      kind: invForm.kind,
      name,
      alias: invForm.alias.trim() || undefined,
      description: invForm.description.trim() || undefined,
      organism: invForm.organism.trim() || undefined,
      genotype: invForm.genotype.trim() || undefined,
      sequence: invForm.sequence.trim() || undefined,
      concentration: invForm.concentration === '' ? undefined : Number(invForm.concentration),
      concentrationUnit: invForm.concentrationUnit.trim() || undefined,
      quantity: Number.isFinite(Number(invForm.quantity)) ? Number(invForm.quantity) : 0,
      quantityUnit: invForm.quantityUnit.trim() || 'unit',
      location: {
        freezer: invForm.freezer.trim() || undefined,
        rack: invForm.rack.trim() || undefined,
        box: invForm.box.trim() || undefined,
        position: invForm.position.trim() || undefined,
      },
      status: invForm.status,
      qc: invForm.qc,
      tags: invForm.tagsText.split(',').map(t => t.trim()).filter(Boolean),
      parentIds: invForm.parentIds,
      projectId: invForm.projectId.trim() || undefined,
      docId: invForm.docId.trim() || undefined,
    };
    if (invEditingId) inventoryStore.updateItem(invEditingId, payload);
    else inventoryStore.addItem(payload);
    invEditorOpen = false;
    pushToast('success', m.invSavedTitle(), name);
  }

  function removeItem(item: InventoryItem) {
    if (typeof confirm === 'function' && !confirm(m.invDeleteConfirm())) return;
    inventoryStore.removeItem(item.id);
    pushToast('info', m.invDeletedTitle(), item.name);
  }

  async function exportInventory() {
    const text = inventoryStore.exportText();
    const res = await backend.saveExport('inventory.spiceinv.json', text);
    if (res.data?.saved) pushToast('success', m.invExportedTitle(), 'inventory.spiceinv.json');
    else pushToast('error', m.invExportFailed(), res.error || '');
  }

  async function importInventoryFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const result = inventoryStore.importText(text);
    if (result.ok) pushToast('success', m.invImportedTitle(), m.invImportedBody({ count: String(result.added ?? 0) }));
    else pushToast('error', m.invImportFailed(), result.error || '');
  }

  // ---------------- primer tools ----------------

  function primerTm(item: InventoryItem): number | null {
    return item.sequence ? calculatePrimerTm(item.sequence) : null;
  }

  function openPrimerTools() {
    primerMatchQuery = '';
    primerMatches = [];
    primerMatchDone = false;
    primerToolsOpen = true;
  }

  function downloadPrimerOrder() {
    if (primerItems.length === 0) {
      pushToast('error', m.primerOrderEmptyTitle(), m.primerOrderEmptyBody());
      return;
    }
    const sheet = exportPrimerOrderFormat(
      primerItems.map((item) => ({
        name: item.name,
        sequence: item.sequence ?? '',
        scale: '50 nmol',
        purification: 'DSL',
      })),
      primerOrderVendor,
    );
    const blob = new Blob([sheet], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${primerOrderVendor}_Primer_Order_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    pushToast('success', m.limsOrderSuccessTitle(), m.limsOrderSuccessDesc({ v1: primerOrderVendor }));
  }

  function findPrimerMatches() {
    const query = primerMatchQuery.trim();
    primerMatchDone = true;
    if (!query) {
      primerMatches = [];
      return;
    }
    const stock = primerItems
      .filter((item) => item.sequence)
      .map((item) => ({
        id: item.id,
        name: item.name,
        sequence: item.sequence ?? '',
        tm: primerTm(item) ?? 0,
        concentration: item.concentration ?? 0,
        volume: item.quantity,
        location: locationLabel(item.location),
      }));
    primerMatches = matchQueryToStockPrimers(query, stock, 15)
      .map((match) => inventoryStore.getById(match.id))
      .filter((item): item is InventoryItem => item !== null);
  }

  // ---------------- protocol state ----------------
  let templateEditorOpen = $state(false);
  let editingTemplateId = $state<string | null>(null);
  let templateDraft = $state(emptyTemplateDraft());
  let selectedRunId = $state<string | null>(null);
  let runModalOpen = $state(false);
  let runTemplateId = $state('');
  let runParams = $state<Record<string, string | number | boolean>>({});
  let runOperator = $state('');
  let runProjectId = $state('');
  let runJournalPageId = $state('');
  let runResultBuf = $state('');
  let protocolFileInput = $state<HTMLInputElement | null>(null);

  function emptyTemplateDraft(): ProtocolTemplate {
    return createProtocolTemplate({
      name: m.protoUntitled(),
      category: 'General',
      description: '',
      parameters: [],
      steps: [],
    });
  }

  const protoStats = $derived(protocolStats({ templates: protocolStore.templates, runs: protocolStore.runs }));
  const selectedTemplate = $derived(
    templateEditorOpen ? null : protocolStore.templates.find(t => t.id === runTemplateId) ?? null,
  );
  const selectedRun = $derived(selectedRunId ? protocolStore.getRun(selectedRunId) : null);
  const selectedRunTemplate = $derived(
    selectedRun ? protocolStore.getTemplate(selectedRun.templateId) : null,
  );
  const runSheetPreview = $derived(
    selectedRun ? runSheetMarkdown(selectedRun, selectedRunTemplate) : '',
  );

  function openNewTemplate() {
    editingTemplateId = null;
    templateDraft = emptyTemplateDraft();
    templateEditorOpen = true;
  }

  function openEditTemplate(template: ProtocolTemplate) {
    editingTemplateId = template.id;
    templateDraft = {
      ...template,
      parameters: template.parameters.map(p => ({ ...p, options: p.options ? [...p.options] : undefined })),
      steps: template.steps.map(s => ({ ...s })),
    };
    templateEditorOpen = true;
  }

  function addParameter() {
    templateDraft.parameters = [
      ...templateDraft.parameters,
      { key: `param_${templateDraft.parameters.length + 1}`, label: '', type: 'text', defaultValue: '' },
    ];
  }

  function addStep() {
    templateDraft.steps = [
      ...templateDraft.steps,
      { id: newProtocolId('step'), title: '', instructions: '' },
    ];
  }

  function removeParameter(index: number) {
    templateDraft.parameters = templateDraft.parameters.filter((_, i) => i !== index);
  }

  function removeStep(index: number) {
    templateDraft.steps = templateDraft.steps.filter((_, i) => i !== index);
  }

  function saveTemplate() {
    if (!templateDraft.name.trim()) {
      pushToast('error', m.protoNameRequiredTitle(), m.protoNameRequiredBody());
      return;
    }
    const normalized = createProtocolTemplate({
      ...templateDraft,
      name: templateDraft.name.trim(),
      parameters: templateDraft.parameters.map((p, i) => ({ ...p, key: p.key.trim() || `param_${i + 1}` })),
      steps: templateDraft.steps.map((s, i) => ({ ...s, title: s.title.trim() || `Step ${i + 1}` })),
    });
    if (editingTemplateId) protocolStore.updateTemplate(editingTemplateId, normalized);
    else protocolStore.addTemplate(normalized);
    templateEditorOpen = false;
    pushToast('success', m.protoSavedTitle(), normalized.name);
  }

  function removeTemplate(template: ProtocolTemplate) {
    if (typeof confirm === 'function' && !confirm(m.protoDeleteConfirm())) return;
    protocolStore.removeTemplate(template.id);
    pushToast('info', m.protoDeletedTitle(), template.name);
  }

  function openRunModal(template: ProtocolTemplate) {
    runTemplateId = template.id;
    runParams = {};
    for (const parameter of template.parameters) runParams[parameter.key] = parameter.defaultValue;
    runOperator = '';
    runProjectId = currentProject?.meta.id ?? '';
    runJournalPageId = '';
    runModalOpen = true;
  }

  function journalPagesForProject(): { id: string; title: string }[] {
    if (!currentProject) return [];
    if (runProjectId !== currentProject.meta.id) return [];
    return currentProject.journal.pages.map(p => ({ id: p.id, title: p.title || m.projectJournalTitlePh() }));
  }

  function startRun() {
    const template = protocolStore.getTemplate(runTemplateId);
    if (!template) return;
    const links = {
      operator: runOperator.trim(),
      projectId: runProjectId || undefined,
      projectName: runProjectId === currentProject?.meta.id ? currentProject?.meta.name : undefined,
      journalPageId: runJournalPageId || undefined,
    };
    const run = protocolStore.createRun(template, runParams, links);
    if (runJournalPageId) projectStore.updateJournalMeta(runJournalPageId, { protocolRunId: run.id });
    selectedRunId = run.id;
    protocolsTab = 'runs';
    runModalOpen = false;
    pushToast('success', m.protoRunCreatedTitle(), run.templateName);
  }

  function selectRun(run: ProtocolRun) {
    selectedRunId = run.id;
    runResultBuf = run.resultMarkdown;
    protocolsTab = 'runs';
  }

  function saveRunResult() {
    if (!selectedRun) return;
    protocolStore.updateRun(selectedRun.id, { resultMarkdown: runResultBuf });
    pushToast('success', m.protoSavedTitle(), selectedRun.templateName);
  }

  function markStep(stepId: string, status: StepStatus) {
    if (!selectedRun) return;
    protocolStore.setStep(selectedRun.id, stepId, status);
  }

  function updateStepNotes(stepId: string, notes: string) {
    if (!selectedRun) return;
    const steps = selectedRun.steps.map(s => s.stepId === stepId ? { ...s, notes } : s);
    protocolStore.updateRun(selectedRun.id, { steps });
  }

  function completeRun() {
    if (!selectedRun) return;
    protocolStore.completeRun(selectedRun.id, runResultBuf);
    pushToast('success', m.protoCompletedTitle(), selectedRun.templateName);
  }

  function abortRun() {
    if (!selectedRun) return;
    protocolStore.updateRun(selectedRun.id, {
      status: 'aborted',
      completedAt: new Date().toISOString(),
    });
    pushToast('info', m.protoAbortedTitle(), selectedRun.templateName);
  }

  function removeRun(run: ProtocolRun) {
    if (typeof confirm === 'function' && !confirm(m.protoDeleteRunConfirm())) return;
    protocolStore.removeRun(run.id);
    if (selectedRunId === run.id) selectedRunId = null;
    pushToast('info', m.protoDeletedTitle(), run.templateName);
  }

  async function copyRunSheet() {
    if (!runSheetPreview) return;
    try {
      await navigator.clipboard.writeText(runSheetPreview);
      pushToast('success', m.protoCopiedTitle(), '');
    } catch {
      pushToast('error', m.protoCopyFailed(), '');
    }
  }

  async function downloadRunSheet() {
    if (!selectedRun) return;
    const name = `${selectedRun.templateName.replace(/[^\w.-]+/g, '_') || 'run'}_sheet.md`;
    const res = await backend.saveExport(name, runSheetPreview);
    if (res.data?.saved) pushToast('success', m.protoDownloadedTitle(), name);
    else pushToast('error', m.protoDownloadFailed(), res.error || '');
  }

  function insertRunSheetIntoJournal() {
    if (!selectedRun) return;
    const pageId = selectedRun.journalPageId;
    const project = projectStore.current;
    if (!project || !pageId) {
      pushToast('error', m.protoNoLinkedPageTitle(), m.protoNoLinkedPageBody());
      return;
    }
    const page = project.journal.pages.find(p => p.id === pageId);
    if (!page) {
      pushToast('error', m.protoNoLinkedPageTitle(), m.protoNoLinkedPageBody());
      return;
    }
    const next = page.markdownContent.trim()
      ? `${page.markdownContent.trimEnd()}\n\n${runSheetPreview}`
      : runSheetPreview;
    projectStore.commitJournalPage(pageId, next);
    projectStore.updateJournalMeta(pageId, { protocolRunId: selectedRun.id });
    pushToast('success', m.protoInsertedTitle(), page.title || m.projectJournalTitlePh());
  }

  async function exportProtocols() {
    const res = await backend.saveExport('protocols.spiceprotocol.json', protocolStore.exportText());
    if (res.data?.saved) pushToast('success', m.protoExportedTitle(), 'protocols.spiceprotocol.json');
    else pushToast('error', m.protoExportFailed(), res.error || '');
  }

  async function importProtocolsFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const result = protocolStore.importText(text);
    if (result.ok) pushToast('success', m.protoImportedTitle(), '');
    else pushToast('error', m.protoImportFailed(), result.error);
  }

  // ---------------- formatting ----------------
  function fmtDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleString();
  }

  function runStatusLabel(status: RunStatus): string {
    switch (status) {
      case 'planned': return m.protoStatusPlanned();
      case 'running': return m.protoStatusRunning();
      case 'completed': return m.protoStatusCompleted();
      case 'aborted': return m.protoStatusAborted();
    }
  }

  function stepStatusLabel(status: StepStatus): string {
    switch (status) {
      case 'pending': return m.protoStepPending();
      case 'running': return m.protoStepRunning();
      case 'done': return m.protoStepDone();
      case 'skipped': return m.protoStepSkipped();
    }
  }

  function paramTypeLabel(type: ProtocolParameterType): string {
    switch (type) {
      case 'text': return m.protoTypeText();
      case 'number': return m.protoTypeNumber();
      case 'select': return m.protoTypeSelect();
      case 'boolean': return m.protoTypeBoolean();
    }
  }

  function elapsedLabel(run: ProtocolRun): string {
    if (!run.startedAt) return '—';
    const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
    const start = new Date(run.startedAt).getTime();
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    return minutes < 60 ? m.protoMinutes({ n: String(minutes) }) : m.protoHours({ n: (minutes / 60).toFixed(1) });
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'protocols') tab = 'protocols';
    const run = params.get('run');
    if (run) {
      selectedRunId = run;
      runResultBuf = protocolStore.getRun(run)?.resultMarkdown ?? '';
      tab = 'protocols';
      protocolsTab = 'runs';
    }
  });
</script>

<div class="lab-page" data-testid="lab-page">
  <header class="lab-head pix-panel">
    <div class="lab-title-row">
      <div>
        <div class="pix-title lab-title"><Boxes size={15} /> {m.labTitle()}</div>
        <div class="pix-dim lab-sub">{m.labSubtitle()}</div>
      </div>
      <div class="lab-tabs">
        <button class="pix-btn {tab === 'inventory' ? 'ok' : ''}" data-testid="lab-tab-inventory" onclick={() => tab = 'inventory'}>
          <Package size={12} /> {m.tabInventory()}
        </button>
        <button class="pix-btn {tab === 'protocols' ? 'ok' : ''}" data-testid="lab-tab-protocols" onclick={() => tab = 'protocols'}>
          <ClipboardList size={12} /> {m.tabProtocols()}
        </button>
      </div>
    </div>
  </header>

  {#if tab === 'inventory'}
    <section class="lab-body">
      <div class="stat-row">
        <div class="stat pix-panel"><span class="pix-dim">{m.invStatsTotal()}</span><strong>{invStats.total}</strong></div>
        <div class="stat pix-panel"><span class="pix-dim">{m.invStatsLow()}</span><strong class="warn">{invStats.low + invStats.depleted}</strong></div>
        <div class="stat pix-panel"><span class="pix-dim">{m.invStatsQc()}</span><strong class="good">{invStats.byQc.passed}</strong></div>
        <div class="stat pix-panel"><span class="pix-dim">{m.invStatsQuarantine()}</span><strong>{invStats.quarantine}</strong></div>
      </div>

      <div class="tool-row pix-panel">
        <div class="search-wrap">
          <Search size={12} />
          <input class="pix-input" data-testid="inv-search" type="search" bind:value={invQuery} placeholder={m.invSearchPlaceholder()} />
        </div>
        <select class="pix-select" bind:value={invKind}>
          <option value="">{m.invAllKinds()}</option>
          {#each INVENTORY_KINDS as kind (kind)}<option value={kind}>{kindLabel(kind)}</option>{/each}
        </select>
        <select class="pix-select" bind:value={invStatus}>
          <option value="">{m.invAllStatuses()}</option>
          {#each INVENTORY_STATUSES as status (status)}<option value={status}>{statusLabel(status)}</option>{/each}
        </select>
        <span class="tb-spacer"></span>
        <button class="pix-btn ok" data-testid="inv-add" onclick={openNewItem}><Plus size={12} /> {m.invAdd()}</button>
        <button class="pix-btn" data-testid="primer-tools" onclick={openPrimerTools}>
          <Dna size={12} /> {m.primerToolsBtn()}
        </button>
        <button class="pix-btn" onclick={() => invFileInput?.click()}><Upload size={12} /> {m.importBtn()}</button>
        <button class="pix-btn" onclick={exportInventory}><Download size={12} /> {m.exportBtn()}</button>
        <input class="hidden-input" bind:this={invFileInput} type="file" accept=".json,.spiceinv" onchange={(e) => { void importInventoryFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>

      <div class="inv-table pix-panel">
        <div class="inv-head pix-dim">
          <span>{m.invName()}</span><span>{m.invKind()}</span><span>{m.invLocation()}</span>
          <span>{m.invQuantity()}</span><span>{m.invStatus()}</span><span>{m.invQc()}</span><span></span>
        </div>
        {#if !invItems.length}
          <div class="empty-hint">{inventoryStore.items.length ? m.invNoMatches() : m.invEmpty()}</div>
        {:else}
          <div class="inv-rows">
            {#each invItems as item (item.id)}
              <div class="inv-row" data-testid="inv-row" role="button" tabindex="0"
                onclick={() => openEditItem(item)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openEditItem(item); }}>
                <span class="inv-name">
                  <strong>{item.name}</strong>
                  {#if item.alias}<span class="pix-dim">{item.alias}</span>{/if}
                  {#if item.kind === 'primer' && item.sequence}
                    <span class="pix-dim primer-tm">Tm {primerTm(item)?.toFixed(1)}°C</span>
                  {/if}
                  {#if item.tags.length}<span class="tag-row">{#each item.tags as tag (tag)}<span class="tag"><Tag size={8} />{tag}</span>{/each}</span>{/if}
                </span>
                <span><span class="kind-chip kind-{item.kind}">{kindLabel(item.kind)}</span></span>
                <span class="loc"><MapPin size={10} /> {locationLabel(item.location) || '—'}</span>
                <span class="qty">
                  <button class="mini-btn" onclick={(e) => { e.stopPropagation(); inventoryStore.adjustQuantity(item.id, -1); }}>−</button>
                  <span class="pix-num">{item.quantity}</span>
                  <button class="mini-btn" onclick={(e) => { e.stopPropagation(); inventoryStore.adjustQuantity(item.id, 1); }}>+</button>
                  <span class="pix-dim">{item.quantityUnit}</span>
                </span>
                <span class="status status-{item.status}">{statusLabel(item.status)}</span>
                <span class="qc qc-{item.qc}">{qcLabel(item.qc)}</span>
                <span class="row-actions">
                  <button class="mini-btn danger" title={m.delete()} onclick={(e) => { e.stopPropagation(); removeItem(item); }}><Trash2 size={11} /></button>
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {:else}
    <section class="lab-body">
      <div class="proto-subtabs">
        <button class="pix-btn {protocolsTab === 'templates' ? 'ok' : ''}" onclick={() => protocolsTab = 'templates'}>{m.protoTabTemplates()} ({protoStats.templates})</button>
        <button class="pix-btn {protocolsTab === 'runs' ? 'ok' : ''}" data-testid="proto-tab-runs" onclick={() => protocolsTab = 'runs'}>{m.protoTabRuns()} ({protoStats.runs})</button>
        <span class="tb-spacer"></span>
        <button class="pix-btn ok" data-testid="proto-new" onclick={openNewTemplate}><Plus size={12} /> {m.protoNewTemplate()}</button>
        <button class="pix-btn" onclick={() => protocolFileInput?.click()}><Upload size={12} /> {m.importBtn()}</button>
        <button class="pix-btn" onclick={exportProtocols}><Download size={12} /> {m.exportBtn()}</button>
        <input class="hidden-input" bind:this={protocolFileInput} type="file" accept=".json,.spiceprotocol" onchange={(e) => { void importProtocolsFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>

      {#if protocolsTab === 'templates'}
        {#if !protocolStore.templates.length}
          <div class="empty-panel pix-panel">
            <ClipboardList size={24} />
            <div class="empty-hint">{m.protoEmptyTemplates()}</div>
            <button class="pix-btn ok" onclick={openNewTemplate}><Plus size={12} /> {m.protoNewTemplate()}</button>
          </div>
        {:else}
          <div class="template-grid">
            {#each protocolStore.templates as template (template.id)}
              <div class="template-card pix-panel" data-testid="proto-template-card">
                <div class="tc-head">
                  <strong>{template.name}</strong>
                  <span class="pix-dim">{template.category}</span>
                </div>
                {#if template.description}<div class="pix-dim tc-desc">{template.description}</div>{/if}
                <div class="tc-meta pix-dim">
                  <span>{m.protoStepCount({ n: String(template.steps.length) })}</span>
                  <span>{m.protoParamCount({ n: String(template.parameters.length) })}</span>
                </div>
                <div class="tc-params">
                  {#each template.parameters.slice(0, 4) as p (p.key)}<span class="mini-chip">{p.label || p.key}</span>{/each}
                </div>
                <div class="tc-actions">
                  <button class="pix-btn ok" data-testid="proto-run-btn" onclick={() => openRunModal(template)}><Play size={11} /> {m.protoRunBtn()}</button>
                  <button class="pix-btn" onclick={() => openEditTemplate(template)}>{m.edit()}</button>
                  <button class="mini-btn danger" onclick={() => removeTemplate(template)}><Trash2 size={11} /></button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="run-layout">
          <div class="run-list pix-panel">
            {#if !protocolStore.runs.length}
              <div class="empty-hint">{m.protoRunsEmpty()}</div>
            {:else}
              {#each [...protocolStore.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as run (run.id)}
                <button class="run-row {selectedRunId === run.id ? 'active' : ''}" data-testid="proto-run-row" onclick={() => selectRun(run)}>
                  <span class="run-main"><strong>{run.templateName}</strong><span class="pix-dim">{fmtDate(run.createdAt)}</span></span>
                  <span class="status status-{run.status}">{runStatusLabel(run.status)}</span>
                  <ChevronRight size={12} />
                </button>
              {/each}
            {/if}
          </div>

          <div class="run-detail pix-panel">
            {#if !selectedRun}
              <div class="empty-hint">{m.protoSelectRun()}</div>
            {:else}
              <div class="rd-head">
                <div>
                  <div class="pix-title">{selectedRun.templateName}</div>
                  <div class="pix-dim">{m.protoCreated()}: {fmtDate(selectedRun.createdAt)} · {m.protoElapsed()}: {elapsedLabel(selectedRun)}</div>
                </div>
                <span class="status status-{selectedRun.status}">{runStatusLabel(selectedRun.status)}</span>
              </div>

              <div class="rd-meta">
                <span>{m.protoOperator()}: <strong>{selectedRun.operator || '—'}</strong></span>
                <span>{m.protoProject()}: <strong>{selectedRun.projectName || selectedRun.projectId || '—'}</strong></span>
                <span>{m.protoStatus()}: <strong>{runStatusLabel(selectedRun.status)}</strong></span>
              </div>

              {#if Object.keys(selectedRun.parameterValues).length}
                <div class="rd-section-title">{m.protoParameters()}</div>
                <table class="param-table">
                  <tbody>
                    {#each Object.entries(selectedRun.parameterValues) as [key, value] (key)}
                      <tr><td>{key}</td><td>{String(value)}</td></tr>
                    {/each}
                  </tbody>
                </table>
              {/if}

              <div class="rd-section-title">{m.protoSteps()}</div>
              <div class="step-list">
                {#each selectedRun.steps as step, index (step.stepId)}
                  {@const definition = selectedRunTemplate?.steps.find(s => s.id === step.stepId)}
                  <div class="step-row {step.status}">
                    <div class="step-head">
                      <span class="step-num">{index + 1}</span>
                      <strong>{definition?.title || step.stepId}</strong>
                      <span class="status status-{step.status}">{stepStatusLabel(step.status)}</span>
                    </div>
                    {#if definition?.instructions}<div class="pix-dim step-inst">{definition.instructions}</div>{/if}
                    <div class="pix-dim step-times">
                      {#if definition?.durationMin !== undefined}<span>{m.protoDuration({ n: String(definition.durationMin) })}</span>{/if}
                      {#if definition?.temperatureC !== undefined}<span>{definition.temperatureC} °C</span>{/if}
                      {#if step.completedAt}<span>{m.protoDoneAt()}: {fmtDate(step.completedAt)}</span>{/if}
                    </div>
                    <input class="pix-input step-note" placeholder={m.protoStepNotes()} value={step.notes ?? ''}
                      onchange={(e) => updateStepNotes(step.stepId, e.currentTarget.value)} />
                    <div class="step-actions">
                      {#if step.status === 'pending'}<button class="mini-btn" onclick={() => markStep(step.stepId, 'running')}><Play size={10} /> {m.protoStartStep()}</button>{/if}
                      {#if step.status === 'running'}<button class="mini-btn good" onclick={() => markStep(step.stepId, 'done')}><Check size={10} /> {m.protoDoneStep()}</button>{/if}
                      {#if step.status !== 'done' && step.status !== 'skipped'}<button class="mini-btn" onclick={() => markStep(step.stepId, 'skipped')}><Pause size={10} /> {m.protoSkipStep()}</button>{/if}
                      {#if step.status === 'done' || step.status === 'skipped'}<button class="mini-btn" onclick={() => markStep(step.stepId, 'pending')}>{m.protoResetStep()}</button>{/if}
                    </div>
                  </div>
                {/each}
              </div>

              <div class="rd-section-title">{m.protoResults()}</div>
              <textarea class="pix-input result-box" rows="5" bind:value={runResultBuf} placeholder={m.protoResultsPlaceholder()}></textarea>
              <div class="rd-actions">
                <button class="pix-btn" onclick={saveRunResult}><Save size={11} /> {m.protoSaveResults()}</button>
                {#if selectedRun.status !== 'completed'}<button class="pix-btn ok" onclick={completeRun}><Check size={11} /> {m.protoCompleteRun()}</button>{/if}
                {#if selectedRun.status !== 'completed' && selectedRun.status !== 'aborted'}<button class="pix-btn" onclick={abortRun}>{m.protoAbortRun()}</button>{/if}
                <button class="mini-btn danger" onclick={() => removeRun(selectedRun)}><Trash2 size={11} /> {m.delete()}</button>
              </div>

              <div class="rd-section-title">{m.protoRunSheet()}</div>
              <pre class="run-sheet">{runSheetPreview}</pre>
              <div class="rd-actions">
                <button class="pix-btn" onclick={copyRunSheet}><Copy size={11} /> {m.copy()}</button>
                <button class="pix-btn" onclick={downloadRunSheet}><Download size={11} /> {m.download()}</button>
                <button class="pix-btn ok" onclick={insertRunSheetIntoJournal}><FileText size={11} /> {m.protoInsertJournal()}</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

{#if invEditorOpen}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box inv-modal">
      <div class="modal-title">{invEditingId ? m.invEditTitle() : m.invAddTitle()}</div>
      <div class="form-grid">
        <label>{m.invName()}<input class="pix-input" data-testid="inv-name" bind:value={invForm.name} /></label>
        <label>{m.invKind()}<select class="pix-select" bind:value={invForm.kind}>
          {#each INVENTORY_KINDS as kind (kind)}<option value={kind}>{kindLabel(kind)}</option>{/each}
        </select></label>
        <label>{m.invAlias()}<input class="pix-input" bind:value={invForm.alias} /></label>
        <label>{m.invStatus()}<select class="pix-select" bind:value={invForm.status}>
          {#each INVENTORY_STATUSES as status (status)}<option value={status}>{statusLabel(status)}</option>{/each}
        </select></label>
        <label>{m.invQc()}<select class="pix-select" bind:value={invForm.qc}>
          {#each INVENTORY_QC_STATUSES as qc (qc)}<option value={qc}>{qcLabel(qc)}</option>{/each}
        </select></label>
        <label>{m.invQuantity()}<input class="pix-input" type="number" bind:value={invForm.quantity} /></label>
        <label>{m.invUnit()}<input class="pix-input" bind:value={invForm.quantityUnit} /></label>
        <label>{m.invConcentration()}<input class="pix-input" type="number" bind:value={invForm.concentration} /></label>
        <label>{m.invConcentrationUnit()}<input class="pix-input" bind:value={invForm.concentrationUnit} /></label>
        <label>{m.invOrganism()}<input class="pix-input" bind:value={invForm.organism} /></label>
        <label>{m.invGenotype()}<input class="pix-input" bind:value={invForm.genotype} /></label>
        <label class="wide">{m.invDescription()}<input class="pix-input" bind:value={invForm.description} /></label>
        <label>{m.invTags()}<input class="pix-input" bind:value={invForm.tagsText} placeholder={m.invTagsPlaceholder()} /></label>
        <label class="wide">{m.invSequence()}<textarea class="pix-input mono" rows="3" bind:value={invForm.sequence}></textarea></label>
      </div>

      <div class="sub-title">{m.invLocation()}</div>
      <div class="form-grid four">
        <label>{m.invFreezer()}<input class="pix-input" bind:value={invForm.freezer} /></label>
        <label>{m.invRack()}<input class="pix-input" bind:value={invForm.rack} /></label>
        <label>{m.invBox()}<input class="pix-input" bind:value={invForm.box} /></label>
        <label>{m.invPosition()}<input class="pix-input" bind:value={invForm.position} /></label>
      </div>

      {#if inventoryStore.items.length > 1}
        <div class="sub-title">{m.invParent()}</div>
        <select class="pix-select" multiple size="3" bind:value={invForm.parentIds}>
          {#each inventoryStore.items.filter(i => i.id !== invEditingId) as candidate (candidate.id)}
            <option value={candidate.id}>{candidate.name} · {kindLabel(candidate.kind)}</option>
          {/each}
        </select>
      {/if}

      {#if currentProject}
        <div class="sub-title">{m.invProject()}</div>
        <div class="form-grid">
          <label>{m.invProject()}<input class="pix-input" value={currentProject.meta.name} disabled /></label>
          <label>{m.invDoc()}<select class="pix-select" bind:value={invForm.docId}>
            <option value="">—</option>
            {#each currentProject.docs as doc (doc.id)}<option value={doc.id}>{doc.name}</option>{/each}
          </select></label>
        </div>
      {/if}

      {#if invEditingId}
        {@const lineage = itemLineage(inventoryStore.items, invEditingId)}
        {#if lineage.length}
          <div class="sub-title">{m.invLineage()}</div>
          <div class="lineage">{#each lineage as ancestor (ancestor.id)}<span class="mini-chip">{ancestor.name}</span>{/each}</div>
        {/if}
      {/if}

      <div class="modal-btns">
        <button class="pix-btn" onclick={() => invEditorOpen = false}>{m.cancel()}</button>
        <button class="pix-btn ok" data-testid="inv-save" onclick={saveItem}>{m.save()}</button>
      </div>
    </div>
  </div>
{/if}

{#if primerToolsOpen}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box primer-modal" data-testid="primer-tools-modal">
      <div class="modal-title">{m.primerToolsTitle()}</div>

      <div class="sub-title">{m.limsOrderExportTitle()}</div>
      <div class="pt-row">
        <select class="pix-select" bind:value={primerOrderVendor}>
          <option value="Sangon">{m.limsCompanySangon()}</option>
          <option value="Tsingke">{m.limsCompanyTsingke()}</option>
          <option value="IDT">IDT (USA)</option>
        </select>
        <button class="pix-btn ok" data-testid="primer-order-download" onclick={downloadPrimerOrder}>
          <Download size={11} /> {m.limsGenerateOrderBtn()}
        </button>
        <span class="pix-dim">{m.primerToolsCount({ n: String(primerItems.length) })}</span>
      </div>

      <div class="sub-title">{m.limsSearchAlignTitle()}</div>
      <div class="pt-row">
        <input class="pix-input" bind:value={primerMatchQuery} placeholder={m.primerMatchPlaceholder()} />
        <button class="pix-btn" data-testid="primer-match" onclick={findPrimerMatches}>{m.limsAlignBtn()}</button>
      </div>
      {#if primerMatchDone}
        {#if primerMatches.length}
          <div class="pt-matches">
            {#each primerMatches as match (match.id)}
              <div class="pt-match">
                <strong>{match.name}</strong>
                <span class="pix-dim">Tm {primerTm(match)?.toFixed(1)}°C</span>
                <span class="pix-dim">{locationLabel(match.location) || '—'}</span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="pix-dim pt-empty">{m.primerMatchNone()}</div>
        {/if}
      {/if}

      <div class="sub-title-row">
        <span class="sub-title">{m.limsGridMapTitle()}</span>
        <select class="pix-select" bind:value={primerGridType}>
          <option value="96-well">{m.limsGrid96Well()}</option>
          <option value="10x10-freezer">{m.limsGrid10x10()}</option>
        </select>
      </div>
      {#if primerItems.length === 0}
        <div class="pix-dim pt-empty">{m.primerToolsEmpty()}</div>
      {:else}
        {#if primerGrid.overlapClashes.length > 0}
          <div class="pt-clash">{primerGrid.overlapClashes[0]}</div>
        {/if}
        <div class="pt-grid">
          <div class="pt-grid-row">
            <span class="pt-axis"></span>
            {#each primerGrid.columns as column (column)}
              <span class="pt-axis">{column.replace('C', '')}</span>
            {/each}
          </div>
          {#each primerGrid.grid as rowCells}
            <div class="pt-grid-row">
              <span class="pt-axis">{rowCells[0].rowLabel.replace('R', '')}</span>
              {#each rowCells as cell}
                <span class="pt-cell" class:filled={Boolean(cell.sample)} title="{cell.coordinate}: {cell.sample ? cell.sample.name : m.limsCellFree()}"></span>
              {/each}
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-btns">
        <button class="pix-btn" data-testid="primer-tools-close" onclick={() => (primerToolsOpen = false)}>{m.close()}</button>
      </div>
    </div>
  </div>
{/if}

{#if templateEditorOpen}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box template-modal">
      <div class="modal-title">{editingTemplateId ? m.protoEditTemplate() : m.protoNewTemplate()}</div>
      <div class="form-grid">
        <label>{m.protoName()}<input class="pix-input" data-testid="proto-template-name" bind:value={templateDraft.name} /></label>
        <label>{m.protoCategory()}<input class="pix-input" bind:value={templateDraft.category} /></label>
        <label class="wide">{m.protoDescription()}<textarea class="pix-input" rows="2" bind:value={templateDraft.description}></textarea></label>
      </div>

      <div class="sub-title-row">
        <span class="sub-title">{m.protoParameters()}</span>
        <button class="pix-btn" onclick={addParameter}><Plus size={11} /> {m.protoAddParam()}</button>
      </div>
      {#each templateDraft.parameters as parameter, index (index)}
        <div class="draft-row param-row">
          <input class="pix-input" placeholder={m.protoParamKey()} bind:value={parameter.key} />
          <input class="pix-input" placeholder={m.protoParamLabel()} bind:value={parameter.label} />
          <select class="pix-select" bind:value={parameter.type}>
            {#each ['text', 'number', 'select', 'boolean'] as type (type)}<option value={type}>{paramTypeLabel(type as ProtocolParameterType)}</option>{/each}
          </select>
          <input class="pix-input" placeholder={m.protoParamUnit()} bind:value={parameter.unit} />
          <button class="mini-btn danger" onclick={() => removeParameter(index)}><X size={11} /></button>
        </div>
      {/each}

      <div class="sub-title-row">
        <span class="sub-title">{m.protoSteps()}</span>
        <button class="pix-btn" onclick={addStep}><Plus size={11} /> {m.protoAddStep()}</button>
      </div>
      {#each templateDraft.steps as step, index (step.id)}
        <div class="draft-row step-draft">
          <input class="pix-input" placeholder={m.protoStepTitle()} bind:value={step.title} />
          <input class="pix-input" placeholder={m.protoStepInstructions()} bind:value={step.instructions} />
          <input class="pix-input narrow" type="number" placeholder={m.protoStepDuration()} bind:value={step.durationMin} />
          <input class="pix-input narrow" type="number" placeholder={m.protoStepTemperature()} bind:value={step.temperatureC} />
          <button class="mini-btn danger" onclick={() => removeStep(index)}><X size={11} /></button>
        </div>
      {/each}

      <div class="modal-btns">
        <button class="pix-btn" onclick={() => templateEditorOpen = false}>{m.cancel()}</button>
        <button class="pix-btn ok" data-testid="proto-template-save" onclick={saveTemplate}>{m.save()}</button>
      </div>
    </div>
  </div>
{/if}

{#if runModalOpen && selectedTemplate}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box run-modal">
      <div class="modal-title">{m.protoRunTitle()} · {selectedTemplate.name}</div>
      {#each selectedTemplate.parameters as parameter (parameter.key)}
        <label class="run-param">
          <span>{parameter.label || parameter.key}{#if parameter.required} *{/if}</span>
          {#if parameter.type === 'boolean'}
            <input type="checkbox" checked={runParams[parameter.key] === true}
              onchange={(e) => (runParams[parameter.key] = e.currentTarget.checked)} />
          {:else if parameter.type === 'select'}
            <select class="pix-select" value={String(runParams[parameter.key] ?? '')}
              onchange={(e) => (runParams[parameter.key] = e.currentTarget.value)}>
              {#each parameter.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}
            </select>
          {:else}
            <input class="pix-input" type={parameter.type === 'number' ? 'number' : 'text'}
              value={String(runParams[parameter.key] ?? '')}
              onchange={(e) => (runParams[parameter.key] = parameter.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)} />
          {/if}
          {#if parameter.unit}<span class="pix-dim">{parameter.unit}</span>{/if}
        </label>
      {/each}
      <div class="form-grid">
        <label>{m.protoOperator()}<input class="pix-input" bind:value={runOperator} /></label>
        {#if currentProject}
          <label>{m.protoProject()}<input class="pix-input" value={currentProject.meta.name} disabled /></label>
          <label class="wide">{m.protoJournalPage()}<select class="pix-select" bind:value={runJournalPageId}>
            <option value="">—</option>
            {#each journalPagesForProject() as page (page.id)}<option value={page.id}>{page.title}</option>{/each}
          </select></label>
        {/if}
      </div>
      <div class="modal-btns">
        <button class="pix-btn" onclick={() => runModalOpen = false}>{m.cancel()}</button>
        <button class="pix-btn ok" data-testid="proto-run-start" onclick={startRun}><Play size={11} /> {m.protoRunStart()}</button>
      </div>
    </div>
  </div>
{/if}

<Toaster />

<style>
  .lab-page { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: auto; background: var(--pix-bg); font-family: var(--pix-font); color: var(--pix-fg); font-size: 11px; }
  .lab-head { flex: 0 0 auto; padding: 12px 14px; }
  .lab-title-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .lab-title { display: inline-flex; align-items: center; gap: 7px; color: var(--pix-green); margin: 0; font-size: 15px; }
  .lab-sub { margin-top: 3px; font-size: 10px; }
  .lab-tabs { display: flex; gap: 6px; }
  .lab-tabs .pix-btn, .tool-row .pix-btn, .proto-subtabs .pix-btn { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 2px 10px; font-size: 10px; }

  .lab-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
  .stat-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .stat { padding: 8px 10px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .stat strong { font-size: 16px; color: var(--pix-cyan); }
  .stat strong.warn { color: var(--pix-accent); }
  .stat strong.good { color: var(--pix-green); }

  .tool-row { display: flex; align-items: center; gap: 6px; padding: 7px 8px; flex-wrap: wrap; }
  .search-wrap { display: flex; align-items: center; gap: 5px; flex: 1 1 260px; min-width: 180px; border: 1px solid var(--pix-border); background: var(--pix-bg-3); padding: 0 6px; }
  .search-wrap input { border: 0; background: transparent; flex: 1; height: 24px; }
  .tool-row select { height: 24px; font-size: 10px; max-width: 140px; }
  .tb-spacer { flex: 1; }
  .hidden-input { display: none; }

  .inv-table { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .inv-head, .inv-row { display: grid; grid-template-columns: minmax(160px, 2.2fr) 90px minmax(120px, 1.4fr) 110px 88px 74px 34px; gap: 6px; align-items: center; padding: 5px 8px; }
  .inv-head { position: sticky; top: 0; z-index: 1; background: var(--pix-bg-2); border-bottom: 1px solid var(--pix-border); font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
  .inv-rows { display: flex; flex-direction: column; }
  .inv-row { border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; }
  .inv-row:hover { background: rgba(76,214,255,0.06); }
  .inv-name { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
  .inv-name strong { color: var(--pix-cyan); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag-row { display: flex; flex-wrap: wrap; gap: 3px; }
  .tag { display: inline-flex; align-items: center; gap: 2px; font-size: 8px; color: var(--pix-fg-dim); border: 1px solid var(--pix-border); padding: 0 3px; }
  .kind-chip { display: inline-block; font-size: 8.5px; border: 1px solid var(--pix-border); padding: 1px 5px; color: var(--pix-fg-dim); }
  .kind-strain { color: var(--pix-green); border-color: var(--pix-green); }
  .kind-plasmid { color: var(--pix-cyan); border-color: var(--pix-cyan); }
  .kind-primer { color: var(--pix-accent); border-color: var(--pix-accent); }
  .kind-reagent { color: var(--pix-accent-2); border-color: var(--pix-accent-2); }
  .kind-sample { color: var(--pix-fg); }
  .loc { display: inline-flex; align-items: center; gap: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pix-fg-dim); }
  .qty { display: inline-flex; align-items: center; gap: 3px; }
  .status { font-size: 8.5px; padding: 1px 5px; border: 1px solid var(--pix-border); text-align: center; }
  .status-available, .status-completed, .status-done { color: var(--pix-green); border-color: var(--pix-green); }
  .status-low, .status-planned, .status-pending { color: var(--pix-accent); border-color: var(--pix-accent); }
  .status-depleted, .status-aborted, .status-running { color: var(--pix-red); border-color: var(--pix-red); }
  .status-quarantine, .status-skipped { color: var(--pix-accent-2); border-color: var(--pix-accent-2); }
  .status-archived { color: var(--pix-fg-dim); }
  .qc { font-size: 8.5px; color: var(--pix-fg-dim); }
  .qc-passed { color: var(--pix-green); }
  .qc-failed { color: var(--pix-red); }
  .row-actions { display: flex; justify-content: flex-end; }
  .mini-btn { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--pix-border); background: var(--pix-bg-3); color: var(--pix-fg-dim); font-family: var(--pix-font); font-size: 9px; padding: 1px 5px; cursor: pointer; }
  .mini-btn:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }
  .mini-btn.good { color: var(--pix-green); border-color: var(--pix-green); }
  .mini-btn.danger { color: var(--pix-red); border-color: var(--pix-red); }
  .empty-hint { padding: 24px 12px; text-align: center; color: var(--pix-fg-dim); font-size: 11px; line-height: 1.6; }
  .empty-panel { padding: 34px; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--pix-fg-dim); }

  .proto-subtabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; align-content: start; }
  .template-card { padding: 10px; display: flex; flex-direction: column; gap: 6px; min-height: 150px; }
  .tc-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .tc-head strong { color: var(--pix-cyan); font-size: 12px; }
  .tc-desc { font-size: 9.5px; line-height: 1.4; }
  .tc-meta { display: flex; gap: 10px; font-size: 9px; }
  .tc-params { display: flex; flex-wrap: wrap; gap: 3px; min-height: 16px; }
  .mini-chip { font-size: 8.5px; border: 1px solid var(--pix-border); padding: 1px 4px; color: var(--pix-fg-dim); }
  .tc-actions { display: flex; gap: 4px; margin-top: auto; align-items: center; }
  .tc-actions .pix-btn { height: 22px; font-size: 9px; padding: 1px 7px; display: inline-flex; align-items: center; gap: 3px; }

  .run-layout { display: grid; grid-template-columns: minmax(230px, 0.75fr) minmax(0, 1.8fr); gap: 10px; min-height: 0; flex: 1; }
  .run-list { overflow: auto; padding: 5px; display: flex; flex-direction: column; gap: 3px; }
  .run-row { display: flex; align-items: center; gap: 6px; border: 1px solid var(--pix-border); background: rgba(0,0,0,0.2); color: var(--pix-fg); padding: 6px 7px; cursor: pointer; text-align: left; font-family: var(--pix-font); }
  .run-row:hover, .run-row.active { border-color: var(--pix-green); background: rgba(0,255,100,0.05); }
  .run-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .run-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .run-detail { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 7px; }
  .rd-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .rd-head .pix-title { font-size: 13px; color: var(--pix-green); }
  .rd-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 9px; color: var(--pix-fg-dim); }
  .rd-meta strong { color: var(--pix-fg); }
  .rd-section-title { margin-top: 5px; font-size: 9px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pix-accent); border-bottom: 1px solid var(--pix-border); padding-bottom: 3px; }
  .param-table { border-collapse: collapse; width: 100%; font-size: 9.5px; }
  .param-table td { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 3px 5px; }
  .param-table td:first-child { color: var(--pix-fg-dim); width: 45%; }
  .step-list { display: flex; flex-direction: column; gap: 4px; }
  .step-row { border: 1px solid var(--pix-border); padding: 5px 7px; display: flex; flex-direction: column; gap: 3px; }
  .step-row.running { border-color: var(--pix-accent); }
  .step-row.done { border-color: var(--pix-green); }
  .step-row.skipped { opacity: 0.6; }
  .step-head { display: flex; align-items: center; gap: 6px; }
  .step-num { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--pix-border); font-size: 8px; color: var(--pix-cyan); }
  .step-head strong { flex: 1; font-size: 10px; }
  .step-inst { font-size: 9px; line-height: 1.4; }
  .step-times { display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: 8px; }
  .step-note { height: 22px; font-size: 9px; }
  .step-actions { display: flex; gap: 3px; flex-wrap: wrap; }
  .result-box { font-size: 10px; line-height: 1.5; resize: vertical; }
  .rd-actions { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .rd-actions .pix-btn { height: 23px; padding: 2px 8px; font-size: 9.5px; display: inline-flex; align-items: center; gap: 3px; }
  .run-sheet { margin: 0; padding: 7px 9px; max-height: 220px; overflow: auto; background: rgba(0,0,0,0.3); border: 1px solid var(--pix-border); color: var(--pix-fg-dim); font-family: var(--pix-mono, monospace); font-size: 9px; line-height: 1.5; white-space: pre-wrap; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 999; }
  .modal-box { background: #0b0f19; border: 3px solid var(--pix-border); padding: 14px; max-width: 92%; max-height: 90%; overflow-y: auto; border-radius: 4px; box-shadow: 0 0 25px rgba(0,0,0,0.95); display: flex; flex-direction: column; gap: 9px; }
  .inv-modal { width: 780px; }
  .primer-modal { width: 600px; }
  .pt-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pt-row .pix-input { flex: 1; min-width: 200px; font-size: 10px; }
  .pt-row .pix-btn { display: inline-flex; align-items: center; gap: 3px; }
  .pt-matches { display: flex; flex-direction: column; gap: 2px; max-height: 130px; overflow-y: auto; }
  .pt-match {
    display: flex; align-items: center; gap: 10px; font-size: 9.5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding: 2px 3px;
  }
  .pt-match strong { color: var(--pix-green); }
  .pt-empty { font-size: 10px; padding: 4px 0; }
  .pt-clash { color: var(--pix-red); font-size: 9px; font-weight: bold; }
  .pt-grid { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; overflow-x: auto; padding: 3px; background: rgba(0, 0, 0, 0.25); border: 1px solid var(--pix-border); }
  .pt-grid-row { display: flex; gap: 1px; }
  .pt-axis { width: 15px; height: 11px; font-size: 6.5px; color: var(--pix-fg-dim); display: inline-flex; align-items: center; justify-content: center; }
  .pt-cell { width: 11px; height: 11px; border-radius: 50%; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); }
  .pt-cell.filled { background: var(--pix-green); border-color: #fff; }
  .primer-tm { font-size: 8px; }
  .template-modal { width: 880px; }
  .run-modal { width: 520px; }
  .modal-title { font-weight: 900; color: var(--pix-accent-2); font-size: 13px; letter-spacing: 1px; }
  .modal-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
  .form-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid label, .run-param { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: var(--pix-fg-dim); min-width: 0; }
  .form-grid .wide { grid-column: 1 / -1; }
  .form-grid input, .form-grid select, .form-grid textarea { min-width: 0; font-size: 10px; }
  .form-grid textarea { resize: vertical; }
  .sub-title { margin-top: 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pix-accent); font-weight: bold; }
  .sub-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sub-title-row .pix-btn { height: 21px; font-size: 9px; padding: 1px 7px; display: inline-flex; align-items: center; gap: 3px; }
  .draft-row { display: grid; gap: 4px; align-items: center; margin-bottom: 3px; }
  .param-row { grid-template-columns: 1fr 1.3fr 0.9fr 0.7fr 22px; }
  .step-draft { grid-template-columns: 1fr 1.8fr 0.55fr 0.55fr 22px; }
  .draft-row input, .draft-row select { height: 22px; font-size: 9px; min-width: 0; }
  .draft-row .narrow { min-width: 0; }
  .lineage { display: flex; flex-wrap: wrap; gap: 3px; }
  .run-param { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; align-items: center; gap: 6px; font-size: 10px; }
  .run-param input[type="checkbox"] { justify-self: start; }

  @media (max-width: 900px) {
    .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .inv-head, .inv-row { grid-template-columns: minmax(140px, 2fr) 80px minmax(100px, 1fr) 100px 80px 34px; }
    .inv-head span:nth-child(6), .inv-row > span:nth-child(6) { display: none; }
    .run-layout { grid-template-columns: 1fr; }
    .run-list { max-height: 170px; }
    .form-grid, .form-grid.four { grid-template-columns: 1fr 1fr; }
  }
</style>
