<script lang="ts"> 
  import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages.js';

  import type { SangerTrace, TraceChannel } from '$lib/genome/sangerTrace';

  let {
    trace
  } = $props<{
    trace: SangerTrace;
  }>();

  // Sliding window base index
  let startBaseIndex = $state(0);
  const windowBasesCount = 22; // Number of bases to show at once

  // Vertical scaling factor (Zoom/Auto-scale)
  let verticalScale = $state(1.0);

  // Auto-scale peak values in the current window
  const activeBases = $derived.by(() => {
    const end = Math.min(startBaseIndex + windowBasesCount, trace.numBases);
    return {
      start: startBaseIndex,
      end,
      list: Array.from({ length: end - startBaseIndex }, (_, i) => startBaseIndex + i)
    };
  });

  const signalWindow = $derived.by(() => {
    if (activeBases.list.length === 0) return { startIdx: 0, endIdx: 0 };
    const firstPeak = trace.peakIndices[activeBases.start] ?? 0;
    const lastPeak = trace.peakIndices[activeBases.end - 1] ?? 0;
    const pad = 12;
    return {
      startIdx: Math.max(0, firstPeak - pad),
      endIdx: Math.min(trace.numPoints - 1, lastPeak + pad)
    };
  });

  // Calculate local max intensity in the current window for auto-scale
  const localMaxY = $derived.by(() => {
    let maxVal = 100;
    const { startIdx, endIdx } = signalWindow;
    trace.channels.forEach((ch: TraceChannel) => {
      for (let i = startIdx; i <= endIdx; i++) {
        if (ch.processed[i] > maxVal) {
          maxVal = ch.processed[i];
        }
      }
    });
    return maxVal;
  });

  // SVG configurations
  const width = 350;
  const height = 130;
  const plotHeight = 85;
  const marginY = 25; // bottom margin for base calls and quality bars

  // Helper to map signal coordinate to SVG space
  function getX(signalIdx: number): number {
    const { startIdx, endIdx } = signalWindow;
    const range = endIdx - startIdx || 1;
    return 15 + ((signalIdx - startIdx) / range) * (width - 30);
  }

  function getY(value: number): number {
    const scale = (plotHeight / (localMaxY || 1)) * verticalScale;
    return plotHeight - Math.min(plotHeight, value * scale);
  }

  // Generate SVG path for a channel
  function getChannelPath(channelName: string): string {
    const channel = trace.channels.find((ch: TraceChannel) => ch.channel === channelName);
    if (!channel) return '';

    const { startIdx, endIdx } = signalWindow;
    let path = '';
    for (let i = startIdx; i <= endIdx; i++) {
      const px = getX(i);
      const py = getY(channel.processed[i]);
      if (i === startIdx) {
        path += `M ${px} ${py}`;
      } else {
        path += ` L ${px} ${py}`;
      }
    }
    return path;
  }

  // Standard dye color coding for chromatograms
  const CHANNEL_COLORS: Record<string, string> = {
    A: '#2ecc71', // Green
    T: '#e74c3c', // Red
    C: '#3498db', // Blue
    G: '#f39c12'  // Orange/Yellow (instead of black for readability)
  };

  function getQualityColor(q: number): string {
    if (q >= 30) return '#2ecc71'; // High quality (99.9% accuracy) - Green
    if (q >= 20) return '#e67e22'; // Medium quality (99% accuracy) - Orange
    return '#e74c3c'; // Low quality - Red
  }

  // Navigation helpers
  function prevPage() {
    startBaseIndex = Math.max(0, startBaseIndex - 15);
  }

  function nextPage() {
    startBaseIndex = Math.min(trace.numBases - windowBasesCount, startBaseIndex + 15);
  }

  function zoomIn() {
    verticalScale = Math.min(5.0, verticalScale + 0.25);
  }

  function zoomOut() {
    verticalScale = Math.max(0.25, verticalScale - 0.25);
  }
</script>

<div class="sanger-chromatogram-hud pix-panel" style="padding: 6px; background: #000; border-color: var(--pix-border); margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
  
  <div style="display: flex; justify-content: space-between; align-items: center;">
    <span class="pix-dim" style="font-size: 8.5px; font-weight: bold; color: var(--pix-accent-2);">
      📊 {m.sangerTraceViewerTitle()} 
      <span class="pix-num" style="font-size: 8px; color: var(--pix-cyan);">({startBaseIndex + 1} - {Math.min(startBaseIndex + windowBasesCount, trace.numBases)} / {trace.numBases} bp)</span>
    </span>
    
    <div style="display: flex; gap: 4px; align-items: center;">
      <!-- Zoom controls -->
      <button class="pix-btn-reset" onclick={zoomOut} title={m.zoomOut()} style="padding: 1px 4px; font-size: 8px; cursor: pointer; border: 1px solid var(--pix-border); color: #fff;">
        <ZoomOut size={9} />
      </button>
      <button class="pix-btn-reset" onclick={zoomIn} title={m.zoomIn()} style="padding: 1px 4px; font-size: 8px; cursor: pointer; border: 1px solid var(--pix-border); color: #fff;">
        <ZoomIn size={9} />
      </button>
      <div class="menu-divider" style="height: 10px; margin: 0 2px;"></div>
      <!-- Pagination -->
      <button class="pix-btn-reset" disabled={startBaseIndex === 0} onclick={prevPage} style="padding: 1px 4px; font-size: 8px; cursor: pointer; border: 1px solid var(--pix-border); color: #fff;">
        <ChevronLeft size={9} />
      </button>
      <button class="pix-btn-reset" disabled={startBaseIndex >= trace.numBases - windowBasesCount} onclick={nextPage} style="padding: 1px 4px; font-size: 8px; cursor: pointer; border: 1px solid var(--pix-border); color: #fff;">
        <ChevronRight size={9} />
      </button>
    </div>
  </div>

  <!-- SVG Visualizer -->
  <div style="width: 100%; overflow-x: hidden; position: relative; background: #030303; border: 1.5px solid var(--pix-border); border-radius: 2px;">
    <svg {width} {height}>
      <!-- Draw Baseline grid -->
      <line x1={0} y1={plotHeight} x2={width} y2={plotHeight} stroke="rgba(255,255,255,0.15)" stroke-width="1" />
      <line x1={0} y1={plotHeight / 2} x2={width} y2={plotHeight / 2} stroke="rgba(255,255,255,0.05)" stroke-dasharray="2 3" />

      <!-- Draw Trace Curves -->
      {#each ['A', 'T', 'C', 'G'] as chName}
        <path d={getChannelPath(chName)} fill="none" stroke={CHANNEL_COLORS[chName]} stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      {/each}

      <!-- Draw Base Calls & Phred Quality Bars -->
      {#each activeBases.list as bIdx}
        {@const peakIdx = trace.peakIndices[bIdx]}
        {@const px = getX(peakIdx)}
        {@const base = trace.basecalls[bIdx] || 'N'}
        {@const qual = trace.qualities[bIdx] ?? 0}
        
        <!-- Quality Bar under the peak base call -->
        {@const barH = (qual / 50) * 16}
        {@const barY = height - 18 - barH}
        <rect x={px - 2} y={barY} width={4} height={barH} fill={getQualityColor(qual)} opacity="0.8" />

        <!-- Vertical guide line -->
        <line x1={px} y1={0} x2={px} y2={plotHeight} stroke="rgba(255,255,255,0.05)" stroke-dasharray="1 4" />

        <!-- Base Call Character -->
        <text x={px} y={height - 2} fill={CHANNEL_COLORS[base] || '#fff'} font-size="9px" font-weight="bold" text-anchor="middle">
          {base}
        </text>
        
        <!-- Position Tick numbers (every 10 bp) -->
        {#if (bIdx + 1) % 10 === 0}
          <text x={px} y={10} fill="var(--pix-fg-dim)" font-size="6.5px" text-anchor="middle">
            {bIdx + 1}
          </text>
        {/if}
      {/each}
    </svg>
  </div>
  
  <div style="display: flex; justify-content: space-between; font-size: 7.5px;" class="pix-dim">
    <div style="display: flex; gap: 6px;">
      <span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color: #2ecc71;">■</span> A</span>
      <span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color: #e74c3c;">■</span> T</span>
      <span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color: #3498db;">■</span> C</span>
      <span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color: #f39c12;">■</span> G</span>
    </div>
    <span>{m.sangerPhredLegend()}</span>
  </div>
</div>
