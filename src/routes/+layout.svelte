<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { backend, isTauri } from '$lib/backend/api';
  import type { DownloadProgress, ModelStatus } from '$lib/backend/types';
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale, toggleLang } from '$lib/i18n.svelte.ts';
  import { initMultistyleUI, Card, Divider, Button, ProgressBar, Toggle } from 'svelte-multistyle-ui';
  import { Settings, X, RefreshCw, RotateCcw, FlaskConical, Dna, Sparkles, Home, Folder } from 'lucide-svelte';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import AiCopilot from '$lib/ui/AiCopilot.svelte';
  import 'svelte-multistyle-ui/theme.css';
  import '../lib/app.css';

  const ui = { style: 'pixel', theme: 'midnight' } as const;

  // Global settings state
  let theme = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_theme')) || 'midnight');
  let mode = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_mode')) || 'dark');
  let modelStatus = $state<ModelStatus | null>(null);

  let { children } = $props();

  function applyTheme() {
    initMultistyleUI({ style: 'pixel', theme, mode });
    const dark =
      mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
  }

  $effect(() => {
    applyTheme();
  });

  // The Tauri window mirrors document.title, so the native title bar stays
  // localized when the language toggles. Brand prefix "SPICE" never translates.
  $effect(() => {
    const _loc = currentLocale.value;
    if (typeof document !== 'undefined') {
      document.title = `SPICE · ${m.windowTagline()}`;
    }
  });

  onMount(() => {
    applyTheme();
    document.body.classList.add('spice-app');

    // Try to lock the screen to landscape on devices that allow it (mobile / PWA / Tauri WebView)
    try {
      const optScreen = screen as any;
      if (optScreen.orientation && typeof optScreen.orientation.lock === 'function') {
        optScreen.orientation.lock('landscape').catch(() => {
          // Some browsers, or when not in fullscreen, reject this; swallow it silently
        });
      }
    } catch (e) {
      /* ignore orientation-lock failures */
    }
  });

  // Derive current route/page ID
  const pageId = $derived(
    $page.url.pathname === '/gene'
      ? 'gene'
      : $page.url.pathname === '/protein'
        ? 'protein'
        : $page.url.pathname === '/project'
          ? 'project'
          : $page.url.pathname === '/'
            ? 'welcome'
            : 'settings'
  );
</script>

<!-- Orientation Shield (portrait-mode rotate prompt) -->
<div class="orientation-shield">
  <div class="shield-box pix-panel">
    <div class="shield-icon">
      <RotateCcw size={48} class="rotate-animation" />
    </div>
    <h2 class="pix-title" style="margin: 12px 0; font-size: 15px; color: var(--pix-accent-2);">{m.orientationShieldTitle()}</h2>
    <p class="pix-dim" style="font-size: 11px; line-height: 1.6; margin-bottom: 16px; text-align: center; font-family: var(--pix-font);">
      {m.orientationShieldBody()}
    </p>
    <div class="shield-instruction">
      <span class="pix-led busy" style="width: 8px; height: 8px;"></span>
      <span style="font-size: 11px; font-weight: bold; color: var(--pix-accent);">{m.orientationShieldHint()}</span>
    </div>
  </div>
</div>

<main class="workbench">
  <!-- ============ TOP BAR (navigation) ============ -->
  <header class="topbar">
    <div class="brand" style="cursor: pointer;" onclick={() => goto('/')}>
      <img class="brand-logo" src="/spice-logo.png" alt="SPICE" onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span class="brand-name">SPICE</span>
    </div>
    
    <!-- Top-bar navigation across the workstations -->
    <div class="workspace-switcher" style="display: flex; gap: 8px; align-items: center;">
      <button 
        class="pix-btn-reset {pageId === 'welcome' ? 'active-ws' : ''}" 
        style="padding: 4px 12px; font-weight: bold; border-color: {pageId === 'welcome' ? 'var(--pix-accent-2)' : 'var(--pix-border)'}; background: {pageId === 'welcome' ? 'var(--pix-bg-2)' : 'var(--pix-bg-3)'}; color: {pageId === 'welcome' ? 'var(--pix-accent-2)' : 'var(--pix-fg-dim)'}; cursor: pointer; display: flex; align-items: center; justify-content: center;"
        onclick={() => goto('/')}
        title={m.navHomeTooltip()}
      >
        <Home size={14} />
      </button>
      <button 
        class="pix-btn-reset {pageId === 'gene' ? 'active-ws' : ''}" 
        style="padding: 4px 16px; font-weight: bold; border-color: {pageId === 'gene' ? 'var(--pix-cyan)' : 'var(--pix-border)'}; background: {pageId === 'gene' ? 'var(--pix-bg-2)' : 'var(--pix-bg-3)'}; color: {pageId === 'gene' ? 'var(--pix-cyan)' : 'var(--pix-fg-dim)'}; cursor: pointer;"
        onclick={() => goto('/gene')}
      >
        {m.tabGene()}
      </button>
      <button 
        class="pix-btn-reset {pageId === 'protein' ? 'active-ws' : ''}" 
        style="padding: 4px 16px; font-weight: bold; border-color: {pageId === 'protein' ? 'var(--pix-accent)' : 'var(--pix-border)'}; background: {pageId === 'protein' ? 'var(--pix-bg-2)' : 'var(--pix-bg-3)'}; color: {pageId === 'protein' ? 'var(--pix-accent)' : 'var(--pix-fg-dim)'}; cursor: pointer;"
        onclick={() => goto('/protein')}
      >
        {m.tabProtein()}
      </button>
      <button
        class="pix-btn-reset {pageId === 'project' ? 'active-ws' : ''}"
        style="padding: 4px 16px; font-weight: bold; border-color: {pageId === 'project' ? 'var(--pix-green)' : 'var(--pix-border)'}; background: {pageId === 'project' ? 'var(--pix-bg-2)' : 'var(--pix-bg-3)'}; color: {pageId === 'project' ? 'var(--pix-green)' : 'var(--pix-fg-dim)'}; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
        onclick={() => goto('/project')}
      >
        <Folder size={12} /> {m.tabProject()}
      </button>

    </div>

    <div class="top-status">
      <!-- AI Co-Pilot Toggle -->
      <button 
        class="pix-btn-reset ai-toggle-btn {aiState.isOpen ? 'ai-active' : ''}" 
        onclick={() => aiState.toggle()} 
        title={m.aiCopilotTooltip()}
        style="cursor: pointer; padding: 4px 10px; border-color: {aiState.isOpen ? 'var(--pix-accent)' : 'var(--pix-border)'}; background: {aiState.isOpen ? 'var(--pix-bg-2)' : 'var(--pix-bg-3)'}; color: {aiState.isOpen ? 'var(--pix-accent)' : 'var(--pix-fg-dim)'}; display: inline-flex; align-items: center; gap: 4px; font-weight: bold; border-width: 2px; border-style: solid; box-shadow: {aiState.isOpen ? '0 0 6px var(--pix-accent)' : 'none'};"
      >
        <Sparkles size={14} class={aiState.isOpen ? 'glow-icon' : ''} />
        AI Co-Pilot
      </button>

      <button class="pix-btn-reset" onclick={() => goto('/settings')} style="cursor: pointer;"><Settings size={14} /> {m.appSettings()}</button>
    </div>
  </header>

  <!-- SvelteKit page slot + AI sidebar container -->
  <div class="workspace-body" style="flex: 1; display: flex; flex-direction: row; min-height: 0; min-width: 0; overflow: hidden; position: relative;">
    <div style="flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; position: relative;">
      {@render children()}
    </div>
    <AiCopilot />
  </div>
</main>

<style>
  .workbench { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .topbar {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; background: var(--pix-bg-2);
    border-bottom: 3px solid var(--pix-border);
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.4);
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-logo { height: 22px; width: 22px; object-fit: contain; image-rendering: auto; }
  .brand-name { font-weight: 900; letter-spacing: 3px; color: var(--pix-accent-2); text-shadow: 2px 2px 0 #000; font-size: 16px; }
  .top-status { display: flex; align-items: center; gap: 8px; }
  .top-status .pix-btn-reset, .settings-row .pix-btn-reset { display: inline-flex; align-items: center; gap: 4px; }

  .workspace-switcher :global(.active-ws) {
    border-style: solid;
    border-width: 2px;
    box-shadow: 0 0 8px currentColor;
  }

  .glow-icon {
    filter: drop-shadow(0 0 3px var(--pix-accent));
    animation: pulse-glow 2s infinite alternate;
  }

  @keyframes pulse-glow {
    from { opacity: 0.8; }
    to { opacity: 1; }
  }

  /* Blocking overlay and animation shown in portrait */
  .orientation-shield {
    display: none;
    position: fixed;
    inset: 0;
    background: #0b0e14;
    z-index: 10000;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    font-family: var(--pix-font);
  }

  @media screen and (orientation: portrait) {
    .orientation-shield {
      display: flex;
    }
    :global(.workbench) {
      display: none !important;
    }
  }

  .shield-box {
    max-width: 320px;
    width: 100%;
    text-align: center;
    padding: 24px 16px;
    background: var(--pix-panel);
    border: 3px solid var(--pix-border);
    box-shadow: 0px 0px 0px 4px #000, 6px 6px 0px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .shield-icon {
    color: var(--pix-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }

  .shield-instruction {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--pix-bg-2);
    border: 1px dashed var(--pix-border-hi);
    padding: 8px;
    color: var(--pix-fg);
  }

  :global(.rotate-animation) {
    animation: spin-and-rotate 2s infinite ease-in-out;
  }

  @keyframes spin-and-rotate {
    0% { transform: rotate(0deg); }
    20% { transform: rotate(0deg); }
    60% { transform: rotate(-90deg); }
    100% { transform: rotate(-90deg); }
  }
</style>