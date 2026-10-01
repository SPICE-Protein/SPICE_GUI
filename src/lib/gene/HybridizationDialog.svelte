<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { pushToast } from '$lib/ui/toast.svelte.ts';

  let {
    show = $bindable(false),
    minBindingBases = $bindable(10),
    requireTm = $bindable(40)
  } = $props<{
    show: boolean;
    minBindingBases: number;
    requireTm: number;
  }>();
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={() => show = false} style="position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 999; backdrop-filter: blur(2px);">
    <div class="modal-box pix-panel" onclick={(e) => e.stopPropagation()} style="background: #0b0f19; border: 3px solid var(--pix-border); padding: 14px; width: 440px; border-radius: 4px; box-shadow: 0 0 20px #000; font-family: var(--pix-font);">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 6px; margin-bottom: 10px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 11px;">{m.hybridizationParameters()}</span>
        <button class="pix-btn-reset" onclick={() => show = false} style="font-size: 11px; font-weight: bold; color: var(--pix-red); cursor: pointer;">[{m.close()} X]</button>
      </div>

      <div style="font-size: 10px; color: var(--pix-fg-dim); line-height: 1.3; margin-bottom: 12px;">
        Hybridization parameters control how many binding sites are displayed on the multi-track viewer.
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 10.5px;">
        <!-- Base match rule -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="pix-dim">{m.minPrimer3BindingBases()}</span>
          <div style="display: flex; align-items: center; gap: 4px;">
            <input class="pix-input" type="number" bind:value={minBindingBases} style="width: 50px; padding: 2px; font-family: monospace;" />
            <span class="pix-dim">bp</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="checkbox" checked id="isolated-mismatch" style="cursor: pointer;" />
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label for="isolated-mismatch" style="cursor: pointer; font-size: 9.5px;" class="pix-dim">{m.allowASingleIsolatedMismatch()}</label>
        </div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 4px 0;"></div>

        <!-- Tm requirement -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="pix-dim">{m.requiredPrimerAnnealingTmAtLeast()}</span>
          <div style="display: flex; align-items: center; gap: 4px;">
            <input class="pix-input" type="number" bind:value={requireTm} style="width: 50px; padding: 2px; font-family: monospace;" />
            <span class="pix-dim">°C</span>
          </div>
        </div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.05); margin: 4px 0;"></div>

        <div style="display: flex; gap: 6px; align-items: flex-start;">
          <input type="checkbox" checked id="additional-match" style="cursor: pointer; margin-top: 2px;" />
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label for="additional-match" style="cursor: pointer; font-size: 9.5px; line-height: 1.2;" class="pix-dim">
            {m.enzymeMismatchHint()} <input class="pix-input" type="number" value="15" style="width: 32px; padding: 0 2px; font-family: monospace; display: inline; height: 16px;" /> {m.bases()}
          </label>
        </div>
      </div>

      <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; border-top: 1px solid var(--pix-border); padding-top: 8px;">
        <button class="pix-btn ok" onclick={() => { show = false; pushToast('success', m.hybridizationSettingsUpdated(), `Tm: ${requireTm}°C`); }} style="padding: 2px 10px; font-size: 10px; cursor: pointer;">OK</button>
        <button class="pix-btn" onclick={() => show = false} style="padding: 2px 10px; font-size: 10px; color: var(--pix-fg-dim); cursor: pointer;">{m.cancel()}</button>
      </div>
    </div>
  </div>
{/if}
