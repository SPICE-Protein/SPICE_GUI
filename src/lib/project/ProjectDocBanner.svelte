<script lang="ts">
  // Slim strip shown on gene/protein carrier pages while an embedded
  // project doc is being edited. Supplies Save-to-project + return-to-hub.
  // The window-level Ctrl+S handler is registered ONLY for the protein page
  // (the gene page already dispatches Mod+S through its keymap).
  import { goto } from '$app/navigation';
  import { projectStore } from './store.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { Package, Save, CornerDownLeft } from 'lucide-svelte';

  let { kind } = $props<{ kind: 'gene' | 'protein' }>();

  const active = $derived(projectStore.hasOpenProject && projectStore.activeDocKind === kind);
  const doc = $derived(projectStore.activeDoc);

  async function saveToProject() {
    const r = await projectStore.saveActiveDoc();
    if (r.ok && !r.snapshotOnly) {
      pushToast('success', m.projectSavedToast(), r.path ?? undefined);
    } else if (r.ok) {
      pushToast('info', m.projectBannerUnsaved(), m.projectNeverSaved());
    } else if (r.error) {
      pushToast('error', m.projectSaveFailedToast(), r.error);
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (kind !== 'protein' || !active) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveToProject();
    }
  }

  function returnToHub() {
    projectStore.activeDocId = null;
    goto('/project');
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if active && doc}
  <div class="pdb-strip">
    <span class="pdb-id"><Package size={12} /> {projectStore.current?.meta.name} › {doc.name}</span>
    <span class="pdb-led" style="background: {projectStore.dirty ? 'var(--pix-red)' : 'var(--pix-green)'}"
      title={projectStore.dirty ? m.projectBannerUnsaved() : m.projectBannerSaved()}></span>
    <span class="pdb-spacer"></span>
    <button class="pix-btn pdb-btn" onclick={saveToProject} title="Ctrl+S">
      <Save size={12} /> {m.projectBannerSaveBtn()}
    </button>
    <button class="pix-btn pdb-btn" onclick={returnToHub}>
      <CornerDownLeft size={12} /> {m.projectBannerReturnBtn()}
    </button>
  </div>
{/if}

<style>
  .pdb-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-cyan);
    box-shadow: 0 0 8px rgba(76, 214, 255, 0.25);
    font-family: var(--pix-font);
    font-size: 11px;
    flex: 0 0 auto;
  }
  .pdb-id { color: var(--pix-cyan); font-weight: bold; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pdb-led { width: 8px; height: 8px; flex: 0 0 8px; box-shadow: 0 0 4px rgba(0, 0, 0, 0.6); }
  .pdb-spacer { flex: 1; }
  .pdb-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px !important; font-size: 11px !important; }
</style>
