<script lang="ts">
  import { onMount } from 'svelte'; 

  import * as m from '$lib/paraglide/messages.js';
  import { Search, ToggleLeft, ToggleRight, Check } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { getEnzymeBufferCompatibility } from '$lib/genome';

  let {
    restrictionSites = [] as { name: string; pos: number; seq: string; color: string; methylated?: boolean; methylationType?: string }[],
    selectedEnzymes = $bindable([] as string[]),
    enzymeDatabase = {} as Record<string, { seq: string; cut: number; color: string }>
  } = $props<{
    restrictionSites: { name: string; pos: number; seq: string; color: string; methylated?: boolean; methylationType?: string }[];
    selectedEnzymes: string[];
    enzymeDatabase: Record<string, { seq: string; cut: number; color: string }>;
  }>();

  let customEnzymeSets = $state<{ name: string; enzymes: string[] }[]>([]);
  let selectedPresetName = $state('');
  let showGroupModal = $state(false);
  let newSetNameInput = $state('');
  let editingIdx = $state<number | null>(null);
  let editingNameText = $state('');

  // Portal action to mount modal to document body to bypass stacking context and clipping
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('spice.gene.customEnzymeSetsGrid');
      if (saved) {
        try {
          customEnzymeSets = JSON.parse(saved);
        } catch (e) {}
      }
    }
  });

  // Keep dropdown value in sync with currently selected enzymes
  $effect(() => {
    const isSameSet = (a: string[], b: string[]) => {
      if (a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((val, index) => val === sortedB[index]);
    };

    // Check presets
    for (const [pName, pEnzymes] of Object.entries(PRESETS)) {
      if (isSameSet(selectedEnzymes, pEnzymes)) {
        selectedPresetName = pName;
        return;
      }
    }

    // Check custom sets
    for (const set of customEnzymeSets) {
      if (isSameSet(selectedEnzymes, set.enzymes)) {
        selectedPresetName = set.name;
        return;
      }
    }

    selectedPresetName = '';
  });

  function saveCustomEnzymeSetInline() {
    let name = newSetNameInput.trim();
    if (!name) {
      name = `Set ${customEnzymeSets.length + 1}`;
    }
    
    // Check duplicate and overwrite
    const existingIdx = customEnzymeSets.findIndex(s => s.name === name);
    if (existingIdx !== -1) {
      customEnzymeSets = customEnzymeSets.map((set, i) => {
        if (i === existingIdx) {
          return { name, enzymes: [...selectedEnzymes] };
        }
        return set;
      });
      pushToast('success', m.enzSelSetOverwritten({ v1: name }), name);
    } else {
      customEnzymeSets = [...customEnzymeSets, { name, enzymes: [...selectedEnzymes] }];
      pushToast('success', m.toastCustomEnzymeSetSaved(), name);
    }
    
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice.gene.customEnzymeSetsGrid', JSON.stringify(customEnzymeSets));
    }
    newSetNameInput = '';
  }

  function deleteCustomEnzymeSetByName(setName: string) {
    customEnzymeSets = customEnzymeSets.filter(s => s.name !== setName);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice.gene.customEnzymeSetsGrid', JSON.stringify(customEnzymeSets));
    }
    pushToast('success', m.toastCustomEnzymeSetDeleted(), setName);
  }

  function startRenameByName(setName: string) {
    const idx = customEnzymeSets.findIndex(s => s.name === setName);
    if (idx !== -1) {
      editingIdx = idx;
      editingNameText = customEnzymeSets[idx].name;
    }
  }

  function finishRename(idx: number) {
    const newName = editingNameText.trim();
    if (!newName) return;
    customEnzymeSets = customEnzymeSets.map((set, i) => {
      if (i === idx) {
        return { ...set, name: newName };
      }
      return set;
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice.gene.customEnzymeSetsGrid', JSON.stringify(customEnzymeSets));
    }
    editingIdx = null;
    pushToast('success', m.toastEnzymeSetRenamed(), newName);
  }

  // System presets for companies and cloning workflows
  const PRESETS = {
    "NEB Standard": ['EcoRI', 'BamHI', 'HindIII', 'SacI', 'SalI', 'KpnI', 'PstI', 'NotI', 'XbaI'],
    "Thermo Fisher": ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'XmaI', 'PstI', 'NotI', 'SacI', 'SalI'],
    "Golden Gate (Type IIS)": ['BsaI', 'BbsI', 'BsmBI', 'SapI', 'BspQI', 'AarI'],
    "Rare Cutters (8bp+)": ['NotI', 'AscI', 'FseI', 'PacI', 'PmeI', 'SbfI', 'SfiI', 'SgrAI'],
    "BioBrick Standard": ['EcoRI', 'XbaI', 'SpeI', 'PstI'],
    "MoClo Assembly": ['BsaI', 'BbsI', 'BsmBI', 'SapI', 'PaqCI'],
    "Blunt End Cutters": ['EcoRV', 'SmaI', 'HpaI', 'DraI', 'PvuII', 'ScaI', 'StuI', 'NaeI'],
    "Methylation-Insensitive": ['EcoRI', 'BamHI', 'HindIII', 'KpnI', 'SacI', 'NcoI', 'PstI'],
    "Standard Lab Cloning": ['EcoRI', 'BamHI', 'HindIII', 'SalI', 'XhoI', 'KpnI', 'SacI', 'XbaI', 'NcoI', 'NdeI', 'PstI']
  };

  function applyPreset(enzymesList: string[]) {
    selectedEnzymes = [...enzymesList];
  }

  let activeDetailEnzyme = $state('EcoRI');
  let bufferSearchQuery = $state('EcoRI');

  $effect(() => {
    if (activeDetailEnzyme) {
      bufferSearchQuery = activeDetailEnzyme;
    }
  });

  // Fuzzy match buffer enzymes from the complete dynamic REBASE database
  const bufferSearchResults = $derived.by(() => {
    if (!bufferSearchQuery.trim() || bufferSearchQuery === activeDetailEnzyme) return [];
    const q = bufferSearchQuery.toUpperCase();
    return Object.keys(enzymeDatabase)
      .filter(name => name.toUpperCase().includes(q))
      .slice(0, 5);
  });

  // Compute active detail using the dynamically resolved core database (0% hardcoded)
  const activeDetail = $derived.by(() => {
    const comp = getEnzymeBufferCompatibility(activeDetailEnzyme);
    return {
      b1: comp.r1_1,
      b2: comp.r2_1,
      b3: comp.r3_1,
      cs: comp.cutSmart,
      preferredBuffer: comp.preferredBuffer,
      heatInactivation: true
    };
  });

  let searchQuery = $state('');
  let groupSearchQuery = $state('');

  const filteredPresets = $derived.by(() => {
    const q = groupSearchQuery.trim().toLowerCase();
    if (!q) return Object.entries(PRESETS);
    return Object.entries(PRESETS).filter(([name]) => name.toLowerCase().includes(q));
  });

  const filteredCustomSets = $derived.by(() => {
    const q = groupSearchQuery.trim().toLowerCase();
    if (!q) return customEnzymeSets;
    return customEnzymeSets.filter(set => set.name.toLowerCase().includes(q));
  });

  // Fuzzy match enzymes from REBASE database
  const searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toUpperCase();
    return Object.keys(enzymeDatabase)
      .filter(name => name.toUpperCase().includes(q))
      .slice(0, 5); // Limit to top 5 results for clean pixel look
  });

  function toggleEnzyme(name: string) {
    if (selectedEnzymes.includes(name)) {
      selectedEnzymes = selectedEnzymes.filter((e: string) => e !== name);
    } else {
      selectedEnzymes = [...selectedEnzymes, name];
    }
  }

  function clearAll() {
    selectedEnzymes = [];
  }

  function handleSearchEnter() {
    const query = searchQuery.trim();
    if (!query) return;

    // 1. Try exact case-insensitive match
    const exactMatch = Object.keys(enzymeDatabase).find(
      k => k.toLowerCase() === query.toLowerCase()
    );

    if (exactMatch) {
      if (selectedEnzymes.includes(exactMatch)) {
        pushToast('info', m.enzSelAlreadySelected({ v1: exactMatch }), exactMatch);
      } else {
        selectedEnzymes = [...selectedEnzymes, exactMatch];
        pushToast('success', m.enzSelAdded({ v1: exactMatch }), exactMatch);
      }
      searchQuery = '';
      return;
    }

    // 2. Try first autocomplete result
    if (searchResults.length > 0) {
      const topMatch = searchResults[0];
      if (selectedEnzymes.includes(topMatch)) {
        pushToast('info', m.enzSelAlreadySelected({ v1: topMatch }), topMatch);
      } else {
        selectedEnzymes = [...selectedEnzymes, topMatch];
        pushToast('success', m.enzSelAdded({ v1: topMatch }), topMatch);
      }
      searchQuery = '';
      return;
    }

    // 3. Not found
    pushToast('error', m.enzSelNotFound({ v1: query }), query);
  }
</script>

<div class="enzyme-selector-box" style="display: flex; flex-direction: column; gap: 6px; font-family: var(--pix-font);">
  <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 2px;">
    <!-- Selector Trigger Button and Action Utilities -->
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
      <button 
        class="pix-btn" 
        onclick={() => showGroupModal = true} 
        style="padding: 2px 6px; font-size: 9.5px; height: 20px; background: #0b0f19; border: 1px solid var(--pix-border); color: var(--pix-cyan); cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: space-between; font-weight: bold; overflow: hidden; white-space: nowrap;"
      >
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; text-align: left;" title={selectedPresetName}>
          🧪 {selectedPresetName ? `${m.enzSelSetPrefix()}: ${selectedPresetName}` : m.enzSelManageSetsBtn()}
        </span>
        <span style="font-size: 9px; opacity: 0.8; flex-shrink: 0; margin-left: 2px;">📂</span>
      </button>

      <div style="display: flex; gap: 6px; font-size: 9.5px; flex-shrink: 0; align-items: center;">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span onclick={clearAll} style="cursor: pointer; color: var(--pix-red);" title={m.clear()}>{m.clear()}</span>
      </div>
    </div>
  </div>

  <!-- Fuzzy Search REBASE Database -->
  <div style="position: relative; display: flex; align-items: center; background: #04060a; border: 1px solid var(--pix-border); padding: 2px 6px; border-radius: 2px;">
    <Search size={11} style="color: var(--pix-fg-dim); margin-right: 4px;" />
    <input 
      type="text" 
      bind:value={searchQuery} 
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchEnter();
        }
      }}
      placeholder={m.enzSelSearchPlaceholder()}
      style="background: transparent; border: none; outline: none; font-size: 10px; color: #fff; font-family: var(--pix-font); width: 100%; height: 18px;"
    />
    
    <!-- Autocomplete dropdown -->
    {#if searchResults.length > 0}
      <div class="search-dropdown pix-panel" style="position: absolute; left: 0; right: 0; top: 24px; background: #0b0f19; border: 2px solid var(--pix-border); border-radius: 3px; z-index: 200; max-height: 120px; overflow-y: auto; padding: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.8);">
        {#each searchResults as name}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div 
            onclick={() => { toggleEnzyme(name); searchQuery = ''; }} 
            class="search-item" 
            style="display: flex; justify-content: space-between; padding: 4px; cursor: pointer; font-size: 9.5px; border-radius: 2px; color: {enzymeDatabase[name]?.color ?? '#fff'};"
          >
            <span>{name} ({enzymeDatabase[name]?.seq})</span>
            {#if selectedEnzymes.includes(name)}
              <Check size={9} style="color: var(--pix-green);" />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Selected Enzymes List (Replaces Common Checkboxes) -->
  <div style="display: flex; flex-direction: column; gap: 3px; background: rgba(0,0,0,0.15); padding: 5px; border: 1px dotted var(--pix-border); border-radius: 3px;">
    <span class="pix-dim" style="font-size: 8.5px; display: block; font-weight: bold; color: var(--pix-cyan);">{m.enzSelSelectedTitle()} ({selectedEnzymes.length})</span>
    {#if selectedEnzymes.length > 0}
      <div style="display: flex; flex-direction: column; gap: 3px; max-height: 100px; overflow-y: auto; padding-right: 2px;">
        {#each selectedEnzymes as name}
          <div 
            style="display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; padding: 1px 4px; font-size: 9px; color: {enzymeDatabase[name]?.color ?? '#fff'};"
          >
            <span>{name} <span class="mono" style="font-size: 8px; opacity: 0.65; font-weight: normal; margin-left: 4px;">({enzymeDatabase[name]?.seq ?? ''})</span></span>
            <button 
              class="pix-btn-reset" 
              onclick={() => toggleEnzyme(name)} 
              style="cursor: pointer; color: var(--pix-red); font-weight: bold; font-size: 11px; border: none; background: transparent; padding: 0 3px;"
              title={m.enzSelDeleteEnzymeTitle()}
            >
              -
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="pix-dim" style="text-align: center; padding: 10px; font-size: 9px; border: 1px dashed rgba(255,255,255,0.06); border-radius: 2px;">
        {m.enzSelNoneSelectedHint()}
      </div>
    {/if}
  </div>

  <div style="border-top: 1px dashed var(--pix-border); margin: 2px 0;"></div>

  <!-- Cutter list -->
  <div class="sites-list" style="max-height: 150px; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 2px;">
    {#each restrictionSites as site}
      <div 
        style="display: flex; justify-content: space-between; padding: 3px 6px; border-bottom: 1px dashed var(--pix-border); color: {site.color};"
        title={site.methylated ? (m.enzymeBlockedByMethylation({ methylationType: site.methylationType })) : ''}
      >
        <span style="font-weight: bold;">
          {site.name}
          {#if site.methylated}
            <span style="color: var(--pix-red); font-size: 8px; margin-left: 2px;">[{m.blocked()}]</span>
          {/if}
        </span>
        <span class="mono" style="font-size: 9px; opacity: 0.85;">{site.seq}</span>
        <span class="pix-num" style="font-size: 10px;">{site.pos} bp</span>
      </div>
    {/each}
    {#if restrictionSites.length === 0}
      <div class="empty pix-dim" style="padding: 10px 0; text-align: center; font-size: 10px;">{m.noCutsitesDetected()}</div>
    {/if}
  </div>

  <!-- Buffer Compatibility Details Panel (Gap 4) -->
  <div class="pix-panel" style="margin-top: 4px; padding: 5px; background: rgba(0,0,0,0.2); font-size: 9.5px; border-top: 1px dashed var(--pix-border);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 2px; gap: 4px; position: relative;">
      <span style="font-weight: bold; color: var(--pix-accent-2); flex-shrink: 0;">{m.nebDoubleDigestBufferActivity()}</span>
      
      <!-- Searchable details input -->
      <div style="position: relative; display: flex; align-items: center; width: 100px;">
        <input 
          type="text" 
          bind:value={bufferSearchQuery} 
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const exactMatch = Object.keys(enzymeDatabase).find(k => k.toLowerCase() === bufferSearchQuery.trim().toLowerCase());
              if (exactMatch) {
                activeDetailEnzyme = exactMatch;
              } else if (bufferSearchResults.length > 0) {
                activeDetailEnzyme = bufferSearchResults[0];
              }
              bufferSearchQuery = activeDetailEnzyme;
            }
          }}
          placeholder={m.enzSelBufferSearchPlaceholder()}
          style="width: 100%; padding: 1px 4px; font-size: 8.5px; height: 16px; background: #000; color: #fff; border: 1px solid var(--pix-border); border-radius: 2px; font-family: var(--pix-font);"
        />
        
        <!-- Autocomplete dropdown for buffer details -->
        {#if bufferSearchResults.length > 0}
          <div class="pix-panel" style="position: absolute; left: 0; right: 0; bottom: 18px; background: #0b0f19; border: 1px solid var(--pix-border); border-radius: 2px; z-index: 300; max-height: 80px; overflow-y: auto; padding: 2px; box-shadow: 0 -2px 8px rgba(0,0,0,0.8);">
            {#each bufferSearchResults as enz}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                onclick={() => { activeDetailEnzyme = enz; bufferSearchQuery = enz; }}
                style="padding: 2px; cursor: pointer; font-size: 8.5px; color: #fff;"
              >
                {enz}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    
    {#if activeDetail}
      {@const act = activeDetail}
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; text-align: center; margin-bottom: 3px;">
        <div style="background: rgba(255,255,255,0.02); padding: 2px; border-radius: 2px;">
          <div class="pix-dim" style="font-size: 7.5px;">r1.1</div>
          <div style="font-weight: bold; color: {act.b1 >= 100 ? 'var(--pix-green)' : act.b1 >= 50 ? 'var(--pix-yellow)' : 'var(--pix-red)'};">{act.b1}%</div>
        </div>
        <div style="background: rgba(255,255,255,0.02); padding: 2px; border-radius: 2px;">
          <div class="pix-dim" style="font-size: 7.5px;">r2.1</div>
          <div style="font-weight: bold; color: {act.b2 >= 100 ? 'var(--pix-green)' : act.b2 >= 50 ? 'var(--pix-yellow)' : 'var(--pix-red)'};">{act.b2}%</div>
        </div>
        <div style="background: rgba(255,255,255,0.02); padding: 2px; border-radius: 2px;">
          <div class="pix-dim" style="font-size: 7.5px;">r3.1</div>
          <div style="font-weight: bold; color: {act.b3 >= 100 ? 'var(--pix-green)' : act.b3 >= 50 ? 'var(--pix-yellow)' : 'var(--pix-red)'};">{act.b3}%</div>
        </div>
        <div style="background: rgba(255,255,255,0.02); padding: 2px; border-radius: 2px;">
          <div class="pix-dim" style="font-size: 7.5px;">CutSmart</div>
          <div style="font-weight: bold; color: {act.cs >= 100 ? 'var(--pix-green)' : act.cs >= 50 ? 'var(--pix-yellow)' : 'var(--pix-red)'};">{act.cs}%</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 8px;" class="pix-dim">
        <span>{m.heatInactivation65C20min()} <span style="color: {act.heatInactivation ? 'var(--pix-green)' : 'var(--pix-red)'}; font-weight: bold;">{act.heatInactivation ? (m.yes()) : (m.noColumnPurify())}</span></span>
      </div>
    {:else}
      <div class="pix-dim" style="text-align: center; font-size: 8.5px; padding: 4px 0;">{m.enzymeNoBuffer()}</div>
    {/if}
  </div>
</div>

{#if showGroupModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div use:portal class="modal-overlay" onclick={() => showGroupModal = false} style="position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 9999; backdrop-filter: blur(2px);">
    <div class="modal-box pix-panel" onclick={(e) => e.stopPropagation()} style="background: #0b0f19; border: 3px solid var(--pix-border); padding: 14px; width: 500px; border-radius: 4px; box-shadow: 0 0 20px #000; font-family: var(--pix-font); max-height: 85vh; overflow-y: auto;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 6px; margin-bottom: 12px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 11px; display: flex; align-items: center; gap: 4px;">
          🧬 {m.enzSelModalTitle()}
        </span>
        <button class="pix-btn-reset" onclick={() => showGroupModal = false} style="font-size: 11px; font-weight: bold; color: var(--pix-red); cursor: pointer; border: none; background: transparent; padding: 0 4px;">[{m.close()} X]</button>
      </div>

      <!-- Current selection details -->
      <div style="background: rgba(0, 0, 0, 0.25); border: 1px dashed var(--pix-border); padding: 6px 8px; border-radius: 3px; margin-bottom: 12px; font-size: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: var(--pix-cyan);">{m.enzSelCurrentSelectedLabel()}</span>
          <span class="pix-dim" style="font-size: 9px;">({selectedEnzymes.length} {m.enzSelEnzymesUnit()})</span>
        </div>
        <div style="word-break: break-all; color: var(--pix-fg); line-height: 1.3; font-family: monospace;">
          {selectedEnzymes.length > 0 ? selectedEnzymes.join(', ') : m.enzSelNoEnzymeSelected()}
        </div>
      </div>

      <!-- Search Enzyme Group Names -->
      <div style="position: relative; display: flex; align-items: center; background: #04060a; border: 1px solid var(--pix-border); padding: 4px 8px; border-radius: 3px; margin-bottom: 12px;">
        <Search size={12} style="color: var(--pix-fg-dim); margin-right: 6px; flex-shrink: 0;" />
        <input 
          type="text" 
          bind:value={groupSearchQuery} 
          placeholder={m.enzSelSetSearchPlaceholder()}
          style="background: transparent; border: none; outline: none; font-size: 10px; color: #fff; font-family: var(--pix-font); width: 100%; height: 18px;"
        />
        {#if groupSearchQuery}
          <button class="pix-btn-reset" onclick={() => groupSearchQuery = ''} style="font-size: 9px; color: var(--pix-red); cursor: pointer; border: none; background: transparent; padding: 0 4px; font-weight: bold;">[Clear]</button>
        {/if}
      </div>

      <!-- Presets and Custom Groups -->
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <!-- System Presets -->
        <div>
          <span class="pix-dim" style="font-size: 10px; font-weight: bold; display: block; margin-bottom: 6px; color: var(--pix-cyan); border-left: 2px solid var(--pix-cyan); padding-left: 4px;">
            {m.systemPresets()}
          </span>
          {#if filteredPresets.length > 0}
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
              {#each filteredPresets as [pName, pEnzymes]}
                {@const isCurrent = selectedPresetName === pName}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div 
                  onclick={() => { applyPreset(pEnzymes); showGroupModal = false; }}
                  style="padding: 6px; text-align: left; background: {isCurrent ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid {isCurrent ? 'var(--pix-cyan)' : 'var(--pix-border)'}; border-radius: 3px; cursor: pointer; transition: all 0.15s; overflow: hidden;"
                >
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: bold; color: {isCurrent ? 'var(--pix-cyan)' : 'var(--pix-fg)'}; gap: 4px;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;" title={pName}>{pName}</span>
                    {#if isCurrent}
                      <span style="font-size: 8px; color: var(--pix-green); flex-shrink: 0;">● Active</span>
                    {/if}
                  </div>
                  <div style="font-size: 8.5px; color: var(--pix-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px;" title={pEnzymes.join(', ')}>
                    {pEnzymes.join(', ')}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 12px; font-size: 9px; border: 1px dashed rgba(255,255,255,0.06); border-radius: 2px;">
              {m.enzSelNoPresetsFound()}
            </div>
          {/if}
        </div>

        <!-- Divider -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.08); margin: 4px 0;"></div>

        <!-- Custom Sets -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 6px;">
            <span class="pix-dim" style="font-size: 10px; font-weight: bold; color: var(--pix-accent-2); border-left: 2px solid var(--pix-accent-2); padding-left: 4px;">
              {m.userCustomSets()}
            </span>
            <div style="display: flex; gap: 4px; align-items: center;">
              <input 
                type="text" 
                bind:value={newSetNameInput} 
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCustomEnzymeSetInline();
                  }
                }}
                placeholder={m.enzSelNewSetNamePlaceholder()}
                style="padding: 1px 4px; font-size: 8.5px; height: 16px; background: #000; color: #fff; border: 1px solid var(--pix-border); border-radius: 2px; width: 100px; font-family: var(--pix-font);"
              />
              <button class="pix-btn" onclick={saveCustomEnzymeSetInline} style="padding: 1px 6px; font-size: 8.5px; height: 18px; background: #222; border: 1px solid var(--pix-border); color: var(--pix-green); cursor: pointer;" title={m.saveSelectedAsCustomSet()}>
                {m.enzSelSaveCurrent()}
              </button>
            </div>
          </div>

          {#if filteredCustomSets && filteredCustomSets.length > 0}
            <div style="display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto; padding-right: 4px;">
              {#each filteredCustomSets as set}
                {@const isCurrent = selectedPresetName === set.name}
                {@const setOriginalIdx = customEnzymeSets.findIndex(s => s.name === set.name)}
                <div style="display: flex; gap: 4px; align-items: center; background: {isCurrent ? 'rgba(0, 240, 255, 0.05)' : 'rgba(0,0,0,0.15)'}; padding: 4px 6px; border: 1px solid {isCurrent ? 'var(--pix-cyan)' : 'var(--pix-border)'}; border-radius: 3px;">
                  {#if editingIdx === setOriginalIdx}
                    <!-- Inline Rename Form -->
                    <div style="display: flex; gap: 4px; align-items: center; width: 100%;">
                      <input 
                        type="text" 
                        bind:value={editingNameText} 
                        style="padding: 1px 4px; font-size: 9px; height: 18px; background: #000; color: #fff; border: 1px solid var(--pix-border); border-radius: 2px; flex: 1; font-family: var(--pix-font);"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            finishRename(setOriginalIdx);
                          } else if (e.key === 'Escape') {
                            editingIdx = null;
                          }
                        }}
                      />
                      <button 
                        class="pix-btn-reset" 
                        onclick={() => finishRename(setOriginalIdx)}
                        style="padding: 1px 4px; font-size: 9px; color: var(--pix-green); border: 1px solid var(--pix-border); border-radius: 2px; background: rgba(0,0,0,0.3); cursor: pointer; height: 18px; display: flex; align-items: center; justify-content: center;"
                        title={m.save()}
                      >
                        ✓
                      </button>
                      <button 
                        class="pix-btn-reset" 
                        onclick={() => editingIdx = null}
                        style="padding: 1px 4px; font-size: 9px; color: var(--pix-red); border: 1px solid var(--pix-border); border-radius: 2px; background: rgba(0,0,0,0.3); cursor: pointer; height: 18px; display: flex; align-items: center; justify-content: center;"
                        title={m.cancel()}
                      >
                        ✗
                      </button>
                    </div>
                  {:else}
                    <!-- Standard Row -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div 
                      onclick={() => { applyPreset(set.enzymes); showGroupModal = false; }} 
                      title={m.enzSelLoadSetTitle({ v1: set.name })}
                      style="text-align: left; flex: 1; overflow: hidden; cursor: pointer;"
                    >
                      <div style="font-size: 10px; font-weight: bold; color: {isCurrent ? 'var(--pix-cyan)' : 'var(--pix-fg)'}; display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title={set.name}>{set.name}</span>
                        <span class="pix-dim" style="font-size: 8.5px; font-weight: normal; flex-shrink: 0;">({set.enzymes.length} {m.enzSelEnzymeCountUnit()})</span>
                      </div>
                      <div style="font-size: 8.5px; color: var(--pix-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;" title={set.enzymes.join(', ')}>
                        {set.enzymes.join(', ')}
                      </div>
                    </div>

                    <div style="display: flex; gap: 3px;">
                      <button 
                        class="pix-btn-reset" 
                        onclick={(e) => { e.stopPropagation(); startRenameByName(set.name); }} 
                        title={m.enzSelRenameSetTitle()}
                        style="padding: 2px 4px; font-size: 9px; color: var(--pix-cyan); border: 1px solid var(--pix-border); border-radius: 2px; background: rgba(0,0,0,0.3); cursor: pointer; height: 18px; width: 18px; display: flex; align-items: center; justify-content: center;"
                      >
                        📝
                      </button>
                      <button 
                        class="pix-btn-reset" 
                        onclick={(e) => { e.stopPropagation(); deleteCustomEnzymeSetByName(set.name); }} 
                        title={m.deleteEnzymeGroup()}
                        style="padding: 2px 4px; font-size: 11px; font-weight: bold; color: var(--pix-red); border: 1px solid var(--pix-border); border-radius: 2px; background: rgba(0,0,0,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center; height: 18px; width: 18px;"
                      >
                        -
                      </button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="pix-dim" style="text-align: center; padding: 16px; font-size: 9.5px; border: 1px dotted rgba(255,255,255,0.1); border-radius: 3px; background: rgba(0,0,0,0.1);">
              {m.enzSelNoCustomSetsFound()}
            </div>
          {/if}
        </div>
      </div>

      <!-- Actions/Footer -->
      <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 14px; border-top: 1px solid var(--pix-border); padding-top: 8px;">
        <button class="pix-btn" onclick={() => showGroupModal = false} style="padding: 2px 12px; font-size: 10px; cursor: pointer; background: #222; border: 1px solid var(--pix-border); color: #fff;">
          {m.close()}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sites-list::-webkit-scrollbar {
    width: 6px;
  }
  .search-item:hover {
    background: rgba(255,255,255,0.05);
  }
</style>