<script lang="ts">
  // SPICE Welcome / Launchpad (VS Code-style Welcome Page)
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { backend } from '$lib/backend/api';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { currentLocale } from '$lib/i18n.svelte.ts';
  import {
    FlaskConical,
    Dna,
    Settings,
    Atom,
    ChevronRight,
    Folder
  } from 'lucide-svelte';

  // Track system or model status on welcome page
  let isBackendConnected = $state(false);
  let backendLatency = $state<number | null>(null);

  onMount(() => {
    aiState.currentWorkspace = 'general';
    
    // Quick ping to check connection
    const start = Date.now();
    backend.modelStatus().then(() => {
      isBackendConnected = true;
      backendLatency = Date.now() - start;
    }).catch(() => {
      isBackendConnected = false;
    });
  });
</script>

<div class="welcome-container" style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; overflow-y: auto; background: var(--pix-bg); padding: 32px; box-sizing: border-box; font-family: var(--pix-font); gap: 24px;">
  
  <!-- ============ HEADER SECTION ============ -->
  <header class="welcome-header pix-panel" style="padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; border-color: var(--pix-border-hi); position: relative; overflow: hidden; background: linear-gradient(135deg, var(--pix-panel) 80%, rgba(255, 159, 28, 0.03));">
    <div class="decor-corner top-left"></div>
    <div class="decor-corner top-right"></div>
    
    <div style="display: flex; align-items: center; gap: 20px;">
      <div class="logo-box" style="width: 48px; height: 48px; background: var(--pix-bg-3); border: 2px solid var(--pix-accent); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px rgba(255, 159, 28, 0.25); animation: pulse-glow 3s infinite alternate;">
        <Atom size={26} style="color: var(--pix-accent);" />
      </div>
      <div>
        <h1 style="margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 3px; color: var(--pix-accent-2); text-shadow: 2px 2px 0 #000; font-family: var(--pix-font);">
          {m.welcomeTitle()}
        </h1>
        <p style="margin: 4px 0 0 0; font-size: 11px; letter-spacing: 0.5px; color: var(--pix-fg-dim); font-weight: bold; font-family: var(--pix-font);">
          {m.welcomeSubtitle()}
        </p>
      </div>
    </div>
    
    <div style="display: flex; align-items: center; gap: 16px; background: var(--pix-bg-3); padding: 6px 12px; border: 2px solid var(--pix-border); font-size: 11px;">
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <span class="pix-led {isBackendConnected ? 'ok' : 'busy'}"></span>
        <span style="color: var(--pix-fg-dim);">{m.welcomeEngineLabel()}</span>
        <span style="font-weight: bold; color: {isBackendConnected ? 'var(--pix-green)' : 'var(--pix-accent)'};">
          {isBackendConnected ? `ONLINE (${backendLatency}ms)` : 'CONNECTING'}
        </span>
      </span>
    </div>
  </header>

  <p style="margin: 0; font-size: 13px; font-weight: bold; letter-spacing: 1px; text-align: center; color: var(--pix-fg); font-family: var(--pix-font);">{m.welcomeDesc()}</p>

  <!-- ============ WORKSPACE GRID ============ -->
  <div class="welcome-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; width: 100%;">
    
    <!-- Protein Folding Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="launch-card pix-panel" style="padding: 24px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; transition: all 0.2s ease; border-width: 2px; position: relative;" onclick={() => goto('/protein')}>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card-icon" style="background: rgba(255, 159, 28, 0.08); border: 2px solid var(--pix-accent); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--pix-accent);">
          <FlaskConical size={24} />
        </div>
        <div>
          <h3 style="margin: 0; font-size: 15px; color: var(--pix-accent); font-weight: bold;">{m.tabProtein()}</h3>
          <p style="margin: 8px 0 0 0; font-size: 11.5px; color: var(--pix-fg-dim); line-height: 1.6;">
            {m.welcomeOpenProtein()}
          </p>
        </div>
      </div>
      
      <div class="action-btn" style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px dashed var(--pix-border); font-size: 11px; font-weight: bold; color: var(--pix-accent);">
        <span>{m.welcomeLaunchWorkspace()}</span>
        <ChevronRight size={14} />
      </div>
    </div>
    
    <!-- Gene Editing Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="launch-card pix-panel cyan-card" style="padding: 24px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; transition: all 0.2s ease; border-width: 2px; position: relative;" onclick={() => goto('/gene')}>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card-icon" style="background: rgba(76, 214, 255, 0.08); border: 2px solid var(--pix-cyan); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--pix-cyan);">
          <Dna size={24} />
        </div>
        <div>
          <h3 style="margin: 0; font-size: 15px; color: var(--pix-cyan); font-weight: bold;">{m.tabGene()}</h3>
          <p style="margin: 8px 0 0 0; font-size: 11.5px; color: var(--pix-fg-dim); line-height: 1.6;">
            {m.welcomeOpenGene()}
          </p>
        </div>
      </div>
      
      <div class="action-btn-cyan" style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px dashed var(--pix-border); font-size: 11px; font-weight: bold; color: var(--pix-cyan);">
        <span>{m.welcomeLaunchWorkspace()}</span>
        <ChevronRight size={14} />
      </div>
    </div>
    
    <!-- Project Hub Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="launch-card pix-panel green-card" style="padding: 24px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; transition: all 0.2s ease; border-width: 2px; position: relative;" onclick={() => goto('/project')}>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card-icon" style="background: rgba(107, 231, 122, 0.08); border: 2px solid var(--pix-green); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--pix-green);">
          <Folder size={24} />
        </div>
        <div>
          <h3 style="margin: 0; font-size: 15px; color: var(--pix-green); font-weight: bold;">{m.tabProject()}</h3>
          <p style="margin: 8px 0 0 0; font-size: 11.5px; color: var(--pix-fg-dim); line-height: 1.6;">
            {m.welcomeOpenProject()}
          </p>
        </div>
      </div>

      <div class="action-btn-green" style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px dashed var(--pix-border); font-size: 11px; font-weight: bold; color: var(--pix-green);">
        <span>{m.welcomeOpenHub()}</span>
        <ChevronRight size={14} />
      </div>
    </div>

    <!-- System Settings Card -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="launch-card pix-panel purple-card" style="padding: 24px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; transition: all 0.2s ease; border-width: 2px; position: relative;" onclick={() => goto('/settings')}>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card-icon" style="background: rgba(180, 140, 255, 0.08); border: 2px solid var(--pix-purple); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--pix-purple);">
          <Settings size={22} />
        </div>
        <div>
          <h3 style="margin: 0; font-size: 15px; color: var(--pix-purple); font-weight: bold;">{m.appSettings()}</h3>
          <p style="margin: 8px 0 0 0; font-size: 11.5px; color: var(--pix-fg-dim); line-height: 1.6;">
            {m.welcomeOpenSettings()}
          </p>
        </div>
      </div>
      
      <div class="action-btn-purple" style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px dashed var(--pix-border); font-size: 11px; font-weight: bold; color: var(--pix-purple);">
        <span>{m.welcomeConfigurePrefs()}</span>
        <ChevronRight size={14} />
      </div>
    </div>
  </div>

</div>

<style>
  /* Local Styles for Welcome Layout */
  .welcome-container {
    image-rendering: pixelated;
  }
  
  .launch-card {
    background: var(--pix-panel);
    border-color: var(--pix-border);
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  
  .launch-card:hover {
    transform: translate(-2px, -2px);
    border-color: var(--pix-accent);
    box-shadow: 4px 4px 0 rgba(255, 159, 28, 0.25), 0 0 8px rgba(255, 159, 28, 0.15);
  }
  .launch-card:hover .action-btn {
    color: var(--pix-accent-2);
  }
  
  .launch-card.cyan-card:hover {
    border-color: var(--pix-cyan);
    box-shadow: 4px 4px 0 rgba(76, 214, 255, 0.25), 0 0 8px rgba(76, 214, 255, 0.15);
  }
  .launch-card.cyan-card:hover .action-btn-cyan {
    color: var(--pix-cyan);
    text-shadow: 0 0 4px rgba(76, 214, 255, 0.3);
  }
  
  .launch-card.green-card:hover {
    border-color: var(--pix-green);
    box-shadow: 4px 4px 0 rgba(107, 231, 122, 0.25), 0 0 8px rgba(107, 231, 122, 0.15);
  }
  .launch-card.green-card:hover .action-btn-green {
    color: var(--pix-green);
    text-shadow: 0 0 4px rgba(107, 231, 122, 0.3);
  }

  .launch-card.purple-card:hover {
    border-color: var(--pix-purple);
    box-shadow: 4px 4px 0 rgba(180, 140, 255, 0.25), 0 0 8px rgba(180, 140, 255, 0.15);
  }
  .launch-card.purple-card:hover .action-btn-purple {
    color: var(--pix-purple);
    text-shadow: 0 0 4px rgba(180, 140, 255, 0.3);
  }

  /* Decorative corners in pixel aesthetic */
  .decor-corner {
    position: absolute;
    width: 6px;
    height: 6px;
    border-color: var(--pix-accent-2);
    border-style: solid;
    pointer-events: none;
  }
  .decor-corner.top-left {
    top: 6px;
    left: 6px;
    border-width: 2px 0 0 2px;
  }
  .decor-corner.top-right {
    top: 6px;
    right: 6px;
    border-width: 2px 2px 0 0;
  }

  @keyframes pulse-glow {
    from {
      box-shadow: 0 0 10px rgba(255, 159, 28, 0.15);
    }
    to {
      box-shadow: 0 0 20px rgba(255, 159, 28, 0.45);
    }
  }
</style>