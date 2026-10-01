<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 
  import {
    assembleExpressionCassette,
    type CassettePart,
    type ExpressionCassette,
    type PartRole,
    type AssemblyResult,
    type Orientation,
    type Topology
  } from '$lib/genome/expressionCassette';

  let {
    cassette = { id: 'cassette-1', parts: [], topology: 'linear' as Topology },
    onChange,
    onAssembled,
    compact = false
  } = $props<{
    cassette?: ExpressionCassette;
    onChange?: (cassette: ExpressionCassette) => void;
    onAssembled?: (result: AssemblyResult) => void;
    compact?: boolean;
  }>();

  const roles: PartRole[] = ['promoter', 'enhancer', '5_utr', 'translation_initiation_context', 'rbs', 'signal_peptide', 'targeting_peptide', 'linker', 'fusion_tag', 'cds', '3_utr', 'terminator', 'polyadenylation_signal', 'other'];
  const roleLabel: Record<PartRole, string> = {
    promoter: 'Promoter', enhancer: 'Enhancer', '5_utr': "5' UTR", translation_initiation_context: 'Translation context', rbs: 'RBS', signal_peptide: 'Signal peptide', targeting_peptide: 'Targeting peptide', linker: 'Linker', fusion_tag: 'Fusion tag', cds: 'CDS', '3_utr': "3' UTR", terminator: 'Terminator', polyadenylation_signal: 'Poly(A) signal', other: 'Other'
  };

  let localCassette = $state<ExpressionCassette>({ ...cassette, parts: [...(cassette.parts ?? [])] });
  let selectedId = $state('');
  let result = $state<AssemblyResult | null>(null);
  let sequenceError = $state('');
  const label = (key: string, fallback: string) => {
    const candidate = (m as unknown as Record<string, unknown>)[key];
    return typeof candidate === 'function' ? (candidate as () => string)() : fallback;
  };
  const assembledLength = $derived(result?.sequence.length ?? 0);

  function update(next: ExpressionCassette) {
    localCassette = next;
    onChange?.(next);
  }
  function addPart() {
    const id = `part-${localCassette.parts.length + 1}`;
    const part: CassettePart = { id, name: id, role: 'cds', sequence: '' };
    update({ ...localCassette, parts: [...localCassette.parts, part] });
    selectedId = id;
  }
  function removePart(id: string) {
    update({ ...localCassette, parts: localCassette.parts.filter(p => p.id !== id), order: localCassette.order?.filter(p => p !== id) });
    if (selectedId === id) selectedId = '';
  }
  function movePart(id: string, direction: -1 | 1) {
    const parts = [...localCassette.parts];
    const index = parts.findIndex(p => p.id === id);
    if (index < 0 || index + direction < 0 || index + direction >= parts.length) return;
    [parts[index], parts[index + direction]] = [parts[index + direction], parts[index]];
    update({ ...localCassette, parts, order: parts.map(p => p.id) });
  }
  function patchPart(id: string, patch: Partial<CassettePart>) {
    update({ ...localCassette, parts: localCassette.parts.map(p => p.id === id ? { ...p, ...patch } : p) });
  }
  function assemble() {
    sequenceError = '';
    const invalid = localCassette.parts.find(p => !/^[ACGTN]*$/i.test(p.sequence));
    if (invalid) { sequenceError = m.ecbInvalidPartChars({ v1: invalid.id }); result = null; return; }
    result = assembleExpressionCassette(localCassette);
    onAssembled?.(result);
  }
</script>

<section class="cassette-builder pix-panel" class:compact aria-label={m.menuCloneExpressionCassette()}>
  <header class="panel-header">
    <strong>{m.ecbCassetteHeading()}</strong>
    <span class="pix-dim">{localCassette.parts.length} {m.ecbParts()}</span>
  </header>

  <div class="toolbar">
    <input class="pix-input" aria-label={m.ecbCassetteId()} bind:value={localCassette.id} oninput={() => update({ ...localCassette })} />
    <select class="pix-select" aria-label={m.ecbTopology()} bind:value={localCassette.topology} onchange={() => update({ ...localCassette })}>
      <option value="linear">{m.topologyLinear()}</option>
      <option value="circular">{m.topologyCircular()}</option>
    </select>
    <button class="pix-btn ok" type="button" onclick={addPart}>+ {m.add()}</button>
  </div>

  <div class="parts" aria-live="polite">
    {#each localCassette.parts as part, index (part.id)}
      <div class="part-row" class:selected={selectedId === part.id}>
        <button class="part-index" type="button" onclick={() => selectedId = part.id} aria-label={part.id}>{index + 1}</button>
        <input class="pix-input part-name" aria-label={m.ecbPartName()} value={part.name ?? part.id} oninput={(e) => patchPart(part.id, { name: e.currentTarget.value })} />
        <select class="pix-select role" aria-label={m.ecbPartRole()} value={part.role} onchange={(e) => patchPart(part.id, { role: e.currentTarget.value as PartRole })}>
          {#each roles as role}<option value={role}>{roleLabel[role]}</option>{/each}
        </select>
        <select class="pix-select orientation" aria-label={m.ecbOrientation()} value={part.orientation ?? 'forward'} onchange={(e) => patchPart(part.id, { orientation: e.currentTarget.value as Orientation })}>
          <option value="forward">→</option><option value="reverse">←</option>
        </select>
        <button class="icon-btn" type="button" onclick={() => movePart(part.id, -1)} disabled={index === 0} aria-label={m.ecbMoveUp()}>↑</button>
        <button class="icon-btn" type="button" onclick={() => movePart(part.id, 1)} disabled={index === localCassette.parts.length - 1} aria-label={m.ecbMoveDown()}>↓</button>
        <button class="icon-btn danger" type="button" onclick={() => removePart(part.id)} aria-label={m.delete()}>×</button>
        <textarea class="pix-input sequence" aria-label={m.ecbDnaSequence()} placeholder="ACGT..." value={part.sequence} oninput={(e) => patchPart(part.id, { sequence: e.currentTarget.value.toUpperCase().replace(/\s/g, '') })}></textarea>
        <span class="pix-dim length">{part.sequence.length} bp</span>
      </div>
    {:else}
      <div class="empty pix-dim">{m.ecbEmptyHint()}</div>
    {/each}
  </div>

  {#if sequenceError}<div class="issue error">{sequenceError}</div>{/if}
  <div class="footer">
    <button class="pix-btn ok" type="button" onclick={assemble}>{m.ecbAssembleBtn()}</button>
    {#if result}<span class="result">{assembledLength} bp · {result.features.length} {m.ecbAnnotations()}</span>{/if}
  </div>
</section>

<style>
  .cassette-builder { display:flex; flex-direction:column; gap:7px; padding:8px; color:var(--pix-fg, #e8edf5); font-family:var(--pix-font, monospace); font-size:10px; min-width:420px; }
  .compact { min-width:0; }
  .panel-header,.toolbar,.footer { display:flex; align-items:center; gap:5px; }
  .panel-header { justify-content:space-between; border-bottom:1px solid var(--pix-border); padding-bottom:5px; }
  .toolbar .pix-input { flex:1; min-width:70px; }
  .parts { display:flex; flex-direction:column; gap:4px; max-height:320px; overflow:auto; }
  .part-row { display:grid; grid-template-columns:22px minmax(70px,1fr) 130px 40px 22px 22px 22px; gap:3px; align-items:center; padding:4px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.14); }
  .part-row.selected { border-color:var(--pix-cyan); }
  .part-index,.icon-btn { border:1px solid var(--pix-border); background:transparent; color:inherit; cursor:pointer; height:20px; }
  .part-index { color:var(--pix-cyan); }
  .icon-btn:disabled { opacity:.35; cursor:default; }
  .danger { color:var(--pix-red); }
  .sequence { grid-column:2 / -1; min-height:34px; resize:vertical; font-family:monospace; text-transform:uppercase; }
  .length { grid-column:1 / -1; text-align:right; }
  .empty { text-align:center; padding:18px; border:1px dashed var(--pix-border); }
  .issue { padding:5px; }.error { color:var(--pix-red); border:1px solid var(--pix-red); }.result { color:var(--pix-green); margin-left:auto; }
</style>
