<script lang="ts">
  // Lua scripting panel for the gene workbench. Scripts only propose document
  // patches; the Apply button routes them through the page's normal edit path.
  import * as m from '$lib/paraglide/messages.js';
  import {
    Check,
    Copy,
    FileCode,
    Play,
    Plus,
    Save,
    Trash2,
    X,
  } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { parseArgsText, validateScript } from './model';
  import { runScript } from './runtime';
  import { scriptStore } from './store.svelte.ts';
  import type {
    ScriptFeatureSnapshot,
    ScriptLogEntry,
    ScriptPatch,
    ScriptPermission,
  } from './types';

  let {
    dnaSeq = '',
    docName = '',
    topology = 'circular',
    features = [],
    onApplyPatch = () => {},
  } = $props<{
    dnaSeq: string;
    docName: string;
    topology: 'circular' | 'linear';
    features: ScriptFeatureSnapshot[];
    onApplyPatch: (patch: ScriptPatch, scriptName: string) => void;
  }>();

  let draftName = $state('');
  let draftDescription = $state('');
  let draftSource = $state('');
  let draftArgs = $state('{}');
  let draftPermissions = $state<ScriptPermission[]>(['doc:read']);

  let logs = $state<ScriptLogEntry[]>([]);
  let resultText = $state('');
  let runError = $state<string | null>(null);
  let argsError = $state<string | null>(null);
  let running = $state(false);
  let pendingPatch = $state<ScriptPatch | null>(null);
  let lastRunName = $state('');
  let deleteArmed = $state(false);

  const selected = $derived(scriptStore.selected);
  const readOnly = $derived(Boolean(selected?.builtin));

  function loadDraft() {
    const script = scriptStore.selected;
    if (!script) return;
    draftName = script.name;
    draftDescription = script.description;
    draftSource = script.source;
    draftPermissions = [...script.permissions];
    draftArgs = '{}';
    logs = [];
    resultText = '';
    runError = null;
    argsError = null;
    pendingPatch = null;
    deleteArmed = false;
  }

  function selectScript(id: string) {
    scriptStore.select(id);
    loadDraft();
  }

  loadDraft();

  function newScript() {
    scriptStore.add({
      name: m.scriptUntitled(),
      description: '',
      source: '-- Read spice.doc, compute, then return a table.\nreturn {\n  name = spice.doc.name,\n  length = #spice.doc.sequence,\n}\n',
      permissions: ['doc:read'],
    });
    loadDraft();
  }

  function duplicateScript() {
    const copy = scriptStore.duplicate(scriptStore.selectedId);
    if (!copy) return;
    loadDraft();
    pushToast('success', m.scriptDuplicated(), copy.name);
  }

  function saveScript() {
    const script = scriptStore.selected;
    if (!script || script.builtin) return;
    const validation = validateScript({ name: draftName, source: draftSource });
    if (!validation.ok) {
      pushToast('error', m.scriptInvalidTitle(), validation.error ?? '');
      return;
    }
    scriptStore.update(script.id, {
      name: draftName,
      description: draftDescription,
      source: draftSource,
      permissions: draftPermissions,
    });
    loadDraft();
    pushToast('success', m.scriptSaved(), draftName.trim());
  }

  function removeScript() {
    const script = scriptStore.selected;
    if (!script || script.builtin) return;
    if (!deleteArmed) {
      deleteArmed = true;
      return;
    }
    scriptStore.remove(script.id);
    deleteArmed = false;
    loadDraft();
    pushToast('info', m.scriptDeleted(), script.name);
  }

  function togglePermission(permission: ScriptPermission, checked: boolean) {
    if (permission === 'doc:read') return;
    draftPermissions = checked
      ? [...new Set([...draftPermissions, permission])]
      : draftPermissions.filter((entry) => entry !== permission);
  }

  async function run() {
    if (running) return;
    const validation = validateScript({ name: draftName, source: draftSource });
    if (!validation.ok) {
      pushToast('error', m.scriptInvalidTitle(), validation.error ?? '');
      return;
    }
    const parsed = parseArgsText(draftArgs);
    if (parsed.error) {
      argsError = parsed.error;
      return;
    }
    argsError = null;
    logs = [];
    resultText = '';
    runError = null;
    pendingPatch = null;
    running = true;
    lastRunName = draftName.trim() || m.scriptUntitled();

    try {
      const result = await runScript({
        name: lastRunName,
        source: draftSource,
        permissions: draftPermissions,
        document: {
          kind: 'gene',
          name: docName || 'Untitled',
          sequence: dnaSeq,
          topology,
          features,
        },
        args: parsed.args,
        onLog: (entry) => {
          logs = [...logs, entry];
        },
      });
      logs = result.logs;
      resultText = result.valueText ?? '';
      runError = result.error ?? null;
      pendingPatch = result.patch ?? null;
      if (result.ok) {
        pushToast('success', m.scriptRunDone(), `${lastRunName} · ${result.durationMs} ms`);
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
    }
  }

  function applyPatch() {
    if (!pendingPatch) return;
    onApplyPatch(pendingPatch, lastRunName);
    pendingPatch = null;
    pushToast('success', m.scriptPatchApplied(), lastRunName);
  }

  function logClass(level: ScriptLogEntry['level']): string {
    return level === 'error' ? 'sp-error' : level === 'warn' ? 'sp-warn' : '';
  }
</script>

<div class="script-panel" data-testid="script-panel">
  <aside class="sp-list">
    <button class="pix-btn ok sp-new" data-testid="script-new" onclick={newScript}>
      <Plus size={11} /> {m.scriptNew()}
    </button>
    <div class="sp-items">
      {#each scriptStore.scripts as script (script.id)}
        <button
          class="sp-item"
          class:active={script.id === scriptStore.selectedId}
          onclick={() => selectScript(script.id)}
        >
          <span class="sp-item-name">{script.name}</span>
          {#if script.builtin}<span class="sp-tag">{m.scriptBuiltin()}</span>{/if}
        </button>
      {/each}
    </div>
  </aside>

  <section class="sp-main">
    <div class="sp-row">
      <input class="pix-input sp-name" data-testid="script-name" bind:value={draftName} disabled={readOnly} placeholder={m.scriptName()} />
      <button class="pix-btn ok" data-testid="script-run" onclick={run} disabled={running || !draftSource.trim()}>
        <Play size={11} /> {running ? m.scriptRunning() : m.scriptRun()}
      </button>
      {#if readOnly}
        <button class="pix-btn" data-testid="script-duplicate" onclick={duplicateScript}>
          <Copy size={11} /> {m.scriptDuplicate()}
        </button>
      {:else}
        <button class="pix-btn" data-testid="script-save" onclick={saveScript}>
          <Save size={11} /> {m.scriptSave()}
        </button>
        <button class="pix-btn-reset sp-danger" class:armed={deleteArmed} data-testid="script-delete" onclick={removeScript}>
          <Trash2 size={11} /> {deleteArmed ? m.scriptDeleteArmed() : m.scriptDelete()}
        </button>
      {/if}
    </div>

    <input class="pix-input sp-desc" bind:value={draftDescription} disabled={readOnly} placeholder={m.scriptDescription()} />

    <div class="sp-meta">
      <span class="pix-dim sp-dim">{m.scriptDocLine({ name: docName || 'Untitled', bp: String(dnaSeq.length), features: String(features.length) })}</span>
      <span class="tb-spacer"></span>
      <label class="sp-perm">
        <input type="checkbox" checked disabled />
        {m.scriptPermRead()}
      </label>
      <label class="sp-perm">
        <input
          type="checkbox"
          data-testid="script-perm-write"
          checked={draftPermissions.includes('doc:write')}
          disabled={readOnly}
          onchange={(e) => togglePermission('doc:write', (e.currentTarget as HTMLInputElement).checked)}
        />
        {m.scriptPermWrite()}
      </label>
    </div>

    <label class="sp-field">
      <span class="pix-dim sp-label">{m.scriptArgs()}</span>
      <input class="pix-input sp-args" data-testid="script-args" bind:value={draftArgs} placeholder={m.scriptArgsHint()} />
      {#if argsError}<span class="sp-error sp-inline">{m.scriptArgsInvalid()}: {argsError}</span>{/if}
    </label>

    <textarea
      class="pix-input sp-source"
      data-testid="script-source"
      bind:value={draftSource}
      readonly={readOnly}
      spellcheck="false"
    ></textarea>

    <div class="sp-output">
      <div class="sp-section-title">
        <FileCode size={11} /> {m.scriptConsole()}
        {#if lastRunName}<span class="pix-dim sp-dim">· {lastRunName}</span>{/if}
      </div>
      <pre class="sp-console" data-testid="script-console">{#each logs as entry}<span class={logClass(entry.level)}>{entry.message}</span>{'\n'}{/each}{#if logs.length === 0}<span class="pix-dim">{m.scriptConsoleEmpty()}</span>{/if}</pre>

      {#if runError}
        <div class="sp-error" data-testid="script-error">{runError}</div>
      {/if}

      {#if resultText}
        <div class="sp-section-title">{m.scriptResult()}</div>
        <pre class="sp-result" data-testid="script-result">{resultText}</pre>
      {/if}

      {#if pendingPatch}
        <div class="sp-patch" data-testid="script-patch">
          <div class="sp-patch-head">
            <Check size={11} /> {m.scriptPatchTitle()}
          </div>
          <div class="pix-dim sp-patch-desc">
            {m.scriptPatchDesc({
              bp: String(pendingPatch.sequence?.length ?? dnaSeq.length),
              name: pendingPatch.name ?? docName,
            })}
          </div>
          <div class="sp-row">
            <button class="pix-btn ok" data-testid="script-apply" onclick={applyPatch}>{m.scriptApply()}</button>
            <button class="pix-btn-reset" onclick={() => (pendingPatch = null)}><X size={11} /> {m.scriptDiscard()}</button>
          </div>
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .script-panel { display: flex; gap: 8px; min-height: 420px; max-height: calc(100vh - 190px); }
  .sp-list {
    flex: 0 0 148px; display: flex; flex-direction: column; gap: 6px;
    border-right: 2px solid var(--pix-border); padding-right: 8px; min-height: 0;
  }
  .sp-new { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px; font-size: 10px; }
  .sp-items { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
  .sp-item {
    display: flex; align-items: center; gap: 4px; text-align: left; cursor: pointer;
    background: var(--pix-bg-3); border: 1px solid var(--pix-border); color: var(--pix-fg-dim);
    font-family: var(--pix-font); font-size: 10px; padding: 4px 5px; line-height: 1.35;
  }
  .sp-item:hover { border-color: var(--pix-accent); color: var(--pix-fg); }
  .sp-item.active { border-color: var(--pix-cyan); color: var(--pix-cyan); background: rgba(76, 214, 255, 0.06); }
  .sp-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sp-tag {
    flex: 0 0 auto; font-size: 7.5px; letter-spacing: 0.4px; text-transform: uppercase;
    color: var(--pix-accent-2); border: 1px solid var(--pix-accent-2); padding: 0 3px;
  }

  .sp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow-y: auto; padding-right: 2px; }
  .sp-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .sp-row .pix-btn, .sp-row .pix-btn-reset { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; padding: 3px 7px; }
  .sp-name { flex: 1; min-width: 140px; font-size: 11px; padding: 3px 5px; }
  .sp-desc { width: 100%; box-sizing: border-box; font-size: 10px; padding: 3px 5px; }
  .sp-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sp-dim { font-size: 9px; }
  .sp-perm { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; color: var(--pix-fg-dim); }
  .sp-perm input { width: 11px; height: 11px; }
  .sp-field { display: flex; flex-direction: column; gap: 2px; }
  .sp-label { font-size: 9px; }
  .sp-args { font-size: 10px; padding: 3px 5px; font-family: var(--pix-font); }
  .sp-source {
    width: 100%; box-sizing: border-box; min-height: 150px; flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.45;
    padding: 6px; resize: vertical; tab-size: 2;
  }
  .sp-output { display: flex; flex-direction: column; gap: 4px; }
  .sp-section-title { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: bold; color: var(--pix-accent-2); }
  .sp-console, .sp-result {
    margin: 0; padding: 5px 6px; background: var(--pix-bg-3); border: 1px solid var(--pix-border);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.45;
    max-height: 130px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  }
  .sp-result { max-height: 180px; }
  .sp-error { color: var(--pix-red); font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
  .sp-inline { font-size: 9px; }
  .sp-warn { color: var(--pix-accent); }
  .sp-patch {
    border: 2px dashed var(--pix-green); padding: 6px; display: flex; flex-direction: column; gap: 4px;
    background: rgba(107, 231, 122, 0.04);
  }
  .sp-patch-head { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: bold; color: var(--pix-green); }
  .sp-patch-desc { font-size: 9.5px; line-height: 1.5; }
  .sp-danger { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--pix-red); padding: 2px 4px; }
  .sp-danger.armed { border: 2px solid var(--pix-red); background: rgba(255, 80, 80, 0.08); }
</style>
