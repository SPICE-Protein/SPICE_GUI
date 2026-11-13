<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  let {
    visible = false,
    onKeyPress = () => {},
    onClose = () => {}
  } = $props<{
    visible: boolean;
    onKeyPress: (key: string) => void;
    onClose: () => void;
  }>();

  const bases = ['A', 'T', 'C', 'G'] as const;
  const baseColors: Record<string, { bg: string; fg: string }> = {
    A: { bg: '#10b98122', fg: '#10b981' },
    T: { bg: '#ef444422', fg: '#ef4444' },
    C: { bg: '#3b82f622', fg: '#3b82f6' },
    G: { bg: '#eab30822', fg: '#eab308' }
  };
</script>

{#if visible}
  <div class="virtual-dna-keyboard">
    <span class="pix-dim vk-label">DNA KEYBOARD:</span>

    <!-- Base buttons with biological color-coding -->
    {#each bases as base}
      <button
        type="button"
        class="pix-btn-reset virtual-key vk-base"
        onclick={() => onKeyPress(base)}
        style="background: {baseColors[base].bg}; color: {baseColors[base].fg};"
      >
        {base}
      </button>
    {/each}

    <div class="vk-divider"></div>

    <button
      type="button"
      class="pix-btn-reset virtual-key vk-action"
      onclick={() => onKeyPress('Backspace')}
      title={m.backspace()}
    >
      ⌫
    </button>

    <button
      type="button"
      class="pix-btn-reset virtual-key vk-action vk-del"
      onclick={() => onKeyPress('Delete')}
      title={m.delete()}
    >
      DEL
    </button>

    <button
      type="button"
      class="pix-btn-reset virtual-key vk-close"
      onclick={onClose}
      title={m.closeKeyboard()}
    >
      ✖
    </button>
  </div>
{/if}

<style>
  .virtual-dna-keyboard {
    position: absolute;
    bottom: 42px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 12px);
    box-sizing: border-box;
    overflow-x: auto;
    background: rgba(12, 16, 26, 0.95);
    border: 1.5px solid var(--pix-border);
    border-radius: 6px;
    padding: 6px 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
    z-index: 1000;
    user-select: none;
  }
  .vk-label {
    font-size: 8.5px;
    font-weight: bold;
    margin-right: 4px;
    color: var(--pix-accent-2);
    letter-spacing: 0.5px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .vk-divider {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 2px;
    flex: 0 0 auto;
  }
  .virtual-key {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border-radius: 4px;
    border: 1px solid var(--pix-border);
    cursor: pointer;
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
  .vk-base {
    width: 32px;
    height: 32px;
    font-weight: bold;
    font-size: 13px;
  }
  .vk-action {
    width: 36px;
    height: 32px;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.03);
    color: #fff;
  }
  .vk-del {
    font-size: 9px;
    font-weight: bold;
  }
  .vk-close {
    width: 32px;
    height: 32px;
    font-size: 11px;
    background: rgba(239, 68, 68, 0.1);
    color: var(--pix-red);
  }

  /* The sequence pane can be narrow when a side panel is open. Drop the label
     and tighten the keys so the whole keyboard still fits on one row. */
  @media (max-width: 1200px) {
    .virtual-dna-keyboard {
      gap: 4px;
      padding: 5px 7px;
    }
    .vk-label {
      display: none;
    }
    .vk-base,
    .vk-close {
      width: 28px;
      height: 28px;
    }
    .vk-action {
      width: 32px;
      height: 28px;
    }
  }
</style>
