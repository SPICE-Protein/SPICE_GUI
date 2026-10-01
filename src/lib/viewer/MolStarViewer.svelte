<script lang="ts">
  // @ts-nocheck
  // High-performance Headless Mol* (MolStar) Viewer integration for Svelte 5.
  // Completely avoids heavy React DOM dependencies (preventing 'render is not a function' errors)
  // by utilizing Mol*'s headless PluginContext. Updates background, camera, lighting, and
  // post-processing shader filters (SSAO, outline, shadows, bloom) natively and stably via
  // Mol*'s official Command Pipeline (PluginCommands.Canvas3D.SetSettings).
  import { onMount, onDestroy } from 'svelte';
  import { pdbFromCoords } from '$lib/backend/preprocess';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';
  import { Settings2, Camera, RotateCcw, X } from 'lucide-svelte';

  let {
    coordsData = null, // { seq, coords: number[] } — CA trace
    pdbText = null, // full PDB text (overrides coordsData)
    rep = $bindable('auto'), // trace | spacefill | cartoon | ballstick | auto
    highlightRange = null as { start: number; end: number } | null,
    onResidueHover = null as ((idx: number | null) => void) | null,
    pockets = [] as any[],
    selectedPocketId = null as number | null,
    advancedFeatures = null as any | null,
  } = $props<{
    coordsData: { seq: string; coords: number[] } | null;
    pdbText: string | null;
    rep?: string;
    highlightRange?: { start: number; end: number } | null;
    onResidueHover?: ((idx: number | null) => void) | null;
    pockets?: any[];
    selectedPocketId?: number | null;
    advancedFeatures?: any | null;
  }>();

  let container: HTMLDivElement;
  let plugin: any = null;
  let structure: any = null;
  let ready = $state(false);
  let busy = $state(false);
  let error: string | null = $state(null);
  let repSel = $state(rep);
  let viewOpen = $state(false);
  let shotBusy = $state(false);

  // Mol* view settings (Svelte state)
  let bg = $state<'dark' | 'white' | 'transparent'>('dark');
  let camMode = $state<'perspective' | 'orthographic'>('perspective');
  let axes = $state(false);
  let exposure = $state(1.0);
  let lightI = $state(1.0);
  let outline = $state(false);
  let shadow = $state(false);
  let bloom = $state(false);
  let ao = $state(false);
  let sizeFactor = $state(1.0);

  // Image export settings
  let exportWatermark = $state(true);
  let exportTransparent = $state(false);
  let exportMultiplier = $state(2); // 1, 2, 4

  let ro: ResizeObserver | null = null;

  // keep repSel in sync with the `rep` prop
  $effect(() => {
    repSel = rep;
  });

  function isFull() {
    return !!pdbText;
  }
  function effectiveRep() {
    const def = isFull() ? 'cartoon' : 'trace';
    return repSel === 'auto' ? def : repSel;
  }

  async function init() {
    try {
      const { PluginContext } = await import('molstar/lib/mol-plugin/context.js');
      const { DefaultPluginSpec } = await import('molstar/lib/mol-plugin/spec.js');
      
      // Load standard styles for layout
      await import('molstar/build/viewer/molstar.css');
      await import('molstar/build/viewer/theme/light.css');

      plugin = new PluginContext(DefaultPluginSpec());
      await plugin.init();
      plugin.mountAsync(container);
      await plugin.canvas3dInitialized;
      
      await applyCanvasSettings();
      
      ro = new ResizeObserver(() => plugin?.handleResize());
      ro.observe(container);

      // Listen to Mol* hover interactivity using standard event subscription
      const { StructureElement } = await import('molstar/lib/mol-model/structure.js');
      plugin.behaviors.interaction.hover.subscribe((e: any) => {
        if (!e.current || !e.current.loci) {
          if (onResidueHover) onResidueHover(null);
          return;
        }
        const loci = e.current.loci;
        if (StructureElement.Loci.is(loci)) {
          const location = StructureElement.Loci.getFirstLocation(loci);
          if (location && onResidueHover) {
            const authSeqId = StructureElement.Location.auth_seq_id(location);
            if (authSeqId > 0) {
              onResidueHover(authSeqId - 1);
            }
          }
        } else {
          if (onResidueHover) onResidueHover(null);
        }
      });

      ready = true;
    } catch (e: any) {
      error = String(e?.message ?? e);
    }
  }

  function bgColor() {
    return bg === 'white' ? 0xffffff : 0x0b0e14;
  }

  // Authoritative Canvas3D update using the official Mol* Command Pipeline
  async function applyCanvasSettings() {
    if (!plugin?.canvas3d) return;
    try {
      const { PluginCommands } = await import('molstar/lib/mol-plugin/commands.js');
      const currentSettings = plugin.canvas3d.props;
      
      const newSettings = {
        ...currentSettings,
        transparentBackground: bg === 'transparent',
        camera: {
          ...currentSettings.camera,
          mode: camMode,
          helper: {
            ...currentSettings.camera?.helper,
            axes: axes ? 'on' : 'off'
          }
        },
        renderer: {
          ...currentSettings.renderer,
          backgroundColor: bgColor(),
          exposure,
          light: [{ inclination: 60, azimuth: 30, color: 0xffffff, intensity: lightI }]
        },
        postprocessing: {
          ...currentSettings.postprocessing,
          occlusion: ao 
            ? { name: 'on', params: currentSettings.postprocessing?.occlusion?.params || {} } 
            : { name: 'off', params: {} },
          shadow: shadow 
            ? { name: 'on', params: currentSettings.postprocessing?.shadow?.params || {} } 
            : { name: 'off', params: {} },
          outline: outline 
            ? { name: 'on', params: currentSettings.postprocessing?.outline?.params || {} } 
            : { name: 'off', params: {} },
          bloom: bloom 
            ? { name: 'on', params: currentSettings.postprocessing?.bloom?.params || { strength: 0.5 } } 
            : { name: 'off', params: {} },
        }
      };

      await PluginCommands.Canvas3D.SetSettings(plugin, { settings: newSettings });
    } catch (e) {
      console.warn('applyCanvasSettings failed:', e);
    }
  }

  $effect(() => {
    // Unconditionally register state dependencies for reactive updates
    void bg;
    void camMode;
    void axes;
    void exposure;
    void lightI;
    void outline;
    void shadow;
    void bloom;
    void ao;
    
    if (ready) void applyCanvasSettings();
  });

  async function loadStructure() {
    if (!plugin || !ready) return;
    const text = pdbText ?? (coordsData ? pdbFromCoords(coordsData.seq, coordsData.coords) : null);
    if (!text) return;
    
    busy = true;
    error = null;
    try {
      await plugin.clear();
      structure = null;
      
      const format = text.includes('_entry.id') || text.includes('loop_') || text.startsWith('data_') ? 'mmcif' : 'pdb';
      const data = await plugin.builders.data.rawData({ data: text });
      if (!data) throw new Error("Mol* rawData returned null");
      
      const traj = await plugin.builders.structure.parseTrajectory(data, format);
      if (!traj) throw new Error("Mol* parseTrajectory returned null");
      
      const model = await plugin.builders.structure.createModel(traj);
      if (!model) throw new Error("Mol* createModel returned null");
      
      const struct = await plugin.builders.structure.createStructure(model);
      if (!struct) throw new Error("Mol* createStructure returned null");
      
      structure = struct;
      await applyRepresentation();
      plugin.managers.camera.reset();
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      busy = false;
    }
  }

  async function applyRepresentation() {
    if (!plugin || !structure) return;
    const kind = effectiveRep();
    const color = isFull() ? 'chain-id' : 'rainbow';
    const R = plugin.builders.structure.representation;

    try {
      if (kind === 'trace') {
        await R.addRepresentation(structure, { type: 'polymer-trace', color, typeParams: { lineSizeAttenuation: false } });
        await R.addRepresentation(structure, { type: 'spacefill', color, sizeParams: { sizeFactor: 0.5 * sizeFactor } });
      } else if (kind === 'spacefill' || kind === 'ballstick') {
        await R.addRepresentation(structure, { type: kind, color, sizeParams: { sizeFactor } });
      } else {
        await R.addRepresentation(structure, { type: kind, color });
      }
    } catch (e) {
      console.warn("Representation apply failed:", e);
    }
  }

  async function resetCamera() {
    if (plugin?.managers?.camera) plugin.managers.camera.reset();
  }

  // Reload structure on coordinate or representation updates
  $effect(() => {
    void currentLocale.value;
    void sizeFactor;
    if (ready) void loadStructure();
  });

  // Highlight selection binding
  $effect(() => {
    if (ready && highlightRange) {
      void applyHighlight();
    } else if (ready && !highlightRange && plugin) {
      plugin.managers.interactivity.lociSelects?.clearSelection?.();
      plugin.managers.interactivity.lociHighlights?.clearHighlight?.();
    }
  });

  async function applyHighlight() {
    if (!plugin || !ready || !structure || !highlightRange) return;

    try {
      const { MolScriptBuilder: MS } = await import('molstar/lib/mol-script/language/builder.js');
      const { Script } = await import('molstar/lib/mol-script/script.js');
      const { StructureSelection } = await import('molstar/lib/mol-model/structure.js');

      plugin.managers.interactivity.lociSelects?.clearSelection?.();

      const { start, end } = highlightRange;
      if (start < 0 || end < 0) return;

      const expression = MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.between([
          MS.struct.atomProperty.macromolecular.auth_seq_id(),
          start,
          end
        ])
      });

      const script = Script.fromExpression(expression);
      const currentStructure = plugin.managers.structure.hierarchy.current.structures[0]?.cell?.obj?.data;
      if (currentStructure) {
        const selection = StructureSelection.fromScript(script, currentStructure);
        const loci = StructureSelection.toLociWithStructure(selection);
        if (loci && loci.structure) {
          plugin.managers.interactivity.lociHighlights?.highlight?.({ loci });
          plugin.managers.interactivity.lociSelects?.select?.({ loci });
        }
      }
    } catch (e) {
      console.warn("Mol* selection highlighting failed:", e);
    }
  }

  // ---------- paper screenshot ----------
  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image load failed'));
      img.src = src;
    });
  }
  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function exportPaperPng() {
    if (!plugin || shotBusy) return;
    shotBusy = true;
    const originalParams = plugin.helpers.viewportScreenshot?.behaviors.values.value;
    try {
      plugin.canvas3d?.setProps({
        transparentBackground: exportTransparent,
        renderer: { backgroundColor: exportTransparent ? 0x000000 : 0xffffff }
      });
      await new Promise((r) => setTimeout(r, 120));

      const rect = container.getBoundingClientRect();
      const targetWidth = Math.round(rect.width * exportMultiplier);
      const targetHeight = Math.round(rect.height * exportMultiplier);

      if (plugin.helpers.viewportScreenshot && originalParams) {
        plugin.helpers.viewportScreenshot.behaviors.values.next({
          ...originalParams,
          transparent: exportTransparent,
          resolution: {
            name: 'custom',
            params: { width: targetWidth, height: targetHeight }
          }
        });
      }

      const dataUri = await plugin.helpers.viewportScreenshot.getImageDataUri();
      const img = await loadImage(dataUri);
      
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d')!;
      
      if (exportTransparent) {
        ctx.clearRect(0, 0, cv.width, cv.height);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.drawImage(img, 0, 0);

      if (exportWatermark) {
        const pad = Math.round(cv.width * 0.03);
        const logoH = Math.round(cv.height * 0.055);
        const text = 'Folded by SPICE';
        ctx.font = `bold ${Math.round(logoH * 0.52)}px 'Helvetica Neue', Arial, sans-serif`;
        const tw = ctx.measureText(text).width;
        const totalW = logoH + 10 + tw;
        const x0 = cv.width - pad - totalW;
        const y0 = cv.height - pad - logoH;
        
        ctx.fillStyle = exportTransparent ? 'rgba(18, 22, 36, 0.75)' : 'rgba(255,255,255,0.85)';
        ctx.fillRect(x0 - 6, y0 - 5, totalW + 12, logoH + 10);
        
        const logo = await loadImage('/spice-logo.png').catch(() => null);
        if (logo) ctx.drawImage(logo, x0, y0, logoH, logoH);
        
        ctx.fillStyle = exportTransparent ? '#ffffff' : '#111111';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x0 + (logo ? logoH + 10 : 0), y0 + logoH / 2);
      }

      const png = cv.toDataURL('image/png');
      const r = await backend.saveExport('spice_fold.png', base64ToBytes(png.split(',')[1]));
      pushToast('success', m.exportSaved(), r.data?.path ?? undefined);
    } catch (e: any) {
      pushToast('error', m.exportPng(), String(e?.message ?? e));
    } finally {
      if (plugin && originalParams) {
        plugin.helpers.viewportScreenshot.behaviors.values.next(originalParams);
      }
      shotBusy = false;
      await applyCanvasSettings();
    }
  }

  onMount(() => {
    void init();
    return () => {
      ro?.disconnect();
      try {
        plugin?.dispose();
      } catch {
        /* ignore */
      }
      plugin = null;
    };
  });
</script>

<div class="msv-wrap" data-lang={currentLocale.value}>
  <div class="msv-toolbar">
    <div class="msv-title">{m.viewerTitle()}</div>
    <label class="msv-label">
      <span class="pix-dim">{m.viewerRep()}</span>
      <select bind:value={repSel} class="pix-select">
        <option value="auto">{m.viewerAuto()}</option>
        <option value="trace">{m.viewerTrace()}</option>
        <option value="spacefill">{m.viewerSpacefill()}</option>
        <option value="cartoon">{m.viewerCartoon()}</option>
        <option value="ballstick">{m.viewerBallstick()}</option>
      </select>
    </label>
    <button class="pix-btn-reset" onclick={() => (viewOpen = !viewOpen)}>
      <Settings2 size={14} /> {m.viewSettings()}
    </button>
    <button class="pix-btn-reset" onclick={resetCamera}>
      <RotateCcw size={14} /> {m.viewerReset()}
    </button>
    <button class="pix-btn-reset" disabled={shotBusy} onclick={exportPaperPng}>
      <Camera size={14} /> {m.exportPng()}
    </button>
    {#if busy}
      <span class="pix-led busy" style="margin-left:8px"></span>
    {/if}
  </div>
  <div class="msv-container" bind:this={container}></div>

  {#if viewOpen}
    <div class="msv-settings pix-panel">
      <div class="msv-settings-head">
        <span class="pix-title">{m.viewSettings()}</span>
        <button class="pix-btn-reset" onclick={() => (viewOpen = false)}><X size={12} /></button>
      </div>
      <div class="msv-settings-body">
        <div class="row">
          <span class="pix-dim">{m.bgLabel()}</span>
          <select class="pix-select" bind:value={bg}>
            <option value="dark">{m.bgDark()}</option>
            <option value="white">{m.bgWhite()}</option>
            <option value="transparent">{m.bgTransparent()}</option>
          </select>
        </div>
        <div class="row">
          <span class="pix-dim">{m.camMode()}</span>
          <select class="pix-select" bind:value={camMode}>
            <option value="perspective">{m.perspective()}</option>
            <option value="orthographic">{m.orthographic()}</option>
          </select>
        </div>
        <div class="row">
          <span class="pix-dim">{m.axesLabel()}</span>
          <select class="pix-select" bind:value={axes}>
            <option value={false}>{m.offLabel()}</option>
            <option value={true}>{m.onLabel()}</option>
          </select>
        </div>
        <div class="row">
          <span class="pix-dim">{m.exposureLabel()}</span>
          <input class="pix-input" type="range" min="0.3" max="2.5" step="0.1" bind:value={exposure} />
          <span class="pix-num">{exposure.toFixed(1)}</span>
        </div>
        <div class="row">
          <span class="pix-dim">{m.lightLabel()}</span>
          <input class="pix-input" type="range" min="0.2" max="3" step="0.1" bind:value={lightI} />
          <span class="pix-num">{lightI.toFixed(1)}</span>
        </div>
        <div class="row">
          <span class="pix-dim">{m.sizeFactorLabel()}</span>
          <input class="pix-input" type="range" min="0.2" max="2" step="0.1" bind:value={sizeFactor} />
          <span class="pix-num">{sizeFactor.toFixed(1)}</span>
        </div>
        <div class="toggles">
          <label class="tgl"><input type="checkbox" bind:checked={outline} /> {m.outlineLabel()}</label>
          <label class="tgl"><input type="checkbox" bind:checked={shadow} /> {m.shadowLabel()}</label>
          <label class="tgl"><input type="checkbox" bind:checked={bloom} /> {m.bloomLabel()}</label>
          <label class="tgl"><input type="checkbox" bind:checked={ao} /> {m.aoLabel()}</label>
        </div>
        <div class="pix-bold" style="font-size: 11px; color: var(--pix-accent-2); text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; border-top: 1px solid var(--pix-border); padding-top: 6px;">{m.exportPng()}</div>
        <div class="toggles">
          <label class="tgl"><input type="checkbox" bind:checked={exportWatermark} /> {m.exportWatermarkLabel()}</label>
          <label class="tgl"><input type="checkbox" bind:checked={exportTransparent} /> {m.exportTransparentLabel()}</label>
        </div>
        <div class="row">
          <span class="pix-dim">{m.exportMultiplierLabel()}</span>
          <select class="pix-select" bind:value={exportMultiplier}>
            <option value={1}>{m.exportMultiplierVal({ v: 1 })}</option>
            <option value={2}>{m.exportMultiplierVal({ v: 2 })}</option>
            <option value={4}>{m.exportMultiplierVal({ v: 4 })}</option>
          </select>
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="msv-error pix-num bad">{error}</div>
  {/if}
  {#if !ready}
    <div class="msv-loading pix-dim">{m.viewerLoading()}</div>
  {/if}
</div>

<style>
  .msv-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pix-bg);
    border-radius: 4px;
    overflow: hidden;
  }
  .msv-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
    font-size: 11px;
    z-index: 4;
  }
  .msv-title {
    font-weight: bold;
    color: var(--pix-accent-2);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .msv-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .msv-container {
    flex: 1 1 auto;
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
    z-index: 1;
  }
  .msv-settings {
    position: absolute;
    top: 36px;
    right: 10px;
    width: 260px;
    background: var(--pix-panel);
    border: 2px solid var(--pix-border-hi);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.75);
    z-index: 10;
    display: flex;
    flex-direction: column;
  }
  .msv-settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .msv-settings-body {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 380px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
  }
  .toggles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
    font-size: 10.5px;
    margin-top: 4px;
    border-top: 1px solid var(--pix-border);
    padding-top: 4px;
  }
  .tgl {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    color: var(--pix-fg-dim);
  }
  .tgl:hover {
    color: var(--pix-fg);
  }
  .msv-error {
    position: absolute;
    top: 36px;
    left: 10px;
    right: 10px;
    padding: 6px 10px;
    background: rgba(255, 93, 93, 0.15);
    border: 1.5px solid var(--pix-red);
    font-size: 11px;
    z-index: 9;
  }
  .msv-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--pix-fg-dim);
    z-index: 2;
  }
  :global(.msp-plugin) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
