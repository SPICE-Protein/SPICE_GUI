<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 
  import {
    assembleVector,
    validateVectorAssembly,
    type ExpressionCassette,
    type VectorTemplate,
    type AssemblyResult,
    type ValidationResult
  } from '$lib/genome/expressionCassette';
  import ExpressionCassetteBuilder from './ExpressionCassetteBuilder.svelte';

  let {
    template = { id: 'vector-1', name: 'Vector template', topology: 'circular', features: [], insertionSites: [] },
    cassette,
    onAssembled,
    onChange,
    compact = false
  } = $props<{
    template?: VectorTemplate;
    cassette?: ExpressionCassette;
    onAssembled?: (result: AssemblyResult, validation: ValidationResult) => void;
    onChange?: (cassette: ExpressionCassette) => void;
    compact?: boolean;
  }>();

  const label = (key: string, fallback: string) => {
    const candidate = (m as unknown as Record<string, unknown>)[key];
    return typeof candidate === 'function' ? (candidate as () => string)() : fallback;
  };
  let localTemplate = $state<VectorTemplate>({ ...template, features: [...(template.features ?? [])], insertionSites: [...(template.insertionSites ?? [])] });
  let localCassette = $state<ExpressionCassette>(cassette ?? { id: 'cassette-1', parts: [], topology: 'linear' });
  let result = $state<AssemblyResult | null>(null);
  let validation = $state<ValidationResult | null>(null);
  let siteId = $state(localTemplate.insertionSites?.[0]?.id ?? '');
  let sequence = $state(localTemplate.sequence ?? '');
  let error = $state('');

  function assemble() {
    error = '';
    if (!/^[ACGTN]*$/i.test(sequence)) { error = m.vtpInvalidDnaChars(); return; }
    localTemplate = { ...localTemplate, sequence };
    result = assembleVector(localTemplate, localCassette, siteId || undefined);
    validation = validateVectorAssembly(result);
    onAssembled?.(result, validation);
  }
  function setCassette(next: ExpressionCassette) { localCassette = next; onChange?.(next); }
</script>

<section class="vector-panel pix-panel compact" class:full={!compact} aria-label={m.vtpPanelTitle()}>
  <header class="panel-header"><strong>{m.vtpPanelTitle()}</strong><span class="pix-dim">{localTemplate.name ?? localTemplate.id}</span></header>
  <div class="template-fields">
    <label>{m.vtpVectorName()}<input class="pix-input" value={localTemplate.name ?? ''} oninput={(e) => localTemplate = { ...localTemplate, name: e.currentTarget.value }} /></label>
    <label>{m.vtpTemplateSequence()}<textarea class="pix-input template-sequence" bind:value={sequence} placeholder="ACGT..."></textarea></label>
    <label>{m.vtpInsertionSite()}<select class="pix-select" bind:value={siteId} disabled={!localTemplate.insertionSites?.length}>
      <option value="">{m.vtpDefaultSite()}</option>
      {#each localTemplate.insertionSites ?? [] as site}<option value={site.id}>{site.id}</option>{/each}
    </select></label>
  </div>

  <ExpressionCassetteBuilder cassette={localCassette} {compact} onChange={setCassette} onAssembled={() => {}} />
  {#if error}<div class="issue error">{error}</div>{/if}
  <div class="actions"><button class="pix-btn ok" type="button" onclick={assemble}>{m.vtpAssembleValidate()}</button>{#if result}<span class="pix-dim">{result.sequence.length} bp · {result.features.length} {m.vtpFeatures()}</span>{/if}</div>
  {#if validation}
    <div class:valid={validation.valid} class:invalid={!validation.valid} class="validation">
      <strong>{validation.valid ? m.vtpValidationPassed() : m.vtpNeedsAttention()}</strong>
      {#if validation.issues.length}
        <ul>{#each validation.issues as issue}<li class:error={issue.severity === 'error'}>{issue.message}</li>{/each}</ul>
      {:else}<span class="pix-dim">{m.vtpNoIssues()}</span>{/if}
    </div>
  {/if}
</section>

<style>
  .vector-panel { display:flex; flex-direction:column; gap:8px; padding:8px; color:var(--pix-fg,#e8edf5); font-family:var(--pix-font,monospace); font-size:10px; min-width:430px; }.full{width:100%;}
  .panel-header,.actions { display:flex; align-items:center; justify-content:space-between; gap:6px; border-bottom:1px solid var(--pix-border); padding-bottom:5px; }.template-fields { display:grid; grid-template-columns:1fr 2fr 1fr; gap:6px; }.template-fields label { display:flex; flex-direction:column; gap:3px; color:var(--pix-fg-dim); }.template-sequence { min-height:36px; resize:vertical; font-family:monospace; text-transform:uppercase; }.issue { padding:5px; }.error { color:var(--pix-red); border-color:var(--pix-red); }.validation { padding:6px; border:1px solid var(--pix-border); display:flex; flex-direction:column; gap:4px; }.validation.valid { color:var(--pix-green); border-color:var(--pix-green); }.validation.invalid { color:var(--pix-warning); border-color:var(--pix-warning); }.validation ul { margin:0; padding-left:18px; }.validation li.error { color:var(--pix-red); }
</style>
