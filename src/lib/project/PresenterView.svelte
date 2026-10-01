<script lang="ts">
  // iA-Presenter-flavored presentation overlay for one journal page.
  // Audience view: the slide only. Presenter view (P): current slide +
  // next-slide preview + speaker notes (blockquote text) + timer + counter.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { parseSlides, type Slide } from './slides';
  import type { ProjectJournalPage } from './types';
  import { X, MonitorSmartphone, Presentation, Maximize } from 'lucide-svelte';

  let { page, onClose = () => {} } = $props<{
    page: ProjectJournalPage;
    onClose?: () => void;
  }>();

  let slides = $derived(parseSlides(page.markdownContent));
  let idx = $state(0);
  let presenter = $state(false);
  let elapsed = $state(0);
  let container = $state<HTMLDivElement | undefined>();

  const cur = $derived(slides[Math.min(idx, Math.max(0, slides.length - 1))]);
  const next = $derived(slides[Math.min(idx + 1, slides.length - 1)]);

  // iA-Presenter-style narrative progression: the title hue shifts across the
  // talk — cyan (cold start) → purple (warming) → red (hot) → orange → gold.
  const PROG_STOPS: [number, number, number][] = [
    [76, 214, 255],
    [166, 76, 255],
    [255, 93, 93],
    [255, 159, 28],
    [226, 180, 72]
  ];
  function progColor(t: number): string {
    const x = Math.max(0, Math.min(1, t)) * (PROG_STOPS.length - 1);
    const i = Math.min(PROG_STOPS.length - 2, Math.floor(x));
    const f = x - i;
    const a = PROG_STOPS[i];
    const b = PROG_STOPS[i + 1];
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  const titleColor = $derived(
    slides.length > 1 ? progColor(idx / (slides.length - 1)) : 'var(--pix-cyan)'
  );

  function go(delta: number) {
    idx = Math.max(0, Math.min(slides.length - 1, idx + delta));
  }

  function fmtTime(s: number): string {
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function toggleFullscreen() {
    const el = container;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        go(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        go(-1);
        break;
      case 'Home':
        idx = 0;
        break;
      case 'End':
        idx = slides.length - 1;
        break;
      case 'Escape':
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else onClose();
        break;
      case 'p':
      case 'P':
        presenter = !presenter;
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
    }
  }

  let timer = $state<ReturnType<typeof setInterval> | null>(null);
  onMount(() => {
    timer = setInterval(() => (elapsed += 1), 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="presenter-overlay" bind:this={container} onclick={(e) => { if (e.target === container) go(1); }}>
  {#if slides.length === 0}
    <div class="ps-empty">
      <Presentation size={40} />
      <div>{m.projectPresenterEmpty()}</div>
      <div class="ps-hint">{m.projectPresenterHint()}</div>
      <button class="pix-btn" onclick={onClose}>{m.projectPresenterExit()}</button>
    </div>
  {:else}
    <div class="ps-main" class:with-side={presenter}>
      <div class="ps-stage">
        <div class="ps-slide {cur.level === 0 ? 'lvl0' : cur.level === 1 ? 'lvl1' : 'lvl2'}">
          {#if cur.title}
            <h1 class="ps-title" style="color: {titleColor}; text-shadow: 0 0 18px currentColor;">{cur.title}</h1>
          {/if}
          <div class="ps-body">{@html cur.bodyHtml}</div>
        </div>
        <div class="ps-progress"><span style="width: {((idx + 1) / slides.length) * 100}%"></span></div>
      </div>

      {#if presenter}
        <aside class="ps-side">
          <div class="ps-side-row">
            <span class="ps-timer">{fmtTime(elapsed)}</span>
            <span class="ps-count">{idx + 1} / {slides.length}</span>
          </div>
          <div class="ps-side-label">{m.projectPresenterNext()}</div>
          <div class="ps-next {next?.level === 1 ? 'lvl1' : next?.level === 2 ? 'lvl2' : ''}">
            {#if next && idx < slides.length - 1}
              {#if next.title}<div class="ps-next-title">{next.title}</div>{/if}
              <div class="ps-next-body">{@html next.bodyHtml}</div>
            {:else}
              <div class="ps-dim">—</div>
            {/if}
          </div>
          <div class="ps-side-label">{m.projectPresenterNotes()}</div>
          <div class="ps-notes">
            {#if cur.notesHtml}
              {@html cur.notesHtml}
            {:else}
              <div class="ps-dim">—</div>
            {/if}
          </div>
        </aside>
      {/if}
    </div>

    <div class="ps-controls">
      <button class="pix-btn-reset" class:ps-on={presenter} onclick={() => (presenter = !presenter)} title="{m.projectPresenterNotes()} · P">
        <MonitorSmartphone size={14} />
      </button>
      <button class="pix-btn-reset" onclick={toggleFullscreen} title="F">
        <Maximize size={14} />
      </button>
      <button class="pix-btn-reset ps-exit" onclick={onClose} title="Esc">
        <X size={14} /> <span>{m.projectPresenterExit()}</span>
      </button>
      <span class="ps-nav-hint">← → · P · F · Esc</span>
    </div>
  {/if}
</div>

<style>
  .presenter-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: #0b0e14;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  .ps-main { flex: 1; display: flex; min-height: 0; }
  .ps-stage { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; padding: 6vh 8vw; min-width: 0; }
  .ps-slide { max-width: 100%; text-align: center; }
  .ps-slide.lvl2 { text-align: left; }
  .ps-title {
    margin: 0 0 24px 0;
    font-size: clamp(28px, 5.2vw, 60px);
    font-weight: 900;
    letter-spacing: 1px;
    line-height: 1.15;
  }
  .lvl1 .ps-title { color: var(--pix-cyan); text-shadow: 0 0 18px rgba(76, 214, 255, 0.25); }
  .lvl2 .ps-title { color: var(--pix-accent); }
  .lvl0 .ps-title { color: var(--pix-accent-2); }
  .ps-body { font-size: clamp(15px, 2vw, 24px); line-height: 1.7; color: var(--pix-fg); }

  /* rendered slide html (from {@html}) — needs :global to pierce scoping */
  .presenter-overlay :global(.sp-p) { margin: 0 0 0.8em 0; }
  .presenter-overlay :global(.sp-h3) { color: var(--pix-cyan); font-size: 1.2em; margin: 0 0 0.5em 0; }
  .presenter-overlay :global(.sp-list) { list-style: none; margin: 0 0 0.8em 0; padding-left: 1.2em; text-align: left; display: inline-block; }
  .presenter-overlay :global(.sp-list li::before) { content: '▸ '; color: var(--pix-accent); }
  .presenter-overlay :global(.sp-li-task::before) { content: none !important; }
  .presenter-overlay :global(.sp-pre) {
    background: var(--pix-bg-2); border: 2px solid var(--pix-border); padding: 10px 14px;
    text-align: left; overflow-x: auto; font-size: 0.8em; display: inline-block; max-width: 100%;
  }
  .presenter-overlay :global(.sp-table) { border-collapse: collapse; margin: 0 auto 0.8em auto; font-size: 0.9em; }
  .presenter-overlay :global(.sp-th), .presenter-overlay :global(th) { border-bottom: 2px solid var(--pix-border-hi); padding: 4px 12px; color: var(--pix-cyan); }
  .presenter-overlay :global(.sp-td), .presenter-overlay :global(td) { padding: 4px 12px; border-bottom: 1px dashed var(--pix-border); }
  .presenter-overlay :global(img) { max-width: min(72vw, 900px); max-height: 55vh; image-rendering: auto; }
  .presenter-overlay :global(sup), .presenter-overlay :global(sub) { font-size: 0.68em; }
  .presenter-overlay :global(.sp-list .sp-list) { margin: 0.1em 0 0 1em; }
  .presenter-overlay :global(.sp-task) { color: var(--pix-cyan); font-weight: 900; }
  .presenter-overlay :global(.sp-li-task) { list-style: none; }
  .presenter-overlay :global(.sp-li-task::before) { content: none; }
  .presenter-overlay :global(.sp-fnbox) {
    display: inline-block; max-width: 100%; text-align: left; margin-top: 1em; padding-top: 0.5em;
    border-top: 1px dashed var(--pix-border-hi); font-size: 0.6em; color: var(--pix-fg-dim); line-height: 1.6;
  }
  .presenter-overlay :global(.sp-fn) { margin: 0.15em 0; }
  .presenter-overlay :global(.sp-fnm) { color: var(--pix-accent-2); font-weight: 900; }
  .presenter-overlay :global(code) { background: var(--pix-bg-3); padding: 0 4px; }
  .presenter-overlay :global(a) { color: var(--pix-cyan); }
  .presenter-overlay :global(mark) { background: rgba(255, 210, 63, 0.35); color: inherit; }

  .ps-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--pix-bg-3); }
  .ps-progress span { display: block; height: 100%; background: var(--pix-cyan); transition: width 0.2s; }

  .ps-side {
    width: 340px; flex: 0 0 340px; border-left: 3px solid var(--pix-border);
    background: var(--pix-bg-2); display: flex; flex-direction: column; gap: 8px;
    padding: 12px; overflow: hidden; min-height: 0;
  }
  .ps-side-row { display: flex; justify-content: space-between; font-weight: bold; }
  .ps-timer { color: var(--pix-accent); }
  .ps-count { color: var(--pix-fg-dim); }
  .ps-side-label { font-size: 10px; letter-spacing: 1px; color: var(--pix-fg-dim); border-bottom: 1px dashed var(--pix-border); padding-bottom: 2px; }
  .ps-next { border: 2px solid var(--pix-border); background: var(--pix-bg-3); padding: 8px; height: 120px; overflow: hidden; font-size: 11px; }
  .ps-next-title { font-weight: 900; font-size: 13px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ps-next.lvl1 .ps-next-title { color: var(--pix-cyan); }
  .ps-next.lvl2 .ps-next-title { color: var(--pix-accent); }
  .ps-notes {
    flex: 1; overflow-y: auto; border: 2px solid var(--pix-border-hi); background: var(--pix-bg-3);
    padding: 10px; font-size: 13px; line-height: 1.7; color: var(--pix-fg);
  }
  .ps-notes :global(.sp-np) { margin: 0 0 0.7em 0; }
  .ps-dim { color: var(--pix-fg-dim); }

  .ps-controls {
    position: absolute; top: 10px; right: 12px; display: flex; align-items: center; gap: 8px;
    background: rgba(11, 14, 20, 0.72); border: 2px solid var(--pix-border); padding: 4px 8px;
  }
  .ps-controls button {
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
    border: 2px solid var(--pix-border); background: var(--pix-bg-3); color: var(--pix-fg-dim);
    padding: 2px 8px; font-family: var(--pix-font); font-size: 11px; font-weight: bold;
  }
  .ps-controls button:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }
  .ps-on { color: var(--pix-cyan) !important; border-color: var(--pix-cyan) !important; box-shadow: 0 0 6px rgba(76, 214, 255, 0.4); }
  .ps-exit:hover { color: var(--pix-red) !important; border-color: var(--pix-red) !important; }
  .ps-nav-hint { font-size: 9px; color: var(--pix-fg-dim); letter-spacing: 1px; }

  .ps-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; color: var(--pix-fg-dim); text-align: center; padding: 24px;
  }
  .ps-hint { font-size: 11px; max-width: 480px; line-height: 1.7; color: var(--pix-fg-dim); }
</style>
