<script lang="ts">
  // Batch panel: choose many gel images (or a folder), run the automatic
  // pipeline with one optional marker ladder, and save one ZIP through the
  // backend. The heavy lifting lives in ./batch.ts.
  import { FolderOpen, Images, Play, Trash2 } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { g } from './messages';
  import { allLadders, type LadderDef } from './ladders';
  import { MAX_BATCH_IMAGES, imageFiles } from '$lib/tools/shared/batch';
  import { runBatchJob } from '$lib/tools/shared/batchWorker';
  import { saveZip } from '$lib/tools/shared/zipExport';
  import { buildGelBatch, type GelBatchBuild } from './batch';

  interface GelBatchOutcome {
    ok: number;
    failed: number;
    skipped: number;
    errors: { name: string; error: string }[];
    path?: string;
    error?: string;
    canceled?: boolean;
  }

  let {
    customLadders = [],
    exportDpi = 300
  } = $props<{ customLadders?: LadderDef[]; exportDpi?: number }>();

  let fileInput = $state<HTMLInputElement | null>(null);
  let folderInput = $state<HTMLInputElement | null>(null);
  let files = $state.raw<File[]>([]);
  let ladderId = $state('');
  let running = $state(false);
  let current = $state(0);
  let total = $state(0);
  let warning = $state('');
  let errors = $state<{ name: string; error: string }[]>([]);
  let result = $state<GelBatchOutcome | null>(null);

  const ladders = $derived(allLadders(customLadders));
  const dnaLadders = $derived(ladders.filter((l) => l.kind === 'dna'));
  const proteinLadders = $derived(ladders.filter((l) => l.kind === 'protein'));
  const progress = $derived(total ? Math.round((current / total) * 100) : 0);

  function pick(list: FileList | null) {
    const picked = imageFiles(list);
    if (!picked.length) {
      warning = g.gelBatchEmpty();
      return;
    }
    warning = picked.length > MAX_BATCH_IMAGES ? g.gelBatchCap({ n: MAX_BATCH_IMAGES }) : '';
    files = picked.slice(0, MAX_BATCH_IMAGES);
    errors = [];
    result = null;
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    pick(input.files);
    input.value = '';
  }

  function clear() {
    files = [];
    errors = [];
    result = null;
    warning = '';
    current = 0;
    total = 0;
  }

  async function run() {
    if (!files.length || running) return;
    running = true;
    errors = [];
    result = null;
    current = 0;
    total = files.length;
    try {
      const selected = files;
      const report = (done: number, all: number) => {
        current = done;
        total = all;
      };
      const batch = await runBatchJob<GelBatchBuild>({
        createWorker: () => new Worker(new URL('./batch.worker.ts', import.meta.url), { type: 'module' }),
        files: selected,
        payload: { ladderId: ladderId || undefined, dpi: exportDpi },
        onProgress: (p) => report(p.done, p.total),
        fallback: () =>
          buildGelBatch(selected, {
            ladderId: ladderId || undefined,
            dpi: exportDpi,
            onProgress: (p) => report(p.current, p.total),
          }),
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const fileName = `gel-batch-${stamp}.zip`;
      const saved = await saveZip(fileName, batch.entries);
      const outcome: GelBatchOutcome = {
        ok: batch.ok,
        failed: batch.failed,
        skipped: batch.skipped,
        errors: batch.errors,
        path: saved.path,
        error: saved.error,
        canceled: !saved.ok && !saved.error,
      };
      result = outcome;
      errors = batch.errors;
      if (outcome.error) pushToast('error', g.gelBatchTitle(), outcome.error);
      else if (outcome.canceled) {
        /* The save dialog was dismissed; keep the processed summary visible. */
      } else if (batch.failed) pushToast('warn', g.gelBatchTitle(), g.gelBatchFailed({ ok: batch.ok, failed: batch.failed }));
      else pushToast('success', g.gelBatchTitle(), g.gelBatchDone({ ok: batch.ok, failed: batch.failed }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast('error', g.gelBatchTitle(), message);
      errors = [{ name: '', error: message }];
    } finally {
      running = false;
    }
  }
</script>

<section class="batch">
  <div class="batch-desc">{g.gelBatchDesc()}</div>

  <input
    bind:this={fileInput}
    type="file"
    class="hidden"
    accept="image/png,image/jpeg,image/bmp,image/webp,image/gif,image/tiff,.tif,.tiff"
    multiple
    onchange={onPick}
  />
  <input
    bind:this={folderInput}
    type="file"
    class="hidden"
    accept="image/png,image/jpeg,image/bmp,image/webp,image/gif,image/tiff,.tif,.tiff"
    multiple
    webkitdirectory
    onchange={onPick}
  />

  <div class="btn-row">
    <button class="pix-btn small" type="button" disabled={running} onclick={() => fileInput?.click()}>
      <Images size={10} /> {g.gelBatchPickFiles()}
    </button>
    <button class="pix-btn small" type="button" disabled={running} onclick={() => folderInput?.click()}>
      <FolderOpen size={10} /> {g.gelBatchPickFolder()}
    </button>
    {#if files.length}
      <button class="pix-btn small danger" type="button" disabled={running} onclick={clear}>
        <Trash2 size={10} /> {g.gelBatchClear()}
      </button>
    {/if}
  </div>

  <label class="batch-row">
    <span>{g.gelBatchLadder()}</span>
    <select class="pix-select tiny" bind:value={ladderId} disabled={running}>
      <option value="">{g.gelBatchLadderNone()}</option>
      <optgroup label={m.gelTypeDna()}>
        {#each dnaLadders as ladder (ladder.id)}
          <option value={ladder.id}>{ladder.name}</option>
        {/each}
      </optgroup>
      <optgroup label={m.gelTypeProtein()}>
        {#each proteinLadders as ladder (ladder.id)}
          <option value={ladder.id}>{ladder.name}</option>
        {/each}
      </optgroup>
    </select>
  </label>

  {#if warning}
    <div class="batch-warn">{warning}</div>
  {/if}

  <div class="pix-dim tiny">
    {files.length ? g.gelBatchImages({ n: files.length }) : g.gelBatchNoImages()}
  </div>

  {#if files.length}
    <ul class="batch-list">
      {#each files.slice(0, 6) as file (file.name + file.size)}
        <li title={file.name}>{file.name}</li>
      {/each}
      {#if files.length > 6}
        <li class="pix-dim">+{files.length - 6}</li>
      {/if}
    </ul>
  {/if}

  <button class="pix-btn ok small" type="button" disabled={!files.length || running} onclick={run}>
    <Play size={10} /> {g.gelBatchRun()}
  </button>

  {#if running}
    <div class="batch-progress" aria-hidden="true"><div class="bar" style="width:{progress}%"></div></div>
    <div class="pix-dim tiny">{g.gelBatchRunning({ current, total })}</div>
  {/if}

  {#if result && !running && !result.canceled}
    <div class:batch-warn={result.failed > 0} class="pix-dim tiny">
      {result.failed
        ? g.gelBatchFailed({ ok: result.ok, failed: result.failed })
        : g.gelBatchDone({ ok: result.ok, failed: result.failed })}
    </div>
    {#if result.path}
      <div class="batch-path" title={result.path}>{result.path}</div>
    {/if}
  {/if}

  {#if errors.length}
    <ul class="batch-errors">
      {#each errors.slice(0, 8) as item, index (item.name + index)}
        <li><span>{item.name}</span> {item.error}</li>
      {/each}
      {#if errors.length > 8}
        <li class="pix-dim">+{errors.length - 8}</li>
      {/if}
    </ul>
  {/if}

  <div class="pix-dim tiny">{g.gelBatchNote()}</div>
</section>

<style>
  .batch { display: flex; flex-direction: column; gap: 5px; }
  .batch-desc { font-size: 8.5px; color: var(--pix-fg-dim); line-height: 1.35; }
  .batch-row { display: flex; flex-direction: column; gap: 2px; font-size: 9px; color: var(--pix-fg-dim); }
  .batch-row .pix-select { width: 100%; }
  .hidden { display: none; }
  .batch-warn { font-size: 8.5px; color: var(--pix-accent); line-height: 1.3; }
  .batch-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 74px; overflow-y: auto; font-size: 8.5px; color: var(--pix-fg-dim); }
  .batch-list li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .batch-progress { height: 5px; border: 1px solid var(--pix-border); background: var(--pix-bg-3); }
  .batch-progress .bar { height: 100%; background: var(--pix-cyan); transition: width 120ms linear; }
  .batch-path { font-size: 8px; color: var(--pix-green); word-break: break-all; }
  .batch-errors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 8.5px; color: var(--pix-red); max-height: 80px; overflow-y: auto; }
  .batch-errors span { color: var(--pix-fg-dim); }
</style>
