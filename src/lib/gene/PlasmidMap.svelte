<script lang="ts"> 

  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { Camera, Scissors, MousePointer, Hand, ZoomIn, ZoomOut, RotateCcw, RotateCw } from 'lucide-svelte';
  import { rotateBpsToPosition } from '$lib/genome';

  // Import modular Canvas components
  import CircularMapCanvas from './CircularMapCanvas.svelte';
  import LinearMapCanvas from './LinearMapCanvas.svelte';

  // Svelte 5 props
  let {
    plasmidName = '',
    dnaSeq = $bindable(''),
    geneFeatures = [],
    restrictionSites = [],
    primers = [],
    selectionNotes = [],
    activeFeatureId = $bindable(null),
    selectionStart = $bindable(1),
    selectionEnd = $bindable(1),
    linear = false,
    featuresZIndex = 50,
    onFocusFeatures = () => {}
  } = $props<{
    plasmidName: string;
    dnaSeq: string;
    geneFeatures: any[];
    restrictionSites: any[];
    primers: any[];
    selectionNotes?: any[];
    activeFeatureId: number | null;
    selectionStart: number;
    selectionEnd: number;
    linear: boolean;
    featuresZIndex?: number;
    onFocusFeatures?: () => void;
  }>();

  // Dialog state for cutting/linearizing plasmid
  let activeSite = $state<{ name: string; pos: number } | null>(null);
  let shotBusy = $state(false);

  // View tools state
  type Tool = 'select' | 'pan' | 'rotate';
  let activeTool = $state<Tool>('select');
  let expandedFeatureId = $state<number | null>(null);

  // Method bindings for canvas export triggers
  let circularExport = $state<(() => Promise<void>) | null>(null);
  let linearExport = $state<(() => Promise<void>) | null>(null);

  // Refs to canvas view methods (zoom / reset)
  let circularMapRef = $state<{ zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null>(null);
  let linearMapRef = $state<{ zoomIn: () => void; zoomOut: () => void; resetView: () => void } | null>(null);

  // Draggable floating panel action (Svelte 5 action)
  function drag(node: HTMLElement, headerSelector: string) {
    let active = false;
    let initialX = 0;
    let initialY = 0;
    let xOffset = 0;
    let yOffset = 0;

    const header = node.querySelector(headerSelector) as HTMLElement;
    if (!header) return;

    header.style.cursor = 'move';
    header.addEventListener('pointerdown', dragStart);

    function dragStart(e: PointerEvent) {
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) {
        return;
      }
      active = true;
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      header.setPointerCapture(e.pointerId);
      header.addEventListener('pointermove', handlePointerMove);
      header.addEventListener('pointerup', dragEnd);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!active) return;
      e.preventDefault();
      xOffset = e.clientX - initialX;
      yOffset = e.clientY - initialY;
      node.style.transform = `translate3d(${xOffset}px, ${yOffset}px, 0)`;
    }

    function dragEnd(e: PointerEvent) {
      active = false;
      header.releasePointerCapture(e.pointerId);
      header.removeEventListener('pointermove', handlePointerMove);
      header.removeEventListener('pointerup', dragEnd);
    }

    return {
      destroy() {
        header.removeEventListener('pointerdown', dragStart);
      }
    };
  }

  // Linearizes the circular plasmid at the clicked enzyme cutting coordinate
  function linearizePlasmid(pos: number) {
    if (pos <= 1 || pos > dnaSeq.length) return;
    const cutPos = pos - 1; // Convert to 0-indexed offset
    const newSeq = rotateBpsToPosition(dnaSeq, cutPos);
    dnaSeq = newSeq;
    pushToast('success', m.pmLinearizeSuccess(), m.pmLinearizeBody({ v1: pos }));
    activeSite = null;
    selectionStart = 1;
    selectionEnd = 1;
  }

  // Unified PNG camera export handler
  async function exportPlasmidPng() {
    if (shotBusy) return;
    shotBusy = true;
    try {
      if (linear) {
        if (linearExport) {
          await linearExport();
        } else {
          pushToast('error', m.exportFailed(), m.pmLinearCanvasNotReady());
        }
      } else {
        if (circularExport) {
          await circularExport();
        } else {
          pushToast('error', m.exportFailed(), m.pmCircularCanvasNotReady());
        }
      }
    } catch (err: any) {
      pushToast('error', m.exportFailed(), err.message);
    } finally {
      shotBusy = false;
    }
  }
</script>

<div style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0;">
  <!-- Toolbar -->
  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid var(--pix-border); padding: 2px 4px; background: var(--pix-bg-3); flex: 0 0 auto;">
    <div style="font-weight: bold; color: var(--pix-cyan); font-size: 11px;">{linear ? 'Linear Plasmid Map' : 'Circular Plasmid Map'}</div>
    <div style="display: flex; gap: 4px; align-items: center;">
      <div style="display: flex; gap: 2px; border: 1px solid var(--pix-border); background: rgba(0,0,0,0.2); padding: 1px; border-radius: 3px;">
        <button
          class="pix-btn-reset"
          aria-label={m.plasmidToolSelect()}
          title={m.pmToolSelectTitle()}
          onclick={() => (activeTool = 'select')}
          style="padding: 1px 4px; font-size: 10px; opacity: {activeTool === 'select' ? 1 : 0.6};"
        >
          <MousePointer size={11} />
        </button>
      <button
        class="pix-btn-reset"
        aria-label={m.plasmidToolPan()}
        title={m.pmToolPanTitle()}
        onclick={() => (activeTool = 'pan')}
        style="padding: 1px 4px; font-size: 10px; opacity: {activeTool === 'pan' ? 1 : 0.6};"
      >
        <Hand size={11} />
      </button>
      {#if !linear}
      <button
        class="pix-btn-reset"
        aria-label={m.plasmidToolRotate()}
        title={m.pmToolRotateTitle()}
        onclick={() => (activeTool = 'rotate')}
        style="padding: 1px 4px; font-size: 10px; opacity: {activeTool === 'rotate' ? 1 : 0.6};"
      >
        <RotateCw size={11} />
      </button>
     {/if}
      <button
        class="pix-btn-reset"
        aria-label={m.plasmidToolZoomIn()}
        title={m.pmZoomInTitle()}
        onclick={() => (linear ? linearMapRef?.zoomIn() : circularMapRef?.zoomIn())}
        style="padding: 1px 4px; font-size: 10px;"
      >
        <ZoomIn size={11} />
      </button>
      <button
        class="pix-btn-reset"
        aria-label={m.plasmidToolZoomOut()}
        title={m.pmZoomOutTitle()}
        onclick={() => (linear ? linearMapRef?.zoomOut() : circularMapRef?.zoomOut())}
        style="padding: 1px 4px; font-size: 10px;"
      >
        <ZoomOut size={11} />
      </button>
      <button
        class="pix-btn-reset"
        aria-label={m.plasmidToolResetView()}
        title={m.resetView()}
        onclick={() => (linear ? linearMapRef?.resetView() : circularMapRef?.resetView())}
        style="padding: 1px 4px; font-size: 10px;"
      >
        <RotateCcw size={11} />
      </button>
      <button 
        class="pix-btn-reset" 
        disabled={shotBusy} 
        onclick={exportPlasmidPng} 
        style="padding: 1px 6px; font-size: 10px; display: inline-flex; align-items: center; gap: 3px;"
      >
        <Camera size={11} /> {shotBusy ? '…' : 'PNG'}
      </button>
    </div>
  </div>
</div>

  <!-- Unified drawing container -->
  <div style="flex: 1 1 auto; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden;">
    {#if !linear}
      <!-- ============ CIRCULAR MAP (Modular Canvas) ============ -->
      <CircularMapCanvas
        {plasmidName}
        bind:dnaSeq
        {geneFeatures}
        {restrictionSites}
        {primers}
        {selectionNotes}
        bind:activeFeatureId
        bind:selectionStart
        bind:selectionEnd
        bind:exportPng={circularExport}
        {activeTool}
        bind:mapRef={circularMapRef}
      />

      <!-- Floating Features Annotation Tooltip/List (Gap 17 Parity) -->
      {#if geneFeatures.length > 0}
        <div use:drag={'.panel-header'} onpointerdown={() => onFocusFeatures()} class="plasmid-features-tooltip" style="position: absolute; left: 10px; top: 10px; z-index: {featuresZIndex}; width: 220px; background: rgba(8, 11, 17, 0.9); border: 1.5px solid var(--pix-border); border-radius: 6px; padding: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.85); font-family: var(--pix-font); pointer-events: auto; display: flex; flex-direction: column; max-height: 250px; overflow-y: auto;">
          <div class="panel-header" style="font-size: 11px; font-weight: bold; color: var(--pix-cyan); margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; user-select: none;">
            <span>{m.plasmidFeatures()} ✥</span>
            <span style="font-size: 8.5px; opacity: 0.6; color: var(--pix-fg-dim);">{geneFeatures.length} features</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            {#each geneFeatures as feat}
              {@const isExpanded = expandedFeatureId === feat.id}
              {@const isHovered = activeFeatureId === feat.id}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                onclick={() => {
                  if (isExpanded) {
                    expandedFeatureId = null;
                  } else {
                    expandedFeatureId = feat.id;
                    selectionStart = feat.start;
                    selectionEnd = feat.end;
                    activeFeatureId = feat.id;
                    pushToast('info', m.featureSelected(), `${feat.name} (${feat.start}..${feat.end} bp)`);
                  }
                }}
                onmouseenter={() => activeFeatureId = feat.id}
                onmouseleave={() => activeFeatureId = null}
                style="padding: 6px; border-radius: 4px; border: {isExpanded ? '1.5px solid #FFB703' : isHovered ? '1px solid var(--pix-cyan)' : '1px solid rgba(255,255,255,0.1)'}; background: {isExpanded ? 'rgba(255, 183, 3, 0.08)' : isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'}; cursor: pointer; transition: all 0.1s ease-in-out;"
              >
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                  <span style="font-size: 10px; font-weight: bold; color: {feat.color || '#e0e0e0'};">{feat.name}</span>
                  <span style="font-size: 8px; padding: 1px 4px; border-radius: 3px; background: {feat.color ? feat.color + '22' : 'rgba(255,255,255,0.1)'}; color: {feat.color || '#e0e0e0'}; border: 1px solid {feat.color || 'rgba(255,255,255,0.2)'}; font-weight: bold;">{feat.type.toUpperCase()}</span>
                </div>
                {#if isExpanded}
                  <div style="font-size: 8.5px; color: var(--pix-fg-dim); border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 4px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
                    <div style="display: flex; justify-content: space-between;">
                      <span>{m.range()}</span>
                      <span class="pix-num" style="color: var(--pix-fg);">{feat.start} - {feat.end} bp</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span>{m.size()}</span>
                      <span class="pix-num" style="color: var(--pix-fg);">{feat.end - feat.start + 1} bp</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span>{m.strand()}</span>
                      <span>{feat.forward !== false ? (m.forward()) : (m.reverse())}</span>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <!-- ============ LINEAR MAP (Modular Canvas) ============ -->
      <LinearMapCanvas
        plasmidName={plasmidName}
        bind:dnaSeq
        {geneFeatures}
        {restrictionSites}
        {selectionNotes}
        bind:activeFeatureId
        bind:selectionStart
        bind:selectionEnd
        bind:exportPng={linearExport}
        onEnzymeClick={(site) => activeSite = site}
        {activeTool}
        bind:mapRef={linearMapRef}
      />
    {/if}

    <!-- Floating cut / linearize action bubble -->
    {#if activeSite}
      <div 
        class="pix-panel" 
        style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #0c101a; border-color: var(--pix-accent-2); padding: 8px; border-radius: 4px; z-index: 100; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.9); font-family: var(--pix-font); min-width: 140px;"
      >
        <div style="font-size: 8px; font-weight: bold; color: var(--pix-accent-2); margin-bottom: 4px;">
          {m.restrictionSite()}: {activeSite.name} ({activeSite.pos} bp)
        </div>
        <div style="display: flex; gap: 6px; justify-content: center;">
          <button 
            class="pix-btn ok" 
            onclick={() => linearizePlasmid(activeSite!.pos)} 
            style="padding: 2px 6px; font-size: 8px; cursor: pointer; display:inline-flex; align-items:center; gap:3px;"
          >
            <Scissors size={9} /> {m.cutPlasmidHere()}
          </button>
          <button 
            class="pix-btn" 
            onclick={() => activeSite = null} 
            style="padding: 2px 6px; font-size: 8px; color: var(--pix-fg-dim); cursor: pointer;"
          >
            {m.cancel()}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
