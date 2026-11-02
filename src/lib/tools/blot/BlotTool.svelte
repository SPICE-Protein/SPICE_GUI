<script lang="ts">
  // Western blot densitometry workstation: import a scan, define lanes and
  // band ROIs, quantify net signal with local background correction, normalise
  // against a loading-control lane or total lane signal, and export a figure.
  // Everything runs locally in the webview.
  import { onMount, tick } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import {
    Upload, Download, Save, FolderOpen, Undo2, Redo2, Trash2, Plus, RotateCcw,
    RotateCw, Wand2, Crosshair, Crop, Layers, MousePointer2, Eye, EyeOff,
    RefreshCw, FileText, Eraser, ZoomIn, ZoomOut, ScanLine, MousePointerClick,
  } from 'lucide-svelte';
  import {
    decodeImageFile, loadImageElement, renderProcessed, rotateCoordinates,
    cropPixels, type ProcessedImage,
  } from './image';
  import {
    detectLanes, detectBands, bandsFromDetection, lanesFromDetection,
    lanesFromCount,
  } from './detect';
  import { quantify } from './quant';
  import {
    annotatedCanvas, annotatedPng, chartSvg, figureSvg, resultsCsv,
  } from './render';
  import { loadSnapshot, saveSnapshot, clearSnapshot } from './storage';
  import {
    emptyProject, newId, snapshotProject, restoreSnapshot, sanitizeProject,
    clamp, type BlotProject, type BlotLane, type BlotBand,
  } from './types';

  // ------------------------------------------------------------------ state

  let project = $state<BlotProject>(emptyProject());
  let processed = $state.raw<ProcessedImage | null>(null);
  let imageEl = $state<HTMLImageElement | null>(null);

  let imageInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let stageEl = $state<HTMLDivElement | null>(null);
  let stageCanvas = $state<HTMLCanvasElement | null>(null);
  let stageOverlay = $state<HTMLCanvasElement | null>(null);

  let selectedLaneId = $state<string | null>(null);
  let selectedBandId = $state<string | null>(null);
  let mode = $state<'select' | 'addBand' | 'crop'>('select');
  let rightTab = $state<'results' | 'chart' | 'figure'>('results');
  let zoom = $state(1);
  let busy = $state('');
  let canUndo = $state(false);
  let canRedo = $state(false);
  let dragCropActive = $state(false);

  let history: string[] = [];
  let future: string[] = [];
  let lastCheckpoint = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let quotaWarned = false;
  let renderRaf = 0;
  let figureTimer: ReturnType<typeof setTimeout> | null = null;
  let figureMarkup = $state('');
  let lastCropDrag: { startNx: number; startNy: number; nx: number; ny: number } | null = null;

  type DragKind =
    | 'lane-move'
    | 'lane-left'
    | 'lane-right'
    | 'band-move'
    | 'band-top'
    | 'band-bottom'
    | 'band-left'
    | 'band-right'
    | 'crop';
  interface DragState {
    kind: DragKind;
    laneId?: string;
    bandId?: string;
    startX: number;
    startY: number;
    origX: number;
    origWidth: number;
    origY: number;
    origHeight: number;
    crop?: BlotProject['crop'];
  }
  let drag: DragState | null = null;

  // --------------------------------------------------------------- derived

  const hasImage = $derived(!!project.imageDataUrl);
  const orderedLanes = $derived([...project.lanes].sort((a, b) => a.x - b.x));
  const selectedLane = $derived(project.lanes.find((lane) => lane.id === selectedLaneId) ?? null);
  const selectedBandRef = $derived.by(() => {
    if (!selectedLane || !selectedBandId) return null;
    const band = selectedLane.bands.find((b) => b.id === selectedBandId);
    return band ? { lane: selectedLane, band } : null;
  });
  const groups = $derived.by(() => {
    const out: string[] = [];
    for (const lane of project.lanes) {
      const name = lane.group.trim();
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  });
  const metricLabel = $derived(
    project.chartMetric === 'fold' ? m.blotFoldChange() : m.blotNormalizedSignal(),
  );
  const quant = $derived.by(() => {
    if (!processed) return null;
    return quantify(project, {
      gray: processed.rawGray,
      width: processed.width,
      height: processed.height,
      project,
    });
  });
  const chartMarkup = $derived.by(() => {
    if (!quant) return '';
    return chartSvg(quant, project, {
      width: 560,
      height: 380,
      metricLabel: metricLabel,
      title: project.chartTitle || undefined,
      emptyLabel: m.blotNoResults(),
      nLabel: m.blotColumnN(),
      noGroupLabel: m.blotNoGroup(),
    });
  });

  // ------------------------------------------------------------- lifecycle

  onMount(() => {
    if (!project.title) project.title = m.blotDefaultTitle();
    const snap = loadSnapshot();
    if (snap) {
      project = snap;
      if (!project.title) project.title = m.blotDefaultTitle();
      selectedLaneId = project.lanes[0]?.id ?? null;
      void loadProjectImage();
    }
    const observer = new ResizeObserver(() => drawStage());
    if (stageEl) observer.observe(stageEl);
    window.addEventListener('keydown', onKeydown);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onKeydown);
      if (persistTimer) clearTimeout(persistTimer);
      if (figureTimer) clearTimeout(figureTimer);
      if (renderRaf) cancelAnimationFrame(renderRaf);
    };
  });

  // Rebuild the figure preview after edits settle; embedding the blot as a data
  // URL is the expensive part, so the work is debounced.
  $effect(() => {
    const proc = processed;
    const result = quant;
    // Reading the stripped snapshot tracks every project field.
    const tracked = snapshotProject(project);
    void tracked;
    if (figureTimer) clearTimeout(figureTimer);
    if (!proc || !result || !hasImage) {
      figureMarkup = '';
      return;
    }
    figureTimer = setTimeout(() => {
      figureMarkup = figureSvg(project, proc.canvas, result, {
        title: project.title,
        chartTitle: project.chartTitle,
        metricLabel,
        emptyLabel: m.blotNoResults(),
        nLabel: m.blotColumnN(),
        noGroupLabel: m.blotNoGroup(),
        footer: m.blotFigureFooter(),
      });
    }, 140);
    return () => {
      if (figureTimer) clearTimeout(figureTimer);
    };
  });

  async function loadProjectImage() {
    if (!project.imageDataUrl) {
      imageEl = null;
      processed = null;
      drawStage();
      return;
    }
    try {
      imageEl = await loadImageElement(project.imageDataUrl);
      await refreshProcessed();
      syncNormalization();
    } catch {
      toast(false, m.blotDecodeFailed());
    }
  }

  // ------------------------------------------------------------- processing

  function normalizeCrop() {
    const crop = project.crop;
    crop.left = clamp(crop.left, 0, 0.9);
    crop.top = clamp(crop.top, 0, 0.9);
    crop.right = clamp(crop.right, 0, 0.9);
    crop.bottom = clamp(crop.bottom, 0, 0.9);
    const maxSpan = 0.98;
    if (crop.left + crop.right > maxSpan) {
      const scale = maxSpan / (crop.left + crop.right);
      crop.left *= scale;
      crop.right *= scale;
    }
    if (crop.top + crop.bottom > maxSpan) {
      const scale = maxSpan / (crop.top + crop.bottom);
      crop.top *= scale;
      crop.bottom *= scale;
    }
  }

  async function refreshProcessed() {
    if (!imageEl) {
      processed = null;
      drawStage();
      return;
    }
    normalizeCrop();
    processed = renderProcessed(project, imageEl);
    await tick();
    drawStage();
  }

  function scheduleRender() {
    if (renderRaf) cancelAnimationFrame(renderRaf);
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      void refreshProcessed();
    });
  }

  function schedulePersist() {
    project.updatedAt = new Date().toISOString();
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!saveSnapshot(project) && !quotaWarned) {
        quotaWarned = true;
        toast(false, m.blotQuotaWarn());
      }
    }, 700);
  }

  function toast(ok: boolean, message: string) {
    pushToast(ok ? 'success' : 'error', m.blotTitle(), message);
  }

  // ------------------------------------------------------------ history

  function checkpoint(force = false) {
    const now = Date.now();
    if (!force && now - lastCheckpoint < 600) return;
    history.push(snapshotProject(project));
    if (history.length > 60) history.shift();
    future = [];
    lastCheckpoint = now;
    canUndo = true;
    canRedo = false;
  }

  function commit(fn: () => void) {
    checkpoint();
    fn();
    drawStage();
    schedulePersist();
  }

  function undo() {
    const snapshot = history.pop();
    if (!snapshot) return;
    const current = snapshotProject(project);
    const restored = restoreSnapshot(snapshot, project.imageDataUrl);
    if (!restored) return;
    future.push(current);
    project = restored;
    canUndo = history.length > 0;
    canRedo = true;
    pruneSelection();
    syncNormalization();
    scheduleRender();
    schedulePersist();
  }

  function redo() {
    const snapshot = future.pop();
    if (!snapshot) return;
    const current = snapshotProject(project);
    const restored = restoreSnapshot(snapshot, project.imageDataUrl);
    if (!restored) return;
    history.push(current);
    project = restored;
    canUndo = true;
    canRedo = future.length > 0;
    pruneSelection();
    syncNormalization();
    scheduleRender();
    schedulePersist();
  }

  function pruneSelection() {
    if (selectedLaneId && !project.lanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = null;
      selectedBandId = null;
    }
    if (selectedBandId && !(selectedLane?.bands ?? []).some((band) => band.id === selectedBandId)) {
      selectedBandId = null;
    }
  }

  function syncNormalization() {
    const laneIds = new Set(project.lanes.map((lane) => lane.id));
    if (!project.normalization.loadingLaneId || !laneIds.has(project.normalization.loadingLaneId)) {
      project.normalization.loadingLaneId = orderedLanes[0]?.id ?? null;
    }
    if (!groups.includes(project.normalization.controlGroup)) {
      project.normalization.controlGroup = groups[0] ?? '';
    }
  }

  // ---------------------------------------------------------------- import

  async function onPickImage(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (imageInput) imageInput.value = '';
    if (!file) return;
    await importImageFile(file);
  }

  async function importImageFile(file: File) {
    busy = m.blotBusyImport();
    try {
      const decoded = await decodeImageFile(file);
      imageEl = await loadImageElement(decoded.dataUrl);
      checkpoint(true);
      project = {
        ...emptyProject(),
        createdAt: new Date().toISOString(),
        imageName: decoded.name,
        imageDataUrl: decoded.dataUrl,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        title: m.blotDefaultTitle(),
      };
      selectedLaneId = null;
      selectedBandId = null;
      history = [];
      future = [];
      canUndo = false;
      canRedo = false;
      await refreshProcessed();
      await autoDetect(false);
      schedulePersist();
    } catch {
      toast(false, m.blotDecodeFailed());
    } finally {
      busy = '';
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])][0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) await openProjectFile(file);
    else await importImageFile(file);
  }

  async function onPickProject(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (projectInput) projectInput.value = '';
    if (file) await openProjectFile(file);
  }

  async function openProjectFile(file: File) {
    try {
      const parsed = sanitizeProject(JSON.parse(await file.text()));
      if (!parsed) throw new Error(m.blotProjectInvalid());
      project = parsed;
      if (!project.title) project.title = m.blotDefaultTitle();
      imageEl = null;
      processed = null;
      selectedLaneId = project.lanes[0]?.id ?? null;
      selectedBandId = null;
      history = [];
      future = [];
      canUndo = false;
      canRedo = false;
      await loadProjectImage();
      syncNormalization();
      schedulePersist();
      toast(true, m.blotProjectOpened());
    } catch (err) {
      toast(false, err instanceof Error ? err.message : String(err));
    }
  }

  // ------------------------------------------------------------- detection

  function defaultGroup(): string {
    return m.blotDefaultGroup();
  }

  /** Keep user-placed bands that no longer coincide with a detected peak. */
  function mergeManualBands(lane: BlotLane, detected: BlotBand[]): BlotBand[] {
    const merged = [...detected];
    for (const band of lane.bands) {
      if (band.manual && !merged.some((candidate) => Math.abs(candidate.y - band.y) < 0.012)) {
        merged.push({ ...band });
      }
    }
    return merged.sort((a, b) => a.y - b.y);
  }

  async function autoDetect(notify = true) {
    const proc = processed;
    if (!proc || busy) return;
    busy = m.blotBusyDetect();
    await tick();
    try {
      checkpoint(true);
      const previous = [...project.lanes].sort((a, b) => a.x - b.x);
      const found = detectLanes(proc.rawGray, proc.width, proc.height, project.crop);
      if (!found.length) {
        toast(false, m.blotLanesEmpty());
        return;
      }
      const next = lanesFromDetection(found, project.lanes, defaultGroup());
      next.forEach((lane, index) => {
        const detected = bandsFromDetection(
          detectBands(proc.rawGray, proc.width, proc.height, lane, project.crop),
          lane.width,
        );
        const carried = previous[index]?.bands.filter((band) => band.manual).map((band) => ({
          ...band,
          id: newId('band'),
          width: lane.width * 0.9,
        })) ?? [];
        lane.bands = mergeManualBands({ ...lane, bands: carried }, detected);
      });
      project.lanes = next;
      selectedLaneId = next[0]?.id ?? null;
      selectedBandId = null;
      syncNormalization();
      drawStage();
      schedulePersist();
      if (notify) toast(true, m.blotLanesFound({ n: next.length }));
    } finally {
      busy = '';
    }
  }

  function detectBandsFor(lane: BlotLane) {
    if (!processed) return;
    const found = detectBands(processed.rawGray, processed.width, processed.height, lane, project.crop);
    if (!found.length) {
      toast(false, m.blotBandsNone());
      return;
    }
    const merged = mergeManualBands(lane, bandsFromDetection(found, lane.width));
    commit(() => {
      lane.bands = merged;
      selectedLaneId = lane.id;
      selectedBandId = null;
    });
    toast(true, m.blotBandsFound({ n: merged.length }));
  }

  function detectBandsAll() {
    if (!processed) return;
    let count = 0;
    const next = project.lanes.map((lane) => {
      const found = detectBands(processed!.rawGray, processed!.width, processed!.height, lane, project.crop);
      const merged = mergeManualBands(lane, bandsFromDetection(found, lane.width));
      count += merged.length;
      return { ...lane, bands: merged };
    });
    if (!count) {
      toast(false, m.blotBandsNone());
      return;
    }
    commit(() => {
      project.lanes = next;
      selectedBandId = null;
    });
    toast(true, m.blotBandsFound({ n: count }));
  }

  function setLaneCount(count: number) {
    if (!Number.isFinite(count) || count < 1 || count > 40) return;
    commit(() => {
      project.lanes = lanesFromCount(count, project.lanes, project.crop, defaultGroup());
      selectedBandId = null;
      pruneSelection();
      syncNormalization();
    });
  }

  function addLane() {
    commit(() => {
      const x = selectedLane ? clamp(selectedLane.x + 0.08, 0.02, 0.98) : 0.5;
      const lane: BlotLane = {
        id: newId('lane'),
        x,
        width: 0.05,
        name: String(project.lanes.length + 1),
        sample: '',
        group: defaultGroup(),
        bands: [],
      };
      project.lanes = [...project.lanes, lane];
      selectedLaneId = lane.id;
      selectedBandId = null;
      syncNormalization();
    });
  }

  function removeLane(laneId: string) {
    commit(() => {
      project.lanes = project.lanes.filter((lane) => lane.id !== laneId);
      if (selectedLaneId === laneId) {
        selectedLaneId = null;
        selectedBandId = null;
      }
      syncNormalization();
    });
  }

  function toggleLaneExcluded(lane: BlotLane) {
    commit(() => {
      lane.excluded = !lane.excluded;
    });
  }

  // ---------------------------------------------------------------- bands

  function addBandAt(nx: number, ny: number) {
    if (!processed) return;
    let lane = project.lanes.find(
      (candidate) => Math.abs(nx - candidate.x) <= candidate.width / 2 && !candidate.excluded,
    );
    commit(() => {
      if (!lane) {
        lane = {
          id: newId('lane'),
          x: clamp(nx, 0.02, 0.98),
          width: 0.05,
          name: String(project.lanes.length + 1),
          sample: '',
          group: defaultGroup(),
          bands: [],
        };
        project.lanes = [...project.lanes, lane];
      }
      const target: BlotLane = lane;
      const band: BlotBand = {
        id: newId('band'),
        y: clamp(ny, 0.005, 0.995),
        height: 0.03,
        width: Math.max(0.008, target.width * 0.8),
        manual: true,
        excluded: false,
      };
      target.bands = [...target.bands, band];
      selectedLaneId = target.id;
      selectedBandId = band.id;
      syncNormalization();
    });
  }

  function removeBand(laneId: string, bandId: string) {
    commit(() => {
      const lane = project.lanes.find((candidate) => candidate.id === laneId);
      if (!lane) return;
      lane.bands = lane.bands.filter((band) => band.id !== bandId);
      if (selectedBandId === bandId) selectedBandId = null;
    });
  }

  function deleteSelectedBand() {
    if (!selectedBandRef) return;
    removeBand(selectedBandRef.lane.id, selectedBandRef.band.id);
  }

  function toggleBandExcluded(lane: BlotLane, band: BlotBand) {
    commit(() => {
      band.excluded = !band.excluded;
    });
  }

  function findBand(laneId: string, bandId: string): { lane: BlotLane; band: BlotBand } | null {
    const lane = project.lanes.find((candidate) => candidate.id === laneId);
    const band = lane?.bands.find((candidate) => candidate.id === bandId);
    return lane && band ? { lane, band } : null;
  }

  function updateBand(patch: Partial<BlotBand>) {
    if (!selectedBandRef) return;
    commit(() => {
      Object.assign(selectedBandRef!.band, patch);
    });
  }

  function nudgeSelectedBand(delta: number) {
    if (!selectedBandRef) return;
    commit(() => {
      selectedBandRef!.band.y = clamp(selectedBandRef!.band.y + delta, 0.005, 0.995);
    });
  }

  // -------------------------------------------------------- image controls

  function setDisplay(display: 'gray' | 'color') {
    if (project.adjust.display === display) return;
    commit(() => {
      project.adjust.display = display;
    });
    scheduleRender();
  }

  function resetLevels() {
    commit(() => {
      project.adjust.contrast = 1;
      project.adjust.brightness = 0;
      project.adjust.gamma = 1;
      project.adjust.invert = false;
    });
    scheduleRender();
  }

  function autoLevels() {
    if (!processed) return;
    const values = processed.rawGray;
    const sample: number[] = [];
    const step = Math.max(1, Math.floor(values.length / 20000));
    for (let i = 0; i < values.length; i += step) sample.push(values[i]);
    sample.sort((a, b) => a - b);
    const pick = (p: number) => sample[Math.min(sample.length - 1, Math.floor(sample.length * p))] ?? 0;
    const lo = pick(0.02);
    const hi = pick(0.98);
    commit(() => {
      project.adjust.brightness = 0;
      if (hi - lo < 0.02) {
        project.adjust.contrast = 1;
        project.adjust.gamma = 1;
        return;
      }
      const contrast = Math.min(1.9, Math.max(1, 0.9 / (hi - lo)));
      const mid = clamp((lo + hi) / 2, 0.05, 0.95);
      const shifted = clamp((mid - 0.5) * contrast + 0.5, 0.05, 0.95);
      const gamma = Math.log(0.5) / Math.log(shifted);
      project.adjust.contrast = Math.round(contrast * 100) / 100;
      project.adjust.gamma = Math.round(clamp(gamma, 0.3, 2.5) * 100) / 100;
    });
    scheduleRender();
  }

  function setRotation(next: number) {
    const value = clamp(next, -15, 15);
    if (Math.abs(value - project.rotation) < 0.001) return;
    if (imageEl) {
      rotateCoordinates(project, project.rotation, value, imageEl.naturalWidth, imageEl.naturalHeight);
    }
    project.rotation = value;
    scheduleRender();
    schedulePersist();
  }

  async function rotateQuarter(clockwise: boolean) {
    if (!processed) return;
    const previous = project.lanes;
    checkpoint(true);
    project.orient = (((project.orient + (clockwise ? 1 : 3)) % 4) + 4) % 4;
    project.crop = { left: 0, top: 0, right: 0, bottom: 0 };
    await refreshProcessed();
    const proc = processed;
    if (proc) {
      const found = detectLanes(proc.rawGray, proc.width, proc.height, project.crop);
      const next = lanesFromDetection(found, previous, defaultGroup());
      for (const lane of next) {
        lane.bands = bandsFromDetection(
          detectBands(proc.rawGray, proc.width, proc.height, lane, project.crop),
          lane.width,
        );
      }
      project.lanes = next;
      selectedLaneId = next[0]?.id ?? null;
      selectedBandId = null;
      syncNormalization();
      drawStage();
    }
    schedulePersist();
  }

  function resetCrop() {
    commit(() => {
      project.crop = { left: 0, top: 0, right: 0, bottom: 0 };
    });
    scheduleRender();
  }

  function onCropInput() {
    normalizeCrop();
    scheduleRender();
    schedulePersist();
  }

  // ------------------------------------------------------------ stage draw

  interface StageGeometry {
    cssW: number;
    cssH: number;
    crop: ReturnType<typeof cropPixels>;
    dpr: number;
  }

  function stageGeometry(): StageGeometry | null {
    if (!processed || !stageEl) return null;
    const crop = cropPixels(project, processed.width, processed.height);
    const availW = Math.max(120, stageEl.clientWidth - 18);
    const availH = Math.max(140, stageEl.clientHeight - 18);
    const fit = Math.min(availW / crop.sw, availH / crop.sh, 2) * zoom;
    return {
      cssW: Math.max(20, Math.round(crop.sw * fit)),
      cssH: Math.max(20, Math.round(crop.sh * fit)),
      crop,
      dpr: Math.min(2, window.devicePixelRatio || 1),
    };
  }

  function mapToStage(nx: number, ny: number, geometry: StageGeometry): { x: number; y: number } {
    if (!processed) return { x: 0, y: 0 };
    return {
      x: ((nx * processed.width - geometry.crop.sx) / geometry.crop.sw) * geometry.cssW,
      y: ((ny * processed.height - geometry.crop.sy) / geometry.crop.sh) * geometry.cssH,
    };
  }

  function mapFromStage(px: number, py: number, geometry: StageGeometry): { nx: number; ny: number } {
    if (!processed) return { nx: 0.5, ny: 0.5 };
    return {
      nx: ((px / geometry.cssW) * geometry.crop.sw + geometry.crop.sx) / processed.width,
      ny: ((py / geometry.cssH) * geometry.crop.sh + geometry.crop.sy) / processed.height,
    };
  }

  function drawStage() {
    if (!processed || !stageCanvas || !stageOverlay) return;
    const geometry = stageGeometry();
    if (!geometry) return;
    const { cssW, cssH, dpr, crop } = geometry;
    for (const canvas of [stageCanvas, stageOverlay]) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const ctx = stageCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      processed.canvas,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      cssW,
      cssH,
    );
    drawOverlay(geometry);
  }

  function drawOverlay(geometry: StageGeometry) {
    if (!stageOverlay || !processed) return;
    const { cssW, cssH, dpr } = geometry;
    const ctx = stageOverlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';

    const visibleLeft = project.crop.left;
    const visibleRight = 1 - project.crop.right;
    for (const lane of project.lanes) {
      if (lane.x < visibleLeft || lane.x > visibleRight) continue;
      const left = mapToStage(lane.x - lane.width / 2, 0.5, geometry).x;
      const right = mapToStage(lane.x + lane.width / 2, 0.5, geometry).x;
      const selected = selectedLaneId === lane.id;
      ctx.strokeStyle = lane.excluded
        ? 'rgba(255,93,93,0.9)'
        : selected
          ? '#ff9f1c'
          : 'rgba(76,214,255,0.8)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.setLineDash(lane.excluded ? [5, 3] : []);
      ctx.beginPath();
      ctx.moveTo(left, 0);
      ctx.lineTo(left, cssH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(right, 0);
      ctx.lineTo(right, cssH);
      ctx.stroke();
      ctx.setLineDash([]);
      if (project.showRoi) {
        for (const band of lane.bands) {
          const p0 = mapToStage(lane.x - band.width / 2, band.y - band.height / 2, geometry);
          const p1 = mapToStage(lane.x + band.width / 2, band.y + band.height / 2, geometry);
          const active = selectedBandId === band.id;
          const excluded = lane.excluded || band.excluded;
          ctx.strokeStyle = excluded
            ? 'rgba(255,93,93,0.95)'
            : active
              ? '#ffd23f'
              : 'rgba(83,215,105,0.95)';
          ctx.lineWidth = active ? 2 : 1;
          ctx.setLineDash(excluded ? [4, 3] : []);
          ctx.strokeRect(p0.x, p0.y, Math.max(1, p1.x - p0.x), Math.max(1, p1.y - p0.y));
          ctx.setLineDash([]);
        }
      }
      if (project.showLaneLabels) {
        const label = lane.name || '—';
        ctx.fillStyle = 'rgba(4,6,10,0.7)';
        const width = ctx.measureText(label).width + 6;
        ctx.fillRect(left + 2, 2, width, 14);
        ctx.fillStyle = lane.excluded ? '#ff5d5d' : '#d8e1f2';
        ctx.fillText(label, left + 5, 4);
      }
    }

    if (lastCropDrag && dragCropActive) {
      const a = mapToStage(
        Math.min(lastCropDrag.startNx, lastCropDrag.nx),
        Math.min(lastCropDrag.startNy, lastCropDrag.ny),
        geometry,
      );
      const b = mapToStage(
        Math.max(lastCropDrag.startNx, lastCropDrag.nx),
        Math.max(lastCropDrag.startNy, lastCropDrag.ny),
        geometry,
      );
      ctx.strokeStyle = '#ff9f1c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------- interactions

  function stagePoint(e: PointerEvent): { px: number; py: number; nx: number; ny: number; geometry: StageGeometry } | null {
    if (!stageOverlay) return null;
    const geometry = stageGeometry();
    if (!geometry) return null;
    const rect = stageOverlay.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
    const { nx, ny } = mapFromStage(px, py, geometry);
    return { px, py, nx, ny, geometry };
  }

  function onStagePointerDown(e: PointerEvent) {
    if (!processed || !stageOverlay) return;
    const point = stagePoint(e);
    if (!point) return;
    const geometry = point.geometry;

    if (mode === 'crop') {
      checkpoint(true);
      drag = {
        kind: 'crop',
        startX: point.nx,
        startY: point.ny,
        origX: 0,
        origY: 0,
        origWidth: 0,
        origHeight: 0,
        crop: { ...project.crop },
      };
      lastCropDrag = { startNx: point.nx, startNy: point.ny, nx: point.nx, ny: point.ny };
      dragCropActive = true;
      stageOverlay.setPointerCapture(e.pointerId);
      drawStage();
      return;
    }

    if (mode === 'addBand') {
      addBandAt(point.nx, point.ny);
      stageOverlay.setPointerCapture(e.pointerId);
      return;
    }

    const bandHit = findBandHit(point.px, point.py, geometry);
    if (bandHit) {
      checkpoint(true);
      selectedLaneId = bandHit.lane.id;
      selectedBandId = bandHit.band.id;
      drag = {
        kind: bandHit.edge,
        laneId: bandHit.lane.id,
        bandId: bandHit.band.id,
        startX: point.nx,
        startY: point.ny,
        origX: 0,
        origY: bandHit.band.y,
        origWidth: bandHit.band.width,
        origHeight: bandHit.band.height,
      };
      stageOverlay.setPointerCapture(e.pointerId);
      drawStage();
      return;
    }

    const laneHit = findLaneHit(point.px, geometry);
    if (laneHit) {
      checkpoint(true);
      selectedLaneId = laneHit.lane.id;
      selectedBandId = null;
      drag = {
        kind: laneHit.kind,
        laneId: laneHit.lane.id,
        startX: point.nx,
        startY: point.ny,
        origX: laneHit.lane.x,
        origY: 0,
        origWidth: laneHit.lane.width,
        origHeight: 0,
      };
      stageOverlay.setPointerCapture(e.pointerId);
      drawStage();
      return;
    }

    selectedLaneId = null;
    selectedBandId = null;
    drawStage();
  }

  function findBandHit(px: number, py: number, geometry: StageGeometry) {
    const edge = 5;
    for (const lane of [...project.lanes].reverse()) {
      for (const band of lane.bands) {
        const p0 = mapToStage(lane.x - band.width / 2, band.y - band.height / 2, geometry);
        const p1 = mapToStage(lane.x + band.width / 2, band.y + band.height / 2, geometry);
        if (px < p0.x - edge || px > p1.x + edge || py < p0.y - edge || py > p1.y + edge) continue;
        let kind: DragKind = 'band-move';
        if (Math.abs(py - p0.y) <= edge) kind = 'band-top';
        else if (Math.abs(py - p1.y) <= edge) kind = 'band-bottom';
        else if (Math.abs(px - p0.x) <= edge) kind = 'band-left';
        else if (Math.abs(px - p1.x) <= edge) kind = 'band-right';
        return { lane, band, edge: kind };
      }
    }
    return null;
  }

  function findLaneHit(px: number, geometry: StageGeometry) {
    const edge = 6;
    for (const lane of [...project.lanes].reverse()) {
      const left = mapToStage(lane.x - lane.width / 2, 0.5, geometry).x;
      const right = mapToStage(lane.x + lane.width / 2, 0.5, geometry).x;
      const centre = mapToStage(lane.x, 0.5, geometry).x;
      if (Math.abs(px - left) <= edge) return { lane, kind: 'lane-left' as DragKind };
      if (Math.abs(px - right) <= edge) return { lane, kind: 'lane-right' as DragKind };
      if (Math.abs(px - centre) <= Math.max(edge, (right - left) / 2)) {
        return { lane, kind: 'lane-move' as DragKind };
      }
    }
    return null;
  }

  function onStagePointerMove(e: PointerEvent) {
    if (!drag) return;
    const point = stagePoint(e);
    if (!point) return;
    if (drag.kind === 'crop') {
      lastCropDrag = {
        startNx: drag.startX,
        startNy: drag.startY,
        nx: point.nx,
        ny: point.ny,
      };
      drawStage();
      return;
    }
    const lane = project.lanes.find((candidate) => candidate.id === drag!.laneId);
    if (!lane) return;
    if (drag.kind === 'lane-move') {
      lane.x = clamp(point.nx, 0.01, 0.99);
    } else if (drag.kind === 'lane-left') {
      const right = drag.origX + drag.origWidth / 2;
      const left = clamp(point.nx, 0.001, right - 0.005);
      lane.width = right - left;
      lane.x = (left + right) / 2;
    } else if (drag.kind === 'lane-right') {
      const left = drag.origX - drag.origWidth / 2;
      const right = clamp(point.nx, left + 0.005, 0.999);
      lane.width = right - left;
      lane.x = (left + right) / 2;
    } else {
      const band = lane.bands.find((candidate) => candidate.id === drag!.bandId);
      if (!band) return;
      if (drag.kind === 'band-move') {
        band.y = clamp(point.ny, 0.002, 0.998);
      } else if (drag.kind === 'band-top') {
        const bottom = drag.origY + drag.origHeight / 2;
        const top = clamp(point.ny, 0.0, bottom - 0.004);
        band.height = bottom - top;
        band.y = (top + bottom) / 2;
      } else if (drag.kind === 'band-bottom') {
        const top = drag.origY - drag.origHeight / 2;
        const bottom = clamp(point.ny, top + 0.004, 1.0);
        band.height = bottom - top;
        band.y = (top + bottom) / 2;
      } else if (drag.kind === 'band-left' || drag.kind === 'band-right') {
        band.width = clamp(Math.abs(point.nx - lane.x) * 2, 0.004, 0.8);
      }
    }
    drawStage();
  }

  function onStagePointerUp() {
    if (!drag) return;
    const wasCrop = drag.kind === 'crop';
    const cropStart = drag.crop;
    const cropDrag = lastCropDrag;
    drag = null;
    dragCropActive = false;
    if (wasCrop && cropStart && cropDrag) {
      const visW = 1 - cropStart.left - cropStart.right;
      const visH = 1 - cropStart.top - cropStart.bottom;
      const x0 = cropStart.left + Math.min(cropDrag.startNx, cropDrag.nx) * visW;
      const x1 = cropStart.left + Math.max(cropDrag.startNx, cropDrag.nx) * visW;
      const y0 = cropStart.top + Math.min(cropDrag.startNy, cropDrag.ny) * visH;
      const y1 = cropStart.top + Math.max(cropDrag.startNy, cropDrag.ny) * visH;
      if (x1 - x0 > 0.02 && y1 - y0 > 0.02) {
        project.crop = {
          left: clamp(x0, 0, 0.95),
          top: clamp(y0, 0, 0.95),
          right: clamp(1 - x1, 0, 0.95),
          bottom: clamp(1 - y1, 0, 0.95),
        };
        mode = 'select';
      }
    }
    lastCropDrag = null;
    schedulePersist();
    drawStage();
  }

  // --------------------------------------------------------------- keyboard

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
    if (e.key === 'Escape') {
      mode = 'select';
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedBandId) {
        e.preventDefault();
        deleteSelectedBand();
      }
      return;
    }
    if (selectedBandRef && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudgeSelectedBand((e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 0.008 : 0.002));
    }
  }

  // ----------------------------------------------------------------- export

  function projectBase(): string {
    return (project.imageName || 'blot').replace(/\.[^.]+$/, '');
  }

  async function saveBytes(name: string, bytes: Uint8Array): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, bytes);
      if (result.data?.saved) {
        toast(true, m.blotExported());
        return true;
      }
      toast(false, result.error || m.blotExportFailed());
      return false;
    } catch {
      toast(false, m.blotExportFailed());
      return false;
    }
  }

  async function saveText(name: string, text: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, text);
      if (result.data?.saved) {
        toast(true, m.blotExported());
        return true;
      }
      toast(false, result.error || m.blotExportFailed());
      return false;
    } catch {
      toast(false, m.blotExportFailed());
      return false;
    }
  }

  async function saveProject() {
    if (!hasImage) {
      toast(false, m.blotNoImage());
      return;
    }
    await saveText(`${projectBase()}.blot.json`, JSON.stringify(project, null, 2));
  }

  async function exportCsv() {
    if (!quant || !quant.rows.length) {
      toast(false, m.blotNoResults());
      return;
    }
    const csv = resultsCsv(project, quant, {
      lane: m.blotColumnLane(),
      band: m.blotColumnBand(),
      sample: m.blotColumnSample(),
      group: m.blotColumnGroup(),
      included: m.blotColumnIncluded(),
      area: m.blotColumnArea(),
      mean: m.blotColumnMean(),
      background: m.blotColumnBg(),
      volume: m.blotColumnVolume(),
      saturated: m.blotColumnSat(),
      normalized: m.blotColumnNorm(),
      fold: m.blotColumnFold(),
      groupMean: m.blotColumnGroupMean(),
      groupSd: m.blotColumnSd(),
      groupSem: m.blotColumnSem(),
      groupN: m.blotColumnN(),
      metric: m.blotChartMetric(),
    });
    await saveText(`${projectBase()}_densitometry.csv`, csv);
  }

  async function exportAnnotatedPng() {
    if (!processed) {
      toast(false, m.blotNoImage());
      return;
    }
    busy = m.blotBusyExport();
    try {
      const canvas = annotatedCanvas(project, processed.canvas, {
        selectedLaneId,
        selectedBandId: null,
        laneLabels: project.showLaneLabels,
        roi: project.showRoi,
      });
      const summary = `${project.title || m.blotTitle()}; ${project.lanes.length} lanes; ${project.exportDpi} dpi; background ${project.backgroundMode}; normalisation ${project.normalization.mode}`;
      const bytes = await annotatedPng(canvas, project.exportDpi, summary);
      await saveBytes(`${projectBase()}_annotated_${project.exportDpi}dpi.png`, bytes);
    } catch {
      toast(false, m.blotExportFailed());
    } finally {
      busy = '';
    }
  }

  async function exportFigureSvg() {
    if (!processed || !quant) {
      toast(false, m.blotNoImage());
      return;
    }
    const svg = figureSvg(project, processed.canvas, quant, {
      title: project.title,
      chartTitle: project.chartTitle,
      metricLabel,
      emptyLabel: m.blotNoResults(),
      nLabel: m.blotColumnN(),
      noGroupLabel: m.blotNoGroup(),
      footer: m.blotFigureFooter(),
    });
    await saveText(`${projectBase()}_figure.svg`, svg);
  }

  function resetAll() {
    if (typeof window !== 'undefined' && !window.confirm(m.blotResetConfirm())) return;
    history = [];
    future = [];
    canUndo = false;
    canRedo = false;
    imageEl = null;
    processed = null;
    project = emptyProject();
    project.title = m.blotDefaultTitle();
    selectedLaneId = null;
    selectedBandId = null;
    mode = 'select';
    clearSnapshot();
    drawStage();
    toast(true, m.blotResetDone());
  }

  // ----------------------------------------------------------------- render

  function showValue(value: number, digits = 3): string {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(digits);
  }
</script>

<div
  class="blot-page"
  role="application"
  aria-label={m.blotTitle()}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <input
    bind:this={imageInput}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff"
    style="display:none"
    onchange={onPickImage}
  />
  <input
    bind:this={projectInput}
    type="file"
    accept=".json,application/json"
    style="display:none"
    onchange={onPickProject}
  />

  <div class="blot-toolbar">
    <button class="pix-btn" onclick={() => imageInput?.click()}>
      <Upload size={12} /> {m.blotImportImage()}
    </button>
    <button
      class="pix-btn accent"
      disabled={!hasImage || !!busy}
      onclick={() => autoDetect(true)}
    >
      <Wand2 size={12} /> {m.blotAutoDetect()}
    </button>
    <button class="pix-btn" disabled={!canUndo} onclick={undo} title={m.blotUndo()}>
      <Undo2 size={12} />
    </button>
    <button class="pix-btn" disabled={!canRedo} onclick={redo} title={m.blotRedo()}>
      <Redo2 size={12} />
    </button>
    <span class="spacer"></span>
    <button class="pix-btn" onclick={() => projectInput?.click()}>
      <FolderOpen size={12} /> {m.blotOpenProject()}
    </button>
    <button class="pix-btn" disabled={!hasImage} onclick={saveProject}>
      <Save size={12} /> {m.blotSaveProject()}
    </button>
    <button class="pix-btn ok" disabled={!hasImage} onclick={exportFigureSvg}>
      <Download size={12} /> {m.blotExportFigure()}
    </button>
    <button class="pix-btn danger" disabled={!hasImage} onclick={resetAll}>
      <Eraser size={12} /> {m.blotReset()}
    </button>
  </div>

  {#if busy}
    <div class="busy-line">{busy}</div>
  {/if}

  <div class="blot-body">
    <aside class="blot-side">
      <details open>
        <summary><ScanLine size={11} /> {m.blotImageSection()}</summary>
        <div class="sec-body">
          {#if !hasImage}
            <div class="empty-hint">{m.blotNoImage()}</div>
            <button class="pix-btn" onclick={() => imageInput?.click()}>
              <Upload size={11} /> {m.blotImportImage()}
            </button>
          {:else}
            <div class="image-meta">
              <span class="image-name" title={project.imageName}>{project.imageName}</span>
              <span class="pix-dim">{project.sourceWidth}×{project.sourceHeight}</span>
            </div>
            <div class="btn-row">
              <button
                class="pix-btn"
                class:active={project.adjust.display === 'gray'}
                onclick={() => setDisplay('gray')}
              >{m.blotGray()}</button>
              <button
                class="pix-btn"
                class:active={project.adjust.display === 'color'}
                onclick={() => setDisplay('color')}
              >{m.blotColor()}</button>
            </div>
            <label class="row">
              <span>{m.blotContrast()} <output>{showValue(project.adjust.contrast, 2)}</output></span>
              <input
                type="range" min="0.2" max="3" step="0.05"
                value={project.adjust.contrast}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => {
                  project.adjust.contrast = Number((e.currentTarget as HTMLInputElement).value);
                  scheduleRender();
                  schedulePersist();
                }}
              />
            </label>
            <label class="row">
              <span>{m.blotBrightness()} <output>{showValue(project.adjust.brightness, 2)}</output></span>
              <input
                type="range" min="-0.5" max="0.5" step="0.01"
                value={project.adjust.brightness}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => {
                  project.adjust.brightness = Number((e.currentTarget as HTMLInputElement).value);
                  scheduleRender();
                  schedulePersist();
                }}
              />
            </label>
            <label class="row">
              <span>{m.blotGamma()} <output>{showValue(project.adjust.gamma, 2)}</output></span>
              <input
                type="range" min="0.3" max="2.5" step="0.05"
                value={project.adjust.gamma}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => {
                  project.adjust.gamma = Number((e.currentTarget as HTMLInputElement).value);
                  scheduleRender();
                  schedulePersist();
                }}
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={project.adjust.invert}
                onchange={(e) => {
                  const checked = (e.currentTarget as HTMLInputElement).checked;
                  commit(() => { project.adjust.invert = checked; });
                  scheduleRender();
                }}
              /> {m.blotInvert()}
            </label>
            <div class="btn-row">
              <button class="pix-btn small" onclick={autoLevels}>{m.blotAutoLevels()}</button>
              <button class="pix-btn small" onclick={resetLevels}>{m.blotResetLevels()}</button>
            </div>
            <div class="btn-row">
              <button class="pix-btn" onclick={() => rotateQuarter(false)} title={m.blotRotateLeft()}>
                <RotateCcw size={12} />
              </button>
              <button class="pix-btn" onclick={() => rotateQuarter(true)} title={m.blotRotateRight()}>
                <RotateCw size={12} />
              </button>
              <button class="pix-btn small" onclick={() => { checkpoint(); setRotation(0); }}>
                {m.blotRotationReset()}
              </button>
            </div>
            <label class="row">
              <span>{m.blotFineRotation()} <output>{showValue(project.rotation, 1)}°</output></span>
              <input
                type="range" min="-15" max="15" step="0.1"
                value={project.rotation}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => setRotation(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <div class="btn-row">
              <button
                class="pix-btn"
                class:active={mode === 'crop'}
                onclick={() => { mode = mode === 'crop' ? 'select' : 'crop'; }}
              ><Crop size={11} /> {m.blotCropMode()}</button>
              <button class="pix-btn small" onclick={resetCrop}>{m.blotClearCrop()}</button>
            </div>
            <div class="crop-grid">
              <label>{m.blotCropLeft()}
                <input type="range" min="0" max="0.8" step="0.005" value={project.crop.left}
                  onpointerdown={() => checkpoint(true)}
                  oninput={(e) => { project.crop.left = Number((e.currentTarget as HTMLInputElement).value); onCropInput(); }} />
              </label>
              <label>{m.blotCropTop()}
                <input type="range" min="0" max="0.8" step="0.005" value={project.crop.top}
                  onpointerdown={() => checkpoint(true)}
                  oninput={(e) => { project.crop.top = Number((e.currentTarget as HTMLInputElement).value); onCropInput(); }} />
              </label>
              <label>{m.blotCropRight()}
                <input type="range" min="0" max="0.8" step="0.005" value={project.crop.right}
                  onpointerdown={() => checkpoint(true)}
                  oninput={(e) => { project.crop.right = Number((e.currentTarget as HTMLInputElement).value); onCropInput(); }} />
              </label>
              <label>{m.blotCropBottom()}
                <input type="range" min="0" max="0.8" step="0.005" value={project.crop.bottom}
                  onpointerdown={() => checkpoint(true)}
                  oninput={(e) => { project.crop.bottom = Number((e.currentTarget as HTMLInputElement).value); onCropInput(); }} />
              </label>
            </div>
            <div class="btn-row">
              <label class="check small">
                <input type="checkbox" checked={project.showRoi}
                  onchange={(e) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    commit(() => { project.showRoi = checked; });
                  }} /> {m.blotShowRoi()}
              </label>
              <label class="check small">
                <input type="checkbox" checked={project.showLaneLabels}
                  onchange={(e) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    commit(() => { project.showLaneLabels = checked; });
                  }} /> {m.blotShowLaneLabels()}
              </label>
            </div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><Layers size={11} /> {m.blotLanes()}</summary>
        <div class="sec-body">
          <div class="btn-row">
            <button class="pix-btn" disabled={!hasImage} onclick={() => autoDetect(true)}>
              <Crosshair size={11} /> {m.blotAutoLanes()}
            </button>
            <button class="pix-btn" disabled={!hasImage} onclick={addLane}>
              <Plus size={10} /> {m.blotAddLane()}
            </button>
            <button class="pix-btn" disabled={!hasImage} onclick={detectBandsAll}>
              {m.blotDetectBands()}
            </button>
          </div>
          <div class="btn-row">
            <label class="inline">{m.blotLaneCount()}
              <input
                class="pix-input num" type="number" min="1" max="40"
                value={project.lanes.length}
                disabled={!hasImage}
                onchange={(e) => setLaneCount(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <button
              class="pix-btn small"
              class:active={mode === 'addBand'}
              disabled={!hasImage}
              onclick={() => { mode = mode === 'addBand' ? 'select' : 'addBand'; }}
            ><MousePointerClick size={11} /> {m.blotAddBand()}</button>
            <button
              class="pix-btn small"
              class:active={mode === 'select'}
              onclick={() => { mode = 'select'; }}
            ><MousePointer2 size={11} /> {m.blotSelectMode()}</button>
          </div>
          {#if mode === 'addBand'}
            <div class="hint-line">{m.blotAddBandHint()}</div>
          {/if}
          {#if mode === 'crop'}
            <div class="hint-line">{m.blotCropHint()}</div>
          {/if}

          {#if selectedBandRef}
            <div class="band-panel">
              <span class="pix-dim tiny">
                {m.blotSelectedBand()} · {selectedBandRef.lane.name || '—'} #{selectedBandRef.lane.bands.indexOf(selectedBandRef.band) + 1}
              </span>
              <div class="mini-grid">
                <label>{m.blotRoiY()}
                  <input class="pix-input num" type="number" min="0" max="100" step="0.1"
                    value={showValue(selectedBandRef.band.y * 100, 1)}
                    onchange={(e) => updateBand({ y: clamp(Number((e.currentTarget as HTMLInputElement).value) / 100, 0, 1) })} />
                </label>
                <label>{m.blotRoiHeight()}
                  <input class="pix-input num" type="number" min="0.2" max="30" step="0.1"
                    value={showValue(selectedBandRef.band.height * 100, 1)}
                    onchange={(e) => updateBand({ height: clamp(Number((e.currentTarget as HTMLInputElement).value) / 100, 0.002, 0.5) })} />
                </label>
                <label>{m.blotRoiWidth()}
                  <input class="pix-input num" type="number" min="0.2" max="80" step="0.1"
                    value={showValue(selectedBandRef.band.width * 100, 1)}
                    onchange={(e) => updateBand({ width: clamp(Number((e.currentTarget as HTMLInputElement).value) / 100, 0.002, 0.8) })} />
                </label>
              </div>
              <div class="btn-row">
                <label class="check small">
                  <input type="checkbox" checked={!selectedBandRef.band.excluded}
                    onchange={(e) => toggleBandExcluded(selectedBandRef!.lane, selectedBandRef!.band)} /> {m.blotIncluded()}
                </label>
                <button class="pix-btn small danger" onclick={deleteSelectedBand}>
                  <Trash2 size={10} /> {m.blotDeleteBand()}
                </button>
              </div>
            </div>
          {/if}

          <div class="lane-list">
            {#each orderedLanes as lane (lane.id)}
              <div class="lane-row" class:active={lane.id === selectedLaneId} class:excluded={lane.excluded}>
                <button
                  class="pix-btn-reset lane-pick"
                  onclick={() => { selectedLaneId = lane.id; selectedBandId = null; drawStage(); }}
                >{lane.name || '—'}</button>
                <input
                  class="pix-input lane-name" type="text"
                  placeholder={m.blotLaneName()}
                  value={lane.name}
                  oninput={(e) => { lane.name = (e.currentTarget as HTMLInputElement).value; schedulePersist(); drawStage(); }}
                />
                <button class="pix-btn tiny-btn" onclick={() => detectBandsFor(lane)} title={m.blotDetectBandsLane()}>
                  {lane.bands.length}
                </button>
                <button class="icon" onclick={() => toggleLaneExcluded(lane)} title={m.blotLaneExcluded()}>
                  {#if lane.excluded}<EyeOff size={11} />{:else}<Eye size={11} />{/if}
                </button>
                <button class="icon danger" onclick={() => removeLane(lane.id)} title={m.blotRemoveLane()}>
                  <Trash2 size={11} />
                </button>
              </div>
            {:else}
              <div class="empty-hint">{m.blotNoLanes()}</div>
            {/each}
          </div>
          {#if hasImage && !project.lanes.length}
            <div class="hint-line">{m.blotEmptyLaneHint()}</div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><RefreshCw size={11} /> {m.blotQuantification()}</summary>
        <div class="sec-body">
          <label class="row">
            <span>{m.blotBackgroundMode()}</span>
            <select
              class="pix-select"
              value={project.backgroundMode}
              onchange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value as BlotProject['backgroundMode'];
                commit(() => { project.backgroundMode = value; });
              }}
            >
              <option value="ring">{m.blotBgRing()}</option>
              <option value="lane">{m.blotBgLane()}</option>
              <option value="global">{m.blotBgGlobal()}</option>
              <option value="manual">{m.blotBgManual()}</option>
            </select>
          </label>
          {#if project.backgroundMode === 'manual'}
            <label class="row">
              <span>{m.blotManualBackground()} <output>{showValue(project.manualBackground, 3)}</output></span>
              <input
                type="range" min="0" max="0.5" step="0.001"
                value={project.manualBackground}
                onpointerdown={() => checkpoint(true)}
                oninput={(e) => {
                  project.manualBackground = Number((e.currentTarget as HTMLInputElement).value);
                  schedulePersist();
                }}
              />
            </label>
          {/if}
          <label class="row">
            <span>{m.blotNormalization()}</span>
            <select
              class="pix-select"
              value={project.normalization.mode}
              onchange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value as BlotProject['normalization']['mode'];
                commit(() => { project.normalization.mode = value; syncNormalization(); });
              }}
            >
              <option value="none">{m.blotNormNone()}</option>
              <option value="loading">{m.blotNormLoading()}</option>
              <option value="total">{m.blotNormTotal()}</option>
            </select>
          </label>
          {#if project.normalization.mode === 'loading'}
            <label class="row">
              <span>{m.blotLoadingLane()}</span>
              <select
                class="pix-select"
                value={project.normalization.loadingLaneId ?? ''}
                onchange={(e) => {
                  const value = (e.currentTarget as HTMLSelectElement).value || null;
                  commit(() => { project.normalization.loadingLaneId = value; });
                }}
              >
                {#each orderedLanes as lane (lane.id)}
                  <option value={lane.id}>{lane.name || lane.sample || '—'}</option>
                {/each}
              </select>
            </label>
          {/if}
          <label class="row">
            <span>{m.blotControlGroup()}</span>
            <select
              class="pix-select"
              value={project.normalization.controlGroup}
              disabled={!groups.length}
              onchange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value;
                commit(() => { project.normalization.controlGroup = value; });
              }}
            >
              {#if !groups.length}
                <option value="">{m.blotNoGroup()}</option>
              {/if}
              {#each groups as group (group)}
                <option value={group}>{group}</option>
              {/each}
            </select>
          </label>
          <label class="row">
            <span>{m.blotChartMetric()}</span>
            <select
              class="pix-select"
              value={project.chartMetric}
              onchange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value as BlotProject['chartMetric'];
                commit(() => { project.chartMetric = value; });
              }}
            >
              <option value="normalized">{m.blotNormalizedSignal()}</option>
              <option value="fold">{m.blotFoldChange()}</option>
            </select>
          </label>
          {#if quant}
            <div class="stat-line">
              <span>{m.blotTotalVolume()}: <b>{showValue(quant.totalVolume, 1)}</b></span>
              <span>{m.blotControlMean()}: <b>{showValue(quant.controlMean, 3)}</b></span>
            </div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><FileText size={11} /> {m.blotExportSection()}</summary>
        <div class="sec-body">
          <label class="row">
            <span>{m.blotExportDpi()}</span>
            <select
              class="pix-select"
              value={String(project.exportDpi)}
              onchange={(e) => {
                const value = Number((e.currentTarget as HTMLSelectElement).value) === 600 ? 600 : 300;
                commit(() => { project.exportDpi = value; });
              }}
            >
              <option value="300">300</option>
              <option value="600">600</option>
            </select>
          </label>
          <button class="pix-btn" disabled={!quant?.rows.length} onclick={exportCsv}>
            <Download size={11} /> {m.blotExportCsv()}
          </button>
          <button class="pix-btn" disabled={!hasImage} onclick={exportAnnotatedPng}>
            <Download size={11} /> {m.blotExportPng()}
          </button>
          <button class="pix-btn" disabled={!hasImage} onclick={exportFigureSvg}>
            <Download size={11} /> {m.blotExportSvg()}
          </button>
          <div class="btn-row">
            <button class="pix-btn small" disabled={!hasImage} onclick={saveProject}>
              <Save size={10} /> {m.blotSaveProject()}
            </button>
            <button class="pix-btn small" onclick={() => projectInput?.click()}>
              <FolderOpen size={10} /> {m.blotOpenProject()}
            </button>
          </div>
          <div class="hint-line">{m.blotAutosaveHint()}</div>
        </div>
      </details>
    </aside>

    <section class="blot-stage-wrap">
      <div class="stage-head">
        <span class="stage-title"><MousePointer2 size={11} /> {m.blotStage()}</span>
        <div class="zoom-tools">
          <span class="pix-dim">{Math.round(zoom * 100)}%</span>
          <button class="pix-btn" onclick={() => { zoom = clamp(zoom / 1.25, 0.2, 4); drawStage(); }} title={m.blotZoomOut()}>
            <ZoomOut size={12} />
          </button>
          <button class="pix-btn" onclick={() => { zoom = clamp(zoom * 1.25, 0.2, 4); drawStage(); }} title={m.blotZoomIn()}>
            <ZoomIn size={12} />
          </button>
          <button class="pix-btn small" onclick={() => { zoom = 1; drawStage(); }}>{m.blotZoomFit()}</button>
        </div>
      </div>
      <div class="blot-stage" bind:this={stageEl}>
        {#if hasImage && processed}
          <div class="stage-stack">
            <canvas class="display-canvas" bind:this={stageCanvas}></canvas>
            <canvas
              class="overlay-canvas"
              bind:this={stageOverlay}
              onpointerdown={onStagePointerDown}
              onpointermove={onStagePointerMove}
              onpointerup={onStagePointerUp}
              onpointercancel={onStagePointerUp}
            ></canvas>
          </div>
        {:else}
          <div class="stage-empty">
            <ScanLine size={30} />
            <p>{m.blotNoImage()}</p>
            <p class="pix-dim">{m.blotDropHint()}</p>
            <button class="pix-btn accent" onclick={() => imageInput?.click()}>
              <Upload size={12} /> {m.blotImportImage()}
            </button>
          </div>
        {/if}
      </div>
      <div class="keyboard-hint">{m.blotKeyboardHint()}</div>
    </section>

    <aside class="blot-right">
      <div class="right-tabs">
        <button class="tab" class:active={rightTab === 'results'} onclick={() => { rightTab = 'results'; }}>
          {m.blotResults()}
        </button>
        <button class="tab" class:active={rightTab === 'chart'} onclick={() => { rightTab = 'chart'; }}>
          {m.blotChart()}
        </button>
        <button class="tab" class:active={rightTab === 'figure'} onclick={() => { rightTab = 'figure'; }}>
          {m.blotFigure()}
        </button>
      </div>

      {#if rightTab === 'results'}
        <div class="pane-scroll">
          <div class="pane-title">{m.blotSampleAssignments()}</div>
          {#if !project.lanes.length}
            <div class="empty-hint">{m.blotNoLanes()}</div>
          {:else}
            <div class="table-wrap">
              <table class="data-table assign-table">
                <thead>
                  <tr>
                    <th>{m.blotColumnLane()}</th>
                    <th>{m.blotColumnSample()}</th>
                    <th>{m.blotColumnGroup()}</th>
                    <th title={m.blotLoadingControl()}>{m.blotLoadingShort()}</th>
                    <th>{m.blotIncluded()}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each orderedLanes as lane (lane.id)}
                    <tr class:excluded={lane.excluded}>
                      <td>
                        <input class="pix-input cell" type="text" value={lane.name}
                          oninput={(e) => { lane.name = (e.currentTarget as HTMLInputElement).value; schedulePersist(); drawStage(); }} />
                      </td>
                      <td>
                        <input class="pix-input cell" type="text" value={lane.sample}
                          placeholder={lane.name}
                          oninput={(e) => { lane.sample = (e.currentTarget as HTMLInputElement).value; schedulePersist(); }} />
                      </td>
                      <td>
                        <input class="pix-input cell" type="text" value={lane.group}
                          oninput={(e) => { lane.group = (e.currentTarget as HTMLInputElement).value; schedulePersist(); }}
                          onchange={() => { syncNormalization(); schedulePersist(); }} />
                      </td>
                      <td class="centre">
                        <input
                          type="radio" name="blot-loading-lane"
                          aria-label={m.blotLoadingControl()}
                          checked={project.normalization.loadingLaneId === lane.id}
                          onchange={() => {
                            commit(() => {
                              project.normalization.mode = 'loading';
                              project.normalization.loadingLaneId = lane.id;
                            });
                          }}
                        />
                      </td>
                      <td class="centre">
                        <input type="checkbox" checked={!lane.excluded}
                          aria-label={m.blotIncluded()}
                          onchange={() => toggleLaneExcluded(lane)} />
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <div class="pane-title">{m.blotResults()}</div>
          {#if !quant || !quant.rows.length}
            <div class="empty-hint">{m.blotNoResults()}</div>
          {:else}
            <div class="table-wrap">
              <table class="data-table results-table">
                <thead>
                  <tr>
                    <th>{m.blotColumnLane()}</th>
                    <th>{m.blotColumnBand()}</th>
                    <th>{m.blotColumnGroup()}</th>
                    <th>{m.blotColumnIncluded()}</th>
                    <th>{m.blotColumnArea()}</th>
                    <th>{m.blotColumnMean()}</th>
                    <th>{m.blotColumnBg()}</th>
                    <th>{m.blotColumnVolume()}</th>
                    <th>{m.blotColumnNorm()}</th>
                    <th>{m.blotColumnFold()}</th>
                    <th>{m.blotColumnGroupMean()}</th>
                    <th>{m.blotColumnSd()}</th>
                    <th>{m.blotColumnSem()}</th>
                    <th>{m.blotColumnN()}</th>
                    <th>{m.blotColumnSat()}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each quant.rows as row (row.laneId + ':' + row.bandId)}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <tr
                      class:excluded={!row.included}
                      class:selected={row.bandId === selectedBandId}
                      onclick={() => { selectedLaneId = row.laneId; selectedBandId = row.bandId; drawStage(); }}
                    >
                      <td>{row.laneName || '—'}</td>
                      <td>{row.bandIndex + 1}</td>
                      <td>{row.group || '—'}</td>
                      <td class="centre">
                        <input
                          type="checkbox"
                          checked={findBand(row.laneId, row.bandId)?.band.excluded !== true}
                          aria-label={m.blotIncluded()}
                          onclick={(e) => e.stopPropagation()}
                          onchange={() => {
                            const hit = findBand(row.laneId, row.bandId);
                            if (hit) toggleBandExcluded(hit.lane, hit.band);
                          }}
                        />
                      </td>
                      <td>{row.area}</td>
                      <td>{showValue(row.meanSignal, 3)}</td>
                      <td>{showValue(row.background, 3)}</td>
                      <td>{showValue(row.netVolume, 1)}</td>
                      <td>{showValue(row.normalized, 3)}</td>
                      <td>{showValue(row.fold, 3)}</td>
                      <td>{showValue(row.groupMean, 3)}</td>
                      <td>{showValue(row.groupSd, 3)}</td>
                      <td>{showValue(row.groupSem, 3)}</td>
                      <td>{row.groupN}</td>
                      <td>
                        {#if row.saturated}
                          <span class="sat-badge" title={m.blotSaturated()}>{m.blotSatShort()}</span>
                        {/if}
                      </td>
                      <td>
                        <button
                          class="icon danger"
                          title={m.blotDeleteBand()}
                          onclick={(e) => { e.stopPropagation(); removeBand(row.laneId, row.bandId); }}
                        ><Trash2 size={10} /></button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {:else if rightTab === 'chart'}
        <div class="pane-scroll">
          <div class="pane-title">{m.blotChart()}</div>
          <div class="chart-box">
            {#if chartMarkup}
              {@html chartMarkup}
            {:else}
              <div class="empty-hint">{m.blotNoResults()}</div>
            {/if}
          </div>
          {#if quant && quant.groups.length}
            <table class="data-table group-table">
              <thead>
                <tr>
                  <th>{m.blotColumnGroup()}</th>
                  <th>{m.blotColumnN()}</th>
                  <th>{m.blotColumnGroupMean()}</th>
                  <th>{m.blotColumnSd()}</th>
                  <th>{m.blotColumnSem()}</th>
                </tr>
              </thead>
              <tbody>
                {#each quant.groups as group (group.name)}
                  <tr>
                    <td>{group.name}</td>
                    <td>{group.n}</td>
                    <td>{showValue(group.mean, 3)}</td>
                    <td>{showValue(group.sd, 3)}</td>
                    <td>{showValue(group.sem, 3)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {:else}
        <div class="pane-scroll">
          <div class="pane-title">{m.blotFigure()}</div>
          <div class="figure-fields">
            <label class="row">
              <span>{m.blotFigureTitle()}</span>
              <input class="pix-input" type="text" bind:value={project.title} oninput={schedulePersist} />
            </label>
            <label class="row">
              <span>{m.blotChartTitle()}</span>
              <input class="pix-input" type="text" bind:value={project.chartTitle} oninput={schedulePersist} />
            </label>
          </div>
          <div class="figure-preview">
            {#if figureMarkup}
              {@html figureMarkup}
            {:else}
              <div class="empty-hint">{m.blotFigureEmpty()}</div>
            {/if}
          </div>
          <div class="btn-row">
            <button class="pix-btn" disabled={!figureMarkup} onclick={exportFigureSvg}>
              <Download size={11} /> {m.blotExportSvg()}
            </button>
            <button class="pix-btn" disabled={!hasImage} onclick={exportAnnotatedPng}>
              <Download size={11} /> {m.blotExportPng()}
            </button>
          </div>
        </div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .blot-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
    font-family: var(--pix-font);
    font-size: 10px;
  }
  .blot-toolbar {
    display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    padding: 6px 8px; border: 1px solid var(--pix-border); background: var(--pix-bg-2);
  }
  .blot-toolbar .pix-btn { padding: 4px 9px; font-size: 9.5px; display: inline-flex; align-items: center; gap: 4px; }
  .pix-btn.accent { border-color: var(--pix-accent); color: var(--pix-accent); }
  .pix-btn.ok { border-color: var(--pix-green); color: var(--pix-green); }
  .pix-btn.danger { color: var(--pix-red); }
  .pix-btn.active { border-color: var(--pix-cyan); color: var(--pix-cyan); background: var(--pix-bg-2); }
  .spacer { flex: 1; }
  .busy-line { font-size: 9px; color: var(--pix-accent-2); padding: 0 4px; }

  .blot-body { flex: 1; display: flex; gap: 8px; min-height: 0; }
  .blot-side {
    width: 316px; min-width: 276px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 6px; padding-right: 2px;
  }
  details { border: 1px solid var(--pix-border); background: var(--pix-bg-2); }
  summary {
    cursor: pointer; padding: 5px 7px; font-weight: bold; color: var(--pix-accent-2);
    font-size: 10px; display: flex; align-items: center; gap: 5px; list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  .sec-body { padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; flex-direction: column; gap: 2px; color: var(--pix-fg-dim); font-size: 9.5px; }
  .row output { color: var(--pix-fg); font-weight: bold; }
  .row input[type="range"] { width: 100%; }
  .check { display: flex; align-items: center; gap: 5px; color: var(--pix-fg); cursor: pointer; }
  .check.small { font-size: 9px; }
  .inline { display: inline-flex; align-items: center; gap: 4px; color: var(--pix-fg-dim); font-size: 9px; }
  .btn-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .pix-btn.small, .pix-btn.tiny-btn { padding: 2px 6px; font-size: 8.5px; display: inline-flex; align-items: center; gap: 3px; }
  .icon { background: none; border: none; cursor: pointer; color: var(--pix-fg-dim); padding: 1px; display: inline-flex; }
  .icon:hover { color: var(--pix-fg); }
  .icon.danger { color: var(--pix-red); }
  .pix-dim { color: var(--pix-fg-dim); }
  .tiny { font-size: 8.5px; }
  .empty-hint { color: var(--pix-fg-dim); font-size: 9.5px; padding: 4px 0; }
  .hint-line { font-size: 8.5px; color: var(--pix-cyan); border-left: 2px solid var(--pix-cyan); padding-left: 5px; }
  .image-meta { display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
  .image-name { color: var(--pix-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
  .crop-grid label { display: flex; flex-direction: column; font-size: 8.5px; color: var(--pix-fg-dim); gap: 1px; }
  .mini-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px 6px; }
  .mini-grid label { display: flex; flex-direction: column; gap: 1px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .band-panel {
    display: flex; flex-direction: column; gap: 4px;
    border: 1px solid var(--pix-border); padding: 5px; background: var(--pix-bg-3);
  }
  .lane-list { display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; }
  .lane-row { display: flex; align-items: center; gap: 3px; padding: 2px 3px; border: 1px solid transparent; }
  .lane-row.active { border-color: var(--pix-accent-2); background: rgba(255, 210, 63, 0.06); }
  .lane-row.excluded { opacity: 0.6; }
  .lane-pick { min-width: 22px; font-size: 9px; color: var(--pix-cyan); cursor: pointer; text-align: left; }
  .lane-name { flex: 1; min-width: 0; padding: 1px 3px; font-size: 9px; height: 18px; }
  .lane-row .pix-btn { padding: 1px 4px; font-size: 8.5px; }
  .stat-line { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: var(--pix-fg-dim); }
  .stat-line b { color: var(--pix-fg); }

  .blot-stage-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .stage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .stage-title { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: bold; color: var(--pix-accent-2); }
  .zoom-tools { display: inline-flex; align-items: center; gap: 3px; }
  .zoom-tools .pix-btn { padding: 1px 5px; font-size: 9px; }
  .blot-stage {
    flex: 1; min-height: 260px; overflow: auto; display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--pix-border); background: #04060a; padding: 6px;
  }
  .stage-stack { position: relative; display: inline-block; flex: none; }
  .display-canvas { display: block; }
  .overlay-canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
  .stage-empty {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    color: var(--pix-fg-dim); font-size: 11px; text-align: center; padding: 30px;
  }
  .stage-empty p { margin: 0; }
  .keyboard-hint { font-size: 8.5px; color: var(--pix-fg-dim); }

  .blot-right {
    width: 440px; min-width: 330px; max-width: 640px;
    display: flex; flex-direction: column; gap: 4px; overflow: hidden;
    border: 1px solid var(--pix-border); background: var(--pix-bg-2);
  }
  .right-tabs { display: flex; border-bottom: 1px solid var(--pix-border); }
  .tab {
    flex: 1; background: var(--pix-bg-3); border: none; border-right: 1px solid var(--pix-border);
    color: var(--pix-fg-dim); padding: 5px 4px; font-size: 9px; cursor: pointer; font-family: var(--pix-font);
  }
  .tab:last-child { border-right: none; }
  .tab.active { color: var(--pix-accent-2); background: var(--pix-bg-2); font-weight: bold; }
  .pane-scroll { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .pane-title { font-size: 9px; font-weight: bold; color: var(--pix-accent-2); letter-spacing: 1px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--pix-border); }
  .data-table { border-collapse: collapse; width: 100%; font-size: 9px; }
  .data-table th {
    background: var(--pix-bg-3); color: var(--pix-fg-dim); font-weight: bold;
    padding: 3px 5px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--pix-border);
  }
  .data-table td { padding: 2px 5px; border-bottom: 1px solid rgba(42, 52, 80, 0.5); white-space: nowrap; }
  .data-table tr.excluded { opacity: 0.5; }
  .data-table tr.selected { background: rgba(255, 210, 63, 0.08); }
  .assign-table .cell { width: 100%; min-width: 54px; height: 18px; padding: 1px 3px; font-size: 9px; }
  .assign-table td.centre, .results-table td:last-child { text-align: center; }
  .results-table tbody tr { cursor: pointer; }
  .sat-badge {
    display: inline-block; padding: 0 3px; border: 1px solid var(--pix-accent);
    color: var(--pix-accent); font-size: 8px; font-weight: bold;
  }
  .chart-box { border: 1px solid var(--pix-border); background: #fff; padding: 4px; }
  .chart-box :global(svg) { display: block; width: 100%; height: auto; }
  .group-table { border: 1px solid var(--pix-border); }
  .figure-fields { display: flex; flex-direction: column; gap: 4px; }
  .figure-preview {
    border: 1px solid var(--pix-border); background: #fff; padding: 4px;
    display: flex; align-items: flex-start; justify-content: center; overflow: auto;
  }
  .figure-preview :global(svg) { display: block; width: 100%; height: auto; }

  @media (max-width: 1100px) {
    .blot-body { flex-wrap: wrap; overflow-y: auto; }
    .blot-side { width: 100%; max-height: 38vh; }
    .blot-stage-wrap { min-height: 44vh; width: 100%; }
    .blot-right { width: 100%; max-width: none; max-height: 52vh; }
  }
</style>
