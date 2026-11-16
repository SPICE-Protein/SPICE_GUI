import { describe, expect, it, vi } from 'vitest';
import { buildAgentTools, type AgentTool, type AgentWorkspaceContext } from '$lib/ai/tools';
import { amrCatalogFromEnvelope } from '$lib/biosec/catalog';
import { bioriskHitsToFindings } from '$lib/biosec/biorisk';
import type { AmrFinderRow, CommecStatus, RiskCatalogEnvelope } from '$lib/backend/types';
import {
  applyGenePlan,
  workspaceVersion,
  type GenePlanApplication,
  type GeneWorkspaceSnapshot
} from '$lib/gene/workspaceIntents';

function page(initial?: Partial<GeneWorkspaceSnapshot>) {
  let snapshot: GeneWorkspaceSnapshot = {
    name: 'pTEST',
    sequence: 'ATGCGTACGTAGCTAGCTAG',
    topology: 'circular',
    features: [{ id: 1, name: 'ampR', start: 1, end: 9, type: 'cds', forward: true }],
    ...initial
  };
  const apply = vi.fn((intents: unknown, expectedVersion?: string): GenePlanApplication => {
    const version = workspaceVersion(snapshot);
    if (expectedVersion && expectedVersion !== version) {
      return { ok: false, code: 'stale_workspace', message: 'stale', version };
    }
    const result = applyGenePlan(snapshot, intents);
    if (!result.ok) return { ok: false, code: result.code, message: result.message, version };
    snapshot = result.snapshot;
    return { ok: true, message: result.changes.join('\n'), version: result.version, snapshot };
  });
  return { apply, current: () => snapshot };
}

function context(host: ReturnType<typeof page>): AgentWorkspaceContext {
  const snapshot = host.current();
  return {
    workspace: 'gene',
    protein: {
      sequence: '',
      env: { ph: 7, tempK: 310, pressureBar: 1, ionicStrengthM: 0 },
      metrics: null
    },
    gene: {
      dnaSequence: snapshot.sequence,
      plasmidName: snapshot.name,
      gcContent: 50,
      codonHost: 'ecoli',
      topology: snapshot.topology,
      version: workspaceVersion(snapshot),
      features: snapshot.features.map(({ color: _color, ...feature }) => feature)
    },
    documents: [],
    memory: [],
    actions: { applyGenePlan: host.apply },
    mcpServers: []
  };
}

function tool(contextValue: AgentWorkspaceContext, name: string): AgentTool {
  const found = buildAgentTools(contextValue).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe('gene intent tools', () => {
  it('inspects the workspace and returns the version to edit against', async () => {
    const host = page();
    const ctx = context(host);
    const result = await tool(ctx, 'inspect_gene_workspace').execute({}, ctx);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      version: workspaceVersion(host.current()),
      name: 'pTEST',
      topology: 'circular',
      lengthBp: 20,
      featureCount: 1,
      features: [{ id: 1, name: 'ampR', type: 'cds', start: 1, end: 9, strand: '+' }]
    });
  });

  it('requires an inspected version before editing', async () => {
    const host = page();
    const ctx = context(host);
    const result = await tool(ctx, 'edit_gene_workspace').execute({ intents: [{ type: 'rename_construct', name: 'pX' }] }, ctx);

    expect(result.ok).toBe(false);
    expect(host.apply).not.toHaveBeenCalled();
  });

  it('applies a plan and refreshes the shared context', async () => {
    const host = page();
    const ctx = context(host);
    const version = ctx.gene.version!;
    const result = await tool(ctx, 'edit_gene_workspace').execute(
      {
        expectedVersion: version,
        intents: [
          { type: 'rename_construct', name: 'pNEW' },
          { type: 'add_feature', name: 'ori', start: 10, end: 15, featureType: 'rep_origin' }
        ]
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(host.current().name).toBe('pNEW');
    expect(ctx.gene.plasmidName).toBe('pNEW');
    expect(ctx.gene.features).toHaveLength(2);
    expect(ctx.gene.version).toBe(workspaceVersion(host.current()));
    expect(ctx.gene.version).not.toBe(version);
  });

  it('refuses a plan written against an older version and leaves the workspace alone', async () => {
    const host = page();
    const ctx = context(host);
    const stale = ctx.gene.version!;
    // The user edits the document after the model inspected it.
    host.apply([{ type: 'rename_construct', name: 'pUSER' }], stale);
    const result = await tool(ctx, 'edit_gene_workspace').execute(
      { expectedVersion: stale, intents: [{ type: 'rename_construct', name: 'pAGENT' }] },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('stale_workspace');
    expect(result.data).toMatchObject({ code: 'stale_workspace', version: workspaceVersion(host.current()) });
    expect(host.current().name).toBe('pUSER');
  });

  it('previews a stale plan as refused', () => {
    const host = page();
    const ctx = context(host);
    const preview = tool(ctx, 'edit_gene_workspace').preview!(
      { expectedVersion: 'deadbeef', intents: [{ type: 'rename_construct', name: 'pAGENT' }] },
      ctx
    );

    expect(preview).toContain('will be refused');
  });

  it('rejects an invalid intent without partially applying earlier ones', async () => {
    const host = page();
    const ctx = context(host);
    const result = await tool(ctx, 'edit_gene_workspace').execute(
      {
        expectedVersion: ctx.gene.version,
        intents: [
          { type: 'rename_construct', name: 'pPARTIAL' },
          { type: 'remove_feature', featureId: 99 }
        ]
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('feature_not_found');
    expect(host.current().name).toBe('pTEST');
  });

  it('routes apply_dna_sequence through the intent layer when it is available', async () => {
    const host = page();
    const ctx = context(host);
    const result = await tool(ctx, 'apply_dna_sequence').execute({ sequence: 'GGCC' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('feature_out_of_range');
    expect(host.current().sequence).toBe('ATGCGTACGTAGCTAGCTAG');
  });
});

describe('screen_sequence tool', () => {
  it('reports AMR spans without leaking catalog signatures', async () => {
    const host = page({ sequence: 'GGGGTCTGGAGCGCATGATTCCCC' });
    const ctx = context(host);
    const envelope: RiskCatalogEnvelope<AmrFinderRow> = {
      source: 'amrfinder',
      origin: 'network',
      version: '2026-10-29.1',
      fetchedAt: 1,
      licence: 'Public domain (US Government Work)',
      endpoint: null,
      error: null,
      records: [
        {
          gene: 'blaTEM-1',
          kind: 'AMR',
          allele: 'blaTEM-1',
          description: 'Beta-lactam',
          class: 'BETA-LACTAM',
          subclass: 'PENICILLIN',
          accession: 'WP_000000001.1',
          pattern: 'TCTGGAGCGCATGATT',
        },
      ],
    };
    ctx.riskCatalogs = [amrCatalogFromEnvelope(envelope)];
    const result = await tool(ctx, 'screen_sequence').execute({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      available: true,
      findings: [{ severity: 'warning', category: 'amr', source: 'amrfinder', start: 5, end: 20, strand: '+' }],
    });
    expect(JSON.stringify(result.data)).not.toContain('TCTGGAGCG');
    expect(JSON.stringify(result.data)).not.toContain('blaTEM-1');
  });

  it('adds a blocking biorisk hit without naming the model', async () => {
    const status: CommecStatus = {
      installed: true,
      version: '1.1.0',
      path: null,
      models: 3091,
      mustFlagModels: 807,
      fetchedAt: 1,
      licence: 'MIT (IBBIS)',
      sourceUrl: '',
      sha256: 'abc',
      error: null,
    };
    const ctx = context(page({ sequence: 'GGGGTCTGGAGCGCATGATTCCCC' }));
    ctx.riskCatalogs = [];
    ctx.biorisk = { installed: true, version: '1.1.0', models: 3091 };
    ctx.screenBiorisk = async () =>
      bioriskHitsToFindings(
        [
          {
            model: 'P02879',
            description: 'Ricin',
            mustFlag: true,
            category: 'biorisk',
            evalue: 1e-40,
            score: 120,
            coverage: 0.9,
            frame: 1,
            strand: '+',
            start: 5,
            end: 200,
          },
        ],
        status,
      );
    const result = await tool(ctx, 'screen_sequence').execute({}, ctx);
    expect(result.data).toMatchObject({
      available: true,
      findings: [{ severity: 'blocking', category: 'biorisk', source: 'commec', start: 5, end: 200, strand: '+' }],
    });
    expect(JSON.stringify(result.data)).not.toContain('P02879');
    expect(JSON.stringify(result.data)).not.toContain('Ricin');
  });

  it('says so when no catalog is loaded', async () => {
    const ctx = context(page());
    const result = await tool(ctx, 'screen_sequence').execute({}, ctx);
    expect(result.data).toMatchObject({ available: false, findings: [] });
  });
});
