<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { Hand, Pencil } from 'lucide-svelte';

  let {
    visible = false,
    onKeyPress = () => {},
    onClose = () => {}
  } = $props<{
    visible: boolean;
    onKeyPress: (key: string) => void;
    onClose: () => void;
  }>();
</script>

{#if visible}
  <div class="virtual-dna-keyboard" style="position: absolute; bottom: 42px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; background: rgba(12, 16, 26, 0.95); border: 1.5px solid var(--pix-border); border-radius: 6px; padding: 6px 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.9); z-index: 1000; align-items: center; user-select: none;">
    <span class="pix-dim" style="font-size: 8.5px; font-weight: bold; margin-right: 4px; color: var(--pix-accent-2); letter-spacing: 0.5px;">DNA KEYBOARD:</span>
    
    <!-- Base buttons with biological color-coding -->
    {#each ['A', 'T', 'C', 'G'] as base}
      <button 
        class="pix-btn-reset virtual-key" 
        onclick={() => onKeyPress(base)}
        style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px; border-radius: 4px; border: 1px solid var(--pix-border); cursor: pointer; transition: all 0.1s; background: {base === 'A' ? '#10b98122' : base === 'T' ? '#ef444422' : base === 'C' ? '#3b82f622' : '#eab30822'}; color: {base === 'A' ? '#10b981' : base === 'T' ? '#ef4444' : base === 'C' ? '#3b82f6' : '#eab308'};"
      >
        {base}
      </button>
    {/each}
    
    <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.15); margin: 0 2px;"></div>

    <!-- Backspace key -->
    <button 
      class="pix-btn-reset virtual-key" 
      onclick={() => onKeyPress('Backspace')}
      title={m.backspace()}
      style="width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 13px; border-radius: 4px; border: 1px solid var(--pix-border); background: rgba(255,255,255,0.03); color: #fff; cursor: pointer;"
    >
      ⌫
    </button>

    <!-- Delete key -->
    <button 
      class="pix-btn-reset virtual-key" 
      onclick={() => onKeyPress('Delete')}
      title={m.delete()}
      style="width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 9px; border-radius: 4px; border: 1px solid var(--pix-border); background: rgba(255,255,255,0.03); color: #fff; cursor: pointer; font-weight: bold;"
    >
      DEL
    </button>

    <!-- Close button -->
    <button 
      class="pix-btn-reset virtual-key" 
      onclick={onClose}
      title={m.closeKeyboard()}
      style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 11px; border-radius: 4px; border: 1px solid var(--pix-red); background: rgba(239, 68, 68, 0.1); color: var(--pix-red); cursor: pointer;"
    >
      ✖
    </button>
  </div>
{/if}

<style>
  .virtual-key {
    transition: all 0.1s ease;
  }
  .virtual-key:hover {
    transform: scale(1.08);
    filter: brightness(1.2);
  }
  .virtual-key:active {
    transform: scale(0.95);
    filter: brightness(0.9);
  }
</style>
