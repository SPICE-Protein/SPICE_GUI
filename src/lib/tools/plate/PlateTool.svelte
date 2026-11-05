<script lang="ts">
  // Plate layout designer: samples, deterministic assignment rules, manual
  // painting, visualization and export. All state stays in the webview.
  import { onMount } from 'svelte';
  import { m } from './messages';
  import type { MessageParams } from './messages';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import { sendImageToFigure } from '$lib/tools/shared/figureBridge';
  import {
    AlertTriangle,
    Check,
    CheckCircle2,
    Copy,
    Download,
    FileDown,
    FileUp,
    Grid3X3,
    ImagePlus,
    Layers,
    ListTree,
    Maximize,
    MousePointer,
    Palette,
    Plus,
    RefreshCw,
    Save,
    Send,
    Sparkles,
    Trash2,
    Upload,
    X,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import {
    PLATE_FORMATS,
    MAX_REPLICATES,
    MAX_SEED,
    assignmentsToMap,
    buildWellCells,
    clampInt,
    defaultRules,
    formatGeometry,
    isPlateFormat,
    normalizeColor,
    rowLabel,
    wellCellMap,
    wellId,
    type GroupLayout,
    type LayoutIssue,
    type PlateFormat,
    type PlateProjectFile,
    type PlateRules,
    type SampleDraft,
    type SampleRow,
    type UnplacedSample,
    type WellAssignment
  } from './types';
  import {
    assignPlate,
    manualAuxAssignment,
    manualSampleAssignment,
    validateLayout
  } from './assign';
  import {
    buildPlateRows,
    fileBaseName,
    parseSampleTable,
    plateRowsToCsv,
    plateRowsToTsv
  } from './csv';
  import {
    buildPlateSvg,
    canvasToPngBytes,
    copyText,
    pngWithDpi,
    renderSvgToCanvas,
    type PlateSvgCell
  } from './export';
  import {
    loadPlateSnapshot,
    parsePlateProject,
    savePlateSnapshot,
    serializePlateProject
  } from './storage';
  import { randomSeedValue } from './random';
  import { normalizePlatePayload, plateProjectCounts, plateProjectName } from './projectDoc';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import {
    ensureProjectLoaded,
    finishToolCapture,
    takeToolHandoff
  } from '$lib/tools/shared/projectBridge';
  import ToolProjectBar from '$lib/tools/shared/ToolProjectBar.svelte';
  import { svgPreview } from '$lib/tools/shared/preview';
  import { saveReproBundle } from '$lib/repro/bundle';
  import {
    parseSampleSheet,
    sampleSheetToCsv,
    sampleSheetToJson,
    type SampleSheet
  } from '$lib/tools/shared/samples';

  // ---------------------------------------------------------------- constants

  const PALETTE = [
    '#4cd6ff',
    '#ffd23f',
    '#53d769',
    '#b48cff',
    '#ff9f1c',
    '#ff5d5d',
    '#61e0c0',
    '#f78fb3',
    '#a3d977',
    '#8bb8ff',
    '#e0aaff',
    '#ffcf9f',
    '#7ce0ff',
    '#f2e06b'
  ];
  const CONTROL_COLOR = '#b48cff';
  const BLANK_COLOR = '#7f8ba8';
  const RESERVED_COLOR = '#26304a';
  const EMPTY_COLOR = '#0e1220';
  const REPLICATE_OPTIONS = Array.from({ length: MAX_REPLICATES }, (_, index) => index + 1);
  const GROUP_LAYOUTS: GroupLayout[] = ['auto', 'row', 'column', 'block'];

  interface LegendItem {
    key: string;
    label: string;
    color: string;
    count: number;
  }

  // ------------------------------------------------------------------- state

  let format = $state<PlateFormat>(96);
  let title = $state('');
  let samples = $state<SampleRow[]>([]);
  let rules = $state<PlateRules>(defaultRules());
  let assignments = $state<Record<string, WellAssignment>>({});
  let generated = $state(false);
  let layoutSignature = $state('');
  let seedReport = $state<number | null>(null);
  let colorBy = $state<'group' | 'sample'>('group');
  let showLabels = $state(true);
  let zoom = $state(1);
  let selectedWell = $state<string | null>(null);
  let selectedSampleId = $state<string | null>(null);
  let paintTool = $state<'select' | 'sample' | 'control' | 'blank' | 'empty'>('select');
  let painting = $state(false);
  let pasteText = $state('');
  let importMode = $state<'replace' | 'append'>('replace');
  let exporting = $state('');
  let showClearConfirm = $state(false);
  let autosaveAt = $state('');
  let saveFailed = $state(false);
  let hydrated = $state(false);
  let stageEl = $state<HTMLDivElement | null>(null);
  let sampleInput = $state<HTMLInputElement | null>(null);
  let sampleSheetInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let handoffLoading = $state(false);
  let reproBusy = $state(false);

  let sampleSeq = 1;
  let paintedDuringDrag = new Set<string>();

  // ---------------------------------------------------------------- derived

  const geometry = $derived(formatGeometry(format));
  const cells = $derived(buildWellCells(geometry));

  function signatureOf(formatValue: PlateFormat, sampleList: SampleRow[], ruleValue: PlateRules): string {
    return JSON.stringify({
      format: formatValue,
      // Only placement-affecting fields belong here. Renaming or recoloring a
      // sample updates the existing wells without invalidating the layout.
      samples: sampleList.map((sample) => ({
        id: sample.id,
        replicates: sample.replicates
      })),
      rules: { ...ruleValue }
    });
  }

  const currentSignature = $derived(signatureOf(format, samples, rules));
  const stale = $derived(generated && layoutSignature !== currentSignature);

  const validation = $derived.by(() => {
    if (!generated) {
      return { issues: [] as LayoutIssue[], unplaced: [] as UnplacedSample[] };
    }
    return validateLayout({ format, samples, rules, assignments });
  });

  const issues = $derived(validation.issues);
  const unplaced = $derived(validation.unplaced);
  const assignedCount = $derived(Object.keys(assignments).length);
  const emptyCount = $derived(geometry.total - assignedCount);
  const reservedCount = $derived(
    Object.values(assignments).filter((assignment) => assignment.type === 'reserved').length
  );
  const hasExportable = $derived(assignedCount > 0);
  const selectedAssignment = $derived(selectedWell ? (assignments[selectedWell] ?? null) : null);
  const selectedCell = $derived(
    selectedWell ? (cells.find((cell) => cell.id === selectedWell) ?? null) : null
  );
  const selectedSample = $derived(
    samples.find((sample) => sample.id === selectedSampleId) ?? null
  );
  const statusText = $derived(
    issues.length === 0
      ? m.plateStatusOk()
      : m.plateStatusWarn({ n: issues.length })
  );

  const cellPx = $derived(Math.max(8, Math.round(baseCellFor(format) * zoom)));

  const legend = $derived.by(() => {
    const map = new Map<string, LegendItem>();
    const add = (key: string, label: string, color: string) => {
      const entry = map.get(key);
      if (entry) entry.count++;
      else map.set(key, { key, label, color, count: 1 });
    };
    for (const assignment of Object.values(assignments)) {
      if (assignment.type === 'sample') {
        if (colorBy === 'sample') {
          const label = sampleDisplayName(assignment.sampleId, assignment.sampleName);
          add(`sample:${assignment.sampleId}`, label, sampleColorFor(assignment.sampleId, assignment.color));
        } else {
          const label = assignment.group.trim() || m.plateLegendUngrouped();
          add(`group:${assignment.group.trim().toLowerCase()}`, label, groupColor(assignment.group));
        }
      } else if (assignment.type === 'control') {
        add('control', m.plateLegendControl(), CONTROL_COLOR);
      } else if (assignment.type === 'blank') {
        add('blank', m.plateLegendBlank(), BLANK_COLOR);
      } else {
        add('reserved', m.plateLegendReserved(), RESERVED_COLOR);
      }
    }
    const items = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    if (emptyCount > 0) {
      items.push({ key: 'empty', label: m.plateLegendEmpty(), color: EMPTY_COLOR, count: emptyCount });
    }
    return items;
  });

  // --------------------------------------------------------------- lifecycle

  onMount(() => {
    handoffLoading = true;
    ensureProjectLoaded();
    const handoff = takeToolHandoff('plate');
    let openedFromProject = false;

    if (handoff?.type === 'open') {
      const normalized = normalizePlatePayload(handoff.payload);
      if (normalized.project) {
        applyProject(normalized.project);
        pushToast('success', m.plateTitle(), m.plateProjectRestored());
        const dropped = normalized.duplicateWells + normalized.droppedAssignments;
        if (dropped > 0) {
          pushToast('warn', m.plateTitle(), m.plateImportDropped({ n: dropped }));
        }
        openedFromProject = true;
      } else {
        pushToast('error', m.plateTitle(), m.plateProjectInvalid());
      }
    }

    if (!openedFromProject) {
      const snapshot = loadPlateSnapshot();
      if (snapshot?.project) {
        const hasData =
          snapshot.project.samples.length > 0 ||
          snapshot.project.assignments.length > 0 ||
          snapshot.project.title.trim().length > 0;
        if (hasData) {
          applyProject(snapshot.project);
          pushToast('success', m.plateTitle(), m.plateRestored());
          const dropped = snapshot.duplicateWells + snapshot.droppedAssignments;
          if (dropped > 0) {
            pushToast('warn', m.plateTitle(), m.plateImportDropped({ n: dropped }));
          }
        }
      }
    }

    hydrated = true;
    handoffLoading = false;
    if (handoff?.type === 'capture') void captureToProject();
  });

  $effect(() => {
    const project = buildProjectFile();
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const ok = savePlateSnapshot(project);
      saveFailed = !ok;
      if (ok) autosaveAt = new Date().toLocaleTimeString();
    }, 600);
    return () => clearTimeout(timer);
  });

  // Write the live layout back into the active project document. Debounced so
  // dragging a painted well does not force a project persist on every pixel.
  $effect(() => {
    if (!hydrated || handoffLoading) return;
    if (projectStore.activeDocKind !== 'plate') return;
    const project = buildProjectFile();
    const timer = setTimeout(() => {
      if (projectStore.activeDocKind === 'plate') projectStore.commitDoc('plate', project);
    }, 400);
    return () => clearTimeout(timer);
  });

  // ---------------------------------------------------------------- helpers

  function baseCellFor(value: PlateFormat): number {
    if (value === 6) return 64;
    if (value === 12) return 54;
    if (value === 24) return 44;
    if (value === 48) return 36;
    if (value === 96) return 27;
    return 15;
  }

  function hashText(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function groupColor(group: string): string {
    const key = group.trim();
    if (!key) return '#8b96b5';
    return PALETTE[hashText(key.toLowerCase()) % PALETTE.length];
  }

  function sampleColorFor(sampleId: string, stored: string): string {
    const index = samples.findIndex((sample) => sample.id === sampleId);
    if (index >= 0) {
      const own = normalizeColor(samples[index].color);
      return own || PALETTE[index % PALETTE.length];
    }
    const fallback = normalizeColor(stored);
    if (fallback) return fallback;
    return PALETTE[hashText(sampleId) % PALETTE.length];
  }

  function textColorFor(fill: string): string {
    const hex = normalizeColor(fill) || EMPTY_COLOR;
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    return luminance > 145 ? '#0b0e14' : '#eef3ff';
  }

  function fillFor(assignment: WellAssignment): string {
    if (assignment.type === 'control') return CONTROL_COLOR;
    if (assignment.type === 'blank') return BLANK_COLOR;
    if (assignment.type === 'reserved') return RESERVED_COLOR;
    if (colorBy === 'sample') return sampleColorFor(assignment.sampleId, assignment.color);
    return groupColor(assignment.group);
  }

  function sampleDisplayName(sampleId: string, fallback = ''): string {
    const sample = samples.find((entry) => entry.id === sampleId);
    const name = sample?.name.trim();
    return name || fallback.trim() || sampleId;
  }

  function cellLabel(assignment: WellAssignment): string {
    if (assignment.type === 'sample') {
      return sampleDisplayName(assignment.sampleId, assignment.sampleName);
    }
    if (assignment.type === 'control') return m.plateControlName({ n: assignment.replicate });
    if (assignment.type === 'blank') return m.plateBlankName({ n: assignment.replicate });
    return '';
  }

  function compactLabel(assignment: WellAssignment): string {
    const label = cellLabel(assignment);
    const max = Math.max(2, Math.floor((cellPx - 6) / 7));
    if (label.length <= max) return label;
    return `${label.slice(0, Math.max(1, max - 1))}…`;
  }

  function assignmentContent(assignment: WellAssignment): string {
    if (assignment.type === 'sample') {
      const parts = [sampleDisplayName(assignment.sampleId, assignment.sampleName)];
      if (assignment.group.trim()) parts.push(assignment.group.trim());
      if (assignment.replicate > 0) parts.push(m.plateReplicateShort({ n: assignment.replicate }));
      return parts.join(' · ');
    }
    if (assignment.type === 'control') return m.plateControlName({ n: assignment.replicate });
    if (assignment.type === 'blank') return m.plateBlankName({ n: assignment.replicate });
    return m.plateTypeReserved();
  }

  function wellTooltip(id: string): string {
    const assignment = assignments[id];
    return assignment
      ? m.plateWellTooltip({ well: id, content: assignmentContent(assignment) })
      : m.plateWellTooltipEmpty({ well: id });
  }

  function typeLabelOf(assignment: WellAssignment | null): string {
    if (!assignment) return m.plateTypeEmpty();
    if (assignment.type === 'sample') return m.plateTypeSample();
    if (assignment.type === 'control') return m.plateTypeControl();
    if (assignment.type === 'blank') return m.plateTypeBlank();
    return m.plateTypeReserved();
  }

  function layoutLabel(layout: GroupLayout): string {
    if (layout === 'row') return m.plateLayoutRow();
    if (layout === 'column') return m.plateLayoutColumn();
    if (layout === 'block') return m.plateLayoutBlock();
    return m.plateLayoutAuto();
  }

  function messageForIssue(issue: LayoutIssue): string {
    const table = m as unknown as Record<
      string,
      ((params?: MessageParams) => string) | undefined
    >;
    const fn = table[issue.key];
    return fn ? fn(issue.params) : issue.key;
  }

  function displayTitle(): string {
    return title.trim() || m.platePlateTitleDefault();
  }

  function projectSummaryText(): string {
    const counts = plateProjectCounts(buildProjectFile());
    return m.plateProjectSummary({
      samples: counts.samples,
      assigned: counts.assigned,
      total: counts.total
    });
  }

  async function projectPreview(): Promise<string | null> {
    try {
      const figure = buildSvg();
      const preview = await svgPreview(figure.svg, figure.width, figure.height);
      return preview || null;
    } catch {
      return null;
    }
  }

  async function captureToProject() {
    if (!projectStore.hasOpenProject) return;
    const preview = await projectPreview();
    finishToolCapture(
      'plate',
      plateProjectName(buildProjectFile(), m.platePlateTitleDefault()),
      buildProjectFile(),
      preview ?? undefined,
      projectSummaryText()
    );
  }

  function exportNote(): string {
    return m.plateSeedCurrent({ seed: rules.seed });
  }

  function exportCells(): Array<PlateSvgCell | null> {
    const list: Array<PlateSvgCell | null> = new Array(geometry.total).fill(null);
    for (const assignment of Object.values(assignments)) {
      const index = assignment.row * geometry.cols + assignment.col;
      if (index < 0 || index >= list.length) continue;
      const fill = fillFor(assignment);
      list[index] = {
        fill,
        label: cellLabel(assignment),
        textColor: textColorFor(fill),
        well: assignment.well
      };
    }
    return list;
  }

  function exportLegend() {
    return legend.map((item) => ({ label: item.label, color: item.color, count: item.count }));
  }

  function buildSvg() {
    return buildPlateSvg({
      title: displayTitle(),
      rows: geometry.rows,
      cols: geometry.cols,
      cells: exportCells(),
      legend: exportLegend(),
      legendTitle: m.plateLegend(),
      note: exportNote()
    });
  }

  function buildProjectFile(): PlateProjectFile {
    const list = Object.values(assignments)
      .map((assignment) => ({ ...assignment }))
      .sort((a, b) => a.row - b.row || a.col - b.col);
    return {
      version: 1,
      kind: 'spice-plate',
      title,
      format,
      samples: samples.map((sample) => ({ ...sample })),
      rules: { ...rules },
      assignments: list,
      colorBy,
      showLabels,
      updatedAt: new Date().toISOString()
    };
  }

  // -------------------------------------------------------------- state edits

  function applyProject(project: PlateProjectFile) {
    format = project.format;
    title = project.title;
    samples = project.samples.map((sample) => ({ ...sample }));
    rules = { ...project.rules };
    assignments = assignmentsToMap(project.assignments.map((assignment) => ({ ...assignment })));
    colorBy = project.colorBy;
    showLabels = project.showLabels;
    generated = Object.keys(assignments).length > 0;
    layoutSignature = signatureOf(project.format, project.samples, project.rules);
    seedReport = generated ? project.rules.seed : null;
    selectedWell = null;
    selectedSampleId = samples[0]?.id ?? null;
    paintTool = 'select';
    zoom = 1;
    sampleSeq = Math.max(sampleSeq, samples.length + 1);
  }

  function newSampleId(): string {
    let id = '';
    do {
      id = `smp_${Date.now().toString(36)}_${sampleSeq++}`;
    } while (samples.some((sample) => sample.id === id));
    return id;
  }

  function updateSample(id: string, patch: Partial<SampleRow>) {
    const target = samples.find((sample) => sample.id === id);
    if (!target) return;
    const updated = { ...target, ...patch };
    samples = samples.map((sample) => (sample.id === id ? updated : sample));
    let changed = false;
    const next = { ...assignments };
    for (const key of Object.keys(next)) {
      const assignment = next[key];
      if (assignment.type !== 'sample' || assignment.sampleId !== id) continue;
      next[key] = {
        ...assignment,
        sampleName: updated.name,
        group: updated.group,
        color: updated.color
      };
      changed = true;
    }
    if (changed) assignments = next;
  }

  function setSampleReplicates(id: string, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      updateSample(id, { replicates: null });
      return;
    }
    const value = clampInt(Number(trimmed), 1, MAX_REPLICATES, 1);
    updateSample(id, { replicates: value });
  }

  function setSampleColor(id: string, raw: string) {
    updateSample(id, { color: normalizeColor(raw) });
  }

  function addSample() {
    let counter = samples.length + 1;
    let name = m.plateSampleDefaultName({ n: counter });
    while (samples.some((sample) => sample.name === name)) {
      counter++;
      name = m.plateSampleDefaultName({ n: counter });
    }
    const sample: SampleRow = {
      id: newSampleId(),
      name,
      group: '',
      color: '',
      replicates: null
    };
    samples = [...samples, sample];
    selectedSampleId = sample.id;
  }

  function removeSample(id: string) {
    samples = samples.filter((sample) => sample.id !== id);
    let changed = false;
    const next = { ...assignments };
    for (const key of Object.keys(next)) {
      if (next[key].sampleId === id) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) assignments = next;
    if (selectedSampleId === id) selectedSampleId = samples[0]?.id ?? null;
  }

  function applySampleDrafts(drafts: SampleDraft[], skipped: number, notify = true) {
    if (drafts.length === 0) {
      pushToast('warn', m.plateTitle(), m.plateParseEmpty());
      return;
    }
    const rows: SampleRow[] = drafts.map((draft) => ({
      id: newSampleId(),
      name: draft.name,
      group: draft.group,
      color: draft.color,
      replicates: draft.replicates
    }));
    if (importMode === 'replace') {
      samples = rows;
      assignments = {};
      generated = false;
      layoutSignature = '';
      seedReport = null;
      selectedWell = null;
    } else {
      samples = [...samples, ...rows];
    }
    if (!selectedSampleId || !samples.some((sample) => sample.id === selectedSampleId)) {
      selectedSampleId = rows[0]?.id ?? samples[0]?.id ?? null;
    }
    if (!notify) return;
    const body = skipped
      ? `${m.plateParsedRows({ n: rows.length })} ${m.plateSkippedRows({ n: skipped })}`
      : m.plateParsedRows({ n: rows.length });
    pushToast('success', m.plateTitle(), body);
  }

  function applySampleText(text: string) {
    const parsed = parseSampleTable(text);
    applySampleDrafts(parsed.rows, parsed.skipped);
  }

  function applyPaste() {
    if (!pasteText.trim()) {
      pushToast('warn', m.plateTitle(), m.plateParseEmpty());
      return;
    }
    applySampleText(pasteText);
    pasteText = '';
  }

  async function onSampleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      applySampleText(await file.text());
    } catch {
      pushToast('error', m.plateTitle(), m.plateFileReadFailed());
    }
  }

  async function onSampleSheetFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const sheet = parseSampleSheet(await file.text());
      if (!sheet) {
        pushToast('error', m.plateTitle(), m.plateSamplesInvalid());
        return;
      }
      const drafts: SampleDraft[] = sheet.samples.map((entry) => ({
        name: entry.name,
        group: entry.group,
        color: normalizeColor(entry.color ?? ''),
        replicates: entry.replicates ?? null
      }));
      if (drafts.length === 0) {
        pushToast('warn', m.plateTitle(), m.plateParseEmpty());
        return;
      }
      applySampleDrafts(drafts, 0, false);
      pushToast('success', m.plateTitle(), m.plateSamplesImported({ n: drafts.length }));
    } catch {
      pushToast('error', m.plateTitle(), m.plateFileReadFailed());
    }
  }

  function setSeed(raw: string) {
    if (!raw.trim()) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    rules.seed = clampInt(value, 0, MAX_SEED, rules.seed);
  }

  function newSeed() {
    rules.seed = randomSeedValue();
    pushToast('info', m.plateTitle(), m.plateSeedCurrent({ seed: rules.seed }));
  }

  function setGroupLayout(value: string) {
    if (value === 'auto' || value === 'row' || value === 'column' || value === 'block') {
      rules.groupLayout = value;
    }
  }

  function generateLayout() {
    if (!Number.isInteger(rules.seed) || rules.seed < 0 || rules.seed > MAX_SEED) {
      pushToast('error', m.plateTitle(), m.plateSeedInvalid());
      return;
    }
    if (samples.length === 0) {
      pushToast('warn', m.plateTitle(), m.plateIssueNoSamples());
      return;
    }
    const result = assignPlate(format, samples, rules);
    assignments = result.assignments;
    generated = true;
    layoutSignature = signatureOf(format, samples, rules);
    seedReport = result.seed;
    selectedWell = null;
    const missing = result.unplaced.length;
    const body = missing
      ? `${m.plateSeedReport({ seed: result.seed })} ${m.plateUnplacedCount({ n: missing })}`
      : m.plateSeedReport({ seed: result.seed });
    const kind = result.issues.some((issue) => issue.severity === 'error') ? 'warn' : 'success';
    pushToast(kind, m.plateTitle(), body);
  }

  function changeFormat(next: PlateFormat) {
    if (next === format) return;
    const hadLayout = generated || assignedCount > 0;
    format = next;
    assignments = {};
    generated = false;
    layoutSignature = '';
    seedReport = null;
    selectedWell = null;
    showLabels = next !== 384;
    zoom = 1;
    if (hadLayout) pushToast('info', m.plateFormat(), m.plateFormatChanged());
  }

  function onFormatChange(event: Event) {
    const value = Number((event.target as HTMLSelectElement).value);
    if (isPlateFormat(value)) changeFormat(value);
  }

  function setColorBy(event: Event) {
    colorBy = (event.target as HTMLSelectElement).value === 'sample' ? 'sample' : 'group';
  }

  // ------------------------------------------------------------------- paint

  function setAssignment(value: WellAssignment) {
    assignments = { ...assignments, [value.well]: value };
    selectedWell = value.well;
    if (!generated) {
      generated = true;
      layoutSignature = signatureOf(format, samples, rules);
    }
  }

  function removeAssignment(id: string) {
    selectedWell = id;
    if (!assignments[id]) return;
    const next = { ...assignments };
    delete next[id];
    assignments = next;
  }

  function countSampleWells(sampleId: string): number {
    return Object.values(assignments).filter(
      (assignment) => assignment.type === 'sample' && assignment.sampleId === sampleId
    ).length;
  }

  function countType(type: 'control' | 'blank'): number {
    return Object.values(assignments).filter((assignment) => assignment.type === type).length;
  }

  function applyTool(id: string) {
    const cell = wellCellMap(geometry).get(id);
    if (!cell) return;
    if (paintTool === 'select') return;
    if (paintTool === 'empty') {
      removeAssignment(id);
      return;
    }
    const existing = assignments[id];
    if (paintTool === 'sample') {
      if (!selectedSample) {
        pushToast('warn', m.plateTitle(), m.platePaintNoSample());
        paintTool = 'select';
        return;
      }
      if (existing?.type === 'sample' && existing.sampleId === selectedSample.id) return;
      const replicate = Math.min(MAX_REPLICATES, countSampleWells(selectedSample.id) + 1);
      setAssignment(manualSampleAssignment(geometry, selectedSample, cell.row, cell.col, replicate));
      return;
    }
    if (paintTool === 'control') {
      if (existing?.type === 'control') return;
      setAssignment(
        manualAuxAssignment(geometry, 'control', cell.row, cell.col, countType('control') + 1)
      );
      return;
    }
    if (paintTool === 'blank') {
      if (existing?.type === 'blank') return;
      setAssignment(
        manualAuxAssignment(geometry, 'blank', cell.row, cell.col, countType('blank') + 1)
      );
    }
  }

  function startPaint(id: string, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    selectedWell = id;
    painting = true;
    paintedDuringDrag.clear();
    paintedDuringDrag.add(id);
    if (paintTool !== 'select') applyTool(id);
  }

  function continuePaint(id: string) {
    if (!painting) return;
    selectedWell = id;
    if (paintTool === 'select' || paintedDuringDrag.has(id)) return;
    paintedDuringDrag.add(id);
    applyTool(id);
  }

  function endPaint() {
    painting = false;
    paintedDuringDrag.clear();
  }

  function choosePaintTool(tool: 'select' | 'sample' | 'control' | 'blank' | 'empty') {
    if (tool === 'sample' && !selectedSample) {
      if (samples.length > 0) {
        selectedSampleId = samples[0].id;
      } else {
        pushToast('warn', m.plateTitle(), m.platePaintNoSample());
        return;
      }
    }
    paintTool = tool;
  }

  function selectSampleForPaint(id: string) {
    selectedSampleId = id || null;
    if (id) paintTool = 'sample';
  }

  function clearSelection() {
    selectedWell = null;
    painting = false;
    paintedDuringDrag.clear();
  }

  function confirmClear() {
    assignments = {};
    generated = false;
    layoutSignature = '';
    seedReport = null;
    selectedWell = null;
    showClearConfirm = false;
    // Flush immediately so a cleared plate is not restored from a stale copy.
    saveFailed = !savePlateSnapshot(buildProjectFile());
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (showClearConfirm) {
      showClearConfirm = false;
      return;
    }
    clearSelection();
  }

  function setZoom(next: number) {
    zoom = Math.min(3, Math.max(0.5, Math.round(next * 100) / 100));
  }

  function fitPlate() {
    const available = stageEl?.clientWidth ?? 760;
    const base = baseCellFor(format);
    const fitted = (available - 70) / Math.max(1, geometry.cols * base);
    setZoom(Math.min(3, Math.max(0.5, fitted)));
  }

  // ------------------------------------------------------------------ export

  async function saveExport(name: string, data: string | Uint8Array) {
    const result = await backend.saveExport(name, data);
    if (result.data?.saved) {
      pushToast('success', m.plateTitle(), m.plateExportDone({ name: result.data.path ?? name }));
    } else if (result.error) {
      pushToast('error', m.plateTitle(), m.plateExportFailed({ message: result.error }));
    }
  }

  function ensureExportable(): boolean {
    if (hasExportable) return true;
    pushToast('warn', m.plateTitle(), m.plateNoData());
    return false;
  }

  async function exportCsv() {
    if (!ensureExportable()) return;
    const base = fileBaseName(title, 'plate-layout');
    const rows = buildPlateRows(format, assignments);
    await saveExport(`${base}-plate-map.csv`, plateRowsToCsv(rows));
  }

  async function exportSvg() {
    if (!ensureExportable()) return;
    const base = fileBaseName(title, 'plate-layout');
    const figure = buildSvg();
    await saveExport(`${base}-plate-map.svg`, figure.svg);
  }

  async function exportPng(dpi: number) {
    if (!hasExportable || exporting) return;
    exporting = m.plateExportBusy();
    try {
      const figure = buildSvg();
      const canvas = await renderSvgToCanvas(
        figure.svg,
        figure.width,
        figure.height,
        dpi / 96
      );
      const bytes = await canvasToPngBytes(canvas);
      const png = pngWithDpi(bytes, dpi, `${displayTitle()} | ${exportNote()}`);
      const base = fileBaseName(title, 'plate-layout');
      await saveExport(`${base}-plate-${dpi}dpi.png`, png);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast('error', m.plateTitle(), m.plateExportFailed({ message }));
    } finally {
      exporting = '';
    }
  }

  async function sendToFigureNow() {
    if (!hasExportable || exporting) return;
    exporting = m.plateExportBusy();
    try {
      const figure = buildSvg();
      const canvas = await renderSvgToCanvas(figure.svg, figure.width, figure.height, 2);
      const ok = await sendImageToFigure({
        dataUrl: canvas.toDataURL('image/png'),
        name: `${displayTitle()} plate`,
        width: canvas.width,
        height: canvas.height,
      });
      if (!ok) pushToast('error', m.plateTitle(), m.sendToFigureFailed());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast('error', m.plateTitle(), m.plateExportFailed({ message }));
    } finally {
      exporting = '';
    }
  }

  async function copyTsv() {
    if (!ensureExportable()) return;
    const rows = buildPlateRows(format, assignments);
    const ok = await copyText(plateRowsToTsv(rows));
    pushToast(ok ? 'success' : 'error', m.plateTitle(), ok ? m.plateCopied() : m.plateCopyFailed());
  }

  function currentSampleSheet(): SampleSheet {
    return {
      format: 'SPICE_SAMPLES',
      version: 1,
      name: displayTitle(),
      samples: samples.map((sample) => ({
        id: sample.id,
        name: sample.name,
        group: sample.group,
        color: sample.color || undefined,
        replicates: sample.replicates ?? rules.replicates
      })),
      updatedAt: new Date().toISOString()
    };
  }

  async function exportSamplesJson() {
    if (samples.length === 0) {
      pushToast('warn', m.plateTitle(), m.plateNoSamplesExport());
      return;
    }
    const base = fileBaseName(title, 'plate-layout');
    await saveExport(`${base}-samples.samples.json`, sampleSheetToJson(currentSampleSheet()));
  }

  async function exportSamplesCsv() {
    if (samples.length === 0) {
      pushToast('warn', m.plateTitle(), m.plateNoSamplesExport());
      return;
    }
    const base = fileBaseName(title, 'plate-layout');
    await saveExport(`${base}-samples.csv`, sampleSheetToCsv(currentSampleSheet()));
  }

  async function exportQpcrMap() {
    if (!ensureExportable()) return;
    const base = fileBaseName(title, 'plate-layout');
    // Keep the shared well,sample,group,type,replicate header but omit empty
    // and reserved wells so the file can be loaded as a qPCR plate template.
    const rows = buildPlateRows(format, assignments).filter(
      (row) => row.type !== 'empty' && row.type !== 'reserved'
    );
    await saveExport(`${base}-plate-map-qpcr.csv`, plateRowsToCsv(rows));
  }

  async function exportReproBundle() {
    if (!hasExportable || reproBusy) return;
    reproBusy = true;
    try {
      const base = fileBaseName(title, 'plate-layout');
      const figure = buildSvg();
      const canvas = await renderSvgToCanvas(figure.svg, figure.width, figure.height, 300 / 96);
      const png = pngWithDpi(
        await canvasToPngBytes(canvas),
        300,
        `${displayTitle()} | ${exportNote()}`
      );
      const rows = buildPlateRows(format, assignments);
      const result = await saveReproBundle({
        tool: 'Plate layout',
        title: displayTitle(),
        files: [
          { name: `${base}-plate-map.svg`, mime: 'image/svg+xml', data: figure.svg },
          { name: `${base}-plate-300dpi.png`, mime: 'image/png', data: png },
          { name: `${base}-plate-map.csv`, mime: 'text/csv', data: plateRowsToCsv(rows) },
          {
            name: `${base}-samples.samples.json`,
            mime: 'application/json',
            data: sampleSheetToJson(currentSampleSheet())
          }
        ],
        parameters: {
          format,
          rows: geometry.rows,
          cols: geometry.cols,
          wells: geometry.total,
          assignedWells: assignedCount,
          samples: samples.map((sample) => ({
            id: sample.id,
            name: sample.name,
            group: sample.group,
            color: sample.color,
            replicates: sample.replicates
          })),
          rules: { ...rules },
          colorBy,
          showLabels
        },
        methods:
          'Plate layouts were generated with SPICE GUI using a deterministic seed: the same sample list, rule set and seed reproduce the same well assignments. Replicate counts, control and blank wells, edge handling, group layout and randomisation were applied in the order recorded in parameters.json. The plate map is exported as vector SVG, as a 300 dpi PNG with physical resolution metadata, and as well,sample,group,type,replicate CSV.',
        project: buildProjectFile()
      });
      if (result.ok) {
        pushToast('success', m.plateTitle(), m.plateReproDone({ name: result.path ?? result.fileName }));
      } else if (!result.canceled) {
        pushToast('error', m.plateTitle(), m.plateReproFailed({ message: result.error ?? '' }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast('error', m.plateTitle(), m.plateReproFailed({ message }));
    } finally {
      reproBusy = false;
    }
  }

  async function saveProjectJson() {
    const base = fileBaseName(title, 'plate-layout');
    await saveExport(`${base}-plate-project.json`, serializePlateProject(buildProjectFile()));
  }

  async function onProjectFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = parsePlateProject(await file.text());
      if (!parsed?.project) {
        pushToast('error', m.plateTitle(), m.plateProjectInvalid());
        return;
      }
      applyProject(parsed.project);
      pushToast('success', m.plateTitle(), m.plateProjectImported({ name: file.name }));
      const dropped = parsed.duplicateWells + parsed.droppedAssignments;
      if (dropped > 0) {
        pushToast('warn', m.plateTitle(), m.plateImportDropped({ n: dropped }));
      }
    } catch {
      pushToast('error', m.plateTitle(), m.plateProjectImportFailed());
    }
  }
</script>

<div class="plate-tool">
  <ToolProjectBar
    kind="plate"
    getPayload={() => buildProjectFile()}
    getName={() => displayTitle()}
    getPreview={projectPreview}
    getSummary={projectSummaryText}
  />

  <div class="pt-toolbar">
    <div class="pt-brand">
      <Grid3X3 size={14} />
      <span class="pix-title">{m.plateTitle()}</span>
    </div>

    <label class="pt-inline-field">
      <span>{m.plateFormat()}</span>
      <select class="pt-select pt-format" value={format} onchange={onFormatChange}>
        {#each PLATE_FORMATS as value (value)}
          <option value={value}>{m.plateWells({ n: value })}</option>
        {/each}
      </select>
    </label>

    <label class="pt-inline-field pt-title-field">
      <span>{m.plateTitleField()}</span>
      <input
        class="pt-input"
        value={title}
        placeholder={m.plateTitlePlaceholder()}
        aria-label={m.plateTitleField()}
        oninput={(event) => (title = (event.target as HTMLInputElement).value)}
      />
    </label>

    <span class="pt-stats">
      {m.plateSampleCount({ n: samples.length })} · {m.plateWellStats({
        filled: assignedCount,
        total: geometry.total
      })}
    </span>

    <span class="pt-spacer"></span>

    <button class="pix-btn ok" data-testid="plate-generate" onclick={generateLayout} disabled={samples.length === 0}>
      <RefreshCw size={12} />
      {generated ? m.plateRegenerate() : m.plateGenerate()}
    </button>
    <button
      class="pix-btn pt-danger"
      onclick={() => (showClearConfirm = true)}
      disabled={assignedCount === 0}
    >
      <Trash2 size={12} />
      {m.plateClearAll()}
    </button>
  </div>

  <div class="pt-main">
    <aside class="pt-side">
      <section class="pt-block">
        <div class="pt-block-head">
          <ListTree size={12} />
          <span>{m.plateSectionSamples()}</span>
          <span class="count">{m.plateSampleCount({ n: samples.length })}</span>
        </div>
        <p class="hint">{m.plateSamplesHint()}</p>

        <textarea
          class="pt-textarea"
          rows={2}
          placeholder={m.platePastePlaceholder()}
          aria-label={m.platePastePlaceholder()}
          data-testid="plate-paste"
          bind:value={pasteText}
        ></textarea>
        <div class="pt-row">
          <button class="pix-btn" data-testid="plate-paste-apply" onclick={applyPaste} disabled={!pasteText.trim()}>
            <Plus size={11} />
            {m.platePasteApply()}
          </button>
          <button class="pix-btn" onclick={() => sampleInput?.click()}>
            <Upload size={11} />
            {m.plateImportCsv()}
          </button>
          <button class="pix-btn" onclick={() => sampleSheetInput?.click()}>
            <FileUp size={11} />
            {m.plateImportSamples()}
          </button>
          <select
            class="pt-select pt-mode"
            value={importMode}
            title={m.plateImportMode()}
            onchange={(event) =>
              (importMode =
                (event.target as HTMLSelectElement).value === 'append' ? 'append' : 'replace')}
          >
            <option value="replace">{m.plateReplace()}</option>
            <option value="append">{m.plateAppend()}</option>
          </select>
        </div>

        {#if samples.length === 0}
          <div class="pt-empty-line">{m.plateSamplesEmpty()}</div>
        {:else}
          <div class="sample-head">
            <span>{m.plateColName()}</span>
            <span>{m.plateColGroup()}</span>
            <span>{m.plateColColor()}</span>
            <span>{m.plateColReplicates()}</span>
            <span>{m.plateColActions()}</span>
          </div>
          <div class="sample-list">
            {#each samples as sample, index (sample.id)}
              <div class="sample-row" class:active={selectedSampleId === sample.id}>
                <input
                  class="pt-input"
                  value={sample.name}
                  placeholder={m.plateSampleNamePlaceholder()}
                  aria-label={m.plateColName()}
                  oninput={(event) =>
                    updateSample(sample.id, { name: (event.target as HTMLInputElement).value })}
                />
                <input
                  class="pt-input"
                  value={sample.group}
                  placeholder={m.plateGroupPlaceholder()}
                  aria-label={m.plateColGroup()}
                  oninput={(event) =>
                    updateSample(sample.id, { group: (event.target as HTMLInputElement).value })}
                />
                <div class="color-cell">
                  <input
                    class="color-input"
                    type="color"
                    value={sample.color || PALETTE[index % PALETTE.length]}
                    title={m.plateColColor()}
                    aria-label={m.plateColColor()}
                    oninput={(event) =>
                      setSampleColor(sample.id, (event.target as HTMLInputElement).value)}
                  />
                  {#if sample.color}
                    <button
                      class="row-btn"
                      type="button"
                      title={m.plateColorAuto()}
                      onclick={() => setSampleColor(sample.id, '')}
                    >
                      <X size={9} />
                    </button>
                  {/if}
                </div>
                <input
                  class="pt-input"
                  type="number"
                  min="1"
                  max={MAX_REPLICATES}
                  value={sample.replicates ?? ''}
                  placeholder={m.plateReplicatesDefault()}
                  title={m.plateColReplicates()}
                  aria-label={m.plateColReplicates()}
                  oninput={(event) =>
                    setSampleReplicates(sample.id, (event.target as HTMLInputElement).value)}
                />
                <div class="row-actions">
                  <button
                    class="row-btn"
                    type="button"
                    title={m.plateToolSample()}
                    onclick={() => {
                      selectedSampleId = sample.id;
                      paintTool = 'sample';
                    }}
                  >
                    <Palette size={10} />
                  </button>
                  <button
                    class="row-btn danger"
                    type="button"
                    title={m.plateRemoveSample()}
                    onclick={() => removeSample(sample.id)}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <button class="pix-btn pt-wide" onclick={addSample}>
          <Plus size={11} />
          {m.plateAddSample()}
        </button>
      </section>

      <section class="pt-block">
        <div class="pt-block-head">
          <Layers size={12} />
          <span>{m.plateSectionRules()}</span>
        </div>

        <div class="pt-grid2">
          <label class="pt-field">
            <span>{m.plateReplicates()}</span>
            <select
              class="pt-select"
              value={rules.replicates}
              onchange={(event) =>
                (rules.replicates = clampInt(
                  Number((event.target as HTMLSelectElement).value),
                  1,
                  MAX_REPLICATES,
                  rules.replicates
                ))}
            >
              {#each REPLICATE_OPTIONS as value (value)}
                <option value={value}>{value}</option>
              {/each}
            </select>
          </label>
          <label class="pt-field">
            <span>{m.plateControls()}</span>
            <input
              class="pt-input"
              type="number"
              min="0"
              max={geometry.total}
              bind:value={rules.controls}
            />
          </label>
          <label class="pt-field">
            <span>{m.plateBlanks()}</span>
            <input
              class="pt-input"
              type="number"
              min="0"
              max={geometry.total}
              bind:value={rules.blanks}
            />
          </label>
        </div>
        <p class="hint">{m.plateReplicatesHint()}</p>

        <label class="pt-check">
          <input type="checkbox" bind:checked={rules.reserveEdge} />
          <span>{m.plateReserveEdge()}</span>
        </label>
        <p class="hint indent">{m.plateReserveEdgeHint()}</p>

        <label class="pt-check">
          <input type="checkbox" bind:checked={rules.avoidEdge} />
          <span>{m.plateAvoidEdge()}</span>
        </label>
        <p class="hint indent">{m.plateAvoidEdgeHint()}</p>

        <label class="pt-check">
          <input type="checkbox" bind:checked={rules.keepTogether} />
          <span>{m.plateKeepTogether()}</span>
        </label>
        <p class="hint indent">{m.plateKeepTogetherHint()}</p>

        {#if rules.keepTogether}
          <label class="pt-field">
            <span>{m.plateGroupLayout()}</span>
            <select
              class="pt-select"
              value={rules.groupLayout}
              onchange={(event) => setGroupLayout((event.target as HTMLSelectElement).value)}
            >
              {#each GROUP_LAYOUTS as layout (layout)}
                <option value={layout}>{layoutLabel(layout)}</option>
              {/each}
            </select>
          </label>
          {#if rules.groupLayout === 'block'}
            <div class="pt-grid2">
              <label class="pt-field">
                <span>{m.plateGroupColumns()}</span>
                <input
                  class="pt-input"
                  type="number"
                  min="0"
                  max={geometry.cols}
                  bind:value={rules.groupColumns}
                />
              </label>
              <label class="pt-field">
                <span>{m.plateGroupRows()}</span>
                <input
                  class="pt-input"
                  type="number"
                  min="0"
                  max={geometry.rows}
                  bind:value={rules.groupRows}
                />
              </label>
            </div>
            <p class="hint">{m.plateGroupDimsHint()}</p>
          {/if}
        {/if}

        <label class="pt-check">
          <input type="checkbox" bind:checked={rules.randomize} />
          <span>{m.plateRandomize()}</span>
        </label>
        <p class="hint indent">{m.plateRandomizeHint()}</p>

        <div class="seed-row">
          <label class="pt-field grow">
            <span>{m.plateSeed()}</span>
            <input
              class="pt-input"
              type="number"
              min="0"
              max={MAX_SEED}
              step="1"
              value={rules.seed}
              oninput={(event) => setSeed((event.target as HTMLInputElement).value)}
            />
          </label>
          <button class="pix-btn" type="button" onclick={newSeed}>
            <Sparkles size={11} />
            {m.plateNewSeed()}
          </button>
        </div>
        <p class="hint">{m.plateSeedHint()}</p>
        {#if seedReport !== null}
          <div class="pt-check-line">
            <Check size={10} />
            <span>{m.plateSeedReport({ seed: seedReport })}</span>
          </div>
        {/if}

        <button
          class="pix-btn ok pt-wide"
          type="button"
          onclick={generateLayout}
          disabled={samples.length === 0}
        >
          <RefreshCw size={12} />
          {generated ? m.plateRegenerate() : m.plateGenerate()}
        </button>
      </section>

      <section class="pt-block">
        <div class="pt-block-head">
          <AlertTriangle size={12} />
          <span>{m.plateSectionChecks()}</span>
          {#if generated}
            <span class="status-badge" class:ok={issues.length === 0} class:warn={issues.length > 0}>
              {statusText}
            </span>
          {/if}
        </div>

        {#if !generated}
          <div class="pt-empty-line">{m.plateNoPlate()}</div>
        {:else}
          {#if stale}
            <div class="notice warn">
              <AlertTriangle size={12} />
              <span>{m.plateLayoutStale()}</span>
            </div>
          {/if}

          {#if issues.length === 0}
            <div class="ok-line">
              <CheckCircle2 size={12} />
              <span>{m.plateNoIssues()}</span>
            </div>
          {:else}
            {#each issues as issue, index (issue.key + ':' + index)}
              <div class="issue {issue.severity}">
                <span class="issue-dot"></span>
                <span>{messageForIssue(issue)}</span>
              </div>
            {/each}
          {/if}

          <div class="subhead">{m.plateUnplaced()}</div>
          {#if unplaced.length === 0}
            <div class="ok-line">
              <CheckCircle2 size={12} />
              <span>{m.plateUnplacedEmpty()}</span>
            </div>
          {:else}
            {#each unplaced as entry (entry.sampleId)}
              <div class="unplaced-line">
                {m.plateUnplacedLine({
                  name: entry.name,
                  placed: entry.placed,
                  requested: entry.requested,
                  missing: entry.missing
                })}
              </div>
            {/each}
          {/if}

          {#if reservedCount > 0}
            <div class="pt-empty-line">{m.plateReservedSummary({ n: reservedCount })}</div>
          {/if}
        {/if}
      </section>

      <section class="pt-block">
        <div class="pt-block-head">
          <Download size={12} />
          <span>{m.plateSectionExport()}</span>
        </div>
        <p class="hint">{m.plateExportHint()}</p>

        <div class="export-grid">
          <button class="pix-btn" onclick={exportCsv} disabled={!hasExportable}>
            <FileDown size={11} />
            {m.plateExportCsv()}
          </button>
          <button class="pix-btn" onclick={exportSvg} disabled={!hasExportable}>
            <ImagePlus size={11} />
            {m.plateExportSvg()}
          </button>
          <button class="pix-btn" onclick={() => exportPng(300)} disabled={!hasExportable || !!exporting}>
            <ImagePlus size={11} />
            {m.plateExportPng()} {m.plateDpi300()}
          </button>
          <button class="pix-btn" onclick={() => exportPng(600)} disabled={!hasExportable || !!exporting}>
            <ImagePlus size={11} />
            {m.plateExportPng()} {m.plateDpi600()}
          </button>
          <button
            class="pix-btn span2"
            onclick={sendToFigureNow}
            disabled={!hasExportable || !!exporting}
            title={m.sendToFigure()}
            aria-label={m.sendToFigure()}
            data-testid="send-to-figure"
          >
            <Send size={11} />
            {m.sendToFigure()}
          </button>
          <button class="pix-btn span2" onclick={copyTsv} disabled={!hasExportable}>
            <Copy size={11} />
            {m.plateCopyTsv()}
          </button>
        </div>

        <div class="export-row">
          <button class="pix-btn" onclick={saveProjectJson}>
            <Save size={11} />
            {m.plateExportJson()}
          </button>
          <button class="pix-btn" onclick={() => projectInput?.click()}>
            <FileUp size={11} />
            {m.plateImportJson()}
          </button>
        </div>

        <div class="export-grid">
          <button class="pix-btn" onclick={exportSamplesJson} disabled={samples.length === 0}>
            <FileDown size={11} />
            {m.plateExportSamplesJson()}
          </button>
          <button class="pix-btn" onclick={exportSamplesCsv} disabled={samples.length === 0}>
            <FileDown size={11} />
            {m.plateExportSamplesCsv()}
          </button>
          <button class="pix-btn span2" onclick={exportQpcrMap} disabled={!hasExportable}>
            <FileDown size={11} />
            {m.plateExportQpcr()}
          </button>
          <button class="pix-btn span2" onclick={exportReproBundle} disabled={!hasExportable || reproBusy}>
            <Download size={11} />
            {reproBusy ? m.plateReproBusy() : m.plateReproBundle()}
          </button>
        </div>
        <p class="hint">{m.plateQpcrHint()}</p>

        {#if exporting}
          <div class="busy-line">{exporting}</div>
        {/if}

        <div class="autosave-line">
          <span>{m.plateAutosave()}</span>
          <strong>{autosaveAt ? m.plateAutosaved({ time: autosaveAt }) : m.plateAutosaveHint()}</strong>
        </div>
        {#if saveFailed}
          <div class="notice warn">
            <AlertTriangle size={11} />
            <span>{m.plateAutosaveFailed()}</span>
          </div>
        {/if}
      </section>
    </aside>

    <main class="pt-stage-wrap">
      <div class="pt-stage-bar">
        <span class="pt-stage-title">
          <Grid3X3 size={12} />
          {m.plateStageTitle()}
        </span>

        <label class="pt-inline-field">
          <span>{m.plateColorBy()}</span>
          <select class="pt-select pt-color-by" value={colorBy} onchange={setColorBy}>
            <option value="group">{m.plateColorByGroup()}</option>
            <option value="sample">{m.plateColorBySample()}</option>
          </select>
        </label>

        <label class="pt-check inline">
          <input type="checkbox" bind:checked={showLabels} />
          <span>{m.plateShowLabels()}</span>
        </label>

        <span class="pt-spacer"></span>

        <button
          class="icon-btn"
          type="button"
          title={m.plateZoomOut()}
          aria-label={m.plateZoomOut()}
          onclick={() => setZoom(zoom - 0.25)}
        >
          <ZoomOut size={12} />
        </button>
        <span class="zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          class="icon-btn"
          type="button"
          title={m.plateZoomIn()}
          aria-label={m.plateZoomIn()}
          onclick={() => setZoom(zoom + 0.25)}
        >
          <ZoomIn size={12} />
        </button>
        <button
          class="icon-btn"
          type="button"
          title={m.plateZoomFit()}
          aria-label={m.plateZoomFit()}
          onclick={fitPlate}
        >
          <Maximize size={12} />
        </button>
      </div>

      <div class="pt-paint-bar">
        <span class="hint">{m.platePaintHint()}</span>

        <button
          class="tool-btn"
          class:active={paintTool === 'select'}
          type="button"
          onclick={() => choosePaintTool('select')}
        >
          <MousePointer size={11} />
          {m.plateToolSelect()}
        </button>
        <button
          class="tool-btn"
          class:active={paintTool === 'sample'}
          type="button"
          disabled={samples.length === 0}
          onclick={() => choosePaintTool('sample')}
        >
          <Palette size={11} />
          {selectedSample && paintTool === 'sample'
            ? m.platePaintSelectedSample({
                name: sampleDisplayName(selectedSample.id, selectedSample.name)
              })
            : m.plateToolSample()}
        </button>
        {#if samples.length > 0}
          <select
            class="pt-select paint-select"
            value={selectedSampleId ?? ''}
            title={m.plateSectionSamples()}
            onchange={(event) =>
              selectSampleForPaint((event.target as HTMLSelectElement).value)}
          >
            {#each samples as sample (sample.id)}
              <option value={sample.id}>{sampleDisplayName(sample.id, sample.name)}</option>
            {/each}
          </select>
        {/if}
        <button
          class="tool-btn"
          class:active={paintTool === 'control'}
          type="button"
          onclick={() => choosePaintTool('control')}
        >
          <span class="tool-dot" style="background:{CONTROL_COLOR}"></span>
          {m.plateToolControl()}
        </button>
        <button
          class="tool-btn"
          class:active={paintTool === 'blank'}
          type="button"
          onclick={() => choosePaintTool('blank')}
        >
          <span class="tool-dot" style="background:{BLANK_COLOR}"></span>
          {m.plateToolBlank()}
        </button>
        <button
          class="tool-btn"
          class:active={paintTool === 'empty'}
          type="button"
          onclick={() => choosePaintTool('empty')}
        >
          <X size={11} />
          {m.plateToolEmpty()}
        </button>
      </div>

      <div class="pt-stage" bind:this={stageEl}>
        {#if !generated && assignedCount === 0}
          <div class="pt-empty">
            <span class="pt-empty-ico"><Grid3X3 size={44} /></span>
            <h3>{m.plateEmptyTitle()}</h3>
            <p>{m.plateEmptyDesc()}</p>
            <button class="pix-btn ok" onclick={generateLayout} disabled={samples.length === 0}>
              <RefreshCw size={12} />
              {m.plateGenerate()}
            </button>
          </div>
        {:else}
          <div class="plate-scroll">
            <div
              class="plate-grid"
              style="grid-template-columns: 20px repeat({geometry.cols}, {cellPx}px); --hd-font: {Math.max(
                6.5,
                Math.min(10, cellPx * 0.4)
              )}px; --well-font: {Math.max(7, Math.min(12, cellPx * 0.28))}px;"
            >
              <div class="corner"></div>
              {#each Array(geometry.cols) as _, col}
                <div class="col-hd">{col + 1}</div>
              {/each}
              {#each Array(geometry.rows) as _, row}
                <div class="row-hd">{rowLabel(row)}</div>
                {#each Array(geometry.cols) as _, col}
                  {@const id = wellId(row, col)}
                  {@const assignment = assignments[id] ?? null}
                  {@const fill = assignment ? fillFor(assignment) : ''}
                  <button
                    type="button"
                    class="well"
                    class:well-empty={!assignment}
                    class:well-edge={cells[row * geometry.cols + col]?.edge}
                    class:well-selected={selectedWell === id}
                    class:well-reserved={assignment?.type === 'reserved'}
                    style={assignment ? `background:${fill};color:${textColorFor(fill)};` : ''}
                    title={wellTooltip(id)}
                    aria-label={wellTooltip(id)}
                    onpointerdown={(event) => startPaint(id, event)}
                    onpointerenter={() => continuePaint(id)}
                    onpointerup={endPaint}
                    oncontextmenu={(event) => {
                      event.preventDefault();
                      removeAssignment(id);
                    }}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectedWell = id;
                        if (paintTool !== 'select') applyTool(id);
                      }
                    }}
                  >
                    {#if showLabels && cellPx >= 18}
                      {#if assignment && cellPx >= 30}
                        <span class="well-label">{compactLabel(assignment)}</span>
                      {:else}
                        <span class="well-id">{id}</span>
                      {/if}
                    {/if}
                  </button>
                {/each}
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="pt-legend">
        <span class="pt-legend-title">{m.plateLegend()}</span>
        {#each legend as item (item.key)}
          <span class="legend-item">
            <span class="legend-swatch" style="background:{item.color}"></span>
            {m.plateLegendCount({ name: item.label, n: item.count })}
          </span>
        {/each}
      </div>

      <div class="pt-wellbar">
        {#if selectedWell}
          <span class="label">{m.plateSelectedWell()}</span>
          <span class="well-badge">{selectedWell}</span>
          <span class="label">{m.plateWellType()}</span>
          <span>{typeLabelOf(selectedAssignment)}</span>
          {#if selectedAssignment}
            <span class="label">{m.plateWellContent()}</span>
            <span class="well-content">{assignmentContent(selectedAssignment)}</span>
            {#if selectedAssignment.type === 'sample' && selectedAssignment.group.trim()}
              <span class="label">{m.plateWellGroup()}</span>
              <span>{selectedAssignment.group}</span>
            {/if}
            {#if selectedAssignment.type === 'sample'}
              <span class="label">{m.plateWellReplicate()}</span>
              <span>{m.plateReplicateShort({ n: selectedAssignment.replicate })}</span>
            {/if}
            {#if selectedAssignment.manual}
              <span class="tag">{m.plateWellManual()}</span>
            {/if}
          {/if}
          {#if selectedCell?.edge}
            <span class="tag">{m.plateWellEdge()}</span>
          {/if}
          <span class="pt-spacer"></span>
          {#if selectedAssignment}
            <button class="pix-btn tiny" onclick={() => removeAssignment(selectedWell ?? '')}>
              <X size={10} />
              {m.plateClearWell()}
            </button>
          {/if}
          <button class="pix-btn tiny" onclick={clearSelection}>{m.plateClearSelection()}</button>
        {:else}
          <span class="label">{m.plateSelectedWell()}</span>
          <span class="dim">{m.plateNoWellSelected()}</span>
        {/if}
      </div>
    </main>
  </div>
</div>

{#if showClearConfirm}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box">
      <div class="modal-title">{m.plateClearAllConfirm()}</div>
      <div class="modal-desc">{m.plateClearAllDesc()}</div>
      <div class="modal-btns">
        <button class="pix-btn-reset" onclick={() => (showClearConfirm = false)}>
          {m.plateCancel()}
        </button>
        <button class="pix-btn pt-danger" onclick={confirmClear}>{m.plateConfirm()}</button>
      </div>
    </div>
  </div>
{/if}

<input
  type="file"
  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
  class="hidden-input"
  bind:this={sampleInput}
  onchange={onSampleFile}
/>
<input
  type="file"
  accept=".json,application/json"
  class="hidden-input"
  bind:this={projectInput}
  onchange={onProjectFile}
/>
<input
  type="file"
  accept=".samples.json,.json,application/json"
  class="hidden-input"
  bind:this={sampleSheetInput}
  onchange={onSampleSheetFile}
/>

<svelte:window onpointerup={endPaint} onpointercancel={endPaint} onkeydown={onWindowKeydown} />

<style>
  .plate-tool {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--pix-bg);
    font-family: var(--pix-font);
    color: var(--pix-fg);
  }

  /* ------------------------------------------------------------- toolbar */
  .pt-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .pt-brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--pix-accent-2);
  }
  .pt-brand .pix-title {
    font-size: 11px;
    letter-spacing: 1.5px;
  }
  .pt-inline-field {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 8.5px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .pt-title-field {
    flex: 0 1 250px;
    min-width: 150px;
  }
  .pt-title-field .pt-input {
    flex: 1;
    min-width: 0;
  }
  .pt-stats {
    font-size: 9px;
    color: var(--pix-fg-dim);
    white-space: nowrap;
  }
  .pt-spacer {
    flex: 1;
    min-width: 6px;
  }
  .pt-format { width: 92px; }
  .pt-color-by { width: 104px; }
  .pt-mode { width: 104px; }
  .pt-danger {
    color: var(--pix-red);
    border-color: var(--pix-red);
  }
  .pt-danger:hover {
    background: var(--pix-red);
    border-color: var(--pix-red);
    color: #180607;
  }

  .pt-input,
  .pt-select,
  .pt-textarea {
    font-family: var(--pix-font);
    font-size: 10.5px;
    color: var(--pix-fg);
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    padding: 3px 5px;
    box-sizing: border-box;
    min-width: 0;
  }
  .pt-input:focus,
  .pt-select:focus,
  .pt-textarea:focus {
    outline: none;
    border-color: var(--pix-cyan);
    box-shadow: 0 0 0 1px rgba(76, 214, 255, 0.25);
  }
  .pt-select { cursor: pointer; }
  .pt-textarea {
    width: 100%;
    resize: vertical;
    min-height: 42px;
    line-height: 1.45;
  }

  /* ---------------------------------------------------------------- main */
  .pt-main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .pt-side {
    flex: 0 0 366px;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--pix-bg-2);
    border-right: 2px solid var(--pix-border);
  }
  .pt-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 10px;
    border-bottom: 2px solid var(--pix-border);
  }
  .pt-block-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9.5px;
    font-weight: 900;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .pt-block-head .count {
    margin-left: auto;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--pix-cyan);
    text-transform: none;
  }
  .hint {
    margin: 0;
    font-size: 9px;
    line-height: 1.5;
    color: var(--pix-fg-dim);
  }
  .hint.indent { margin-left: 20px; }
  .pt-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .pt-row .pix-btn {
    font-size: 9px;
    padding: 3px 6px;
  }
  .pt-grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .pt-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 8.5px;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
    min-width: 0;
  }
  .pt-field.grow { flex: 1; }
  .pt-check {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 10px;
    line-height: 1.4;
    color: var(--pix-fg);
    cursor: pointer;
  }
  .pt-check input {
    accent-color: var(--pix-cyan);
    margin: 1px 0 0;
    flex: 0 0 auto;
  }
  .pt-check.inline { font-size: 9.5px; white-space: nowrap; }
  .pt-check-line {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    color: var(--pix-green);
  }
  .seed-row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
  .seed-row .pix-btn {
    font-size: 9px;
    padding: 4px 7px;
    white-space: nowrap;
  }
  .pt-wide {
    width: 100%;
    justify-content: center;
  }
  .pt-empty-line {
    font-size: 9.5px;
    line-height: 1.55;
    color: var(--pix-fg-dim);
    padding: 4px 2px;
  }

  /* -------------------------------------------------------------- samples */
  .sample-head,
  .sample-row {
    display: grid;
    grid-template-columns: minmax(56px, 1fr) minmax(44px, 0.9fr) 38px 60px 44px;
    gap: 4px;
    align-items: center;
  }
  .sample-head {
    padding: 0 1px;
    font-size: 7px;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .sample-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sample-head span:nth-child(4), .sample-head span:nth-child(5) { text-align: center; }
  .sample-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 250px;
    overflow-y: auto;
    padding-right: 2px;
  }
  .sample-row {
    padding: 3px;
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
  }
  .sample-row.active {
    border-color: var(--pix-cyan);
    box-shadow: 0 0 5px rgba(76, 214, 255, 0.24);
  }
  .sample-row .pt-input {
    font-size: 9.5px;
    padding: 2px 4px;
    border-width: 1px;
    width: 100%;
  }
  .color-cell {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .color-input {
    width: 26px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
    cursor: pointer;
    flex: 0 0 26px;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .row-btn {
    width: 19px;
    height: 19px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    color: var(--pix-fg-dim);
    cursor: pointer;
  }
  .row-btn:hover {
    color: var(--pix-cyan);
    border-color: var(--pix-cyan);
  }
  .row-btn.danger:hover {
    color: var(--pix-red);
    border-color: var(--pix-red);
  }

  /* ---------------------------------------------------------------- stage */
  .pt-stage-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--pix-bg);
  }
  .pt-stage-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 5px 8px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .pt-stage-title {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--pix-accent-2);
  }
  .zoom-label {
    min-width: 34px;
    text-align: center;
    font-size: 9px;
    color: var(--pix-fg-dim);
  }
  .icon-btn {
    width: 24px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    cursor: pointer;
  }
  .icon-btn:hover {
    color: var(--pix-cyan);
    border-color: var(--pix-cyan);
  }

  .pt-paint-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    padding: 4px 8px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .pt-paint-bar .hint {
    font-size: 8.5px;
    margin-right: 2px;
  }
  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 9px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tool-btn:hover {
    color: var(--pix-fg);
    border-color: var(--pix-border-hi);
  }
  .tool-btn.active {
    color: var(--pix-cyan);
    border-color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.1);
  }
  .tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tool-dot {
    width: 8px;
    height: 8px;
    border: 1px solid var(--pix-border-hi);
    flex: 0 0 8px;
  }
  .paint-select {
    width: 148px;
    font-size: 9px;
    padding: 2px 4px;
  }

  .pt-stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
    background-color: var(--pix-bg);
    background-image:
      linear-gradient(rgba(42, 52, 80, 0.24) 1px, transparent 1px),
      linear-gradient(90deg, rgba(42, 52, 80, 0.24) 1px, transparent 1px);
    background-size: 18px 18px;
  }
  .pt-empty {
    height: 100%;
    min-height: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
    color: var(--pix-fg-dim);
  }
  .pt-empty-ico {
    display: inline-flex;
    color: var(--pix-cyan);
    filter: drop-shadow(0 0 8px rgba(76, 214, 255, 0.35));
  }
  .pt-empty h3 {
    margin: 0;
    font-size: 15px;
    letter-spacing: 1.5px;
    color: var(--pix-accent-2);
    text-shadow: 2px 2px 0 #000;
  }
  .pt-empty p {
    margin: 0;
    max-width: 440px;
    font-size: 10.5px;
    line-height: 1.65;
  }

  .plate-scroll {
    width: max-content;
    margin: 0 auto;
  }
  .plate-grid {
    display: grid;
    gap: 1px;
    width: max-content;
    align-items: stretch;
  }
  .corner { width: 20px; height: 12px; }
  .col-hd,
  .row-hd {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--pix-fg-dim);
    font-size: var(--hd-font, 8px);
    user-select: none;
    overflow: hidden;
  }
  .row-hd { width: 20px; }
  .col-hd { height: 13px; }

  .well {
    position: relative;
    width: var(--cell);
    height: var(--cell);
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 1px solid #1d2438;
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 7px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .well-empty { background: #0e1220; }
  .well-empty:hover {
    background: #182136;
    border-color: var(--pix-border-hi);
  }
  .well-edge.well-empty {
    border-style: dashed;
    border-color: #26304a;
  }
  .well-edge:not(.well-empty) {
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
  }
  .well-selected {
    outline: 2px solid var(--pix-accent-2);
    outline-offset: -2px;
    z-index: 2;
  }
  .well-reserved {
    background: repeating-linear-gradient(
      45deg,
      #161c2a,
      #161c2a 3px,
      #10141f 3px,
      #10141f 6px
    ) !important;
    color: var(--pix-fg-dim) !important;
  }
  .well-label,
  .well-id {
    display: block;
    width: 100%;
    padding: 0 1px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  .well-label { font-size: var(--well-font, 7px); }
  .well-id {
    font-size: 6.5px;
    opacity: 0.62;
  }

  /* --------------------------------------------------------------- legend */
  .pt-legend {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 10px;
    max-height: 94px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 5px 8px;
    background: var(--pix-bg-2);
    border-top: 2px solid var(--pix-border);
  }
  .pt-legend-title {
    font-size: 8.5px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    color: var(--pix-fg);
    white-space: nowrap;
  }
  .legend-swatch {
    width: 9px;
    height: 9px;
    flex: 0 0 9px;
    border: 1px solid var(--pix-border-hi);
  }

  /* ------------------------------------------------------------ well bar */
  .pt-wellbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px 8px;
    min-height: 34px;
    padding: 5px 10px;
    background: var(--pix-bg-2);
    border-top: 2px solid var(--pix-border);
    font-size: 10px;
  }
  .pt-wellbar .label {
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.9px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .well-badge {
    font-size: 12px;
    font-weight: 900;
    color: var(--pix-cyan);
    letter-spacing: 0.5px;
  }
  .well-content {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    padding: 0 4px;
    border: 1px solid var(--pix-border-hi);
    color: var(--pix-fg-dim);
    font-size: 8px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .tag.warn {
    color: var(--pix-accent);
    border-color: var(--pix-accent);
  }
  .pix-btn.tiny {
    font-size: 8.5px;
    padding: 2px 6px;
  }
  .dim { color: var(--pix-fg-dim); font-size: 9.5px; }

  /* --------------------------------------------------------------- checks */
  .status-badge {
    margin-left: auto;
    padding: 1px 5px;
    border: 1px solid;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.2px;
    text-transform: none;
    white-space: nowrap;
  }
  .status-badge.ok { color: var(--pix-green); border-color: var(--pix-green); }
  .status-badge.warn { color: var(--pix-accent); border-color: var(--pix-accent); }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid;
    font-size: 9px;
    line-height: 1.5;
  }
  .notice.warn {
    color: var(--pix-accent);
    border-color: rgba(255, 159, 28, 0.55);
    background: rgba(255, 159, 28, 0.08);
  }
  .ok-line {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    color: var(--pix-green);
  }
  .issue {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 6px;
    border-left: 3px solid;
    background: var(--pix-bg-3);
    font-size: 9px;
    line-height: 1.5;
    color: var(--pix-fg);
  }
  .issue.error { border-color: var(--pix-red); }
  .issue.warn { border-color: var(--pix-accent); }
  .issue.info { border-color: var(--pix-cyan); }
  .issue-dot {
    width: 6px;
    height: 6px;
    flex: 0 0 6px;
    margin-top: 4px;
    background: currentColor;
  }
  .issue.error .issue-dot { color: var(--pix-red); }
  .issue.warn .issue-dot { color: var(--pix-accent); }
  .issue.info .issue-dot { color: var(--pix-cyan); }
  .subhead {
    margin-top: 4px;
    font-size: 8.5px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
  }
  .unplaced-line {
    font-size: 9px;
    line-height: 1.5;
    color: var(--pix-accent);
  }

  /* --------------------------------------------------------------- export */
  .export-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .export-grid .pix-btn {
    justify-content: flex-start;
    font-size: 8.5px;
    padding: 3px 5px;
    line-height: 1.25;
    text-align: left;
  }
  .export-grid .span2 { grid-column: span 2; justify-content: center; }
  .export-row {
    display: flex;
    gap: 4px;
  }
  .export-row .pix-btn {
    flex: 1;
    font-size: 8.5px;
    padding: 3px 5px;
    line-height: 1.25;
    justify-content: flex-start;
  }
  .busy-line {
    font-size: 9px;
    color: var(--pix-cyan);
  }
  .autosave-line {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 8.5px;
    line-height: 1.45;
    color: var(--pix-fg-dim);
  }
  .autosave-line strong {
    font-weight: 400;
    color: var(--pix-fg);
  }

  /* ---------------------------------------------------------------- modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(3px);
  }
  .modal-box {
    width: 400px;
    max-width: 92%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: #0b0f19;
    border: 3px solid var(--pix-border);
    box-shadow: 0 0 25px rgba(0, 0, 0, 0.95);
  }
  .modal-title {
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 1px;
    color: var(--pix-accent-2);
  }
  .modal-desc {
    font-size: 11px;
    line-height: 1.6;
    color: var(--pix-fg-dim);
  }
  .modal-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .hidden-input { display: none; }

  /* ----------------------------------------------------------- responsive */
  @media (max-width: 1040px) {
    .pt-side { flex: 0 0 330px; }
    .pt-stats { display: none; }
    .pt-title-field { flex-basis: 180px; }
  }

  @media (max-width: 900px) {
    .pt-main { flex-direction: column; }
    .pt-side {
      flex: 0 0 auto;
      max-height: 46vh;
      border-right: none;
      border-bottom: 2px solid var(--pix-border);
    }
    .pt-stage-wrap { min-height: 0; }
    .pt-stage { min-height: 210px; }
    .sample-list { max-height: 150px; }
  }

  @media (max-width: 640px) {
    .pt-toolbar { gap: 6px; }
    .pt-title-field { flex-basis: 130px; min-width: 110px; }
    .pt-paint-bar .hint { display: none; }
    .pt-legend { max-height: 74px; }
    .pt-side { max-height: 50vh; }
  }
</style>
