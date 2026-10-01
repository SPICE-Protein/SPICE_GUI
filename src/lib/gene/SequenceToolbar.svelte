<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { Scissors, Milestone, Dna, ArrowRight, FileText, Hand, Pencil, Tag } from 'lucide-svelte';

  let {
    showEnzymes = $bindable(true),
    showFeatures = $bindable(true),
    showTranslations = $bindable(false),
    seqTool = $bindable('browse'),
    onOpenHybridization = () => {},
    onToggleColors = () => {},
    onAddSelectionNote = () => {}
  } = $props<{
    showEnzymes: boolean;
    showFeatures: boolean;
    showTranslations: boolean;
    seqTool: 'browse' | 'edit' | 'annotate';
    onOpenHybridization: () => void;
    onToggleColors: () => void;
    onAddSelectionNote: () => void;
  }>();
</script>

<!-- SnapGene-style vertical toolbar -->
<div class="snap-toolbar" style="display: flex; flex-direction: column; gap: 3px; background: #1a1a1a; padding: 4px; width: 44px; align-items: center; z-index: 10;">
  <!-- Browse Mode Button -->
  <button 
    class="snap-tool-btn {seqTool === 'browse' ? 'active' : ''}" 
    onclick={() => seqTool = 'browse'} 
    title={m.browseMode()}
  >
    <Hand size={18} />
  </button>

  <!-- Edit Mode Button -->
  <button 
    class="snap-tool-btn {seqTool === 'edit' ? 'active' : ''}" 
    onclick={() => seqTool = 'edit'} 
    title={m.editMode()}
  >
    <Pencil size={18} />
  </button>

  <!-- Annotate Mode Button (Feature Annotation Selection Tool) -->
  <button 
    class="snap-tool-btn {seqTool === 'annotate' ? 'active' : ''}" 
    onclick={() => seqTool = 'annotate'} 
    title={m.annotateMode()}
    style="color: var(--pix-accent-2);"
  >
    <Tag size={18} />
  </button>

  <!-- Divider -->
  <div style="border-top: 1px solid #333; width: 100%; margin: 2px 0;"></div>

  <!-- Toggle Enzymes -->
  <button 
    class="snap-tool-btn {showEnzymes ? 'active' : ''}" 
    onclick={() => showEnzymes = !showEnzymes} 
    title={m.viewShowCutSites()}
  >
    <Scissors size={18} />
  </button>

  <!-- Toggle Features -->
  <button 
    class="snap-tool-btn {showFeatures ? 'active' : ''}" 
    onclick={() => showFeatures = !showFeatures} 
    title={m.viewShowFeatures()}
  >
    <Milestone size={18} />
  </button>

  <!-- Toggle Primers with hybridization params -->
  <button 
    class="snap-tool-btn"
    onclick={onOpenHybridization}
    title={m.pcrPrimersHybridization()}
  >
    <ArrowRight size={18} style="transform: rotate(-45deg);" />
  </button>

  <!-- Toggle Translations -->
  <button 
    class="snap-tool-btn {showTranslations ? 'active' : ''}" 
    onclick={() => showTranslations = !showTranslations} 
    title={m.viewShowTranslations()}
  >
    <Dna size={18} />
  </button>

  <!-- Add Selection Note (Gap 17) -->
  <button 
    class="snap-tool-btn" 
    onclick={onAddSelectionNote} 
    title={m.addNoteToSelection()}
    style="color: #4cd6ff;"
  >
    <FileText size={18} />
  </button>
</div>

<style>
  .snap-tool-btn {
    background: #2a2a2a;
    border: none;
    border-radius: 6px;
    color: #8a8a8a;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.12s;
    padding: 0;
  }
  .snap-tool-btn:hover {
    background: #333;
    color: #e0e0e0;
  }
  .snap-tool-btn.active {
    background: #007a8a;
    color: #ffffff;
  }
  .snap-tool-btn.active:hover {
    background: #008fa3;
  }
  .snap-dropdown-arrow {
    color: #666;
    cursor: pointer;
    font-size: 8px;
    padding: 1px 6px;
    font-family: monospace;
    transition: color 0.12s;
  }
  .snap-dropdown-arrow:hover {
    color: #e0e0e0;
  }
</style>
