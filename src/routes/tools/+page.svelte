<script lang="ts">
  // Tools hub: a card per bench utility, each opening its own sub-page.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages.js';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { ScanLine, ChevronRight, Wrench, Activity, BarChart3, Grid3X3, Microscope, ImagePlus, GitBranch } from 'lucide-svelte';

  onMount(() => {
    aiState.currentWorkspace = 'general';
  });

  const tools = $derived([
    {
      id: 'gel',
      title: m.toolsGelTitle(),
      desc: m.toolsGelDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-cyan)',
      bg: 'rgba(76, 214, 255, 0.08)',
      href: '/tools/gel',
      icon: ScanLine,
    },
    {
      id: 'blot',
      title: m.toolsBlotTitle(),
      desc: m.toolsBlotDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-green)',
      bg: 'rgba(89, 255, 141, 0.08)',
      href: '/tools/blot',
      icon: Activity,
    },
    {
      id: 'qpcr',
      title: m.toolsQpcrTitle(),
      desc: m.toolsQpcrDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-accent)',
      bg: 'rgba(255, 122, 89, 0.08)',
      href: '/tools/qpcr',
      icon: BarChart3,
    },
    {
      id: 'plate',
      title: m.toolsPlateTitle(),
      desc: m.toolsPlateDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-accent-2)',
      bg: 'rgba(226, 180, 72, 0.08)',
      href: '/tools/plate',
      icon: Grid3X3,
    },
    {
      id: 'colony',
      title: m.toolsColonyTitle(),
      desc: m.toolsColonyDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-cyan)',
      bg: 'rgba(76, 214, 255, 0.08)',
      href: '/tools/colony',
      icon: Microscope,
    },
    {
      id: 'annotate',
      title: m.toolsAnnotateTitle(),
      desc: m.toolsAnnotateDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-green)',
      bg: 'rgba(89, 255, 141, 0.08)',
      href: '/tools/annotate',
      icon: ImagePlus,
    },
    {
      id: 'tree',
      title: m.toolsTreeTitle(),
      desc: m.toolsTreeDesc(),
      action: m.toolsOpen(),
      color: 'var(--pix-accent)',
      bg: 'rgba(255, 122, 89, 0.08)',
      href: '/tools/tree',
      icon: GitBranch,
    },
  ]);
</script>

<div class="tools-page">
  <header class="tools-header pix-panel">
    <div class="tools-title">
      <div class="tools-icon"><Wrench size={22} /></div>
      <div>
        <h1>{m.toolsTitle()}</h1>
        <p>{m.toolsSubtitle()}</p>
      </div>
    </div>
  </header>

  <div class="tools-grid">
    {#each tools as tool (tool.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tool-card pix-panel" onclick={() => goto(tool.href)}>
        <div class="tool-icon" style="background: {tool.bg}; border-color: {tool.color}; color: {tool.color};">
          <tool.icon size={24} />
        </div>
        <div class="tool-copy">
          <h3 style="color: {tool.color};">{tool.title}</h3>
          <p>{tool.desc}</p>
        </div>
        <div class="tool-action" style="color: {tool.color}; border-top: 1px dashed var(--pix-border);">
          <span>{tool.action}</span>
          <ChevronRight size={14} />
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .tools-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    overflow-y: auto;
    font-family: var(--pix-font);
    background: var(--pix-bg);
  }
  .tools-header {
    padding: 18px 22px;
    border-width: 2px;
    border-color: var(--pix-border-hi);
  }
  .tools-title { display: flex; align-items: center; gap: 16px; }
  .tools-icon {
    width: 46px; height: 46px;
    display: flex; align-items: center; justify-content: center;
    color: var(--pix-accent-2);
    border: 2px solid var(--pix-accent-2);
    background: rgba(226, 180, 72, 0.08);
    box-shadow: 0 0 12px rgba(226, 180, 72, 0.2);
  }
  .tools-title h1 {
    margin: 0; font-size: 18px; letter-spacing: 2px; font-weight: 900;
    color: var(--pix-accent-2); text-shadow: 2px 2px 0 #000;
  }
  .tools-title p { margin: 4px 0 0 0; font-size: 11px; color: var(--pix-fg-dim); }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .tool-card {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-width: 2px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tool-card:hover { border-color: var(--pix-border-hi); transform: translateY(-2px); }
  .tool-icon {
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--pix-border);
  }
  .tool-copy h3 { margin: 0; font-size: 14px; font-weight: bold; }
  .tool-copy p { margin: 6px 0 0 0; font-size: 11px; line-height: 1.6; color: var(--pix-fg-dim); }
  .tool-action {
    display: flex; align-items: center; justify-content: space-between;
    padding-top: 10px; font-size: 10.5px; font-weight: bold;
  }
</style>
