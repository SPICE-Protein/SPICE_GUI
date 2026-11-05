<script lang="ts">
  // Shared project strip for the bench tools. A tool supplies four
  // snapshots: payload, name, preview and summary; this component handles
  // capture (project open, tool not active) and write-back (tool active).
  import { goto } from '$app/navigation';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import type { ToolDocKind } from '$lib/project/types';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { Package, Save, CornerDownLeft } from 'lucide-svelte';

  let {
    kind,
    getPayload,
    getName,
    getPreview,
    getSummary
  } = $props<{
    kind: ToolDocKind;
    getPayload: () => unknown;
    getName: () => string;
    getPreview?: () => Promise<string | null> | string | null;
    getSummary?: () => string | undefined;
  }>();

  let busy = $state(false);
  const active = $derived(projectStore.hasOpenProject && projectStore.activeDocKind === kind);
  const doc = $derived(projectStore.activeDoc);

  async function safePreview(): Promise<string | undefined> {
    if (!getPreview) return undefined;
    try {
      const value = await getPreview();
      return typeof value === 'string' && value.startsWith('data:image/') ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function capture() {
    if (!projectStore.hasOpenProject || busy) return;
    busy = true;
    try {
      const preview = await safePreview();
      const id = projectStore.addDoc(kind, getName(), getPayload(), {
        preview,
        summary: getSummary?.()
      });
      projectStore.activeDocId = id;
      pushToast('success', m.projectSavedToast(), projectStore.current?.meta.name);
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (!projectStore.hasOpenProject || busy) return;
    busy = true;
    try {
      projectStore.commitDoc(kind, getPayload());
      const preview = await safePreview();
      projectStore.updateActiveDocPreview(preview, getSummary?.());
      const r = await projectStore.saveActiveDoc();
      if (r.ok && !r.snapshotOnly) pushToast('success', m.projectSavedToast(), r.path ?? undefined);
      else if (r.ok) pushToast('info', m.projectBannerUnsaved(), m.projectNeverSaved());
      else if (r.error) pushToast('error', m.projectSaveFailedToast(), r.error);
    } finally {
      busy = false;
    }
  }

  function returnToHub() {
    projectStore.activeDocId = null;
    goto('/project');
  }
</script>

{#if projectStore.hasOpenProject}
  <div class="tpb-strip" class:tpb-active={active}>
    <span class="tpb-id">
      <Package size={12} />
      {#if active && doc}
        {projectStore.current?.meta.name} › {doc.name}
        <span
          class="tpb-led"
          style="background: {projectStore.dirty ? 'var(--pix-red)' : 'var(--pix-green)'}"
          title={projectStore.dirty ? m.projectBannerUnsaved() : m.projectBannerSaved()}
        ></span>
      {:else}
        {projectStore.current?.meta.name}
      {/if}
    </span>
    <span class="tpb-spacer"></span>
    {#if active}
      <button class="pix-btn tpb-btn" data-testid="tool-project-save" onclick={save} disabled={busy}>
        <Save size={12} /> {m.projectBannerSaveBtn()}
      </button>
      <button class="pix-btn tpb-btn" data-testid="tool-project-return" onclick={returnToHub}>
        <CornerDownLeft size={12} /> {m.projectBannerReturnBtn()}
      </button>
    {:else}
      <button class="pix-btn tpb-btn" data-testid="tool-project-capture" onclick={capture} disabled={busy}>
        <Save size={12} /> {m.projectBannerSaveBtn()}
      </button>
    {/if}
  </div>
{/if}

<style>
  .tpb-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    background: var(--pix-bg-2);
    border-bottom: 1px solid var(--pix-border, #2a3a44);
    font-family: var(--pix-font);
    font-size: 11px;
    flex: 0 0 auto;
  }
  .tpb-active {
    border-bottom: 2px solid var(--pix-cyan);
    box-shadow: 0 0 8px rgba(76, 214, 255, 0.25);
  }
  .tpb-id {
    color: var(--pix-cyan);
    font-weight: bold;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tpb-led {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    display: inline-block;
    margin-left: 2px;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
  }
  .tpb-spacer {
    flex: 1;
  }
  .tpb-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px !important;
    font-size: 11px !important;
  }
</style>
