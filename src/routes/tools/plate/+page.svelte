<script lang="ts">
  // Plate layout designer sub-page. The tool itself lives in $lib/tools/plate.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as pm from '$lib/paraglide/messages.js';
  import { m } from '$lib/tools/plate/messages';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { ArrowLeft, Grid3X3 } from 'lucide-svelte';
  import PlateTool from '$lib/tools/plate/PlateTool.svelte';
  import Toaster from '$lib/ui/Toaster.svelte';

  onMount(() => {
    aiState.currentWorkspace = 'general';
  });
</script>

<div class="tool-page">
  <header class="tool-header">
    <button class="pix-btn-reset back-btn" onclick={() => goto('/tools')} title={pm.toolsBack()}>
      <ArrowLeft size={14} /> {pm.toolsBack()}
    </button>
    <span class="tool-title"><Grid3X3 size={14} /> {m.toolsPlateTitle()}</span>
    <span class="tool-desc">{m.toolsPlateDesc()}</span>
  </header>
  <PlateTool />
</div>

<Toaster />

<style>
  .tool-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    font-family: var(--pix-font);
  }
  .tool-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 2px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--pix-cyan);
    cursor: pointer;
  }
  .tool-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .tool-desc { font-size: 9.5px; color: var(--pix-fg-dim); }
  @media (max-width: 760px) {
    .tool-desc { display: none; }
  }
</style>
