<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { toasts, dismissToast } from './toast.svelte.ts';
</script>

<div class="toaster">
  {#each toasts as t (t.id)}
    <div class="toast toast-{t.kind}" role="status">
      <div class="toast-title">{t.title}</div>
      {#if t.body}<div class="toast-body">{t.body}</div>{/if}
      <button class="toast-close pix-btn-reset" aria-label={m.close()} onclick={() => dismissToast(t.id)}>✕</button>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 340px;
  }
  .toast {
    position: relative;
    padding: 8px 30px 8px 10px;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg-2);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.5);
    border-left-width: 6px;
  }
  .toast-info { border-left-color: var(--pix-cyan); }
  .toast-success { border-left-color: var(--pix-green); }
  .toast-warn { border-left-color: var(--pix-accent); }
  .toast-error { border-left-color: var(--pix-red); }
  .toast-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; color: var(--pix-fg); }
  .toast-body { font-size: 11px; color: var(--pix-fg-dim); margin-top: 2px; }
  .toast-close { position: absolute; top: 4px; right: 4px; padding: 0 5px; font-size: 10px; }
</style>
