<script lang="ts">
  // Tree tool sub-page. The editor itself lives in $lib/tools/tree.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { m } from '$lib/tools/tree/i18n';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { ArrowLeft, TreePine } from 'lucide-svelte';
  import TreeTool from '$lib/tools/tree/TreeTool.svelte';
  import Toaster from '$lib/ui/Toaster.svelte';

  onMount(() => {
    aiState.currentWorkspace = 'general';
  });
</script>

<div class="tool-page" data-testid="tool-page">
  <header class="tool-header">
    <button class="pix-btn-reset back-btn" onclick={() => goto('/tools')} title={m.toolsBack()}>
      <ArrowLeft size={14} /> {m.toolsBack()}
    </button>
    <span class="tool-title"><TreePine size={14} /> {m.toolsTreeTitle()}</span>
    <span class="tool-desc">{m.toolsTreeDesc()}</span>
  </header>
  <TreeTool />
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
    white-space: nowrap;
  }
  .tool-desc {
    font-size: 9.5px;
    color: var(--pix-fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
