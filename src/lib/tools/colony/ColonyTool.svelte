<script lang="ts">
  // Colony / cell counter. Image work, segmentation and export all run locally
  // on typed arrays; nothing is uploaded. Working coordinates are the pixels of
  // the cropped, rotated and capped working canvas (see imaging.ts).
  import { onMount, tick } from 'svelte';
  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import {
    Download,
    FolderOpen,
    Image as ImageIcon,
    Images,
    Microscope,
    Palette,
    RotateCcw,
    RotateCw,
    Save,
    ScanLine,
    Send,
    SlidersHorizontal,
    Trash2,
    Upload,
    Wand2
  } from 'lucide-svelte';
  import { m } from './messages';
  import {
    MAX_DETECT_DIM,
    MAX_WORK_DIM,
    buildWorkCanvas,
    decodeImageFile,
    downscaleCanvas,
    extractGray,
    loadImageElement,
    maskPreviewCanvas,
    renderAdjusted,
    transformMarkersBetween,
    type WorkMeta
  } from './imaging';
  import { segmentGray, type SegmentRequest } from './segment';
  import {
    buildHistogram,
    cfuCi95,
    computeCfu,
    computeStats,
    countClasses,
    formatArea,
    formatScientific,
    markersToCsv,
    median,
    nextMarkerId,
    numberMarkers,
    poissonCi95,
    statisticsToCsv,
    type StatisticsRow
  } from './markers';
  import {
    annotatedPngBytes,
    maskPngBytes,
    parseProjectJson,
    projectBaseName,
    projectJson,
    renderAnnotated
  } from './export';
  import { sendImageToFigure } from '$lib/tools/shared/figureBridge';
  import { clearSnapshot, compactProjectImage, loadSnapshot, saveSnapshot } from './storage';
  import {
    defaultAdjust,
    defaultCrop,
    defaultParams,
    type ColonyAdjust,
    type ColonyClass,
    type ColonyCrop,
    type ColonyColorMode,
    type ColonyMarker,
    type ColonyParams,
    type ColonyPolarity,
    type ColonyProject
  } from './types';
  import { classifyMarkers, clearClassification, detectImageColor } from './color';
  import { colonyProjectName, normalizeColonyPayload } from './projectDoc';
  import { MAX_BATCH_PLATES, runColonyBatch, type ColonyBatchInput, type ColonyBatchResult } from './batch';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import {
    ensureProjectLoaded,
    finishToolCapture,
    takeToolHandoff
  } from '$lib/tools/shared/projectBridge';
  import ToolProjectBar from '$lib/tools/shared/ToolProjectBar.svelte';
  import { canvasPreview } from '$lib/tools/shared/preview';
  import { saveReproBundle } from '$lib/repro/bundle';
  import { fileBaseName, imageFiles } from '$lib/tools/shared/batch';
  import { runBatchJob } from '$lib/tools/shared/batchWorker';
  import { saveZip } from '$lib/tools/shared/zipExport';

  let imageInput = $state<HTMLInputElement>();
  let projectInput = $state<HTMLInputElement>();
  let batchInput = $state<HTMLInputElement>();
  let viewCanvas = $state<HTMLCanvasElement>();
  let overlayCanvas = $state<HTMLCanvasElement>();
  let stageEl = $state<HTMLDivElement>();

  let imageDataUrl = $state('');
  let imageName = $state('');
  let sourceWidth = $state(0);
  let sourceHeight = $state(0);
  let rotate = $state(0);
  let crop = $state<ColonyCrop>(defaultCrop());
  let adjust = $state<ColonyAdjust>(defaultAdjust());
  let params = $state<ColonyParams>(defaultParams());
  let markers = $state<ColonyMarker[]>([]);
  let selectedId = $state<number | null>(null);
  let showMask = $state(true);
  let showNumbers = $state(true);
  let dpi = $state<300 | 600>(300);
  let dilutionFactor = $state(1e6);
  let platedVolume = $state(0.1);
  let busy = $state<'' | 'image' | 'detect' | 'export'>('');
  let autoDetect = $state(true);
  let otsuValue = $state(0);
  let detectedThreshold = $state(0);
  let resolvedPolarity = $state<'dark' | 'bright'>('dark');
  let workInfo = $state<{ width: number; height: number; downscaled: boolean } | null>(null);
  let hasMask = $state(false);
  let hydrated = $state(false);
  let saveStatus = $state('');
  let handoffLoading = $state(false);
  let reproBusy = $state(false);
  let imageHasColor = $state(false);
  let batchStatus = $state('');
  let batchProgress = $state({ running: false, done: 0, total: 0, current: '' });

  // Large canvases and detector planes stay outside the reactive proxy.
  let sourceImage: HTMLImageElement | null = null;
  let workMeta: WorkMeta | null = null;
  let workCanvas: HTMLCanvasElement | null = null;
  let processedCanvas: HTMLCanvasElement | null = null;
  let maskCanvas: HTMLCanvasElement | null = null;
  let maskPlane: { mask: Uint8Array; width: number; height: number } | null = null;
  let detectPlane: { gray: Float32Array; width: number; height: number; fx: number; fy: number } | null = null;

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let detectTimer: ReturnType<typeof setTimeout> | null = null;
  let cropTimer: ReturnType<typeof setTimeout> | null = null;
  let adjustTimer: ReturnType<typeof setTimeout> | null = null;
  let saveToken = 0;
  let detectToken = 0;
  let imageToken = 0;
  let autosaveWarned = false;

  type DragState = { id: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean };
  let dragState: DragState | null = null;
  let pendingAdd: { x: number; y: number } | null = null;

  /** Invalidate any in-flight detector run and its queued timer. */
  function cancelDetection() {
    detectToken++;
    if (detectTimer) {
      clearTimeout(detectTimer);
      detectTimer = null;
    }
    if (busy === 'detect') busy = '';
  }

  const stats = $derived(computeStats(markers));
  const classCounts = $derived(countClasses(markers));
  const numbering = $derived(numberMarkers(markers));
  const histogram = $derived(buildHistogram(markers.filter((m) => m.included).map((m) => m.area)));
  const selected = $derived(markers.find((m) => m.id === selectedId) ?? null);
  const cfu = $derived(computeCfu(stats.included, Number(dilutionFactor), Number(platedVolume)));
  const countCi = $derived(poissonCi95(stats.included));
  const cfuInterval = $derived(
    cfuCi95(stats.included, Number(dilutionFactor), Number(platedVolume))
  );
  const colorModeOn = $derived(params.colorMode === 'blue-white');
  const hasImage = $derived(!!imageDataUrl && !!workInfo);

  // ---------------------------------------------------------------- helpers

  function title(): string {
    return m.toolsColonyTitle();
  }

  function classLabel(value: ColonyClass): string {
    if (value === 'blue') return m.colonyClassBlue();
    if (value === 'white') return m.colonyClassWhite();
    return m.colonyClassUnclassified();
  }

  function toast(ok: boolean, message: string) {
    pushToast(ok ? 'success' : 'error', title(), message);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function num(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function baseName(): string {
    return projectBaseName(imageName);
  }

  async function saveBytes(name: string, bytes: Uint8Array, type: 'png' | 'text' = 'png'): Promise<boolean> {
    try {
      const data = type === 'text' ? new TextDecoder().decode(bytes) : bytes;
      const result = await backend.saveExport(name, data);
      if (result.data?.saved) {
        toast(true, m.colonyExportDone());
        return true;
      }
      if (result.error) toast(false, result.error);
      return false;
    } catch (error) {
      toast(false, error instanceof Error ? error.message : m.colonyExportFailed());
      return false;
    }
  }

  // ------------------------------------------------------------ image input

  async function importFile(file: File) {
    if (!file.type.startsWith('image/') && !/\.tiff?$/i.test(file.name)) {
      toast(false, m.colonyImportFailed());
      return;
    }
    busy = 'image';
    try {
      const decoded = await decodeImageFile(file);
      await adoptImage(decoded.dataUrl, decoded.name, decoded.width, decoded.height);
      toast(true, m.colonyImportDone());
    } catch {
      toast(false, m.colonyImportFailed());
    } finally {
      busy = '';
    }
  }

  async function onPickImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFile(file);
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) {
      await importProjectFile(file);
      return;
    }
    await importFile(file);
  }

  async function adoptImage(dataUrl: string, name: string, width: number, height: number) {
    cancelDetection();
    const token = ++imageToken;
    imageDataUrl = dataUrl;
    imageName = name;
    sourceWidth = width;
    sourceHeight = height;
    rotate = 0;
    crop = defaultCrop();
    adjust = defaultAdjust();
    markers = [];
    selectedId = null;
    maskCanvas = null;
    maskPlane = null;
    detectPlane = null;
    hasMask = false;
    otsuValue = 0;
    detectedThreshold = 0;
    imageHasColor = false;
    sourceImage = await loadImageElement(dataUrl);
    if (token !== imageToken) return;
    workMeta = null;
    rebuildWork(false, true);
  }

  // -------------------------------------------------------- working canvas

  function rebuildWork(carryMarkers: boolean, runAutoDetect: boolean) {
    if (!sourceImage) return;
    cancelDetection();
    const oldMeta = workMeta;
    const next = buildWorkCanvas(sourceImage, rotate, crop);
    if (carryMarkers && oldMeta) {
      markers = transformMarkersBetween(oldMeta, next, markers);
      if (selectedId !== null && !markers.some((m) => m.id === selectedId)) selectedId = null;
    }
    workMeta = next;
    workCanvas = next.canvas;
    workInfo = {
      width: next.width,
      height: next.height,
      downscaled: next.scaleX < 0.999 || next.scaleY < 0.999
    };
    maskCanvas = null;
    maskPlane = null;
    detectPlane = null;
    hasMask = false;
    otsuValue = 0;
    renderNow(runAutoDetect);
  }

  function renderNow(runAutoDetect = autoDetect) {
    if (!workCanvas) return;
    cancelDetection();
    // The old mask no longer matches the adjusted pixels.
    maskCanvas = null;
    maskPlane = null;
    detectPlane = null;
    hasMask = false;
    processedCanvas = renderAdjusted(workCanvas, adjust);
    if (viewCanvas) {
      if (viewCanvas.width !== processedCanvas.width || viewCanvas.height !== processedCanvas.height) {
        viewCanvas.width = processedCanvas.width;
        viewCanvas.height = processedCanvas.height;
      }
      const ctx = viewCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
      ctx.drawImage(processedCanvas, 0, 0);
    }
    void tick().then(() => {
      fitDisplay();
      if (runAutoDetect) scheduleDetect();
    });
  }

  function fitDisplay() {
    if (!viewCanvas || !stageEl || !workInfo) return;
    const rect = stageEl.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const scale = Math.min((rect.width - 16) / workInfo.width, (rect.height - 16) / workInfo.height);
    const width = Math.max(32, Math.round(workInfo.width * scale));
    const height = Math.max(32, Math.round(workInfo.height * scale));
    viewCanvas.style.width = `${width}px`;
    viewCanvas.style.height = `${height}px`;
    drawOverlay();
  }

  function onWindowResize() {
    fitDisplay();
  }

  // -------------------------------------------------------------- rendering

  function scheduleAdjust() {
    if (adjustTimer) clearTimeout(adjustTimer);
    adjustTimer = setTimeout(() => {
      adjustTimer = null;
      renderNow(autoDetect);
    }, 60);
  }

  function scheduleCrop() {
    if (cropTimer) clearTimeout(cropTimer);
    cropTimer = setTimeout(() => {
      cropTimer = null;
      rebuildWork(true, autoDetect);
    }, 180);
  }

  function rotateQuarter(delta: 90 | -90 | 180) {
    if (!workMeta) return;
    rotate = (rotate + delta + 360) % 360;
    rebuildWork(true, autoDetect);
  }

  function resetCrop() {
    crop = defaultCrop();
    rebuildWork(true, autoDetect);
  }

  function resetAdjust() {
    adjust = defaultAdjust();
    renderNow(autoDetect);
  }

  // ------------------------------------------------------------- detection

  function scheduleDetect() {
    if (!autoDetect || !processedCanvas) return;
    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      detectTimer = null;
      void runDetection(false);
    }, 260);
  }

  function onParamsChange() {
    if (!autoDetect) return;
    cancelDetection();
    scheduleDetect();
  }

  function onColorModeChange(value: ColonyColorMode) {
    params.colorMode = value;
    if (value === 'blue-white' && workCanvas) {
      imageHasColor = classifyMarkers(workCanvas, markers).imageHasColor;
    } else {
      clearClassification(markers);
      imageHasColor = false;
    }
    drawOverlay();
  }

  function setSelectedClass(value: ColonyClass) {
    const marker = markers.find((entry) => entry.id === selectedId);
    if (!marker) return;
    marker.colonyClass = value;
    marker.classManual = true;
    drawOverlay();
  }

  async function runDetection(notify: boolean) {
    const sourceCanvas = processedCanvas;
    const meta = workMeta;
    if (!sourceCanvas || !meta) return;
    const token = ++detectToken;
    busy = 'detect';
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (token !== detectToken) return;
    try {
      const scaled = downscaleCanvas(sourceCanvas, MAX_DETECT_DIM);
      const { gray, width, height } = extractGray(scaled.canvas);
      const fx = width / meta.width;
      const fy = height / meta.height;
      const areaScale = fx * fy;
      const request: SegmentRequest = {
        threshold: params.autoThreshold ? null : clamp(params.manualThreshold, 0, 255),
        polarity: params.polarity,
        blurRadius: params.blurRadius * Math.min(fx, fy),
        minArea: Math.max(0, params.minArea) * areaScale,
        maxArea: Math.max(0, params.maxArea) * areaScale,
        minCircularity: params.minCircularity,
        splitTouching: params.splitTouching
      };
      const result = segmentGray(gray, width, height, request);
      if (token !== detectToken) return;
      otsuValue = result.otsu;
      detectedThreshold = result.threshold;
      resolvedPolarity = result.polarity;
      maskPlane = { mask: result.mask, width, height };
      detectPlane = { gray, width, height, fx, fy };
      maskCanvas = maskPreviewCanvas(result.mask, width, height);
      hasMask = true;

      const previousAuto = markers.filter((m) => m.source === 'auto');
      const mapped: ColonyMarker[] = result.colonies.map((colony) => {
        const area = colony.area / areaScale;
        const x = colony.x / fx;
        const y = colony.y / fy;
        const radius = Math.sqrt(Math.max(0, area) / Math.PI);
        let included = true;
        let bestDistance = Infinity;
        let best: ColonyMarker | null = null;
        for (const old of previousAuto) {
          const distance = Math.hypot(old.x - x, old.y - y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = old;
          }
        }
        if (best && bestDistance <= Math.max(4, best.radius * 0.7)) included = best.included;
        const keepManualClass = best?.classManual === true;
        return {
          id: nextMarkerId(markers),
          x,
          y,
          radius,
          area,
          meanIntensity: colony.meanIntensity,
          circularity: colony.circularity,
          included,
          source: 'auto',
          meanR: keepManualClass ? best!.meanR : 0,
          meanG: keepManualClass ? best!.meanG : 0,
          meanB: keepManualClass ? best!.meanB : 0,
          hue: keepManualClass ? best!.hue : -1,
          saturation: keepManualClass ? best!.saturation : 0,
          colonyClass: keepManualClass ? best!.colonyClass : 'unclassified',
          classManual: keepManualClass
        };
      });
      if (params.colorMode === 'blue-white' && workCanvas) {
        imageHasColor = classifyMarkers(workCanvas, mapped).imageHasColor;
      } else {
        imageHasColor = false;
      }
      markers = [...mapped, ...markers.filter((m) => m.source === 'manual')];
      if (selectedId !== null && !markers.some((m) => m.id === selectedId)) selectedId = null;
      drawOverlay();
      if (notify) {
        if (result.colonies.length) toast(true, m.colonyDetectDone({ count: result.colonies.length }));
        else toast(false, m.colonyNoMarkers());
      }
    } catch {
      if (token === detectToken) toast(false, m.colonyDetectFailed());
    } finally {
      if (token === detectToken) busy = '';
    }
  }

  // --------------------------------------------------------------- overlay

  function drawOverlay() {
    const canvas = overlayCanvas;
    const view = viewCanvas;
    if (!canvas) return;
    if (!view || !workInfo) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const rect = view.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (showMask && maskCanvas) ctx.drawImage(maskCanvas, 0, 0, rect.width, rect.height);
    if (!showNumbers && !markers.length) return;

    const sx = rect.width / workInfo.width;
    const sy = rect.height / workInfo.height;
    const labels = numberMarkers(markers).labels;
    const font = 10;
    ctx.font = `700 ${font}px "SFMono-Regular", "JetBrains Mono", Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const marker of markers) {
      const x = marker.x * sx;
      const y = marker.y * sy;
      const radius = Math.max(5, marker.radius * sx);
      const color = !marker.included
        ? '#ff5d5d'
        : marker.source === 'manual'
          ? '#4cd6ff'
          : colorModeOn && marker.colonyClass === 'blue'
            ? '#5aa9ff'
            : colorModeOn && marker.colonyClass === 'white'
              ? '#f2f2f2'
              : '#53d769';
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (marker.included) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, radius * 0.14), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const arm = radius * 0.7;
        ctx.beginPath();
        ctx.moveTo(x - arm, y - arm);
        ctx.lineTo(x + arm, y + arm);
        ctx.moveTo(x + arm, y - arm);
        ctx.lineTo(x - arm, y + arm);
        ctx.stroke();
      }
      if (showNumbers) {
        const label = marker.included ? String(labels.get(marker.id) ?? '') : '×';
        if (label) {
          const bx = x + radius * 0.8;
          const by = y - radius * 0.8;
          const textWidth = ctx.measureText(label).width;
          const boxWidth = textWidth + 6;
          const boxHeight = font + 4;
          ctx.fillStyle = 'rgba(6, 9, 15, 0.8)';
          ctx.fillRect(bx - boxWidth / 2, by - boxHeight / 2, boxWidth, boxHeight);
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(bx - boxWidth / 2, by - boxHeight / 2, boxWidth, boxHeight);
          ctx.fillStyle = color;
          ctx.fillText(label, bx, by + 0.5);
        }
      }
      if (marker.id === selectedId) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  $effect(() => {
    // Redraw whenever markers, visibility or selection change.
    showMask;
    showNumbers;
    selectedId;
    workInfo;
    hasMask;
    drawOverlay();
  });

  // ---------------------------------------------------------- manual edits

  function canvasPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!viewCanvas || !workInfo) return null;
    const rect = viewCanvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * workInfo.width, 0, workInfo.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * workInfo.height, 0, workInfo.height)
    };
  }

  function displayScale(): number {
    if (!viewCanvas || !workInfo) return 1;
    const rect = viewCanvas.getBoundingClientRect();
    return rect.width > 0 ? workInfo.width / rect.width : 1;
  }

  function hitMarker(x: number, y: number): ColonyMarker | null {
    const minRadius = 9 * displayScale();
    for (let i = markers.length - 1; i >= 0; i--) {
      const marker = markers[i];
      const radius = Math.max(marker.radius * 1.25, minRadius);
      if (Math.hypot(marker.x - x, marker.y - y) <= radius) return marker;
    }
    return null;
  }

  function sampleIntensity(x: number, y: number): number {
    if (!detectPlane) return 0;
    const cx = Math.round(x * detectPlane.fx);
    const cy = Math.round(y * detectPlane.fy);
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= detectPlane.height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= detectPlane.width) continue;
        sum += detectPlane.gray[py * detectPlane.width + px];
        count++;
      }
    }
    return count ? sum / count : 0;
  }

  function addManual(x: number, y: number) {
    if (!workInfo) return;
    const radii = markers.filter((m) => m.source === 'auto' && m.included).map((m) => m.radius);
    const radius = radii.length
      ? median(radii)
      : Math.max(6, Math.min(workInfo.width, workInfo.height) / 70);
    const marker: ColonyMarker = {
      id: nextMarkerId(markers),
      x: clamp(x, 0, workInfo.width - 1),
      y: clamp(y, 0, workInfo.height - 1),
      radius,
      area: Math.PI * radius * radius,
      meanIntensity: sampleIntensity(x, y),
      circularity: 1,
      included: true,
      source: 'manual',
      meanR: 0,
      meanG: 0,
      meanB: 0,
      hue: -1,
      saturation: 0,
      colonyClass: 'unclassified',
      classManual: false
    };
    if (params.colorMode === 'blue-white' && workCanvas) {
      imageHasColor = classifyMarkers(workCanvas, [marker]).imageHasColor;
    }
    markers.push(marker);
    selectedId = marker.id;
    drawOverlay();
  }

  function onPointerDown(event: PointerEvent) {
    if (!workInfo || busy === 'detect') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = canvasPoint(event);
    if (!point) return;
    const hit = hitMarker(point.x, point.y);
    selectedId = hit ? hit.id : null;
    if (hit) {
      dragState = {
        id: hit.id,
        startX: point.x,
        startY: point.y,
        offsetX: hit.x - point.x,
        offsetY: hit.y - point.y,
        moved: false
      };
      pendingAdd = null;
      (event.currentTarget as HTMLCanvasElement).setPointerCapture?.(event.pointerId);
    } else {
      dragState = null;
      pendingAdd = point;
    }
    drawOverlay();
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    const point = canvasPoint(event);
    if (!point) return;
    const threshold = 4 * displayScale();
    if (dragState) {
      const marker = markers.find((m) => m.id === dragState?.id);
      if (!marker || !workInfo) return;
      if (!dragState.moved && Math.hypot(point.x - dragState.startX, point.y - dragState.startY) > threshold) {
        dragState.moved = true;
      }
      if (dragState.moved) {
        marker.x = clamp(point.x + dragState.offsetX, 0, workInfo.width - 1);
        marker.y = clamp(point.y + dragState.offsetY, 0, workInfo.height - 1);
        drawOverlay();
      }
    } else if (pendingAdd) {
      if (Math.hypot(point.x - pendingAdd.x, point.y - pendingAdd.y) > threshold * 1.5) pendingAdd = null;
    }
  }

  function onPointerUp(event: PointerEvent) {
    const point = canvasPoint(event);
    if (dragState) {
      const marker = markers.find((m) => m.id === dragState?.id);
      if (marker && !dragState.moved) {
        marker.included = !marker.included;
        selectedId = marker.id;
      } else if (marker) {
        marker.meanIntensity = sampleIntensity(marker.x, marker.y);
      }
      dragState = null;
    } else if (pendingAdd && point) {
      addManual(point.x, point.y);
    }
    pendingAdd = null;
    const target = event.currentTarget as HTMLCanvasElement;
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    drawOverlay();
  }

  function onPointerCancel() {
    dragState = null;
    pendingAdd = null;
    drawOverlay();
  }

  function toggleSelected() {
    const marker = markers.find((m) => m.id === selectedId);
    if (marker) marker.included = !marker.included;
  }

  function deleteSelected() {
    if (selectedId === null) return;
    markers = markers.filter((m) => m.id !== selectedId);
    selectedId = null;
  }

  function clearMarkers() {
    markers = [];
    selectedId = null;
    toast(true, m.colonyCleared());
  }

  function includeAll() {
    for (const marker of markers) marker.included = true;
  }

  function onKeydown(event: KeyboardEvent) {
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
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null) {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      selectedId = null;
    }
  }

  // ------------------------------------------------------------ project I/O

  function projectSummaryText(): string {
    const base = m.colonyProjectSummary({ count: stats.included });
    if (!colorModeOn) return base;
    return `${base} · ${m.colonyClassCounts({
      blue: classCounts.blue,
      white: classCounts.white,
      unclassified: classCounts.unclassified
    })}`;
  }

  function projectPreview(): string | null {
    if (!processedCanvas) return null;
    try {
      const canvas = renderAnnotated(processedCanvas, markers, numbering, showNumbers);
      return canvasPreview(canvas) || null;
    } catch {
      return null;
    }
  }

  async function captureToProject() {
    if (!projectStore.hasOpenProject || !hasImage) return;
    finishToolCapture(
      'colony',
      colonyProjectName(snapshot(), m.toolsColonyTitle()),
      snapshot(),
      projectPreview() ?? undefined,
      projectSummaryText()
    );
  }

  function statisticsRow(label: string): StatisticsRow {
    return {
      label,
      count: stats.included,
      countLow: countCi.low,
      countHigh: countCi.high,
      blue: classCounts.blue,
      white: classCounts.white,
      unclassified: classCounts.unclassified,
      cfu,
      cfuLow: cfuInterval?.low ?? null,
      cfuHigh: cfuInterval?.high ?? null
    };
  }

  function snapshot(): ColonyProject {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      imageDataUrl,
      imageName,
      imageWidth: sourceWidth,
      imageHeight: sourceHeight,
      workWidth: workInfo?.width ?? 0,
      workHeight: workInfo?.height ?? 0,
      rotate,
      crop: { ...crop },
      adjust: { ...adjust },
      params: { ...params },
      markers: markers.map((marker) => ({ ...marker })),
      dpi,
      dilutionFactor,
      platedVolume
    };
  }

  async function saveProject() {
    if (!hasImage) return;
    try {
      const result = await backend.saveExport(`${baseName()}.colony.json`, projectJson(snapshot()));
      if (result.data?.saved) toast(true, m.colonyProjectSaved());
      else if (result.error) toast(false, result.error);
    } catch (error) {
      toast(false, error instanceof Error ? error.message : m.colonyExportFailed());
    }
  }

  async function importProjectFile(file: File) {
    try {
      const project = parseProjectJson(await file.text());
      await applyProject(project);
      toast(true, m.colonyProjectImported());
    } catch {
      toast(false, m.colonyProjectInvalid());
    }
  }

  async function onPickProject(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importProjectFile(file);
  }

  async function applyProject(project: ColonyProject) {
    cancelDetection();
    const token = ++imageToken;
    imageDataUrl = project.imageDataUrl;
    imageName = project.imageName;
    sourceWidth = project.imageWidth;
    sourceHeight = project.imageHeight;
    rotate = project.rotate;
    crop = { ...project.crop };
    adjust = { ...project.adjust };
    params = { ...project.params };
    dpi = project.dpi === 600 ? 600 : 300;
    dilutionFactor = project.dilutionFactor > 0 ? project.dilutionFactor : 1e6;
    platedVolume = project.platedVolume > 0 ? project.platedVolume : 0.1;
    markers = [];
    selectedId = null;
    maskCanvas = null;
    maskPlane = null;
    detectPlane = null;
    hasMask = false;
    otsuValue = 0;
    detectedThreshold = 0;
    workMeta = null;
    workCanvas = null;
    processedCanvas = null;
    workInfo = null;
    sourceImage = await loadImageElement(project.imageDataUrl);
    if (token !== imageToken) return;
    if (!sourceWidth) sourceWidth = sourceImage.naturalWidth;
    if (!sourceHeight) sourceHeight = sourceImage.naturalHeight;
    rebuildWork(false, false);
    markers = project.markers.map((marker) => ({ ...marker }));
    imageHasColor =
      params.colorMode === 'blue-white' && workCanvas ? detectImageColor(workCanvas) : false;
    drawOverlay();
    if (!markers.length && autoDetect) scheduleDetect();
  }

  async function resetAll() {
    cancelDetection();
    imageToken++;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (cropTimer) {
      clearTimeout(cropTimer);
      cropTimer = null;
    }
    if (adjustTimer) {
      clearTimeout(adjustTimer);
      adjustTimer = null;
    }
    saveToken++;
    clearSnapshot();
    imageDataUrl = '';
    imageName = '';
    sourceWidth = 0;
    sourceHeight = 0;
    rotate = 0;
    crop = defaultCrop();
    adjust = defaultAdjust();
    params = defaultParams();
    markers = [];
    selectedId = null;
    dpi = 300;
    dilutionFactor = 1e6;
    platedVolume = 0.1;
    workMeta = null;
    workCanvas = null;
    processedCanvas = null;
    workInfo = null;
    maskCanvas = null;
    maskPlane = null;
    detectPlane = null;
    hasMask = false;
    otsuValue = 0;
    saveStatus = '';
    imageHasColor = false;
    batchStatus = '';
    sourceImage = null;
    if (viewCanvas) {
      viewCanvas.width = 1;
      viewCanvas.height = 1;
      viewCanvas.style.width = '0px';
      viewCanvas.style.height = '0px';
    }
    drawOverlay();
  }

  // ---------------------------------------------------------------- exports

  async function exportAnnotated() {
    if (!processedCanvas || !hasImage) return;
    busy = 'export';
    try {
      const bytes = await annotatedPngBytes(processedCanvas, markers, numbering, dpi, showNumbers);
      await saveBytes(`${baseName()}_annotated_${dpi}dpi.png`, bytes);
    } catch {
      toast(false, m.colonyExportFailed());
    } finally {
      busy = '';
    }
  }

  async function sendToFigureNow() {
    if (!processedCanvas || !hasImage || busy !== '') return;
    busy = 'export';
    try {
      const canvas = renderAnnotated(processedCanvas, markers, numbering, showNumbers);
      const ok = await sendImageToFigure({
        dataUrl: canvas.toDataURL('image/png'),
        name: `${baseName()}_annotated`,
        width: canvas.width,
        height: canvas.height,
      });
      if (!ok) toast(false, m.sendToFigureFailed());
    } catch (error) {
      toast(false, error instanceof Error ? error.message : m.colonyExportFailed());
    } finally {
      busy = '';
    }
  }

  async function exportMask() {
    if (!maskPlane) return;
    busy = 'export';
    try {
      const bytes = await maskPngBytes(maskPlane.mask, maskPlane.width, maskPlane.height, dpi);
      await saveBytes(`${baseName()}_mask_${dpi}dpi.png`, bytes);
    } catch {
      toast(false, m.colonyExportFailed());
    } finally {
      busy = '';
    }
  }

  async function exportCsv() {
    if (!markers.length) return;
    busy = 'export';
    try {
      const bytes = new TextEncoder().encode(markersToCsv(markers, numbering));
      await saveBytes(`${baseName()}_markers.csv`, bytes, 'text');
    } catch {
      toast(false, m.colonyExportFailed());
    } finally {
      busy = '';
    }
  }

  async function exportStatisticsCsv() {
    if (!markers.length) return;
    busy = 'export';
    try {
      const bytes = new TextEncoder().encode(
        statisticsToCsv([statisticsRow(projectBaseName(imageName))])
      );
      await saveBytes(`${baseName()}_statistics.csv`, bytes, 'text');
    } catch {
      toast(false, m.colonyExportFailed());
    } finally {
      busy = '';
    }
  }

  async function exportReproBundle() {
    if (!hasImage || !processedCanvas || !maskPlane || reproBusy) return;
    reproBusy = true;
    try {
      const annotated = await annotatedPngBytes(processedCanvas, markers, numbering, dpi, showNumbers);
      const mask = await maskPngBytes(maskPlane.mask, maskPlane.width, maskPlane.height, dpi);
      const result = await saveReproBundle({
        tool: 'Colony counter',
        title: colonyProjectName(snapshot(), m.toolsColonyTitle()),
        files: [
          { name: `${baseName()}_annotated_${dpi}dpi.png`, mime: 'image/png', data: annotated },
          { name: `${baseName()}_mask_${dpi}dpi.png`, mime: 'image/png', data: mask },
          { name: `${baseName()}_markers.csv`, mime: 'text/csv', data: markersToCsv(markers, numbering) },
          {
            name: `${baseName()}_statistics.csv`,
            mime: 'text/csv',
            data: statisticsToCsv([statisticsRow(projectBaseName(imageName))])
          }
        ],
        parameters: {
          image: {
            name: imageName,
            width: sourceWidth,
            height: sourceHeight,
            workWidth: workInfo?.width ?? 0,
            workHeight: workInfo?.height ?? 0
          },
          rotate,
          crop: { ...crop },
          adjust: { ...adjust },
          detection: { ...params },
          otsu: otsuValue,
          threshold: detectedThreshold,
          polarity: resolvedPolarity,
          dpi,
          dilutionFactor,
          platedVolume,
          count: stats.included,
          countCi95: countCi,
          cfu,
          cfuCi95: cfuInterval,
          classCounts: { ...classCounts }
        },
        methods:
          'Colonies were segmented from the plate image with SPICE GUI using Gaussian pre-blurring, Otsu or manual thresholding, connected-component analysis and optional distance-transform watershed splitting for touching colonies. Area and circularity filters were applied exactly as recorded in parameters.json. Markers were reviewed in the editor; excluded markers remain in the marker CSV. Blue/white classes, when enabled, come from mean RGB and HSV hue measured on the original color image, with user overrides recorded in the class_manual column. The count and CFU/mL intervals are exact Poisson 95% intervals (Garwood).',
        project: snapshot()
      });
      if (result.ok) toast(true, m.colonyReproDone());
      else if (!result.canceled) toast(false, m.colonyReproFailed());
    } catch {
      toast(false, m.colonyReproFailed());
    } finally {
      reproBusy = false;
    }
  }

  async function onBatchFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = imageFiles(Array.from(input.files ?? []));
    input.value = '';
    if (files.length === 0) {
      toast(false, m.colonyBatchEmpty());
      return;
    }
    if (files.length > MAX_BATCH_PLATES) {
      pushToast('warn', title(), m.colonyBatchCap({ max: MAX_BATCH_PLATES }));
    }
    batchProgress = {
      running: true,
      done: 0,
      total: Math.min(files.length, MAX_BATCH_PLATES),
      current: files[0].name
    };
    batchStatus = '';
    try {
      const input: ColonyBatchInput = {
        params: { ...params },
        adjust: { ...adjust },
        dpi,
        showNumbers,
        dilutionFactor: Number(dilutionFactor),
        platedVolume: Number(platedVolume)
      };
      const report = (done: number, total: number, name: string) => {
        batchProgress = { running: true, done, total, current: name };
      };
      const result = await runBatchJob<ColonyBatchResult>({
        createWorker: () => new Worker(new URL('./batch.worker.ts', import.meta.url), { type: 'module' }),
        files,
        payload: input,
        onProgress: (p) => report(p.done, p.total, p.name),
        fallback: () => runColonyBatch(files, input, report),
      });
      const saved = await saveZip(`${fileBaseName(files[0].name, 'colony')}-batch.zip`, result.entries);
      if (saved.ok) {
        batchStatus = m.colonyBatchDone({ ok: result.processed, failed: result.failed });
        toast(true, batchStatus);
      } else if (saved.error) {
        toast(false, m.colonyBatchFailed({ message: saved.error }));
      }
    } catch (error) {
      toast(false, m.colonyBatchFailed({ message: error instanceof Error ? error.message : String(error) }));
    } finally {
      batchProgress = { running: false, done: batchProgress.done, total: batchProgress.total, current: '' };
    }
  }

  // ------------------------------------------------------------- autosave

  $effect(() => {
    const project = snapshot();
    const active = hydrated && !!imageDataUrl && !!workInfo;
    if (!active) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const token = ++saveToken;
    autosaveTimer = setTimeout(() => {
      void (async () => {
        const compact = await compactProjectImage(project);
        if (token !== saveToken) return;
        const ok = saveSnapshot(compact);
        if (token !== saveToken) return;
        if (ok) {
          saveStatus = m.colonySavedLocal();
        } else if (!autosaveWarned) {
          autosaveWarned = true;
          pushToast('warn', title(), m.colonyAutosaveFailed());
        }
      })();
    }, 800);
  });

  // Write the live annotation back into the active project document. Debounced
  // so marker dragging does not persist the image on every pointer move.
  $effect(() => {
    if (!hydrated || handoffLoading) return;
    if (projectStore.activeDocKind !== 'colony') return;
    if (!imageDataUrl || !workInfo) return;
    const project = snapshot();
    const timer = setTimeout(() => {
      if (projectStore.activeDocKind === 'colony') projectStore.commitDoc('colony', project);
    }, 500);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const observer = new ResizeObserver(() => fitDisplay());
    if (stageEl) observer.observe(stageEl);
    void (async () => {
      handoffLoading = true;
      ensureProjectLoaded();
      const handoff = takeToolHandoff('colony');
      let openedFromProject = false;
      if (handoff?.type === 'open') {
        const project = normalizeColonyPayload(handoff.payload);
        if (project) {
          try {
            await applyProject(project);
            pushToast('info', title(), m.colonyProjectImported());
            openedFromProject = true;
          } catch {
            pushToast('error', title(), m.colonyProjectInvalid());
          }
        } else {
          pushToast('error', title(), m.colonyProjectInvalid());
        }
      }
      if (!openedFromProject) {
        const saved = loadSnapshot();
        if (saved && saved.imageDataUrl) {
          try {
            await applyProject(saved);
            pushToast('info', title(), m.colonyRestored());
          } catch {
            /* ignore a corrupt snapshot */
          }
        }
      }
      hydrated = true;
      handoffLoading = false;
      if (handoff?.type === 'capture') await captureToProject();
    })();
    return () => {
      observer.disconnect();
      if (autosaveTimer) clearTimeout(autosaveTimer);
      if (detectTimer) clearTimeout(detectTimer);
      if (cropTimer) clearTimeout(cropTimer);
      if (adjustTimer) clearTimeout(adjustTimer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} onresize={onWindowResize} />

<div
  class="colony-page"
  role="application"
  aria-label={m.toolsColonyTitle()}
  ondragover={(event) => event.preventDefault()}
  ondrop={onDrop}
>
  <input
    bind:this={imageInput}
    data-testid="colony-image-input"
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
  <input
    bind:this={batchInput}
    type="file"
    multiple
    accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff"
    style="display:none"
    onchange={onBatchFiles}
  />

  <ToolProjectBar
    kind="colony"
    getPayload={() => snapshot()}
    getName={() => colonyProjectName(snapshot(), m.toolsColonyTitle())}
    getPreview={projectPreview}
    getSummary={projectSummaryText}
  />

  <div class="colony-toolbar">
    <button class="pix-btn" onclick={() => imageInput?.click()} disabled={busy !== ''}>
      <Upload size={12} /> {hasImage ? m.colonyReplace() : m.colonyImport()}
    </button>
    <button
      class="pix-btn accent"
      disabled={!hasImage || busy !== ''}
      onclick={() => runDetection(true)}
    >
      <Wand2 size={12} /> {busy === 'detect' ? m.colonyDetecting() : m.colonyDetect()}
    </button>
    <button
      class="pix-btn"
      disabled={busy !== '' || batchProgress.running}
      title={m.colonyBatchHint({ max: MAX_BATCH_PLATES })}
      onclick={() => batchInput?.click()}
    >
      <Images size={12} /> {m.colonyBatch()}
    </button>
    <span class="spacer"></span>
    {#if batchProgress.running}
      <span class="batch-status">
        {m.colonyBatchRunning({
          done: batchProgress.done,
          total: batchProgress.total,
          name: batchProgress.current
        })}
      </span>
    {:else if batchStatus}
      <span class="batch-status">{batchStatus}</span>
    {/if}
    <button class="pix-btn" onclick={() => projectInput?.click()}>
      <FolderOpen size={12} /> {m.colonyOpenProject()}
    </button>
    <button class="pix-btn" disabled={!hasImage || busy === 'export'} onclick={saveProject}>
      <Save size={12} /> {m.colonySaveProject()}
    </button>
    <button class="pix-btn danger" onclick={resetAll}>
      <Trash2 size={12} /> {m.colonyReset()}
    </button>
    {#if saveStatus}<span class="save-status">{saveStatus}</span>{/if}
  </div>

  <div class="colony-body">
    <aside class="colony-side">
      <details open>
        <summary><ImageIcon size={11} /> {m.colonyImageSection()}</summary>
        <div class="sec-body">
          {#if !hasImage}
            <div class="empty-hint">{m.colonyNoImage()}</div>
            <div class="hint">{m.colonyDropHint()}</div>
          {:else}
            <div class="meta-line">{m.colonyImageSize({ w: sourceWidth, h: sourceHeight })}</div>
            <div class="meta-line">{m.colonyWorkSize({ w: workInfo?.width ?? 0, h: workInfo?.height ?? 0 })}</div>
            {#if workInfo?.downscaled}
              <div class="warn-line">{m.colonyDownscaled({ max: MAX_WORK_DIM })}</div>
            {/if}
            <div class="btn-row">
              <button class="pix-btn small" onclick={() => rotateQuarter(-90)} title={m.colonyRotateLeft()}>
                <RotateCcw size={11} /> {m.colonyRotateLeft()}
              </button>
              <button class="pix-btn small" onclick={() => rotateQuarter(90)} title={m.colonyRotateRight()}>
                <RotateCw size={11} /> {m.colonyRotateRight()}
              </button>
              <button class="pix-btn small" onclick={() => rotateQuarter(180)}>{m.colonyRotate180()}</button>
            </div>
            <div class="sub-head">{m.colonyCrop()}</div>
            <div class="crop-grid">
              <label>
                {m.colonyCropLeft()}
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.005"
                  value={crop.left}
                  oninput={(event) => {
                    crop.left = num(event);
                    scheduleCrop();
                  }}
                />
              </label>
              <label>
                {m.colonyCropTop()}
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.005"
                  value={crop.top}
                  oninput={(event) => {
                    crop.top = num(event);
                    scheduleCrop();
                  }}
                />
              </label>
              <label>
                {m.colonyCropRight()}
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.005"
                  value={crop.right}
                  oninput={(event) => {
                    crop.right = num(event);
                    scheduleCrop();
                  }}
                />
              </label>
              <label>
                {m.colonyCropBottom()}
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.005"
                  value={crop.bottom}
                  oninput={(event) => {
                    crop.bottom = num(event);
                    scheduleCrop();
                  }}
                />
              </label>
            </div>
            <button class="pix-btn small" onclick={resetCrop}>{m.colonyResetCrop()}</button>
            <div class="sub-head">{m.colonyResetAdjust()}</div>
            <label class="check">
              <input
                type="checkbox"
                checked={adjust.grayscale}
                onchange={(event) => {
                  adjust.grayscale = event.currentTarget.checked;
                  scheduleAdjust();
                }}
              />
              {m.colonyGrayscale()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={adjust.invert}
                onchange={(event) => {
                  adjust.invert = event.currentTarget.checked;
                  scheduleAdjust();
                }}
              />
              {m.colonyInvert()}
            </label>
            <div class="row">
              <span>{m.colonyBrightness()} <output>{adjust.brightness.toFixed(0)}</output></span>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={adjust.brightness}
                oninput={(event) => {
                  adjust.brightness = num(event);
                  scheduleAdjust();
                }}
              />
            </div>
            <div class="row">
              <span>{m.colonyContrast()} <output>{adjust.contrast.toFixed(2)}</output></span>
              <input
                type="range"
                min="0.2"
                max="3"
                step="0.05"
                value={adjust.contrast}
                oninput={(event) => {
                  adjust.contrast = num(event);
                  scheduleAdjust();
                }}
              />
            </div>
            <button class="pix-btn small" onclick={resetAdjust}>{m.colonyResetAdjust()}</button>
          {/if}
        </div>
      </details>

      <details open>
        <summary><SlidersHorizontal size={11} /> {m.colonyDetectionSection()}</summary>
        <div class="sec-body">
          <label class="check">
            <input
              type="checkbox"
              checked={autoDetect}
              onchange={(event) => {
                autoDetect = event.currentTarget.checked;
                if (autoDetect) {
                  cancelDetection();
                  scheduleDetect();
                }
              }}
            />
            {m.colonyAutoDetect()}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={params.autoThreshold}
              onchange={(event) => {
                params.autoThreshold = event.currentTarget.checked;
                if (!params.autoThreshold && otsuValue > 0) params.manualThreshold = Math.round(otsuValue);
                onParamsChange();
              }}
            />
            {m.colonyAutoThreshold()}
          </label>
          <div class="row">
            <span>
              {m.colonyThreshold()}
              <output>{params.autoThreshold ? Math.round(otsuValue) : Math.round(params.manualThreshold)}</output>
            </span>
            <input
              type="range"
              min="0"
              max="255"
              step="1"
              value={params.autoThreshold ? Math.round(otsuValue) : params.manualThreshold}
              disabled={params.autoThreshold}
              oninput={(event) => {
                params.manualThreshold = num(event);
                params.autoThreshold = false;
                onParamsChange();
              }}
            />
          </div>
          {#if otsuValue > 0}
            <div class="hint">
              {m.colonyOtsuValue({ value: Math.round(otsuValue) })} · {m.colonyThreshold()}:
              {Math.round(detectedThreshold)} ·
              {resolvedPolarity === 'dark' ? m.colonyPolarityDark() : m.colonyPolarityBright()}
            </div>
          {/if}
          <div class="row">
            <span>{m.colonyBlurRadius()} <output>{params.blurRadius.toFixed(1)}</output></span>
            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              value={params.blurRadius}
              oninput={(event) => {
                params.blurRadius = num(event);
                onParamsChange();
              }}
            />
          </div>
          <label class="field">
            {m.colonyPolarity()}
            <select
              class="pix-input"
              value={params.polarity}
              onchange={(event) => {
                params.polarity = (event.currentTarget as HTMLSelectElement).value as ColonyPolarity;
                onParamsChange();
              }}
            >
              <option value="auto">{m.colonyPolarityAuto()}</option>
              <option value="dark">{m.colonyPolarityDark()}</option>
              <option value="bright">{m.colonyPolarityBright()}</option>
            </select>
          </label>
          <div class="two-col">
            <label class="field">
              {m.colonyMinArea()}
              <input
                class="pix-input"
                type="number"
                min="0"
                step="1"
                value={params.minArea}
                onchange={(event) => {
                  params.minArea = Math.max(0, num(event));
                  onParamsChange();
                }}
              />
            </label>
            <label class="field">
              {m.colonyMaxArea()}
              <input
                class="pix-input"
                type="number"
                min="0"
                step="1"
                value={params.maxArea}
                onchange={(event) => {
                  params.maxArea = Math.max(0, num(event));
                  onParamsChange();
                }}
              />
            </label>
          </div>
          <div class="row">
            <span>{m.colonyCircularity()} <output>{params.minCircularity.toFixed(2)}</output></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={params.minCircularity}
              oninput={(event) => {
                params.minCircularity = num(event);
                onParamsChange();
              }}
            />
          </div>
          <label class="check">
            <input
              type="checkbox"
              checked={params.splitTouching}
              onchange={(event) => {
                params.splitTouching = event.currentTarget.checked;
                onParamsChange();
              }}
            />
            {m.colonySplitTouching()}
          </label>
          <div class="hint">{m.colonySplitHint()}</div>
        </div>
      </details>

      <details open>
        <summary><Palette size={11} /> {m.colonyColorSection()}</summary>
        <div class="sec-body">
          <label class="field">
            {m.colonyColorMode()}
            <select
              class="pix-input"
              value={params.colorMode}
              onchange={(event) =>
                onColorModeChange((event.currentTarget as HTMLSelectElement).value as ColonyColorMode)}
            >
              <option value="off">{m.colonyColorOff()}</option>
              <option value="blue-white">{m.colonyColorBlueWhite()}</option>
            </select>
          </label>
          <div class="hint">{m.colonyColorHint()}</div>
          {#if colorModeOn}
            {#if !imageHasColor}
              <div class="warn-line">{m.colonyColorUnavailable()}</div>
            {/if}
            <div class="meta-line">
              {m.colonyClassCounts({
                blue: classCounts.blue,
                white: classCounts.white,
                unclassified: classCounts.unclassified
              })}
            </div>
            <div class="legend">
              <span class="legend-item"><i class="dot blue"></i>{m.colonyClassBlue()}</span>
              <span class="legend-item"><i class="dot white"></i>{m.colonyClassWhite()}</span>
              <span class="legend-item"><i class="dot unclassified"></i>{m.colonyClassUnclassified()}</span>
            </div>
          {/if}
        </div>
      </details>

      <details open>
        <summary><ScanLine size={11} /> {m.colonyManualSection()}</summary>
        <div class="sec-body">
          <div class="hint">{m.colonyClickAdd()}</div>
          <div class="hint">{m.colonyClickToggle()}</div>
          <div class="hint">{m.colonyDragMove()}</div>
          <div class="meta-line">{m.colonyManualCount({ count: stats.manual })}</div>
          {#if selected}
            <div class="marker-card">
              <div class="marker-head">
                {m.colonySelectedMarker()} · {m.colonyMarkerId({ id: selected.id })}
              </div>
              <div class="stat-row">
                <span>{m.colonyMarkerArea()}</span>
                <strong>{formatArea(selected.area)} {m.colonyAreaUnit()}</strong>
              </div>
              <div class="stat-row">
                <span>{m.colonyMarkerIntensity()}</span>
                <strong>{selected.meanIntensity.toFixed(1)}</strong>
              </div>
              <div class="stat-row">
                <span>{m.colonyMarkerCircularity()}</span>
                <strong>{selected.circularity.toFixed(2)}</strong>
              </div>
              {#if colorModeOn}
                <div class="stat-row">
                  <span>{m.colonyMarkerClass()}</span>
                  <strong>{classLabel(selected.colonyClass)}</strong>
                </div>
                {#if selected.hue >= 0}
                  <div class="stat-row">
                    <span>{m.colonyMarkerRgb()}</span>
                    <strong>
                      {selected.meanR.toFixed(0)}, {selected.meanG.toFixed(0)}, {selected.meanB.toFixed(0)}
                    </strong>
                  </div>
                  <div class="stat-row">
                    <span>{m.colonyMarkerHue()}</span>
                    <strong>{selected.hue.toFixed(0)}° · {selected.saturation.toFixed(2)}</strong>
                  </div>
                {/if}
                <div class="btn-row">
                  <button
                    class="pix-btn small"
                    class:active={selected.colonyClass === 'blue'}
                    onclick={() => setSelectedClass('blue')}
                  >
                    {m.colonyClassBlue()}
                  </button>
                  <button
                    class="pix-btn small"
                    class:active={selected.colonyClass === 'white'}
                    onclick={() => setSelectedClass('white')}
                  >
                    {m.colonyClassWhite()}
                  </button>
                  <button
                    class="pix-btn small"
                    class:active={selected.colonyClass === 'unclassified'}
                    onclick={() => setSelectedClass('unclassified')}
                  >
                    {m.colonyClassUnclassified()}
                  </button>
                </div>
                <div class="hint">{m.colonyClassManualHint()}</div>
              {/if}
              <div class="btn-row">
                <button class="pix-btn small" class:ok={!selected.included} onclick={toggleSelected}>
                  {selected.included ? m.colonyExclude() : m.colonyInclude()}
                </button>
                <button class="pix-btn small danger" onclick={deleteSelected}>
                  {m.colonyDeleteMarker()}
                </button>
              </div>
            </div>
          {:else}
            <div class="empty-hint">{m.colonyNoneSelected()}</div>
          {/if}
          <div class="btn-row wrap">
            <button class="pix-btn small" disabled={!markers.length} onclick={includeAll}>
              {m.colonyResetExclusions()}
            </button>
            <button class="pix-btn small danger" disabled={!markers.length} onclick={clearMarkers}>
              {m.colonyClearMarkers()}
            </button>
          </div>
          <div class="legend">
            <span class="legend-item"><i class="dot included"></i>{m.colonyLegendIncluded()}</span>
            <span class="legend-item"><i class="dot excluded"></i>{m.colonyLegendExcluded()}</span>
            <span class="legend-item"><i class="dot manual"></i>{m.colonyLegendManual()}</span>
          </div>
        </div>
      </details>
    </aside>

    <div class="colony-main">
      <div class="stage-head">
        <span class="stage-title"><Microscope size={12} /> {m.colonyView()}</span>
        <span class="stage-tools">
          <label class="inline">
            <input type="checkbox" bind:checked={showMask} disabled={!hasMask} />
            {m.colonyShowMask()}
          </label>
          <label class="inline">
            <input type="checkbox" bind:checked={showNumbers} />
            {m.colonyShowNumbers()}
          </label>
          <span class="pix-dim tiny">{stats.included} / {stats.total}</span>
        </span>
      </div>
      <div class="colony-stage" bind:this={stageEl}>
        {#if hasImage}
          <div class="canvas-stack">
            <canvas bind:this={viewCanvas} class="view-canvas"></canvas>
            <canvas
              bind:this={overlayCanvas}
              class="overlay-canvas"
              aria-label={m.colonyView()}
              onpointerdown={onPointerDown}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerCancel}
            ></canvas>
          </div>
        {:else}
          <div class="stage-empty">
            <Microscope size={30} />
            <p>{m.colonyStageEmpty()}</p>
            <button class="pix-btn accent" onclick={() => imageInput?.click()}>
              <Upload size={12} /> {m.colonyImport()}
            </button>
            <span class="pix-dim tiny">{m.colonyDropHint()}</span>
          </div>
        {/if}
      </div>
      <div class="stage-foot">
        {#if hasMask && showMask}<span class="hint">{m.colonyMaskHint()}</span>{/if}
        <span class="spacer"></span>
        <span class="pix-dim tiny">{m.colonyAreaUnit()}</span>
      </div>
    </div>

    <aside class="colony-results">
      <details open>
        <summary><Microscope size={11} /> {m.colonyResults()}</summary>
        <div class="sec-body">
          <div class="count-block">
            <span class="count-label">{m.colonyCount()}</span>
            <span class="count-big">{stats.included}</span>
          </div>
          <div class="ci-line">
            {m.colonyCountCi({
              low: formatScientific(countCi.low),
              high: formatScientific(countCi.high)
            })}
          </div>
          <div class="stat-row">
            <span>{m.colonyIncluded()}</span>
            <strong class="ok-text">{stats.included}</strong>
          </div>
          <div class="stat-row">
            <span>{m.colonyExcluded()}</span>
            <strong class="bad-text">{stats.excluded}</strong>
          </div>
          {#if colorModeOn}
            <div class="stat-row">
              <span>{m.colonyClassBlue()}</span>
              <strong>{classCounts.blue}</strong>
            </div>
            <div class="stat-row">
              <span>{m.colonyClassWhite()}</span>
              <strong>{classCounts.white}</strong>
            </div>
            <div class="stat-row">
              <span>{m.colonyClassUnclassified()}</span>
              <strong>{classCounts.unclassified}</strong>
            </div>
          {/if}
          <div class="stat-row">
            <span>{m.colonyMeanArea()}</span>
            <strong>{formatArea(stats.meanArea)} {m.colonyAreaUnit()}</strong>
          </div>
          <div class="stat-row">
            <span>{m.colonyMedianArea()}</span>
            <strong>{formatArea(stats.medianArea)} {m.colonyAreaUnit()}</strong>
          </div>
          <div class="stat-row">
            <span>{m.colonyMeanIntensity()}</span>
            <strong>{stats.meanIntensity.toFixed(1)}</strong>
          </div>
          <div class="sub-head">{m.colonySizeDistribution()}</div>
          {#if histogram.counts.length}
            <svg viewBox="0 0 280 132" class="histogram" role="img" aria-label={m.colonySizeDistribution()}>
              {#each histogram.counts as count, index (index)}
                {@const barWidth = 260 / histogram.counts.length}
                {@const barHeight = (count / histogram.peak) * 92}
                <rect
                  x={10 + index * barWidth + 1}
                  y={102 - barHeight}
                  width={Math.max(1, barWidth - 2)}
                  height={Math.max(0, barHeight)}
                  fill="var(--pix-cyan)"
                  opacity="0.78"
                />
              {/each}
              <line x1="10" y1="103" x2="270" y2="103" stroke="var(--pix-border-hi)" stroke-width="1" />
              <text x="10" y="122" class="axis">{histogram.min.toFixed(0)}</text>
              <text x="270" y="122" class="axis" text-anchor="end">{histogram.max.toFixed(0)}</text>
              <text x="140" y="122" class="axis" text-anchor="middle">{m.colonyAreaUnit()}</text>
            </svg>
          {:else}
            <div class="empty-hint">{m.colonyHistogramEmpty()}</div>
          {/if}
          {#if !markers.length}<div class="empty-hint">{m.colonyNoMarkers()}</div>{/if}
        </div>
      </details>

      <details open>
        <summary><SlidersHorizontal size={11} /> {m.colonyCfu()}</summary>
        <div class="sec-body">
          <label class="field">
            {m.colonyDilutionFactor()}
            <input class="pix-input" type="number" min="0" step="any" bind:value={dilutionFactor} />
          </label>
          <label class="field">
            {m.colonyPlatedVolume()}
            <input class="pix-input" type="number" min="0" step="any" bind:value={platedVolume} />
          </label>
          <div class="cfu-result">
            <span>{m.colonyCfuResult()}</span>
            <strong>{formatScientific(cfu)}</strong>
          </div>
          {#if cfu === null}
            <div class="warn-line">{m.colonyCfuInvalid()}</div>
          {:else}
            <div class="ci-line">
              {m.colonyCfuCi({
                low: formatScientific(cfuInterval?.low ?? null),
                high: formatScientific(cfuInterval?.high ?? null)
              })}
            </div>
          {/if}
          <div class="hint">{m.colonyCfuFormula()}</div>
        </div>
      </details>

      <details open>
        <summary><Download size={11} /> {m.colonyExportSection()}</summary>
        <div class="sec-body">
          <div class="row">
            <span>{m.colonyDpi()}</span>
            <div class="btn-row">
              <button class="pix-btn small" class:active={dpi === 300} onclick={() => (dpi = 300)}>300 dpi</button>
              <button class="pix-btn small" class:active={dpi === 600} onclick={() => (dpi = 600)}>600 dpi</button>
            </div>
          </div>
          <button class="pix-btn" disabled={!hasImage || busy !== ''} onclick={exportAnnotated}>
            <Download size={11} /> {m.colonyExportPng()}
          </button>
          <button
            class="pix-btn"
            disabled={!hasImage || !processedCanvas || busy !== ''}
            onclick={sendToFigureNow}
            title={m.sendToFigure()}
            aria-label={m.sendToFigure()}
            data-testid="send-to-figure"
          >
            <Send size={11} /> {m.sendToFigure()}
          </button>
          <button class="pix-btn" disabled={!hasMask || busy !== ''} onclick={exportMask}>
            <Download size={11} /> {m.colonyExportMask()}
          </button>
          <button class="pix-btn" disabled={!markers.length || busy !== ''} onclick={exportCsv}>
            <Download size={11} /> {m.colonyExportCsv()}
          </button>
          <button class="pix-btn" disabled={!markers.length || busy !== ''} onclick={exportStatisticsCsv}>
            <Download size={11} /> {m.colonyExportStats()}
          </button>
          <button
            class="pix-btn"
            disabled={!hasImage || !maskPlane || reproBusy}
            onclick={exportReproBundle}
          >
            <Download size={11} /> {reproBusy ? m.colonyReproBusy() : m.colonyReproBundle()}
          </button>
          <div class="hint">{m.colonyExportHint()}</div>
          <div class="hint">{m.colonyMaskHint()}</div>
          <div class="hint">{m.colonyCsvHint()}</div>
          <div class="hint">{m.colonyStatsHint()}</div>
          <div class="hint">{m.colonyReproHint()}</div>
          <div class="hint">{m.colonyProjectHint()}</div>
        </div>
      </details>
    </aside>
  </div>
</div>

<style>
  .colony-page {
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
  .colony-toolbar {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    padding: 6px 8px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  .colony-toolbar .pix-btn {
    padding: 4px 9px;
    font-size: 9.5px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .pix-btn.accent { border-color: var(--pix-accent); color: var(--pix-accent); }
  .pix-btn.ok { border-color: var(--pix-green); color: var(--pix-green); }
  .pix-btn.danger { color: var(--pix-red); }
  .pix-btn.active { border-color: var(--pix-cyan); color: var(--pix-cyan); background: var(--pix-bg-2); }
  .spacer { flex: 1; }
  .save-status { font-size: 8.5px; color: var(--pix-green); }
  .batch-status { font-size: 8.5px; color: var(--pix-cyan); max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ci-line { font-size: 8.5px; color: var(--pix-fg-dim); line-height: 1.45; }
  .colony-body { flex: 1; display: flex; gap: 8px; min-height: 0; }
  .colony-side {
    width: 318px;
    min-width: 286px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
  }
  .colony-results {
    width: 300px;
    min-width: 264px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  details { border: 1px solid var(--pix-border); background: var(--pix-bg-2); }
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
  .sec-body { padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; flex-direction: column; gap: 2px; color: var(--pix-fg-dim); font-size: 9.5px; }
  .row output { color: var(--pix-fg); font-weight: bold; }
  .row input[type='range'] { width: 100%; }
  .check { display: flex; align-items: center; gap: 5px; color: var(--pix-fg); cursor: pointer; }
  .inline { display: inline-flex; align-items: center; gap: 4px; color: var(--pix-fg-dim); font-size: 9px; }
  .btn-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .pix-btn.small { padding: 2px 6px; font-size: 8.5px; display: inline-flex; align-items: center; gap: 3px; }
  .pix-dim { color: var(--pix-fg-dim); }
  .tiny { font-size: 8.5px; }
  .empty-hint { color: var(--pix-fg-dim); font-size: 9.5px; padding: 4px 0; line-height: 1.5; }
  .hint { color: var(--pix-fg-dim); font-size: 8.5px; line-height: 1.5; }
  .warn-line { color: var(--pix-accent); font-size: 8.5px; line-height: 1.5; }
  .meta-line { color: var(--pix-fg-dim); font-size: 9px; }
  .sub-head {
    color: var(--pix-accent-2);
    font-size: 9px;
    font-weight: bold;
    border-top: 1px dashed var(--pix-border);
    padding-top: 4px;
    margin-top: 2px;
  }
  .crop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
  .crop-grid label { display: flex; flex-direction: column; font-size: 8.5px; color: var(--pix-fg-dim); gap: 1px; }
  .field { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: var(--pix-fg-dim); }
  .field .pix-input { font-size: 9px; height: 21px; padding: 1px 4px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; }
  .marker-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid var(--pix-border-hi);
    padding: 5px;
    background: var(--pix-bg-3);
  }
  .marker-head { font-size: 9.5px; font-weight: bold; color: var(--pix-cyan); }
  .stat-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    font-size: 9px;
    color: var(--pix-fg-dim);
  }
  .stat-row strong { color: var(--pix-fg); font-size: 9.5px; }
  .stat-row .ok-text { color: var(--pix-green); }
  .stat-row .bad-text { color: var(--pix-red); }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; border-top: 1px dashed var(--pix-border); padding-top: 4px; }
  .legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .dot { width: 9px; height: 9px; border: 2px solid; border-radius: 50%; display: inline-block; }
  .dot.included { border-color: var(--pix-green); }
  .dot.excluded { border-color: var(--pix-red); }
  .dot.manual { border-color: var(--pix-cyan); }
  .dot.blue { border-color: #5aa9ff; }
  .dot.white { border-color: #e8e8e8; background: rgba(232, 232, 232, 0.25); }
  .dot.unclassified { border-color: var(--pix-fg-dim); }
  .colony-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .stage-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .stage-title { display: inline-flex; align-items: center; gap: 5px; }
  .stage-tools { display: inline-flex; align-items: center; gap: 10px; font-weight: normal; }
  .colony-stage {
    flex: 1;
    min-height: 280px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--pix-border);
    background: #04060a;
    padding: 6px;
  }
  .canvas-stack { position: relative; display: inline-block; flex: none; line-height: 0; }
  .view-canvas { display: block; width: 0; height: 0; }
  .overlay-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  .stage-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--pix-fg-dim);
    font-size: 11px;
    padding: 30px 12px;
    text-align: center;
  }
  .stage-empty p { margin: 0; }
  .stage-foot { display: flex; align-items: center; gap: 8px; min-height: 14px; }
  .count-block { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .count-label { font-size: 9.5px; color: var(--pix-fg-dim); }
  .count-big {
    font-size: 30px;
    font-weight: 900;
    line-height: 1;
    color: var(--pix-accent-2);
    text-shadow: 2px 2px 0 #000;
  }
  .histogram { width: 100%; height: auto; display: block; background: var(--pix-bg); border: 1px solid var(--pix-border); }
  .histogram .axis { fill: var(--pix-fg-dim); font-size: 8px; font-family: var(--pix-font); }
  .cfu-result {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid var(--pix-border-hi);
    background: var(--pix-bg-3);
    padding: 5px 7px;
    font-size: 9.5px;
    color: var(--pix-fg-dim);
  }
  .cfu-result strong { color: var(--pix-green); font-size: 12px; }
  @media (max-width: 1320px) {
    .colony-body { flex-wrap: wrap; }
    .colony-results { width: 100%; max-height: 42vh; }
  }
  @media (max-width: 980px) {
    .colony-side { width: 100%; max-height: 42vh; }
  }
</style>
