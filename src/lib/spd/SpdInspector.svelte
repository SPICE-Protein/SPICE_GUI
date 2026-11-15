<script lang="ts">
  // Floating SPD record inspector. It fetches the selected public id directly
  // from the API so the panel reflects the server's current record, not just
  // whatever the list row happened to cache.
  import { Copy, Database, ExternalLink, RefreshCw, X } from 'lucide-svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import * as m from '$lib/paraglide/messages.js';
  import { isTauri } from '$lib/backend/api';
  import { configureSpdClient, spdBaseUrl } from './client';
  import type {
    SpdFoldHistory, SpdGeneRecord, SpdGeneRegion, SpdLineageNode,
    SpdProvenanceSnapshot, SpdRelation, SpdSequenceTree,
  } from './types';
  import { entityTypeForKind, inspectorKindForEntityType, lineageChain, relationLabel } from './relations';
  import { spdInspector, type SpdInspectorKind, type SpdInspectorTarget } from './inspector.svelte';

  interface Related {
    sequence: Record<string, unknown> | null;
    environment: Record<string, unknown> | null;
    model: Record<string, unknown> | null;
  }

  let loading = $state(false);
  let error = $state('');
  let copied = $state(false);
  let record = $state.raw<Record<string, unknown> | null>(null);
  let related = $state.raw<Related | null>(null);
  let geneRegions = $state.raw<SpdGeneRegion[] | null>(null);
  let sequenceLength = $state<number | null>(null);
  let relations = $state.raw<SpdRelation[]>([]);
  let lineage = $state.raw<SpdLineageNode[]>([]);
  let evidence = $state.raw<SpdFoldHistory | null>(null);
  let tree = $state.raw<SpdSequenceTree | null>(null);
  let provenance = $state.raw<SpdProvenanceSnapshot[]>([]);
  let loadToken = 0;

  let x = $state<number | null>(null);
  let y = $state(86);

  const target = $derived(spdInspector.target);

  const kindLabel = $derived(target ? kindName(target.kind) : '');

  const features = $derived(asArray(record?.features));
  const sites = $derived(asArray(record?.insertionSites));
  const suppliers = $derived(asArray(record?.suppliers));
  const featureRows = $derived(
    features.map((item) => {
      const row = asRecord(item);
      return {
        id: text(row.id),
        type: text(row.type),
        start: text(row.start),
        end: text(row.end),
        strand: text(row.strand),
      };
    }),
  );
  const siteRows = $derived(
    sites.map((item) => {
      const row = asRecord(item);
      return { id: text(row.id), position: text(row.position) };
    }),
  );
  const supplierRows = $derived(
    suppliers.map((item) => {
      const row = asRecord(item);
      return {
        name: text(row.organizationName ?? row.name ?? row.organizationId),
        catalog: text(row.catalogNumber),
        order: text(row.orderUrl ?? row.orderEmail),
      };
    }),
  );
  const geneRegionRows = $derived(
    (geneRegions ?? []).map((item) => {
      const row = asRecord(item);
      return {
        molecule: text(row.molecule),
        regionType: text(row.regionType),
        start: text(row.startPosition ?? row.start),
        end: text(row.endPosition ?? row.end),
        strand: text(row.strand),
        description: text(row.description),
        proteinId: typeof row.proteinId === 'string' ? row.proteinId : '',
      };
    }),
  );
  const overview = $derived(buildOverview(record, target?.kind));
  const evidenceRows = $derived(evidence ? [
    { key: 'validations', count: evidence.validations?.length ?? 0 },
    { key: 'observedStructures', count: evidence.observedStructures?.length ?? 0 },
    { key: 'mdVerifications', count: evidence.mdVerifications?.length ?? 0 },
    { key: 'stabilityScans', count: evidence.stabilityScans?.length ?? 0 },
    { key: 'pocketAnalyses', count: evidence.pocketAnalyses?.length ?? 0 },
    { key: 'assessments', count: evidence.assessments?.length ?? 0 },
  ] : []);
  const evidenceTotal = $derived(evidenceRows.reduce((sum, row) => sum + row.count, 0));
  const dnaSequenceLength = $derived(sequenceTextLength(record?.dnaSequence));
  const rnaSequenceLength = $derived(sequenceTextLength(record?.rnaSequence));

  function kindName(kind: SpdInspectorKind): string {
    switch (kind) {
      case 'vector': return m.spdInspectorKindVector();
      case 'protein': return m.spdInspectorKindProtein();
      case 'fold': return m.spdInspectorKindFold();
      case 'enzyme': return m.spdInspectorKindEnzyme();
      case 'artifact': return m.spdInspectorKindArtifact();
      case 'gene': return m.spdInspectorKindGene();
      case 'sequence': return m.spdInspectorKindSequence();
    }
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  function text(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function sequenceTextLength(value: unknown): number | null {
    return typeof value === 'string' ? value.length : null;
  }

  /** SPD stores the declared mutation array as free-form JSON. Count entries
   *  when it is an array; anything else is reported as zero rather than
   *  stringified into the row. */
  function mutationCount(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
  }

  function pretty(value: unknown): string {
    if (value === null || value === undefined) return '—';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function timeText(key: string, value: unknown): string {
    if (
      (key === 'createdAt' || key === 'updatedAt' || key === 'completedAt'
        || key === 'sourceUpdatedAt' || key === 'sourceFetchedAt')
      && typeof value === 'number'
    ) {
      return new Date(value * 1000).toLocaleString();
    }
    if (key === 'organism' && value && typeof value === 'object') {
      const organism = value as { scientificName?: unknown; taxId?: unknown };
      const label = [organism.scientificName, organism.taxId ? `taxId ${organism.taxId}` : '']
        .filter(Boolean)
        .join(' · ');
      if (label) return label;
    }
    return text(value);
  }

  function buildOverview(row: Record<string, unknown> | null, kind: SpdInspectorKind | undefined) {
    if (!row || !kind) return [];
    const keys: Record<SpdInspectorKind, string[]> = {
      vector: ['name', 'topology', 'format', 'schemaVersion', 'coordinateSystem', 'sequenceArtifactId'],
      protein: ['preferredName', 'geneName', 'organism', 'license', 'annotationScore', 'status'],
      fold: [
        'verificationLevel', 'validationStatus', 'sequenceId', 'environmentId', 'modelId',
        'foldIdentityHash', 'createdAt', 'updatedAt',
      ],
      enzyme: [
        'name', 'recognitionSite', 'cutPosition', 'enzymeType', 'targetMolecule', 'proteinId',
        'source', 'sourceRelease', 'sourceFetchedAt', 'license', 'citation',
      ],
      artifact: ['kind', 'mediaType', 'byteLength', 'sha256', 'status'],
      gene: [
        'name', 'symbol', 'geneType', 'organism', 'accession', 'locusTag', 'ncbiGeneId',
        'moleculeType', 'topology', 'chromosome', 'mapLocation', 'strand', 'dnaLength',
        'rnaLength', 'sequenceVersion', 'sourceUpdatedAt', 'createdAt',
      ],
      sequence: [
        'length', 'sha256', 'sequenceRole', 'proteinId', 'parentSequenceId',
        'isNative', 'createdAt',
      ],
    };
    return keys[kind]
      .filter((key) => row[key] !== undefined && row[key] !== null)
      .map((key) => ({ key, value: timeText(key, row[key]) }));
  }

  async function load(target: SpdInspectorTarget) {
    const token = ++loadToken;
    loading = true;
    error = '';
    record = null;
    related = null;
    geneRegions = null;
    sequenceLength = null;
    relations = [];
    lineage = [];
    evidence = null;
    tree = null;
    provenance = [];
    const client = configureSpdClient();
    const entityType = entityTypeForKind(target.kind);
    // Graph reads run beside the record read. They are supplementary: a
    // permission or network failure on the edge list must not hide a record
    // that loaded fine, so both degrade to an empty section.
    const relationPromise = client
      .entityRelations(entityType, target.id)
      .then((result) => result.relations)
      .catch(() => [] as SpdRelation[]);
    const lineagePromise = target.kind === 'sequence'
      ? client
          .entityLineage('sequence', target.id)
          .then((result) => lineageChain(result.nodes))
          .catch(() => [] as SpdLineageNode[])
      : Promise.resolve([] as SpdLineageNode[]);
    const evidencePromise = target.kind === 'fold'
      ? client.foldHistory(target.id).catch(() => null)
      : Promise.resolve(null);
    const treePromise = target.kind === 'sequence'
      ? client.sequenceTree(target.id).catch(() => null)
      : Promise.resolve(null);
    const provenancePromise = client
      .provenanceSnapshots(entityType, target.id)
      .catch(() => [] as SpdProvenanceSnapshot[]);
    try {
      if (target.kind === 'vector') {
        const vector = await client.getVector(target.id);
        if (token !== loadToken) return;
        record = vector as unknown as Record<string, unknown>;
        if (vector.sequenceArtifactId) {
          try {
            const fasta = await client.getArtifactContentText(vector.sequenceArtifactId);
            if (token === loadToken) {
              sequenceLength = fasta
                .split(/\r?\n/)
                .filter((line) => !line.startsWith('>'))
                .join('')
                .replace(/\s+/g, '').length;
            }
          } catch {
            // The vector is still useful without the linked artifact bytes.
          }
        }
      } else if (target.kind === 'fold') {
        const fold = await client.getFold(target.id);
        if (token !== loadToken) return;
        record = fold as unknown as Record<string, unknown>;
        const sequenceId = typeof fold.sequenceId === 'string' ? fold.sequenceId : '';
        const environmentId = typeof fold.environmentId === 'string' ? fold.environmentId : '';
        const modelId = typeof fold.modelId === 'string' ? fold.modelId : '';
        // One graph read replaces the three follow-ups when the DSL resolves
        // the fold root; otherwise fall back to the individual endpoints so an
        // older server still fills the Related cards.
        const context = await client.graphFoldContext(target.id);
        if (context) {
          related = context;
        } else {
          const [sequence, environment, model] = await Promise.all([
            sequenceId ? client.getSequence(sequenceId).catch(() => null) : Promise.resolve(null),
            environmentId ? client.getEnvironment(environmentId).catch(() => null) : Promise.resolve(null),
            modelId ? client.getModel(modelId).catch(() => null) : Promise.resolve(null),
          ]);
          if (token !== loadToken) return;
          related = { sequence, environment, model };
        }
      } else if (target.kind === 'protein') {
        record = await client.getProtein(target.id);
      } else if (target.kind === 'enzyme') {
        record = (await client.getRestrictionEnzyme(target.id)) as unknown as Record<string, unknown>;
      } else if (target.kind === 'gene') {
        // A missing region list should not hide the gene itself.
        const [gene, regions] = await Promise.all([
          client.getGene(target.id),
          client.listGeneRegions(target.id).catch(() => null),
        ]);
        if (token !== loadToken) return;
        const geneRecord = gene as SpdGeneRecord;
        record = geneRecord as unknown as Record<string, unknown>;
        geneRegions = (regions as SpdGeneRegion[] | null) ?? [];
      } else if (target.kind === 'sequence') {
        record = (await client.getSequence(target.id)) as unknown as Record<string, unknown>;
      } else {
        record = (await client.getArtifact(target.id)) as unknown as Record<string, unknown>;
      }
      if (token !== loadToken) return;
      relations = await relationPromise;
      lineage = await lineagePromise;
      evidence = await evidencePromise;
      tree = await treePromise;
      provenance = await provenancePromise;
    } catch (err) {
      if (token === loadToken) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  $effect(() => {
    const current = spdInspector.target;
    if (current) void load(current);
    else {
      record = null;
      related = null;
      geneRegions = null;
      relations = [];
      lineage = [];
      evidence = null;
      tree = null;
      provenance = [];
      error = '';
      loading = false;
    }
  });

  function close() {
    spdInspector.close();
  }

  async function copyId() {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.id);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      // Clipboard may be unavailable in a locked-down WebView.
    }
  }

  function openInSpd(target: SpdInspectorTarget) {
    const route: Record<SpdInspectorKind, string> = {
      vector: 'vectors',
      protein: 'proteins',
      fold: 'folds',
      enzyme: 'enzymes',
      artifact: 'artifacts',
      gene: 'genes',
      sequence: 'sequences',
    };
    const root = spdBaseUrl()
      .replace(/\/api\/v1\/?$/, '')
      .replace('://d-api.', '://d.');
    const url = `${root}/${route[target.kind]}/${encodeURIComponent(target.id)}`;
    if (isTauri()) void openUrl(url);
    else window.open(url, '_blank', 'noopener');
  }

  function startDrag(event: PointerEvent) {
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = (event.currentTarget as HTMLElement).closest('.spd-inspector') as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    x = rect.left;
    y = rect.top;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const move = (moveEvent: PointerEvent) => {
      const maxX = Math.max(6, window.innerWidth - panel.offsetWidth - 6);
      x = Math.min(maxX, Math.max(6, moveEvent.clientX - offsetX));
      y = Math.min(window.innerHeight - 60, Math.max(6, moveEvent.clientY - offsetY));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && target) close();
  }}
/>

{#if target}
  <section
    class="spd-inspector pix-panel"
    style="left:{x === null ? 'auto' : `${x}px`}; right:{x === null ? '12px' : 'auto'}; top:{y}px;"
    aria-label={m.spdInspectorTitle()}
  >
    <header class="inspector-head" role="group" aria-label={m.spdInspectorTitle()} onpointerdown={startDrag}>
      <div class="inspector-title">
        <Database size={13} />
        <span class="kind">{kindLabel}</span>
        {#if target.label}<span class="name">{target.label}</span>{/if}
      </div>
      <div class="inspector-actions">
        <button class="pix-btn-reset" type="button" title={m.spdInspectorOpen()} aria-label={m.spdInspectorOpen()} onclick={() => openInSpd(target)}>
          <ExternalLink size={12} />
        </button>
        <button class="pix-btn-reset" type="button" title={m.spdInspectorRefresh()} aria-label={m.spdInspectorRefresh()} onclick={() => load(target)}>
          <RefreshCw size={12} />
        </button>
        <button class="pix-btn-reset" type="button" title={m.spdInspectorClose()} aria-label={m.spdInspectorClose()} onclick={close}>
          <X size={13} />
        </button>
      </div>
    </header>

    <div class="inspector-body">
      {#if loading}
        <div class="state"><span class="busy-dot"></span>{m.spdInspectorLoading()}</div>
      {:else if error}
        <div class="state error">
          <div>{m.spdInspectorError()}</div>
          <div class="mono error-text">{error}</div>
          <button class="pix-btn small" type="button" onclick={() => load(target)}>{m.spdInspectorRetry()}</button>
        </div>
      {:else if record}
        <div class="id-row">
          <code>{target.id}</code>
          <button class="pix-btn-reset copy-btn" type="button" onclick={copyId} title={m.spdInspectorCopyId()}>
            <Copy size={10} /> {copied ? m.spdInspectorCopied() : m.spdInspectorCopyId()}
          </button>
        </div>

        <h4>{m.spdInspectorOverview()}</h4>
        <div class="overview">
          {#each overview as row (row.key)}
            <div class="kv"><span>{row.key}</span><code>{row.value}</code></div>
          {/each}
          {#if target.kind === 'vector' && sequenceLength !== null}
            <div class="kv"><span>sequenceLength</span><code>{sequenceLength}</code></div>
          {/if}
          {#if target.kind === 'gene' && dnaSequenceLength !== null}
            <div class="kv"><span>dnaSequenceLength</span><code>{dnaSequenceLength}</code></div>
          {/if}
          {#if target.kind === 'gene' && rnaSequenceLength !== null}
            <div class="kv"><span>rnaSequenceLength</span><code>{rnaSequenceLength}</code></div>
          {/if}
        </div>

        <h4>{m.spdInspectorLinks()} <span class="count">{relations.length}</span></h4>
        {#if relations.length}
          <div class="relation-list">
            {#each relations as relation (relation.id)}
              {@const otherKind = inspectorKindForEntityType(relation.other.type)}
              <div class="relation-row">
                <span class="relation-dir" title={relation.direction}>{relation.direction === 'out' ? '→' : '←'}</span>
                <span class="relation-type">{relation.relationType}</span>
                {#if otherKind}
                  <button
                    class="link-btn relation-target"
                    type="button"
                    title={relation.other.id}
                    onclick={() => spdInspector.open(otherKind, relation.other.id, relation.other.label ?? undefined)}
                  >{relationLabel(relation)}</button>
                {:else}
                  <code class="relation-target" title={relation.other.id}>{relationLabel(relation)}</code>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty">{m.spdInspectorNoLinks()}</div>
        {/if}

        {#if target.kind === 'sequence' && lineage.length}
          <h4>{m.spdInspectorLineage()} <span class="count">{lineage.length}</span></h4>
          <div class="lineage-chain">
            {#each lineage as node, index (node.id)}
              {#if index > 0}<span class="lineage-sep">›</span>{/if}
              <button
                class="link-btn lineage-node"
                class:current={node.id === target.id}
                type="button"
                title={node.id}
                onclick={() => spdInspector.open('sequence', node.id, node.sequenceRole ?? undefined)}
              >{node.sequenceRole || node.id.slice(-8)}</button>
            {/each}
          </div>
        {/if}

        {#if target.kind === 'sequence' && tree && tree.nodeCount > 1}
          <h4>{m.spdInspectorVariants()} <span class="count">{tree.nodeCount - 1}</span></h4>
          <div class="variant-list">
            {#each tree.nodes.filter((node) => node.id !== target.id).slice(0, 12) as node (node.id)}
              <button
                class="link-btn variant-row"
                type="button"
                title={node.id}
                onclick={() => spdInspector.open('sequence', node.id, node.sequenceRole ?? undefined)}
              >
                <span class="variant-depth">d{node.depth ?? 0}</span>
                <span>{node.id.slice(-8)}</span>
                <span class="variant-mutations">
                  {node.sequenceRole ?? ''}{mutationCount(node.mutations) ? ` · ${m.spdInspectorMutations({ v1: String(mutationCount(node.mutations)) })}` : ''}
                </span>
              </button>
            {/each}
          </div>
        {/if}

        {#if target.kind === 'gene'}
          <h4>{m.spdInspectorGeneRegions()} <span class="count">{geneRegionRows.length}</span></h4>
          {#if geneRegionRows.length}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>molecule</th><th>regionType</th><th>start</th><th>end</th>
                    <th>strand</th><th>description</th><th>proteinId</th>
                  </tr>
                </thead>
                <tbody>
                  {#each geneRegionRows as row, index (index)}
                    <tr>
                      <td>{row.molecule}</td><td>{row.regionType}</td><td>{row.start}</td>
                      <td>{row.end}</td><td>{row.strand}</td><td>{row.description}</td>
                      <td>
                        {#if row.proteinId}
                          <button class="link-btn" type="button" onclick={() => spdInspector.open('protein', row.proteinId)}>
                            {row.proteinId}
                          </button>
                        {:else}—{/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}<div class="empty">{m.spdInspectorNoGeneRegions()}</div>{/if}
        {/if}

        {#if target.kind === 'vector'}
          <h4>{m.spdInspectorFeatures()} <span class="count">{featureRows.length}</span></h4>
          {#if featureRows.length}
            <div class="table-wrap">
              <table>
                <thead><tr><th>id</th><th>type</th><th>start</th><th>end</th><th>strand</th></tr></thead>
                <tbody>
                  {#each featureRows as row, index (index)}
                    <tr><td>{row.id}</td><td>{row.type}</td><td>{row.start}</td><td>{row.end}</td><td>{row.strand}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}<div class="empty">{m.spdInspectorNoFeatures()}</div>{/if}

          <h4>{m.spdInspectorSites()} <span class="count">{siteRows.length}</span></h4>
          {#if siteRows.length}
            <div class="table-wrap">
              <table>
                <thead><tr><th>id</th><th>position</th></tr></thead>
                <tbody>
                  {#each siteRows as row, index (index)}
                    <tr><td>{row.id}</td><td>{row.position}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}<div class="empty">{m.spdInspectorNoSites()}</div>{/if}

          <h4>{m.spdInspectorSuppliers()} <span class="count">{supplierRows.length}</span></h4>
          {#if supplierRows.length}
            <div class="table-wrap">
              <table>
                <thead><tr><th>organization</th><th>catalog</th><th>order</th></tr></thead>
                <tbody>
                  {#each supplierRows as row, index (index)}
                    <tr><td>{row.name}</td><td>{row.catalog}</td><td>{row.order}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}<div class="empty">{m.spdInspectorNoSuppliers()}</div>{/if}

          {#if record.provenance !== undefined}
            <h4>{m.spdInspectorProvenance()}</h4>
            <pre>{pretty(record.provenance)}</pre>
          {/if}
        {/if}

        {#if target.kind === 'fold'}
          <h4>{m.spdInspectorEvidence()} <span class="count">{evidenceTotal}</span></h4>
          {#if evidenceTotal}
            <div class="evidence-grid">
              {#each evidenceRows as row (row.key)}
                <div class="kv"><span>{row.key}</span><code>{row.count}</code></div>
              {/each}
            </div>
          {:else}
            <div class="empty">{m.spdInspectorNoEvidence()}</div>
          {/if}

          <h4>{m.spdInspectorRelated()}</h4>
          <div class="related-grid">
            {#if related?.sequence}
              <div class="related-card">
                <strong>{m.spdInspectorSequence()}</strong>
                {#each ['id', 'length', 'sequenceRole', 'proteinId', 'sha256'] as key (key)}
                  {#if related.sequence[key] !== undefined}
                    <div class="kv">
                      <span>{key}</span>
                      {#if key === 'proteinId' && typeof related.sequence[key] === 'string'}
                        <button class="link-btn" type="button" onclick={() => spdInspector.open('protein', String(related?.sequence?.[key] ?? ''))}>
                          {text(related.sequence[key])} <ExternalLink size={9} />
                        </button>
                      {:else}
                        <code>{text(related.sequence[key])}</code>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
            {#if related?.environment}
              <div class="related-card">
                <strong>environment</strong>
                {#each ['ph', 'temperatureK', 'pressureBar', 'ionicStrengthM', 'protonationModel'] as key (key)}
                  {#if related.environment[key] !== undefined}
                    <div class="kv"><span>{key}</span><code>{text(related.environment[key])}</code></div>
                  {/if}
                {/each}
              </div>
            {/if}
            {#if related?.model}
              <div class="related-card">
                <strong>model</strong>
                {#each ['modelName', 'modelVersion', 'inferenceRuntime', 'inferenceCodeVersion', 'checkpointSha256'] as key (key)}
                  {#if related.model[key] !== undefined}
                    <div class="kv"><span>{key}</span><code>{text(related.model[key])}</code></div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
          <div class="json-sections">
            {#if record.prediction !== undefined}<details><summary>{m.spdInspectorPrediction()}</summary><pre>{pretty(record.prediction)}</pre></details>{/if}
            {#if record.derivedMetrics !== undefined}<details><summary>{m.spdInspectorMetrics()}</summary><pre>{pretty(record.derivedMetrics)}</pre></details>{/if}
            {#if record.runtimeMetadata !== undefined}<details><summary>{m.spdInspectorRuntime()}</summary><pre>{pretty(record.runtimeMetadata)}</pre></details>{/if}
            {#if record.artifactIds !== undefined}<details><summary>{m.spdInspectorArtifacts()}</summary><pre>{pretty(record.artifactIds)}</pre></details>{/if}
          </div>
        {/if}

        {#if target.kind === 'enzyme' && record.metadata !== undefined}
          <h4>{m.spdInspectorRaw()}</h4>
          <pre>{pretty(record.metadata)}</pre>
        {/if}

        {#if provenance.length}
          <h4>{m.spdInspectorSources()} <span class="count">{provenance.length}</span></h4>
          <div class="source-list">
            {#each provenance as snapshot, index (snapshot.id ?? index)}
              <div class="kv">
                <span>{snapshot.source ?? 'source'}</span>
                <code>{[snapshot.sourceId, snapshot.license, timeText('sourceFetchedAt', snapshot.fetchedAt)].filter(Boolean).join(' · ')}</code>
              </div>
            {/each}
          </div>
        {/if}

        <details class="raw">
          <summary>{m.spdInspectorRaw()}</summary>
          <pre>{pretty(record)}</pre>
        </details>
      {/if}
    </div>
  </section>
{/if}

<style>
  .spd-inspector {
    position: fixed;
    z-index: 140;
    width: min(470px, calc(100vw - 24px));
    max-height: min(72vh, 720px);
    display: flex;
    flex-direction: column;
    font-family: var(--pix-font);
    font-size: 10px;
    border: 2px solid var(--pix-border);
    box-shadow: 0 0 0 1px #000, 6px 6px 0 rgba(0, 0, 0, 0.4);
  }
  .inspector-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 6px;
    border-bottom: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    cursor: move;
    user-select: none;
    touch-action: none;
  }
  .inspector-title { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--pix-fg); }
  .inspector-title .kind { color: var(--pix-cyan); font-weight: bold; white-space: nowrap; }
  .inspector-title .name { color: var(--pix-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inspector-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
  .inspector-actions button { padding: 2px 4px; color: var(--pix-fg-dim); border: 1px solid transparent; }
  .inspector-actions button:hover { color: var(--pix-cyan); border-color: var(--pix-border); }
  .inspector-body { overflow: auto; overscroll-behavior: contain; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .state { display: flex; align-items: center; gap: 6px; color: var(--pix-fg-dim); padding: 6px 2px; }
  .state.error { flex-direction: column; align-items: flex-start; color: var(--pix-red); }
  .error-text { word-break: break-word; color: var(--pix-fg-dim); font-size: 9px; }
  .busy-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pix-cyan); animation: pulse 900ms infinite alternate; }
  @keyframes pulse { from { opacity: 0.3; } to { opacity: 1; } }
  .id-row { display: flex; align-items: center; gap: 4px; border: 1px solid var(--pix-border); padding: 3px 4px; background: var(--pix-bg-2); }
  .id-row code { flex: 1; min-width: 0; word-break: break-all; color: var(--pix-cyan); }
  .copy-btn { padding: 1px 4px; font-size: 8px; white-space: nowrap; color: var(--pix-fg-dim); }
  h4 { margin: 4px 0 0; color: var(--pix-fg-dim); text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.04em; }
  .count { color: var(--pix-cyan); margin-left: 3px; }
  .overview { display: flex; flex-direction: column; gap: 2px; }
  .kv { display: grid; grid-template-columns: minmax(86px, 0.42fr) 1fr; gap: 6px; align-items: start; }
  .kv span { color: var(--pix-fg-dim); word-break: break-word; }
  .kv code { color: var(--pix-fg); word-break: break-all; }
  .table-wrap { max-height: 180px; overflow: auto; border: 1px solid var(--pix-border); }
  table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
  th, td { text-align: left; padding: 2px 4px; border-bottom: 1px solid var(--pix-border); vertical-align: top; }
  th { position: sticky; top: 0; background: var(--pix-bg-2); color: var(--pix-fg-dim); font-weight: normal; }
  td { word-break: break-word; }
  .empty { color: var(--pix-fg-dim); font-style: italic; padding: 2px; }
  .related-grid { display: flex; flex-direction: column; gap: 4px; }
  .related-card { border: 1px solid var(--pix-border); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
  .related-card strong { color: var(--pix-green); text-transform: uppercase; font-size: 8px; }
  .link-btn { display: inline-flex; align-items: center; gap: 3px; padding: 0; border: 0; background: none; color: var(--pix-cyan); font: inherit; text-align: left; word-break: break-all; cursor: pointer; }
  .link-btn:hover { text-decoration: underline; }
  .relation-list { display: flex; flex-direction: column; gap: 2px; }
  .relation-row { display: grid; grid-template-columns: 12px minmax(84px, 0.5fr) 1fr; gap: 5px; align-items: baseline; }
  .relation-dir { color: var(--pix-fg-dim); text-align: center; }
  .relation-type { color: var(--pix-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .relation-target { min-width: 0; word-break: break-all; color: var(--pix-fg); }
  button.relation-target { color: var(--pix-cyan); }
  .lineage-chain { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px; }
  .lineage-sep { color: var(--pix-fg-dim); }
  .lineage-node { border: 1px solid var(--pix-border); padding: 1px 4px; font-size: 8.5px; color: var(--pix-fg-dim); }
  .lineage-node:hover { border-color: var(--pix-cyan); text-decoration: none; }
  .lineage-node.current { color: var(--pix-cyan); border-color: var(--pix-cyan); }
  .evidence-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; }
  .variant-list { display: flex; flex-direction: column; gap: 1px; }
  .variant-row { display: grid; grid-template-columns: 22px 74px 1fr; gap: 5px; align-items: baseline; text-align: left; }
  .variant-depth { color: var(--pix-fg-dim); }
  .variant-mutations { color: var(--pix-fg-dim); font-size: 8.5px; }
  .source-list { display: flex; flex-direction: column; gap: 2px; }
  .json-sections { display: flex; flex-direction: column; gap: 2px; }
  details { border: 1px solid var(--pix-border); padding: 3px 4px; }
  summary { cursor: pointer; color: var(--pix-fg-dim); }
  pre { margin: 4px 0 0; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 8.5px; color: var(--pix-fg); }
  .raw { margin-top: 2px; }
</style>
