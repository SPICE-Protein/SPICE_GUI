<script lang="ts">
  // Gel figure editor: import exposures, straighten/crop, detect lanes and
  // bands, calibrate with a marker ladder, annotate on the figure and export
  // publication files. All processing happens locally in the webview.
  import { onMount, tick } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import {
    Upload, Download, Save, FolderOpen, Plus, Trash2, RotateCcw, RotateCw,
    FlipHorizontal, FlipVertical, Wand2, Crosshair, Eraser, Star, Eye, EyeOff,
    Undo2, Redo2, X, Square, Type, ArrowLeft, ArrowUp,
    Layers, Clock, FileText, Presentation, ScanLine, Package, SlidersHorizontal, Send
  } from 'lucide-svelte';
  import {
    emptyProject, activeExposure as activeExposureOf, newId, newLaneId,
    type GelProject, type GelLane, type GelExposure,
    type Annotation, type GelLayoutSettings, type LaneStyle
  } from './types';
  import {
    laddersFor, ladderById, unitForKind, normalizeSizes, type LadderDef
  } from './ladders';
  import { autoCropRect, robustFit, percentile } from './gelmath';
  import {
    detectLanesAuto, detectBandsInLane, detectGelType, identifyMarkers,
    estimateBandSizes
  } from './detect';
  import { cachedSignal, ensureSignal } from './native';
  import {
    DETECT_CHANNELS, DETECT_POLARITIES, DETECT_TYPE_MODES, presetById, presetChoices,
    sanitizeDetectConfig, type DetectChannel, type DetectPolarity, type DetectTypeMode
  } from './presets';
  import {
    decodeExposure, exposureScore, loadImageElement, renderProcessed,
    transformForFlip, transformForQuarterTurn, rotateProjectCoordinates,
    type ProcessedImage
  } from './pipeline';
  import { buildFigure, hitTest, type FigureLayout } from './figure';
  import { drawFigure, rasterizeFigure, figureToSvg, renderUncropped } from './render';
  import {
    exportPngWithMetadata, encodeTiff, makePptx, preflight, makeLog,
    summaryText, base64ToBytes, sha256Hex, type PreflightItem
  } from './export';
  import {
    loadSnapshot, saveSnapshot, listRecent, saveRecent, loadRecent, removeRecent,
    renameRecent, listStyles, saveStyle, removeStyle, loadLadderLibrary, saveLadderLibrary,
    detectConfigForNewImport, saveDetectDefault,
    type RecentEntry, type GelStyle
  } from './storage';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import ToolProjectBar from '$lib/tools/shared/ToolProjectBar.svelte';
  import { ensureProjectLoaded, takeToolHandoff, finishToolCapture } from '$lib/tools/shared/projectBridge';
  import { canvasPreview } from '$lib/tools/shared/preview';
  import { sendImageToFigure } from '$lib/tools/shared/figureBridge';
  import { saveReproBundle } from '$lib/repro/bundle';
  import { sanitizeGelProject, gelSummary, gelProjectPreview, gelParameters, gelCsv, gelMethods } from './projectDoc';
  import { g } from './messages';
  import GelBatch from './GelBatch.svelte';

  // ---------------------------------------------------------------- state

  let project = $state<GelProject>(emptyProject());
  let processed = $state.raw<ProcessedImage | null>(null);
  let layout = $state.raw<FigureLayout | null>(null);
  let imageEl = $state<HTMLImageElement | null>(null);

  let imageInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let ladderInput = $state<HTMLInputElement | null>(null);
  let sourceStage = $state<HTMLDivElement | null>(null);
  let figureWrap = $state<HTMLDivElement | null>(null);
  let sourceCanvas = $state<HTMLCanvasElement | null>(null);
  let sourceOverlay = $state<HTMLCanvasElement | null>(null);
  let figureCanvas = $state<HTMLCanvasElement | null>(null);
  let nameInput = $state<HTMLInputElement | null>(null);

  let busy = $state('');
  let exportDpi = $state(300);
  let showGrid = $state(false);
  let linkGuides = $state(true);
  let figScale = $state(1);
  let sourceZoom = $state(1);
  let selectedLaneId = $state<string | null>(null);
  let selectedBand = $state<{ laneId: string; index: number } | null>(null);
  let selectedAnnotationId = $state<string | null>(null);
  let editingLane = $state<{ id: string; value: string; x: number; y: number; w: number } | null>(null);
  let preflightItems = $state<PreflightItem[]>([]);
  let typeReasons = $state<string[]>([]);
  let detectStale = $state(false);
  let confirmRedetect = $state(false);
  let recents = $state<RecentEntry[]>([]);
  let styles = $state<GelStyle[]>([]);
  let recentEdit = $state<{ id: string; name: string } | null>(null);
  let styleName = $state('');
  let importMode: 'replace' | 'append' = 'replace';
  let customName = $state('');
  let customSizes = $state('');
  let bulkNames = $state('');
  let drag: {
    type: 'lane' | 'crop' | 'band';
    laneId?: string;
    index?: number;
    edge?: 'left' | 'right' | 'top' | 'bottom';
    pointerId?: number;
  } | null = null;
  let nameDrag: { from: string; moved: boolean; x0: number; y0: number } | null = null;
  let annotationDrag: {
    id: string;
    type: 'box' | 'sideText';
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null = null;

  let history: string[] = [];
  let future: string[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let lastCheckpoint = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let quotaWarned = false;
  let refreshRaf: number | null = null;
  let generation = 0;
  // SPICE_PROJECT bridge: suppress write-back while a handoff payload is
  // being decoded, and remember the last revision committed to the store.
  let handoffLoading = $state(true);
  let lastCommittedRevision = '';

  const exposure = $derived(activeExposureOf(project));
  const hasImage = $derived(!!exposure);
  const ladderOptions = $derived(
    [...laddersFor(project.gelType, project.customLadders)].sort((a, b) => {
      const fa = project.favorites.includes(a.id) ? 1 : 0;
      const fb = project.favorites.includes(b.id) ? 1 : 0;
      return fb - fa || a.name.localeCompare(b.name);
    }),
  );
  const selectedAnnotation = $derived(project.annotations.find((a) => a.id === selectedAnnotationId) ?? null);
  const selectedLane = $derived(project.lanes.find((l) => l.id === selectedLaneId) ?? null);
  const selectedBandRef = $derived.by(() => {
    if (!selectedBand) return null;
    const lane = project.lanes.find((l) => l.id === selectedBand!.laneId);
    const band = lane?.bands[selectedBand.index];
    return lane && band ? { lane, band, index: selectedBand.index } : null;
  });
  const emptyLaneCount = $derived(project.lanes.filter((l) => !l.removed && l.bands.length === 0).length);

  /** Change token that excludes the (potentially multi-megabyte) image data
   *  URLs, so write-back does not stringify them on every slider tick. */
  function projectRevision(): string {
    const exposures = project.exposures
      .map((e) => `${e.id}:${e.name}:${e.width}x${e.height}:${e.mime}:${e.sha256 ?? ''}`)
      .join('|');
    return `${JSON.stringify({ ...project, exposures: [] })}#${exposures}`;
  }

  // Keep the open SPICE_PROJECT document in sync with the live editor state.
  // Debounced so dragging a slider produces one write, and suppressed while a
  // handoff payload is being loaded.
  $effect(() => {
    if (handoffLoading) return;
    if (projectStore.activeDocKind !== 'gel') return;
    const revision = projectRevision();
    if (revision === lastCommittedRevision) return;
    const timer = setTimeout(() => {
      if (projectStore.activeDocKind !== 'gel') return;
      lastCommittedRevision = revision;
      projectStore.commitDoc('gel', plainClone(project));
    }, 350);
    return () => clearTimeout(timer);
  });

  // ------------------------------------------------------------- lifecycle

  onMount(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__gelDebug = {
        project: () => project,
        layout: () => layout,
        processed: () => processed,
      };
    }
    recents = listRecent();
    styles = listStyles();
    ensureProjectLoaded();
    const handoff = takeToolHandoff('gel');
    if (handoff?.type === 'open') {
      // The hub opened a stored gel document: the handoff payload wins over
      // the local snapshot and is validated through the tool's own schema.
      const next = sanitizeGelProject(handoff.payload);
      if (next) {
        project = next;
        selectedLaneId = null;
        selectedBand = null;
        selectedAnnotationId = null;
        applyLadderLibrary();
        schedulePersist();
        void (async () => {
          try {
            await loadActiveImage();
            toast(true, m.gelProjectOpened());
          } catch (err) {
            toast(false, err instanceof Error ? err.message : String(err));
          } finally {
            lastCommittedRevision = projectRevision();
            handoffLoading = false;
          }
        })();
      } else {
        // Do not write the fallback snapshot into a document that failed to
        // load; detach the active doc and keep editing locally.
        toast(false, m.gelProjectInvalid());
        projectStore.activeDocId = null;
        hydrateFromSnapshot();
        handoffLoading = false;
      }
    } else {
      hydrateFromSnapshot();
      handoffLoading = false;
      if (handoff?.type === 'capture') void captureToProject();
    }
    const ro = new ResizeObserver(() => {
      drawSource();
      drawFigurePreview();
    });
    if (sourceStage) ro.observe(sourceStage);
    if (figureWrap) ro.observe(figureWrap);
    window.addEventListener('keydown', onKeydown);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKeydown);
    };
  });

  /** Restore the tool snapshot and merge the browser ladder library. */
  function hydrateFromSnapshot() {
    const snap = loadSnapshot();
    if (snap) {
      project = snap;
      void loadActiveImage();
    }
    applyLadderLibrary();
  }

  function applyLadderLibrary() {
    const library = loadLadderLibrary();
    if (!library.custom.length) return;
    const ids = new Set(project.customLadders.map((l) => l.id));
    project.customLadders = [...project.customLadders, ...library.custom.filter((l) => !ids.has(l.id))];
    project.favorites = [...new Set([...project.favorites, ...library.favorites])];
  }

  // ---------------------------------------------------- SPICE_PROJECT bridge

  function projectPayload(): GelProject {
    return plainClone(project);
  }

  function projectName(): string {
    return project.imageName || m.toolsGelTitle();
  }

  function projectSummary(): string {
    return gelSummary(project);
  }

  /** Thumbnail for the project hub: current figure when possible, otherwise a
   *  fresh render from the stored project. */
  async function projectPreview(): Promise<string | null> {
    if (processed && layout) {
      try {
        return canvasPreview(rasterizeFigure(layout, processed.canvas, 96)) || null;
      } catch {
        /* fall through to a fresh render */
      }
    }
    return gelProjectPreview(project);
  }

  /** Handoff from the project hub: store the current editor state as a doc. */
  async function captureToProject() {
    if (!projectStore.hasOpenProject || !hasImage) {
      handoffLoading = false;
      return;
    }
    try {
      const payload = plainClone(project);
      const preview = await projectPreview();
      const id = finishToolCapture('gel', projectName(), payload, preview ?? undefined, gelSummary(project));
      if (!id) handoffLoading = false;
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
      handoffLoading = false;
    }
  }

  async function loadActiveImage() {
    const exp = activeExposureOf(project);
    if (!exp) {
      imageEl = null;
      processed = null;
      layout = null;
      drawSource();
      return;
    }
    imageEl = await loadImageElement(exp.dataUrl);
    await refreshProcessed();
  }

  // --------------------------------------------------------------- pipeline

  async function refreshProcessed() {
    const gen = ++generation;
    const exp = activeExposureOf(project);
    if (!exp) {
      processed = null;
      layout = null;
      drawSource();
      return;
    }
    if (!imageEl || imageEl.src !== exp.dataUrl) imageEl = await loadImageElement(exp.dataUrl);
    if (gen !== generation) return;
    processed = renderProcessed(exp, project, imageEl);
    if (gen !== generation) return;
    await tick();
    drawSource();
    rebuildFigure();
  }

  function rebuildFigure() {
    if (!processed) {
      layout = null;
      preflightItems = [];
      return;
    }
    layout = buildFigure(project, processed.canvas);
    preflightItems = preflight(project, layout, processed.canvas, processed.rawGray, processed.gray);
    void tick().then(() => drawFigurePreview());
  }

  function schedulePixels() {
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(() => void refreshProcessed());
  }

  function scheduleLayout() {
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(() => {
      rebuildFigure();
      drawSource();
    });
  }

  function drawSource() {
    if (!processed || !sourceCanvas || !sourceOverlay || !sourceStage) return;
    const availW = Math.max(200, sourceStage.clientWidth - 16);
    const availH = Math.max(220, sourceStage.clientHeight - 16);
    const fit = Math.min(availW / processed.width, availH / processed.height, 1);
    const scale = fit * sourceZoom;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.round(processed.width * scale);
    const cssH = Math.round(processed.height * scale);
    for (const c of [sourceCanvas, sourceOverlay]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    const ctx = sourceCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(processed.canvas, 0, 0, cssW, cssH);
    drawSourceOverlay(cssW, cssH, dpr);
  }

  function drawSourceOverlay(cssW: number, cssH: number, dpr: number) {
    if (!sourceOverlay) return;
    const ctx = sourceOverlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,159,28,0.25)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo((cssW * i) / 10, 0);
        ctx.lineTo((cssW * i) / 10, cssH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, (cssH * i) / 10);
        ctx.lineTo(cssW, (cssH * i) / 10);
        ctx.stroke();
      }
    }
    const c = project.crop;
    const x0 = c.left * cssW;
    const y0 = c.top * cssH;
    const x1 = (1 - c.right) * cssW;
    const y1 = (1 - c.bottom) * cssH;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, cssW, y0);
    ctx.fillRect(0, y1, cssW, cssH - y1);
    ctx.fillRect(0, y0, x0, y1 - y0);
    ctx.fillRect(x1, y0, cssW - x1, y1 - y0);
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // Resize grips.
    ctx.fillStyle = '#ff9f1c';
    for (const [gx, gy] of [
      [x0, y0], [x1, y0], [x0, y1], [x1, y1],
      [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2],
    ]) {
      ctx.fillRect(gx - 3, gy - 3, 6, 6);
    }
    for (const lane of project.lanes) {
      const x = lane.x * cssW;
      const selected = lane.id === selectedLaneId;
      ctx.strokeStyle = lane.removed ? 'rgba(255,80,80,0.9)' : selected ? '#ff9f1c' : 'rgba(76,214,255,0.75)';
      ctx.lineWidth = selected ? 1.8 : 1;
      ctx.setLineDash(lane.isMarker ? [] : [5, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px monospace';
      ctx.fillText(lane.name || '—', x + 3, 11);
      for (const [index, band] of lane.bands.entries()) {
        const y = band.y * cssH;
        ctx.beginPath();
        ctx.arc(x, y, selectedBand?.laneId === lane.id && selectedBand.index === index ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = band.showSize ? 'rgba(255,159,28,0.95)' : 'rgba(107,231,122,0.85)';
        ctx.fill();
      }
    }
  }

  function drawFigurePreview() {
    if (!layout || !figureCanvas || !processed || !figureWrap) return;
    const availW = Math.max(220, figureWrap.clientWidth - 20);
    const availH = Math.max(220, figureWrap.clientHeight - 20);
    const fitted = Math.min(1.4, Math.max(0.2, Math.min(availW / layout.width, availH / layout.height)));
    figScale = fitted;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    figureCanvas.width = Math.round(layout.width * fitted * dpr);
    figureCanvas.height = Math.round(layout.height * fitted * dpr);
    figureCanvas.style.width = `${Math.round(layout.width * fitted)}px`;
    figureCanvas.style.height = `${Math.round(layout.height * fitted)}px`;
    const ctx = figureCanvas.getContext('2d')!;
    drawFigure(ctx, layout, processed.canvas, fitted * dpr);
  }

  // ------------------------------------------------------------- history/io

  function checkpoint(force = false) {
    const now = Date.now();
    if (!force && now - lastCheckpoint < 650) return;
    history.push(JSON.stringify(project));
    if (history.length > 80) history.shift();
    future = [];
    lastCheckpoint = now;
    canUndo = true;
    canRedo = false;
  }

  function commit(fn: () => void, opts: { pixels?: boolean } = {}) {
    checkpoint();
    fn();
    project.updatedAt = new Date().toISOString();
    if (opts.pixels) schedulePixels();
    else scheduleLayout();
    schedulePersist();
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    future.push(JSON.stringify(project));
    project = JSON.parse(prev) as GelProject;
    canUndo = history.length > 0;
    canRedo = true;
    schedulePersist();
    void loadActiveImage();
  }

  function redo() {
    const next = future.pop();
    if (!next) return;
    history.push(JSON.stringify(project));
    project = JSON.parse(next) as GelProject;
    canUndo = true;
    canRedo = future.length > 0;
    schedulePersist();
    void loadActiveImage();
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!saveSnapshot(project) && !quotaWarned) {
        quotaWarned = true;
        pushToast('error', m.gelTitle(), m.gelQuotaWarn());
      }
    }, 800);
  }

  function toast(ok: boolean, msg: string) {
    pushToast(ok ? 'success' : 'error', m.gelTitle(), msg);
  }

  async function saveBytes(name: string, bytes: Uint8Array, okMsg: string) {
    try {
      const res = await backend.saveExport(name, bytes);
      if (res.data?.saved) {
        toast(true, okMsg);
        return true;
      }
      return false;
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function saveText(name: string, text: string, okMsg: string) {
    try {
      const res = await backend.saveExport(name, text);
      if (res.data?.saved) {
        toast(true, okMsg);
        return true;
      }
      return false;
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  function projectBase(): string {
    return (project.imageName || 'gel').replace(/\.[^.]+$/, '');
  }

  // ---------------------------------------------------------------- import

  async function onPickImages(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    const mode = importMode;
    importMode = 'replace';
    await importFiles([...files], mode);
    if (imageInput) imageInput.value = '';
  }

  function openImagePicker(mode: 'replace' | 'append') {
    importMode = mode;
    imageInput?.click();
  }

  async function importFiles(files: File[], mode: 'replace' | 'append' = 'replace') {
    const allowed = files.filter((f) => /image\//.test(f.type) || /\.(tiff?|png|jpe?g|bmp|webp|gif)$/i.test(f.name));
    if (!allowed.length) return;
    busy = m.gelBusyImport();
    try {
      if (project.exposures.length) saveRecent(project);
      const decoded: GelExposure[] = [];
      for (const file of allowed) decoded.push(await decodeExposure(file));
      const scores: number[] = [];
      for (const exp of decoded) {
        const img = await loadImageElement(exp.dataUrl);
        scores.push(exposureScore(renderProcessed(exp, { ...project, rotation: 0, orient: 0, mirrorH: false, mirrorV: false, display: 'gray' }, img)));
      }
      const best = scores.indexOf(Math.max(...scores));
      if (mode === 'append' && project.exposures.length) {
        // Another exposure of the same gel: keep lanes, annotations and fit,
        // then show the best frame of all exposures.
        project.exposures = [...project.exposures, ...decoded];
        let bestId = decoded[best].id;
        let bestScore = -Infinity;
        for (const exp of project.exposures) {
          try {
            const img = await loadImageElement(exp.dataUrl);
            const score = exposureScore(
              renderProcessed(exp, { ...project, rotation: 0, orient: 0, mirrorH: false, mirrorV: false, display: 'gray' }, img),
            );
            if (score > bestScore) {
              bestScore = score;
              bestId = exp.id;
            }
          } catch {
            /* keep the previous candidate */
          }
        }
        project.activeExposureId = bestId;
        project.imageName = project.exposures.find((e) => e.id === bestId)?.name ?? decoded[best].name;
        await loadActiveImage();
        schedulePersist();
        return;
      }
      if (project.exposures.length) saveRecent(project);
      project = {
        ...emptyProject(),
        layout: project.layout,
        customLadders: project.customLadders,
        favorites: project.favorites,
        detect: detectConfigForNewImport(),
        exposures: decoded,
        activeExposureId: decoded[best].id,
        imageName: decoded[best].name,
      };
      recents = listRecent();
      await loadActiveImage();
      await autoDraft();
      schedulePersist();
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    } finally {
      busy = '';
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    const projectFile = files.find((f) => /\.(json|gelfig)$/i.test(f.name));
    if (projectFile) {
      await openProjectFile(projectFile);
      return;
    }
    await importFiles(files);
  }

  async function setExposure(id: string) {
    checkpoint();
    project.activeExposureId = id;
    project.imageName = activeExposureOf(project)?.name ?? project.imageName;
    await loadActiveImage();
    schedulePersist();
  }

  function removeExposure(id: string) {
    if (project.exposures.length <= 1) return;
    checkpoint();
    const remaining = project.exposures.filter((e) => e.id !== id);
    project.exposures = remaining;
    if (project.activeExposureId === id) project.activeExposureId = remaining[0].id;
    void loadActiveImage();
    schedulePersist();
  }

  // ------------------------------------------------------------- detection

  function baseOrientedCanvas(): HTMLCanvasElement | null {
    if (!imageEl) return null;
    const img = imageEl;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const orient = ((project.orient % 4) + 4) % 4;
    const swap = orient % 2 === 1;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((orient * Math.PI) / 2);
    ctx.scale(project.mirrorH ? -1 : 1, project.mirrorV ? -1 : 1);
    ctx.drawImage(img, -w / 2, -h / 2);
    return canvas;
  }

  function bestStraightenAngle(): number {
    const base = baseOrientedCanvas();
    if (!base) return 0;
    const maxSide = 300;
    const scale = maxSide / Math.max(base.width, base.height);
    const small = document.createElement('canvas');
    small.width = Math.max(8, Math.round(base.width * scale));
    small.height = Math.max(8, Math.round(base.height * scale));
    small.getContext('2d')!.drawImage(base, 0, 0, small.width, small.height);
    const scoreAt = (deg: number): number => {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const w = Math.round(small.width * cos + small.height * sin);
      const h = Math.round(small.width * sin + small.height * cos);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rad);
      ctx.drawImage(small, -small.width / 2, -small.height / 2);
      const data = ctx.getImageData(0, 0, w, h).data;
      let prev = 0;
      let score = 0;
      const row = new Float32Array(w);
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        const mean = sum / w / 255;
        if (y > 0) score += (mean - prev) ** 2;
        prev = mean;
        void row;
      }
      return score;
    };
    let best = 0;
    let bestScore = -Infinity;
    for (let a = -15; a <= 15.0001; a += 0.5) {
      const s = scoreAt(a);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    let fine = best;
    for (let a = best - 0.4; a <= best + 0.4001; a += 0.1) {
      const s = scoreAt(a);
      if (s > bestScore) {
        bestScore = s;
        fine = a;
      }
    }
    return Math.round(fine * 10) / 10;
  }

  /** Run lanes, type and bands on the current processed plane. The caller owns
   *  checkpoint, busy state and the final figure rebuild. */
  async function runDetection(proc: ProcessedImage) {
    const config = project.detect;
    const gray = proc.detectGray;
    await ensureSignal(gray, proc.width, proc.height, config);
    // A preset may force the kind; otherwise vote from a DNA pass first, then
    // re-run with the verdict so a restored label cannot pick the wrong path.
    const forced = config.type;
    const proteinPass = forced === 'protein';
    let preliminary = detectLanesAuto(gray, proc.width, proc.height, proteinPass, config);
    const preliminaryBands = preliminary.map((lane) =>
      detectBandsInLane(
        gray,
        proc.width,
        proc.height,
        lane,
        forced === 'auto' ? 'dna' : forced,
        config,
      ),
    );
    if (forced === 'auto') {
      const bandCounts = preliminaryBands.map((b) => b.length);
      const maxBands = bandCounts.length ? Math.max(...bandCounts) : 0;
      const widths = preliminaryBands.flat().map((b) => b.width).sort((a, b) => a - b);
      const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
      const ctx = proc.canvas.getContext('2d', { willReadFrequently: true })!;
      // The processed canvas is grayscale (that is what detection needs), so
      // take the type vote from a colour render of the same exposure. Both
      // renders share the rotation/orientation, so the mask lines up.
      let rgba = ctx.getImageData(0, 0, proc.width, proc.height).data;
      const exp = activeExposureOf(project);
      if (exp && imageEl) {
        try {
          const color = renderProcessed(exp, { ...project, display: 'color' }, imageEl).canvas;
          rgba = color
            .getContext('2d', { willReadFrequently: true })!
            .getImageData(0, 0, proc.width, proc.height).data;
        } catch {
          // Fall back to the grayscale plane; the width/density vote still runs.
        }
      }
      const mask = cachedSignal(gray, proc.width, proc.height, config) ?? undefined;
      const guess = detectGelType(rgba, maxBands, preliminary.length, medianWidth, mask);
      typeReasons = guess.reasons;
      // Keep the user's chosen ladder when the verdict did not change; only a
      // kind switch needs a ladder of the new kind.
      if (project.gelType !== guess.kind) {
        project.gelType = guess.kind;
        project.unit = unitForKind(guess.kind);
        project.ladderId = laddersFor(guess.kind, project.customLadders)[0]?.id ?? project.ladderId;
        project.fit = null;
      }
      if (guess.kind === 'protein' && !proteinPass) {
        preliminary = detectLanesAuto(gray, proc.width, proc.height, true, config);
      }
    } else {
      typeReasons = [];
      if (project.gelType !== forced) {
        project.gelType = forced;
        project.unit = unitForKind(forced);
        project.ladderId = laddersFor(forced, project.customLadders)[0]?.id ?? project.ladderId;
        project.fit = null;
      }
    }
    const oldLanes = [...project.lanes];
    project.lanes = preliminary.map((d, i) => ({
      id: newLaneId(),
      x: d.x,
      width: d.width,
      name: oldLanes.sort((a, b) => a.x - b.x)[i]?.name ?? String(i + 1),
      isMarker: false,
      bands: [],
    }));
    remapLaneReferences(oldLanes);
    await detectBandsAll(false);
    detectMarkers(false);
    detectStale = false;
  }

  async function autoDraft() {
    if (!processed) return;
    busy = m.gelBusyAuto();
    checkpoint(true);
    try {
      project.rotation = bestStraightenAngle();
      await refreshProcessed();
      if (!processed) return;
      const proc = processed;
      project.crop = autoCropRect(proc.gray, proc.width, proc.height);
      await runDetection(proc);
      rebuildFigure();
      schedulePersist();
    } finally {
      busy = '';
    }
  }

  function setRotation(next: number) {
    const clamped = Math.max(-45, Math.min(45, next));
    if (Math.abs(clamped - project.rotation) < 0.001) return;
    if (imageEl) {
      rotateProjectCoordinates(project, project.rotation, clamped, imageEl.naturalWidth, imageEl.naturalHeight);
    }
    project.rotation = clamped;
    schedulePixels();
    schedulePersist();
  }

  async function straighten() {
    busy = m.gelBusyStraighten();
    await tick();
    const old = project.rotation;
    const next = bestStraightenAngle();
    if (Math.abs(next - old) < 0.05) {
      busy = '';
      return;
    }
    checkpoint();
    if (imageEl) {
      rotateProjectCoordinates(project, old, next, imageEl.naturalWidth, imageEl.naturalHeight);
    }
    project.rotation = next;
    await refreshProcessed();
    busy = '';
    schedulePersist();
  }

  function autoCrop() {
    if (!processed) return;
    commit(() => {
      project.crop = autoCropRect(processed!.gray, processed!.width, processed!.height);
    });
  }

  /** Keep annotations, conditions and groups attached when lane ids change. */
  function remapLaneReferences(oldLanes: GelLane[]) {
    const before = [...oldLanes].sort((a, b) => a.x - b.x);
    const after = [...project.lanes].sort((a, b) => a.x - b.x);
    const map = new Map<string, string>();
    before.forEach((lane, i) => {
      if (after[i]) map.set(lane.id, after[i].id);
    });
    project.annotations = project.annotations.map((a) => {
      if (!('laneId' in a)) return a;
      const next = map.get(a.laneId);
      return next ? { ...a, laneId: next } : a;
    });
    project.conditionRows = project.conditionRows.map((row) => {
      const cells: Record<string, string> = {};
      for (const [id, v] of Object.entries(row.cells)) {
        const next = map.get(id);
        if (next) cells[next] = v;
      }
      return { ...row, cells };
    });
    project.groups = project.groups.map((g) => ({
      ...g,
      laneIds: g.laneIds.map((id) => map.get(id) ?? id).filter((id) => project.lanes.some((l) => l.id === id)),
    }));
  }

  function applyLaneDetection(found: { x: number; width: number }[], keepNames = false) {
    const old = [...project.lanes].sort((a, b) => a.x - b.x);
    project.lanes = found.map((d, i) => {
      const prior = keepNames ? old[i] : undefined;
      return {
        id: newLaneId(),
        x: d.x,
        width: d.width,
        name: prior?.name ?? String(i + 1),
        isMarker: prior?.isMarker ?? false,
        ladderId: prior?.ladderId,
        bands: [],
      };
    });
    project.fit = null;
    selectedLaneId = null;
    selectedBand = null;
    remapLaneReferences(old);
  }

  async function autoLanes() {
    if (!processed) return;
    const config = project.detect;
    await ensureSignal(processed.detectGray, processed.width, processed.height, config);
    const found = detectLanesAuto(
      processed.detectGray,
      processed.width,
      processed.height,
      project.gelType === 'protein',
      config,
    );
    if (!found.length) {
      toast(false, m.gelLanesEmpty());
      return;
    }
    commit(() => {
      applyLaneDetection(found, false);
      for (const lane of project.lanes) lane.bands = detectBandsInLane(processed!.detectGray, processed!.width, processed!.height, lane, project.gelType, config).map((p) => ({
        y: p.y,
        intensity: p.intensity,
        showSize: true,
      }));
    });
    toast(true, m.gelLanesFound({ n: found.length }));
  }

  async function reDetectInCrop() {
    if (!processed) return;
    const c = project.crop;
    const x0 = Math.round(c.left * processed.width);
    const x1 = Math.round((1 - c.right) * processed.width);
    const y0 = Math.round(c.top * processed.height);
    const y1 = Math.round((1 - c.bottom) * processed.height);
    const config = project.detect;
    const sub = new Float32Array((x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) sub[(y - y0) * (x1 - x0) + (x - x0)] = processed.detectGray[y * processed.width + x];
    }
    await ensureSignal(sub, x1 - x0, y1 - y0, config);
    await ensureSignal(processed.detectGray, processed.width, processed.height, config);
    const found = detectLanesAuto(sub, x1 - x0, y1 - y0, project.gelType === 'protein', config).map((d) => ({
      x: (x0 + d.x * (x1 - x0)) / processed!.width,
      width: (d.width * (x1 - x0)) / processed!.width,
    }));
    if (!found.length) {
      toast(false, m.gelLanesEmpty());
      return;
    }
    commit(() => {
      applyLaneDetection(found, true);
      for (const lane of project.lanes) lane.bands = detectBandsInLane(processed!.detectGray, processed!.width, processed!.height, lane, project.gelType, config).map((p) => ({
        y: p.y,
        intensity: p.intensity,
        showSize: true,
      }));
    });
    toast(true, m.gelLanesFound({ n: found.length }));
  }

  function addLane() {
    if (!processed) return;
    commit(() => {
      const lane: GelLane = {
        id: newLaneId(),
        x: 0.5,
        width: 0.04,
        name: String(project.lanes.length + 1),
        isMarker: false,
        bands: [],
      };
      project.lanes = [...project.lanes, lane];
      selectedLaneId = lane.id;
    });
  }

  function removeLane(id: string) {
    commit(() => {
      project.lanes = project.lanes.filter((l) => l.id !== id);
      project.groups = project.groups
        .map((g) => ({ ...g, laneIds: g.laneIds.filter((x) => x !== id) }))
        .filter((g) => g.laneIds.length > 0);
      project.conditionRows = project.conditionRows.map((row) => {
        const cells = { ...row.cells };
        delete cells[id];
        return { ...row, cells };
      });
      project.annotations = project.annotations.filter((a) => !('laneId' in a && a.laneId === id));
      if (selectedLaneId === id) selectedLaneId = null;
    });
  }

  function toggleSplice(lane: GelLane) {
    commit(() => {
      lane.removed = !lane.removed;
      lane.splice = lane.removed ? (lane.splice && lane.splice !== 'none' ? lane.splice : 'gap') : 'none';
    });
  }

  function restoreLane(lane: GelLane) {
    commit(() => {
      lane.removed = false;
      lane.splice = 'none';
    });
  }

  function setLaneCount(count: number) {
    if (!processed || count < 1 || count > 60) return;
    commit(() => {
      const sorted = [...project.lanes].sort((a, b) => a.x - b.x);
      const firstX = sorted[0]?.x ?? project.crop.left + 0.05;
      const lastX = sorted[sorted.length - 1]?.x ?? 1 - project.crop.right - 0.05;
      const width = sorted[0]?.width ?? 0.04;
      const next: GelLane[] = [];
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const prior = sorted[i];
        next.push({
          id: prior?.id ?? newLaneId(),
          x: count === 1 ? 0.5 : firstX + (lastX - firstX) * t,
          width: prior?.width ?? width,
          name: prior?.name ?? String(i + 1),
          isMarker: prior?.isMarker ?? false,
          ladderId: prior?.ladderId,
          bands: prior?.bands ?? [],
          removed: prior?.removed,
          splice: prior?.splice,
          style: prior?.style,
        });
      }
      project.lanes = next;
      const keep = new Set(next.map((l) => l.id));
      project.groups = project.groups
        .map((g) => ({ ...g, laneIds: g.laneIds.filter((id) => keep.has(id)) }))
        .filter((g) => g.laneIds.length > 0);
      project.conditionRows = project.conditionRows.map((row) => ({
        ...row,
        cells: Object.fromEntries(Object.entries(row.cells).filter(([id]) => keep.has(id))),
      }));
      project.annotations = project.annotations.filter((a) => !('laneId' in a) || keep.has(a.laneId));
    });
  }

  function nudgeLane(id: string, delta: number) {
    const lane = project.lanes.find((l) => l.id === id);
    if (!lane) return;
    commit(() => {
      lane.x = Math.min(0.995, Math.max(0.005, lane.x + delta));
    });
  }

  function setLaneStyle(patch: Partial<LaneStyle>) {
    const lane = project.lanes.find((l) => l.id === selectedLaneId);
    if (!lane) return;
    commit(() => {
      lane.style = { ...lane.style, ...patch };
    });
  }

  function updateSelectedBand(patch: { size?: number; showSize?: boolean; hidden?: boolean; manual?: boolean; approx?: boolean }) {
    const ref = selectedBandRef;
    if (!ref) return;
    commit(() => {
      Object.assign(ref.band, patch);
    });
  }

  function deleteSelectedBand() {
    const ref = selectedBandRef;
    if (!ref) return;
    commit(() => {
      ref.lane.bands.splice(ref.index, 1);
      selectedBand = null;
    });
    if (project.fit) fitCurrentMarkers();
  }

  function removeEmptyLanes() {
    commit(() => {
      for (const lane of project.lanes) {
        if (!lane.removed && lane.bands.length === 0) {
          lane.removed = true;
          lane.splice = 'gap';
        }
      }
    });
  }

  function exportLadderLibrary() {
    const data = JSON.stringify({ version: 1, custom: project.customLadders, favorites: project.favorites }, null, 2);
    void saveText(`${projectBase()}_ladders.json`, data, m.gelLadderExported());
  }

  async function onPickLadderLibrary(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (ladderInput) ladderInput.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { version?: number; custom?: LadderDef[]; favorites?: string[] };
      if (parsed?.version !== 1 || !Array.isArray(parsed.custom)) throw new Error(m.gelLadderImportInvalid());
      const valid = parsed.custom.filter((l) => l && typeof l.id === 'string' && Array.isArray(l.sizes) && l.sizes.length >= 2);
      if (!valid.length) throw new Error(m.gelLadderImportInvalid());
      commit(() => {
        const ids = new Set(project.customLadders.map((l) => l.id));
        project.customLadders = [...project.customLadders, ...valid.filter((l) => !ids.has(l.id)).map((l) => ({ ...l, kind: project.gelType, custom: true }))];
        project.favorites = [...new Set([...project.favorites, ...(parsed.favorites ?? [])])];
      });
      saveLadderLibrary(project.customLadders, project.favorites);
      toast(true, m.gelLadderImported({ n: valid.length }));
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  function redistributeFromEnds() {
    const sorted = [...project.lanes].sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return;
    commit(() => {
      const first = sorted[0].x;
      const last = sorted[sorted.length - 1].x;
      sorted.forEach((lane, i) => {
        if (i === 0 || i === sorted.length - 1) return;
        lane.x = first + ((last - first) * i) / (sorted.length - 1);
      });
    });
  }

  async function detectBandsAll(showMessage = true) {
    if (!processed) return;
    const config = project.detect;
    await ensureSignal(processed.detectGray, processed.width, processed.height, config);
    const sum = { n: 0, lanes: 0 };
    for (const lane of project.lanes) {
      if (lane.removed) continue;
      const manual = lane.bands.filter((b) => b.manual);
      const peaks = detectBandsInLane(processed.detectGray, processed.width, processed.height, lane, project.gelType, config);
      lane.bands = peaks.map((p) => {
        const keep = manual.find((b) => Math.abs(b.y - p.y) < 0.01);
        return keep ?? { y: p.y, intensity: p.intensity, showSize: true };
      });
      sum.n += lane.bands.length;
      if (lane.bands.length) sum.lanes++;
    }
    // Arrows may point at a band index that no longer exists after detection.
    project.annotations = project.annotations.map((a) => {
      if (a.type !== 'arrow') return a;
      const lane = project.lanes.find((l) => l.id === a.laneId);
      const last = Math.max(0, (lane?.bands.length ?? 1) - 1);
      return { ...a, bandIndex: Math.min(a.bandIndex, last) };
    });
    if (showMessage) toast(sum.n > 0, sum.n > 0 ? m.gelBandsFound({ n: sum.n }) : m.gelBandsNone());
    scheduleLayout();
  }

  async function detectBandsForLane(lane: GelLane) {
    if (!processed) return;
    const config = project.detect;
    await ensureSignal(processed.detectGray, processed.width, processed.height, config);
    const peaks = detectBandsInLane(processed.detectGray, processed.width, processed.height, lane, project.gelType, config);
    commit(() => {
      lane.bands = peaks.map((p) => ({ y: p.y, intensity: p.intensity, showSize: true }));
      project.fit = null;
    });
    toast(peaks.length > 0, peaks.length ? m.gelBandsFound({ n: peaks.length }) : m.gelBandsNone());
  }

  // ---------------------------------------------------- detection presets

  function presetLabel(id: string): string {
    switch (id) {
      case 'auto': return m.gelPresetAuto();
      case 'uv': return m.gelPresetUv();
      case 'sybr': return m.gelPresetSybr();
      case 'coomassie': return m.gelPresetCoomassie();
      case 'silver': return m.gelPresetSilver();
      default: return m.gelPresetCustom();
    }
  }

  function typeModeLabel(mode: DetectTypeMode): string {
    switch (mode) {
      case 'dna': return m.gelDetectTypeDna();
      case 'protein': return m.gelDetectTypeProtein();
      default: return m.gelDetectTypeAuto();
    }
  }

  function channelLabel(channel: DetectChannel): string {
    switch (channel) {
      case 'luma': return m.gelChannelLuma();
      case 'red': return m.gelChannelRed();
      case 'green': return m.gelChannelGreen();
      case 'blue': return m.gelChannelBlue();
      case 'red-blue': return m.gelChannelRedBlue();
      case 'green-red': return m.gelChannelGreenRed();
      default: return m.gelChannelAuto();
    }
  }

  function polarityLabel(polarity: DetectPolarity): string {
    switch (polarity) {
      case 'bright': return m.gelPolarityBright();
      case 'dark': return m.gelPolarityDark();
      default: return m.gelPolarityAuto();
    }
  }

  /** Any hand edit makes the config custom and postpones detection until the
   *  explicit re-detect button runs. */
  function onDetectInput() {
    project.detect.presetId = 'custom';
    detectStale = true;
    confirmRedetect = false;
    schedulePixels();
    schedulePersist();
  }

  function applyStainPreset(id: string) {
    const chosen = presetById(id);
    if (!chosen) return;
    checkpoint(true);
    project.detect = sanitizeDetectConfig(chosen.config);
    if (chosen.display) project.display = chosen.display;
    const kind = chosen.config.type;
    if (kind !== 'auto' && project.gelType !== kind) {
      project.gelType = kind;
      project.unit = unitForKind(kind);
      project.ladderId = laddersFor(kind, project.customLadders)[0]?.id ?? project.ladderId;
      project.fit = null;
      for (const lane of project.lanes) {
        lane.isMarker = false;
        lane.ladderId = undefined;
        lane.bands = lane.bands.map((b) => ({ ...b, size: undefined, approx: false }));
      }
    }
    typeReasons = [];
    detectStale = true;
    confirmRedetect = false;
    schedulePixels();
    schedulePersist();
  }

  function resetDetectPreset() {
    const current = presetById(project.detect.presetId);
    applyStainPreset(current?.id ?? 'auto');
  }

  function saveCurrentDetectDefault() {
    const ok = saveDetectDefault(project.detect);
    toast(ok, ok ? m.gelDetectDefaultSaved() : m.gelDetectDefaultFailed());
  }

  async function redetectAll() {
    if (!processed) return;
    if (!confirmRedetect && project.lanes.some((lane) => lane.bands.some((b) => b.manual))) {
      confirmRedetect = true;
      return;
    }
    confirmRedetect = false;
    busy = m.gelBusyAuto();
    checkpoint(true);
    try {
      await refreshProcessed();
      if (!processed) return;
      await runDetection(processed);
      rebuildFigure();
      schedulePersist();
      toast(true, m.gelDetectDone());
    } finally {
      busy = '';
    }
  }

  function typeReasonText(reason: string): string {
    switch (reason) {
      case 'blue': return m.gelTypeReasonBlue();
      case 'red': return m.gelTypeReasonRed();
      case 'many': return m.gelTypeReasonMany();
      case 'wide': return m.gelTypeReasonWide();
      default: return m.gelTypeReasonNeutral();
    }
  }

  function setGelType(kind: 'dna' | 'protein') {
    typeReasons = [];
    commit(() => {
      project.gelType = kind;
      project.detect.type = kind;
      project.detect.presetId = 'custom';
      detectStale = false;
      project.unit = unitForKind(kind);
      project.ladderId = laddersFor(kind, project.customLadders)[0]?.id ?? '';
      project.fit = null;
      for (const lane of project.lanes) {
        lane.isMarker = false;
        lane.ladderId = undefined;
        lane.bands = lane.bands.map((b) => ({ ...b, size: undefined, approx: false }));
      }
      if (processed) {
        for (const lane of project.lanes) {
          lane.bands = detectBandsInLane(processed.detectGray, processed.width, processed.height, lane, kind, project.detect).map((p) => ({
            y: p.y,
            intensity: p.intensity,
            showSize: true,
          }));
        }
      }
    });
  }

  function detectMarkers(showMessage = true) {
    if (!processed) return;
    const ladders = laddersFor(project.gelType, project.customLadders);
    const result = identifyMarkers(project.lanes, { kind: project.gelType, ladders, favorites: project.favorites });
    if (!result) {
      project.fit = null;
      if (showMessage) toast(false, m.gelMarkersNone());
      scheduleLayout();
      return;
    }
    commit(() => {
      project.ladderId = result.ladder.id;
      project.fit = {
        ladderId: result.ladder.id,
        laneIds: result.laneIds,
        a: result.fit.a,
        b: result.fit.b,
        c: result.fit.c,
        degree: result.fit.degree,
        r2: result.fit.r2,
        n: result.fit.n,
      };
      for (const lane of project.lanes) {
        const assigned = result.assignments[lane.id];
        lane.isMarker = !!assigned;
        lane.ladderId = assigned ? result.ladder.id : undefined;
        if (assigned) {
          const sorted = [...lane.bands].filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
          sorted.forEach((band, i) => {
            if (i < assigned.length) {
              band.size = assigned[i];
              band.showSize = true;
              band.approx = false;
            } else {
              band.size = undefined;
              band.showSize = false;
            }
          });
        }
      }
      const alternatives = result.laneIds
        .map((id) => {
          const lane = project.lanes.find((l) => l.id === id);
          if (!lane) return null;
          const pts = [...lane.bands]
            .filter((b) => !b.hidden && b.size !== undefined)
            .sort((a, b) => a.y - b.y)
            .map((b) => ({ y: b.y, size: b.size! }));
          return pts.length >= 2 ? robustFit(pts, 1) : null;
        })
        .filter((f): f is NonNullable<typeof f> => !!f);
      for (const lane of project.lanes) {
        if (lane.isMarker || lane.removed) continue;
        const est = estimateBandSizes(lane.bands, result.fit, result.ladder, alternatives);
        lane.bands.forEach((band, i) => {
          band.size = est[i].size;
          band.approx = est[i].approx;
          band.showSize = true;
        });
      }
    });
    if (showMessage) toast(true, m.gelMarkersFound({ n: result.laneIds.length, name: result.ladder.name }));
  }

  function fitCurrentMarkers() {
    if (!processed) return;
    const ladder = ladderById(project.ladderId, project.customLadders);
    if (!ladder) {
      toast(false, m.gelLadderInvalid());
      return;
    }
    const markers = project.lanes.filter((l) => l.isMarker && !l.removed);
    if (!markers.length) {
      toast(false, m.gelMarkersNone());
      return;
    }
    const points: { y: number; size: number }[] = [];
    markers.forEach((lane) => {
      const sizes = ladder.sizes;
      const bands = [...lane.bands].filter((b) => !b.hidden).sort((a, b) => a.y - b.y);
      // Keep manual/previous sizes (for example after deleting one band);
      // only label by position when the lane has no calibration yet.
      if (bands.every((b) => b.size !== undefined)) {
        for (const b of bands) points.push({ y: b.y, size: b.size! });
        return;
      }
      if (bands.length !== sizes.length && bands.length < 4) return;
      const use = bands.length === sizes.length ? sizes : sizes.slice(0, bands.length);
      bands.slice(0, use.length).forEach((b, i) => {
        b.size = use[i];
        points.push({ y: b.y, size: use[i] });
      });
    });
    const fit = robustFit(points, points.length >= 8 ? 2 : 1);
    if (!fit) {
      toast(false, m.gelLadderInvalid());
      return;
    }
    commit(() => {
      project.fit = {
        ladderId: ladder.id,
        laneIds: markers.map((l) => l.id),
        a: fit.a,
        b: fit.b,
        c: fit.c,
        degree: fit.degree,
        r2: fit.r2,
        n: fit.n,
      };
      for (const lane of project.lanes) {
        if (lane.isMarker || lane.removed) continue;
        const est = estimateBandSizes(lane.bands, fit, ladder);
        lane.bands.forEach((band, i) => {
          band.size = est[i].size;
          band.approx = est[i].approx;
          band.showSize = true;
        });
      }
    });
    toast(true, m.gelLadderFit({ r2: fit.r2.toFixed(3) }));
  }

  function estimateSizesNow() {
    const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
    if (!project.fit || !ladder) {
      toast(false, m.gelNeedFit());
      return;
    }
    const fit = {
      a: project.fit.a,
      b: project.fit.b,
      c: project.fit.c,
      degree: project.fit.degree,
      r2: project.fit.r2,
      n: project.fit.n,
    };
    commit(() => {
      for (const lane of project.lanes) {
        if (lane.isMarker || lane.removed) continue;
        const est = estimateBandSizes(lane.bands, fit, ladder);
        lane.bands.forEach((band, i) => {
          band.size = est[i].size;
          band.approx = est[i].approx;
          band.showSize = true;
        });
      }
    });
    toast(true, m.gelSizesDone());
  }

  // -------------------------------------------------------------- transforms

  function rotateQuarter(clockwise: boolean) {
    if (!processed) return;
    checkpoint(true);
    const oldOrdered = [...project.lanes].sort((a, b) => a.x - b.x);
    const nameById = new Map(oldOrdered.map((l) => [l.id, l.name]));
    const oldArrows = project.annotations
      .filter((a): a is Extract<Annotation, { type: 'arrow' }> => a.type === 'arrow')
      .map((a) => ({ ...a, laneName: nameById.get(a.laneId) ?? '' }));
    transformForQuarterTurn(project, clockwise);
    project.annotations = project.annotations.filter((a) => a.type !== 'arrow');
    project.orient = (((project.orient + (clockwise ? 1 : 3)) % 4) + 4) % 4;
    const oldNames = oldOrdered.map((l) => ({ name: l.name, isMarker: l.isMarker, ladderId: l.ladderId }));
    void refreshProcessed().then(async () => {
      if (!processed) return;
      const config = project.detect;
      await ensureSignal(processed.detectGray, processed.width, processed.height, config);
      const found = detectLanesAuto(processed.detectGray, processed.width, processed.height, project.gelType === 'protein', config);
      project.lanes = found.map((d, i) => ({
        id: newLaneId(),
        x: d.x,
        width: d.width,
        name: oldNames[i]?.name ?? String(i + 1),
        isMarker: oldNames[i]?.isMarker ?? false,
        ladderId: oldNames[i]?.ladderId,
        bands: detectBandsInLane(processed!.detectGray, processed!.width, processed!.height, d, project.gelType, config).map((p) => ({
          y: p.y,
          intensity: p.intensity,
          showSize: true,
        })),
      }));
      // Arrows follow the lane of the same name; the band index is clamped
      // because the order of bands changes with the image orientation.
      const byName = new Map(project.lanes.map((l) => [l.name, l]));
      for (const arrow of oldArrows) {
        const lane = byName.get(arrow.laneName);
        if (!lane || !lane.bands.length) continue;
        project.annotations = [
          ...project.annotations,
          { ...arrow, laneId: lane.id, bandIndex: Math.min(arrow.bandIndex, lane.bands.length - 1) },
        ];
      }
      if (project.fit) {
        project.fit = null;
        detectMarkers(false);
      }
      rebuildFigure();
      schedulePersist();
      void tick().then(drawSource);
    });
  }

  async function flip(axis: 'h' | 'v') {
    checkpoint();
    transformForFlip(project, axis);
    if (axis === 'h') project.mirrorH = !project.mirrorH;
    else project.mirrorV = !project.mirrorV;
    await refreshProcessed();
    schedulePersist();
  }

  async function turn180() {
    checkpoint();
    transformForFlip(project, '180');
    project.orient = (project.orient + 2) % 4;
    await refreshProcessed();
    schedulePersist();
  }

  // ------------------------------------------------------------- annotations

  function annotationColor(): 'default' | 'red' {
    return project.layout.red ? 'red' : 'default';
  }

  function addArrow() {
    if (!selectedBand) {
      toast(false, m.gelPickBand());
      return;
    }
    const lane = project.lanes.find((l) => l.id === selectedBand!.laneId);
    if (!lane) return;
    commit(() => {
      project.annotations = [
        ...project.annotations,
        {
          id: newId('ann'),
          type: 'arrow',
          laneId: lane.id,
          bandIndex: selectedBand!.index,
          side: lane.x > 0.5 ? 'right' : 'left',
          label: '',
          color: annotationColor(),
        },
      ];
    });
  }

  function addBox(enlarge: boolean) {
    let cx = 0.5;
    let cy = 0.5;
    if (selectedBand) {
      const lane = project.lanes.find((l) => l.id === selectedBand!.laneId);
      const band = lane?.bands[selectedBand.index];
      cx = lane?.x ?? 0.5;
      cy = band?.y ?? 0.5;
    }
    const w = 0.16;
    const h = 0.1;
    commit(() => {
      const box = {
        id: newId('ann'),
        type: 'box' as const,
        x: Math.min(1 - w, Math.max(0, cx - w / 2)),
        y: Math.min(1 - h, Math.max(0, cy - h / 2)),
        w,
        h,
        label: '',
        enlarge,
        color: annotationColor(),
      };
      project.annotations = [...project.annotations, box];
      selectedAnnotationId = box.id;
    });
  }

  function addBracket() {
    const visH = 1 - project.crop.top - project.crop.bottom;
    commit(() => {
      project.annotations = [
        ...project.annotations,
        {
          id: newId('ann'),
          type: 'bracket',
          side: 'left',
          start: project.crop.top + visH * 0.2,
          end: project.crop.top + visH * 0.5,
          label: '',
          color: annotationColor(),
        },
      ];
    });
  }

  function addSideText() {
    commit(() => {
      project.annotations = [
        ...project.annotations,
        { id: newId('ann'), type: 'sideText', side: 'left', pos: 0.5, text: '', color: annotationColor() },
      ];
    });
  }

  function cycleMark() {
    if (!selectedBand) {
      toast(false, m.gelPickBand());
      return;
    }
    const lane = project.lanes.find((l) => l.id === selectedBand!.laneId);
    const band = lane?.bands[selectedBand.index];
    if (!band) return;
    const order = ['*', '#', '†', undefined];
    const next = order[(order.indexOf(band.mark) + 1) % order.length];
    commit(() => {
      band.mark = next;
    });
  }

  function deleteAnnotation(id: string) {
    commit(() => {
      project.annotations = project.annotations.filter((a) => a.id !== id);
      if (selectedAnnotationId === id) selectedAnnotationId = null;
    });
  }

  function addGroupFromRange(fromId: string, toId: string) {
    const ordered = [...project.lanes].sort((a, b) => a.x - b.x);
    const i0 = ordered.findIndex((l) => l.id === fromId);
    const i1 = ordered.findIndex((l) => l.id === toId);
    if (i0 < 0 || i1 < 0) return;
    const [lo, hi] = i0 <= i1 ? [i0, i1] : [i1, i0];
    const ids = ordered.slice(lo, hi + 1).map((l) => l.id);
    commit(() => {
      project.groups = [
        ...project.groups,
        { id: newId('grp'), name: `${m.gelGroupDefault()} ${project.groups.length + 1}`, laneIds: ids },
      ];
    });
    toast(true, m.gelGroupAdded());
  }

  function addConditionRow() {
    commit(() => {
      project.conditionRows = [
        ...project.conditionRows,
        { id: newId('cond'), label: '', cells: {} },
      ];
    });
  }

  function cycleCondition(rowId: string, laneId: string) {
    const row = project.conditionRows.find((r) => r.id === rowId);
    if (!row) return;
    const order = ['', '+', '−'];
    const next = order[(order.indexOf(row.cells[laneId] ?? '') + 1) % order.length];
    commit(() => {
      row.cells = { ...row.cells, [laneId]: next };
    });
  }

  function addCustomLadder() {
    const sizes = normalizeSizes(customSizes.split(/[,\s]+/).map(Number));
    if (!customName.trim() || sizes.length < 2) {
      toast(false, m.gelLadderInvalid());
      return;
    }
    const def: LadderDef = {
      id: newId('custom'),
      name: customName.trim(),
      kind: project.gelType,
      sizes,
      ref: [],
      custom: true,
    };
    commit(() => {
      project.customLadders = [...project.customLadders, def];
      project.ladderId = def.id;
    });
    customName = '';
    customSizes = '';
    saveLadderLibrary(project.customLadders, project.favorites);
  }

  function toggleFavorite(id: string) {
    commit(() => {
      project.favorites = project.favorites.includes(id)
        ? project.favorites.filter((x) => x !== id)
        : [...project.favorites, id];
    });
    saveLadderLibrary(project.customLadders, project.favorites);
  }

  function setLadder(id: string) {
    commit(() => {
      project.ladderId = id;
      project.fit = null;
    });
  }

  // ------------------------------------------------------------- figure input

  function figurePoint(e: PointerEvent): { x: number; y: number } | null {
    if (!figureCanvas) return null;
    const rect = figureCanvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / figScale, y: (e.clientY - rect.top) / figScale };
  }

  function onFigurePointerDown(e: PointerEvent) {
    if (!layout) return;
    const point = figurePoint(e);
    if (!point) return;
    const hit = hitTest(layout, point.x, point.y);
    if (!hit) return;
    if (hit.kind === 'laneName') {
      nameDrag = { from: hit.laneId, moved: false, x0: e.clientX, y0: e.clientY };
      selectedLaneId = hit.laneId;
    } else if (hit.kind === 'band') {
      selectedBand = { laneId: hit.laneId, index: hit.bandIndex };
      selectedLaneId = hit.laneId;
      drawSource();
    } else if (hit.kind === 'conditionCell') {
      cycleCondition(hit.rowId, hit.laneId);
    } else if (hit.kind === 'annotation') {
      selectedAnnotationId = hit.annotationId;
      const ann = project.annotations.find((a) => a.id === hit.annotationId);
      if (ann && (ann.type === 'box' || ann.type === 'sideText')) {
        checkpoint();
        annotationDrag = {
          id: ann.id,
          type: ann.type,
          startX: point.x,
          startY: point.y,
          x: ann.type === 'box' ? ann.x : ann.pos,
          y: ann.type === 'box' ? ann.y : 0,
        };
      }
    } else if (hit.kind === 'group') {
      const group = project.groups.find((g) => g.id === hit.groupId);
      if (group) {
        const name = group.name;
        void name;
      }
    }
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function onFigurePointerMove(e: PointerEvent) {
    if (nameDrag && Math.hypot(e.clientX - nameDrag.x0, e.clientY - nameDrag.y0) > 6) nameDrag.moved = true;
    if (!layout || !annotationDrag || !processed) return;
    const point = figurePoint(e);
    if (!point) return;
    const visW = 1 - project.crop.left - project.crop.right;
    const visH = 1 - project.crop.top - project.crop.bottom;
    const ann = project.annotations.find((a) => a.id === annotationDrag!.id);
    if (!ann) return;
    if (ann.type === 'box' && annotationDrag.type === 'box') {
      const dx = ((point.x - annotationDrag.startX) / layout.gel.w) * visW;
      const dy = ((point.y - annotationDrag.startY) / layout.gel.h) * visH;
      ann.x = Math.min(1 - ann.w, Math.max(0, annotationDrag.x + dx));
      ann.y = Math.min(1 - ann.h, Math.max(0, annotationDrag.y + dy));
      scheduleLayout();
    } else if (ann.type === 'sideText' && annotationDrag.type === 'sideText') {
      const rel = ann.side === 'left' || ann.side === 'right'
        ? (point.y - layout.gel.y) / layout.gel.h
        : (point.x - layout.gel.x) / layout.gel.w;
      ann.pos = Math.min(1, Math.max(0, rel));
      scheduleLayout();
    }
  }

  function onFigurePointerUp(e: PointerEvent) {
    if (nameDrag) {
      const wasDrag = nameDrag.moved;
      const from = nameDrag.from;
      nameDrag = null;
      if (wasDrag && layout) {
        const point = figurePoint(e);
        const hit = point ? hitTest(layout, point.x, point.y) : null;
        if (hit?.kind === 'laneName') addGroupFromRange(from, hit.laneId);
      } else {
        startNameEdit(from);
      }
    }
    if (annotationDrag) {
      annotationDrag = null;
      schedulePersist();
    }
  }

  function onFigureDoubleClick(e: MouseEvent) {
    if (!layout || !figureCanvas) return;
    const rect = figureCanvas.getBoundingClientRect();
    const hit = hitTest(layout, (e.clientX - rect.left) / figScale, (e.clientY - rect.top) / figScale);
    if (hit?.kind === 'band') {
      const lane = project.lanes.find((l) => l.id === hit.laneId);
      const band = lane?.bands[hit.bandIndex];
      if (band) {
        commit(() => {
          band.showSize = !band.showSize;
        });
      }
    }
  }

  function startNameEdit(laneId: string) {
    const lane = project.lanes.find((l) => l.id === laneId);
    if (!lane || !layout) return;
    const item = layout.items.find(
      (i) => i.kind === 'text' && i.hit?.kind === 'laneName' && i.hit.laneId === laneId,
    );
    const bbox = item && item.kind === 'text' ? item.bbox : { x: 0, y: 0, w: 60, h: 14 };
    editingLane = {
      id: laneId,
      value: lane.name,
      x: bbox.x * figScale,
      y: bbox.y * figScale,
      w: Math.max(50, bbox.w * figScale + 8),
    };
    void tick().then(() => nameInput?.select());
  }

  function commitNameEdit(next = false) {
    if (!editingLane) return;
    const lane = project.lanes.find((l) => l.id === editingLane!.id);
    const value = editingLane.value;
    const id = editingLane.id;
    editingLane = null;
    if (lane && lane.name !== value) {
      commit(() => {
        lane.name = value;
      });
    }
    if (next) {
      const ordered = [...project.lanes].sort((a, b) => a.x - b.x);
      const i = ordered.findIndex((l) => l.id === id);
      const nxt = ordered[i + 1];
      if (nxt) startNameEdit(nxt.id);
    }
  }

  // --------------------------------------------------------------- source input

  function sourcePoint(e: PointerEvent): { x: number; y: number; px: number; py: number } | null {
    if (!sourceOverlay || !processed) return null;
    const rect = sourceOverlay.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
    };
  }

  function onSourcePointerDown(e: PointerEvent) {
    if (!processed || !sourceOverlay) return;
    const point = sourcePoint(e);
    if (!point) return;
    const cssW = sourceOverlay.getBoundingClientRect().width;
    const cssH = sourceOverlay.getBoundingClientRect().height;
    const c = project.crop;
    const edges = [
      { edge: 'left' as const, d: Math.abs(point.px - c.left * cssW) },
      { edge: 'right' as const, d: Math.abs(point.px - (1 - c.right) * cssW) },
      { edge: 'top' as const, d: Math.abs(point.py - c.top * cssH) },
      { edge: 'bottom' as const, d: Math.abs(point.py - (1 - c.bottom) * cssH) },
    ].sort((a, b) => a.d - b.d);
    if (edges[0].d <= 7) {
      checkpoint(true);
      drag = { type: 'crop', edge: edges[0].edge, pointerId: e.pointerId };
      sourceOverlay.setPointerCapture(e.pointerId);
      return;
    }
    // Band dot on the nearest lane.
    let bandHit: { lane: GelLane; index: number } | null = null;
    for (const lane of project.lanes) {
      if (Math.abs(point.px - lane.x * cssW) > 8) continue;
      for (const [index, band] of lane.bands.entries()) {
        if (Math.abs(point.py - band.y * cssH) <= 5) bandHit = { lane, index };
      }
    }
    if (bandHit) {
      selectedLaneId = bandHit.lane.id;
      selectedBand = { laneId: bandHit.lane.id, index: bandHit.index };
      checkpoint(true);
      drag = { type: 'band', laneId: bandHit.lane.id, index: bandHit.index, pointerId: e.pointerId };
      sourceOverlay.setPointerCapture(e.pointerId);
      drawSource();
      return;
    }
    let nearest: GelLane | null = null;
    let dist = 9;
    for (const lane of project.lanes) {
      const d = Math.abs(point.px - lane.x * cssW);
      if (d < dist) {
        dist = d;
        nearest = lane;
      }
    }
    if (nearest) {
      selectedLaneId = nearest.id;
      checkpoint(true);
      drag = { type: 'lane', laneId: nearest.id, pointerId: e.pointerId };
      sourceOverlay.setPointerCapture(e.pointerId);
      drawSource();
    }
  }

  function onSourcePointerMove(e: PointerEvent) {
    if (!drag || !processed || !sourceOverlay) return;
    const point = sourcePoint(e);
    if (!point) return;
    if (drag.type === 'crop' && drag.edge) {
      const c = project.crop;
      if (drag.edge === 'left') c.left = Math.min(0.6, Math.max(0, point.x));
      if (drag.edge === 'right') c.right = Math.min(0.6, Math.max(0, 1 - point.x));
      if (drag.edge === 'top') c.top = Math.min(0.6, Math.max(0, point.y));
      if (drag.edge === 'bottom') c.bottom = Math.min(0.6, Math.max(0, 1 - point.y));
      if (c.left + c.right > 0.85) {
        if (drag.edge === 'left') c.left = 0.85 - c.right;
        else c.right = 0.85 - c.left;
      }
      if (c.top + c.bottom > 0.85) {
        if (drag.edge === 'top') c.top = 0.85 - c.bottom;
        else c.bottom = 0.85 - c.top;
      }
      scheduleLayout();
      return;
    }
    if (drag.type === 'lane' && drag.laneId) {
      const lane = project.lanes.find((l) => l.id === drag!.laneId);
      if (!lane) return;
      lane.x = Math.min(0.995, Math.max(0.005, point.x));
      if (linkGuides) {
        const sorted = [...project.lanes].sort((a, b) => a.x - b.x);
        if (sorted.length > 2 && (lane.id === sorted[0].id || lane.id === sorted[sorted.length - 1].id)) {
          const first = sorted[0].x;
          const last = sorted[sorted.length - 1].x;
          sorted.forEach((l, i) => {
            if (i === 0 || i === sorted.length - 1) return;
            l.x = first + ((last - first) * i) / (sorted.length - 1);
          });
        }
      }
      scheduleLayout();
      return;
    }
    if (drag.type === 'band' && drag.laneId && drag.index !== undefined) {
      const lane = project.lanes.find((l) => l.id === drag!.laneId);
      const band = lane?.bands[drag.index];
      if (!band) return;
      band.y = Math.min(0.995, Math.max(0.005, point.y));
      scheduleLayout();
    }
  }

  async function onSourcePointerUp() {
    if (!drag) return;
    const wasBand = drag.type === 'band';
    drag = null;
    schedulePersist();
    if (wasBand && project.fit) {
      // Re-fit the ladder around a moved marker band.
      fitCurrentMarkers();
    }
    await tick();
    drawSource();
  }

  // ------------------------------------------------------------------- files

  async function saveProject() {
    const ok = await saveText(`${projectBase()}.gel.json`, JSON.stringify(project), m.gelProjectSaved());
    if (ok) {
      saveRecent(project);
      recents = listRecent();
    }
  }

  function openProjectDialog() {
    projectInput?.click();
  }

  async function onPickProject(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await openProjectFile(file);
    if (projectInput) projectInput.value = '';
  }

  async function openProjectFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const next = sanitizeGelProject(parsed);
      if (!next) throw new Error(m.gelProjectInvalid());
      project = next;
      selectedLaneId = null;
      selectedBand = null;
      selectedAnnotationId = null;
      await loadActiveImage();
      toast(true, m.gelProjectOpened());
      schedulePersist();
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  // ----------------------------------------------------------------- exports

  async function exportPngNow() {
    if (!processed) {
      toast(false, m.gelNoImage());
      return;
    }
    try {
      const fig = buildFigure(project, processed.canvas);
      const canvas = rasterizeFigure(fig, processed.canvas, exportDpi);
      const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
      const bytes = await exportPngWithMetadata(canvas, exportDpi, summaryText(project, processed.canvas, ladder));
      await saveBytes(`${projectBase()}_figure_${exportDpi}dpi.png`, bytes, m.gelExported());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  async function sendToFigureNow() {
    if (!processed) {
      toast(false, m.gelNoImage());
      return;
    }
    try {
      const fig = layout ?? buildFigure(project, processed.canvas);
      const canvas = rasterizeFigure(fig, processed.canvas, Math.min(exportDpi, 300));
      const ok = await sendImageToFigure({
        dataUrl: canvas.toDataURL('image/png'),
        name: `${projectBase()}_figure`,
        width: canvas.width,
        height: canvas.height,
      });
      if (!ok) toast(false, g.sendToFigureFailed());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  async function exportTiffNow() {
    if (!processed) return;
    try {
      const fig = buildFigure(project, processed.canvas);
      const canvas = rasterizeFigure(fig, processed.canvas, exportDpi);
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
      const bytes = encodeTiff(data.data, canvas.width, canvas.height, exportDpi, summaryText(project, processed.canvas, ladder), false);
      await saveBytes(`${projectBase()}_figure_${exportDpi}dpi.tif`, bytes, m.gelExported());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  async function exportSvgNow() {
    if (!processed || !layout) return;
    try {
      const svg = figureToSvg(layout, processed.canvas.toDataURL('image/png'), processed.width, processed.height);
      await saveText(`${projectBase()}_figure.svg`, svg, m.gelExported());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  async function exportPptxNow() {
    if (!processed || !layout) return;
    busy = m.gelBusyExport();
    try {
      const bytes = await makePptx(layout, processed.canvas, projectBase());
      await saveBytes(`${projectBase()}_figure.pptx`, bytes, m.gelExported());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    } finally {
      busy = '';
    }
  }

  async function exportUncroppedNow() {
    if (!processed) return;
    const canvas = renderUncropped(project, processed.canvas, 1);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) return;
    await saveBytes(`${projectBase()}_uncropped.png`, new Uint8Array(await blob.arrayBuffer()), m.gelExported());
  }

  async function exportOriginalNow() {
    const exp = activeExposureOf(project);
    if (!exp?.originalBase64) {
      toast(false, m.gelNoOriginal());
      return;
    }
    const bytes = base64ToBytes(exp.originalBase64);
    const sha = exp.sha256 ?? (await sha256Hex(bytes));
    exp.sha256 = sha;
    const ext = exp.name.split('.').pop() || 'bin';
    await saveBytes(`${projectBase()}_original_${sha.slice(0, 8)}.${ext}`, bytes, m.gelOriginalSaved());
  }

  async function exportLogNow() {
    if (!processed || !layout) return;
    const exp = activeExposureOf(project);
    let sha = exp?.sha256;
    if (!sha && exp?.originalBase64) {
      sha = await sha256Hex(base64ToBytes(exp.originalBase64));
      exp.sha256 = sha;
    }
    const log = makeLog(project, processed.canvas, layout, project.customLadders, sha);
    await saveText(`${projectBase()}_processing_log.json`, JSON.stringify(log, null, 2), m.gelLogSaved());
  }

  /** Reproducible bundle: figure PNG + editable SVG + band CSV + the real
   *  project and settings, with parameters/methods/manifest added by the
   *  shared builder. */
  async function exportReproNow() {
    if (!processed) {
      toast(false, g.gelReproFailed());
      return;
    }
    busy = g.gelReproBusy();
    try {
      const fig = layout ?? buildFigure(project, processed.canvas);
      const canvas = rasterizeFigure(fig, processed.canvas, exportDpi);
      const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
      const png = await exportPngWithMetadata(
        canvas,
        exportDpi,
        summaryText(project, processed.canvas, ladder),
      );
      const svg = figureToSvg(fig, processed.canvas.toDataURL('image/png'), processed.width, processed.height);
      const base = projectBase();
      const result = await saveReproBundle({
        tool: 'gel',
        title: projectBase() || m.toolsGelTitle(),
        files: [
          { name: `${base}_figure_${exportDpi}dpi.png`, mime: 'image/png', data: png },
          { name: `${base}_figure.svg`, mime: 'image/svg+xml', data: svg },
          { name: `${base}_bands.csv`, mime: 'text/csv', data: gelCsv(project) },
        ],
        parameters: gelParameters(project, exportDpi),
        methods: gelMethods(project),
        project: plainClone(project),
        notes: project.notes || undefined,
      });
      if (result.ok) toast(true, g.gelReproSaved());
      else if (!result.canceled && result.error) toast(false, result.error);
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    } finally {
      busy = '';
    }
  }

  function applyResolutionFix() {
    if (!processed) return;
    const visW = 1 - project.crop.left - project.crop.right;
    const maxMm = Math.floor(((processed.width * visW) / 300) * 25.4);
    commit(() => {
      project.layout.figureWidthMm = Math.max(60, Math.min(300, maxMm));
    });
  }

  function resetLevels() {
    commit(() => {
      project.adjust.contrast = 1;
      project.adjust.brightness = 0;
      project.adjust.gamma = 1;
    });
  }

  /** Stretch the useful tonal range without asking the user to read a
   *  histogram: a gentle linear stretch plus gamma that maps the midtone to
   *  0.5. Detection profiles are normalised, so the monotonic curve does not
   *  move lanes or bands. */
  function autoLevels() {
    if (!processed) return;
    const lo = percentile(processed.rawGray, 0.02);
    const hi = percentile(processed.rawGray, 0.98);
    commit(() => {
      project.adjust.brightness = 0;
      if (hi - lo < 0.02) {
        project.adjust.contrast = 1;
        project.adjust.gamma = 1;
        return;
      }
      const contrast = Math.min(1.8, Math.max(1, 0.9 / (hi - lo)));
      const mid = Math.min(0.92, Math.max(0.08, (lo + hi) / 2));
      const after = Math.min(0.95, Math.max(0.08, (mid - 0.5) * contrast + 0.5));
      const gamma = Math.log(0.5) / Math.log(after);
      project.adjust.contrast = Math.round(contrast * 100) / 100;
      project.adjust.gamma = Math.round(Math.min(2.5, Math.max(0.3, gamma)) * 100) / 100;
    });
  }

  function fixTinyFont() {
    commit(() => {
      project.layout.nameFontSize = Math.max(8, project.layout.nameFontSize);
      project.layout.labelFontSize = Math.max(7, project.layout.labelFontSize);
    });
  }

  function applyBulkNames() {
    const names = bulkNames.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    commit(() => {
      const ordered = [...project.lanes].filter((l) => !l.removed).sort((a, b) => a.x - b.x);
      ordered.forEach((lane, i) => {
        if (names[i] !== undefined) lane.name = names[i];
      });
    });
    bulkNames = '';
  }

  function preflightText(item: PreflightItem): string {
    switch (item.id) {
      case 'saturation': return m.gelCheckSaturation({ value: item.value });
      case 'clip': return m.gelCheckClip({ value: item.value });
      case 'resolution': return m.gelCheckResolution({ value: item.value });
      case 'tinyFont': return m.gelCheckTinyFont({ value: item.value });
      case 'approx': return m.gelCheckApprox({ n: item.value });
      case 'protein': return m.gelCheckProtein();
      case 'ladder': return m.gelCheckLadder();
    }
  }

  // ------------------------------------------------------------------ styles

  function plainClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function saveCurrentStyle() {
    if (!styleName.trim()) return;
    const style: GelStyle = {
      id: newId('style'),
      name: styleName.trim(),
      layout: plainClone(project.layout),
      customLadders: plainClone(project.customLadders),
      favorites: [...project.favorites],
      gelType: project.gelType,
      createdAt: new Date().toISOString(),
    };
    if (saveStyle(style)) {
      styles = listStyles();
      styleName = '';
      toast(true, m.gelStyleSaved());
    } else {
      toast(false, m.gelQuotaWarn());
    }
  }

  function applyStyle(style: GelStyle) {
    const typeChanged = style.gelType !== project.gelType;
    commit(() => {
      project.layout = plainClone(style.layout);
      project.customLadders = plainClone(style.customLadders);
      project.favorites = [...style.favorites];
    });
    if (typeChanged) setGelType(style.gelType);
  }

  function deleteStyle(id: string) {
    removeStyle(id);
    styles = listStyles();
  }

  function openRecent(id: string) {
    const p = loadRecent(id);
    if (!p) {
      toast(false, m.gelProjectInvalid());
      return;
    }
    project = p;
    selectedLaneId = null;
    selectedBand = null;
    void loadActiveImage();
    toast(true, m.gelProjectOpened());
  }

  function deleteRecent(id: string) {
    removeRecent(id);
    recents = listRecent();
  }

  function commitRecentRename() {
    if (!recentEdit) return;
    renameRecent(recentEdit.id, recentEdit.name);
    recentEdit = null;
    recents = listRecent();
  }

  function resetAll() {
    checkpoint(true);
    project = emptyProject();
    imageEl = null;
    processed = null;
    layout = null;
    history = [];
    future = [];
    canUndo = false;
    canRedo = false;
    try {
      localStorage.removeItem('spice_gel_project_v2');
    } catch {
      /* ignore */
    }
    drawSource();
  }

  // ----------------------------------------------------------------- keyboard

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveProject();
      return;
    }
    if (typing) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedAnnotationId) {
        e.preventDefault();
        deleteAnnotation(selectedAnnotationId);
      } else if (selectedLaneId) {
        e.preventDefault();
        removeLane(selectedLaneId);
      }
    } else if (e.key.toLowerCase() === 'h' && selectedLaneId) {
      const lane = project.lanes.find((l) => l.id === selectedLaneId);
      if (lane) toggleSplice(lane);
    } else if (selectedLaneId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nudgeLane(selectedLaneId, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.002));
    }
  }

  // ---------------------------------------------------------------- lifecycle

  function onWindowResize() {
    drawSource();
    drawFigurePreview();
  }
  onMount(() => {
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });
</script>

<div class="gel-page" role="application" aria-label={m.gelOverlayLabel()} ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <ToolProjectBar
    kind="gel"
    getPayload={projectPayload}
    getName={projectName}
    getPreview={projectPreview}
    getSummary={projectSummary}
  />
  <input bind:this={imageInput} data-testid="gel-image-input" type="file" accept="image/png,image/jpeg,image/bmp,image/webp,image/gif,image/tiff,.tif,.tiff" multiple style="display:none" onchange={onPickImages} />
  <input bind:this={projectInput} type="file" accept=".json,.gelfig,application/json" style="display:none" onchange={onPickProject} />
  <input bind:this={ladderInput} type="file" accept=".json,application/json" style="display:none" onchange={onPickLadderLibrary} />

  <div class="gel-toolbar">
    <button class="pix-btn" onclick={() => openImagePicker('replace')}><Upload size={12} /> {m.gelImport()}</button>
    <button class="pix-btn accent" disabled={!hasImage || !!busy} onclick={autoDraft}><Wand2 size={12} /> {busy || m.gelAutoDraft()}</button>
    <button class="pix-btn" disabled={!hasImage || !canUndo} onclick={undo} title={m.gelUndo()}><Undo2 size={12} /></button>
    <button class="pix-btn" disabled={!hasImage || !canRedo} onclick={redo} title={m.gelRedo()}><Redo2 size={12} /></button>
    <span class="spacer"></span>
    <button class="pix-btn" onclick={() => projectInput?.click()}><FolderOpen size={12} /> {m.gelOpenProject()}</button>
    <button class="pix-btn" disabled={!hasImage} onclick={saveProject}><Save size={12} /> {m.gelSaveProject()}</button>
    <button class="pix-btn ok" disabled={!hasImage} onclick={exportPngNow}><Download size={12} /> {m.gelExport()}</button>
    <button class="pix-btn" disabled={!hasImage || !!busy} onclick={sendToFigureNow} title={g.sendToFigure()} aria-label={g.sendToFigure()} data-testid="send-to-figure"><Send size={12} /></button>
    <button class="pix-btn danger" disabled={!hasImage} onclick={resetAll}><Eraser size={12} /> {m.gelReset()}</button>
  </div>

  <div class="gel-body">
    <aside class="gel-side">
      <details open>
        <summary><ScanLine size={11} /> {m.gelImageSection()}</summary>
        <div class="sec-body">
          {#if !hasImage}
            <div class="empty-hint">{m.gelNoImage()}</div>
          {:else}
            <div class="row">
              <span class="label">{m.gelExposures()}</span>
              <div class="exposure-list">
                {#each project.exposures as exp (exp.id)}
                  <div class="exposure-row" class:active={exp.id === project.activeExposureId}>
                    <button class="link" onclick={() => setExposure(exp.id)} title={m.gelUseExposure()}>
                      {exp.name || m.gelExposureName()}
                    </button>
                    <span class="pix-dim">{exp.width}×{exp.height}</span>
                    {#if exp.id === project.activeExposureId}<span class="best">{m.gelBestExposure()}</span>{/if}
                    {#if project.exposures.length > 1}
                      <button class="icon danger" onclick={() => removeExposure(exp.id)} title={m.gelRemoveExposure()}><X size={11} /></button>
                    {/if}
                  </div>
                {/each}
              </div>
              <button class="pix-btn small" onclick={() => openImagePicker('append')}><Plus size={10} /> {m.gelAddExposure()}</button>
            </div>
            <div class="btn-row">
              <button class="pix-btn" onclick={() => rotateQuarter(false)} title={m.gelRotateLeft()}><RotateCcw size={12} /></button>
              <button class="pix-btn" onclick={() => rotateQuarter(true)} title={m.gelRotateRight()}><RotateCw size={12} /></button>
              <button class="pix-btn" onclick={() => turn180()} title="180°"><RotateCw size={12} /><RotateCw size={12} class="overlap" /></button>
              <button class="pix-btn" onclick={() => flip('h')} title={m.gelMirrorH()}><FlipHorizontal size={12} /></button>
              <button class="pix-btn" onclick={() => flip('v')} title={m.gelMirrorV()}><FlipVertical size={12} /></button>
            </div>
            <label class="row">
              <span>{m.gelFineRotation()} <output>{project.rotation.toFixed(1)}°</output></span>
              <input type="range" min="-45" max="45" step="0.1" value={project.rotation}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => setRotation(Number((e.currentTarget as HTMLInputElement).value))} />
            </label>
            <label class="check"><input type="checkbox" bind:checked={showGrid} /> {m.gelShowGrid()}</label>
            <div class="btn-row">
              <button class="pix-btn" disabled={!!busy} onclick={straighten}><Wand2 size={11} /> {m.gelAutoStraighten()}</button>
              <button class="pix-btn" onclick={autoCrop}><Crosshair size={11} /> {m.gelAutoCrop()}</button>
            </div>
            <div class="btn-row">
              <button class="pix-btn" class:active={project.display === 'gray'} onclick={() => { checkpoint(); project.display = 'gray'; schedulePixels(); }}>{m.gelGrayMode()}</button>
              <button class="pix-btn" class:active={project.display === 'color'} onclick={() => { checkpoint(); project.display = 'color'; schedulePixels(); }}>{m.gelColorMode()}</button>
            </div>
            {#if project.display === 'gray'}
              <label class="check"><input type="checkbox" bind:checked={project.adjust.grayscale} onchange={schedulePixels} /> {m.gelGrayscale()}</label>
              <label class="check"><input type="checkbox" bind:checked={project.adjust.invert} onchange={schedulePixels} /> {m.gelInvert()}</label>
              <label class="row"><span>{m.gelContrast()} <output>{project.adjust.contrast.toFixed(2)}</output></span>
                <input type="range" min="0.2" max="3" step="0.05" bind:value={project.adjust.contrast} onpointerdown={() => checkpoint(true)} oninput={schedulePixels} />
              </label>
              <label class="row"><span>{m.gelBrightness()} <output>{project.adjust.brightness.toFixed(2)}</output></span>
                <input type="range" min="-0.5" max="0.5" step="0.01" bind:value={project.adjust.brightness} onpointerdown={() => checkpoint(true)} oninput={schedulePixels} />
              </label>
              <label class="row"><span>{m.gelGamma()} <output>{project.adjust.gamma.toFixed(2)}</output></span>
                <input type="range" min="0.3" max="2.5" step="0.05" bind:value={project.adjust.gamma} disabled={project.adjust.gammaLocked}
                  onpointerdown={() => checkpoint(true)} oninput={schedulePixels} />
              </label>
              <div class="btn-row">
                <label class="check small"><input type="checkbox" bind:checked={project.adjust.gammaLocked} /> {m.gelGammaLock()}</label>
                <button class="pix-btn small" onclick={autoLevels}>{m.gelAutoLevels()}</button>
                <button class="pix-btn small" onclick={resetLevels}>{m.gelResetLevels()}</button>
              </div>
            {/if}
            <div class="crop-grid">
              <label>{m.gelCropLeft()}<input type="range" min="0" max="0.6" step="0.005" bind:value={project.crop.left} onpointerdown={() => checkpoint(true)} oninput={scheduleLayout} /></label>
              <label>{m.gelCropTop()}<input type="range" min="0" max="0.6" step="0.005" bind:value={project.crop.top} onpointerdown={() => checkpoint(true)} oninput={scheduleLayout} /></label>
              <label>{m.gelCropRight()}<input type="range" min="0" max="0.6" step="0.005" bind:value={project.crop.right} onpointerdown={() => checkpoint(true)} oninput={scheduleLayout} /></label>
              <label>{m.gelCropBottom()}<input type="range" min="0" max="0.6" step="0.005" bind:value={project.crop.bottom} onpointerdown={() => checkpoint(true)} oninput={scheduleLayout} /></label>
            </div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><SlidersHorizontal size={11} /> {m.gelDetectSection()}</summary>
        <div class="sec-body">
          <label class="row">
            <span>{m.gelStainPreset()}</span>
            <select class="pix-select" data-testid="gel-stain-preset" value={project.detect.presetId}
              onchange={(e) => applyStainPreset((e.currentTarget as HTMLSelectElement).value)}>
              {#each presetChoices(project.detect.presetId) as choice (choice.id)}
                <option value={choice.id}>{presetLabel(choice.id)}</option>
              {/each}
            </select>
          </label>
          <div class="mini-grid">
            <label class="inline">{m.gelDetectType()}
              <select class="pix-select tiny" data-testid="gel-detect-type" value={project.detect.type}
                onchange={(e) => { project.detect.type = (e.currentTarget as HTMLSelectElement).value as DetectTypeMode; onDetectInput(); }}>
                {#each DETECT_TYPE_MODES as mode (mode)}<option value={mode}>{typeModeLabel(mode)}</option>{/each}
              </select>
            </label>
            <label class="inline">{m.gelDetectPolarity()}
              <select class="pix-select tiny" value={project.detect.polarity}
                onchange={(e) => { project.detect.polarity = (e.currentTarget as HTMLSelectElement).value as DetectPolarity; onDetectInput(); }}>
                {#each DETECT_POLARITIES as polarity (polarity)}<option value={polarity}>{polarityLabel(polarity)}</option>{/each}
              </select>
            </label>
          </div>
          <label class="row">
            <span>{m.gelDetectChannel()}</span>
            <select class="pix-select" value={project.detect.channel}
              onchange={(e) => { project.detect.channel = (e.currentTarget as HTMLSelectElement).value as DetectChannel; onDetectInput(); }}>
              {#each DETECT_CHANNELS as channel (channel)}<option value={channel}>{channelLabel(channel)}</option>{/each}
            </select>
          </label>
          <label class="row"><span>{m.gelSensitivity()} <output>{Math.round(project.detect.sensitivity * 100)}%</output></span>
            <input type="range" min="0" max="1" step="0.01" bind:value={project.detect.sensitivity}
              onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
          </label>
          <label class="row"><span>{m.gelDenoise()} <output>{project.detect.denoise}</output></span>
            <input type="range" min="0" max="2" step="1" bind:value={project.detect.denoise}
              onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
          </label>
          <details class="detect-advanced">
            <summary>{m.gelAdvanced()}</summary>
            <div class="advanced-body">
              <div class="pix-dim tiny">{m.gelLanes()}</div>
              <label class="row"><span>{m.gelLaneCut()} <output>{Math.round(project.detect.lanes.cut * 100)}%</output></span>
                <input type="range" min="0.02" max="0.4" step="0.01" bind:value={project.detect.lanes.cut}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelLaneMergeGap()} <output>{(project.detect.lanes.mergeGap * 100).toFixed(1)}%</output></span>
                <input type="range" min="0" max="0.02" step="0.001" bind:value={project.detect.lanes.mergeGap}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelLaneMinWidth()} <output>{(project.detect.lanes.minWidth * 100).toFixed(1)}%</output></span>
                <input type="range" min="0.001" max="0.02" step="0.001" bind:value={project.detect.lanes.minWidth}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelLaneSmooth()} <output>{(project.detect.lanes.smooth * 100).toFixed(1)}%</output></span>
                <input type="range" min="0" max="0.05" step="0.005" bind:value={project.detect.lanes.smooth}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelLaneProminence()} <output>{Math.round(project.detect.lanes.prominence * 100)}%</output></span>
                <input type="range" min="0.01" max="0.3" step="0.01" bind:value={project.detect.lanes.prominence}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <div class="pix-dim tiny">{m.gelBandGroup()}</div>
              <label class="row"><span>{m.gelBandProminence()} <output>{project.detect.bands.prominence.toFixed(2)}σ</output></span>
                <input type="range" min="0.1" max="2" step="0.05" bind:value={project.detect.bands.prominence}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelBandMinGap()} <output>{(project.detect.bands.minGap * 100).toFixed(1)}%</output></span>
                <input type="range" min="0.001" max="0.05" step="0.001" bind:value={project.detect.bands.minGap}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
              <label class="row"><span>{m.gelBandSmooth()} <output>{project.detect.bands.smooth}px</output></span>
                <input type="range" min="1" max="15" step="1" bind:value={project.detect.bands.smooth}
                  onpointerdown={() => checkpoint(true)} oninput={onDetectInput} />
              </label>
            </div>
          </details>
          {#if detectStale}
            <div class="detect-stale">{m.gelDetectStale()}</div>
          {/if}
          {#if confirmRedetect}
            <div class="detect-confirm">
              <span>{m.gelRedetectConfirm()}</span>
              <div class="btn-row">
                <button class="pix-btn danger small" onclick={redetectAll}>{m.gelConfirm()}</button>
                <button class="pix-btn small" onclick={() => (confirmRedetect = false)}>{m.gelCancel()}</button>
              </div>
            </div>
          {:else}
            <div class="btn-row">
              <button class="pix-btn" disabled={!hasImage || !!busy} data-testid="gel-redetect" onclick={redetectAll}>
                <Crosshair size={11} /> {m.gelRedetect()}
              </button>
              <button class="pix-btn small" onclick={resetDetectPreset}>{m.gelResetPreset()}</button>
              <button class="pix-btn small" onclick={saveCurrentDetectDefault}>{m.gelSaveDefault()}</button>
            </div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><Layers size={11} /> {m.gelGelType()} / {m.gelLadderLibrary()}</summary>
        <div class="sec-body">
          <div class="btn-row">
            <button class="pix-btn" class:active={project.gelType === 'dna'} onclick={() => setGelType('dna')}>{m.gelTypeDna()}</button>
            <button class="pix-btn" class:active={project.gelType === 'protein'} onclick={() => setGelType('protein')}>{m.gelTypeProtein()}</button>
          </div>
          <div class="pix-dim tiny">{m.gelUnit()}: {project.unit}</div>
          {#if typeReasons.length}
            <div class="pix-dim tiny">{typeReasons.map(typeReasonText).join(' · ')}</div>
          {/if}
          <label class="row">
            <span>{m.gelLadderLibrary()}</span>
            <select class="pix-select" value={project.ladderId} onchange={(e) => setLadder((e.currentTarget as HTMLSelectElement).value)}>
              {#each ladderOptions as ladder (ladder.id)}
                <option value={ladder.id}>{project.favorites.includes(ladder.id) ? '★ ' : ''}{ladder.name}</option>
              {/each}
            </select>
          </label>
          <div class="btn-row">
            <button class="pix-btn" onclick={() => { const id = project.ladderId; toggleFavorite(id); }} title={m.gelLadderFavorite()}>
              <Star size={11} /> {m.gelLadderFavorite()}
            </button>
            <button class="pix-btn" disabled={!hasImage} onclick={() => detectMarkers(true)}><Crosshair size={11} /> {m.gelDetectMarkers()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={fitCurrentMarkers}>{m.gelFitLadder()}</button>
          </div>
          {#if project.fit}
            <div class="fit-line">{m.gelFitSummary({ r2: project.fit.r2.toFixed(3), n: project.fit.n })}</div>
          {/if}
          <button class="pix-btn" disabled={!project.fit} onclick={estimateSizesNow}>{m.gelEstimateSizes()}</button>
          <div class="btn-row">
            <button class="pix-btn small" onclick={exportLadderLibrary}>{m.gelLadderExport()}</button>
            <button class="pix-btn small" onclick={() => ladderInput?.click()}>{m.gelLadderImport()}</button>
          </div>
          <div class="custom-ladder">
            <div class="pix-dim tiny">{m.gelLadderCustom()}</div>
            <input class="pix-input" type="text" bind:value={customName} placeholder={m.gelLadderName()} />
            <input class="pix-input" type="text" bind:value={customSizes} placeholder={m.gelLadderSizesHint()} />
            <button class="pix-btn small" onclick={addCustomLadder}><Plus size={10} /> {m.gelLadderAdd()}</button>
          </div>
        </div>
      </details>

      <details open>
        <summary><Crosshair size={11} /> {m.gelLanes()}</summary>
        <div class="sec-body">
          <div class="btn-row">
            <button class="pix-btn" disabled={!hasImage} onclick={autoLanes}>{m.gelAutoLanes()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={reDetectInCrop}>{m.gelRedetectCrop()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={addLane}><Plus size={10} /> {m.gelAddLane()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={() => detectBandsAll(true)}>{m.gelDetectBands()}</button>
          </div>
          <div class="btn-row">
            <label class="inline">{m.gelLaneCount()}
              <input class="pix-input num" type="number" min="1" max="60" value={project.lanes.length}
                data-testid="gel-lane-count"
                onchange={(e) => setLaneCount(Number((e.currentTarget as HTMLInputElement).value))} />
            </label>
            <label class="check small"><input type="checkbox" bind:checked={linkGuides} /> {m.gelLinkGuides()}</label>
            <button class="pix-btn small" onclick={redistributeFromEnds} title={m.gelApplyCount()}>{m.gelApplyCount()}</button>
            {#if emptyLaneCount > 0}
              <button class="pix-btn small" onclick={removeEmptyLanes}>{m.gelRemoveEmpty({ n: emptyLaneCount })}</button>
            {/if}
          </div>
          {#if selectedLane}
          <div class="lane-style">
            <span class="pix-dim tiny">{m.gelLaneStyle()}</span>
            <label>{m.gelNameFontSize()}
              <input class="pix-input num" type="number" min="4" max="24" step="0.5"
                value={selectedLane.style?.fontSize ?? project.layout.nameFontSize}
                onchange={(e) => setLaneStyle({ fontSize: Number((e.currentTarget as HTMLInputElement).value) })} />
            </label>
            <label>{m.gelNameAngle()}
              <input class="pix-input num" type="number" min="0" max="90" step="1"
                value={selectedLane.style?.angle ?? project.layout.nameAngle}
                onchange={(e) => setLaneStyle({ angle: Number((e.currentTarget as HTMLInputElement).value) })} />
            </label>
            <label class="check small"><input type="checkbox" checked={!!selectedLane.style?.italic}
              onchange={(e) => setLaneStyle({ italic: (e.currentTarget as HTMLInputElement).checked })} /> {m.gelItalic()}</label>
            <label class="check small"><input type="checkbox" checked={!!selectedLane.style?.red}
              onchange={(e) => setLaneStyle({ red: (e.currentTarget as HTMLInputElement).checked })} /> {m.gelRed()}</label>
          </div>
        {/if}
        {#if selectedBandRef}
          <div class="band-panel">
            <span class="pix-dim tiny">{m.gelBandPanel()} · {selectedBandRef.lane.name || '—'} #{selectedBandRef.index + 1}</span>
            <label class="inline">{m.gelBandSize()}
              <input class="pix-input num" type="number" min="0" step="any"
                value={selectedBandRef.band.size !== undefined ? Math.round(selectedBandRef.band.size * 10) / 10 : ''}
                onchange={(e) => {
                  const v = Number((e.currentTarget as HTMLInputElement).value);
                  if (v > 0) updateSelectedBand({ size: v, manual: true, showSize: true, approx: false });
                }} />
            </label>
            <label class="check small"><input type="checkbox" checked={!!selectedBandRef.band.showSize}
              onchange={(e) => updateSelectedBand({ showSize: (e.currentTarget as HTMLInputElement).checked })} /> {m.gelBandShow()}</label>
            <label class="check small"><input type="checkbox" checked={!!selectedBandRef.band.hidden}
              onchange={(e) => updateSelectedBand({ hidden: (e.currentTarget as HTMLInputElement).checked })} /> {m.gelBandHidden()}</label>
            <button class="pix-btn small danger" onclick={deleteSelectedBand}>{m.gelDeleteBand()}</button>
          </div>
        {/if}
        <div class="lane-list">
            {#each project.lanes as lane (lane.id)}
              <div class="lane-row" class:active={lane.id === selectedLaneId} class:removed={lane.removed}>
                <button class="pix-btn-reset lane-pick" onclick={() => { selectedLaneId = lane.id; drawSource(); }}>{lane.name || '—'}</button>
                <input class="pix-input lane-name" type="text" placeholder={m.gelLaneName()} bind:value={lane.name} oninput={() => { scheduleLayout(); schedulePersist(); }} />
                <label class="check small" title={m.gelLaneMarker()}><input type="checkbox" bind:checked={lane.isMarker} onchange={() => { selectedLaneId = lane.id; scheduleLayout(); }} /> M</label>
                <button class="pix-btn tiny-btn" onclick={() => detectBandsForLane(lane)} title={m.gelDetectBands()}>{lane.bands.length}</button>
                <button class="icon" onclick={() => toggleSplice(lane)} title={m.gelSplice()}>
                  {#if lane.removed}<EyeOff size={11} />{:else}<Eye size={11} />{/if}
                </button>
                <button class="icon danger" onclick={() => removeLane(lane.id)} title={m.gelRemoveLane()}><Trash2 size={11} /></button>
              </div>
              {#if lane.removed}
                <div class="lane-row removed-actions">
                  <span class="pix-dim tiny">{m.gelSplice()}</span>
                  <select class="pix-select tiny" value={lane.splice ?? 'gap'} onchange={(e) => { lane.splice = (e.currentTarget as HTMLSelectElement).value as 'gap' | 'line'; schedulePersist(); }}>
                    <option value="gap">{m.gelSpliceGap()}</option>
                    <option value="line">{m.gelSpliceLine()}</option>
                  </select>
                  <button class="pix-btn tiny-btn" onclick={() => restoreLane(lane)}>{m.gelRestoreLane()}</button>
                </div>
              {/if}
            {:else}
              <div class="empty-hint">{m.gelNoLanes()}</div>
            {/each}
          </div>
          <div class="bulk-names">
            <div class="pix-dim tiny">{m.gelBulkNames()}</div>
            <textarea class="pix-input" rows="2" bind:value={bulkNames} placeholder={m.gelBulkNamesHint()}></textarea>
            <button class="pix-btn small" disabled={!bulkNames.trim()} onclick={applyBulkNames}>{m.gelBulkNamesApply()}</button>
          </div>
        </div>
      </details>

      <details>
        <summary><Type size={11} /> {m.gelConditions()} / {m.gelGroups()}</summary>
        <div class="sec-body">
          <div class="btn-row">
            <button class="pix-btn small" onclick={addConditionRow}><Plus size={10} /> {m.gelAddCondition()}</button>
          </div>
          {#each project.conditionRows as row (row.id)}
            <div class="condition-row">
              <input class="pix-input" type="text" bind:value={row.label} placeholder={m.gelConditionLabel()} oninput={scheduleLayout} />
              <button class="icon danger" onclick={() => commit(() => { project.conditionRows = project.conditionRows.filter((r) => r.id !== row.id); })}><Trash2 size={11} /></button>
            </div>
          {/each}
          <div class="pix-dim tiny">{m.gelGroupAddHint()}</div>
          {#each project.groups as group (group.id)}
            <div class="condition-row">
              <input class="pix-input" type="text" bind:value={group.name} placeholder={m.gelGroupName()} oninput={scheduleLayout} />
              <span class="pix-dim tiny">{group.laneIds.length}</span>
              <button class="icon danger" onclick={() => commit(() => { project.groups = project.groups.filter((g) => g.id !== group.id); })}><Trash2 size={11} /></button>
            </div>
          {/each}
        </div>
      </details>

      <details open={!!selectedAnnotationId}>
        <summary><Square size={11} /> {m.gelAnnotations()}</summary>
        <div class="sec-body">
          <div class="btn-row wrap">
            <button class="pix-btn small" onclick={addArrow}><ArrowLeft size={10} /> {m.gelAddArrow()}</button>
            <button class="pix-btn small" onclick={() => addBox(false)}><Square size={10} /> {m.gelAddBox()}</button>
            <button class="pix-btn small" onclick={() => addBox(true)}><Square size={10} /> {m.gelAddEnlargeBox()}</button>
            <button class="pix-btn small" onclick={addBracket}><ArrowUp size={10} /> {m.gelAddBracket()}</button>
            <button class="pix-btn small" onclick={addSideText}><Type size={10} /> {m.gelAddSideText()}</button>
            <button class="pix-btn small" onclick={cycleMark}>*</button>
          </div>
          {#if !selectedBand}
            <div class="pix-dim tiny">{m.gelPickBand()}</div>
          {/if}
          {#each project.annotations as ann (ann.id)}
            <div class="ann-card" class:active={ann.id === selectedAnnotationId}>
              <button class="ann-head" onclick={() => { selectedAnnotationId = ann.id; }}>
                {ann.type === 'arrow' ? m.gelAddArrow() : ann.type === 'box' ? (ann.enlarge ? m.gelAddEnlargeBox() : m.gelAddBox()) : ann.type === 'bracket' ? m.gelAddBracket() : m.gelAddSideText()}
              </button>
              {#if ann.type === 'box'}
                <input class="pix-input" type="text" bind:value={ann.label} placeholder={m.gelAnnotationLabel()} oninput={scheduleLayout} />
                <div class="mini-grid">
                  <label>{m.gelBoxGeometry()} X<input type="range" min="0" max="1" step="0.005" bind:value={ann.x} oninput={scheduleLayout} /></label>
                  <label>Y<input type="range" min="0" max="1" step="0.005" bind:value={ann.y} oninput={scheduleLayout} /></label>
                  <label>W<input type="range" min="0.02" max="0.6" step="0.005" bind:value={ann.w} oninput={scheduleLayout} /></label>
                  <label>H<input type="range" min="0.02" max="0.6" step="0.005" bind:value={ann.h} oninput={scheduleLayout} /></label>
                </div>
                <label class="check small"><input type="checkbox" bind:checked={ann.enlarge} onchange={scheduleLayout} /> {m.gelEnlarge()}</label>
              {:else if ann.type === 'arrow'}
                <label class="inline">{m.gelArrowSide()}
                  <select class="pix-select tiny" value={ann.side} onchange={(e) => { ann.side = (e.currentTarget as HTMLSelectElement).value as 'left' | 'right'; scheduleLayout(); }}>
                    <option value="left">{m.gelSideLeft()}</option>
                    <option value="right">{m.gelSideRight()}</option>
                  </select>
                </label>
                <input class="pix-input" type="text" bind:value={ann.label} placeholder={m.gelAnnotationLabel()} oninput={scheduleLayout} />
              {:else if ann.type === 'bracket'}
                <label class="inline">{m.gelSide()}
                  <select class="pix-select tiny" value={ann.side} onchange={(e) => { ann.side = (e.currentTarget as HTMLSelectElement).value as typeof ann.side; scheduleLayout(); }}>
                    <option value="left">{m.gelSideLeft()}</option>
                    <option value="right">{m.gelSideRight()}</option>
                    <option value="top">{m.gelSideTop()}</option>
                    <option value="bottom">{m.gelSideBottom()}</option>
                  </select>
                </label>
                <div class="mini-grid">
                  <label>{m.gelBracketRange()}<input type="range" min="0" max="1" step="0.005" bind:value={ann.start} oninput={scheduleLayout} /></label>
                  <label>→<input type="range" min="0" max="1" step="0.005" bind:value={ann.end} oninput={scheduleLayout} /></label>
                </div>
                <input class="pix-input" type="text" bind:value={ann.label} placeholder={m.gelAnnotationLabel()} oninput={scheduleLayout} />
              {:else}
                <label class="inline">{m.gelSide()}
                  <select class="pix-select tiny" value={ann.side} onchange={(e) => { ann.side = (e.currentTarget as HTMLSelectElement).value as typeof ann.side; scheduleLayout(); }}>
                    <option value="left">{m.gelSideLeft()}</option>
                    <option value="right">{m.gelSideRight()}</option>
                    <option value="top">{m.gelSideTop()}</option>
                    <option value="bottom">{m.gelSideBottom()}</option>
                  </select>
                </label>
                <input class="pix-input" type="text" bind:value={ann.text} placeholder={m.gelCaptionText()} oninput={scheduleLayout} />
                <label class="row"><span>{m.gelCaptionPos()}</span>
                  <input type="range" min="0" max="1" step="0.01" bind:value={ann.pos} oninput={scheduleLayout} />
                </label>
              {/if}
              <div class="ann-foot">
                <label class="inline">Aa
                  <input class="pix-input num" type="number" min="5" max="24" step="0.5"
                    value={ann.fontSize ?? project.layout.labelFontSize}
                    onchange={(e) => { ann.fontSize = Number((e.currentTarget as HTMLInputElement).value); scheduleLayout(); }} />
                </label>
                <label class="inline">{m.gelAnnotationColor()}
                  <select class="pix-select tiny" value={ann.color} onchange={(e) => { ann.color = (e.currentTarget as HTMLSelectElement).value as 'default' | 'red'; scheduleLayout(); }}>
                    <option value="default">{m.gelDefaultColor()}</option>
                    <option value="red">{m.gelRed()}</option>
                  </select>
                </label>
                <button class="icon danger" onclick={() => deleteAnnotation(ann.id)} title={m.gelDeleteAnnotation()}><Trash2 size={11} /></button>
              </div>
            </div>
          {/each}
        </div>
      </details>

      <details>
        <summary><Type size={11} /> {m.gelLayout()}</summary>
        <div class="sec-body">
          <label class="row">
            <span>{m.gelFontFamily()}</span>
            <select class="pix-select" value={project.layout.fontFamily} onchange={(e) => { project.layout.fontFamily = (e.currentTarget as HTMLSelectElement).value as GelLayoutSettings['fontFamily']; scheduleLayout(); schedulePersist(); }}>
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Calibri">Calibri</option>
              <option value="Cambria">Cambria</option>
            </select>
          </label>
          <div class="mini-grid">
            <label>{m.gelNameFontSize()}<input class="pix-input num" type="number" min="4" max="24" step="0.5" bind:value={project.layout.nameFontSize} oninput={scheduleLayout} /></label>
            <label>{m.gelLabelFontSize()}<input class="pix-input num" type="number" min="4" max="24" step="0.5" bind:value={project.layout.labelFontSize} oninput={scheduleLayout} /></label>
            <label>{m.gelNameAngle()}<input class="pix-input num" type="number" min="0" max="90" step="1" bind:value={project.layout.nameAngle} oninput={scheduleLayout} /></label>
            <label>{m.gelFigureWidth()} (mm)<input class="pix-input num" type="number" min="60" max="300" step="5" bind:value={project.layout.figureWidthMm} oninput={scheduleLayout} /></label>
          </div>
          <div class="btn-row">
            {#each [85, 120, 180] as mm (mm)}
              <button class="pix-btn tiny-btn" class:active={project.layout.figureWidthMm === mm}
                onclick={() => { project.layout.figureWidthMm = mm; scheduleLayout(); schedulePersist(); }}>{mm} mm</button>
            {/each}
          </div>
          <label class="row">
            <span>{m.gelGroupLabelFit()}</span>
            <select class="pix-select" value={project.layout.groupLabelFit} onchange={(e) => { project.layout.groupLabelFit = (e.currentTarget as HTMLSelectElement).value as GelLayoutSettings['groupLabelFit']; scheduleLayout(); }}>
              <option value="wrap">{m.gelFitWrap()}</option>
              <option value="shrink">{m.gelFitShrink()}</option>
              <option value="one">{m.gelFitOne()}</option>
            </select>
          </label>
          <label class="check small"><input type="checkbox" bind:checked={project.layout.red} /> {m.gelRedAnnotations()}</label>
          <label class="check small"><input type="checkbox" bind:checked={project.layout.conditionsNearestGel} onchange={scheduleLayout} /> {m.gelConditionsNearestGel()}</label>
          <div class="style-box">
            <div class="pix-dim tiny">{m.gelStyles()}</div>
            <div class="btn-row">
              <input class="pix-input" type="text" bind:value={styleName} placeholder={m.gelStyleName()} />
              <button class="pix-btn small" onclick={saveCurrentStyle}>{m.gelSaveStyle()}</button>
            </div>
            {#each styles as style (style.id)}
              <div class="condition-row">
                <button class="link" onclick={() => applyStyle(style)}>{style.name}</button>
                <button class="icon danger" onclick={() => deleteStyle(style.id)}><Trash2 size={11} /></button>
              </div>
            {:else}
              <div class="pix-dim tiny">{m.gelNoStyles()}</div>
            {/each}
          </div>
          <div class="style-box">
            <div class="pix-dim tiny"><Clock size={10} /> {m.gelRecent()}</div>
            {#each recents as recent (recent.id)}
              <div class="condition-row">
                {#if recentEdit?.id === recent.id}
                  <input class="pix-input" type="text" value={recentEdit.name}
                    oninput={(e) => { if (recentEdit) recentEdit.name = e.currentTarget.value; }}
                    onblur={commitRecentRename}
                    onkeydown={(e) => { if (e.key === 'Enter') commitRecentRename(); }} />
                {:else}
                  <button class="link" onclick={() => openRecent(recent.id)}>{recent.name}</button>
                  <button class="icon" onclick={() => { recentEdit = { id: recent.id, name: recent.name }; }} title={m.gelRecentRename()}><Type size={11} /></button>
                {/if}
                <span class="pix-dim tiny">{new Date(recent.updatedAt).toLocaleDateString()}</span>
                <button class="icon danger" onclick={() => deleteRecent(recent.id)} title={m.gelRecentRemove()}><Trash2 size={11} /></button>
              </div>
            {:else}
              <div class="pix-dim tiny">{m.gelNoRecent()}</div>
            {/each}
          </div>
        </div>
      </details>

      <details open>
        <summary><Download size={11} /> {m.gelExportSection()}</summary>
        <div class="sec-body">
          <div class="btn-row">
            <label class="inline">{m.gelDpi()}
              <select class="pix-select tiny" value={exportDpi} onchange={(e) => { exportDpi = Number((e.currentTarget as HTMLSelectElement).value); }}>
                <option value="300">300</option>
                <option value="600">600</option>
                <option value="1200">1200</option>
              </select>
            </label>
          </div>
          <div class="btn-grid">
            <button class="pix-btn" disabled={!hasImage} onclick={exportPngNow}>{m.gelExportPng()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportTiffNow}>{m.gelExportTiff()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportSvgNow}>{m.gelExportSvg()}</button>
            <button class="pix-btn" disabled={!hasImage || !!busy} onclick={exportPptxNow}><Presentation size={11} /> {m.gelExportPptx()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportUncroppedNow}>{m.gelExportUncropped()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportOriginalNow}>{m.gelExportOriginal()}</button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportLogNow}><FileText size={11} /> {m.gelExportLog()}</button>
            <button class="pix-btn" disabled={!hasImage || !!busy} onclick={exportReproNow}><Package size={11} /> {g.gelReproBundle()}</button>
          </div>
          <div class="preflight">
            <div class="pix-dim tiny">{m.gelPreflight()}</div>
            {#if !preflightItems.length}
              <div class="ok-line">{m.gelAllGood()}</div>
            {:else}
              {#each preflightItems as item (item.id)}
                <div class="check-line" class:warn={item.severity === 'warn'}>
                  <span>{preflightText(item)}</span>
                  {#if item.id === 'resolution'}
                    <button class="pix-btn tiny-btn" onclick={applyResolutionFix}>{m.gelFixResolution()}</button>
                  {:else if item.id === 'clip'}
                    <button class="pix-btn tiny-btn" onclick={resetLevels}>{m.gelFixLevels()}</button>
                  {:else if item.id === 'tinyFont'}
                    <button class="pix-btn tiny-btn" onclick={fixTinyFont}>{m.gelFixFont()}</button>
                  {:else if item.id === 'ladder'}
                    <button class="pix-btn tiny-btn" onclick={() => detectMarkers(true)}>{m.gelDetectMarkers()}</button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </details>

      <details>
        <summary><Layers size={11} /> {g.gelBatchTitle()}</summary>
        <div class="sec-body">
          <GelBatch customLadders={project.customLadders} exportDpi={exportDpi} />
        </div>
      </details>
    </aside>

    <div class="gel-stage-wrap">
      <div class="stage-head">
        <span>{m.gelOverlayLabel()}</span>
        <span class="zoom-tools">
          <button class="pix-btn tiny-btn" onclick={() => { sourceZoom = Math.max(1, sourceZoom / 1.5); drawSource(); }} title={m.gelZoomOut()}>−</button>
          <span class="pix-dim tiny">{Math.round(sourceZoom * 100)}%</span>
          <button class="pix-btn tiny-btn" onclick={() => { sourceZoom = Math.min(8, sourceZoom * 1.5); drawSource(); }} title={m.gelZoomIn()}>+</button>
          <button class="pix-btn tiny-btn" onclick={() => { sourceZoom = 1; drawSource(); }} title={m.gelZoomFit()}>{m.gelZoomFit()}</button>
        </span>
      </div>
      <div class="gel-stage" bind:this={sourceStage}>
        {#if hasImage}
          <div class="canvas-stack">
            <canvas bind:this={sourceCanvas} class="display-canvas"></canvas>
            <canvas
              bind:this={sourceOverlay}
              class="overlay-canvas"
              aria-label={m.gelOverlayLabel()}
              onpointerdown={onSourcePointerDown}
              onpointermove={onSourcePointerMove}
              onpointerup={onSourcePointerUp}
              onpointercancel={onSourcePointerUp}
            ></canvas>
          </div>
        {:else}
          <div class="stage-empty">{m.gelNoImage()}</div>
        {/if}
      </div>
    </div>

    <div class="figure-pane">
      <div class="stage-head"><span>{m.gelFigurePreview()}</span><span class="pix-dim tiny">{m.gelFigureHint()}</span></div>
      <div class="figure-scroll" bind:this={figureWrap}>
        {#if layout && hasImage}
          <div class="figure-stack" style="width:{Math.round(layout.width * figScale)}px;height:{Math.round(layout.height * figScale)}px;">
            <canvas
              bind:this={figureCanvas}
              class="figure-canvas"
              aria-label={m.gelFigurePreview()}
              onpointerdown={onFigurePointerDown}
              onpointermove={onFigurePointerMove}
              onpointerup={onFigurePointerUp}
              onpointercancel={onFigurePointerUp}
              ondblclick={onFigureDoubleClick}
            ></canvas>
            {#if editingLane}
              <input
                bind:this={nameInput}
                class="name-editor"
                style="left:{editingLane.x}px;top:{editingLane.y}px;width:{editingLane.w}px;"
                bind:value={editingLane.value}
                onkeydown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitNameEdit(true); }
                  else if (e.key === 'Escape') { e.preventDefault(); editingLane = null; }
                }}
                onblur={() => commitNameEdit(false)}
              />
            {/if}
          </div>
        {:else}
          <div class="stage-empty">{m.gelNoImage()}</div>
        {/if}
      </div>
      <div class="keyboard-hint">{m.gelKeyboardHint()}</div>
    </div>
  </div>
</div>

<style>
  .gel-page { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 10px; min-height: 0; overflow: hidden; font-family: var(--pix-font); font-size: 10px; }
  .gel-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 8px; border: 1px solid var(--pix-border); background: var(--pix-bg-2); }
  .gel-toolbar .pix-btn { padding: 4px 9px; font-size: 9.5px; display: inline-flex; align-items: center; gap: 4px; }
  .pix-btn.accent { border-color: var(--pix-accent); color: var(--pix-accent); }
  .pix-btn.ok { border-color: var(--pix-green); color: var(--pix-green); }
  .pix-btn.danger, .icon.danger { color: var(--pix-red); }
  .pix-btn.active { border-color: var(--pix-cyan); color: var(--pix-cyan); background: var(--pix-bg-2); }
  .spacer { flex: 1; }
  .gel-body { flex: 1; display: flex; gap: 8px; min-height: 0; }
  .gel-side { width: 318px; min-width: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; }
  details { border: 1px solid var(--pix-border); background: var(--pix-bg-2); }
  summary { cursor: pointer; padding: 5px 7px; font-weight: bold; color: var(--pix-accent-2); font-size: 10px; display: flex; align-items: center; gap: 5px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  .sec-body { padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; flex-direction: column; gap: 2px; color: var(--pix-fg-dim); font-size: 9.5px; }
  .row output { color: var(--pix-fg); font-weight: bold; }
  .row input[type="range"] { width: 100%; }
  .check { display: flex; align-items: center; gap: 5px; color: var(--pix-fg); cursor: pointer; }
  .check.small { font-size: 9px; }
  .inline { display: inline-flex; align-items: center; gap: 4px; color: var(--pix-fg-dim); font-size: 9px; }
  .btn-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .btn-row.wrap { flex-wrap: wrap; }
  .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .pix-btn.small, .pix-btn.tiny-btn { padding: 2px 6px; font-size: 8.5px; display: inline-flex; align-items: center; gap: 3px; }
  .icon { background: none; border: none; cursor: pointer; color: var(--pix-fg-dim); padding: 1px; display: inline-flex; }
  .icon:hover { color: var(--pix-fg); }
  .link { background: none; border: none; color: var(--pix-cyan); cursor: pointer; text-align: left; font-size: 9.5px; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pix-dim { color: var(--pix-fg-dim); }
  .tiny { font-size: 8.5px; }
  .empty-hint { color: var(--pix-fg-dim); font-size: 9.5px; padding: 4px 0; }
  .exposure-list { display: flex; flex-direction: column; gap: 2px; }
  .exposure-row { display: flex; align-items: center; gap: 4px; padding: 2px 3px; border: 1px solid transparent; }
  .exposure-row.active { border-color: var(--pix-cyan); background: rgba(76,214,255,0.06); }
  .exposure-row .link { flex: 1; }
  .best { color: var(--pix-green); font-size: 8px; border: 1px solid var(--pix-green); padding: 0 2px; }
  .crop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
  .crop-grid label { display: flex; flex-direction: column; font-size: 8.5px; color: var(--pix-fg-dim); gap: 1px; }
  .lane-list { display: flex; flex-direction: column; gap: 3px; max-height: 280px; overflow-y: auto; }
  .lane-row { display: flex; align-items: center; gap: 3px; padding: 2px 3px; border: 1px solid transparent; }
  .lane-row.active { border-color: var(--pix-accent-2); background: rgba(255,159,28,0.06); }
  .lane-row.removed { opacity: 0.65; }
  .lane-pick { min-width: 22px; font-size: 9px; color: var(--pix-cyan); cursor: pointer; text-align: left; }
  .lane-name { flex: 1; min-width: 0; padding: 1px 3px; font-size: 9px; height: 18px; }
  .lane-row .pix-btn { padding: 1px 4px; font-size: 8.5px; white-space: nowrap; }
  .fit-line { font-size: 9px; color: var(--pix-green); }
  .custom-ladder { display: flex; flex-direction: column; gap: 3px; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .bulk-names { display: flex; flex-direction: column; gap: 3px; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .bulk-names textarea { resize: vertical; min-height: 34px; font-size: 9px; line-height: 1.3; }
  .custom-ladder .pix-input { font-size: 9px; height: 20px; padding: 1px 4px; }
  .condition-row { display: flex; align-items: center; gap: 4px; }
  .condition-row .pix-input { flex: 1; min-width: 0; font-size: 9px; height: 20px; padding: 1px 4px; }
  .ann-card { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--pix-border); padding: 4px; background: var(--pix-bg-3); }
  .ann-card.active { border-color: var(--pix-accent-2); }
  .ann-head { background: none; border: none; color: var(--pix-fg); text-align: left; cursor: pointer; font-size: 9px; font-weight: bold; padding: 0; }
  .ann-foot { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 6px; }
  .mini-grid label { display: flex; flex-direction: column; gap: 1px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .style-box { display: flex; flex-direction: column; gap: 3px; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .detect-advanced { border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .detect-advanced summary { padding: 2px 0; font-size: 9px; color: var(--pix-fg-dim); }
  .advanced-body { display: flex; flex-direction: column; gap: 5px; padding: 4px 0 0 4px; }
  .detect-stale { color: var(--pix-accent); font-size: 8.5px; }
  .detect-confirm { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--pix-accent); padding: 4px; font-size: 8.5px; }
  .style-box .pix-input { flex: 1; min-width: 0; font-size: 9px; height: 20px; padding: 1px 4px; }
  .preflight { display: flex; flex-direction: column; gap: 3px; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .check-line { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .check-line.warn { color: var(--pix-accent); }
  .ok-line { color: var(--pix-green); font-size: 9px; }
  .gel-stage-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .stage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 9px; font-weight: bold; color: var(--pix-accent-2); }
  .gel-stage { flex: 1; min-height: 260px; overflow: auto; display: flex; align-items: center; justify-content: center; border: 1px solid var(--pix-border); background: #04060a; padding: 6px; }
  .canvas-stack { position: relative; display: inline-block; flex: none; }
  .zoom-tools { display: inline-flex; align-items: center; gap: 3px; }
  .zoom-tools .pix-btn { padding: 1px 5px; font-size: 9px; }
  .lane-style { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; border: 1px dashed var(--pix-border); padding: 4px; }
  .lane-style label { display: inline-flex; align-items: center; gap: 3px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .lane-style .pix-input { width: 44px; height: 18px; font-size: 9px; padding: 0 3px; }
  .display-canvas { display: block; }
  .overlay-canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
  .stage-empty { color: var(--pix-fg-dim); font-size: 11px; padding: 40px 0; }
  .figure-pane { width: 46%; min-width: 340px; max-width: 760px; display: flex; flex-direction: column; gap: 4px; }
  .figure-scroll { flex: 1; min-height: 240px; overflow: auto; border: 1px solid var(--pix-border); background: #04060a; padding: 8px; display: flex; align-items: flex-start; justify-content: center; }
  .figure-stack { position: relative; background: #fff; }
  .figure-canvas { display: block; touch-action: none; cursor: pointer; }
  .name-editor { position: absolute; font: 10px monospace; padding: 1px 3px; border: 1px solid var(--pix-accent); background: #fff; color: #111; z-index: 2; }
  .keyboard-hint { font-size: 8.5px; color: var(--pix-fg-dim); }
  @media (max-width: 1180px) {
    .gel-body { flex-wrap: wrap; }
    .gel-side { width: 100%; max-height: 42vh; }
    .figure-pane { width: 100%; max-width: none; }
  }
</style>
