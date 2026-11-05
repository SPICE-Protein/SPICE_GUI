<script lang="ts">
  // Vector import dialog for Figure Studio: paste/file Mermaid or SVG source,
  // choose whether to insert into the current figure or start a new one, then
  // hand the converted nodes back to the editor.
  import { ClipboardPaste, FileCode2, Loader2, X } from 'lucide-svelte';
  import { fm } from './messages';
  import { MERMAID_EXAMPLE, importMermaid } from './mermaidImport';
  import { importSvgMarkup, type VectorImportResult } from './importVector';

  type Tab = 'mermaid' | 'svg';
  type ImportMode = 'insert' | 'new';

  interface FigureImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImport: (result: VectorImportResult, mode: ImportMode) => void;
  }

  let { open, onClose, onImport }: FigureImportDialogProps = $props();

  let tab = $state<Tab>('mermaid');
  let mermaidText = $state('');
  let svgText = $state('');
  let mode = $state<ImportMode>('insert');
  let busy = $state(false);
  let error = $state('');
  let warningCount = $state<number | null>(null);

  let mermaidFileInput = $state<HTMLInputElement | null>(null);
  let svgFileInput = $state<HTMLInputElement | null>(null);

  // Clear stale feedback whenever the dialog is reopened.
  $effect(() => {
    if (open) {
      error = '';
      warningCount = null;
    }
  });

  function close() {
    if (busy) return;
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function selectTab(next: Tab) {
    if (busy) return;
    tab = next;
    error = '';
    warningCount = null;
  }

  async function readFile(file: File | null, target: Tab) {
    if (!file) return;
    error = '';
    warningCount = null;
    try {
      const text = await file.text();
      if (target === 'svg') {
        svgText = text;
        tab = 'svg';
      } else {
        mermaidText = text;
        tab = 'mermaid';
      }
    } catch {
      error = fm.figImportFailed();
    }
  }

  function onMermaidFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    void readFile(file, 'mermaid');
  }

  function onSvgFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    void readFile(file, 'svg');
  }

  async function pasteClipboard() {
    if (busy) return;
    error = '';
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        error = fm.figImportEmpty();
        return;
      }
      mermaidText = text;
      tab = 'mermaid';
      warningCount = null;
    } catch {
      error = `${fm.figImportFailed()} (clipboard)`;
    }
  }

  function loadExample() {
    if (busy) return;
    mermaidText = MERMAID_EXAMPLE;
    tab = 'mermaid';
    error = '';
    warningCount = null;
  }

  async function runImport() {
    if (busy) return;
    const source = tab === 'mermaid' ? mermaidText : svgText;
    if (!source.trim()) {
      error = fm.figImportEmpty();
      warningCount = null;
      return;
    }

    busy = true;
    error = '';
    warningCount = null;
    try {
      const result =
        tab === 'mermaid' ? await importMermaid(source) : await importSvgMarkup(source);
      warningCount = result.warnings.length;
      onImport(result, mode);
      onClose();
    } catch (thrown) {
      error =
        thrown instanceof Error && thrown.message ? thrown.message : fm.figImportFailed();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="overlay"
    role="presentation"
    data-testid="figure-import-dialog"
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-label={fm.figImportVectorTitle()}>
      <header class="dialog-head">
        <span class="title"><FileCode2 size={13} /> {fm.figImportVectorTitle()}</span>
        <button
          type="button"
          class="icon-btn"
          data-testid="figure-import-close"
          title={fm.figClose()}
          aria-label={fm.figClose()}
          disabled={busy}
          onclick={close}
        >
          <X size={13} />
        </button>
      </header>

      <div class="tabs" role="tablist" aria-label={fm.figImportVectorTitle()}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mermaid'}
          class:active={tab === 'mermaid'}
          data-testid="figure-import-tab-mermaid"
          disabled={busy}
          onclick={() => selectTab('mermaid')}
        >
          {fm.figImportMermaidTab()}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'svg'}
          class:active={tab === 'svg'}
          data-testid="figure-import-tab-svg"
          disabled={busy}
          onclick={() => selectTab('svg')}
        >
          {fm.figImportSvgTab()}
        </button>
      </div>

      <div class="body">
        {#if tab === 'mermaid'}
          <p class="hint">{fm.figImportMermaidHint()}</p>
          <textarea
            class="source"
            data-testid="figure-import-mermaid-text"
            spellcheck={false}
            placeholder={fm.figImportMermaidHint()}
            bind:value={mermaidText}
            disabled={busy}
          ></textarea>
          <div class="tools">
            <button type="button" class="btn" onclick={loadExample} disabled={busy}>
              {fm.figImportExample()}
            </button>
            <button type="button" class="btn" onclick={pasteClipboard} disabled={busy}>
              <ClipboardPaste size={11} /> {fm.figImportClipboard()}
            </button>
            <button
              type="button"
              class="btn"
              onclick={() => mermaidFileInput?.click()}
              disabled={busy}
            >
              {fm.figImportMermaid()}
            </button>
            <input
              class="file"
              type="file"
              accept=".mmd,.mermaid,.txt,text/plain"
              bind:this={mermaidFileInput}
              onchange={onMermaidFile}
              tabindex="-1"
              aria-hidden="true"
            />
          </div>
        {:else}
          <p class="hint">{fm.figImportSvgHint()}</p>
          <textarea
            class="source"
            data-testid="figure-import-svg-text"
            spellcheck={false}
            placeholder="<svg …>…</svg>"
            bind:value={svgText}
            disabled={busy}
          ></textarea>
          <div class="tools">
            <button
              type="button"
              class="btn"
              onclick={() => svgFileInput?.click()}
              disabled={busy}
            >
              <FileCode2 size={11} /> {fm.figImportSvg()}
            </button>
            <input
              class="file"
              type="file"
              accept=".svg,image/svg+xml"
              bind:this={svgFileInput}
              onchange={onSvgFile}
              tabindex="-1"
              aria-hidden="true"
            />
          </div>
        {/if}

        {#if error}
          <div class="error" role="alert" data-testid="figure-import-error">{error}</div>
        {/if}
        {#if warningCount !== null && warningCount > 0}
          <div class="warning" data-testid="figure-import-warnings">
            {fm.figImportWarnings({ n: warningCount })}
          </div>
        {/if}
      </div>

      <footer class="dialog-foot">
        <label class="mode">
          <span>{fm.figImportMode()}</span>
          <select data-testid="figure-import-mode" bind:value={mode} disabled={busy}>
            <option value="insert">{fm.figImportInsert()}</option>
            <option value="new">{fm.figImportNew()}</option>
          </select>
        </label>
        <div class="actions">
          <button type="button" class="btn" data-testid="figure-import-cancel" onclick={close} disabled={busy}>
            {fm.figClose()}
          </button>
          <button
            type="button"
            class="btn primary"
            data-testid="figure-import-run"
            onclick={runImport}
            disabled={busy}
          >
            {#if busy}<Loader2 size={11} class="spin" />{/if}
            {busy ? fm.figImportBusy() : fm.figImportAction()}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(4, 7, 12, 0.78);
    backdrop-filter: blur(2px);
    font-family: var(--pix-font, "SFMono-Regular", Menlo, Consolas, monospace);
  }
  .dialog {
    width: min(680px, 94vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--pix-panel, #10141f);
    color: var(--pix-fg, #d8e1f2);
    border: 3px solid var(--pix-border, #2a3450);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.04),
      0 0 0 2px rgba(0, 0, 0, 0.7),
      0 14px 40px rgba(0, 0, 0, 0.6);
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 2px solid var(--pix-border, #2a3450);
    background: var(--pix-bg-2, #121624);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--pix-accent-2, #ffd23f);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: var(--pix-bg-3, #1a2030);
    color: var(--pix-red, #ff5d5d);
    border: 2px solid var(--pix-border-hi, #4a5a82);
    cursor: pointer;
    font-family: inherit;
  }
  .icon-btn:hover:not(:disabled) {
    border-color: var(--pix-red, #ff5d5d);
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    border-bottom: 2px solid var(--pix-border, #2a3450);
    background: var(--pix-bg-2, #121624);
  }
  .tabs button {
    padding: 4px 12px;
    background: var(--pix-bg, #0b0e14);
    color: var(--pix-fg-dim, #8b96b5);
    border: 2px solid var(--pix-border, #2a3450);
    border-bottom: none;
    font-family: inherit;
    font-size: 9.5px;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--pix-accent-2, #ffd23f);
    border-color: var(--pix-border-hi, #4a5a82);
    background: var(--pix-bg-3, #1a2030);
  }
  .tabs button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    min-height: 0;
    overflow: auto;
  }
  .hint {
    margin: 0;
    font-size: 9.5px;
    line-height: 1.45;
    color: var(--pix-fg-dim, #8b96b5);
  }
  .source {
    width: 100%;
    min-height: 190px;
    resize: vertical;
    box-sizing: border-box;
    padding: 6px 7px;
    background: #070a12;
    color: var(--pix-fg, #d8e1f2);
    border: 2px solid var(--pix-border-hi, #4a5a82);
    font-family: var(--pix-font, "SFMono-Regular", Menlo, Consolas, monospace);
    font-size: 10px;
    line-height: 1.5;
    tab-size: 2;
  }
  .source:focus {
    outline: none;
    border-color: var(--pix-cyan, #4cd6ff);
  }
  .source:disabled {
    opacity: 0.65;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .file {
    display: none;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    background: var(--pix-bg-3, #1a2030);
    color: var(--pix-fg, #d8e1f2);
    border: 2px solid var(--pix-border-hi, #4a5a82);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.55);
    font-family: inherit;
    font-size: 9.5px;
    letter-spacing: 0.5px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    border-color: var(--pix-cyan, #4cd6ff);
    color: var(--pix-cyan, #4cd6ff);
  }
  .btn:active:not(:disabled) {
    transform: translate(1px, 1px);
    box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.55);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--pix-accent, #ff9f1c);
    color: #1a0f00;
    border-color: var(--pix-accent-2, #ffd23f);
    font-weight: 700;
  }
  .btn.primary:hover:not(:disabled) {
    color: #1a0f00;
    border-color: #fff;
  }
  .error {
    padding: 5px 7px;
    border: 2px solid var(--pix-red, #ff5d5d);
    background: rgba(255, 93, 93, 0.08);
    color: var(--pix-red, #ff5d5d);
    font-size: 9.5px;
    line-height: 1.4;
    word-break: break-word;
  }
  .warning {
    padding: 4px 7px;
    border: 1px dashed var(--pix-accent, #ff9f1c);
    color: var(--pix-accent, #ff9f1c);
    font-size: 9px;
    line-height: 1.4;
  }
  .dialog-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-top: 2px solid var(--pix-border, #2a3450);
    background: var(--pix-bg-2, #121624);
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 9.5px;
    color: var(--pix-fg-dim, #8b96b5);
  }
  .mode select {
    padding: 3px 5px;
    background: var(--pix-bg, #0b0e14);
    color: var(--pix-fg, #d8e1f2);
    border: 2px solid var(--pix-border-hi, #4a5a82);
    font-family: inherit;
    font-size: 9.5px;
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
