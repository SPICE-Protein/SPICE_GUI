<script lang="ts">
  import { untrack, onMount } from 'svelte'; 

  import * as m from '$lib/paraglide/messages.js';
  import { Sparkles, Camera, Plus, Trash2 } from 'lucide-svelte';
  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';

  export interface GelLane {
    id: string;
    name: string;
    bands: number[];
    color: string;
  }

  let {
    fragments = [] as number[],
    plasmidName = '',
    lanes = $bindable([] as GelLane[])
  } = $props<{
    fragments: number[];
    plasmidName: string;
    lanes: GelLane[];
  }>();

  onMount(() => {
    if (lanes.length === 0) {
      lanes = [
        { id: 'lane1', name: 'Digest', bands: [...fragments], color: '#ff9f1c' }
      ];
    }
  });

  // Configurable gel parameters
  let agarosePercent = $state(1.2);
  let runTime = $state(30);
  let voltage = $state(100);

  // Marker sets
  const MARKER_SETS: Record<string, number[]> = {
    'DL2000': [2000, 1500, 1000, 750, 500, 250, 100],
    'DL5000': [5000, 3000, 2000, 1500, 1000, 500, 250, 100],
    'DL10000': [10000, 7000, 5000, 3000, 2000, 1500, 1000, 500],
    '1kb Plus': [12000, 8000, 5000, 3000, 2000, 1500, 1000, 500, 300, 100],
  };
  let selectedMarker = $state('DL2000');

  let prevFragments = $state<number[]>([]);
  $effect(() => {
    const currentBands = fragments;
    if (JSON.stringify(currentBands) !== JSON.stringify(prevFragments)) {
      prevFragments = [...currentBands];
      if (lanes.length > 0 && lanes[0].id === 'lane1') {
        lanes[0].bands = [...currentBands];
      }
    }
  });

  function addLane() {
    const idx = lanes.length + 1;
    // Pre-populate with the current digestion fragments so it is immediately useful and editable!
    lanes = [...lanes, { id: `lane${idx}`, name: `Lane ${idx}`, bands: [...fragments], color: '#4cd6ff' }];
  }

  function updateLaneBands(id: string, text: string) {
    const parts = text.split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0);
    lanes = lanes.map((l: any) => l.id === id ? { ...l, bands: parts } : l);
  }

  function removeLane(id: string) {
    lanes = lanes.filter((l: any) => l.id !== id);
  }

  const currentMarker = $derived(MARKER_SETS[selectedMarker] || MARKER_SETS['DL2000']);

  // Gel migration: agarose % and run time affect resolution
  function getMigrationY(bp: number): number {
    const agaroseFactor = Math.log(agarosePercent) / Math.log(1.2);
    const A = 210 - agaroseFactor * 15;
    const B = 25 + agaroseFactor * 3;
    const clamped = Math.max(50, Math.min(20000, bp));
    const timeFactor = runTime / 30;
    // Scale up vertically by 1.6 to match 260px height
    return Math.max(25, Math.min(240, (A - B * Math.log(clamped)) * timeFactor * 1.6));
  }

  // Enforces a minimum vertical spacing (minDist = 9px) between adjacent labels to prevent overlapping
  function resolveLabelCollisions(bps: number[], minDist = 9): { bp: number, y: number, labelY: number }[] {
    const items = bps.map(bp => ({
      bp,
      y: getMigrationY(bp),
      labelY: getMigrationY(bp)
    }));
    
    // Sort from top of the gel (large bp / small y) to bottom (small bp / large y)
    items.sort((a, b) => a.y - b.y);
    
    // Push overlapping labels downward
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const curr = items[i];
      if (curr.labelY - prev.labelY < minDist) {
        curr.labelY = prev.labelY + minDist;
      }
    }
    
    return items;
  }

  const markerLabels = $derived(resolveLabelCollisions(currentMarker, 9));
  const lanesWithResolvedLabels = $derived(
    lanes.map((lane: any) => ({
      ...lane,
      resolvedBands: resolveLabelCollisions(lane.bands, 9)
    }))
  );

  const gelWidth = $derived(120 + lanes.length * 110);

  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function exportGelPng() {
    try {
      const multStr = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4';
      const multiplier = parseInt(multStr) || 4;
      
      const width = gelWidth * multiplier;
      const height = 260 * multiplier;
      const cv = document.createElement('canvas');
      cv.width = width;
      cv.height = height;
      const ctx = cv.getContext('2d')!;

      ctx.fillStyle = '#040508';
      ctx.fillRect(0, 0, width, height);
      const grad = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
      grad.addColorStop(0, 'rgba(116, 76, 255, 0.15)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Marker lane (matches x="20" in SVG)
      const laneW = 50 * multiplier;
      let x = 20 * multiplier;
      const wellY = 6 * multiplier;
      const wellH = 5 * multiplier;

      ctx.fillStyle = '#141724';
      ctx.fillRect(x, wellY, laneW, wellH);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 0.5 * multiplier;
      ctx.strokeRect(x, wellY, laneW, wellH);
      ctx.fillStyle = '#a0a5b5';
      ctx.font = `bold ${5 * multiplier}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(selectedMarker, x + laneW/2, 15 * multiplier);

      ctx.shadowBlur = 4 * multiplier;
      ctx.shadowColor = '#53d769';
      ctx.strokeStyle = '#53d769';
      ctx.lineWidth = 2.2 * multiplier;
      const resolvedMarker = resolveLabelCollisions(currentMarker, 9);
      resolvedMarker.forEach(item => {
        const y = item.y * multiplier;
        ctx.beginPath();
        ctx.moveTo(x + 2 * multiplier, y);
        ctx.lineTo(x + laneW - 2 * multiplier, y);
        ctx.stroke();
      });

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a0a5b5';
      ctx.font = `${4 * multiplier}px monospace`;
      ctx.textAlign = 'right';
      resolvedMarker.forEach(item => {
        const y = item.labelY * multiplier;
        ctx.fillText(item.bp.toString(), x - 2 * multiplier, y + 1.5 * multiplier);
      });

      // Sample lanes (matches lx = 100 + idx * 110 in SVG)
      lanes.forEach((lane: any, idx: number) => {
        const lx = (100 + idx * 110) * multiplier;
        ctx.fillStyle = '#141724';
        ctx.fillRect(lx, wellY, laneW, wellH);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5 * multiplier;
        ctx.strokeRect(lx, wellY, laneW, wellH);
        ctx.fillStyle = lane.color;
        ctx.font = `bold ${5 * multiplier}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(lane.name, lx + laneW/2, 15 * multiplier);

        ctx.shadowBlur = 5 * multiplier;
        ctx.shadowColor = lane.color;
        ctx.strokeStyle = lane.color;
        ctx.lineWidth = 2.5 * multiplier;
        const resolvedBands = resolveLabelCollisions(lane.bands, 9);
        resolvedBands.forEach(item => {
          const y = item.y * multiplier;
          ctx.beginPath();
          ctx.moveTo(lx + 2 * multiplier, y);
          ctx.lineTo(lx + laneW - 2 * multiplier, y);
          ctx.stroke();
        });
        ctx.shadowBlur = 0;
        ctx.fillStyle = lane.color;
        ctx.font = `bold ${4.5 * multiplier}px monospace`;
        ctx.textAlign = 'left';
        resolvedBands.forEach(item => {
          const y = item.labelY * multiplier;
          ctx.fillText(`${item.bp} bp`, lx + laneW + 2 * multiplier, y + 1.5 * multiplier);
        });
      });

      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `${4 * multiplier}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`SPICE Gel — ${agarosePercent}% agarose, ${runTime}min, ${voltage}V (Super-Res ${multiplier}x)`, width / 2, height - 6 * multiplier);

      const png = cv.toDataURL('image/png');
      const filename = `${plasmidName}_gel_${agarosePercent}pct.png`;
      const r = await backend.saveExport(filename, base64ToBytes(png.split(',')[1]));
      if (r.data?.path) {
        pushToast('success', m.vgGelExportSuccess({ v1: multiplier }), r.data.path);
      }
    } catch (e: any) {
      pushToast('error', m.vgGelExportFailed(), e.message ?? e);
    }
  }
</script>

<div class="gel-box" style="display: flex; flex-direction: column; gap: 6px;">
  <div style="display: flex; justify-content: flex-end; align-items: center; margin-bottom: 2px;">
    <button class="pix-btn-reset" onclick={exportGelPng} style="padding: 2px 6px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
      <Camera size={11} /> {m.btnExportGelPng()}
    </button>
  </div>

  <!-- Config -->
  <div style="display: flex; gap: 8px; font-size: 9px; align-items: center; flex-wrap: wrap;">
    <label style="display: flex; align-items: center; gap: 2px;">
      {m.labelAgarose()}
      <input class="pix-input" type="number" bind:value={agarosePercent} min={0.3} max={3} step={0.1} style="padding: 1px 3px; font-size: 9px; width: 40px;" />
    </label>
    <label style="display: flex; align-items: center; gap: 2px;">
      {m.labelTimeMin()}
      <input class="pix-input" type="number" bind:value={runTime} min={5} max={120} step={5} style="padding: 1px 3px; font-size: 9px; width: 40px;" />
    </label>
    <label style="display: flex; align-items: center; gap: 2px;">
      {m.labelVoltageV()}
      <input class="pix-input" type="number" bind:value={voltage} min={50} max={300} step={10} style="padding: 1px 3px; font-size: 9px; width: 40px;" />
    </label>
    <label style="display: flex; align-items: center; gap: 2px;">
      Marker:
      <select class="pix-select" bind:value={selectedMarker} style="padding: 1px 3px; font-size: 9px;">
        {#each Object.keys(MARKER_SETS) as mk}
          <option value={mk}>{mk}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="gel-workspace" style="display: flex; gap: 8px; background: #080a10; border: 2px solid var(--pix-border); padding: 6px; border-radius: 4px; box-shadow: inset 0 0 15px rgba(0,0,0,0.8);">
    <!-- Gel Canvas (Horizontally Scrollable Left Pane!) -->
    <div style="width: 230px; overflow-x: auto; flex-shrink: 0; border-right: 1px dashed rgba(255,255,255,0.15);">
      <div class="gel-tank" style="position: relative; width: {gelWidth}px; height: 260px; background: #040508;">
        <div style="position: absolute; inset: 0; background: radial-gradient(circle, rgba(116, 76, 255, 0.08) 0%, rgba(0,0,0,0) 80%); pointer-events: none;"></div>
        <svg width={gelWidth} height="260" viewBox="0 0 {gelWidth} 260" style="display: block;">
          <!-- Marker lane -->
          <rect x="20" y="6" width="50" height="5" fill="#141724" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" />
          <text x="45" y="15" fill="var(--pix-dim)" font-size="6px" font-family="var(--pix-font)" font-weight="bold" text-anchor="middle">{selectedMarker}</text>
          {#each markerLabels as item}
            <line x1="22" y1={item.y} x2="68" y2={item.y} stroke="#53d769" stroke-width="2.2" opacity="0.9" style="filter: drop-shadow(0 0 1px #53d769);" />
            <text x="15" y={item.labelY + 1.5} fill="var(--pix-dim)" font-size="5px" font-family="var(--pix-font)" text-anchor="end">{item.bp}</text>
          {/each}

          <!-- Sample lanes -->
          {#each lanesWithResolvedLabels as lane, idx}
            {@const lx = 100 + idx * 110}
            <rect x={lx} y="6" width="50" height="5" fill="#141724" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" />
            <text x={lx + 25} y="15" fill={lane.color} font-size="6px" font-family="var(--pix-font)" font-weight="bold" text-anchor="middle">{lane.name}</text>
            {#each lane.resolvedBands as item}
              <line x1={lx + 2} y1={item.y} x2={lx + 48} y2={item.y} stroke={lane.color} stroke-width="2.5" opacity="0.95" style="filter: drop-shadow(0 0 1.5px {lane.color});" />
              <text x={lx + 52} y={item.labelY + 1.5} fill={lane.color} font-size="5.5px" font-family="var(--pix-font)" text-anchor="start" font-weight="bold">{item.bp} bp</text>
            {/each}
          {/each}
        </svg>
      </div>
    </div>

    <!-- Lane management + details (Fixed Right Pane!) -->
    <div style="flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 4px; font-size: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--pix-accent-2); font-weight: bold;">{m.labelLaneManagement()}</span>
        <button class="pix-btn-reset" onclick={addLane} style="font-size: 10px; display: inline-flex; align-items: center; gap: 2px; color: var(--pix-green);"><Plus size={10} /></button>
      </div>
      {#each lanes as lane, idx}
        <div class="pix-panel" style="padding: 4px 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <input class="pix-input" type="text" bind:value={lane.name} style="padding: 1px 3px; font-size: 9px; height: 18px; flex: 1; color: {lane.color};" />
            {#if idx > 0}
              <button class="pix-btn-reset" onclick={() => removeLane(lane.id)} style="font-size: 9px; color: var(--pix-red); padding: 1px 3px;"><Trash2 size={9} /></button>
            {/if}
          </div>
          <div style="display: flex; flex-direction: column; gap: 1px; margin-top: 2px;">
            <span class="pix-dim" style="font-size: 8px;">{m.labelBandSizes()}</span>
            <!-- Input to dynamically edit band sizes for this lane! -->
            <input class="pix-input" type="text" placeholder={m.eG20001000500()} value={lane.bands.join(', ')} oninput={(e) => updateLaneBands(lane.id, e.currentTarget.value)} style="padding: 1px 3px; font-size: 9px; height: 18px; color: {lane.color};" />
          </div>
        </div>
      {/each}
      <div class="pix-dim" style="font-size: 8px; margin-top: 2px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 3px; line-height: 1.2;">
        {m.gelNote()}
      </div>
    </div>
  </div>
</div>
