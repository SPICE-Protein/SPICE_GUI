<script lang="ts">
  // Gel figure tool: straighten/crop a gel photo, find lanes and bands,
  // fit a marker ladder, label sizes, and export a publication-style PNG.
  // Everything is computed locally in the webview.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import {
    Upload, Wand2, Plus, Trash2, RotateCcw, Crosshair, Download, Save, FolderOpen, Eraser
  } from 'lucide-svelte';
  import {
    toGrayPlane, rowProfile, findPeaks, detectLanes,
    fitLadder, sizeFromY, rotationScore, type LadderFit
  } from './gelmath';
  import { emptyProject, newLaneId, type GelLane, type GelProject } from './types';

  let project = $state<GelProject>(emptyProject());
  let imageEl = $state<HTMLImageElement | null>(null);
  let imageInput: HTMLInputElement | null = $state(null);
  let projectInput: HTMLInputElement | null = $state(null);
  let canvasWrap: HTMLDivElement | null = $state(null);
  let displayCanvas: HTMLCanvasElement | null = $state(null);
  let overlayCanvas: HTMLCanvasElement | null = $state(null);

  // Full-resolution processed image (crop + adjustments applied), kept out of
  // reactive state: pixel data must not be proxied by Svelte 5.
  let processedCanvas: HTMLCanvasElement | null = null;
  let processedGray: Float32Array | null = null;
  let processedW = 0;
  let processedH = 0;

  let fit = $state<LadderFit | null>(null);
  let busy = $state('');
  let selectedLaneId = $state<string | null>(null);
  let groupName = $state('');
  let selectedForGroup = $state<string[]>([]);
  let dragLane = $state<{ id: string; pointerId: number } | null>(null);

  const laneOf = (id: string | null) => project.lanes.find((l) => l.id === id) ?? null;
  const hasImage = $derived(!!project.imageDataUrl);

  onMount(() => {
    // Restore the last project snapshot (image included) for convenience.
    try {
      const raw = localStorage.getItem('spice_gel_project_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw) as GelProject;
      if (parsed && parsed.version === 1 && parsed.imageDataUrl) {
        openProjectObject(parsed);
      }
    } catch { /* ignore a corrupt snapshot */ }
  });

  function persistSoon() {
    // Debounced snapshot; quota failures are non-fatal (manual Save remains).
    const save = () => {
      try { localStorage.setItem('spice_gel_project_v1', JSON.stringify(project)); } catch { /* quota */ }
    };
    if (typeof localStorage !== 'undefined') setTimeout(save, 400);
  }

  async function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = src;
    });
  }

  async function onPickImage(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = await loadImageElement(dataUrl);
      imageEl = img;
      project = {
        ...emptyProject(),
        imageName: file.name,
        imageDataUrl: dataUrl,
        imageWidth: img.naturalWidth,
        imageHeight: img.naturalHeight,
      };
      fit = null;
      renderProcessed();
      persistSoon();
    } catch (err) {
      pushToast('error', m.gelTitle(), err instanceof Error ? err.message : String(err));
    } finally {
      if (imageInput) imageInput.value = '';
    }
  }

  /** Rotate → crop → adjust pixels; refresh the gray plane used by detection. */
  function renderProcessed() {
    if (!imageEl) return;
    const img = imageEl;
    const rad = (project.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const rw = Math.max(1, Math.round(img.naturalWidth * cos + img.naturalHeight * sin));
    const rh = Math.max(1, Math.round(img.naturalWidth * sin + img.naturalHeight * cos));

    const rot = document.createElement('canvas');
    rot.width = rw; rot.height = rh;
    const rctx = rot.getContext('2d', { willReadFrequently: true })!;
    rctx.save();
    rctx.translate(rw / 2, rh / 2);
    rctx.rotate(rad);
    rctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    rctx.restore();

    const { left, top, right, bottom } = project.crop;
    const sx = Math.round(left * rw);
    const sy = Math.round(top * rh);
    const sw = Math.max(8, Math.round((1 - left - right) * rw));
    const sh = Math.max(8, Math.round((1 - top - bottom) * rh));

    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const octx = out.getContext('2d', { willReadFrequently: true })!;
    octx.drawImage(rot, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = octx.getImageData(0, 0, sw, sh);
    applyAdjustments(data.data);
    octx.putImageData(data, 0, 0);

    processedCanvas = out;
    processedGray = toGrayPlane(data);
    processedW = sw;
    processedH = sh;
    // The canvases live behind {#if hasImage}; defer one frame so they are
    // mounted before the first draw.
    requestAnimationFrame(() => drawDisplay());
  }

  function applyAdjustments(px: Uint8ClampedArray) {
    const { grayscale, invert, contrast, brightness, gamma } = project.adjust;
    const g = Math.max(0.2, gamma);
    for (let i = 0; i < px.length; i += 4) {
      let r = px[i], gg = px[i + 1], b = px[i + 2];
      if (grayscale) {
        const v = r * 0.299 + gg * 0.587 + b * 0.114;
        r = gg = b = v;
      }
      // Contrast around 0.5, brightness shift, gamma, invert — all in 0..255.
      const shift = (v: number) => {
        let x = v / 255;
        x = (x - 0.5) * contrast + 0.5 + brightness;
        x = Math.min(1, Math.max(0, x));
        x = x ** g;
        if (invert) x = 1 - x;
        return x * 255;
      };
      px[i] = shift(r);
      px[i + 1] = shift(gg);
      px[i + 2] = shift(b);
    }
  }

  /** Fit the processed image into the viewport and redraw the overlay. */
  function drawDisplay() {
    if (!displayCanvas || !overlayCanvas || !processedCanvas || !canvasWrap) return;
    const maxW = canvasWrap.clientWidth - 8;
    const maxH = Math.max(240, window.innerHeight - 260);
    const scale = Math.min(maxW / processedW, maxH / processedH, 1.6);
    const w = Math.max(1, Math.round(processedW * scale));
    const h = Math.max(1, Math.round(processedH * scale));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [displayCanvas, overlayCanvas]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      Object.assign(c.style, { width: `${w}px`, height: `${h}px` });
    }
    const ctx = displayCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(processedCanvas, 0, 0, w, h);
    drawOverlay();
  }

  function drawOverlay() {
    if (!overlayCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = overlayCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = overlayCanvas.width / dpr;
    const h = overlayCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    for (const lane of project.lanes) {
      const cx = lane.x * w;
      const lw = lane.width * w;
      const active = lane.id === selectedLaneId;
      ctx.strokeStyle = active ? 'rgba(255,159,28,0.95)' : 'rgba(76,214,255,0.55)';
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.setLineDash(lane.isMarker ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.setLineDash([]);
      // Lane band dots: click toggles the size label.
      for (const band of lane.bands) {
        const by = band.y * h;
        ctx.beginPath();
        ctx.arc(cx, by, band.showSize ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = band.showSize ? 'rgba(255,159,28,0.95)' : 'rgba(107,231,122,0.85)';
        ctx.fill();
      }
      ctx.fillStyle = active ? 'rgba(255,159,28,0.95)' : 'rgba(76,214,255,0.85)';
      ctx.font = '10px monospace';
      ctx.fillText(lane.isMarker ? `M${lane.name ? '·' + lane.name : ''}` : lane.name || '', cx + 4, 12);
    }
  }

  function onOverlayPointerDown(e: PointerEvent) {
    if (!overlayCanvas) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Band dot toggle first (they sit on lane lines).
    for (const lane of project.lanes) {
      const cx = lane.x * w;
      if (Math.abs(px - cx) > 8) continue;
      for (const band of lane.bands) {
        if (Math.abs(py - band.y * h) <= 6) {
          band.showSize = !band.showSize;
          persistSoon();
          drawOverlay();
          return;
        }
      }
    }
    // Otherwise: start dragging the nearest lane guide.
    let best: GelLane | null = null;
    let bestDist = 10;
    for (const lane of project.lanes) {
      const d = Math.abs(px - lane.x * w);
      if (d < bestDist) { bestDist = d; best = lane; }
    }
    if (best) {
      selectedLaneId = best.id;
      dragLane = { id: best.id, pointerId: e.pointerId };
      overlayCanvas.setPointerCapture(e.pointerId);
      drawOverlay();
    }
  }

  function onOverlayPointerMove(e: PointerEvent) {
    if (!dragLane || !overlayCanvas) return;
    const lane = laneOf(dragLane.id);
    if (!lane) return;
    const rect = overlayCanvas.getBoundingClientRect();
    lane.x = Math.min(0.99, Math.max(0.01, (e.clientX - rect.left) / rect.width));
    drawOverlay();
  }

  function onOverlayPointerUp() {
    if (dragLane) {
      dragLane = null;
      persistSoon();
    }
  }

  // ---------------- straighten ----------------

  function rotatedGrayAt(deg: number, maxSide = 280): { gray: Float32Array; w: number; h: number } | null {
    if (!imageEl) return null;
    const img = imageEl;
    const scale = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
    const rad = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const w = Math.max(8, Math.round((img.naturalWidth * cos + img.naturalHeight * sin) * scale));
    const h = Math.max(8, Math.round((img.naturalWidth * sin + img.naturalHeight * cos) * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -(img.naturalWidth * scale) / 2, -(img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
    const data = ctx.getImageData(0, 0, w, h);
    return { gray: toGrayPlane(data), w, h };
  }

  function autoStraighten() {
    if (!imageEl) return;
    busy = m.gelBusyStraighten();
    // The search runs synchronously; yield once so the label paints.
    requestAnimationFrame(() => {
      let bestAngle = 0;
      let bestScore = -Infinity;
      for (let a = -15; a <= 15.001; a += 0.5) {
        const rendered = rotatedGrayAt(a);
        if (!rendered) continue;
        const score = rotationScore(rendered.gray, rendered.w, rendered.h);
        if (score > bestScore) { bestScore = score; bestAngle = a; }
      }
      project.rotation = Math.round(bestAngle * 10) / 10;
      busy = '';
      renderProcessed();
      persistSoon();
    });
  }

  // ---------------- lanes & bands ----------------

  function addLane(x = 0.5) {
    const lane: GelLane = {
      id: newLaneId(),
      x, width: 0.045,
      name: String(project.lanes.length + 1),
      isMarker: false,
      bands: [],
    };
    project.lanes = [...project.lanes, lane];
    selectedLaneId = lane.id;
    drawOverlay();
    persistSoon();
  }

  function autoLanes() {
    if (!processedGray) return;
    const found = detectLanes(processedGray, processedW, processedH);
    if (!found.length) { pushToast('info', m.gelTitle(), m.gelLanesEmpty()); return; }
    project.lanes = found.map((d, i) => ({
      id: newLaneId(),
      x: d.x, width: d.width,
      name: String(i + 1),
      isMarker: false,
      bands: [],
    }));
    project.groups = [];
    selectedLaneId = null;
    fit = null;
    drawOverlay();
    persistSoon();
    pushToast('success', m.gelTitle(), m.gelLanesFound({ n: found.length }));
  }

  function removeLane(id: string) {
    project.lanes = project.lanes.filter((l) => l.id !== id);
    project.groups = project.groups.map((g) => ({ ...g, laneIds: g.laneIds.filter((x) => x !== id) })).filter((g) => g.laneIds.length > 0);
    if (selectedLaneId === id) selectedLaneId = null;
    drawOverlay();
    persistSoon();
  }

  function detectLaneBands(lane: GelLane): boolean {
    if (!processedGray) return false;
    const x0 = Math.round((lane.x - lane.width / 2) * processedW);
    const x1 = Math.round((lane.x + lane.width / 2) * processedW);
    const profile = rowProfile(processedGray, processedW, processedH, x0, x1);
    const peaks = findPeaks(profile, {
      prominenceStd: 0.5,
      minProminence: 0.006,
      minGap: Math.max(3, Math.round(processedH * 0.006)),
      smooth: 3,
    });
    lane.bands = peaks.slice(0, 24).map((p) => ({ y: p.frac, intensity: p.value, showSize: true }));
    return lane.bands.length > 0;
  }

  function detectBandsForLane(lane: GelLane) {
    const ok = detectLaneBands(lane);
    pushToast(ok ? 'success' : 'info', m.gelTitle(), ok ? m.gelBandsFound({ n: lane.bands.length }) : m.gelBandsNone());
    drawOverlay();
    persistSoon();
  }

  function fitMarkerLadder(lane: GelLane) {
    const sizes = [...project.ladderSizes].sort((a, b) => b - a);
    if (sizes.length < 2) { pushToast('error', m.gelTitle(), m.gelLadderInvalid()); return; }
    if (!detectLaneBands(lane)) { pushToast('error', m.gelTitle(), m.gelBandsNone()); return; }
    const bands = [...lane.bands].sort((a, b) => a.y - b.y);
    if (bands.length !== sizes.length) {
      pushToast('error', m.gelTitle(), m.gelLadderMismatch({ bands: bands.length, sizes: sizes.length }));
      drawOverlay();
      return;
    }
    bands.forEach((b, i) => { b.size = sizes[i]; });
    lane.bands = bands;
    const f = fitLadder(bands.map((b) => ({ y: b.y, size: b.size ?? 1 })));
    fit = f;
    if (!f) { pushToast('error', m.gelTitle(), m.gelLadderInvalid()); return; }
    pushToast('success', m.gelTitle(), m.gelLadderFit({ r2: f.r2.toFixed(3) }));
    drawOverlay();
    persistSoon();
  }

  function estimateSizes() {
    if (!fit) { pushToast('info', m.gelTitle(), m.gelNeedFit()); return; }
    const f = fit;
    for (const lane of project.lanes) {
      if (lane.isMarker) continue;
      if (!lane.bands.length) detectLaneBands(lane);
      for (const band of lane.bands) {
        const size = sizeFromY(f, band.y);
        band.size = size >= 100 ? Math.round(size / 10) * 10 : Math.round(size);
        band.showSize = true;
      }
    }
    drawOverlay();
    persistSoon();
    pushToast('success', m.gelTitle(), m.gelSizesDone());
  }

  // ---------------- groups ----------------

  function addGroup() {
    const ids = selectedForGroup.slice();
    if (!ids.length) { pushToast('info', m.gelTitle(), m.gelGroupPick()); return; }
    const name = groupName.trim() || m.gelGroupDefault();
    project.groups = [...project.groups, { id: `grp_${Date.now().toString(36)}`, name, laneIds: ids }];
    groupName = '';
    selectedForGroup = [];
    persistSoon();
    pushToast('success', m.gelTitle(), name);
  }

  function removeGroup(id: string) {
    project.groups = project.groups.filter((g) => g.id !== id);
    persistSoon();
  }

  // ---------------- export / project io ----------------

  function renderFigure(): HTMLCanvasElement | null {
    if (!processedCanvas) return null;
    const SCALE = 2;
    const gelW = processedCanvas.width * SCALE;
    const gelH = processedCanvas.height * SCALE;
    const margin = 24 * SCALE;
    const nameRow = 26 * SCALE;
    const groupRow = project.groups.length ? 24 * SCALE : 0;
    const unitRow = 20 * SCALE;
    const figW = gelW + margin * 2;
    const figH = unitRow + gelH + nameRow + groupRow + margin;

    const fig = document.createElement('canvas');
    fig.width = figW; fig.height = figH;
    const ctx = fig.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, figW, figH);

    // Unit tag (top-left) and gel.
    ctx.fillStyle = '#111111';
    ctx.font = `bold ${12 * SCALE}px monospace`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(project.unit, margin, unitRow - 5 * SCALE);
    const gelX = margin;
    const gelY = unitRow;
    ctx.drawImage(processedCanvas, 0, 0, processedCanvas.width, processedCanvas.height, gelX, gelY, gelW, gelH);

    // Band size labels over the gel.
    ctx.font = `${9 * SCALE}px monospace`;
    for (const lane of project.lanes) {
      const cx = gelX + lane.x * gelW;
      for (const band of lane.bands) {
        if (!band.showSize || band.size === undefined) continue;
        const by = gelY + band.y * gelH;
        const text = `${band.size}`;
        const tw = ctx.measureText(text).width;
        const tx = cx + 6 * SCALE;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(tx - 1, by - 10 * SCALE, tw + 2, 11 * SCALE);
        ctx.fillStyle = '#111111';
        ctx.fillText(text, tx, by);
      }
    }

    // Lane names under the gel.
    ctx.font = `${11 * SCALE}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#111111';
    const namesY = gelY + gelH + 16 * SCALE;
    for (const lane of project.lanes) {
      if (!lane.name) continue;
      ctx.fillText(lane.name, gelX + lane.x * gelW, namesY);
    }

    // Group brackets below the names.
    if (project.groups.length) {
      const gY = namesY + 6 * SCALE;
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = SCALE;
      ctx.font = `${10 * SCALE}px monospace`;
      project.groups.forEach((group, gi) => {
        const xs = group.laneIds
          .map((id) => project.lanes.find((l) => l.id === id))
          .filter((l): l is GelLane => !!l)
          .map((l) => gelX + l.x * gelW);
        if (!xs.length) return;
        const x0 = Math.min(...xs) - 6 * SCALE;
        const x1 = Math.max(...xs) + 6 * SCALE;
        const y = gY + gi * 18 * SCALE;
        ctx.beginPath();
        ctx.moveTo(x0, y + 4 * SCALE);
        ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.lineTo(x1, y + 4 * SCALE);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(group.name, (x0 + x1) / 2, y + 14 * SCALE);
      });
    }
    ctx.textAlign = 'left';
    return fig;
  }

  async function exportPng() {
    const fig = renderFigure();
    if (!fig) { pushToast('error', m.gelTitle(), m.gelNoImage()); return; }
    const blob: Blob | null = await new Promise((resolve) => fig.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) { pushToast('error', m.gelTitle(), m.gelNoImage()); return; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base = (project.imageName || 'gel').replace(/\.[^.]+$/, '');
    try {
      const res = await backend.saveExport(`${base}_figure.png`, bytes);
      if (res.data?.saved) pushToast('success', m.gelTitle(), m.gelExported());
    } catch (err) {
      pushToast('error', m.gelTitle(), err instanceof Error ? err.message : String(err));
    }
  }

  function saveProject() {
    const base = (project.imageName || 'gel').replace(/\.[^.]+$/, '');
    backend.saveExport(`${base}.gel.json`, JSON.stringify(project)).then((res) => {
      if (res.data?.saved) pushToast('success', m.gelTitle(), m.gelProjectSaved());
    }).catch((err) => pushToast('error', m.gelTitle(), err instanceof Error ? err.message : String(err)));
  }

  async function openProjectObject(parsed: GelProject) {
    project = parsed;
    fit = null;
    imageEl = await loadImageElement(parsed.imageDataUrl);
    renderProcessed();
  }

  async function onPickProject(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GelProject;
      if (!parsed || parsed.version !== 1 || !parsed.imageDataUrl) throw new Error(m.gelProjectInvalid());
      await openProjectObject(parsed);
      pushToast('success', m.gelTitle(), m.gelProjectOpened());
    } catch (err) {
      pushToast('error', m.gelTitle(), err instanceof Error ? err.message : String(err));
    } finally {
      if (projectInput) projectInput.value = '';
    }
  }

  function resetAll() {
    project = emptyProject();
    imageEl = null;
    processedCanvas = null;
    processedGray = null;
    fit = null;
    selectedLaneId = null;
    try { localStorage.removeItem('spice_gel_project_v1'); } catch { /* ignore */ }
    if (displayCanvas) displayCanvas.getContext('2d')?.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    drawOverlay();
  }

  // Redraw when the window resizes (fit-to-width depends on it).
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  function onWindowResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (processedCanvas) drawDisplay(); }, 150);
  }
  onMount(() => {
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  });

  const ladderText = $derived(project.ladderSizes.join(', '));
  function onLadderInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const sizes = raw.split(/[,\s]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    project.ladderSizes = sizes;
    persistSoon();
  }
</script>

<div class="gel-page">
  <input bind:this={imageInput} type="file" accept="image/png,image/jpeg,image/bmp,image/webp,image/gif" style="display:none" onchange={onPickImage} />
  <input bind:this={projectInput} type="file" accept=".json,application/json" style="display:none" onchange={onPickProject} />

  <div class="gel-toolbar">
    <button class="pix-btn" onclick={() => imageInput?.click()}><Upload size={12} /> {m.gelImport()}</button>
    <button class="pix-btn" disabled={!hasImage || !!busy} onclick={autoStraighten}><Wand2 size={12} /> {busy || m.gelAutoStraighten()}</button>
    <button class="pix-btn" disabled={!hasImage} onclick={autoLanes}><Crosshair size={12} /> {m.gelAutoLanes()}</button>
    <button class="pix-btn" disabled={!hasImage} onclick={() => addLane()}><Plus size={12} /> {m.gelAddLane()}</button>
    <span class="spacer"></span>
    <button class="pix-btn" disabled={!hasImage} onclick={saveProject}><Save size={12} /> {m.gelSaveProject()}</button>
    <button class="pix-btn" onclick={() => projectInput?.click()}><FolderOpen size={12} /> {m.gelOpenProject()}</button>
    <button class="pix-btn ok" disabled={!hasImage} onclick={exportPng}><Download size={12} /> {m.gelExport()}</button>
    <button class="pix-btn" disabled={!hasImage} onclick={resetAll}><Eraser size={12} /> {m.gelReset()}</button>
  </div>

  <div class="gel-body">
    <aside class="gel-side">
      <section class="side-section">
        <h3>{m.gelImageSection()}</h3>
        {#if !hasImage}
          <div class="empty-hint">{m.gelNoImage()}</div>
        {:else}
          <label class="row">{m.gelRotate()} <output>{project.rotation.toFixed(1)}°</output>
            <input type="range" min="-15" max="15" step="0.1" bind:value={project.rotation}
              oninput={() => { renderProcessed(); persistSoon(); }} />
          </label>
          <label class="check"><input type="checkbox" bind:checked={project.adjust.grayscale} onchange={() => { renderProcessed(); persistSoon(); }} /> {m.gelGrayscale()}</label>
          <label class="check"><input type="checkbox" bind:checked={project.adjust.invert} onchange={() => { renderProcessed(); persistSoon(); }} /> {m.gelInvert()}</label>
          <label class="row">{m.gelContrast()} <output>{project.adjust.contrast.toFixed(2)}</output>
            <input type="range" min="0.2" max="3" step="0.05" bind:value={project.adjust.contrast} oninput={() => { renderProcessed(); persistSoon(); }} />
          </label>
          <label class="row">{m.gelBrightness()} <output>{project.adjust.brightness.toFixed(2)}</output>
            <input type="range" min="-0.5" max="0.5" step="0.01" bind:value={project.adjust.brightness} oninput={() => { renderProcessed(); persistSoon(); }} />
          </label>
          <label class="row">{m.gelGamma()} <output>{project.adjust.gamma.toFixed(2)}</output>
            <input type="range" min="0.3" max="2.5" step="0.05" bind:value={project.adjust.gamma} oninput={() => { renderProcessed(); persistSoon(); }} />
          </label>
          <div class="crop-grid">
            <label>{m.gelCropLeft()}<input type="range" min="0" max="0.45" step="0.005" bind:value={project.crop.left} oninput={() => { renderProcessed(); persistSoon(); }} /></label>
            <label>{m.gelCropTop()}<input type="range" min="0" max="0.45" step="0.005" bind:value={project.crop.top} oninput={() => { renderProcessed(); persistSoon(); }} /></label>
            <label>{m.gelCropRight()}<input type="range" min="0" max="0.45" step="0.005" bind:value={project.crop.right} oninput={() => { renderProcessed(); persistSoon(); }} /></label>
            <label>{m.gelCropBottom()}<input type="range" min="0" max="0.45" step="0.005" bind:value={project.crop.bottom} oninput={() => { renderProcessed(); persistSoon(); }} /></label>
          </div>
        {/if}
      </section>

      <section class="side-section">
        <h3>{m.gelLanes()}</h3>
        <label class="row">{m.gelUnit()}:
          <select
            class="pix-select"
            value={project.unit}
            onchange={(e) => { project.unit = (e.currentTarget as HTMLSelectElement).value as 'bp' | 'kDa'; persistSoon(); }}
          >
            <option value="bp">{m.gelUnitBp()}</option>
            <option value="kDa">{m.gelUnitKda()}</option>
          </select>
        </label>
        <label class="row">{m.gelLadderSizes()}
          <input class="pix-input" type="text" value={ladderText} onchange={onLadderInput} placeholder="5000, 3000, 2000, 1000" />
        </label>
        <div class="lane-list">
          {#each project.lanes as lane (lane.id)}
            <div class="lane-row" class:active={lane.id === selectedLaneId}>
              <button class="pix-btn-reset lane-pick" onclick={() => { selectedLaneId = lane.id; drawOverlay(); }}>{lane.name || '—'}</button>
              <input class="pix-input lane-name" type="text" placeholder={m.gelLaneName()} bind:value={lane.name} oninput={() => { drawOverlay(); persistSoon(); }} />
              <label class="check small"><input type="checkbox" bind:checked={lane.isMarker} onchange={() => { persistSoon(); drawOverlay(); }} /> {m.gelLaneMarker()}</label>
              <button class="pix-btn" onclick={() => detectBandsForLane(lane)} title={m.gelDetectBands()}>{m.gelDetectBands()}</button>
              {#if lane.isMarker}
                <button class="pix-btn ok" onclick={() => fitMarkerLadder(lane)} title={m.gelFitLadder()}>{m.gelFitLadder()}</button>
              {/if}
              <button class="pix-btn-reset danger" onclick={() => removeLane(lane.id)} title={m.gelRemoveLane()}><Trash2 size={12} /></button>
            </div>
          {:else}
            <div class="empty-hint">{m.gelNoLanes()}</div>
          {/each}
        </div>
        <button class="pix-btn" disabled={!fit} onclick={estimateSizes}>{m.gelEstimateSizes()}</button>
        {#if fit}
          <div class="fit-line">{m.gelFitSummary({ r2: fit.r2.toFixed(3), n: fit.n })}</div>
        {/if}
      </section>

      <section class="side-section">
        <h3>{m.gelGroups()}</h3>
        <div class="group-pool">
          {#each project.lanes as lane (lane.id)}
            <label class="check small">
              <input type="checkbox" bind:group={selectedForGroup} value={lane.id} /> {lane.name || '—'}
            </label>
          {/each}
        </div>
        <div class="group-add">
          <input class="pix-input" type="text" bind:value={groupName} placeholder={m.gelGroupName()} />
          <button class="pix-btn" onclick={addGroup}><Plus size={12} /> {m.gelAddGroup()}</button>
        </div>
        {#each project.groups as group (group.id)}
          <div class="group-row">
            <span>{group.name}</span>
            <span class="pix-dim">{group.laneIds.length}</span>
            <button class="pix-btn-reset danger" onclick={() => removeGroup(group.id)}><Trash2 size={12} /></button>
          </div>
        {/each}
      </section>
    </aside>

    <div class="gel-stage" bind:this={canvasWrap}>
      {#if hasImage}
        <div class="canvas-stack">
          <canvas bind:this={displayCanvas} class="display-canvas"></canvas>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <canvas
            bind:this={overlayCanvas}
            class="overlay-canvas"
            aria-label={m.gelOverlayLabel()}
            onpointerdown={onOverlayPointerDown}
            onpointermove={onOverlayPointerMove}
            onpointerup={onOverlayPointerUp}
            onpointercancel={onOverlayPointerUp}
          ></canvas>
        </div>
        <p class="stage-hint">{m.gelOverlayHint()}</p>
      {:else}
        <div class="stage-empty">{m.gelNoImage()}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .gel-page { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 12px; min-height: 0; overflow: hidden; font-family: var(--pix-font); font-size: 10px; }
  .gel-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 8px; border: 1px solid var(--pix-border); background: var(--pix-bg-2); }
  .gel-toolbar .pix-btn { padding: 4px 10px; font-size: 9.5px; display: inline-flex; align-items: center; gap: 4px; }
  .spacer { flex: 1; }
  .gel-body { flex: 1; display: flex; gap: 8px; min-height: 0; }
  .gel-side { width: 300px; min-width: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .side-section { border: 1px solid var(--pix-border); background: var(--pix-bg-2); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .side-section h3 { margin: 0 0 2px 0; font-size: 10px; color: var(--pix-accent-2); letter-spacing: 0.5px; }
  .row { display: flex; flex-direction: column; gap: 3px; color: var(--pix-fg-dim); font-size: 9.5px; }
  .row output { color: var(--pix-fg); font-weight: bold; }
  .row input[type="range"] { width: 100%; }
  .check { display: flex; align-items: center; gap: 5px; color: var(--pix-fg); cursor: pointer; }
  .check.small { font-size: 9px; }
  .crop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
  .crop-grid label { display: flex; flex-direction: column; font-size: 9px; color: var(--pix-fg-dim); gap: 2px; }
  .lane-list { display: flex; flex-direction: column; gap: 3px; max-height: 240px; overflow-y: auto; }
  .lane-row { display: flex; align-items: center; gap: 4px; padding: 2px 3px; border: 1px solid transparent; }
  .lane-row.active { border-color: var(--pix-accent-2); background: rgba(255,159,28,0.06); }
  .lane-pick { min-width: 24px; font-size: 9px; color: var(--pix-cyan); cursor: pointer; text-align: left; }
  .lane-name { flex: 1; min-width: 0; padding: 1px 3px; font-size: 9px; height: 18px; }
  .lane-row .pix-btn { padding: 1px 5px; font-size: 8.5px; white-space: nowrap; }
  .danger { color: var(--pix-red); cursor: pointer; }
  .fit-line { font-size: 9px; color: var(--pix-green); }
  .group-pool { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .group-add { display: flex; gap: 4px; }
  .group-add .pix-input { flex: 1; min-width: 0; padding: 2px 4px; font-size: 9px; height: 20px; }
  .group-add .pix-btn { padding: 2px 8px; font-size: 9px; white-space: nowrap; }
  .group-row { display: flex; align-items: center; gap: 6px; border-top: 1px dashed var(--pix-border); padding-top: 3px; }
  .group-row span:first-child { flex: 1; }
  .empty-hint { color: var(--pix-fg-dim); font-size: 9.5px; padding: 6px 0; }
  .gel-stage { flex: 1; min-width: 0; overflow: auto; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 6px; border: 1px solid var(--pix-border); background: #04060a; padding: 8px; }
  .canvas-stack { position: relative; display: inline-block; }
  .display-canvas { display: block; image-rendering: auto; }
  .overlay-canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
  .stage-hint { margin: 0; font-size: 9px; color: var(--pix-fg-dim); }
  .stage-empty { color: var(--pix-fg-dim); font-size: 11px; padding: 40px 0; }
</style>
