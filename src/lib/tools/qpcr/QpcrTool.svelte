<script lang="ts">
  // qPCR analysis workspace: paste/upload a plate export, review QC flags,
  // compute Delta Ct / Delta Delta Ct fold change or fit standard curves, and
  // export results, charts and a project JSON. All work happens locally.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import {
    Upload,
    FileUp,
    FlaskConical,
    Table,
    TableProperties,
    Calculator,
    CircleAlert,
    Download,
    FileDown,
    FolderOpen,
    RotateCcw,
    ChartColumn,
    Grid3x3,
    Check,
    X
  } from 'lucide-svelte';
  import {
    autoMap,
    buildWells,
    missingRequiredColumns,
    parseDelimited,
    type ParsedTable
  } from './parse';
  import {
    COLUMN_KEYS,
    emptyProject,
    normalizeProject,
    sanitizeSettings,
    type ColumnKey,
    type QpcrProject,
    type Well
  } from './types';
  import {
    chartDataFromDdct,
    chartDataFromStandard,
    computeDdct,
    computeQc,
    computeStandard,
    listGroups,
    listSamples,
    listTargets,
    normKey,
    usableWell,
    type CurveReason,
    type QcFlag,
    type WellQc
  } from './analysis';
  import { barChartSvg, heatmapSvg, svgToPngBytes } from './chart';
  import { buildResultsCsv } from './export';
  import { loadSnapshot, saveSnapshot, clearSnapshot } from './storage';
  import { EXAMPLE_TSV } from './example';

  let project = $state<QpcrProject>(emptyProject());
  let headers = $state<string[]>([]);
  let pasteText = $state('');
  let loaded = $state(false);
  let activeTab = $state<'fold' | 'dct' | 'ddct' | 'curve'>('fold');
  let busy = $state('');
  let dataInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let quotaWarned = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const qc = $derived(computeQc(project.wells, project.settings));
  const ddct = $derived(computeDdct(project.wells, project.settings, qc));
  const standard = $derived(computeStandard(project.wells, project.settings, qc));
  const mappingMissing = $derived(missingRequiredColumns(project.mapping));
  const mappingReady = $derived(mappingMissing.length === 0);
  const hasData = $derived(project.wells.length > 0);
  const flaggedCount = $derived(
    Object.values(qc).filter((entry) => entry.flags.length > 0).length,
  );

  const chartData = $derived(
    project.mode === 'standard' ? chartDataFromStandard(standard) : chartDataFromDdct(ddct),
  );
  const chartTitle = $derived(
    project.mode === 'standard' ? m.qpcrChartTitleQuantity() : m.qpcrChartTitle(),
  );
  const chartYLabel = $derived(
    project.mode === 'standard' ? m.qpcrChartYQuantity() : m.qpcrChartYFold(),
  );
  const chartDoc = $derived(
    chartData ? barChartSvg(chartData, { title: chartTitle, yLabel: chartYLabel }) : null,
  );

  const heatmapDoc = $derived.by(() => {
    if (
      !project.settings.showHeatmap ||
      project.mode !== 'ddct' ||
      !ddct.targets.length ||
      !ddct.matrix.length
    ) {
      return null;
    }
    return heatmapSvg(
      ddct.matrix.map((row) => ({
        label: row.sample,
        sub: row.group,
        values: ddct.targets.map((target) => row.dCt[target.key] ?? null),
      })),
      ddct.targets.map((target) => target.label),
      { title: m.qpcrHeatmapTitle(), low: m.qpcrHeatmapLow(), high: m.qpcrHeatmapHigh() },
    );
  });

  // ------------------------------------------------------------- lifecycle

  onMount(() => {
    const snapshot = loadSnapshot();
    if (snapshot) {
      project = snapshot;
      refreshHeaders();
      if (project.mode === 'standard') activeTab = 'curve';
    }
    loaded = true;
    return () => {
      if (persistTimer) clearTimeout(persistTimer);
    };
  });

  $effect(() => {
    const payload = JSON.stringify(project);
    if (!loaded) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const snapshot = JSON.parse(payload) as QpcrProject;
      snapshot.updatedAt = new Date().toISOString();
      const saved = saveSnapshot(snapshot);
      if (saved) {
        quotaWarned = false;
      } else if (!quotaWarned) {
        quotaWarned = true;
        pushToast('error', m.toolsQpcrTitle(), m.qpcrStorageFull());
      }
    }, 600);
  });

  // ---------------------------------------------------------------- helpers

  function toastSuccess(message: string) {
    pushToast('success', m.toolsQpcrTitle(), message);
  }

  function toastError(message: string, detail?: string) {
    pushToast('error', m.toolsQpcrTitle(), detail ?? message);
  }

  function fmt(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toFixed(digits);
  }

  function fmtFold(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (value >= 1000 || (value > 0 && value < 0.01)) return value.toPrecision(3);
    return value.toFixed(3);
  }

  function fmtQty(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (value >= 10000 || (value > 0 && value < 0.001)) return value.toExponential(2);
    return String(Number(value.toPrecision(3)));
  }

  function fmtEff(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${Math.round(value * 100)}%`;
  }

  function fmtP(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    if (value > 0 && value < 0.0001) return value.toExponential(2);
    return value.toFixed(4);
  }

  function columnLabel(key: ColumnKey): string {
    switch (key) {
      case 'well':
        return m.qpcrColWell();
      case 'sample':
        return m.qpcrColSample();
      case 'target':
        return m.qpcrColTarget();
      case 'ct':
        return m.qpcrColCt();
      case 'group':
        return m.qpcrColGroup();
      case 'replicate':
        return m.qpcrColReplicate();
      case 'efficiency':
        return m.qpcrColEfficiency();
      case 'tm':
        return m.qpcrColTm();
      case 'quantity':
        return m.qpcrColQuantity();
      default:
        return key;
    }
  }

  function requiredColumn(key: ColumnKey): boolean {
    return key === 'sample' || key === 'target' || key === 'ct';
  }

  function flagShort(flag: QcFlag): string {
    switch (flag) {
      case 'missingCt':
        return m.qpcrFlagMissingCtShort();
      case 'highCt':
        return m.qpcrFlagHighCtShort();
      case 'replicateSd':
        return m.qpcrFlagSdShort();
      case 'outlier':
        return m.qpcrFlagOutlierShort();
      case 'duplicateWell':
        return m.qpcrFlagDuplicateShort();
      case 'invalid':
        return m.qpcrFlagInvalidShort();
      default:
        return flag;
    }
  }

  function flagTitle(flag: QcFlag, well: Well, entry: WellQc | undefined): string {
    switch (flag) {
      case 'missingCt':
        return m.qpcrFlagMissingCt();
      case 'highCt':
        return m.qpcrFlagHighCt({ limit: project.settings.highCt });
      case 'replicateSd':
        return m.qpcrFlagSd({ v: fmt(entry?.replicateSd) });
      case 'outlier': {
        const replicateMean = entry?.replicateMean;
        const deviation =
          well.ct !== null && replicateMean !== null && replicateMean !== undefined
            ? Math.abs(well.ct - replicateMean)
            : null;
        return m.qpcrFlagOutlier({ v: fmt(deviation) });
      }
      case 'duplicateWell':
        return m.qpcrFlagDuplicate();
      case 'invalid':
        return m.qpcrFlagInvalid();
      default:
        return flag;
    }
  }

  function curveReasonText(reason: CurveReason): string {
    switch (reason) {
      case 'fewPoints':
        return m.qpcrCurveFewPoints();
      case 'noVariance':
        return m.qpcrCurveNoVariance();
      case 'positiveSlope':
        return m.qpcrCurvePositiveSlope();
      case 'noPoints':
      case 'ok':
      default:
        return m.qpcrCurveNone();
    }
  }

  function baseName(): string {
    const name = project.fileName.replace(/\.[^.]+$/, '') || 'qpcr';
    return name.replace(/[^\w.-]+/g, '_');
  }

  // ------------------------------------------------------------ data import

  function refreshHeaders() {
    if (!project.rawText.trim()) {
      headers = [];
      return;
    }
    try {
      headers = parseDelimited(project.rawText).headers;
    } catch {
      headers = [];
    }
  }

  function applySelectionDefaults() {
    const settings = project.settings;
    const targets = listTargets(project.wells);
    const groups = listGroups(project.wells);
    const samples = listSamples(project.wells);
    if (!targets.some((target) => target.key === normKey(settings.referenceTarget))) {
      settings.referenceTarget = targets[0]?.label ?? '';
    }
    if (!groups.some((group) => group.key === normKey(settings.controlGroup))) {
      settings.controlGroup = groups[0]?.label ?? '';
    }
    if (!samples.some((sample) => sample.key === normKey(settings.controlSample))) {
      settings.controlSample = samples[0]?.label ?? '';
    }
    project.updatedAt = new Date().toISOString();
  }

  function applyText(text: string, name: string, preserveInclude = false): boolean {
    if (!text.trim()) {
      toastError(m.qpcrErrEmptyText());
      return false;
    }
    let table: ParsedTable;
    try {
      table = parseDelimited(text);
    } catch (error) {
      toastError(m.qpcrImportFailed(), error instanceof Error ? error.message : String(error));
      return false;
    }
    if (!table.headers.length) {
      toastError(m.qpcrImportFailed());
      return false;
    }
    const mapping = autoMap(table.headers);
    const previous = preserveInclude ? project.wells : [];
    headers = table.headers;
    project.rawText = text;
    project.fileName = name;
    project.mapping = mapping;
    project.wells = buildWells(table, mapping, previous);
    applySelectionDefaults();
    if (!project.wells.some((well) => well.sample.trim() && well.target.trim())) {
      toastError(m.qpcrErrNoWells());
    } else {
      toastSuccess(m.qpcrImported({ n: project.wells.length }));
    }
    return true;
  }

  function loadPasted() {
    applyText(pasteText, 'pasted-data.tsv');
  }

  function loadExample() {
    pasteText = EXAMPLE_TSV;
    applyText(EXAMPLE_TSV, 'qpcr-example.tsv');
  }

  async function onDataFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      applyText(await file.text(), file.name);
    } catch (error) {
      toastError(m.qpcrImportFailed(), error instanceof Error ? error.message : String(error));
    }
  }

  function onMapChange(key: ColumnKey, value: number) {
    project.mapping = { ...project.mapping, [key]: Number.isFinite(value) ? value : -1 };
    if (!project.rawText.trim()) {
      project.updatedAt = new Date().toISOString();
      return;
    }
    const table = parseDelimited(project.rawText);
    headers = table.headers;
    project.wells = buildWells(table, project.mapping, project.wells);
    applySelectionDefaults();
  }

  function setInclude(wellId: string, value: boolean) {
    const well = project.wells.find((item) => item.id === wellId);
    if (!well) return;
    well.include = value;
    project.updatedAt = new Date().toISOString();
  }

  function includeAll() {
    for (const well of project.wells) well.include = true;
    project.updatedAt = new Date().toISOString();
  }

  function excludeFlagged() {
    for (const well of project.wells) {
      const entry = qc[well.id];
      if (entry && entry.flags.length > 0) well.include = false;
    }
    project.updatedAt = new Date().toISOString();
  }

  function normalizeCurrentSettings() {
    project.settings = sanitizeSettings(project.settings);
    project.updatedAt = new Date().toISOString();
  }

  function setMode(mode: 'ddct' | 'standard') {
    project.mode = mode;
    project.updatedAt = new Date().toISOString();
    activeTab = mode === 'standard' ? 'curve' : 'fold';
  }

  // ---------------------------------------------------------------- exports

  async function saveText(name: string, text: string, message: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, text);
      if (result.data?.saved) {
        toastSuccess(message);
        return true;
      }
      if (result.error) toastError(m.qpcrExportFailed(), result.error);
      return false;
    } catch (error) {
      toastError(m.qpcrExportFailed(), error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function saveBytes(name: string, bytes: Uint8Array, message: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, bytes);
      if (result.data?.saved) {
        toastSuccess(message);
        return true;
      }
      if (result.error) toastError(m.qpcrExportFailed(), result.error);
      return false;
    } catch (error) {
      toastError(m.qpcrExportFailed(), error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function exportCsv() {
    if (!hasData) {
      toastError(m.qpcrNoDataToast());
      return;
    }
    const csv = buildResultsCsv(project, qc, ddct, standard);
    await saveText(`${baseName()}_qpcr_results.csv`, csv, m.qpcrExported());
  }

  async function exportChartSvg() {
    if (!chartDoc) {
      toastError(m.qpcrChartEmptyToast());
      return;
    }
    await saveText(`${baseName()}_qpcr_chart.svg`, chartDoc.svg, m.qpcrExported());
  }

  async function exportChartPng() {
    if (!chartDoc) {
      toastError(m.qpcrChartEmptyToast());
      return;
    }
    busy = m.qpcrBusyExport();
    try {
      const bytes = await svgToPngBytes(chartDoc.svg, chartDoc.width, chartDoc.height, 2);
      await saveBytes(`${baseName()}_qpcr_chart.png`, bytes, m.qpcrExported());
    } catch (error) {
      toastError(m.qpcrExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = '';
    }
  }

  async function exportProjectJson() {
    const snapshot = JSON.parse(JSON.stringify(project)) as QpcrProject;
    snapshot.updatedAt = new Date().toISOString();
    const text = JSON.stringify(snapshot, null, 2);
    await saveText(`${baseName()}_qpcr_project.json`, text, m.qpcrExported());
  }

  async function onProjectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = normalizeProject(JSON.parse(await file.text()));
      if (!parsed) {
        toastError(m.qpcrProjectInvalid());
        return;
      }
      project = parsed;
      refreshHeaders();
      if (parsed.mode === 'standard') activeTab = 'curve';
      toastSuccess(m.qpcrProjectOpened());
    } catch (error) {
      toastError(m.qpcrProjectInvalid(), error instanceof Error ? error.message : String(error));
    }
  }

  function resetAll() {
    if (!confirm(m.qpcrResetConfirm())) return;
    project = emptyProject();
    headers = [];
    pasteText = '';
    activeTab = 'fold';
    clearSnapshot();
    toastSuccess(m.qpcrResetDone());
  }
</script>

<div class="qpcr-shell">
  <aside class="side">
    <div class="side-block">
      <div class="side-title"><Upload size={11} /> {m.qpcrSectionInput()}</div>
      <textarea
        class="paste"
        rows="5"
        placeholder={m.qpcrPastePlaceholder()}
        bind:value={pasteText}
      ></textarea>
      <div class="row">
        <button class="pix-btn ok" onclick={loadPasted} disabled={!pasteText.trim()}>
          <Table size={11} /> {m.qpcrParseBtn()}
        </button>
        <button class="pix-btn" onclick={() => dataInput?.click()}>
          <FileUp size={11} /> {m.qpcrUploadBtn()}
        </button>
      </div>
      <button class="pix-btn-reset full" onclick={loadExample}>
        <FlaskConical size={11} /> {m.qpcrExampleBtn()}
      </button>
      <div class="hint">{m.qpcrFileHint()}</div>
    </div>

    <div class="side-block">
      <div class="side-title"><TableProperties size={11} /> {m.qpcrSectionColumns()}</div>
      {#if headers.length === 0}
        <div class="hint">{m.qpcrColumnsHint()}</div>
      {:else}
        <div class="map-grid">
          {#each COLUMN_KEYS as key (key)}
            <label class="map-row">
              <span class="map-label" class:required={requiredColumn(key)}>{columnLabel(key)}</span>
              <select
                class="map-select"
                value={String(project.mapping[key])}
                onchange={(event) =>
                  onMapChange(key, Number((event.currentTarget as HTMLSelectElement).value))}
              >
                <option value="-1">{m.qpcrColNone()}</option>
                {#each headers as header, index (index)}
                  <option value={String(index)}>
                    {header || m.qpcrColumnN({ n: index + 1 })}
                  </option>
                {/each}
              </select>
            </label>
          {/each}
        </div>
        {#if !mappingReady}
          <div class="warn"><CircleAlert size={10} /> {m.qpcrRequiredHint()}</div>
        {/if}
      {/if}
    </div>

    <div class="side-block">
      <div class="side-title"><Calculator size={11} /> {m.qpcrSectionAnalysis()}</div>
      <label class="field">
        <span>{m.qpcrReferenceLabel()}</span>
        <select bind:value={project.settings.referenceTarget}>
          {#each ddct.targets as target (target.key)}
            <option value={target.label}>{target.label}</option>
          {/each}
          {#if !ddct.targets.length}
            <option value="">—</option>
          {/if}
        </select>
      </label>
      <label class="field">
        <span>{m.qpcrControlGroupLabel()}</span>
        <select bind:value={project.settings.controlGroup} disabled={!ddct.groups.length}>
          <option value="">{m.qpcrNoGroupsOption()}</option>
          {#each ddct.groups as group (group.key)}
            <option value={group.label}>{group.label}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{m.qpcrControlSampleLabel()}</span>
        <select bind:value={project.settings.controlSample}>
          <option value="">—</option>
          {#each ddct.samples as sample (sample.key)}
            <option value={sample.label}>{sample.label}</option>
          {/each}
        </select>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={project.settings.efficiencyCorrection} />
        {m.qpcrEfficiencyToggle()}
      </label>
      <label class="field">
        <span>{m.qpcrDefaultEfficiency()}</span>
        <input
          class="pix-input"
          type="number"
          min="10"
          max="200"
          step="1"
          bind:value={project.settings.defaultEfficiencyPct}
          onchange={normalizeCurrentSettings}
        />
      </label>
      {#if project.mode === 'standard'}
        <label class="check">
          <input type="checkbox" bind:checked={project.settings.quantityIsLog10} />
          {m.qpcrQuantityLog10()}
        </label>
      {/if}
    </div>

    <div class="side-block">
      <div class="side-title"><CircleAlert size={11} /> {m.qpcrSectionQc()}</div>
      <label class="field">
        <span>{m.qpcrHighCt()}</span>
        <input
          class="pix-input"
          type="number"
          min="20"
          max="45"
          step="1"
          bind:value={project.settings.highCt}
          onchange={normalizeCurrentSettings}
        />
      </label>
      <label class="field">
        <span>{m.qpcrSdLimit()}</span>
        <input
          class="pix-input"
          type="number"
          min="0"
          max="2"
          step="0.05"
          bind:value={project.settings.sdLimit}
          onchange={normalizeCurrentSettings}
        />
      </label>
      <label class="field">
        <span>{m.qpcrOutlierLimit()}</span>
        <input
          class="pix-input"
          type="number"
          min="0"
          max="2"
          step="0.05"
          bind:value={project.settings.outlierLimit}
          onchange={normalizeCurrentSettings}
        />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={project.settings.excludeOutliers} />
        {m.qpcrExcludeOutliers()}
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={project.settings.showHeatmap} />
        {m.qpcrShowHeatmap()}
      </label>
    </div>

    <div class="side-block">
      <div class="side-title"><Download size={11} /> {m.qpcrSectionExport()}</div>
      <button class="pix-btn full" onclick={exportCsv} disabled={!hasData}>
        <FileDown size={11} /> {m.qpcrExportCsv()}
      </button>
      <div class="row">
        <button class="pix-btn" onclick={exportChartSvg} disabled={!chartDoc}>
          <ChartColumn size={11} /> {m.qpcrExportSvg()}
        </button>
        <button class="pix-btn" onclick={exportChartPng} disabled={!chartDoc}>
          <Grid3x3 size={11} /> {m.qpcrExportPng()}
        </button>
      </div>
      <div class="row">
        <button class="pix-btn" onclick={exportProjectJson}>
          <Download size={11} /> {m.qpcrSaveProject()}
        </button>
        <button class="pix-btn" onclick={() => projectInput?.click()}>
          <FolderOpen size={11} /> {m.qpcrOpenProject()}
        </button>
      </div>
      <button class="pix-btn-reset full reset-btn" onclick={resetAll}>
        <RotateCcw size={11} /> {m.qpcrReset()}
      </button>
      <div class="hint">{m.qpcrAutosaveHint()}</div>
    </div>
  </aside>

  <main class="workspace">
    <div class="workspace-bar">
      <div class="mode-toggle">
        <button class:active={project.mode === 'ddct'} onclick={() => setMode('ddct')}>
          {m.qpcrModeDdct()}
        </button>
        <button class:active={project.mode === 'standard'} onclick={() => setMode('standard')}>
          {m.qpcrModeStandard()}
        </button>
      </div>
      <span class="chip">{m.qpcrWells({ n: project.wells.length })}</span>
      {#if flaggedCount > 0}
        <span class="chip chip-warn">{m.qpcrFlagged({ n: flaggedCount })}</span>
      {/if}
      {#if project.fileName}
        <span class="file-name" title={project.fileName}>{project.fileName}</span>
      {/if}
      <span class="spacer"></span>
      {#if busy}<span class="busy">{busy}</span>{/if}
    </div>

    <div class="workspace-scroll">
      {#if !hasData}
        <div class="empty">
          <span class="empty-icon"><FlaskConical size={44} /></span>
          <h2>{m.qpcrNoDataTitle()}</h2>
          <p>{m.qpcrNoDataHint()}</p>
          <div class="empty-actions">
            <button class="pix-btn ok" onclick={loadExample}>
              <FlaskConical size={12} /> {m.qpcrExampleBtn()}
            </button>
            <button class="pix-btn" onclick={() => dataInput?.click()}>
              <FileUp size={12} /> {m.qpcrUploadBtn()}
            </button>
          </div>
        </div>
      {:else}
        {#if !mappingReady}
          <div class="banner banner-error">
            <CircleAlert size={13} /> {m.qpcrRequiredHint()}
          </div>
        {:else if project.mode === 'ddct'}
          {#if ddct.missingReference}
            <div class="banner banner-warn">
              <CircleAlert size={13} /> {m.qpcrNeedReference()}
            </div>
          {:else if ddct.referenceFallback}
            <div class="banner banner-info">
              <CircleAlert size={13} />
              {m.qpcrReferenceFallback({ name: ddct.reference?.label ?? '' })}
            </div>
          {/if}
          {#if !ddct.samples.length}
            <div class="banner banner-warn">
              <CircleAlert size={13} /> {m.qpcrNeedControl()}
            </div>
          {:else if ddct.controlFallback}
            <div class="banner banner-info">
              <CircleAlert size={13} />
              {m.qpcrControlFallback({ name: ddct.controlLabel })}
            </div>
          {/if}
        {:else if standard.missingStandards}
          <div class="banner banner-warn">
            <CircleAlert size={13} /> {m.qpcrCurveNone()}
          </div>
        {/if}

        <section class="card">
          <div class="card-head">
            <span class="card-title"><Table size={12} /> {m.qpcrDataTitle()}</span>
            <span class="meta">{m.qpcrWells({ n: project.wells.length })}</span>
            {#if flaggedCount > 0}
              <span class="meta meta-warn">{m.qpcrFlagged({ n: flaggedCount })}</span>
            {/if}
            <span class="spacer"></span>
            <button class="tiny-btn" onclick={includeAll}><Check size={10} /> {m.qpcrIncludeAll()}</button>
            <button class="tiny-btn" onclick={excludeFlagged}>
              <X size={10} /> {m.qpcrExcludeFlagged()}
            </button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{m.qpcrThRow()}</th>
                  <th>{m.qpcrThInclude()}</th>
                  <th>{m.qpcrThWell()}</th>
                  <th>{m.qpcrThSample()}</th>
                  <th>{m.qpcrThTarget()}</th>
                  <th>{m.qpcrThGroup()}</th>
                  <th>{m.qpcrThRep()}</th>
                  <th>{m.qpcrThCt()}</th>
                  <th>{m.qpcrThTm()}</th>
                  <th>{m.qpcrThEff()}</th>
                  <th>{m.qpcrThQty()}</th>
                  <th>{m.qpcrThFlags()}</th>
                </tr>
              </thead>
              <tbody>
                {#each project.wells as well (well.id)}
                  {@const entry = qc[well.id]}
                  {@const usable = usableWell(well, entry, project.settings)}
                  <tr class:excluded={!usable}>
                    <td class="dim">{well.row + 2}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={well.include}
                        onchange={(event) =>
                          setInclude(well.id, (event.currentTarget as HTMLInputElement).checked)}
                      />
                    </td>
                    <td>{well.well || '—'}</td>
                    <td>{well.sample || '—'}</td>
                    <td>{well.target || '—'}</td>
                    <td>{well.group || '—'}</td>
                    <td>{well.replicate ?? '—'}</td>
                    <td class:missing={well.ct === null}>
                      {well.ct === null ? m.qpcrUndetermined() : fmt(well.ct)}
                    </td>
                    <td>{fmt(well.tm, 1)}</td>
                    <td>{well.efficiency === null ? '—' : `${Math.round(well.efficiency * 100)}%`}</td>
                    <td>{fmtQty(well.quantity)}</td>
                    <td>
                      <div class="flags">
                        {#each entry?.flags ?? [] as flag (flag)}
                          <span
                            class="flag flag-{flag}"
                            title={flagTitle(flag, well, entry)}
                          >{flagShort(flag)}</span>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <span class="card-title"><ChartColumn size={12} /> {chartTitle}</span>
            <span class="spacer"></span>
            <span class="meta">{project.mode === 'standard' ? m.qpcrModeStandard() : m.qpcrModeDdct()}</span>
          </div>
          {#if chartDoc}
            <div class="chart-wrap">{@html chartDoc.svg}</div>
          {:else}
            <div class="card-empty">{m.qpcrChartEmpty()}</div>
          {/if}
          {#if heatmapDoc}
            <div class="heatmap-wrap">{@html heatmapDoc.svg}</div>
          {/if}
        </section>

        <section class="card">
          <div class="card-head">
            <span class="card-title">{m.qpcrResultsTitle()}</span>
            <span class="spacer"></span>
            <div class="tabs">
              <button class:active={activeTab === 'fold'} onclick={() => (activeTab = 'fold')}>
                {m.qpcrTabFold()}
              </button>
              <button class:active={activeTab === 'dct'} onclick={() => (activeTab = 'dct')}>
                {m.qpcrTabDCt()}
              </button>
              <button class:active={activeTab === 'ddct'} onclick={() => (activeTab = 'ddct')}>
                {m.qpcrTabDDCt()}
              </button>
              <button class:active={activeTab === 'curve'} onclick={() => (activeTab = 'curve')}>
                {m.qpcrTabCurve()}
              </button>
            </div>
          </div>

          {#if activeTab === 'fold'}
            {#if ddct.sampleResults.length}
              <div class="table-wrap results-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{m.qpcrTableSample()}</th>
                      <th>{m.qpcrTableTarget()}</th>
                      <th>{m.qpcrTableGroup()}</th>
                      <th>{m.qpcrTableN()}</th>
                      <th>{m.qpcrTableMeanCt()}</th>
                      <th>{m.qpcrTableSdCt()}</th>
                      <th>{m.qpcrTableDCt()}</th>
                      <th>{m.qpcrTableDdCt()}</th>
                      <th>{m.qpcrTableEff()}</th>
                      <th>{m.qpcrTableFold()}</th>
                      <th>{m.qpcrTableSd()}</th>
                      <th>{m.qpcrTableSem()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each ddct.sampleResults as result (`${result.sampleKey}\u0000${result.targetKey}`)}
                      <tr class:control-row={result.isControl}>
                        <td>
                          {result.sample}
                          {#if result.isControl}
                            <span class="tag">{m.qpcrControlTag()}</span>
                          {/if}
                        </td>
                        <td>{result.target}</td>
                        <td>{result.group || '—'}</td>
                        <td>{result.n}</td>
                        <td>{fmt(result.meanCt)}</td>
                        <td>{fmt(result.sdCt)}</td>
                        <td>{fmt(result.dCt)}</td>
                        <td>{fmt(result.ddCt)}</td>
                        <td>{project.settings.efficiencyCorrection ? fmtEff(result.efficiency) : '—'}</td>
                        <td class="strong">{fmtFold(result.fold)}</td>
                        <td>{fmtFold(result.foldSd)}</td>
                        <td>{fmtFold(result.foldSem)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <div class="section-title">{m.qpcrGroupSummary()}</div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{m.qpcrTableGroup()}</th>
                      <th>{m.qpcrTableTarget()}</th>
                      <th>{m.qpcrTableNSamples()}</th>
                      <th>{m.qpcrTableFold()}</th>
                      <th>{m.qpcrTableSd()}</th>
                      <th>{m.qpcrTableSem()}</th>
                      <th>{m.qpcrTableP()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each ddct.groupResults as group (`${group.categoryKey}\u0000${group.targetKey}`)}
                      <tr class:control-row={group.isControl}>
                        <td>
                          {group.category}
                          {#if group.isControl}
                            <span class="tag">{m.qpcrControlTag()}</span>
                          {/if}
                        </td>
                        <td>{group.target}</td>
                        <td>{group.nSamples}</td>
                        <td class="strong">{fmtFold(group.meanFold)}</td>
                        <td>{fmtFold(group.sdFold)}</td>
                        <td>{fmtFold(group.semFold)}</td>
                        <td>{fmtP(group.pValue)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="note">{m.qpcrPValueHint()}</div>

              {#if ddct.replicates.length}
                <div class="section-title">{m.qpcrReplicateTable()}</div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{m.qpcrTableSample()}</th>
                        <th>{m.qpcrTableTarget()}</th>
                        <th>{m.qpcrReplicate()}</th>
                        <th>{m.qpcrThWell()}</th>
                        <th>{m.qpcrThCt()}</th>
                        <th>{m.qpcrTableRefCt()}</th>
                        <th>{m.qpcrTableDCt()}</th>
                        <th>{m.qpcrTableDdCt()}</th>
                        <th>{m.qpcrTableFold()}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each ddct.replicates as rep, index (`${rep.sampleKey}\u0000${rep.targetKey}\u0000${index}`)}
                        <tr class:control-row={rep.isControl}>
                          <td>{rep.sample}</td>
                          <td>{rep.target}</td>
                          <td>{rep.replicate ?? '—'}</td>
                          <td>{rep.well || '—'}</td>
                          <td>{fmt(rep.ct)}</td>
                          <td>{fmt(rep.refCt)}</td>
                          <td>{fmt(rep.dCt)}</td>
                          <td>{fmt(rep.ddCt)}</td>
                          <td>{fmtFold(rep.fold)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else}
              <div class="card-empty">{m.qpcrNoResults()}</div>
            {/if}
          {:else if activeTab === 'dct'}
            <div class="table-wrap results-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{m.qpcrTableSample()}</th>
                    <th>{m.qpcrTableGroup()}</th>
                    <th>{m.qpcrTableRefCt()}</th>
                    {#each ddct.targets as target (target.key)}
                      <th>{target.label}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each ddct.matrix as row (row.sampleKey)}
                    <tr class:control-row={row.isControl}>
                      <td>
                        {row.sample}
                        {#if row.isControl}
                          <span class="tag">{m.qpcrControlTag()}</span>
                        {/if}
                      </td>
                      <td>{row.group || '—'}</td>
                      <td>{fmt(row.refCt)}</td>
                      {#each ddct.targets as target (target.key)}
                        <td>{fmt(row.dCt[target.key])}</td>
                      {/each}
                    </tr>
                  {/each}
                  <tr class="mean-row">
                    <td>{m.qpcrControlMean()}</td>
                    <td></td>
                    <td></td>
                    {#each ddct.targets as target (target.key)}
                      <td>{fmt(ddct.controlMeanDCt[target.key])}</td>
                    {/each}
                  </tr>
                </tbody>
              </table>
            </div>
          {:else if activeTab === 'ddct'}
            <div class="table-wrap results-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{m.qpcrTableSample()}</th>
                    <th>{m.qpcrTableGroup()}</th>
                    {#each ddct.targets as target (target.key)}
                      <th>{target.label}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each ddct.matrix as row (row.sampleKey)}
                    <tr class:control-row={row.isControl}>
                      <td>
                        {row.sample}
                        {#if row.isControl}
                          <span class="tag">{m.qpcrControlTag()}</span>
                        {/if}
                      </td>
                      <td>{row.group || '—'}</td>
                      {#each ddct.targets as target (target.key)}
                        <td>{fmt(row.ddCt[target.key])}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            {#if standard.missingStandards}
              <div class="card-empty">{m.qpcrCurveNone()}</div>
            {:else}
              <div class="section-title">{m.qpcrCurveTitle()}</div>
              {#if standard.fits.length}
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{m.qpcrTableTarget()}</th>
                        <th>{m.qpcrCurveSlope()}</th>
                        <th>{m.qpcrCurveIntercept()}</th>
                        <th>{m.qpcrCurveR2()}</th>
                        <th>{m.qpcrCurveEff()}</th>
                        <th>{m.qpcrCurveN()}</th>
                        <th>{m.qpcrThFlags()}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each standard.fits as fit (fit.targetKey)}
                        <tr>
                          <td>{fit.target}</td>
                          <td>{fmt(fit.slope, 3)}</td>
                          <td>{fmt(fit.intercept, 3)}</td>
                          <td>{fmt(fit.r2, 4)}</td>
                          <td>{fit.valid ? fmtEff(fit.efficiency) : '—'}</td>
                          <td>{fit.n}</td>
                          <td>
                            {#if fit.reason !== 'ok'}
                              <span class="status">{curveReasonText(fit.reason)}</span>
                            {/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <div class="card-empty">{m.qpcrCurveNone()}</div>
              {/if}
              <div class="note">{m.qpcrCurveHint()}</div>

              <div class="section-title">{m.qpcrCurveUnknown()}</div>
              {#if standard.samples.length}
                <div class="table-wrap results-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{m.qpcrTableSample()}</th>
                        <th>{m.qpcrTableTarget()}</th>
                        <th>{m.qpcrTableGroup()}</th>
                        <th>{m.qpcrTableN()}</th>
                        <th>{m.qpcrTableMeanCt()}</th>
                        <th>{m.qpcrTableLogQty()}</th>
                        <th>{m.qpcrTableQuantity()}</th>
                        <th>{m.qpcrTableSdLog()}</th>
                        <th>{m.qpcrTableSemLog()}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each standard.samples as sample (`${sample.sampleKey}\u0000${sample.targetKey}`)}
                        <tr>
                          <td>{sample.sample}</td>
                          <td>{sample.target}</td>
                          <td>{sample.group || '—'}</td>
                          <td>{sample.n}</td>
                          <td>{fmt(sample.meanCt)}</td>
                          <td>{fmt(sample.log10Quantity, 3)}</td>
                          <td>{fmtQty(sample.quantity)}</td>
                          <td>{fmt(sample.sdLog, 3)}</td>
                          <td>{fmt(sample.semLog, 3)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <div class="card-empty">{m.qpcrNoResults()}</div>
              {/if}
            {/if}
          {/if}
        </section>
      {/if}
    </div>
  </main>
</div>

<input
  type="file"
  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
  style="display:none"
  bind:this={dataInput}
  onchange={onDataFile}
/>
<input
  type="file"
  accept=".json,application/json"
  style="display:none"
  bind:this={projectInput}
  onchange={onProjectFile}
/>

<style>
  .qpcr-shell {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--pix-bg);
    font-family: var(--pix-font);
    overflow: hidden;
  }

  /* ------------------------------------------------------------- sidebar */
  .side {
    flex: 0 0 322px;
    min-height: 0;
    overflow-y: auto;
    padding: 9px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    background: var(--pix-bg-2);
    border-right: 2px solid var(--pix-border);
  }
  .side-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--pix-panel);
    border: 2px solid var(--pix-border);
  }
  .side-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    font-weight: 900;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .paste {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 70px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 10px;
    line-height: 1.5;
    padding: 5px 6px;
  }
  .paste:focus { outline: none; border-color: var(--pix-cyan); }
  .row { display: flex; gap: 6px; }
  .row > .pix-btn { flex: 1; min-width: 0; }
  .side :global(.pix-btn),
  .side :global(.pix-btn-reset) {
    font-size: 9px;
    letter-spacing: 0;
    padding: 3px 6px;
    line-height: 1.3;
    white-space: normal;
  }
  .full { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
  .hint { font-size: 9px; line-height: 1.55; color: var(--pix-fg-dim); }
  .warn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    line-height: 1.4;
    color: var(--pix-red);
  }
  .map-grid { display: flex; flex-direction: column; gap: 4px; }
  .map-row { display: grid; grid-template-columns: 88px 1fr; align-items: center; gap: 5px; }
  .map-label { font-size: 9px; color: var(--pix-fg-dim); }
  .map-label.required { color: var(--pix-accent-2); }
  .map-select,
  .field select,
  .field input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 9.5px;
    padding: 2px 4px;
  }
  .map-select:focus,
  .field select:focus,
  .field input:focus { outline: none; border-color: var(--pix-cyan); }
  .field {
    display: grid;
    grid-template-columns: 112px 1fr;
    align-items: center;
    gap: 5px;
  }
  .field > span { font-size: 9px; color: var(--pix-fg-dim); }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    font-size: 9.5px;
    line-height: 1.4;
    color: var(--pix-fg);
    cursor: pointer;
  }
  .check input { accent-color: var(--pix-cyan); margin: 1px 0 0 0; }
  .reset-btn { margin-top: 2px; }
  .reset-btn:hover { background: var(--pix-red); color: #fff; border-color: var(--pix-red); }

  /* ----------------------------------------------------------- workspace */
  .workspace {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--pix-bg);
  }
  .workspace-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .mode-toggle { display: inline-flex; border: 2px solid var(--pix-border); }
  .mode-toggle button {
    border: none;
    border-right: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 9.5px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .mode-toggle button:last-child { border-right: none; }
  .mode-toggle button:hover { color: var(--pix-fg); }
  .mode-toggle button.active {
    background: var(--pix-cyan);
    color: #041018;
    font-weight: bold;
  }
  .chip {
    font-size: 9px;
    padding: 2px 6px;
    border: 2px solid var(--pix-border);
    color: var(--pix-fg-dim);
    white-space: nowrap;
  }
  .chip-warn { color: var(--pix-red); border-color: var(--pix-red); }
  .file-name {
    font-size: 9px;
    color: var(--pix-fg-dim);
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer { flex: 1; min-width: 6px; }
  .busy { font-size: 9px; color: var(--pix-accent); }
  .workspace-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-size: 10px;
    line-height: 1.4;
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
  }
  .banner-error { border-color: var(--pix-red); color: var(--pix-red); }
  .banner-warn { border-color: var(--pix-accent); color: var(--pix-accent); }
  .banner-info { border-color: var(--pix-cyan); color: var(--pix-cyan); }

  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--pix-panel);
    border: 2px solid var(--pix-border);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 5px 9px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .card-title {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    font-weight: 900;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--pix-accent-2);
  }
  .meta { font-size: 9px; color: var(--pix-fg-dim); }
  .meta-warn { color: var(--pix-red); }
  .tiny-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 8.5px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .tiny-btn:hover { color: var(--pix-cyan); border-color: var(--pix-cyan); }

  .table-wrap { overflow: auto; max-height: 360px; min-width: 0; }
  .table-wrap.results-wrap { max-height: 460px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--pix-bg-2);
    color: var(--pix-fg-dim);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    text-align: left;
    padding: 3px 5px;
    border-bottom: 2px solid var(--pix-border);
    white-space: nowrap;
  }
  td {
    padding: 2px 5px;
    border-bottom: 1px solid rgba(42, 52, 80, 0.65);
    color: var(--pix-fg);
    white-space: nowrap;
  }
  tbody tr:hover td { background: rgba(76, 214, 255, 0.05); }
  tr.excluded td { opacity: 0.48; }
  tr.control-row td { background: rgba(83, 215, 105, 0.06); }
  tr.mean-row td { border-top: 2px solid var(--pix-border); color: var(--pix-fg-dim); }
  td.dim { color: var(--pix-fg-dim); }
  td.strong { font-weight: bold; color: var(--pix-accent-2); }
  td.missing { color: var(--pix-red); }
  .flags { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
  .tag {
    display: inline-block;
    font-size: 7.5px;
    color: var(--pix-green);
    border: 1px solid var(--pix-green);
    padding: 0 3px;
    margin-left: 4px;
    vertical-align: 1px;
  }
  .flag {
    display: inline-block;
    font-size: 7.5px;
    line-height: 1.4;
    padding: 0 3px;
    border: 1px solid currentColor;
    white-space: nowrap;
  }
  .flag-missingCt { color: var(--pix-red); }
  .flag-highCt { color: var(--pix-accent); }
  .flag-replicateSd { color: var(--pix-purple); }
  .flag-outlier { color: var(--pix-red); }
  .flag-duplicateWell { color: var(--pix-cyan); }
  .flag-invalid { color: var(--pix-red); }

  .chart-wrap {
    padding: 8px;
    background: #ffffff;
    overflow: auto;
  }
  .chart-wrap :global(svg) { display: block; width: 100%; height: auto; }
  .heatmap-wrap {
    padding: 8px;
    background: #ffffff;
    border-top: 2px solid var(--pix-border);
    overflow: auto;
  }
  .heatmap-wrap :global(svg) { display: block; width: 100%; height: auto; }
  .card-empty {
    padding: 18px 12px;
    font-size: 10px;
    color: var(--pix-fg-dim);
    text-align: center;
  }

  .tabs { display: inline-flex; flex-wrap: wrap; gap: 2px; }
  .tabs button {
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 8.5px;
    padding: 1px 7px;
    cursor: pointer;
  }
  .tabs button:hover { color: var(--pix-fg); }
  .tabs button.active {
    color: var(--pix-green);
    border-color: var(--pix-green);
    background: rgba(83, 215, 105, 0.08);
  }
  .section-title {
    padding: 6px 9px 4px;
    font-size: 8.5px;
    font-weight: 900;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
    border-top: 1px dashed var(--pix-border);
  }
  .note {
    padding: 3px 9px 7px;
    font-size: 8.5px;
    line-height: 1.5;
    color: var(--pix-fg-dim);
  }
  .status { color: var(--pix-accent); font-size: 8.5px; }

  .empty {
    flex: 1;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 20px;
    text-align: center;
    color: var(--pix-fg-dim);
  }
  .empty-icon { color: var(--pix-cyan); display: inline-flex; }
  .empty h2 {
    margin: 0;
    font-size: 14px;
    letter-spacing: 1.5px;
    color: var(--pix-accent-2);
  }
  .empty p { margin: 0; max-width: 460px; font-size: 10.5px; line-height: 1.7; }
  .empty-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

  @media (max-width: 980px) {
    .qpcr-shell { flex-direction: column; }
    .side {
      flex: 0 0 auto;
      max-height: 46vh;
      border-right: none;
      border-bottom: 2px solid var(--pix-border);
    }
    .workspace { min-height: 0; }
  }
</style>
