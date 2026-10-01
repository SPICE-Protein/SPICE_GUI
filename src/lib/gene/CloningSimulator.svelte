<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { Sparkles, ArrowRight, Check, AlertTriangle, Beaker } from 'lucide-svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import {
    getEnzymeByName,
    enzymeFromSite,
    getCutsitesFromSequenceFlat,
    getReverseComplementSequenceString
  } from '$lib/genome';
  import { simulateCloning, type CloningMethod } from '$lib/genome/cloningMethods';

  let {
    vectorSeq = '',
    vectorName = '',
    onCloneSuccess = (newSeq: string, newName: string, historyNode: any) => {}
  } = $props<{
    vectorSeq?: string;
    vectorName?: string;
    onCloneSuccess: (newSeq: string, newName: string, historyNode: any) => void;
  }>();

  let simulationFinished = $state(false);
  let simulatedResult = $state<{ productSeq: string; productName: string; historyNode: any; warnings: string[] } | null>(null);

  // Cloning method selector
  const METHODS = $derived<{ id: CloningMethod; label: string; desc: string }[]>([
    { id: 'restriction', label: 'Restriction Cloning', desc: m.cloneSimDescRestriction() },
    { id: 'gibson', label: 'Gibson Assembly', desc: m.cloneSimDescGibson() },
    { id: 'golden_gate', label: 'Golden Gate Assembly', desc: m.cloneSimDescGoldenGate() },
    { id: 'in_fusion', label: 'In-Fusion Cloning', desc: m.cloneSimDescInFusion() },
    { id: 'nebuilder_hifi', label: 'NEBuilder HiFi', desc: m.cloneSimDescNEBuilder() },
    { id: 'gateway', label: 'Gateway Cloning', desc: m.cloneSimDescGateway() },
    { id: 'topo_directional', label: 'TOPO (Directional)', desc: m.cloneSimDescTopoDirectional() },
    { id: 'topo', label: 'TOPO (Non-directional)', desc: m.cloneSimDescTopo() },
    { id: 'ta', label: 'TA Cloning', desc: m.cloneSimDescTA() },
    { id: 'gc', label: 'GC Cloning', desc: m.cloneSimDescGC() },
  ]);

  let selectedMethod = $state<CloningMethod>('restriction');

  // Preset Insert sequences
  const PRESET_INSERTS = [
    {
      name: 'mTagBFP2 (Fluorescent Protein)',
      seq: 'TCGACATGGTGTCTAAGGGCGAAGAGCTGATTAAGGAGAACATGCACATGAAGCTGTACATGGAGGGCACCGTGGACAACCATCACTTCAAGTGCACATCCGAGGGCGAAGGCAAGCCCTACGAGGGCACCCAGACCATGAGAATCAAGGTGGTCGAGGGCGGCCCTCTCCCCTTCGCCTTCGACATCCTGGCTACTAGCTTCCTCTACGGCAGCAAGACCTTCATCAACCACACCCAGGGCATCCCCGACTTCTTCAAGCAGTCCTTCCCTGAGGGCTTCACATGGGAGAGAGTCACCACATACGAAGACGGGGGCGTGCTGACCGCTACCCAGGACACCAGCCTCCAGGACGGCTGCCTCATCTACAACGTCAAGATCAGAGGGGTGAACTTCACATCCAATGGCCCTGTGATGCAGAAGAAAACACTCGGCTGGGAGGCCTTCACCGAGACGCTGTACCCCGCTGACGGCGGCCTGGAAGGCAGAAACGACATGGCCCTGAAGCTCGTGGGCGGGAGCCATCTGATCGCAAACATCAAGACCACATATAGATCCAAGAAACCCGCTAAGAACCTCAAGATGCCCGGCGTCTACTATGTGGACTACAGACTGGAAAGAATCAAGGAGGCCAACAACGAGACCTACGTCGAGCAGCACGAGGTGGCAGTGGCCAGATACTGCGACCTCCCTAGCAAACTGGGGCACAAACTTAATGGTACC',
      leftEnzyme: 'SalI',
      rightEnzyme: 'KpnI'
    },
    {
      name: 'miniSOG (Optogenetic Flavin-binding)',
      seq: 'GAATTCATGGAAAGAAGTTTCGTGATTACGGATCCAAGATTGCCGGATAACCCAATTATTTTTGCATCAGATGGTTTCTTGGAATTGACGGAATATTCTCGTGAAGAAATTTTGGGTAGAAATGGTAGATTTTTGCAAGGTCCAGAAACGGATCAAGCTACGGTTCAAAAAATTAGAGATGCGATTAGAGATCAACGTGAAATTACGGTTCAATTGATTAACTATACGAAAAGTGGTAAAAAATTCTGGAACTTGTTGCATTTGCAACCAATGCGTGATCAAAAAGGTGAATTGCAATATTTCATTGGTGTTCAATTGGATGGTTCTAGACATCACCATCACCATCACTAA',
      leftEnzyme: 'EcoRI',
      rightEnzyme: 'BamHI'
    }
  ];

  let selectedInsertIdx = $state(0);
  let customInsertName = $state('MyInsert');
  let customInsertSeq = $state('GAATTC...GGATCC');
  let usePreset = $state(true);

  // Restriction enzymes
  let vectorLeftEnzyme = $state('SalI');
  let vectorRightEnzyme = $state('KpnI');

  // Golden Gate / Type IIS
  let goldenGateEnzyme = $state('BsaI');

  // Gibson/In-Fusion/NEBuilder overlap
  let overlapLength = $state(25);

  // Gateway att type
  let attL1 = $state(true);

  // TOPO directional
  let directional = $state(true);

  // Biophysical phosphorylation states
  let vectorPhosphorLeft = $state(true);
  let vectorPhosphorRight = $state(true);
  let insertPhosphorLeft = $state(true);
  let insertPhosphorRight = $state(true);

  const activeInsert = $derived.by(() => {
    if (usePreset) return PRESET_INSERTS[selectedInsertIdx];
    return {
      name: customInsertName,
      seq: customInsertSeq.toUpperCase().replace(/[^ATCG]/g, ''),
      leftEnzyme: vectorLeftEnzyme,
      rightEnzyme: vectorRightEnzyme
    };
  });

  function resolveEnzyme(name: string) {
    return getEnzymeByName(name) ?? enzymeFromSite(name, '', 0);
  }

  // Validate based on method
  const validationResult = $derived.by(() => {
    const insert = activeInsert;
    const warnings: string[] = [];
    let ready = true;

    if (!vectorSeq || vectorSeq.length < 10) {
      warnings.push(m.vectorSequenceTooShort());
      ready = false;
    }
    if (!insert.seq || insert.seq.length < 10) {
      warnings.push(m.insertSequenceTooShort());
      ready = false;
    }

    if (selectedMethod === 'restriction') {
      const vCutsL = getCutsitesFromSequenceFlat(vectorSeq, true, [resolveEnzyme(vectorLeftEnzyme)]);
      const vCutsR = getCutsitesFromSequenceFlat(vectorSeq, true, [resolveEnzyme(vectorRightEnzyme)]);
      if (vCutsL.length === 0) { warnings.push(m.cloneWarnVecLeftSite({ vectorLeftEnzyme: vectorLeftEnzyme })); ready = false; }
      if (vCutsR.length === 0) { warnings.push(m.cloneWarnVecRightSite({ vectorRightEnzyme: vectorRightEnzyme })); ready = false; }
      if (vectorLeftEnzyme !== insert.leftEnzyme || vectorRightEnzyme !== insert.rightEnzyme) {
        warnings.push(m.vectorAndInsertEnzymesMismatch());
      }
    } else if (selectedMethod === 'golden_gate') {
      const ggEnz = resolveEnzyme(goldenGateEnzyme);
      if (!ggEnz) { warnings.push(m.cloneWarnUnknownIIS({ goldenGateEnzyme: goldenGateEnzyme })); ready = false; }
      const vCuts = getCutsitesFromSequenceFlat(vectorSeq, true, [ggEnz].filter(Boolean) as any[]);
      if (vCuts.length === 0) warnings.push(m.cloneWarnGGSite({ goldenGateEnzyme: goldenGateEnzyme }));
    } else if (selectedMethod === 'topo_directional') {
      if (!insert.seq.startsWith('CACC')) {
        warnings.push(m.cloneSimWarnTopoCacc());
      }
    }

    return { warnings, ready };
  });

  const ENZYME_OVERHANGS: Record<string, { top: string; bot: string; type: '5prime' | '3prime'; len: number }> = {
    EcoRI: { top: 'G', bot: 'AATTC', type: '5prime', len: 4 },
    BamHI: { top: 'G', bot: 'GATCC', type: '5prime', len: 4 },
    HindIII: { top: 'A', bot: 'AGCTT', type: '5prime', len: 4 },
    SalI: { top: 'G', bot: 'TCGAC', type: '5prime', len: 4 },
    XhoI: { top: 'C', bot: 'TCGAG', type: '5prime', len: 4 },
    NdeI: { top: 'CA', bot: 'TATG', type: '5prime', len: 2 },
    SacI: { top: 'GAGCT', bot: 'C', type: '3prime', len: 4 },
    KpnI: { top: 'GGTAC', bot: 'C', type: '3prime', len: 4 },
  };

  async function handleLigate() {
    if (!validationResult.ready) {
      pushToast('error', m.ligationConditionsNotMet(), validationResult.warnings.join('; '));
      return;
    }

    // Use the pure-TS cloning engine
    const input = {
      vector: { sequence: vectorSeq, name: vectorName, circular: true },
      insert: { sequence: activeInsert.seq, name: activeInsert.name, circular: false },
      method: selectedMethod,
      leftEnzyme: vectorLeftEnzyme,
      rightEnzyme: vectorRightEnzyme,
      overlapLength,
      goldenGateEnzyme,
      attL1,
      directional,
      vectorPhosphorLeft,
      vectorPhosphorRight,
      insertPhosphorLeft,
      insertPhosphorRight,
    };

    let productSeq: string;
    let productName: string;
    let warnings: string[] = [];

    // Use pure-TS engine for all methods
    const result = simulateCloning(input);
    productSeq = result.product.sequence;
    productName = result.productName;
    warnings = result.warnings;

    const historyNode = {
      productName,
      size: productSeq.length,
      timestamp: new Date().toISOString(),
      parentVector: vectorName,
      parentVectorSize: vectorSeq.length,
      insertName: activeInsert.name,
      insertSize: activeInsert.seq.length,
      leftEnzyme: vectorLeftEnzyme,
      rightEnzyme: vectorRightEnzyme,
      method: selectedMethod,
    };

    if (warnings.length > 0) {
      pushToast('warn', m.cloningFinishedWithWarnings(), warnings.join('; '));
    }

    simulatedResult = {
      productSeq,
      productName,
      historyNode,
      warnings
    };
    simulationFinished = true;
    pushToast('success', m.cloningLigationSuccessful(), `[${selectedMethod}] ${productName} (${productSeq.length} bp)`);
  }
</script>

<div class="cloning-simulator" style="display: flex; flex-direction: column; gap: 8px; font-family: var(--pix-font);">
  <div class="pix-title" style="color: var(--pix-cyan); font-size: 11px; display: flex; align-items: center; gap: 4px;">
    <Sparkles size={11} /> {m.cloningSimulationWizard()}
  </div>

  {#if !simulationFinished}
  <!-- Method selector -->
  <div style="display: flex; flex-wrap: wrap; gap: 3px; background: #080b11; border: 2px solid var(--pix-border); padding: 4px; border-radius: 4px;">
    {#each METHODS as method}
      <button
        class="pix-btn {selectedMethod === method.id ? 'ok' : ''}"
        onclick={() => selectedMethod = method.id}
        style="padding: 3px 6px; font-size: 9px; white-space: nowrap;"
        title={method.desc}
      >
        {method.label}
      </button>
    {/each}
  </div>

  <div class="simulator-layout" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 10px; background: #080b11; border: 2px solid var(--pix-border); padding: 8px; border-radius: 4px;">
    <!-- Left column: Configuration -->
    <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
      <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepInsertSource()}</div>
      
      <div style="display: flex; gap: 6px;">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label style="display: flex; align-items: center; gap: 2px; color: var(--pix-fg);">
          <input type="radio" group={usePreset} value={true} checked={usePreset === true} onchange={() => usePreset = true} /> {m.preset()}
        </label>
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label style="display: flex; align-items: center; gap: 2px; color: var(--pix-fg);">
          <input type="radio" group={usePreset} value={false} checked={usePreset === false} onchange={() => usePreset = false} /> {m.custom()}
        </label>
      </div>

      {#if usePreset}
        <select class="pix-select" bind:value={selectedInsertIdx} style="padding: 2px 4px; font-size: 10px; width: 100%;">
          {#each PRESET_INSERTS as preset, i}
            <option value={i}>{preset.name}</option>
          {/each}
        </select>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <input class="pix-input" type="text" bind:value={customInsertName} placeholder={m.cloneSimInsertNamePlaceholder()} style="padding: 2px 4px; font-size: 10px;" />
          <textarea class="pix-input" bind:value={customInsertSeq} placeholder={m.cloneSimPasteSeqPlaceholder()} rows={2} style="padding: 2px 4px; font-size: 9px; width: 100%; font-family: monospace;"></textarea>
        </div>
      {/if}

      <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin: 2px 0;"></div>

      <!-- Method-specific parameters -->
      {#if selectedMethod === 'restriction'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepEnzymeSettings()}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div>
            <span class="pix-dim" style="font-size: 9px;">{m.leftEnzymeLabel()}</span>
            <select class="pix-select" bind:value={vectorLeftEnzyme} style="padding: 1px 3px; font-size: 10px; width: 100%;">
              <option value="SalI">SalI (G^TCGAC)</option>
              <option value="EcoRI">EcoRI (G^AATTC)</option>
              <option value="XhoI">XhoI (C^TCGAG)</option>
              <option value="BamHI">BamHI (G^GATCC)</option>
              <option value="HindIII">HindIII (A^AGCTT)</option>
              <option value="NdeI">NdeI (CA^TATG)</option>
              <option value="SacI">SacI (GAGCT^C)</option>
              <option value="KpnI">KpnI (GGTAC^C)</option>
            </select>
          </div>
          <div>
            <span class="pix-dim" style="font-size: 9px;">{m.rightEnzymeLabel()}</span>
            <select class="pix-select" bind:value={vectorRightEnzyme} style="padding: 1px 3px; font-size: 10px; width: 100%;">
              <option value="KpnI">KpnI (GGTAC^C)</option>
              <option value="BamHI">BamHI (G^GATCC)</option>
              <option value="HindIII">HindIII (A^AGCTT)</option>
              <option value="SalI">SalI (G^TCGAC)</option>
              <option value="EcoRI">EcoRI (G^AATTC)</option>
              <option value="XhoI">XhoI (C^TCGAG)</option>
              <option value="NdeI">NdeI (CA^TATG)</option>
              <option value="SacI">SacI (GAGCT^C)</option>
            </select>
          </div>
        </div>

        <!-- Biophysical Phosphorylation State Settings (Gap 1) -->
        <div style="margin-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border: 1px dashed var(--pix-border); padding: 5px; border-radius: 3px; background: rgba(255,255,255,0.01);">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8px;">{m.cloneSimVectorEndsTitle()}</div>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 8.5px; color: var(--pix-fg-dim);">
              <input type="checkbox" bind:checked={vectorPhosphorLeft} style="cursor: pointer;" /> {m.cloneSimPhosLeft()}
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 8.5px; color: var(--pix-fg-dim);">
              <input type="checkbox" bind:checked={vectorPhosphorRight} style="cursor: pointer;" /> {m.cloneSimPhosRight()}
            </label>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: bold; color: var(--pix-cyan); font-size: 8px;">{m.cloneSimInsertEndsTitle()}</div>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 8.5px; color: var(--pix-fg-dim);">
              <input type="checkbox" bind:checked={insertPhosphorLeft} style="cursor: pointer;" /> {m.cloneSimPhosLeft()}
            </label>
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 8.5px; color: var(--pix-fg-dim);">
              <input type="checkbox" bind:checked={insertPhosphorRight} style="cursor: pointer;" /> {m.cloneSimPhosRight()}
            </label>
          </div>
        </div>
      {:else if selectedMethod === 'gibson' || selectedMethod === 'in_fusion' || selectedMethod === 'nebuilder_hifi'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepHomologOverlap()}</div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="pix-dim" style="font-size: 9px;">{m.overlapLengthBp()}</span>
          <input class="pix-input" type="number" bind:value={overlapLength} min={15} max={60} style="padding: 2px 4px; font-size: 10px; width: 60px;" />
          <span class="pix-dim" style="font-size: 9px;">({m.recommend2040()})</span>
        </div>
        <div class="pix-dim" style="font-size: 9px; line-height: 1.3;">
          {selectedMethod === 'gibson' ? m.cloneSimGibsonCocktail() : ''}
          {selectedMethod === 'in_fusion' ? (m.cloneSimNoteInFusion()) : ''}
          {selectedMethod === 'nebuilder_hifi' ? (m.cloneSimNoteNeb()) : ''}
        </div>
      {:else if selectedMethod === 'golden_gate'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepGGEnzyme()}</div>
        <select class="pix-select" bind:value={goldenGateEnzyme} style="padding: 2px 4px; font-size: 10px; width: 100%;">
          <option value="BsaI">BsaI (GGTCTC 1/5)</option>
          <option value="BbsI">BbsI (GAAGAC 2/6)</option>
          <option value="BsmBI">BsmBI (CGTCTC 5/1)</option>
          <option value="BtgZI">BtgZI (GCGATG 10/14)</option>
          <option value="SapI">SapI (GCTCTTC 1/4)</option>
          <option value="AarI">AarI (CACCTGC 4/8)</option>
        </select>
        <div class="pix-dim" style="font-size: 9px;">{m.cloneSimNoteTypeIIS()}</div>
      {:else if selectedMethod === 'gateway' || selectedMethod === 'topo'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepTopoParams()}</div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label style="display: flex; align-items: center; gap: 2px; font-size: 9px;">
            <input type="checkbox" checked={directional} onchange={(e) => directional = (e.target as HTMLInputElement).checked} /> {m.cloneSimDirectionalTopoCheck()}
          </label>
        </div>
        <div class="pix-dim" style="font-size: 9px;">{m.cloneSimNoteTopo()}</div>
     {:else if selectedMethod === 'ta'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepTACloning()}</div>
        <div class="pix-dim" style="font-size: 9px;">{m.cloneSimTaHint()}</div>
     {:else if selectedMethod === 'gc'}
        <div style="color: var(--pix-accent-2); font-weight: bold;">{m.stepGCBlunt()}</div>
        <div class="pix-dim" style="font-size: 9px;">{m.cloneSimNoteBlunt()}</div>
      {/if}
    </div>

    <!-- Right column: Status & Action -->
    <div style="display: flex; flex-direction: column; gap: 6px; border-left: 1px dashed rgba(255,255,255,0.15); padding-left: 10px; justify-content: center; font-size: 10px;">
      <div style="color: var(--pix-accent-2); font-weight: bold;">{m.cloneSimValidationTitle()}</div>
      <div style="background: #04060a; border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; font-family: monospace; line-height: 1.4;">
        {#if validationResult.warnings.length === 0}
          <div style="color: var(--pix-green); font-size: 9px;">✓ {m.cloneSimAllChecksPassed()}</div>
        {:else}
          {#each validationResult.warnings as w}
            <div style="color: var(--pix-red); font-size: 9px;">⚠ {w}</div>
          {/each}
        {/if}
      </div>

      <!-- Splicing schematic -->
      <div style="display: flex; align-items: center; justify-content: space-around; background: rgba(255,255,255,0.02); padding: 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="text-align: center;">
          <div class="pix-dim" style="font-size: 8px;">{m.csVectorLabel()}</div>
          <div style="font-size: 10px; color: var(--pix-cyan); font-weight: bold;">{vectorName}</div>
        </div>
        <ArrowRight size={10} style="color: var(--pix-dim);" />
        <div style="text-align: center;">
          <div class="pix-dim" style="font-size: 8px;">{m.csInsertLabel()}</div>
          <div style="font-size: 10px; color: var(--pix-accent-2); font-weight: bold;">{activeInsert.name.split(' ')[0]}</div>
        </div>
        <ArrowRight size={10} style="color: var(--pix-dim);" />
        <div style="text-align: center;">
          <div class="pix-dim" style="font-size: 8px;">{m.cloneSimRecombinantProduct()}</div>
          <div style="font-size: 10px; color: {validationResult.ready ? 'var(--pix-green)' : 'var(--pix-red)'}; font-weight: bold;">{validationResult.ready ? 'Ready' : 'Block'}</div>
        </div>
      </div>

      <!-- Action Button -->
      {#if validationResult.ready}
        <button 
          class="pix-btn ok" 
          onclick={handleLigate} 
          style="padding: 5px; font-size: 10px; font-weight: bold; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"
        >
          <Beaker size={12} /> {m.cloneSimLigateBtn()}
        </button>
      {:else}
        <button 
          class="pix-btn" 
          disabled 
          style="padding: 5px; font-size: 10px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 4px; opacity: 0.5; background: var(--pix-bg-3); border-color: var(--pix-border);"
        >
          <AlertTriangle size={12} /> {m.cloneSimBlockedBtn()}
        </button>
      {/if}

      <!-- Method description -->
      <div class="pix-dim" style="font-size: 8px; text-align: center; line-height: 1.2; margin-top: 2px;">
        {METHODS.find(m => m.id === selectedMethod)?.desc}
      </div>

      <!-- Sticky End Detail Visualization (Feature 4) -->
      {#if selectedMethod === 'restriction'}
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 6px; padding-top: 4px; font-family: monospace; font-size: 8px; display: flex; flex-direction: column; gap: 4px;">
          <div style="font-weight: bold; color: var(--pix-cyan);">{m.cloneSimOverhangDetails()}</div>
          
          <!-- Left Junction -->
          <div style="background: rgba(0,0,0,0.35); padding: 4px; border: 1px solid rgba(255,255,255,0.05); border-radius: 2px; line-height: 1.3;">
            <div style="color: var(--pix-accent-2); font-weight: bold; font-size: 7.5px; margin-bottom: 2px;">{m.cloneSimLeftJunction({ v1: vectorLeftEnzyme })}</div>
            {#if ENZYME_OVERHANGS[vectorLeftEnzyme]}
              {@const o = ENZYME_OVERHANGS[vectorLeftEnzyme]}
              {#if o.type === '5prime'}
                <div style="color: var(--pix-green);">V-End 5'-... {o.top}      [Ligate]      {o.bot.slice(0, o.len)}...-3'</div>
                <div style="opacity: 0.4; letter-spacing: 1px;">            |                    |</div>
                <div style="color: var(--pix-cyan);">I-Start 3'-... {o.bot.slice(0, o.len)}   [Ligate]   {o.top}...-5'</div>
              {:else}
                <div style="color: var(--pix-green);">V-End 5'-... {o.top}   [Ligate]   {o.top.slice(-o.len)}...-3'</div>
                <div style="opacity: 0.4; letter-spacing: 1px;">            |                    |</div>
                <div style="color: var(--pix-cyan);">I-Start 3'-... {o.bot.slice(-o.len)}      [Ligate]      {o.bot}...-5'</div>
              {/if}
            {:else}
              <div class="pix-dim" style="text-align: center; padding: 4px;">{m.cloneSimBluntEnd()}</div>
            {/if}
          </div>
          
          <!-- Right Junction -->
          <div style="background: rgba(0,0,0,0.35); padding: 4px; border: 1px solid rgba(255,255,255,0.05); border-radius: 2px; line-height: 1.3;">
            <div style="color: var(--pix-accent-2); font-weight: bold; font-size: 7.5px; margin-bottom: 2px;">{m.cloneSimRightJunction({ v1: vectorRightEnzyme })}</div>
            {#if ENZYME_OVERHANGS[vectorRightEnzyme]}
              {@const o = ENZYME_OVERHANGS[vectorRightEnzyme]}
              {#if o.type === '5prime'}
                <div style="color: var(--pix-cyan);">I-End 5'-... {o.top}      [Ligate]      {o.bot.slice(0, o.len)}...-3'</div>
                <div style="opacity: 0.4; letter-spacing: 1px;">            |                    |</div>
                <div style="color: var(--pix-green);">V-Start 3'-... {o.bot.slice(0, o.len)}   [Ligate]   {o.top}...-5'</div>
              {:else}
                <div style="color: var(--pix-cyan);">I-End 5'-... {o.top}   [Ligate]   {o.top.slice(-o.len)}...-3'</div>
                <div style="opacity: 0.4; letter-spacing: 1px;">            |                    |</div>
                <div style="color: var(--pix-green);">V-Start 3'-... {o.bot.slice(-o.len)}      [Ligate]      {o.bot}...-5'</div>
              {/if}
            {:else}
              <div class="pix-dim" style="text-align: center; padding: 4px;">{m.cloneSimBluntEnd()}</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
  {:else}
    <div style="background: #080b11; border: 2px solid var(--pix-border); padding: 12px; border-radius: 4px; display: flex; flex-direction: column; gap: 10px; text-align: center;">
      <div style="display: flex; justify-content: center; align-items: center; gap: 6px; color: var(--pix-green); font-size: 11px; font-weight: bold; margin-bottom: 4px;">
        <Check size={14} /> {m.cloneSimSuccessTitle()}
      </div>
      
      <div class="pix-panel" style="padding: 10px; text-align: left; display: flex; flex-direction: column; gap: 6px; font-size: 10px; background: rgba(0,0,0,0.4);">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
          <span class="pix-dim">{m.cloneSimMethodLabel()}</span>
          <span style="color: var(--pix-cyan); font-weight: bold;">{METHODS.find(m => m.id === selectedMethod)?.label}</span>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
          <span class="pix-dim">{m.cloneSimProductNameLabel()}</span>
          <span style="color: var(--pix-accent-2); font-weight: bold;">{simulatedResult?.productName}</span>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
          <span class="pix-dim">{m.cloneSimTotalLengthLabel()}</span>
          <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{simulatedResult?.productSeq?.length} bp</span>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
          <span class="pix-dim">{m.cloneSimParentVectorLabel()}</span>
          <span style="color: var(--pix-fg);">{vectorName} ({vectorSeq.length} bp)</span>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
          <span class="pix-dim">{m.cloneSimInsertPartLabel()}</span>
          <span style="color: var(--pix-fg);">{activeInsert.name} ({activeInsert.seq.length} bp)</span>
        </div>
        {#if selectedMethod === 'restriction'}
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 4px;">
            <span class="pix-dim">{m.cloneSimEnzymesLabel()}</span>
            <span style="color: var(--pix-purple);">{vectorLeftEnzyme} / {vectorRightEnzyme}</span>
          </div>
        {/if}
      </div>

      {#if simulatedResult && simulatedResult.warnings.length > 0}
        <div style="background: rgba(255, 183, 3, 0.08); border: 1px solid var(--pix-accent); padding: 6px; border-radius: 3px; font-size: 9px; text-align: left; display: flex; flex-direction: column; gap: 2px;">
          <div style="color: var(--pix-accent); font-weight: bold; display: flex; align-items: center; gap: 4px;">
            <AlertTriangle size={11} /> {m.cloneSimWarningsLabel()}
          </div>
          {#each simulatedResult.warnings as w}
            <div style="color: var(--pix-fg-dim); line-height: 1.3;">• {w}</div>
          {/each}
        </div>
      {/if}

      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <button 
          class="pix-btn" 
          onclick={() => { simulationFinished = false; simulatedResult = null; }}
          style="flex: 1; padding: 6px; font-size: 10px;"
        >
          ↩ {m.cloneSimBackBtn()}
        </button>
        <button 
          class="pix-btn ok" 
          onclick={() => {
            if (simulatedResult) {
              onCloneSuccess(simulatedResult.productSeq, simulatedResult.productName, simulatedResult.historyNode);
            }
            simulationFinished = false;
            simulatedResult = null;
          }}
          style="flex: 2; padding: 6px; font-size: 10px; font-weight: bold; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"
        >
          🚀 {m.cloneSimImportBtn()}
        </button>
      </div>
    </div>
  {/if}
</div>
