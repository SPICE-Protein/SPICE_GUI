<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Crepe } from '@milkdown/crepe';
  import * as m from '$lib/paraglide/messages.js';
  import { replaceAll, insert } from '@milkdown/utils';
  import '@milkdown/crepe/theme/common/style.css';
  import '@milkdown/crepe/theme/frame-dark.css';

  interface Props {
    value: string;
    onInsertDna?: () => void;
    onInsertProtein?: () => void;
    readonly?: boolean;
  }

  let { value = $bindable(), onInsertDna, onInsertProtein, readonly = false }: Props = $props();

  let container: HTMLDivElement | null = $state(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let crepe: Crepe | null = null;
  // Reactive readiness flag: crepe.create() is async, and touching editor/view
  // state before it resolves throws (`undefined is not an object
  // 'view.state.doc'` on WKWebView). Effects must gate on this flag instead of
  // on `crepe` being non-null, and re-run when it flips true.
  let crepeReady = $state(false);
  let isUpdatingFromEditor = false;

  onMount(async () => {
    if (!container) return;

    crepe = new Crepe({
      root: container,
      defaultValue: value || '',
    });

    crepe.on((api) => {
      api.markdownUpdated((ctx, markdown) => {
        isUpdatingFromEditor = true;
        value = markdown;
        setTimeout(() => {
          isUpdatingFromEditor = false;
        }, 10);
      });
    });

    try {
      await crepe.create();
      crepeReady = true;
    } catch (e) {
      console.error('[MilkdownEditor] Crepe failed to initialise', e);
    }
  });

  $effect(() => {
    const c = crepe;
    // crepeReady is tracked: this re-runs once async init finishes.
    if (c && crepeReady && !isUpdatingFromEditor && value !== undefined) {
      try {
        const currentMarkdown = c.getMarkdown();
        if (value !== currentMarkdown) {
          c.editor.action(replaceAll(value));
        }
      } catch {
        // editor torn down mid-flight — ignore
      }
    }
  });

  // Watch for readonly prop changes and apply to Crepe
  $effect(() => {
    const c = crepe;
    if (c && crepeReady && readonly !== undefined) {
      c.setReadonly(readonly);
    }
  });

  // Dynamically scan for DNA or Protein Code Blocks and add reactive editor-card styling classes
  $effect(() => {
    const _val = value; // Trigger on any note content changes
    const timer = setTimeout(() => {
      if (!container) return;
      const blocks = container.querySelectorAll('.milkdown-code-block');
      blocks.forEach((block) => {
        const langBtn = block.querySelector('.language-button');
        const langText = langBtn?.textContent?.trim().toLowerCase() || '';
        
        if (langText.includes('dna')) {
          block.classList.add('dna-editor-card');
          block.classList.remove('protein-editor-card');
        } else if (langText.includes('protein')) {
          block.classList.add('protein-editor-card');
          block.classList.remove('dna-editor-card');
        } else {
          block.classList.remove('dna-editor-card');
          block.classList.remove('protein-editor-card');
        }
      });
    }, 150);

    return () => clearTimeout(timer);
  });

  // Expose insertion API to parent
  export function insertMarkdown(markdown: string) {
    if (crepe && crepeReady) {
      crepe.editor.action(insert(markdown));
    }
  }

  // Handle local image file selector and encode to base64 for offline GxP compliance
  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64Url = reader.result as string;
      // Insert standard Markdown image at current cursor position
      insertMarkdown(`\n\n![${file.name}](${base64Url})\n\n`);
      if (fileInput) fileInput.value = ''; // Reset input selection
    };
    reader.readAsDataURL(file);
  }

  onDestroy(() => {
    crepeReady = false;
    const c = crepe;
    crepe = null;
    if (c) {
      try {
        c.destroy();
      } catch {
        // already torn down
      }
    }
  });
</script>

<div class="milkdown-editor-wrapper">
  <input type="file" accept="image/*" bind:this={fileInput} onchange={handleFileChange} style="display: none;" />

  {#if readonly}
    <div class="milkdown-custom-toolbar locked-toolbar" style="background: rgba(226, 180, 72, 0.05); border-color: var(--pix-accent-2);">
      <span style="color: var(--pix-accent-2); font-size: 9.5px; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; font-family: var(--pix-font);">
        🔒 {m.elnLockedState()} [21 CFR Part 11]
      </span>
    </div>
  {:else}
    <div class="milkdown-custom-toolbar">
      {#if onInsertDna}
        <button class="toolbar-btn dna-btn" onclick={onInsertDna}>
          {m.elnInsertDnaBtn()}
        </button>
      {/if}
      {#if onInsertProtein}
        <button class="toolbar-btn protein-btn" onclick={onInsertProtein}>
          {m.elnInsertProteinBtn()}
        </button>
      {/if}
      <button class="toolbar-btn img-btn" onclick={() => fileInput?.click()}>
        {m.elnInsertImageBtn()}
      </button>
    </div>
  {/if}
  <div bind:this={container} class="milkdown-crepe-editor" class:has-toolbar={true}></div>
</div>

<style>
  .milkdown-editor-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
  }

  .milkdown-custom-toolbar {
    display: flex;
    gap: 8px;
    background: #11141d;
    border: 1px solid var(--pix-border);
    border-bottom: none;
    padding: 6px 8px;
    align-items: center;
    border-radius: 4px 4px 0 0;
  }

  .toolbar-btn {
    padding: 3px 10px;
    border-radius: 3px;
    font-family: var(--pix-font), system-ui, sans-serif;
    font-size: 9.5px;
    font-weight: bold;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }

  .dna-btn {
    background: rgba(76, 214, 255, 0.08);
    border: 1px solid rgba(76, 214, 255, 0.3);
    color: #4cd6ff;
  }

  .dna-btn:hover {
    background: rgba(76, 214, 255, 0.15);
    border-color: #4cd6ff;
    box-shadow: 0 0 6px rgba(76, 214, 255, 0.25);
  }

  .protein-btn {
    background: rgba(166, 76, 255, 0.08);
    border: 1px solid rgba(166, 76, 255, 0.3);
    color: #a64cff;
  }

  .protein-btn:hover {
    background: rgba(166, 76, 255, 0.15);
    border-color: #a64cff;
    box-shadow: 0 0 6px rgba(166, 76, 255, 0.25);
  }

  .img-btn {
    background: rgba(226, 180, 72, 0.08);
    border: 1px solid rgba(226, 180, 72, 0.3);
    color: var(--pix-accent-2);
  }

  .img-btn:hover {
    background: rgba(226, 180, 72, 0.15);
    border-color: var(--pix-accent-2);
    box-shadow: 0 0 6px rgba(226, 180, 72, 0.25);
  }

  :global(.milkdown-crepe-editor) {
    width: 100%;
    min-height: 220px;
    background: #04060a !important;
    border: 1px solid var(--pix-border) !important;
    border-radius: 4px;
    color: #e0e0e0;
    overflow: hidden;
  }

  :global(.milkdown-crepe-editor.has-toolbar) {
    border-top: none !important;
    border-radius: 0 0 4px 4px !important;
  }

  :global(.milkdown-crepe-editor .milkdown) {
    padding: 10px 14px;
    min-height: 200px;
    font-family: var(--pix-font), system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    background: transparent !important;
    box-shadow: none !important;
  }

  :global(.milkdown-crepe-editor .milkdown .editor) {
    outline: none !important;
    color: #e0e0e0 !important;
    min-height: 180px;
  }

  :global(.milkdown-crepe-editor .crepe-block-handle) {
    background: #11141d !important;
    border: 1px solid var(--pix-border) !important;
    color: #fff !important;
  }

  /* ============ GORGEOUS DNA SEQUENCE CARD STYLING (Seq Editor Style) ============ */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card) {
    border: 1.5px solid var(--pix-cyan, #4cd6ff) !important;
    border-radius: 6px !important;
    padding: 12px 14px !important;
    background: #0b0f16 !important; /* Premium dark background */
    margin: 16px 0 !important;
    position: relative !important;
    box-shadow: 0 0 12px rgba(76, 214, 255, 0.15), inset 0 0 8px rgba(76, 214, 255, 0.05) !important;
    transition: all 0.2s ease-in-out !important;
  }

  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card:hover) {
    border-color: #79e0ff !important;
    box-shadow: 0 0 16px rgba(76, 214, 255, 0.25), inset 0 0 12px rgba(76, 214, 255, 0.08) !important;
  }

  /* Custom header line mimicking sequence editor */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card::before) {
    content: "🧬 DNA SEQUENCE CARD — ACTIVE WORKSPACE VIEW" !important;
    display: block !important;
    font-weight: 800 !important;
    color: var(--pix-cyan, #4cd6ff) !important;
    font-size: 9.5px !important;
    margin-bottom: 8px !important;
    border-bottom: 1px solid rgba(76, 214, 255, 0.15) !important;
    padding-bottom: 6px !important;
    font-family: var(--pix-font), monospace !important;
    letter-spacing: 0.8px !important;
    text-transform: uppercase !important;
  }

  /* Style the inner CodeMirror editor container */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card .cm-editor) {
    background: #000000 !important; /* Pure black sequence frame */
    border: 1.5px solid rgba(76, 214, 255, 0.1) !important;
    border-radius: 4px !important;
    padding: 6px 8px !important;
    box-shadow: inset 0 0 6px rgba(0,0,0,0.6) !important;
  }

  /* Style CodeMirror content (gacgtc...) */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card .cm-content) {
    font-family: 'Fira Code', 'Consolas', 'Courier New', monospace !important;
    font-size: 11px !important;
    color: #a5d6ff !important; /* Soft blue nucleotide color */
    letter-spacing: 2px !important; /* Spaced nucleotides */
    line-height: 1.55 !important;
    font-weight: bold !important;
  }

  /* Style CodeMirror line numbers/gutter */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card .cm-gutters) {
    background: #000000 !important;
    border-right: 1px solid rgba(76, 214, 255, 0.1) !important;
    color: rgba(76, 214, 255, 0.45) !important;
    font-family: monospace !important;
    font-size: 10px !important;
    font-weight: bold !important;
    padding-right: 6px !important;
  }

  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.dna-editor-card .cm-activeLineGutter) {
    background: rgba(76, 214, 255, 0.1) !important;
    color: #4cd6ff !important;
  }

  /* ============ GORGEOUS PROTEIN SEQUENCE CARD STYLING (Seq Editor Style) ============ */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card) {
    border: 1.5px solid var(--pix-accent, #a64cff) !important;
    border-radius: 6px !important;
    padding: 12px 14px !important;
    background: #0f0b16 !important; /* Premium deep violet-dark background */
    margin: 16px 0 !important;
    position: relative !important;
    box-shadow: 0 0 12px rgba(166, 76, 255, 0.15), inset 0 0 8px rgba(166, 76, 255, 0.05) !important;
    transition: all 0.2s ease-in-out !important;
  }

  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card:hover) {
    border-color: #be82ff !important;
    box-shadow: 0 0 16px rgba(166, 76, 255, 0.25), inset 0 0 12px rgba(166, 76, 255, 0.08) !important;
  }

  /* Custom header line mimicking protein sequence card */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card::before) {
    content: "🧪 PROTEIN SEQUENCE CARD — TRANSLATED VIEW" !important;
    display: block !important;
    font-weight: 800 !important;
    color: var(--pix-accent, #a64cff) !important;
    font-size: 9.5px !important;
    margin-bottom: 8px !important;
    border-bottom: 1px solid rgba(166, 76, 255, 0.15) !important;
    padding-bottom: 6px !important;
    font-family: var(--pix-font), monospace !important;
    letter-spacing: 0.8px !important;
    text-transform: uppercase !important;
  }

  /* Style the inner CodeMirror editor container for protein */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card .cm-editor) {
    background: #000000 !important; /* Pure black sequence frame */
    border: 1.5px solid rgba(166, 76, 255, 0.1) !important;
    border-radius: 4px !important;
    padding: 6px 8px !important;
    box-shadow: inset 0 0 6px rgba(0,0,0,0.6) !important;
  }

  /* Style CodeMirror content (amino acids) */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card .cm-content) {
    font-family: 'Fira Code', 'Consolas', 'Courier New', monospace !important;
    font-size: 11px !important;
    color: #e0b0ff !important; /* Soft purple amino acid color */
    letter-spacing: 2px !important; /* Spaced amino acids */
    line-height: 1.55 !important;
    font-weight: bold !important;
  }

  /* Style CodeMirror line numbers/gutter for protein */
  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card .cm-gutters) {
    background: #000000 !important;
    border-right: 1px solid rgba(166, 76, 255, 0.1) !important;
    color: rgba(166, 76, 255, 0.45) !important;
    font-family: monospace !important;
    font-size: 10px !important;
    font-weight: bold !important;
    padding-right: 6px !important;
  }

  :global(.milkdown-crepe-editor .milkdown .milkdown-code-block.protein-editor-card .cm-activeLineGutter) {
    background: rgba(166, 76, 255, 0.1) !important;
    color: #a64cff !important;
  }
</style>
