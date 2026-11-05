import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentTools, type AgentTool, type AgentWorkspaceContext } from '$lib/ai/tools';
import type { MemoryEntry } from '$lib/ai/memory';
import {
  registerFigureCommandHandler,
  type FigureAgentCommand,
} from '$lib/tools/figure/figureAgent';
import { CHART_PALETTE } from '$lib/tools/figure/types';

function memory(text: string, tags: string[] = []): MemoryEntry {
  return { id: `mem-${text}`, text, tags, createdAt: '2026-01-01T00:00:00.000Z' };
}

function context(overrides: Partial<AgentWorkspaceContext> = {}): AgentWorkspaceContext {
  return {
    workspace: 'gene',
    protein: {
      sequence: 'MKTA',
      env: { ph: 7, tempK: 310, pressureBar: 1, ionicStrengthM: 0 },
      metrics: null,
    },
    gene: {
      dnaSequence: 'ATGC'.repeat(15),
      plasmidName: 'pTEST',
      gcContent: 50,
      codonHost: 'ecoli',
    },
    documents: [],
    memory: [],
    actions: {},
    mcpServers: [],
    ...overrides,
  };
}

function tool(contextValue: AgentWorkspaceContext, name: string): AgentTool {
  const found = buildAgentTools(contextValue).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe('read-only agent tools', () => {
  it('returns a compact workspace snapshot', async () => {
    const ctx = context({
      documents: [{ id: 'd1', kind: 'gene', title: 'eGFP', text: 'ATGC' }],
      memory: [memory('BL21(DE3) is the expression host', ['strain'])],
    });
    const result = await tool(ctx, 'get_workspace_context').execute({}, ctx);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      workspace: 'gene',
      protein: { length: 4, sequence: 'MKTA' },
      gene: { name: 'pTEST', length: 60, gcPercent: 50 },
      documents: [{ kind: 'gene', title: 'eGFP' }],
      memories: [{ text: 'BL21(DE3) is the expression host' }],
    });
  });

  it('predicts ddG against the active protein and rejects a wrong wild type', async () => {
    const ctx = context();
    const ddg = tool(ctx, 'predict_mutation_ddg');

    const good = await ddg.execute({ position: 4, from: 'A', to: 'V' }, ctx);
    expect(good.ok).toBe(true);
    expect(good.data).toMatchObject({ position: 4, from: 'A', to: 'V' });

    const bad = await ddg.execute({ position: 3, from: 'A', to: 'V' }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain('position 3 is T');
  });

  it('analyzes DNA and designs primers', async () => {
    const ctx = context();
    const analysis = await tool(ctx, 'analyze_dna').execute({ circular: false }, ctx);
    expect(analysis.ok).toBe(true);
    expect(analysis.data).toMatchObject({ length: 60, gcPercent: 50 });

    const primers = await tool(ctx, 'design_primers').execute({}, ctx);
    expect(primers.ok).toBe(true);
    expect(primers.data).toMatchObject({
      productLength: 60,
      forward: { sequence: 'ATGCATGCATGCATGCATGC' },
    });
    expect((primers.data as { reverse: { sequence: string } }).reverse.sequence).toHaveLength(20);
  });

  it('calculates codon usage and finds ORFs', async () => {
    const ctx = context();
    const cai = await tool(ctx, 'calculate_codon_usage').execute({ host: 'human' }, ctx);
    expect(cai.ok).toBe(true);
    expect(cai.data).toMatchObject({ host: 'human', codons: 20 });

    const orfs = await tool(ctx, 'find_orfs').execute({ minLength: 30 }, ctx);
    expect(orfs.ok).toBe(true);
    expect(Array.isArray((orfs.data as { orfs: unknown[] }).orfs)).toBe(true);
  });

  it('searches project documents and memories', async () => {
    const ctx = context({
      documents: [{ id: 'd1', kind: 'journal', title: 'Expression run', text: 'BL21(DE3) at 16 °C overnight' }],
      memory: [memory('Use BL21(DE3) for this construct', ['strain'])],
    });
    const result = await tool(ctx, 'search_workspace').execute({ query: 'BL21 expression' }, ctx);

    expect(result.ok).toBe(true);
    const hits = (result.data as { title: string }[]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.title.includes('Expression'))).toBe(true);
  });
});

describe('approval-gated write tools', () => {
  it('applies DNA through the page callback and updates the live context', async () => {
    const applyDnaSequence = vi.fn();
    const ctx = context({ actions: { applyDnaSequence } });
    const apply = tool(ctx, 'apply_dna_sequence');
    expect(apply.permission).toBe('write');
    expect(apply.describe?.({ sequence: 'GGCC' }, ctx)).toContain('60 bp');

    const result = await apply.execute({ sequence: 'ggcc' }, ctx);
    expect(result.ok).toBe(true);
    expect(applyDnaSequence).toHaveBeenCalledWith('GGCC');
    expect(ctx.gene.dnaSequence).toBe('GGCC');
    expect(ctx.gene.gcContent).toBe(100);
  });

  it('rejects invalid DNA and protein sequences', async () => {
    const ctx = context({ actions: { applyDnaSequence: vi.fn(), applyProteinSequence: vi.fn() } });
    await expect(Promise.resolve(tool(ctx, 'apply_dna_sequence').execute({ sequence: 'ACGTZ' }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(tool(ctx, 'apply_protein_sequence').execute({ sequence: 'MKTAB' }, ctx)))
      .resolves.toMatchObject({ ok: false });
  });

  it('validates mutation positions against the active protein', async () => {
    const importMutations = vi.fn();
    const ctx = context({ actions: { importMutations } });
    const importTool = tool(ctx, 'import_mutations');

    await expect(Promise.resolve(importTool.execute({
      mutations: [{ pos: 1, from: 'M', to: 'V' }, { pos: 2, from: 'A', to: 'L' }],
    }, ctx))).resolves.toMatchObject({ ok: false });

    await expect(Promise.resolve(importTool.execute({
      mutations: [{ pos: 1, from: 'M', to: 'V' }],
    }, ctx))).resolves.toMatchObject({ ok: true });
    expect(importMutations).toHaveBeenCalledWith([{ pos: 1, from: 'M', to: 'V', score: undefined }]);
  });

  it('saves memory only through the registered action', async () => {
    const rememberFact = vi.fn();
    const ctx = context({ actions: { rememberFact } });
    const result = await tool(ctx, 'remember_fact').execute({
      text: 'Our lab uses BL21(DE3)',
      tags: ['strain', 'strain'],
    }, ctx);

    expect(result.ok).toBe(true);
    expect(rememberFact).toHaveBeenCalledWith('Our lab uses BL21(DE3)', ['strain', 'strain']);
  });
});

describe('figure tools', () => {
  // Figure commands queue while no handler is mounted, so every test must drain.
  afterEach(() => {
    const unregister = registerFigureCommandHandler(() => {});
    unregister();
  });

  it('exposes figure_add_chart as a write tool with a Figure Studio preview', () => {
    const ctx = context();
    const chart = tool(ctx, 'figure_add_chart');

    expect(chart.definition.function.name).toBe('figure_add_chart');
    expect(chart.permission).toBe('write');
    expect(chart.definition.function.parameters).toMatchObject({
      type: 'object',
      properties: {
        chartType: { enum: ['bar', 'line', 'scatter'] },
      },
    });

    const preview = chart.describe?.({
      name: 'Growth',
      chartType: 'line',
      labels: ['0 h', '24 h'],
      series: [{ name: 'OD600', values: [0.1, 0.8] }],
    }, ctx) ?? '';
    expect(preview).toContain('line chart');
    expect(preview).toContain('1 series');
    expect(preview).toContain('2 categories');
    expect(preview).toContain('OD600');
    expect(preview).toContain('Requires Figure Studio to be open');
  });

  it('fails clearly when Figure Studio is not mounted', async () => {
    const ctx = context();
    const result = await tool(ctx, 'figure_add_chart').execute({
      name: 'Growth',
      chartType: 'bar',
      labels: ['A', 'B'],
      series: [{ name: 'S1', values: [1, 2] }],
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Open Figure Studio');
  });

  it('normalizes and dispatches an editable chart spec', async () => {
    const received: FigureAgentCommand[] = [];
    const unregister = registerFigureCommandHandler((command) => received.push(command));
    const ctx = context();

    const result = await tool(ctx, 'figure_add_chart').execute({
      name: 'Response',
      chartType: 'bar',
      labels: [' Control ', 'Treatment'],
      series: [
        { name: 'WT', values: [1, 2, 3], errors: [-0.1, 0.2] },
        { values: [4] },
      ],
      xLabel: 'Group',
      yLabel: 'Signal',
    }, ctx);
    unregister();

    expect(result.ok).toBe(true);
    expect(result.undoAvailable).toBe(true);
    expect(result.summary).toBe('Added a bar chart with 2 series to Figure Studio');
    expect(received).toHaveLength(1);

    const dispatched = received[0];
    expect(dispatched.type).toBe('add-chart');
    expect(dispatched.spec).toMatchObject({
      name: 'Response',
      chartType: 'bar',
      labels: ['Control', 'Treatment'],
      xLabel: 'Group',
      yLabel: 'Signal',
    });
    expect(dispatched.spec.series[0]).toMatchObject({
      name: 'WT',
      values: [1, 2],
      errors: [0.1, 0.2],
      color: CHART_PALETTE[0],
    });
    expect(dispatched.spec.series[1]).toMatchObject({
      name: 'Series 2',
      values: [4, 0],
      errors: [0, 0],
      color: CHART_PALETTE[1],
    });
    expect(result.data).toMatchObject({ name: 'Response', chartType: 'bar' });
  });

  it('rejects invalid labels, series, and values without dispatching', async () => {
    const received: FigureAgentCommand[] = [];
    const unregister = registerFigureCommandHandler((command) => received.push(command));
    const ctx = context();
    const chart = tool(ctx, 'figure_add_chart');
    const base = {
      name: 'Bad',
      chartType: 'bar',
      labels: ['A', 'B'],
      series: [{ name: 'S1', values: [1, 2] }],
    };

    await expect(Promise.resolve(chart.execute({ ...base, labels: ['only'] }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({ ...base, labels: 'A,B' }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({ ...base, labels: ['A', ''] }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({ ...base, labels: [1, 2] }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({ ...base, series: [] }, ctx)))
      .resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({
      ...base,
      series: [{ name: 'S1', values: [1, Number.NaN] }],
    }, ctx))).resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({
      ...base,
      series: [{ name: 'S1', values: [1, 2], errors: [0, Number.POSITIVE_INFINITY] }],
    }, ctx))).resolves.toMatchObject({ ok: false });
    await expect(Promise.resolve(chart.execute({ ...base, chartType: 'pie' }, ctx)))
      .resolves.toMatchObject({ ok: false });

    unregister();
    expect(received).toHaveLength(0);
  });
});

describe('tool definitions', () => {
  it('exposes valid OpenAI-style function schemas', () => {
    const tools = buildAgentTools(context());
    expect(tools.length).toBeGreaterThanOrEqual(9);
    for (const entry of tools) {
      expect(entry.definition.type).toBe('function');
      expect(entry.definition.function.name).toBe(entry.name);
      expect(entry.definition.function.parameters).toMatchObject({ type: 'object' });
    }
    expect(new Set(tools.map((entry) => entry.name)).size).toBe(tools.length);
  });
});
