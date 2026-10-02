<script lang="ts">
  // SPICE_PROJECT hub — VS Code-flavored workbench layout:
  //   ┌ titlebar (project meta + save toolbar) ┐
  //   ├ side panel ──┬─ journal editor (main) ─┤
  //   │ info / docs  │ page tab strip + Crepe  │
  //   │ registry     │ + meta bar + 📽 Present │
  //   └──────────────┴─────────────────────────┘
  // The journal IS the document of this page, so it gets the big area;
  // embedded gene/protein docs and the project registry live in the side panel.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages.js';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import { projectStore, MAX_PROJECT_FILE_BYTES } from '$lib/project/store.svelte.ts';
  import { hasSlides } from '$lib/project/slides';
  import type { ProjectFileEntry } from '$lib/project/types';
  import Toaster from '$lib/ui/Toaster.svelte';
  import MilkdownEditor from '$lib/ui/MilkdownEditor.svelte';
  import PresenterView from '$lib/project/PresenterView.svelte';
  import {
    Folder,
    FolderOpen,
    FilePlus,
    Save,
    SaveAll,
    X,
    Trash2,
    Download,
    Play,
    Package,
    Dna,
    FlaskConical,
    ExternalLink,
    RotateCcw,
    FileText,
    Plus,
    Info,
    Library,
    Paperclip,
    Eye,
    File as FileIcon,
    Pencil
  } from 'lucide-svelte';

  let openProjectFile = $state<HTMLInputElement | undefined>();
  let showNewModal = $state(false);
  let showCloseConfirm = $state(false);
  let removeDocTarget = $state<string | null>(null);
  let removeRegTarget = $state<string | null>(null);
  let presenterOpen = $state(false);
  let editingDocId = $state<string | null>(null);
  let editingDocName = $state('');
  let editingFileId = $state<string | null>(null);
  let editingFileName = $state('');

  // attached files (experimental data / other-software outputs)
  let attachInput = $state<HTMLInputElement | undefined>();
  let previewFile = $state<ProjectFileEntry | null>(null);
  let previewText = $state('');
  let removeFileTarget = $state<string | null>(null);

  // new-project modal fields
  let npName = $state('');
  let npPi = $state('');
  let npDesc = $state('');

  // journal editor buffers (see two-effect commit pattern below)
  let mdBuf = $state('');
  let tagsBuf = $state('');
  let titleBuf = $state('');
  let catBuf = $state('General');

  const pj = $derived(projectStore.current);
  const pages = $derived(projectStore.activePages);
  const activePage = $derived(projectStore.activeJournalPage);

  onMount(() => {
    aiState.currentWorkspace = 'general';
    if (!projectStore.hasOpenProject) {
      projectStore.restoreFromLocalSession();
    }
  });

  // Keep the editor buffers synced to whichever page tab is active, and mirror
  // buffer edits back into the project store (marks dirty + debounced save).
  $effect(() => {
    const p = projectStore.activeJournalPage;
    titleBuf = p?.title ?? '';
    catBuf = p?.category ?? 'General';
    tagsBuf = (p?.tags ?? []).join(', ');
    mdBuf = p?.markdownContent ?? '';
  });
  $effect(() => {
    const p = projectStore.activeJournalPage;
    if (!p) return;
    const _md = mdBuf;
    const _t = titleBuf;
    const _g = tagsBuf;
    const _c = catBuf;
    if (_md !== p.markdownContent) projectStore.commitJournalPage(p.id, _md);
    // Compare against the NORMALIZED tags so trailing commas don't re-fire forever.
    const normTags = _g.split(',').map(s => s.trim()).filter(Boolean).join(', ');
    if (_t !== p.title || normTags !== p.tags.join(', ') || _c !== p.category) {
      projectStore.updateJournalMeta(p.id, {
        title: _t,
        category: _c,
        tags: normTags ? normTags.split(', ').map(s => s.trim()).filter(Boolean) : []
      });
    }
  });

  // ------- hub Ctrl+S (skip when typing in inputs/contenteditable) -------
  function onWindowKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    doSave();
  }

  async function doSave() {
    if (!projectStore.hasOpenProject) return;
    const r = await projectStore.saveActiveDoc();
    if (r.ok && r.path) pushToast('success', m.projectSavedToast(), r.path);
    else if (r.ok && !r.snapshotOnly) pushToast('success', m.projectSavedToast());
    else if (r.canceled) pushToast('info', m.projectSaveCanceled());
    else if (r.error) pushToast('error', m.projectSaveFailedToast(), r.error);
  }

  async function doSaveAs() {
    if (!projectStore.hasOpenProject) return;
    const r = await projectStore.saveAs();
    if (r.ok && r.path) pushToast('success', m.projectSavedToast(), r.path);
    else if (r.ok) pushToast('success', m.projectSavedToast());
    else if (r.canceled) pushToast('info', m.projectSaveCanceled());
    else if (r.error) pushToast('error', m.projectSaveFailedToast(), r.error);
  }

  function tryRestoreSession() {
    if (projectStore.restoreFromLocalSession()) pushToast('success', m.projectImportedToast());
    else pushToast('error', m.projectImportFailedToast());
  }

  async function onOpenFilePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    const r = await projectStore.importFromFile(file);
    if (r.ok) pushToast('success', m.projectImportedToast(), file.name);
    else pushToast('error', m.projectImportFailedToast(), r.error);
  }

  function openNewProject() {
    npName = '';
    npPi = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_author_name')) || '';
    npDesc = '';
    showNewModal = true;
  }

  function confirmNewProject() {
    const name = npName.trim();
    if (!name) return;
    projectStore.createProject(name, npPi.trim(), npDesc.trim());
    showNewModal = false;
  }

  function requestClose() {
    if (!projectStore.hasOpenProject) return;
    if (projectStore.dirty) showCloseConfirm = true;
    else doClose();
  }

  function doClose() {
    projectStore.closeProject();
    presenterOpen = false;
    showCloseConfirm = false;
    pushToast('info', m.projectClosedToast());
  }

  function openDoc(docId: string, kind: 'gene' | 'protein') {
    if (kind === 'gene') {
      projectStore.openDocInGenePage(docId);
      goto('/gene');
    } else {
      projectStore.openDocInProteinPage(docId);
      goto('/protein');
    }
  }

  function captureFromWorkspace(kind: 'gene' | 'protein') {
    projectStore.requestWorkspaceCapture(kind);
    goto(kind === 'gene' ? '/gene' : '/protein');
  }

  async function exportDoc(docId: string) {
    const r = await projectStore.exportDocStandalone(docId);
    if (r.ok && r.path) pushToast('success', m.projectSavedToast(), r.path);
    else if (r.ok) pushToast('success', m.projectSavedToast());
    else if (r.canceled) pushToast('info', m.projectSaveCanceled());
    else if (r.error) pushToast('error', m.projectSaveFailedToast(), r.error);
  }

  function startRenameDoc(docId: string, name: string) {
    editingDocId = docId;
    editingDocName = name;
  }
  function commitRenameDoc() {
    if (editingDocId) projectStore.renameDoc(editingDocId, editingDocName);
    editingDocId = null;
    editingDocName = '';
  }

  function openRegistryEntry(id: string) {
    const r = projectStore.openFromSnapshot(id);
    if (r.ok) pushToast('success', m.projectImportedToast());
    else pushToast('error', m.projectImportFailedToast(), r.error ?? 'no snapshot');
  }

  function readFileAsDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
  }

  async function onAttachPicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const f of files) {
      if (f.size > MAX_PROJECT_FILE_BYTES) {
        pushToast('error', m.projectFileTooBigToast({ name: f.name, max: String(Math.round(MAX_PROJECT_FILE_BYTES / 1024 / 1024)) }));
        continue;
      }
      try {
        const dataUri = await readFileAsDataUrl(f);
        projectStore.addFile(f.name, f.type || 'application/octet-stream', dataUri, f.size);
        pushToast('success', m.projectFileAddedToast(), f.name);
      } catch (err: any) {
        pushToast('error', m.projectImportFailedToast(), `${f.name}: ${String(err?.message ?? err)}`);
      }
    }
  }

  function fmtSize(n: number): string {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function fileKind(f: { mime: string }): 'image' | 'pdf' | 'text' | 'other' {
    if (f.mime.startsWith('image/')) return 'image';
    if (f.mime === 'application/pdf') return 'pdf';
    if (/^text\//.test(f.mime) || /json|csv|tab-separated|xml/.test(f.mime)) return 'text';
    return 'other';
  }

  function openPreview(f: ProjectFileEntry) {
    previewFile = f;
    previewText = '';
    if (fileKind(f) === 'text') {
      const bytes = projectStore.fileBytes(f.id);
      if (bytes) previewText = new TextDecoder().decode(bytes.subarray(0, 200_000));
    }
  }

  async function saveFileAs(f: ProjectFileEntry) {
    const bytes = projectStore.fileBytes(f.id);
    if (!bytes) {
      pushToast('error', m.projectSaveFailedToast(), f.name);
      return;
    }
    const r = await backend.saveExport(f.name, bytes);
    if (r.data?.saved) pushToast('success', m.projectSavedToast(), r.data.path ?? f.name);
    else if (r.error) pushToast('error', m.projectSaveFailedToast(), r.error);
  }

  function startRenameFile(id: string, name: string) {
    editingFileId = id;
    editingFileName = name;
  }
  function commitRenameFile() {
    if (editingFileId) projectStore.renameFile(editingFileId, editingFileName);
    editingFileId = null;
    editingFileName = '';
  }

  function fmtTime(iso: string): string {
    try {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return iso;
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="proj-workbench">
  <!-- ================= TITLEBAR ================= -->
  <div class="proj-titlebar">
    <span class="tb-proj"><Package size={14} /></span>
    {#if pj}
      <input
        class="tb-name"
        value={pj.meta.name}
        onchange={(e) => projectStore.renameProject((e.target as HTMLInputElement).value)}
      />
      <span class="tb-stats pix-dim">{m.projectStatsDocs({ n: pj.docs.length })} · {m.projectStatsPages({ n: pj.journal.pages.length })}{#if (pj.files?.length ?? 0) > 0} · {m.projectStatsFiles({ n: pj.files.length })}{/if}</span>
      <span class="tb-path pix-dim" title={projectStore.filePath ?? ''}>{projectStore.filePath ?? m.projectNeverSaved()}</span>
    {:else}
      <span class="tb-name static">{m.tabProject()}</span>
      <span class="tb-path pix-dim">{m.projectNoProjectHint()}</span>
    {/if}
    <span class="tb-spacer"></span>
    <span class="tb-led" style="background: {pj ? (projectStore.dirty ? 'var(--pix-red)' : 'var(--pix-green)') : 'var(--pix-border-hi)'}"
      title={pj ? (projectStore.dirty ? m.projectBannerUnsaved() : m.projectBannerSaved()) : ''}></span>
    {#if pj}
      <button class="tb-btn" onclick={doSave} title="{m.projectSaveBtn()} · Ctrl+S"><Save size={13} /></button>
      <button class="tb-btn" onclick={doSaveAs} title={m.projectSaveAsBtn()}><SaveAll size={13} /></button>
    {/if}
    <button class="tb-btn" onclick={openNewProject} title={m.projectNewBtn()}><FilePlus size={13} /></button>
    <button class="tb-btn" onclick={() => openProjectFile?.click()} title={m.projectOpenBtn()}><FolderOpen size={13} /></button>
    {#if !pj && projectStore.hasSessionSnapshot}
      <button class="tb-btn" onclick={tryRestoreSession} title={m.projectResumeBtn()}><RotateCcw size={13} /></button>
    {/if}
    {#if pj}
      <button class="tb-btn tb-close" onclick={requestClose} title={m.projectCloseBtn()}><X size={13} /></button>
    {/if}
  </div>

  <!-- ================= MAIN: SIDE + EDITOR ================= -->
  <div class="proj-main">
    <aside class="proj-side">
      {#if pj}
        <div class="ps-block">
          <div class="ps-title"><Info size={10} /> {m.projectSectionInfo()}</div>
          <textarea
            class="ps-desc"
            rows={2}
            placeholder={m.projectDescPh()}
            value={pj.meta.description}
            onchange={(e) => projectStore.setMetaDescription((e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <input
            class="ps-pi"
            placeholder={m.projectPiPh()}
            value={pj.meta.pi}
            onchange={(e) => projectStore.setMetaPi((e.target as HTMLInputElement).value)}
          />
        </div>
      {/if}

      <div class="ps-block grow">
        <div class="ps-title"><FileText size={10} /> {m.projectSectionDocs()}</div>
        {#if !pj}
          <div class="ps-empty pix-dim">{m.projectNoProjectHint()}</div>
        {:else if pj.docs.length === 0}
          <div class="ps-empty pix-dim">{m.projectDocsEmpty()}</div>
        {:else}
          <div class="ps-scroll">
            {#each pj.docs as doc (doc.id)}
              <div class="res-row" class:res-active={projectStore.activeDocId === doc.id}>
                <span class="res-chip {doc.kind === 'gene' ? 'chip-gene' : 'chip-protein'}">
                  {#if doc.kind === 'gene'}<Dna size={10} />{:else}<FlaskConical size={10} />{/if}
                </span>
                {#if editingDocId === doc.id}
                  <input
                    class="res-rename"
                    bind:value={editingDocName}
                    onblur={commitRenameDoc}
                    onkeydown={(e) => { if (e.key === 'Enter') commitRenameDoc(); }}
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="res-name" title="{doc.name} — {fmtTime(doc.updatedAt)}" ondblclick={() => startRenameDoc(doc.id, doc.name)}>
                    {doc.name}
                  </span>
                {/if}
                <span class="res-actions">
                  <button class="ra-btn" title={m.projectDocOpenBtn()} onclick={() => openDoc(doc.id, doc.kind)}><ExternalLink size={11} /></button>
                  <button class="ra-btn" title={m.projectRenameBtn()} onclick={() => startRenameDoc(doc.id, doc.name)}><Pencil size={11} /></button>
                  <button class="ra-btn" title={m.projectDocExportBtn()} onclick={() => exportDoc(doc.id)}><Download size={11} /></button>
                  <button class="ra-btn ra-danger" title={m.projectDocRemoveBtn()} onclick={() => (removeDocTarget = doc.id)}><Trash2 size={11} /></button>
                </span>
              </div>
            {/each}
          </div>
        {/if}
        {#if pj}
          <div class="ps-foot">
            <button class="ps-add" onclick={() => captureFromWorkspace('gene')}>
              <Dna size={11} /> {m.projectDocAddGeneBtn()}
            </button>
            <button class="ps-add" onclick={() => captureFromWorkspace('protein')}>
              <FlaskConical size={11} /> {m.projectDocAddProteinBtn()}
            </button>
          </div>
        {/if}
      </div>

      <div class="ps-block">
        <div class="ps-title"><Paperclip size={10} /> {m.projectSectionFiles()}</div>
        {#if !pj}
          <div class="ps-empty pix-dim">{m.projectNoProjectHint()}</div>
        {:else if (pj.files?.length ?? 0) === 0}
          <div class="ps-empty pix-dim">{m.projectFilesEmpty()}</div>
        {:else}
          <div class="ps-scroll capped">
            {#each pj.files as f (f.id)}
              <div class="res-row">
                <span class="res-chip chip-file">
                  {#if fileKind(f) === 'image'}<FileIcon size={10} />{:else if fileKind(f) === 'pdf'}<FileText size={10} />{:else}<FileIcon size={10} />{/if}
                </span>
                {#if editingFileId === f.id}
                  <input class="res-rename" bind:value={editingFileName} onblur={commitRenameFile}
                    onkeydown={(e) => { if (e.key === 'Enter') commitRenameFile(); }} />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="res-name" title="{f.name} · {f.mime} · {fmtSize(f.size)} · {fmtTime(f.updatedAt)}" ondblclick={() => startRenameFile(f.id, f.name)}>
                    {f.name}
                  </span>
                {/if}
                <span class="file-size pix-dim">{fmtSize(f.size)}</span>
                <span class="res-actions">
                  <button class="ra-btn" title={m.projectFilePreviewBtn()} onclick={() => openPreview(f)}><Eye size={11} /></button>
                  <button class="ra-btn" title={m.projectRenameBtn()} onclick={() => startRenameFile(f.id, f.name)}><Pencil size={11} /></button>
                  <button class="ra-btn" title={m.projectFileSaveBtn()} onclick={() => saveFileAs(f)}><Download size={11} /></button>
                  <button class="ra-btn ra-danger" title={m.projectFileRemoveBtn()} onclick={() => (removeFileTarget = f.id)}><Trash2 size={11} /></button>
                </span>
              </div>
            {/each}
          </div>
        {/if}
        {#if pj}
          <div class="ps-foot">
            <button class="ps-add" onclick={() => attachInput?.click()}>
              <Paperclip size={11} /> {m.projectFileImportBtn()}
            </button>
          </div>
        {/if}
      </div>

      <div class="ps-block">
        <div class="ps-title"><Library size={10} /> {m.projectSectionRegistry()}</div>
        {#if projectStore.registry.length === 0}
          <div class="ps-empty pix-dim">{m.projectRegistryEmpty()}</div>
        {:else}
          <div class="ps-scroll capped">
            {#each projectStore.registry as r (r.id)}
              <div class="res-row" class:res-active={!!pj && pj.meta.id === r.id}>
                <span class="res-chip chip-proj"><Package size={10} /></span>
                <span class="res-name" title="{r.name} · {fmtTime(r.updatedAt)} · {m.projectStatsFiles({ n: r.fileCount })} · {r.filePath ?? m.projectNeverSaved()}">
                  {r.name}{#if r.pi}<span class="pix-dim"> · {r.pi}</span>{/if}
                </span>
                <span class="res-actions">
                  <button class="ra-btn" title={m.projectRegistryOpenSnapBtn()} onclick={() => openRegistryEntry(r.id)}><FolderOpen size={11} /></button>
                  <button class="ra-btn ra-danger" title={m.projectRegistryRemoveBtn()} onclick={() => (removeRegTarget = r.id)}><Trash2 size={11} /></button>
                </span>
              </div>
            {/each}
          </div>
        {/if}
        <div class="ps-hint pix-dim">{m.projectRegistryNote()}</div>
      </div>
    </aside>

    <!-- ---- Journal = the main editor area ---- -->
    <div class="proj-editor">
      {#if !pj}
        <div class="editor-empty">
          <span class="empty-ico"><Folder size={48} /></span>
          <div class="empty-hint">{m.projectNoProjectHint()}</div>
          <div class="empty-btns">
            <button class="pix-btn ok" onclick={openNewProject}><FilePlus size={13} /> {m.projectNewBtn()}</button>
            <button class="pix-btn" onclick={() => openProjectFile?.click()}><FolderOpen size={13} /> {m.projectOpenBtn()}</button>
            {#if projectStore.hasSessionSnapshot}
              <button class="pix-btn" onclick={tryRestoreSession}><RotateCcw size={13} /> {m.projectResumeBtn()}</button>
            {/if}
          </div>
        </div>
      {:else}
        <!-- page tab strip (VS Code editor tabs) -->
        <div class="jtabs">
          {#each pages as pg (pg.id)}
            <div
              class="jtab"
              class:jtab-active={projectStore.activeJournalPageId === pg.id}
              role="button"
              tabindex={0}
              title={pg.title || m.projectJournalTitlePh()}
              onclick={() => projectStore.selectJournalPage(pg.id)}
              onkeydown={(e) => { if (e.key === 'Enter') projectStore.selectJournalPage(pg.id); }}
            >
              <span class="jtab-label">{pg.title || m.projectJournalTitlePh()}</span>
              <button
                class="jtab-x"
                aria-label={m.projectJournalDeletePage()}
                title={m.projectJournalDeletePage()}
                onclick={(e) => { e.stopPropagation(); projectStore.removeJournalPage(pg.id); }}
              >✕</button>
            </div>
          {/each}
          <button class="jtab-new" title={m.projectJournalNewPage()} onclick={() => projectStore.addJournalPage()}>
            <Plus size={12} />
          </button>
        </div>

        {#if pages.length === 0}
          <div class="editor-empty">
            <div class="empty-hint">{m.projectJournalEmpty()}</div>
            <button class="pix-btn ok" onclick={() => projectStore.addJournalPage()}>{m.projectJournalNewPage()}</button>
          </div>
        {:else}
          <!-- breadcrumb-ish meta bar -->
          <div class="jmeta">
            <input class="jm-title" placeholder={m.projectJournalTitlePh()} bind:value={titleBuf} />
            <select class="jm-cat" bind:value={catBuf}>
              {#each ['General', 'Experiment', 'Meeting', 'Protocol'] as c}
                <option value={c}>{c}</option>
              {/each}
            </select>
            <input class="jm-tags" placeholder={m.projectJournalTags()} bind:value={tagsBuf} />
            <span class="jm-date pix-dim">{activePage?.date}</span>
            <span class="tb-spacer"></span>
            <button class="pix-btn ok" disabled={!activePage || !hasSlides(mdBuf)}
              onclick={() => (presenterOpen = true)} title={m.projectPresenterHint()}>
              <Play size={12} /> {m.projectPresenterBtn()}
            </button>
          </div>
          <div class="jarea">
            <MilkdownEditor bind:value={mdBuf} />
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if activePage && presenterOpen}
  <PresenterView page={activePage} onClose={() => (presenterOpen = false)} />
{/if}

<!-- ================= MODALS ================= -->
{#if showNewModal}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box new-proj-box">
      <div class="modal-title">{m.projectNewPromptTitle()}</div>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="pix-input" placeholder={m.projectNamePh()} bind:value={npName} autofocus
        onkeydown={(e) => { if (e.key === 'Enter') confirmNewProject(); }} />
      <input class="pix-input" placeholder={m.projectPiPh()} bind:value={npPi} />
      <textarea class="pix-input" rows={3} placeholder={m.projectDescPh()} bind:value={npDesc}></textarea>
      <div class="modal-btns">
        <button class="pix-btn ok" onclick={confirmNewProject} disabled={!npName.trim()}>{m.projectNewBtn()}</button>
        <button class="pix-btn-reset" onclick={() => (showNewModal = false)}>{m.projectPresenterExit()}</button>
      </div>
    </div>
  </div>
{/if}

{#if showCloseConfirm}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box new-proj-box">
      <div class="modal-title">{m.projectCloseConfirmTitle()}</div>
      <div class="modal-desc">{m.projectCloseConfirmDesc()}</div>
      <div class="modal-btns">
        <button class="pix-btn" onclick={() => { doSave(); doClose(); }}>{m.projectSaveBtn()}</button>
        <button class="pix-btn-reset danger-text" onclick={doClose}>{m.projectCloseBtn()}</button>
        <button class="pix-btn-reset" onclick={() => (showCloseConfirm = false)}>{m.projectPresenterExit()}</button>
      </div>
    </div>
  </div>
{/if}

{#if removeDocTarget}
  {@const d = pj?.docs.find(x => x.id === removeDocTarget)}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box new-proj-box">
      <div class="modal-title">{m.projectDocRemoveConfirm()}</div>
      <div class="modal-desc">{d?.name}</div>
      <div class="modal-btns">
        <button class="pix-btn-reset danger-text" onclick={() => { projectStore.removeDoc(removeDocTarget ?? ''); removeDocTarget = null; }}>{m.projectDocRemoveBtn()}</button>
        <button class="pix-btn-reset" onclick={() => (removeDocTarget = null)}>{m.projectPresenterExit()}</button>
      </div>
    </div>
  </div>
{/if}

{#if removeRegTarget}
  {@const r = projectStore.registry.find(x => x.id === removeRegTarget)}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box new-proj-box">
      <div class="modal-title">{m.projectRegistryRemoveBtn()}</div>
      <div class="modal-desc">{m.projectRegistryRemoveConfirm()} {r?.name}</div>
      <div class="modal-btns">
        <button class="pix-btn-reset danger-text" onclick={() => { projectStore.removeRegistryEntry(removeRegTarget ?? ''); removeRegTarget = null; }}>{m.projectRegistryRemoveBtn()}</button>
        <button class="pix-btn-reset" onclick={() => (removeRegTarget = null)}>{m.projectPresenterExit()}</button>
      </div>
    </div>
  </div>
{/if}

{#if removeFileTarget}
  {@const f = pj?.files.find(x => x.id === removeFileTarget)}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box new-proj-box">
      <div class="modal-title">{m.projectFileRemoveConfirm()}</div>
      <div class="modal-desc">{f?.name}</div>
      <div class="modal-btns">
        <button class="pix-btn-reset danger-text" onclick={() => { projectStore.removeFile(removeFileTarget ?? ''); removeFileTarget = null; pushToast('info', m.projectFileRemovedToast()); }}>{m.projectFileRemoveBtn()}</button>
        <button class="pix-btn-reset" onclick={() => (removeFileTarget = null)}>{m.projectPresenterExit()}</button>
      </div>
    </div>
  </div>
{/if}

{#if previewFile}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-box preview-box">
      <div class="pv-head">
        <span class="modal-title pv-name">{previewFile.name}</span>
        <span class="pix-dim pv-meta">{previewFile.mime} · {fmtSize(previewFile.size)}</span>
        <span class="tb-spacer"></span>
        <button class="pix-btn tiny" onclick={() => { if (previewFile) saveFileAs(previewFile); }}><Download size={11} /> {m.projectFileSaveBtn()}</button>
        <button class="pix-btn-reset pv-close" onclick={() => (previewFile = null)}><X size={12} /></button>
      </div>
      <div class="pv-body">
        {#if fileKind(previewFile) === 'image'}
          <img class="pv-img" src={previewFile.data} alt={previewFile.name} />
        {:else if fileKind(previewFile) === 'pdf'}
          <iframe class="pv-pdf" src={previewFile.data} title={previewFile.name}></iframe>
        {:else if fileKind(previewFile) === 'text'}
          <pre class="pv-text">{previewText}</pre>
        {:else}
          <div class="pv-none pix-dim">{m.projectFileNoPreview()}</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<input type="file" accept=".spiceproj" style="display:none" bind:this={openProjectFile} onchange={onOpenFilePicked} />
<input type="file" multiple style="display:none" bind:this={attachInput} onchange={onAttachPicked} />

<Toaster />

<style>
  .proj-workbench {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--pix-bg);
    font-family: var(--pix-font);
    overflow: hidden;
  }

  /* ---------- titlebar ---------- */
  .proj-titlebar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }
  .tb-proj { color: var(--pix-green); display: inline-flex; }
  .tb-name {
    font-weight: 900;
    font-size: 13px;
    color: var(--pix-accent-2);
    background: transparent;
    border: 1px dashed transparent;
    font-family: var(--pix-font);
    max-width: 280px;
    min-width: 90px;
  }
  .tb-name:hover, .tb-name:focus { border-color: var(--pix-border-hi); outline: none; }
  .tb-name.static { border: none; cursor: default; }
  .tb-stats { font-size: 10px; white-space: nowrap; }
  .tb-path { font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 320px; min-width: 0; }
  .tb-spacer { flex: 1; min-width: 8px; }
  .tb-led { width: 8px; height: 8px; flex: 0 0 8px; }
  .tb-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 24px; cursor: pointer;
    border: 2px solid var(--pix-border); background: var(--pix-bg-3); color: var(--pix-fg-dim);
  }
  .tb-btn:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }
  .tb-close:hover { color: var(--pix-red); border-color: var(--pix-red); }

  /* ---------- main split ---------- */
  .proj-main { flex: 1; min-height: 0; display: flex; }
  .proj-side {
    flex: 0 0 300px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--pix-bg-2);
    border-right: 2px solid var(--pix-border);
    overflow: hidden;
  }
  .ps-block { padding: 8px 10px; border-bottom: 2px solid var(--pix-border); display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .ps-block.grow { flex: 1; }
  .ps-title {
    font-size: 9.5px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--pix-fg-dim); display: flex; align-items: center; gap: 5px;
  }
  .ps-desc, .ps-pi, .ps-add, .res-rename {
    background: var(--pix-bg-3); border: 2px solid var(--pix-border); color: var(--pix-fg);
    font-family: var(--pix-font); font-size: 10.5px; padding: 3px 6px; width: 100%; box-sizing: border-box;
  }
  .ps-desc { resize: vertical; min-height: 34px; }
  .ps-empty { font-size: 10px; padding: 10px 2px; line-height: 1.6; }
  .ps-hint { font-size: 8.5px; line-height: 1.5; }
  .ps-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
  .ps-scroll.capped { max-height: 160px; flex: 0 1 auto; }
  .ps-foot { display: flex; flex-direction: column; gap: 4px; }
  .ps-add {
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer; text-align: left;
  }
  .ps-add:hover { border-color: var(--pix-cyan); color: var(--pix-cyan); }

  .res-row {
    display: flex; align-items: center; gap: 6px;
    background: var(--pix-bg-3); border: 2px solid var(--pix-border); padding: 3px 6px; min-width: 0;
  }
  .res-active { border-color: var(--pix-cyan); box-shadow: 0 0 5px rgba(76, 214, 255, 0.3); }
  .res-chip {
    display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
    flex: 0 0 20px; border: 2px solid;
  }
  .chip-gene { color: var(--pix-cyan); border-color: var(--pix-cyan); }
  .chip-protein { color: var(--pix-purple); border-color: var(--pix-purple); }
  .chip-proj { color: var(--pix-green); border-color: var(--pix-green); }
  .chip-file { color: var(--pix-accent-2); border-color: var(--pix-accent-2); }
  .file-size { font-size: 8.5px; flex: 0 0 auto; }
  .res-name { font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .res-rename { flex: 1; min-width: 0; }
  .res-actions { display: inline-flex; gap: 3px; flex: 0 0 auto; }
  .ra-btn {
    display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 20px; cursor: pointer;
    border: 2px solid var(--pix-border); background: var(--pix-bg-2); color: var(--pix-fg-dim);
  }
  .ra-btn:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }
  .ra-danger:hover { color: var(--pix-red); border-color: var(--pix-red); }

  /* ---------- journal = main editor ---------- */
  .proj-editor { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--pix-bg); }
  .jtabs {
    flex: 0 0 auto; display: flex; align-items: stretch; gap: 2px; overflow-x: auto; overflow-y: hidden;
    background: var(--pix-bg-2); border-bottom: 2px solid var(--pix-border); padding-top: 2px;
  }
  .jtab {
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer; max-width: 200px; flex: 0 0 auto;
    background: var(--pix-bg-3); border: 2px solid var(--pix-border); border-bottom: none;
    padding: 4px 8px 3px 10px; color: var(--pix-fg-dim); font-size: 11px;
    border-radius: 4px 4px 0 0;
  }
  .jtab-active { background: var(--pix-bg); color: var(--pix-green); border-color: var(--pix-green); box-shadow: inset 0 2px 0 var(--pix-green); }
  .jtab-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold; }
  .jtab-x {
    border: none; background: transparent; color: inherit; cursor: pointer; font-size: 10px;
    width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  .jtab-x:hover { color: var(--pix-red); }
  .jtab-new {
    border: 2px solid transparent; background: transparent; color: var(--pix-fg-dim); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; padding: 0 6px;
  }
  .jtab-new:hover { color: var(--pix-green); }

  .jmeta {
    flex: 0 0 auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 5px 10px; background: var(--pix-bg-2); border-bottom: 2px solid var(--pix-border);
  }
  .jm-title { flex: 1; min-width: 120px; background: var(--pix-bg-3); border: 2px solid var(--pix-border); color: var(--pix-fg); font-family: var(--pix-font); font-size: 11px; padding: 2px 6px; }
  .jm-cat, .jm-tags { background: var(--pix-bg-3); border: 2px solid var(--pix-border); color: var(--pix-fg); font-family: var(--pix-font); font-size: 10.5px; padding: 2px 5px; }
  .jm-cat { width: 106px; }
  .jm-tags { width: 150px; }
  .jm-date { font-size: 9.5px; }

  .jarea { flex: 1; min-height: 0; overflow: hidden; background: var(--pix-bg); display: flex; flex-direction: column; }
  /* Crepe fills the main area, and .milkdown itself is the scroll layer
   * (page-local overrides — the shared component stays untouched). */
  .jarea :global(.milkdown-editor-wrapper) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .jarea :global(.milkdown-crepe-editor) { flex: 1; min-height: 0 !important; display: flex; flex-direction: column; overflow: hidden; }
  .jarea :global(.milkdown-crepe-editor .milkdown) { flex: 1; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden; }
  .jarea :global(.milkdown-crepe-editor .milkdown .editor) { min-height: 100%; }

  .editor-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; color: var(--pix-fg-dim); text-align: center; padding: 24px;
  }
  .empty-ico { color: var(--pix-green); display: inline-flex; }
  .empty-hint { font-size: 12px; max-width: 480px; line-height: 1.7; }
  .empty-btns { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .empty-btns .pix-btn { display: inline-flex; align-items: center; gap: 6px; }

  .danger-text { color: var(--pix-red) !important; border: 2px solid var(--pix-red) !important; background: var(--pix-bg-3); padding: 3px 12px; font-family: var(--pix-font); font-size: 11px; }

  /* modal CSS — page-local by convention (same block as gene page) */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }
  .modal-box {
    background: #0b0f19;
    border: 3px solid var(--pix-border);
    padding: 14px;
    width: 780px;
    max-width: 90%;
    max-height: 90%;
    overflow-y: auto;
    border-radius: 4px;
    box-shadow: 0 0 25px rgba(0, 0, 0, 0.95);
  }
  .new-proj-box { width: 420px; display: flex; flex-direction: column; gap: 10px; }
  .preview-box { width: min(1000px, 92vw); height: min(76vh, 760px); display: flex; flex-direction: column; gap: 8px; }
  .pv-head { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
  .pv-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%; }
  .pv-meta { font-size: 9.5px; }
  .pv-close { border: 2px solid var(--pix-border); background: var(--pix-bg-3); color: var(--pix-fg-dim); padding: 3px 8px; display: inline-flex; align-items: center; }
  .pv-close:hover { color: var(--pix-red); border-color: var(--pix-red); }
  .pv-body { flex: 1; min-height: 0; overflow: auto; background: var(--pix-bg-3); border: 2px solid var(--pix-border); display: flex; align-items: center; justify-content: center; }
  .pv-img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .pv-pdf { width: 100%; height: 100%; border: none; background: #000; }
  .pv-text { width: 100%; height: 100%; margin: 0; padding: 10px 12px; box-sizing: border-box; overflow: auto; color: var(--pix-fg); font-family: 'Fira Code', monospace; font-size: 10.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; text-align: left; align-self: flex-start; }
  .pv-none { font-size: 11px; padding: 20px; }
  .modal-title { font-weight: 900; color: var(--pix-accent-2); font-size: 13px; letter-spacing: 1px; }
  .modal-desc { font-size: 11px; color: var(--pix-fg-dim); line-height: 1.6; }
  .modal-btns { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .modal-btns .pix-btn-reset { border: 2px solid var(--pix-border); background: var(--pix-bg-3); padding: 3px 12px; font-family: var(--pix-font); font-size: 11px; color: var(--pix-fg-dim); }
  .modal-btns .pix-btn-reset:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }

  /* narrow screens: side panel stacks above the editor */
  @media (max-width: 860px) {
    .proj-main { flex-direction: column; }
    .proj-side { flex: 0 0 auto; border-right: none; border-bottom: 2px solid var(--pix-border); max-height: 42vh; }
    .ps-scroll { max-height: 140px; }
  }
</style>
