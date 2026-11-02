<script lang="ts">
  // Scientific image annotator and multi-panel figure composer.
  // Left: ordered panel list. Centre: live figure canvas. Right: inspector.
  // The project JSON embeds every image, so exports stay portable.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { am } from './messages';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import ToolProjectBar from '$lib/tools/shared/ToolProjectBar.svelte';
  import {
    ensureProjectLoaded,
    finishToolCapture,
    takeToolHandoff,
  } from '$lib/tools/shared/projectBridge';
  import { canvasPreview } from '$lib/tools/shared/preview';
  import { saveReproBundle, type ReproFile } from '$lib/repro/bundle';
  import {
    annotateDocName,
    annotateMethods,
    annotateParameters,
    annotateProfileAnnotations,
    annotateSummary,
    normalizeAnnotatePayload,
  } from './projectDoc';
  import {
    collectProfiles,
    computeProfile,
    profileCsv,
    profilePlotPath,
    profileStatsText,
    PROFILE_DEFAULT_SAMPLES,
    PROFILE_MAX_SAMPLES,
    PROFILE_MIN_SAMPLES,
    type ProfileSeries,
  } from './profile';
  import {
    PX_PER_MM,
    clamp,
    convertCalibration,
    convertValue,
    createDefaultChannels,
    createDefaultProject,
    createId,
    formatValue,
    panelLabel,
    safeCrop,
    sourcePixelsPerFigurePixel,
    unitSymbol,
    visibleRect,
    type ActiveTool,
    type AnnotateProject,
    type Annotation,
    type ArrowAnnotation,
    type ChannelMix,
    type EllipseAnnotation,
    type LayoutSettings,
    type Panel,
    type PanelBarAnnotation,
    type ProfileAnnotation,
    type RectAnnotation,
    type ScaleBarAnnotation,
    type TextAnnotation,
    type Unit,
  } from './types';
  import {
    barLayout,
    buildAnnotationMeta,
    buildFigureGeometry,
    findAnnotationAt,
    findFrameAt,
    findHandleAt,
    pxFromMm,
    type Box,
    type PanelFrame,
    type Point,
  } from './layout';
  import {
    drawDraft,
    drawFigure,
    drawSelection,
    encodePngWithDpi,
    figureSummary,
    figureToSvg,
    renderFigurePng,
    type DraftShape,
  } from './render';
  import { buildArtwork, clearImageCache, fileToPanel, type PanelArt } from './decode';
  import {
    clearSnapshot,
    historyKey,
    loadSnapshot,
    parseProjectText,
    projectJson,
    safeFileName,
    saveSnapshot,
  } from './storage';
  import {
    Activity,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronUp,
    Circle,
    Copy,
    Download,
    FileJson,
    FolderOpen,
    Hand,
    ImagePlus,
    Layers,
    Maximize2,
    Minus,
    MousePointer2,
    Package,
    Plus,
    Redo2,
    RotateCcw,
    Ruler,
    Save,
    Settings2,
    Square,
    Trash2,
    Type,
    Undo2,
    Upload,
    ScanLine,
  } from 'lucide-svelte';

  type Busy = 'idle' | 'import' | 'png' | 'svg' | 'project' | 'bundle' | 'csv';

  const CHANNEL_KEYS = ['r', 'g', 'b'] as const;
  const CHANNEL_LABELS: Record<(typeof CHANNEL_KEYS)[number], string> = { r: 'R', g: 'G', b: 'B' };

  interface DrawDrag {
    kind: 'draw';
    tool: 'arrow' | 'rect' | 'ellipse' | 'profile';
    start: Point;
    end: Point;
    before: AnnotateProject;
  }
  interface CalibrateDrag {
    kind: 'calibrate';
    panelId: string;
    start: Point;
    end: Point;
    before: AnnotateProject;
  }
  interface MoveDrag {
    kind: 'move';
    id: string;
    start: Point;
    orig: Annotation;
    before: AnnotateProject;
    moved: boolean;
  }
  interface ResizeDrag {
    kind: 'resize';
    id: string;
    handle: string;
    orig: Annotation;
    origBox: Box;
    start: Point;
    before: AnnotateProject;
    moved: boolean;
  }
  interface PanPanelDrag {
    kind: 'panpanel';
    panelId: string;
    start: Point;
    origX: number;
    origY: number;
    before: AnnotateProject;
    moved: boolean;
  }
  type DragState = DrawDrag | CalibrateDrag | MoveDrag | ResizeDrag | PanPanelDrag;

  interface PreviewEntry {
    key: string;
    art: PanelArt | null;
    timer: ReturnType<typeof setTimeout> | null;
    building: boolean;
  }

  let project = $state<AnnotateProject>(createDefaultProject());
  let ready = $state(false);
  let artVersion = $state(0);
  let tool = $state<ActiveTool>('select');
  let selectedPanelId = $state<string | null>(null);
  let selectedAnnId = $state<string | null>(null);
  let zoomFactor = $state(1);
  let stageBox = $state({ w: 900, h: 620 });
  let drag = $state<DragState | null>(null);
  let hoverHandle = $state<string | null>(null);
  let dropActive = $state(false);
  let busy = $state<Busy>('idle');
  let autosaveState = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  let savedAt = $state('');
  let calibrateKnown = $state(100);
  let calibrateUnit = $state<Unit>('um');
  let undoStack = $state.raw<AnnotateProject[]>([]);
  let redoStack = $state.raw<AnnotateProject[]>([]);
  let skipProjectCommit = false;
  let profileSeries = $state<ProfileSeries | null>(null);
  let profileBusy = $state(false);
  let profileToken = 0;

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let stageEl = $state<HTMLDivElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let jsonInput = $state<HTMLInputElement | null>(null);

  const previewEntries = new Map<string, PreviewEntry>();
  let gestureBefore: AnnotateProject | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedKey = '';
  let quotaWarned = false;

  const geom = $derived(buildFigureGeometry(project));
  const meta = $derived(buildAnnotationMeta(project, geom));
  const selectedPanel = $derived(project.panels.find((panel) => panel.id === selectedPanelId) ?? null);
  const selectedAnn = $derived(project.annotations.find((ann) => ann.id === selectedAnnId) ?? null);
  const selectedProfile = $derived(
    selectedAnn?.kind === 'profile' &&
      profileSeries &&
      profileSeries.annotationId === selectedAnn.id
      ? profileSeries
      : null,
  );
  const selectedFrame = $derived(selectedPanel ? geom.frameById.get(selectedPanel.id) ?? null : null);
  const fitScale = $derived.by(() => {
    const availableW = Math.max(160, stageBox.w - 30);
    const availableH = Math.max(160, stageBox.h - 30);
    return Math.min(
      1.6,
      Math.max(0.02, Math.min(availableW / Math.max(1, geom.width), availableH / Math.max(1, geom.height))),
    );
  });
  const viewScale = $derived(fitScale * zoomFactor);
  const figureHeightMm = $derived(geom.height / PX_PER_MM);
  const canUndo = $derived(undoStack.length > 0);
  const canRedo = $derived(redoStack.length > 0);
  const cursor = $derived.by(() => {
    if (drag?.kind === 'panpanel') return 'grabbing';
    if (tool === 'pan') return 'grab';
    if (tool === 'select') {
      if (hoverHandle) return hoverHandle === 'start' || hoverHandle === 'end' ? 'crosshair' : 'nwse-resize';
      return 'default';
    }
    return 'crosshair';
  });
  const hint = $derived.by(() => {
    switch (tool) {
      case 'select':
        return m.annotHintSelect();
      case 'pan':
        return m.annotHintPan();
      case 'arrow':
        return m.annotHintArrow();
      case 'rect':
        return m.annotHintRect();
      case 'ellipse':
        return m.annotHintEllipse();
      case 'text':
        return m.annotHintText();
      case 'scalebar':
        return m.annotHintScalebar();
      case 'panelbar':
        return m.annotHintPanelbar();
      case 'profile':
        return am.annotHintProfile();
      case 'calibrate':
        return m.annotHintCalibrate();
    }
  });

  const toolDefs = [
    { id: 'select', icon: MousePointer2 },
    { id: 'pan', icon: Hand },
    { id: 'arrow', icon: ArrowUpRight },
    { id: 'rect', icon: Square },
    { id: 'ellipse', icon: Circle },
    { id: 'text', icon: Type },
    { id: 'scalebar', icon: Ruler },
    { id: 'panelbar', icon: ScanLine },
    { id: 'profile', icon: Activity },
    { id: 'calibrate', icon: Maximize2 },
  ] satisfies { id: ActiveTool; icon: unknown }[];

  function toolLabel(id: ActiveTool): string {
    switch (id) {
      case 'select':
        return m.annotToolSelect();
      case 'pan':
        return m.annotToolPan();
      case 'arrow':
        return m.annotToolArrow();
      case 'rect':
        return m.annotToolRect();
      case 'ellipse':
        return m.annotToolEllipse();
      case 'text':
        return m.annotToolText();
      case 'scalebar':
        return m.annotToolScalebar();
      case 'panelbar':
        return m.annotToolPanelbar();
      case 'profile':
        return am.annotToolProfile();
      case 'calibrate':
        return m.annotToolCalibrate();
    }
  }

  // ------------------------------------------------------------- utilities

  function snapshot(): AnnotateProject {
    return $state.snapshot(project) as AnnotateProject;
  }

  /**
   * Rebuild mutable objects while sharing the immutable base64 payload strings.
   * History entries and the live project therefore never alias each other.
   */
  function cloneProject(source: AnnotateProject): AnnotateProject {
    return {
      version: 1,
      name: source.name,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      layout: { ...source.layout },
      panels: source.panels.map((panel) => ({
        ...panel,
        crop: { ...panel.crop },
        calibration: panel.calibration ? { ...panel.calibration } : null,
      })),
      annotations: source.annotations.map((ann) => ({ ...ann })),
    };
  }

  function pushHistory(before: AnnotateProject) {
    if (historyKey(before) === historyKey(project)) return;
    undoStack = [...undoStack, before].slice(-60);
    redoStack = [];
  }

  function withCommit(mutate: () => void) {
    const before = snapshot();
    mutate();
    pushHistory(before);
  }

  function beginGesture() {
    if (!gestureBefore) gestureBefore = snapshot();
  }

  function endGesture() {
    if (gestureBefore) {
      pushHistory(gestureBefore);
      gestureBefore = null;
    }
  }

  function undo() {
    if (!undoStack.length) return;
    const current = snapshot();
    const previous = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, current].slice(-60);
    project = cloneProject(previous);
    afterHistoryJump();
  }

  function redo() {
    if (!redoStack.length) return;
    const current = snapshot();
    const next = redoStack[redoStack.length - 1];
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, current].slice(-60);
    project = cloneProject(next);
    afterHistoryJump();
  }

  function afterHistoryJump() {
    if (selectedAnnId && !project.annotations.some((ann) => ann.id === selectedAnnId)) selectedAnnId = null;
    if (selectedPanelId && !project.panels.some((panel) => panel.id === selectedPanelId)) {
      selectedPanelId = project.panels[0]?.id ?? null;
    }
    drag = null;
    hoverHandle = null;
    artVersion++;
  }

  function numberFrom(event: Event): number {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target || target.value.trim() === '') return Number.NaN;
    return Number(target.value);
  }

  function stringFrom(event: Event): string {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    return target ? target.value : '';
  }

  function checkedFrom(event: Event): boolean {
    const target = event.currentTarget as HTMLInputElement | null;
    return target ? target.checked : false;
  }

  function applyNumber(event: Event, apply: (value: number) => void) {
    const value = numberFrom(event);
    if (!Number.isFinite(value)) return;
    withCommit(() => apply(value));
  }

  function mmValue(px: number): string {
    return (px / PX_PER_MM).toFixed(1);
  }

  function percentValue(fraction: number): string {
    return (fraction * 100).toFixed(1);
  }

  function setLayout<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) {
    withCommit(() => {
      project.layout[key] = value;
    });
  }

  function selectOnFocus(event: FocusEvent) {
    (event.currentTarget as HTMLInputElement | null)?.select();
  }

  // ---------------------------------------------------------- image artwork

  function previewKey(panel: Panel): string {
    return `${panel.brightness}|${panel.contrast}|${JSON.stringify(panel.channels)}|${panel.width}x${panel.height}|${panel.dataUrl.length}`;
  }

  function previewArt(panel: Panel): PanelArt | null {
    const key = previewKey(panel);
    let entry = previewEntries.get(panel.id);
    if (!entry) {
      entry = { key: '', art: null, timer: null, building: false };
      previewEntries.set(panel.id, entry);
    }
    if (entry.key === key && entry.art) return entry.art;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.building) {
      const target = entry;
      const run = () => {
        target.timer = null;
        target.building = true;
        target.key = key;
        buildArtwork(panel, 1400, false)
          .then((art) => {
            target.art = art;
          })
          .catch(() => {
            /* an unreadable panel stays blank until the project is fixed */
          })
          .finally(() => {
            target.building = false;
            artVersion++;
          });
      };
      if (entry.art) entry.timer = setTimeout(run, 120);
      else run();
    }
    return entry.art;
  }

  async function buildExportArts(source: AnnotateProject, withDataUrl: boolean): Promise<Map<string, PanelArt>> {
    const out = new Map<string, PanelArt>();
    for (const panel of source.panels) {
      try {
        out.set(panel.id, await buildArtwork(panel, 0, withDataUrl));
      } catch {
        /* skip panels that cannot be decoded */
      }
    }
    return out;
  }

  /** Medium-resolution composite art for interactive profile sampling. */
  async function buildProfileArts(source: AnnotateProject): Promise<Map<string, PanelArt>> {
    const out = new Map<string, PanelArt>();
    for (const panel of source.panels) {
      try {
        out.set(panel.id, await buildArtwork(panel, 1600, false));
      } catch {
        /* skip panels that cannot be decoded */
      }
    }
    return out;
  }

  function clearArtCaches() {
    for (const entry of previewEntries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    previewEntries.clear();
    clearImageCache();
    artVersion++;
  }

  async function renderProjectPreview(): Promise<string | null> {
    if (!project.panels.length) return null;
    const current = snapshot();
    const figure = buildFigureGeometry(current);
    const boxes = buildAnnotationMeta(current, figure);
    const arts = await buildProfileArts(current);
    const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
    const canvas = renderFigurePng(current, figure, resolver, boxes, 96);
    return canvasPreview(canvas);
  }

  async function captureToProject() {
    if (!projectStore.hasOpenProject) return;
    const current = snapshot();
    const preview = await renderProjectPreview();
    finishToolCapture(
      'annotate',
      annotateDocName(current),
      current,
      preview ?? undefined,
      annotateSummary(current),
    );
  }

  // ---------------------------------------------------------------- drawing

  $effect(() => {
    const canvas = canvasEl;
    if (!canvas) return;
    const figure = geom;
    const boxes = meta;
    const scale = viewScale;
    const selection = { annotationId: selectedAnnId, panelId: selectedPanelId };
    const currentDrag = drag;
    // Asynchronously decoded panels bump artVersion to repaint the stage.
    void artVersion;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = Math.max(1, figure.width * scale);
    const cssH = Math.max(1, figure.height * scale);
    const maxDim = 8192;
    let renderScale = dpr * scale;
    if (figure.width * renderScale > maxDim || figure.height * renderScale > maxDim) {
      renderScale = Math.min(maxDim / figure.width, maxDim / figure.height);
    }
    const pixelW = Math.max(1, Math.round(figure.width * renderScale));
    const pixelH = Math.max(1, Math.round(figure.height * renderScale));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, figure.width, figure.height);
    drawFigure(ctx, project, figure, (panel) => previewArt(panel), boxes);
    drawSelection(ctx, project, figure, boxes, selection, scale);
    if (currentDrag) {
      if (currentDrag.kind === 'draw') {
        const draft: DraftShape = {
          kind: currentDrag.tool === 'profile' ? 'line' : currentDrag.tool,
          start: currentDrag.start,
          end: currentDrag.end,
        };
        drawDraft(ctx, draft, scale);
      } else if (currentDrag.kind === 'calibrate') {
        drawDraft(ctx, { kind: 'line', start: currentDrag.start, end: currentDrag.end }, scale);
      }
    }
  });

  // ---------------------------------------------------------- autosave/load

  $effect(() => {
    if (!ready) return;
    const key = historyKey(project);
    if (key === lastSavedKey) {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      autosaveState = 'saved';
      return;
    }
    const snap = snapshot();
    autosaveState = 'saving';
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      const ok = saveSnapshot(snap);
      if (ok) {
        autosaveState = 'saved';
        savedAt = new Date().toLocaleTimeString();
        lastSavedKey = key;
      } else {
        autosaveState = 'failed';
        if (!quotaWarned) {
          quotaWarned = true;
          pushToast('warn', m.annotAutosaveFailed());
        }
      }
    }, 900);
  });

  $effect(() => {
    if (selectedAnnId && !project.annotations.some((ann) => ann.id === selectedAnnId)) selectedAnnId = null;
    if (selectedPanelId && !project.panels.some((panel) => panel.id === selectedPanelId)) {
      selectedPanelId = project.panels[0]?.id ?? null;
    }
  });

  $effect(() => {
    const panel = selectedPanel;
    if (panel?.calibration) calibrateUnit = panel.calibration.unit;
  });

  // Mirror the live editor into the open project document. The first run after
  // a handoff load is skipped so opening a document cannot overwrite it.
  $effect(() => {
    if (!ready) return;
    const payload = snapshot();
    if (projectStore.activeDocKind !== 'annotate') return;
    if (skipProjectCommit) {
      skipProjectCommit = false;
      return;
    }
    projectStore.commitDoc('annotate', payload);
  });

  // Recompute the selected profile whenever the composite or the line changes.
  $effect(() => {
    const ann = selectedAnn;
    void artVersion;
    // historyKey registers every editable panel and annotation field, while
    // avoiding a rebuild for unrelated reactive updates.
    void historyKey(project);
    if (!ann || ann.kind !== 'profile' || !project.panels.length) {
      profileToken++;
      profileSeries = null;
      profileBusy = false;
      return;
    }
    const annSnapshot = $state.snapshot(ann) as ProfileAnnotation;
    const token = ++profileToken;
    profileBusy = true;
    const timer = setTimeout(() => {
      const current = snapshot();
      const figure = buildFigureGeometry(current);
      buildProfileArts(current)
        .then((arts) => {
          const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
          const series = computeProfile(annSnapshot, current, figure, resolver, am.annotProfileTitle());
          if (token !== profileToken) return;
          profileSeries = series;
        })
        .catch(() => {
          if (token === profileToken) profileSeries = null;
        })
        .finally(() => {
          if (token === profileToken) profileBusy = false;
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      profileToken++;
    };
  });

  function flushAutosave() {
    if (!ready) return;
    const snap = snapshot();
    const key = historyKey(snap);
    if (key === lastSavedKey) return;
    if (saveSnapshot(snap)) {
      lastSavedKey = key;
      autosaveState = 'saved';
      savedAt = new Date().toLocaleTimeString();
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushAutosave();
  }

  onMount(() => {
    ensureProjectLoaded();
    const handoff = takeToolHandoff('annotate');
    let captureRequested = false;
    if (handoff?.type === 'open') {
      const opened = normalizeAnnotatePayload(handoff.payload);
      if (opened) {
        // The handoff payload is authoritative; skip the immediate write-back
        // so opening a document can never overwrite it with the local draft.
        skipProjectCommit = true;
        project = opened;
        selectedPanelId = opened.panels[0]?.id ?? null;
        selectedAnnId = null;
        zoomFactor = 1;
        clearArtCaches();
        lastSavedKey = '';
        pushToast('success', m.annotProjectLoaded());
      } else {
        pushToast('error', m.annotProjectInvalid());
        const saved = loadSnapshot();
        if (saved && (saved.panels.length || saved.annotations.length)) {
          project = saved;
          selectedPanelId = saved.panels[0]?.id ?? null;
          pushToast('info', m.annotRestored());
        }
      }
    } else {
      const saved = loadSnapshot();
      if (saved && (saved.panels.length || saved.annotations.length)) {
        project = saved;
        selectedPanelId = saved.panels[0]?.id ?? null;
        pushToast('info', m.annotRestored());
      }
    }
    captureRequested = handoff?.type === 'capture';
    ready = true;
    window.addEventListener('beforeunload', flushAutosave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (captureRequested) void captureToProject();
    return () => {
      window.removeEventListener('beforeunload', flushAutosave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  onMount(() => {
    const element = stageEl;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      stageBox = { w: rect.width, h: rect.height };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // ---------------------------------------------------------- project actions

  async function importFiles(files: FileList | File[] | null) {
    if (!files || busy !== 'idle') return;
    const list = Array.from(files);
    if (!list.length) return;
    busy = 'import';
    const decoded: Panel[] = [];
    let failed = 0;
    for (const file of list) {
      try {
        decoded.push(await fileToPanel(file));
      } catch {
        failed += 1;
      }
    }
    if (decoded.length) {
      const before = snapshot();
      project.panels.push(...decoded);
      selectedPanelId = decoded[0].id;
      selectedAnnId = null;
      zoomFactor = 1;
      pushHistory(before);
      artVersion++;
      pushToast('success', m.annotImported({ n: decoded.length }));
    }
    if (failed) pushToast('warn', m.annotImportFailed({ n: failed }));
    busy = 'idle';
  }

  function onPickImages(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input?.files) return;
    void importFiles(input.files);
    input.value = '';
  }

  function onPickProject(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    void file
      .text()
      .then((text) => {
        const parsed = parseProjectText(text);
        if (!parsed) {
          pushToast('error', m.annotProjectInvalid());
          return;
        }
        const before = snapshot();
        project = parsed;
        selectedPanelId = project.panels[0]?.id ?? null;
        selectedAnnId = null;
        zoomFactor = 1;
        clearArtCaches();
        pushHistory(before);
        lastSavedKey = '';
        pushToast('success', m.annotProjectLoaded());
      })
      .catch(() => pushToast('error', m.annotProjectInvalid()));
  }

  function newProject() {
    if (busy !== 'idle') return;
    if (!confirm(m.annotNewConfirm())) return;
    project = createDefaultProject();
    selectedPanelId = null;
    selectedAnnId = null;
    zoomFactor = 1;
    drag = null;
    undoStack = [];
    redoStack = [];
    lastSavedKey = '';
    clearArtCaches();
    clearSnapshot();
    pushToast('info', m.annotCleared());
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dropActive = true;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dropActive = false;
    void importFiles(event.dataTransfer?.files ?? null);
  }

  async function saveBytes(name: string, bytes: Uint8Array, message: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, bytes);
      if (result.data?.saved) {
        pushToast('success', message);
        return true;
      }
      pushToast('error', result.error ?? m.annotExportFailed());
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  async function saveText(name: string, text: string, message: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, text);
      if (result.data?.saved) {
        pushToast('success', message);
        return true;
      }
      pushToast('error', result.error ?? m.annotExportFailed());
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  function baseName(): string {
    return safeFileName(project.name);
  }

  async function exportPng() {
    if (!project.panels.length || busy !== 'idle') {
      if (!project.panels.length) pushToast('warn', m.annotNoExport());
      return;
    }
    busy = 'png';
    try {
      const current = snapshot();
      const figure = buildFigureGeometry(current);
      const boxes = buildAnnotationMeta(current, figure);
      const arts = await buildExportArts(current, false);
      const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
      const dpi = current.layout.exportDpi;
      const canvas = renderFigurePng(current, figure, resolver, boxes, dpi);
      const bytes = await encodePngWithDpi(canvas, dpi, figureSummary(current, figure, dpi));
      await saveBytes(`${baseName()}_${dpi}dpi.png`, bytes, m.annotExportDone());
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportSvg() {
    if (!project.panels.length || busy !== 'idle') {
      if (!project.panels.length) pushToast('warn', m.annotNoExport());
      return;
    }
    busy = 'svg';
    try {
      const current = snapshot();
      const figure = buildFigureGeometry(current);
      const boxes = buildAnnotationMeta(current, figure);
      const arts = await buildExportArts(current, true);
      const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
      const svg = figureToSvg(current, figure, resolver, boxes);
      await saveText(`${baseName()}.svg`, svg, m.annotExportDone());
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportProjectJson() {
    if (busy !== 'idle') return;
    busy = 'project';
    try {
      await saveText(`${baseName()}.annot.json`, projectJson(snapshot()), m.annotProjectSaved());
    } finally {
      busy = 'idle';
    }
  }

  async function sampleAllProfiles(): Promise<ProfileSeries[]> {
    const current = snapshot();
    if (!annotateProfileAnnotations(current).length) return [];
    const figure = buildFigureGeometry(current);
    const arts = await buildExportArts(current, false);
    const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
    return collectProfiles(current, figure, resolver);
  }

  async function exportProfilesCsv() {
    if (busy !== 'idle') return;
    busy = 'csv';
    try {
      const series = await sampleAllProfiles();
      if (!series.length) {
        pushToast('warn', am.annotProfileCsvEmpty());
        return;
      }
      await saveText(`${baseName()}_profiles.csv`, profileCsv(series), am.annotProfileCsvDone());
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportBundle() {
    if (!project.panels.length || busy !== 'idle') {
      if (!project.panels.length) pushToast('warn', m.annotNoExport());
      return;
    }
    busy = 'bundle';
    try {
      const current = snapshot();
      const figure = buildFigureGeometry(current);
      const boxes = buildAnnotationMeta(current, figure);
      const arts = await buildExportArts(current, true);
      const resolver = (panel: Panel) => arts.get(panel.id) ?? null;
      const dpi = current.layout.exportDpi;
      const canvas = renderFigurePng(current, figure, resolver, boxes, dpi);
      const png = await encodePngWithDpi(canvas, dpi, figureSummary(current, figure, dpi));
      const svg = figureToSvg(current, figure, resolver, boxes);
      const profiles = await collectProfiles(current, figure, resolver);
      const stem = baseName();
      const files: ReproFile[] = [
        { name: `${stem}_${dpi}dpi.png`, mime: 'image/png', data: png },
        { name: `${stem}.svg`, mime: 'image/svg+xml', data: svg },
      ];
      if (profiles.length) {
        files.push({ name: `${stem}_profiles.csv`, mime: 'text/csv', data: profileCsv(profiles) });
      }
      const result = await saveReproBundle({
        tool: 'annotate',
        title: annotateDocName(current),
        files,
        parameters: {
          ...annotateParameters(current),
          profiles: profiles.map((series) => ({
            name: series.name,
            annotationId: series.annotationId,
            samples: series.samples,
            min: Number(series.min.toFixed(3)),
            max: Number(series.max.toFixed(3)),
            mean: Number(series.mean.toFixed(3)),
          })),
        },
        methods: annotateMethods(current),
        project: current,
      });
      if (result.ok) pushToast('success', am.annotBundleDone(), result.path);
      else if (result.canceled) pushToast('info', am.annotBundleCanceled());
      else pushToast('error', am.annotBundleFailed(), result.error);
    } catch (error) {
      pushToast('error', am.annotBundleFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  // -------------------------------------------------------------- pointer

  function toPoint(event: PointerEvent): Point {
    const canvas = canvasEl;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / viewScale,
      y: (event.clientY - rect.top) / viewScale,
    };
  }

  function constrain(start: Point, end: Point, shift: boolean): Point {
    if (!shift) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) > Math.abs(dy) * 2) return { x: end.x, y: start.y };
    if (Math.abs(dy) > Math.abs(dx) * 2) return { x: start.x, y: end.y };
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx) * side, y: start.y + Math.sign(dy) * side };
  }

  function onCanvasPointerDown(event: PointerEvent) {
    if (busy !== 'idle' || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const canvas = canvasEl;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = toPoint(event);
    hoverHandle = null;

    const frame = findFrameAt(geom, point);

    if (tool === 'select') {
      if (selectedAnn) {
        const handle = findHandleAt(selectedAnn, meta.get(selectedAnn.id), point, 10 / viewScale);
        if (handle) {
          drag = {
            kind: 'resize',
            id: selectedAnn.id,
            handle,
            orig: $state.snapshot(selectedAnn) as Annotation,
            origBox: { ...(meta.get(selectedAnn.id)?.box ?? { x: 0, y: 0, w: 0, h: 0 }) },
            start: point,
            before: snapshot(),
            moved: false,
          };
          return;
        }
      }
      const hit = findAnnotationAt(project, meta, point, 5 / viewScale);
      if (hit) {
        selectedAnnId = hit;
        if (frame) selectedPanelId = frame.panel.id;
        const ann = project.annotations.find((item) => item.id === hit);
        if (ann) {
          drag = {
            kind: 'move',
            id: hit,
            start: point,
            orig: $state.snapshot(ann) as Annotation,
            before: snapshot(),
            moved: false,
          };
        }
        return;
      }
      selectedAnnId = null;
      if (frame) selectedPanelId = frame.panel.id;
      return;
    }

    if (frame) selectedPanelId = frame.panel.id;

    if (tool === 'pan') {
      if (!frame) return;
      drag = {
        kind: 'panpanel',
        panelId: frame.panel.id,
        start: point,
        origX: frame.panel.offsetX,
        origY: frame.panel.offsetY,
        before: snapshot(),
        moved: false,
      };
      return;
    }

    if (tool === 'text') {
      addTextAt(point, frame);
      return;
    }
    if (tool === 'scalebar') {
      addScalebarAt(point, frame);
      return;
    }
    if (tool === 'panelbar') {
      addPanelbarAt(point, frame);
      return;
    }
    if (tool === 'calibrate') {
      if (!frame) {
        pushToast('warn', m.annotNeedsPanel());
        return;
      }
      drag = {
        kind: 'calibrate',
        panelId: frame.panel.id,
        start: point,
        end: point,
        before: snapshot(),
      };
      return;
    }
    if (tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || tool === 'profile') {
      drag = { kind: 'draw', tool, start: point, end: point, before: snapshot() };
    }
  }

  function onCanvasPointerMove(event: PointerEvent) {
    if (!event.isPrimary) return;
    const point = toPoint(event);
    if (!drag) {
      if (tool === 'select' && selectedAnn) {
        const next = findHandleAt(selectedAnn, meta.get(selectedAnn.id), point, 10 / viewScale);
        if (next !== hoverHandle) hoverHandle = next;
      } else if (hoverHandle) {
        hoverHandle = null;
      }
      return;
    }

    if (drag.kind === 'draw') {
      if (drag.tool === 'arrow' || drag.tool === 'profile') {
        drag.end = constrain(drag.start, point, event.shiftKey);
      } else if (event.shiftKey) {
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        drag.end = { x: drag.start.x + Math.sign(dx) * side, y: drag.start.y + Math.sign(dy) * side };
      } else {
        drag.end = point;
      }
    } else if (drag.kind === 'calibrate') {
      drag.end = constrain(drag.start, point, event.shiftKey);
    } else if (drag.kind === 'move') {
      applyMove(drag, point);
    } else if (drag.kind === 'resize') {
      applyResize(drag, point);
    } else if (drag.kind === 'panpanel') {
      applyPan(drag, point);
    }
  }

  function onCanvasPointerUp(event: PointerEvent) {
    const finished = drag;
    drag = null;
    hoverHandle = null;
    if (canvasEl?.hasPointerCapture(event.pointerId)) canvasEl.releasePointerCapture(event.pointerId);
    if (!finished) return;
    if (finished.kind === 'draw') finishDraw(finished);
    else if (finished.kind === 'calibrate') finishCalibration(finished);
  }

  function applyMove(d: MoveDrag, point: Point) {
    const dx = point.x - d.start.x;
    const dy = point.y - d.start.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    const ann = project.annotations.find((item) => item.id === d.id);
    if (!ann) return;
    if (ann.kind === 'arrow' && d.orig.kind === 'arrow') {
      ann.x1 = d.orig.x1 + dx;
      ann.y1 = d.orig.y1 + dy;
      ann.x2 = d.orig.x2 + dx;
      ann.y2 = d.orig.y2 + dy;
    } else if (ann.kind === 'profile' && d.orig.kind === 'profile') {
      ann.x1 = d.orig.x1 + dx;
      ann.y1 = d.orig.y1 + dy;
      ann.x2 = d.orig.x2 + dx;
      ann.y2 = d.orig.y2 + dy;
    } else if (
      (ann.kind === 'rect' || ann.kind === 'ellipse' || ann.kind === 'text' || ann.kind === 'scalebar') &&
      d.orig.kind === ann.kind
    ) {
      ann.x = d.orig.x + dx;
      ann.y = d.orig.y + dy;
    } else if (ann.kind === 'panelbar' && d.orig.kind === 'panelbar') {
      const frame = geom.frameById.get(ann.panelId);
      if (!frame) return;
      ann.nx = clamp(d.orig.nx + dx / frame.w, 0, 1);
      ann.ny = clamp(d.orig.ny + dy / frame.h, 0, 1);
    }
    if (!d.moved) {
      d.moved = true;
      pushHistory(d.before);
    }
  }

  function applyResize(d: ResizeDrag, point: Point) {
    const ann = project.annotations.find((item) => item.id === d.id);
    if (!ann) return;
    if (ann.kind === 'arrow' && d.orig.kind === 'arrow') {
      if (d.handle === 'start') {
        ann.x1 = point.x;
        ann.y1 = point.y;
      } else {
        ann.x2 = point.x;
        ann.y2 = point.y;
      }
    } else if (ann.kind === 'profile' && d.orig.kind === 'profile') {
      if (d.handle === 'start') {
        ann.x1 = point.x;
        ann.y1 = point.y;
      } else {
        ann.x2 = point.x;
        ann.y2 = point.y;
      }
    } else if (
      (ann.kind === 'rect' || ann.kind === 'ellipse') &&
      (d.orig.kind === 'rect' || d.orig.kind === 'ellipse')
    ) {
      const anchorX = d.handle.includes('w') ? d.origBox.x + d.origBox.w : d.origBox.x;
      const anchorY = d.handle.includes('n') ? d.origBox.y + d.origBox.h : d.origBox.y;
      ann.x = Math.min(anchorX, point.x);
      ann.y = Math.min(anchorY, point.y);
      ann.w = Math.max(2, Math.abs(point.x - anchorX));
      ann.h = Math.max(2, Math.abs(point.y - anchorY));
    } else if (ann.kind === 'text' && d.orig.kind === 'text') {
      const ratio = (point.x - d.origBox.x) / Math.max(10, d.origBox.w);
      ann.fontSizePt = clamp(d.orig.fontSizePt * ratio, 4, 96);
    } else if (ann.kind === 'scalebar' && d.orig.kind === 'scalebar') {
      const bar = barLayout(d.orig, geom);
      if (!bar) return;
      const ratio = Math.max(0.02, (point.x - d.orig.x) / Math.max(2, bar.length));
      ann.value = Math.max(0.001, Number((d.orig.value * ratio).toPrecision(4)));
    } else if (ann.kind === 'panelbar' && d.orig.kind === 'panelbar') {
      const frame = geom.frameById.get(d.orig.panelId);
      const bar = barLayout(d.orig, geom);
      if (!frame || !bar) return;
      const startX = frame.x + d.orig.nx * frame.w;
      const ratio = Math.max(0.02, (point.x - startX) / Math.max(2, bar.length));
      ann.value = Math.max(0.001, Number((d.orig.value * ratio).toPrecision(4)));
    } else {
      return;
    }
    if (!d.moved) {
      d.moved = true;
      pushHistory(d.before);
    }
  }

  function applyPan(d: PanPanelDrag, point: Point) {
    const panel = project.panels.find((item) => item.id === d.panelId);
    const frame = geom.frameById.get(d.panelId);
    if (!panel || !frame) return;
    const crop = safeCrop(panel);
    const vis = visibleRect(panel);
    const cw = 1 - crop.left - crop.right;
    const ch = 1 - crop.top - crop.bottom;
    const mx = (cw - vis.sw) / 2;
    const my = (ch - vis.sh) / 2;
    if (mx > 0.000001) {
      const delta = -(point.x - d.start.x) * (vis.sw * panel.width) / frame.w / panel.width;
      panel.offsetX = clamp(d.origX + delta / mx, -1, 1);
    }
    if (my > 0.000001) {
      const delta = -(point.y - d.start.y) * (vis.sh * panel.height) / frame.h / panel.height;
      panel.offsetY = clamp(d.origY + delta / my, -1, 1);
    }
    if (!d.moved) {
      d.moved = true;
      pushHistory(d.before);
    }
  }

  function finishDraw(d: DrawDrag) {
    const distance = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
    if (distance < 4 / viewScale) return;
    const before = d.before;
    if (d.tool === 'arrow') {
      const ann: ArrowAnnotation = {
        kind: 'arrow',
        id: createId('ann'),
        color: '#111111',
        x1: d.start.x,
        y1: d.start.y,
        x2: d.end.x,
        y2: d.end.y,
        strokeWidthPt: 1.5,
        headSizePt: 8,
      };
      project.annotations.push(ann);
      selectedAnnId = ann.id;
    } else if (d.tool === 'profile') {
      const ann: ProfileAnnotation = {
        kind: 'profile',
        id: createId('ann'),
        color: '#ffd23f',
        x1: d.start.x,
        y1: d.start.y,
        x2: d.end.x,
        y2: d.end.y,
        samples: PROFILE_DEFAULT_SAMPLES,
        strokeWidthPt: 1.2,
      };
      project.annotations.push(ann);
      selectedAnnId = ann.id;
    } else {
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.max(2, Math.abs(d.end.x - d.start.x));
      const h = Math.max(2, Math.abs(d.end.y - d.start.y));
      if (d.tool === 'rect') {
        const ann: RectAnnotation = {
          kind: 'rect',
          id: createId('ann'),
          color: '#111111',
          x,
          y,
          w,
          h,
          strokeWidthPt: 1.5,
          fill: 'none',
        };
        project.annotations.push(ann);
        selectedAnnId = ann.id;
      } else {
        const ann: EllipseAnnotation = {
          kind: 'ellipse',
          id: createId('ann'),
          color: '#111111',
          x,
          y,
          w,
          h,
          strokeWidthPt: 1.5,
          fill: 'none',
        };
        project.annotations.push(ann);
        selectedAnnId = ann.id;
      }
    }
    pushHistory(before);
  }

  function addTextAt(point: Point, frame: PanelFrame | null) {
    if (frame) selectedPanelId = frame.panel.id;
    const before = snapshot();
    const ann: TextAnnotation = {
      kind: 'text',
      id: createId('ann'),
      color: '#111111',
      x: point.x,
      y: point.y,
      text: m.annotDefaultText(),
      fontSizePt: 10,
      background: 'none',
      paddingPt: 2,
    };
    project.annotations.push(ann);
    selectedAnnId = ann.id;
    pushHistory(before);
  }

  function defaultBarValue(unit: Unit): number {
    if (unit === 'mm') return 1;
    if (unit === 'nm') return 100;
    if (unit === 'px') return 100;
    return 10;
  }

  function addScalebarAt(point: Point, frame: PanelFrame | null) {
    if (frame) selectedPanelId = frame.panel.id;
    const panel = frame?.panel ?? selectedPanel;
    const calibration = panel?.calibration ?? null;
    const before = snapshot();
    const ann: ScaleBarAnnotation = {
      kind: 'scalebar',
      id: createId('ann'),
      color: '#111111',
      x: point.x,
      y: point.y,
      mode: calibration ? 'calibrated' : 'fixed',
      value: calibration ? defaultBarValue(calibration.unit) : 5,
      unit: calibration ? calibration.unit : 'mm',
      panelId: panel?.id ?? '',
      thicknessPt: 2,
      fontSizePt: 9,
      showLabel: true,
    };
    project.annotations.push(ann);
    selectedAnnId = ann.id;
    pushHistory(before);
  }

  function addPanelbarAt(point: Point, frame: PanelFrame | null) {
    const target = frame ?? selectedFrame;
    if (!target) {
      pushToast('warn', m.annotNeedsPanel());
      return;
    }
    const panel = target.panel;
    selectedPanelId = panel.id;
    if (!panel.calibration) {
      pushToast('warn', m.annotNeedsCalibration());
      return;
    }
    const nx = clamp((point.x - target.x) / target.w, 0.02, 0.9);
    const ny = clamp((point.y - target.y) / target.h, 0.05, 0.95);
    const before = snapshot();
    const ann: PanelBarAnnotation = {
      kind: 'panelbar',
      id: createId('ann'),
      color: '#111111',
      panelId: panel.id,
      nx,
      ny,
      value: defaultBarValue(panel.calibration.unit),
      unit: panel.calibration.unit,
      thicknessPt: 2,
      fontSizePt: 9,
      showLabel: true,
    };
    project.annotations.push(ann);
    selectedAnnId = ann.id;
    pushHistory(before);
  }

  function finishCalibration(d: CalibrateDrag) {
    const panel = project.panels.find((item) => item.id === d.panelId);
    const frame = geom.frameById.get(d.panelId);
    if (!panel || !frame) return;
    const length = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
    if (length < 5 / viewScale) {
      pushToast('warn', m.annotCalibrationTooShort());
      return;
    }
    if (!(calibrateKnown > 0)) {
      pushToast('warn', m.annotBadValue());
      return;
    }
    const sourcePx = length * sourcePixelsPerFigurePixel(panel, frame.w);
    const pxPerUnit = sourcePx / calibrateKnown;
    panel.calibration = { unit: calibrateUnit, pxPerUnit };
    selectedPanelId = panel.id;
    tool = 'select';
    pushHistory(d.before);
    pushToast('success', m.annotCalibrationSaved());
  }

  function deleteAnnotationById(id: string) {
    withCommit(() => {
      project.annotations = project.annotations.filter((ann) => ann.id !== id);
      if (selectedAnnId === id) selectedAnnId = null;
    });
  }

  function duplicateAnnotationById(id: string) {
    const source = project.annotations.find((ann) => ann.id === id);
    if (!source) return;
    withCommit(() => {
      const copy = $state.snapshot(source) as Annotation;
      copy.id = createId('ann');
      if (copy.kind === 'panelbar') {
        copy.nx = clamp(copy.nx + 0.03, 0, 1);
        copy.ny = clamp(copy.ny + 0.03, 0, 1);
      } else if (copy.kind === 'arrow') {
        copy.x1 += 12;
        copy.y1 += 12;
        copy.x2 += 12;
        copy.y2 += 12;
      } else if (copy.kind === 'profile') {
        copy.x1 += 12;
        copy.y1 += 12;
        copy.x2 += 12;
        copy.y2 += 12;
      } else if (copy.kind === 'rect' || copy.kind === 'ellipse' || copy.kind === 'text' || copy.kind === 'scalebar') {
        copy.x += 12;
        copy.y += 12;
      }
      project.annotations.push(copy);
      selectedAnnId = copy.id;
    });
  }

  function nudgeSelected(dx: number, dy: number) {
    const ann = selectedAnn;
    if (!ann) return;
    withCommit(() => {
      if (ann.kind === 'arrow') {
        ann.x1 += dx;
        ann.y1 += dy;
        ann.x2 += dx;
        ann.y2 += dy;
      } else if (ann.kind === 'profile') {
        ann.x1 += dx;
        ann.y1 += dy;
        ann.x2 += dx;
        ann.y2 += dy;
      } else if (ann.kind === 'panelbar') {
        const frame = geom.frameById.get(ann.panelId);
        if (!frame) return;
        ann.nx = clamp(ann.nx + dx / frame.w, 0, 1);
        ann.ny = clamp(ann.ny + dy / frame.h, 0, 1);
      } else if (ann.kind === 'rect' || ann.kind === 'ellipse' || ann.kind === 'text' || ann.kind === 'scalebar') {
        ann.x += dx;
        ann.y += dy;
      }
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      if (selectedAnnId) duplicateAnnotationById(selectedAnnId);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedAnnId) {
        event.preventDefault();
        deleteAnnotationById(selectedAnnId);
      }
      return;
    }
    if (event.key === 'Escape') {
      drag = null;
      hoverHandle = null;
      selectedAnnId = null;
      tool = 'select';
      return;
    }
    if (selectedAnnId && event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') nudgeSelected(-step, 0);
      else if (event.key === 'ArrowRight') nudgeSelected(step, 0);
      else if (event.key === 'ArrowUp') nudgeSelected(0, -step);
      else if (event.key === 'ArrowDown') nudgeSelected(0, step);
    }
  }

  // ----------------------------------------------------------- panel actions

  function movePanel(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= project.panels.length) return;
    withCommit(() => {
      const [panel] = project.panels.splice(index, 1);
      project.panels.splice(target, 0, panel);
    });
  }

  function duplicatePanel(index: number) {
    const panel = project.panels[index];
    if (!panel) return;
    withCommit(() => {
      const copy: Panel = {
        ...panel,
        id: createId('panel'),
        name: `${panel.name} ${m.annotCopySuffix()}`,
        crop: { ...panel.crop },
        channels: {
          r: { ...panel.channels.r },
          g: { ...panel.channels.g },
          b: { ...panel.channels.b },
        },
        calibration: panel.calibration ? { ...panel.calibration } : null,
      };
      project.panels.splice(index + 1, 0, copy);
      selectedPanelId = copy.id;
      selectedAnnId = null;
    });
  }

  function removePanel(index: number) {
    const panel = project.panels[index];
    if (!panel) return;
    withCommit(() => {
      project.panels.splice(index, 1);
      project.annotations = project.annotations.filter(
        (ann) => !(ann.kind === 'panelbar' && ann.panelId === panel.id),
      );
      for (const ann of project.annotations) {
        if (ann.kind === 'scalebar' && ann.panelId === panel.id) {
          ann.panelId = project.panels[0]?.id ?? '';
        }
      }
      if (selectedPanelId === panel.id) {
        selectedPanelId = project.panels[Math.min(index, project.panels.length - 1)]?.id ?? null;
      }
      if (selectedAnnId && !project.annotations.some((ann) => ann.id === selectedAnnId)) {
        selectedAnnId = null;
      }
    });
    const entry = previewEntries.get(panel.id);
    if (entry?.timer) clearTimeout(entry.timer);
    previewEntries.delete(panel.id);
  }

  type CropKey = 'left' | 'top' | 'right' | 'bottom';

  function setCrop(panel: Panel, key: CropKey, percent: number) {
    const value = clamp(percent / 100, 0, 0.9);
    const crop = { ...panel.crop };
    if (key === 'left') crop.left = Math.min(value, 0.9 - crop.right);
    else if (key === 'right') crop.right = Math.min(value, 0.9 - crop.left);
    else if (key === 'top') crop.top = Math.min(value, 0.9 - crop.bottom);
    else crop.bottom = Math.min(value, 0.9 - crop.top);
    panel.crop = crop;
  }

  function resetPanelView(panel: Panel) {
    withCommit(() => {
      panel.zoom = 1;
      panel.offsetX = 0;
      panel.offsetY = 0;
    });
  }

  function resetImageAdjustments(panel: Panel) {
    withCommit(() => {
      panel.brightness = 100;
      panel.contrast = 100;
    });
  }

  function resetChannels(panel: Panel) {
    withCommit(() => {
      panel.channels = createDefaultChannels();
    });
  }

  function channelValue(panel: Panel, key: keyof ChannelMix) {
    return panel.channels[key];
  }

  function selectedProfilePath(series: ProfileSeries | null): string {
    return series ? profilePlotPath(series, 160, 52) : '';
  }

  function selectedProfileStats(series: ProfileSeries | null): string {
    return series ? profileStatsText(series) : '';
  }

  function calibrationInput(panel: Panel): string {
    const calibration = panel.calibration;
    if (!calibration || calibration.unit !== calibrateUnit) return '';
    return String(Number(calibration.pxPerUnit.toPrecision(6)));
  }

  function calibrationText(panel: Panel): string {
    const calibration = panel.calibration;
    if (!calibration) return m.annotNotCalibrated();
    const value = calibration.pxPerUnit;
    const text =
      value >= 1000 || value < 0.01 ? value.toExponential(3) : formatValue(value);
    return `${text} px / ${unitSymbol(calibration.unit)}`;
  }

  function applyCalibration(panel: Panel, pxPerUnit: number) {
    if (!(pxPerUnit > 0)) return;
    withCommit(() => {
      panel.calibration = { unit: calibrateUnit, pxPerUnit };
    });
  }

  function clearCalibration(panel: Panel) {
    withCommit(() => {
      panel.calibration = null;
    });
  }

  function startCalibration(panel: Panel) {
    selectedPanelId = panel.id;
    selectedAnnId = null;
    tool = 'calibrate';
  }

  function setScaleMode(ann: ScaleBarAnnotation, mode: 'calibrated' | 'fixed') {
    if (ann.mode === mode) return;
    withCommit(() => {
      if (mode === 'fixed') {
        const bar = barLayout(ann, geom);
        ann.value = bar ? Number((bar.length / PX_PER_MM).toFixed(3)) : 5;
        ann.unit = 'mm';
        ann.mode = 'fixed';
      } else {
        const panel =
          project.panels.find((item) => item.id === ann.panelId) ??
          selectedPanel ??
          project.panels.find((item) => item.calibration) ??
          null;
        ann.mode = 'calibrated';
        ann.panelId = panel?.id ?? '';
        const unit = panel?.calibration?.unit;
        ann.unit = unit && unit !== 'px' ? unit : 'um';
        ann.value = defaultBarValue(ann.unit);
      }
    });
  }

  function setBarUnit(ann: ScaleBarAnnotation | PanelBarAnnotation, next: Unit) {
    if (ann.unit === next) return;
    withCommit(() => {
      ann.value = convertValue(ann.value, ann.unit, next);
      ann.unit = next;
    });
  }

  function barLengthText(ann: ScaleBarAnnotation | PanelBarAnnotation): string {
    const bar = barLayout(ann, geom);
    if (!bar) return m.annotNeedsCalibration();
    return `${(bar.length / PX_PER_MM).toFixed(1)} ${m.annotMm()}`;
  }

  function annSummary(ann: Annotation): string {
    switch (ann.kind) {
      case 'arrow':
        return m.annotToolArrow();
      case 'rect':
        return m.annotToolRect();
      case 'ellipse':
        return m.annotToolEllipse();
      case 'text': {
        const text = ann.text.trim().replace(/\s+/g, ' ');
        return `${m.annotToolText()}: ${text ? (text.length > 24 ? `${text.slice(0, 24)}…` : text) : '—'}`;
      }
      case 'scalebar':
        return `${m.annotScaleBar()}: ${formatValue(ann.value)} ${unitSymbol(ann.unit)}`;
      case 'panelbar': {
        const index = project.panels.findIndex((panel) => panel.id === ann.panelId);
        const tag = index >= 0 ? panelLabel(index, project.layout.labelStyle) : '—';
        return `${m.annotPanelBar()} ${tag}: ${formatValue(ann.value)} ${unitSymbol(ann.unit)}`;
      }
      case 'profile': {
        const lengthMm = Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) / PX_PER_MM;
        return `${am.annotToolProfile()}: ${lengthMm.toFixed(1)} ${m.annotMm()}`;
      }
      default:
        return '';
    }
  }

  function setTool(next: ActiveTool) {
    tool = next;
    hoverHandle = null;
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="annot-page">
  <input
    bind:this={fileInput}
    class="hidden-input"
    type="file"
    accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff"
    multiple
    onchange={onPickImages}
  />
  <input
    bind:this={jsonInput}
    class="hidden-input"
    type="file"
    accept=".json,application/json"
    onchange={onPickProject}
  />

  <ToolProjectBar
    kind="annotate"
    getPayload={() => snapshot()}
    getName={() => annotateDocName(snapshot())}
    getPreview={renderProjectPreview}
    getSummary={() => annotateSummary(snapshot())}
  />

  <div class="annot-toolbar">
    <div class="btn-row tools">
      {#each toolDefs as item (item.id)}
        <button
          class="pix-btn tool-btn"
          class:active={tool === item.id}
          title={toolLabel(item.id)}
          aria-pressed={tool === item.id}
          onclick={() => setTool(item.id)}
        >
          <item.icon size={13} />
          <span class="tool-text">{toolLabel(item.id)}</span>
        </button>
      {/each}
    </div>

    <div class="spacer"></div>

    <div class="btn-row">
      <button class="pix-btn icon-only" disabled={!canUndo} onclick={undo} title={m.annotUndo()}>
        <Undo2 size={13} />
      </button>
      <button class="pix-btn icon-only" disabled={!canRedo} onclick={redo} title={m.annotRedo()}>
        <Redo2 size={13} />
      </button>
      <button class="pix-btn" disabled={busy !== 'idle'} onclick={() => fileInput?.click()}>
        <ImagePlus size={13} /> {m.annotImport()}
      </button>
      <button class="pix-btn" disabled={busy !== 'idle'} onclick={() => jsonInput?.click()}>
        <FolderOpen size={13} /> {m.annotImportProject()}
      </button>
      <label class="inline dpi-pick">
        <span>{m.annotDpi()}</span>
        <select
          class="pix-select tiny"
          value={project.layout.exportDpi}
          onchange={(event) =>
            setLayout('exportDpi', stringFrom(event) === '600' ? 600 : 300)}
        >
          <option value="300">300</option>
          <option value="600">600</option>
        </select>
      </label>
      <button class="pix-btn ok" disabled={busy !== 'idle' || !project.panels.length} onclick={exportPng}>
        <Download size={13} /> PNG
      </button>
      <button class="pix-btn ok" disabled={busy !== 'idle' || !project.panels.length} onclick={exportSvg}>
        <Download size={13} /> SVG
      </button>
      <button class="pix-btn" disabled={busy !== 'idle'} onclick={exportProjectJson}>
        <FileJson size={13} /> JSON
      </button>
      <button class="pix-btn danger" disabled={busy !== 'idle'} onclick={newProject} title={m.annotNew()}>
        <RotateCcw size={13} />
      </button>
    </div>
  </div>

  <div class="annot-body">
    <aside
      class="panel-list"
      class:drop={dropActive}
      role="region"
      aria-label={m.annotPanels()}
      ondragover={handleDragOver}
      ondragleave={() => (dropActive = false)}
      ondrop={handleDrop}
    >
      <div class="side-head">
        <span><Layers size={11} /> {m.annotPanels()}</span>
        <span class="pix-dim tiny">{m.annotPanelCount({ n: project.panels.length })}</span>
      </div>
      <button class="pix-btn small" disabled={busy !== 'idle'} onclick={() => fileInput?.click()}>
        <Plus size={11} /> {m.annotAddImages()}
      </button>
      <div class="panel-scroll">
        {#each project.panels as panel, index (panel.id)}
          <div class="panel-card" class:active={panel.id === selectedPanelId}>
            <button
              class="thumb"
              title={panel.name}
              onclick={() => {
                selectedPanelId = panel.id;
                selectedAnnId = null;
              }}
            >
              <img src={panel.dataUrl} alt={panel.name} draggable="false" />
              <span class="thumb-label">{panelLabel(index, project.layout.labelStyle)}</span>
            </button>
            <div class="panel-info">
              <input
                class="pix-input panel-name"
                bind:value={panel.name}
                aria-label={m.annotPanelName()}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <div class="panel-meta pix-dim tiny">
                {panel.width} × {panel.height} px
              </div>
              <div class="panel-actions">
                <button
                  class="icon"
                  disabled={index === 0}
                  title={m.annotMoveUp()}
                  onclick={() => movePanel(index, -1)}
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  class="icon"
                  disabled={index === project.panels.length - 1}
                  title={m.annotMoveDown()}
                  onclick={() => movePanel(index, 1)}
                >
                  <ChevronDown size={12} />
                </button>
                <button class="icon" title={m.annotDuplicate()} onclick={() => duplicatePanel(index)}>
                  <Copy size={12} />
                </button>
                <button class="icon danger" title={m.annotRemove()} onclick={() => removePanel(index)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        {:else}
          <div class="empty-list pix-dim tiny">{m.annotNoPanels()}</div>
        {/each}
      </div>
      <div class="drop-hint pix-dim tiny">{m.annotDropHint()}</div>
    </aside>

    <section class="stage-wrap">
      <div class="stage-head">
        <span>
          {m.annotPreview()}
          <span class="pix-dim"> · {project.layout.figureWidthMm.toFixed(1)} × {figureHeightMm.toFixed(1)} {m.annotMm()}</span>
        </span>
        <span class="zoom-tools">
          <button
            class="pix-btn tiny-btn"
            onclick={() => (zoomFactor = clamp(zoomFactor / 1.25, 0.25, 5))}
            title={m.annotZoomOut()}
          >
            <Minus size={11} />
          </button>
          <span class="pix-dim tiny">{Math.round(viewScale * 100)}%</span>
          <button
            class="pix-btn tiny-btn"
            onclick={() => (zoomFactor = clamp(zoomFactor * 1.25, 0.25, 5))}
            title={m.annotZoomIn()}
          >
            <Plus size={11} />
          </button>
          <button class="pix-btn tiny-btn" onclick={() => (zoomFactor = 1)} title={m.annotFit()}>
            {m.annotFit()}
          </button>
        </span>
      </div>

      <div
        class="stage-scroll"
        class:drop={dropActive}
        bind:this={stageEl}
        role="region"
        aria-label={m.annotStageLabel()}
        ondragover={handleDragOver}
        ondragleave={() => (dropActive = false)}
        ondrop={handleDrop}
      >
        {#if project.panels.length}
          <div class="canvas-holder">
            <canvas
              bind:this={canvasEl}
              aria-label={m.annotStageLabel()}
              style="cursor:{cursor}"
              onpointerdown={onCanvasPointerDown}
              onpointermove={onCanvasPointerMove}
              onpointerup={onCanvasPointerUp}
              onpointercancel={onCanvasPointerUp}
              onpointerleave={() => (hoverHandle = null)}
            ></canvas>
          </div>
        {:else}
          <div class="stage-empty">
            <div class="empty-icon"><ScanLine size={34} /></div>
            <h3>{m.annotCanvasEmpty()}</h3>
            <p>{m.annotCanvasEmptyDesc()}</p>
            <button class="pix-btn accent" onclick={() => fileInput?.click()}>
              <Upload size={13} /> {m.annotAddImages()}
            </button>
            <p class="pix-dim tiny">{m.annotDropHint()}</p>
          </div>
        {/if}
      </div>

      <div class="stage-foot">
        <span class="hint">{hint}</span>
        <span class="pix-dim tiny">{m.annotKeyboardHint()}</span>
      </div>
    </section>

    <aside class="inspector">
      <details open>
        <summary><Settings2 size={11} /> {m.annotLayout()}</summary>
        <div class="sec-body">
          <label class="field">
            <span>{m.annotFigureName()}</span>
            <input
              class="pix-input"
              bind:value={project.name}
              onfocus={beginGesture}
              onblur={endGesture}
            />
          </label>
          <div class="grid2">
            <label class="field">
              <span>{m.annotColumns()}</span>
              <input
                class="pix-input"
                type="number"
                min="1"
                max="12"
                step="1"
                value={project.layout.columns}
                onchange={(event) =>
                  applyNumber(event, (value) => {
                    project.layout.columns = Math.round(clamp(value, 1, 12));
                  })}
              />
            </label>
            <label class="field">
              <span>{m.annotFlow()}</span>
              <select
                class="pix-select"
                value={project.layout.flow}
                onchange={(event) =>
                  setLayout('flow', stringFrom(event) === 'column' ? 'column' : 'row')}
              >
                <option value="row">{m.annotFlowRow()}</option>
                <option value="column">{m.annotFlowColumn()}</option>
              </select>
            </label>
            <label class="field">
              <span>{m.annotGap()} ({m.annotMm()})</span>
              <input
                class="pix-input"
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={project.layout.gapMm}
                onchange={(event) =>
                  applyNumber(event, (value) => {
                    project.layout.gapMm = clamp(value, 0, 30);
                  })}
              />
            </label>
            <label class="field">
              <span>{m.annotMargin()} ({m.annotMm()})</span>
              <input
                class="pix-input"
                type="number"
                min="0"
                max="40"
                step="0.5"
                value={project.layout.marginMm}
                onchange={(event) =>
                  applyNumber(event, (value) => {
                    project.layout.marginMm = clamp(value, 0, 40);
                  })}
              />
            </label>
            <label class="field">
              <span>{m.annotFigureWidth()} ({m.annotMm()})</span>
              <input
                class="pix-input"
                type="number"
                min="40"
                max="400"
                step="5"
                value={project.layout.figureWidthMm}
                onchange={(event) =>
                  applyNumber(event, (value) => {
                    project.layout.figureWidthMm = clamp(value, 40, 400);
                  })}
              />
            </label>
            <label class="field">
              <span>{m.annotFontFamily()}</span>
              <select
                class="pix-select"
                value={project.layout.fontFamily}
                onchange={(event) => setLayout('fontFamily', stringFrom(event))}
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Calibri">Calibri</option>
                <option value="Cambria">Cambria</option>
              </select>
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span>{m.annotLabelStyle()}</span>
              <select
                class="pix-select"
                value={project.layout.labelStyle}
                onchange={(event) => {
                  const value = stringFrom(event);
                  setLayout('labelStyle', value === 'lower' ? 'lower' : value === 'number' ? 'number' : 'upper');
                }}
              >
                <option value="upper">{m.annotLabelUpper()}</option>
                <option value="lower">{m.annotLabelLower()}</option>
                <option value="number">{m.annotLabelNumber()}</option>
              </select>
            </label>
            <label class="field">
              <span>{m.annotLabelPosition()}</span>
              <select
                class="pix-select"
                value={project.layout.labelPosition}
                onchange={(event) => {
                  const value = stringFrom(event);
                  const allowed = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const;
                  const next = allowed.find((item) => item === value) ?? 'tl';
                  setLayout('labelPosition', next);
                }}
              >
                <option value="tl">{m.annotPosTl()}</option>
                <option value="tc">{m.annotPosTc()}</option>
                <option value="tr">{m.annotPosTr()}</option>
                <option value="bl">{m.annotPosBl()}</option>
                <option value="bc">{m.annotPosBc()}</option>
                <option value="br">{m.annotPosBr()}</option>
              </select>
            </label>
            <label class="field">
              <span>{m.annotLabelSize()} ({m.annotPt()})</span>
              <input
                class="pix-input"
                type="number"
                min="4"
                max="36"
                step="0.5"
                value={project.layout.labelFontSizePt}
                onchange={(event) =>
                  applyNumber(event, (value) => {
                    project.layout.labelFontSizePt = clamp(value, 4, 36);
                  })}
              />
            </label>
            <label class="field color-field">
              <span>{m.annotLabelColor()}</span>
              <input
                class="pix-color"
                type="color"
                value={project.layout.labelColor}
                oninput={(event) => {
                  project.layout.labelColor = stringFrom(event);
                }}
                onfocus={beginGesture}
                onblur={endGesture}
              />
            </label>
            <label class="field color-field">
              <span>{m.annotBackground()}</span>
              <input
                class="pix-color"
                type="color"
                value={project.layout.background}
                oninput={(event) => {
                  project.layout.background = stringFrom(event);
                }}
                onfocus={beginGesture}
                onblur={endGesture}
              />
            </label>
          </div>
          <div class="pix-dim tiny">
            {m.annotFigureSize()}: {project.layout.figureWidthMm.toFixed(1)} × {figureHeightMm.toFixed(1)} {m.annotMm()}
          </div>
        </div>
      </details>

      <details open={!!selectedPanel}>
        <summary><ImagePlus size={11} /> {m.annotPanelSettings()}</summary>
        {#if selectedPanel}
          {@const panel = selectedPanel}
          <div class="sec-body">
            <label class="field">
              <span>{m.annotPanelName()}</span>
              <input
                class="pix-input"
                bind:value={panel.name}
                onfocus={beginGesture}
                onblur={endGesture}
              />
            </label>
            <div class="pix-dim tiny">
              {m.annotSourceSize()}: {panel.width} × {panel.height} px
            </div>

            <div class="sub-head">{m.annotCrop()} (%)</div>
            <div class="grid2">
              <label class="field">
                <span>{m.annotCropLeft()}</span>
                <input
                  class="pix-input"
                  type="number"
                  min="0"
                  max="90"
                  step="0.5"
                  value={percentValue(panel.crop.left)}
                  onchange={(event) => applyNumber(event, (value) => setCrop(panel, 'left', value))}
                />
              </label>
              <label class="field">
                <span>{m.annotCropRight()}</span>
                <input
                  class="pix-input"
                  type="number"
                  min="0"
                  max="90"
                  step="0.5"
                  value={percentValue(panel.crop.right)}
                  onchange={(event) => applyNumber(event, (value) => setCrop(panel, 'right', value))}
                />
              </label>
              <label class="field">
                <span>{m.annotCropTop()}</span>
                <input
                  class="pix-input"
                  type="number"
                  min="0"
                  max="90"
                  step="0.5"
                  value={percentValue(panel.crop.top)}
                  onchange={(event) => applyNumber(event, (value) => setCrop(panel, 'top', value))}
                />
              </label>
              <label class="field">
                <span>{m.annotCropBottom()}</span>
                <input
                  class="pix-input"
                  type="number"
                  min="0"
                  max="90"
                  step="0.5"
                  value={percentValue(panel.crop.bottom)}
                  onchange={(event) => applyNumber(event, (value) => setCrop(panel, 'bottom', value))}
                />
              </label>
            </div>
            <div class="btn-row">
              <button
                class="pix-btn tiny-btn"
                onclick={() =>
                  withCommit(() => {
                    panel.crop = { left: 0, top: 0, right: 0, bottom: 0 };
                  })}
              >
                {m.annotResetCrop()}
              </button>
            </div>

            <div class="sub-head">{m.annotView()}</div>
            <label class="range-row">
              <span>{m.annotZoom()}</span>
              <input
                type="range"
                min="1"
                max="8"
                step="0.05"
                bind:value={panel.zoom}
                onpointerdown={beginGesture}
                onpointerup={endGesture}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <output>{panel.zoom.toFixed(2)}×</output>
            </label>
            <label class="range-row">
              <span>{m.annotPanX()}</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                disabled={panel.zoom <= 1.001}
                bind:value={panel.offsetX}
                onpointerdown={beginGesture}
                onpointerup={endGesture}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <output>{panel.offsetX.toFixed(2)}</output>
            </label>
            <label class="range-row">
              <span>{m.annotPanY()}</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                disabled={panel.zoom <= 1.001}
                bind:value={panel.offsetY}
                onpointerdown={beginGesture}
                onpointerup={endGesture}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <output>{panel.offsetY.toFixed(2)}</output>
            </label>
            <div class="btn-row">
              <button class="pix-btn tiny-btn" onclick={() => resetPanelView(panel)}>
                {m.annotResetView()}
              </button>
            </div>

            <div class="sub-head">{m.annotImageAdjust()}</div>
            <label class="range-row">
              <span>{m.annotBrightness()}</span>
              <input
                type="range"
                min="10"
                max="300"
                step="1"
                bind:value={panel.brightness}
                onpointerdown={beginGesture}
                onpointerup={endGesture}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <output>{panel.brightness}%</output>
            </label>
            <label class="range-row">
              <span>{m.annotContrast()}</span>
              <input
                type="range"
                min="10"
                max="300"
                step="1"
                bind:value={panel.contrast}
                onpointerdown={beginGesture}
                onpointerup={endGesture}
                onfocus={beginGesture}
                onblur={endGesture}
              />
              <output>{panel.contrast}%</output>
            </label>
            <div class="btn-row">
              <button class="pix-btn tiny-btn" onclick={() => resetImageAdjustments(panel)}>
                {m.annotResetImage()}
              </button>
            </div>

            <div class="sub-head">{am.annotChannels()}</div>
            {#each CHANNEL_KEYS as key (key)}
              {@const channel = channelValue(panel, key)}
              <div class="channel-row">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={channel.show}
                    onchange={(event) =>
                      withCommit(() => {
                        channel.show = checkedFrom(event);
                      })}
                  />
                  {CHANNEL_LABELS[key]}
                </label>
                <input
                  class="channel-gain"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={channel.gain}
                  oninput={(event) => {
                    channel.gain = clamp(numberFrom(event), 0, 2);
                  }}
                  onpointerdown={beginGesture}
                  onpointerup={endGesture}
                  onfocus={beginGesture}
                  onblur={endGesture}
                  aria-label={`${am.annotChannelGain()} ${CHANNEL_LABELS[key]}`}
                />
                <output>{channel.gain.toFixed(2)}</output>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={channel.invert}
                    onchange={(event) =>
                      withCommit(() => {
                        channel.invert = checkedFrom(event);
                      })}
                  />
                  {am.annotChannelInvert()}
                </label>
              </div>
            {/each}
            <div class="btn-row">
              <button class="pix-btn tiny-btn" onclick={() => resetChannels(panel)}>
                {am.annotChannelsReset()}
              </button>
            </div>
            <div class="pix-dim tiny">{am.annotChannelsHint()}</div>

            <div class="sub-head">{m.annotCalibration()}</div>
            <div class="cal-state" class:ok={!!panel.calibration}>
              {calibrationText(panel)}
            </div>
            <div class="grid2">
              <label class="field">
                <span>{m.annotCalibrationUnit()}</span>
                <select
                  class="pix-select"
                  value={calibrateUnit}
                  onchange={(event) => {
                    const next = stringFrom(event) as Unit;
                    calibrateUnit = next;
                    const converted = panel.calibration
                      ? convertCalibration(panel.calibration, next)
                      : null;
                    if (converted) {
                      withCommit(() => {
                        panel.calibration = converted;
                      });
                    }
                  }}
                >
                  <option value="um">µm</option>
                  <option value="mm">mm</option>
                  <option value="nm">nm</option>
                  <option value="px">px</option>
                </select>
              </label>
              <label class="field">
                <span>{m.annotPxPerUnit()} ({unitSymbol(calibrateUnit)})</span>
                <input
                  class="pix-input"
                  type="number"
                  min="0.0001"
                  step="any"
                  value={calibrationInput(panel)}
                  onchange={(event) =>
                    applyNumber(event, (value) => applyCalibration(panel, value))}
                />
              </label>
            </div>
            <div class="grid2">
              <label class="field">
                <span>{m.annotKnownLength()} ({unitSymbol(calibrateUnit)})</span>
                <input class="pix-input" type="number" min="0.0001" step="any" bind:value={calibrateKnown} />
              </label>
              <div class="field">
                <span>&nbsp;</span>
                <button class="pix-btn small" onclick={() => startCalibration(panel)}>
                  <Ruler size={11} /> {m.annotDrawCalibration()}
                </button>
              </div>
            </div>
            <div class="pix-dim tiny">{m.annotCalibrationHint()}</div>
            {#if panel.calibration}
              <div class="btn-row">
                <button class="pix-btn tiny-btn danger" onclick={() => clearCalibration(panel)}>
                  {m.annotClearCalibration()}
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="sec-body">
            <div class="pix-dim tiny">{m.annotSelectPanelHint()}</div>
          </div>
        {/if}
      </details>

      <details open={!!selectedAnn}>
        <summary><Layers size={11} /> {m.annotAnnotations()}</summary>
        <div class="sec-body">
          <div class="btn-row wrap">
            <button class="pix-btn tiny-btn" onclick={() => setTool('arrow')}>
              <ArrowUpRight size={10} /> {m.annotToolArrow()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('rect')}>
              <Square size={10} /> {m.annotToolRect()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('ellipse')}>
              <Circle size={10} /> {m.annotToolEllipse()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('text')}>
              <Type size={10} /> {m.annotToolText()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('scalebar')}>
              <Ruler size={10} /> {m.annotToolScalebar()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('panelbar')}>
              <ScanLine size={10} /> {m.annotToolPanelbar()}
            </button>
            <button class="pix-btn tiny-btn" onclick={() => setTool('profile')}>
              <Activity size={10} /> {am.annotToolProfile()}
            </button>
          </div>

          {#if project.annotations.length}
            <div class="ann-list">
              {#each project.annotations as ann (ann.id)}
                <div class="ann-row" class:active={ann.id === selectedAnnId}>
                  <button
                    class="ann-pick"
                    onclick={() => {
                      selectedAnnId = ann.id;
                      if ((ann.kind === 'panelbar' || ann.kind === 'scalebar') && ann.panelId) {
                        selectedPanelId = ann.panelId;
                      }
                    }}
                  >
                    {annSummary(ann)}
                  </button>
                  <button class="icon" title={m.annotDuplicateAnn()} onclick={() => duplicateAnnotationById(ann.id)}>
                    <Copy size={11} />
                  </button>
                  <button class="icon danger" title={m.annotDeleteAnn()} onclick={() => deleteAnnotationById(ann.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="pix-dim tiny">{m.annotNoAnnotations()}</div>
          {/if}

          {#if selectedAnn}
            {@const ann = selectedAnn}
            <div class="ann-editor">
              {#if ann.kind === 'arrow'}
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotFieldX1()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.x1)}
                      onchange={(event) => applyNumber(event, (value) => (ann.x1 = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldY1()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.y1)}
                      onchange={(event) => applyNumber(event, (value) => (ann.y1 = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldX2()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.x2)}
                      onchange={(event) => applyNumber(event, (value) => (ann.x2 = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldY2()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.y2)}
                      onchange={(event) => applyNumber(event, (value) => (ann.y2 = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotStrokeWidth()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.25"
                      max="12"
                      step="0.25"
                      value={ann.strokeWidthPt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.strokeWidthPt = clamp(value, 0.25, 12)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotHeadSize()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="2"
                      max="40"
                      step="0.5"
                      value={ann.headSizePt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.headSizePt = clamp(value, 2, 40)))}
                    />
                  </label>
                </div>
              {:else if ann.kind === 'rect' || ann.kind === 'ellipse'}
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotFieldX()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.x)}
                      onchange={(event) => applyNumber(event, (value) => (ann.x = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldY()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.y)}
                      onchange={(event) => applyNumber(event, (value) => (ann.y = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldW()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={mmValue(ann.w)}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.w = Math.max(1, pxFromMm(value))))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldH()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={mmValue(ann.h)}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.h = Math.max(1, pxFromMm(value))))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotStrokeWidth()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.25"
                      max="12"
                      step="0.25"
                      value={ann.strokeWidthPt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.strokeWidthPt = clamp(value, 0.25, 12)))}
                    />
                  </label>
                </div>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={ann.fill !== 'none'}
                    onchange={(event) =>
                      withCommit(() => {
                        ann.fill = checkedFrom(event) ? '#ffd23f' : 'none';
                      })}
                  />
                  {m.annotUseFill()}
                </label>
                {#if ann.fill !== 'none'}
                  <label class="field color-field">
                    <span>{m.annotFill()}</span>
                    <input
                      class="pix-color"
                      type="color"
                      value={ann.fill}
                      oninput={(event) => {
                        ann.fill = stringFrom(event);
                      }}
                      onfocus={beginGesture}
                      onblur={endGesture}
                    />
                  </label>
                {/if}
              {:else if ann.kind === 'text'}
                <label class="field">
                  <span>{m.annotTextContent()}</span>
                  <textarea
                    class="pix-input"
                    rows="3"
                    value={ann.text}
                    oninput={(event) => {
                      ann.text = stringFrom(event);
                    }}
                    onfocus={beginGesture}
                    onblur={endGesture}
                  ></textarea>
                </label>
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotFieldX()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.x)}
                      onchange={(event) => applyNumber(event, (value) => (ann.x = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldY()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.y)}
                      onchange={(event) => applyNumber(event, (value) => (ann.y = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFontSize()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="4"
                      max="96"
                      step="0.5"
                      value={ann.fontSizePt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.fontSizePt = clamp(value, 4, 96)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotPadding()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0"
                      max="20"
                      step="0.5"
                      value={ann.paddingPt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.paddingPt = clamp(value, 0, 20)))}
                    />
                  </label>
                </div>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={ann.background !== 'none'}
                    onchange={(event) =>
                      withCommit(() => {
                        ann.background = checkedFrom(event) ? '#ffffff' : 'none';
                      })}
                  />
                  {m.annotTextBackground()}
                </label>
                {#if ann.background !== 'none'}
                  <label class="field color-field">
                    <span>{m.annotTextBackground()}</span>
                    <input
                      class="pix-color"
                      type="color"
                      value={ann.background}
                      oninput={(event) => {
                        ann.background = stringFrom(event);
                      }}
                      onfocus={beginGesture}
                      onblur={endGesture}
                    />
                  </label>
                {/if}
              {:else if ann.kind === 'scalebar'}
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotBarMode()}</span>
                    <select
                      class="pix-select"
                      value={ann.mode}
                      onchange={(event) =>
                        setScaleMode(ann, stringFrom(event) === 'fixed' ? 'fixed' : 'calibrated')}
                    >
                      <option value="calibrated">{m.annotModeCalibrated()}</option>
                      <option value="fixed">{m.annotModeFixed()}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>{m.annotValue()}</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.001"
                      step="any"
                      value={ann.value}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.value = Math.max(0.001, value)))}
                    />
                  </label>
                </div>
                {#if ann.mode === 'calibrated'}
                  <label class="field">
                    <span>{m.annotCalibrationPanel()}</span>
                    <select
                      class="pix-select"
                      value={ann.panelId}
                      onchange={(event) =>
                        withCommit(() => {
                          ann.panelId = stringFrom(event);
                        })}
                    >
                      {#each project.panels as panel, index (panel.id)}
                        <option value={panel.id}>
                          {panelLabel(index, project.layout.labelStyle)} · {panel.name}
                        </option>
                      {/each}
                    </select>
                  </label>
                  <div class="grid2">
                    <label class="field">
                      <span>{m.annotUnit()}</span>
                      <select
                        class="pix-select"
                        value={ann.unit}
                        onchange={(event) => setBarUnit(ann, stringFrom(event) as Unit)}
                      >
                        <option value="um">µm</option>
                        <option value="mm">mm</option>
                        <option value="nm">nm</option>
                        <option value="px">px</option>
                      </select>
                    </label>
                    <div class="field">
                      <span>{m.annotBarLength()}</span>
                      <div class="readout">{barLengthText(ann)}</div>
                    </div>
                  </div>
                  {#if !barLayout(ann, geom)}
                    <div class="warn-text tiny">{m.annotNeedsCalibration()}</div>
                  {/if}
                {:else}
                  <div class="pix-dim tiny">
                    {m.annotModeFixed()}: {m.annotBarLength()} = {barLengthText(ann)}
                  </div>
                {/if}
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotFieldX()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.x)}
                      onchange={(event) => applyNumber(event, (value) => (ann.x = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFieldY()} ({m.annotMm()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      step="0.1"
                      value={mmValue(ann.y)}
                      onchange={(event) => applyNumber(event, (value) => (ann.y = pxFromMm(value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotBarThickness()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.25"
                      max="16"
                      step="0.25"
                      value={ann.thicknessPt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.thicknessPt = clamp(value, 0.25, 16)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFontSize()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="4"
                      max="48"
                      step="0.5"
                      value={ann.fontSizePt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.fontSizePt = clamp(value, 4, 48)))}
                    />
                  </label>
                </div>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={ann.showLabel}
                    onchange={(event) =>
                      withCommit(() => {
                        ann.showLabel = checkedFrom(event);
                      })}
                  />
                  {m.annotShowLabel()}
                </label>
              {:else if ann.kind === 'profile'}
                <div class="grid2">
                  <label class="field">
                    <span>{am.annotProfileSamples()}</span>
                    <input
                      class="pix-input"
                      type="number"
                      min={PROFILE_MIN_SAMPLES}
                      max={PROFILE_MAX_SAMPLES}
                      step="8"
                      value={ann.samples}
                      onchange={(event) =>
                        applyNumber(event, (value) =>
                          (ann.samples = Math.round(clamp(value, PROFILE_MIN_SAMPLES, PROFILE_MAX_SAMPLES))))}
                    />
                  </label>
                  <div class="field">
                    <span>{am.annotProfileLength()} ({m.annotMm()})</span>
                    <div class="readout">
                      {(Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) / PX_PER_MM).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div class="sub-head">{am.annotProfileTitle()}</div>
                {#if profileBusy}
                  <div class="pix-dim tiny">{am.annotProfileBusy()}</div>
                {:else if selectedProfile}
                  <svg
                    class="profile-plot"
                    viewBox="0 0 160 52"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={am.annotProfileTitle()}
                  >
                    <rect x="0" y="0" width="160" height="52" fill="var(--pix-bg)" />
                    <path
                      d={selectedProfilePath(selectedProfile)}
                      fill="none"
                      stroke={ann.color}
                      stroke-width="1.2"
                    />
                  </svg>
                  <div class="pix-dim tiny">
                    {am.annotProfileMinMeanMax()}: {selectedProfileStats(selectedProfile)}
                  </div>
                  <div class="pix-dim tiny">{am.annotProfileHint()}</div>
                {:else}
                  <div class="pix-dim tiny">{am.annotProfileEmpty()}</div>
                {/if}
              {:else if ann.kind === 'panelbar'}
                <label class="field">
                  <span>{m.annotCalibrationPanel()}</span>
                  <select
                    class="pix-select"
                    value={ann.panelId}
                    onchange={(event) =>
                      withCommit(() => {
                        ann.panelId = stringFrom(event);
                      })}
                  >
                    {#each project.panels as panel, index (panel.id)}
                      <option value={panel.id}>
                        {panelLabel(index, project.layout.labelStyle)} · {panel.name}
                      </option>
                    {/each}
                  </select>
                </label>
                <div class="grid2">
                  <label class="field">
                    <span>{m.annotValue()}</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.001"
                      step="any"
                      value={ann.value}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.value = Math.max(0.001, value)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotUnit()}</span>
                    <select
                      class="pix-select"
                      value={ann.unit}
                      onchange={(event) => setBarUnit(ann, stringFrom(event) as Unit)}
                    >
                      <option value="um">µm</option>
                      <option value="mm">mm</option>
                      <option value="nm">nm</option>
                      <option value="px">px</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>{m.annotPositionX()} (%)</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={percentValue(ann.nx)}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.nx = clamp(value / 100, 0, 1)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotPositionY()} (%)</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={percentValue(ann.ny)}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.ny = clamp(value / 100, 0, 1)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotBarThickness()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="0.25"
                      max="16"
                      step="0.25"
                      value={ann.thicknessPt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.thicknessPt = clamp(value, 0.25, 16)))}
                    />
                  </label>
                  <label class="field">
                    <span>{m.annotFontSize()} ({m.annotPt()})</span>
                    <input
                      class="pix-input"
                      type="number"
                      min="4"
                      max="48"
                      step="0.5"
                      value={ann.fontSizePt}
                      onchange={(event) =>
                        applyNumber(event, (value) => (ann.fontSizePt = clamp(value, 4, 48)))}
                    />
                  </label>
                </div>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={ann.showLabel}
                    onchange={(event) =>
                      withCommit(() => {
                        ann.showLabel = checkedFrom(event);
                      })}
                  />
                  {m.annotShowLabel()}
                </label>
                <div class="field">
                  <span>{m.annotBarLength()}</span>
                  <div class="readout">{barLengthText(ann)}</div>
                </div>
                {#if !barLayout(ann, geom)}
                  <div class="warn-text tiny">{m.annotNeedsCalibration()}</div>
                {/if}
              {/if}

              <label class="field color-field">
                <span>{m.annotColor()}</span>
                <input
                  class="pix-color"
                  type="color"
                  value={ann.color}
                  oninput={(event) => {
                    ann.color = stringFrom(event);
                  }}
                  onfocus={beginGesture}
                  onblur={endGesture}
                />
              </label>

              <div class="btn-row">
                <button class="pix-btn tiny-btn" onclick={() => duplicateAnnotationById(ann.id)}>
                  <Copy size={10} /> {m.annotDuplicateAnn()}
                </button>
                <button class="pix-btn tiny-btn danger" onclick={() => deleteAnnotationById(ann.id)}>
                  <Trash2 size={10} /> {m.annotDeleteAnn()}
                </button>
              </div>
            </div>
          {/if}
        </div>
      </details>

      <details>
        <summary><Download size={11} /> {m.annotExportSection()}</summary>
        <div class="sec-body">
          <label class="field">
            <span>{m.annotDpi()}</span>
            <select
              class="pix-select"
              value={project.layout.exportDpi}
              onchange={(event) => setLayout('exportDpi', stringFrom(event) === '600' ? 600 : 300)}
            >
              <option value="300">300</option>
              <option value="600">600</option>
            </select>
          </label>
          <div class="btn-grid">
            <button class="pix-btn ok" disabled={busy !== 'idle' || !project.panels.length} onclick={exportPng}>
              <Download size={11} /> {m.annotExportPng()}
            </button>
            <button class="pix-btn ok" disabled={busy !== 'idle' || !project.panels.length} onclick={exportSvg}>
              <Download size={11} /> {m.annotExportSvg()}
            </button>
            <button class="pix-btn" disabled={busy !== 'idle'} onclick={exportProjectJson}>
              <Save size={11} /> {m.annotExportJson()}
            </button>
            <button
              class="pix-btn"
              disabled={busy !== 'idle' || !annotateProfileAnnotations(project).length}
              onclick={exportProfilesCsv}
            >
              <Activity size={11} /> {am.annotProfileCsv()}
            </button>
            <button class="pix-btn accent" disabled={busy !== 'idle' || !project.panels.length} onclick={exportBundle}>
              <Package size={11} /> {am.annotBundleExport()}
            </button>
            <button class="pix-btn" disabled={busy !== 'idle'} onclick={() => jsonInput?.click()}>
              <FolderOpen size={11} /> {m.annotImportProject()}
            </button>
          </div>
          <div class="autosave-line">
            {#if autosaveState === 'saving'}
              <span class="pix-dim tiny">{m.annotAutosaveSaving()}</span>
            {:else if autosaveState === 'saved'}
              <span class="ok-text tiny"><Check size={10} /> {m.annotAutosaveSaved()} {savedAt}</span>
            {:else if autosaveState === 'failed'}
              <span class="warn-text tiny">{m.annotAutosaveFailed()}</span>
            {:else}
              <span class="pix-dim tiny">{m.annotAutosaveOn()}</span>
            {/if}
          </div>
          {#if busy === 'bundle'}
            <div class="pix-dim tiny">{am.annotBundleBusy()}</div>
          {:else if busy !== 'idle'}
            <div class="pix-dim tiny">{m.annotExporting()}</div>
          {/if}
        </div>
      </details>
    </aside>
  </div>
</div>

<style>
  .annot-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow: hidden;
    font-family: var(--pix-font);
    font-size: 10px;
  }
  .hidden-input { display: none; }

  .annot-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  .annot-toolbar .pix-btn {
    padding: 4px 8px;
    font-size: 9px;
  }
  .tool-btn .tool-text { font-size: 8.5px; }
  .tool-btn.active {
    border-color: var(--pix-cyan);
    color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.08);
    box-shadow: 0 0 8px rgba(76, 214, 255, 0.22);
  }
  .tool-btn.active:hover { color: #06202a; }
  .icon-only { min-width: 28px; padding: 4px 6px !important; }
  .spacer { flex: 1; }
  .dpi-pick {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--pix-fg-dim);
    font-size: 8.5px;
  }

  .pix-input,
  .pix-select {
    background: var(--pix-bg);
    color: var(--pix-fg);
    border: 2px solid var(--pix-border-hi);
    font-family: var(--pix-font);
  }
  .pix-input { font-size: 9.5px; padding: 2px 4px; }
  .pix-select { font-size: 9px; padding: 2px 4px; }
  textarea.pix-input { resize: vertical; min-height: 44px; line-height: 1.35; }

  .annot-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 8px;
  }

  .panel-list {
    width: 238px;
    min-width: 214px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    min-height: 0;
  }
  .panel-list.drop {
    outline: 2px dashed var(--pix-accent);
    outline-offset: -5px;
  }
  .side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .side-head span:first-child { display: inline-flex; align-items: center; gap: 4px; }
  .pix-btn.small,
  .pix-btn.tiny-btn {
    padding: 2px 6px;
    font-size: 8.5px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .panel-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
  }
  .panel-card {
    display: flex;
    gap: 6px;
    padding: 4px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
  }
  .panel-card.active {
    border-color: var(--pix-accent-2);
    box-shadow: inset 0 0 0 1px rgba(255, 210, 63, 0.25);
  }
  .thumb {
    position: relative;
    width: 64px;
    height: 64px;
    flex: none;
    padding: 0;
    border: 1px solid var(--pix-border-hi);
    background: #04060a;
    cursor: pointer;
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    image-rendering: auto;
  }
  .thumb-label {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 0 4px;
    background: rgba(0, 0, 0, 0.72);
    color: var(--pix-accent-2);
    font-size: 9px;
    font-weight: bold;
  }
  .panel-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .panel-name { height: 20px; font-size: 9px; }
  .panel-meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel-actions { display: flex; gap: 1px; align-items: center; }
  .empty-list { padding: 6px 2px; }
  .drop-hint {
    border-top: 1px dashed var(--pix-border);
    padding-top: 4px;
    line-height: 1.4;
  }

  .icon {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--pix-fg-dim);
    padding: 1px;
    display: inline-flex;
    align-items: center;
  }
  .icon:hover { color: var(--pix-fg); }
  .icon:disabled { opacity: 0.3; cursor: not-allowed; }
  .icon.danger { color: var(--pix-red); }

  .stage-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stage-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .zoom-tools { display: inline-flex; align-items: center; gap: 3px; }
  .zoom-tools .pix-btn { padding: 1px 5px; font-size: 8.5px; }
  .stage-scroll {
    flex: 1;
    min-height: 300px;
    overflow: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10px;
    border: 1px solid var(--pix-border);
    background: #04060a;
    scrollbar-color: var(--pix-border-hi) var(--pix-bg);
  }
  .stage-scroll.drop {
    outline: 2px dashed var(--pix-accent);
    outline-offset: -7px;
    background: rgba(255, 159, 28, 0.06);
  }
  .canvas-holder {
    margin: auto;
    flex: none;
    line-height: 0;
    box-shadow: 0 0 0 1px var(--pix-border-hi), 4px 4px 0 rgba(0, 0, 0, 0.55);
    background: #fff;
  }
  .canvas-holder canvas {
    display: block;
    touch-action: none;
    user-select: none;
  }
  .stage-empty {
    margin: auto;
    max-width: 420px;
    padding: 34px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border: 2px dashed var(--pix-border-hi);
    background: var(--pix-bg-2);
  }
  .empty-icon {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--pix-cyan);
    border: 2px solid var(--pix-cyan);
    background: rgba(76, 214, 255, 0.07);
    box-shadow: 0 0 18px rgba(76, 214, 255, 0.18);
  }
  .stage-empty h3 {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: var(--pix-fg);
    letter-spacing: 0.5px;
  }
  .stage-empty p {
    margin: 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--pix-fg-dim);
  }
  .stage-foot {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 8.5px;
  }
  .hint { color: var(--pix-accent-2); }

  .inspector {
    width: 332px;
    min-width: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
    min-height: 0;
  }
  details {
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  summary {
    cursor: pointer;
    padding: 5px 7px;
    font-weight: bold;
    color: var(--pix-accent-2);
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 5px;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  .sec-body {
    padding: 6px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--pix-fg-dim);
    font-size: 8.5px;
    min-width: 0;
  }
  .field > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px 7px;
  }
  .channel-row {
    display: grid;
    grid-template-columns: auto 1fr 34px auto;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    color: var(--pix-fg-dim);
  }
  .channel-row .check { white-space: nowrap; }
  .channel-gain { width: 100%; min-width: 40px; accent-color: var(--pix-cyan); }
  .channel-row output { text-align: right; font-family: var(--pix-mono, monospace); color: var(--pix-fg); }
  .profile-plot {
    width: 100%;
    height: 58px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
  }
  .color-field { justify-content: flex-end; }
  .pix-color {
    width: 100%;
    height: 24px;
    padding: 0;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg);
    cursor: pointer;
  }
  .sub-head {
    margin-top: 3px;
    padding-top: 5px;
    border-top: 1px dashed var(--pix-border);
    color: var(--pix-accent-2);
    font-size: 9px;
    font-weight: bold;
  }
  .btn-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .btn-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .btn-grid .pix-btn { font-size: 9px; padding: 4px 6px; }
  .range-row {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) 42px;
    align-items: center;
    gap: 6px;
    font-size: 8.5px;
    color: var(--pix-fg-dim);
  }
  .range-row input[type='range'] { width: 100%; }
  .range-row output {
    color: var(--pix-fg);
    font-weight: bold;
    font-size: 9px;
    text-align: right;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--pix-fg);
    font-size: 9px;
    cursor: pointer;
  }
  .cal-state {
    padding: 3px 5px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
    font-size: 9px;
    color: var(--pix-fg-dim);
  }
  .cal-state.ok {
    border-color: var(--pix-green);
    color: var(--pix-green);
  }
  .readout {
    min-height: 22px;
    display: flex;
    align-items: center;
    padding: 2px 5px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
    color: var(--pix-cyan);
    font-size: 9px;
  }
  .ann-list {
    max-height: 186px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
  }
  .ann-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid transparent;
    padding: 1px 2px;
  }
  .ann-row.active {
    border-color: var(--pix-accent-2);
    background: rgba(255, 210, 63, 0.06);
  }
  .ann-pick {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--pix-fg);
    font-size: 8.5px;
    padding: 2px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ann-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--pix-border);
    padding: 6px;
    background: var(--pix-bg-3);
  }
  .warn-text { color: var(--pix-accent); }
  .ok-text {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--pix-green);
  }
  .tiny { font-size: 8.5px; }
  .autosave-line {
    border-top: 1px dashed var(--pix-border);
    padding-top: 4px;
  }

  @media (max-width: 1240px) {
    .tool-btn .tool-text { display: none; }
  }
  @media (max-width: 1120px) {
    .annot-page { overflow-y: auto; }
    .annot-body { flex-wrap: wrap; overflow: visible; }
    .panel-list { width: 100%; min-width: 0; max-height: 228px; }
    .panel-scroll {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 2px;
    }
    .panel-card { min-width: 206px; }
    .stage-wrap { min-width: 100%; min-height: 54vh; }
    .inspector { width: 100%; min-width: 0; max-height: none; overflow: visible; }
  }
  @media (max-width: 720px) {
    .panel-list { max-height: 190px; }
    .annot-toolbar .pix-btn { font-size: 8.5px; padding: 3px 6px; }
    .stage-scroll { min-height: 240px; }
  }
</style>
