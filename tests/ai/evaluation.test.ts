// Scripted end-to-end evaluations for agent tool selection. These are not
// model-quality benchmarks; they pin the contract between the loop, the tool
// registry, approvals, and the editor callbacks.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStreamResult } from '$lib/ai/client';
import { runAgentTurn, type AgentAuditRecord } from '$lib/ai/agent';
import { buildAgentTools, type AgentWorkspaceContext } from '$lib/ai/tools';

vi.mock('$lib/ai/client', () => ({
  streamChatCompletion: vi.fn(),
}));

import { streamChatCompletion } from '$lib/ai/client';

const mockedStream = vi.mocked(streamChatCompletion);
const CONFIG = { endpoint: 'http://localhost/v1/chat/completions', model: 'test' };

function context(actions: AgentWorkspaceContext['actions'] = {}): AgentWorkspaceContext {
  return {
    workspace: 'gene',
    protein: {
      sequence: 'MKTA',
      env: { ph: 7, tempK: 310, pressureBar: 1, ionicStrengthM: 0 },
      metrics: null,
    },
    gene: { dnaSequence: 'ATGC'.repeat(15), plasmidName: 'pTEST', gcContent: 50, codonHost: 'ecoli' },
    documents: [],
    memory: [],
    actions,
    mcpServers: [],
  };
}

function call(name: string, args: unknown): AiStreamResult {
  return {
    content: '',
    toolCalls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    finishReason: 'tool_calls',
  };
}

function final(content: string): AiStreamResult {
  return { content, toolCalls: [], finishReason: 'stop' };
}

beforeEach(() => {
  mockedStream.mockReset();
});

describe('agent evaluation scenarios', () => {
  it('answers a workspace question by reading live context', async () => {
    mockedStream
      .mockResolvedValueOnce(call('get_workspace_context', {}))
      .mockResolvedValueOnce(final('The active protein has 4 residues.'));
    const audit: AgentAuditRecord[] = [];

    const result = await runAgentTurn({
      config: CONFIG,
      messages: [{ role: 'user', content: 'How long is the current protein?' }],
      tools: buildAgentTools(context()),
      context: context(),
      audit: (entry) => audit.push(entry),
    });

    expect(result.content).toContain('4 residues');
    expect(result.toolEvents[0].result?.data).toMatchObject({ protein: { length: 4 } });
    expect(audit).toEqual([expect.objectContaining({ tool: 'get_workspace_context', kind: 'tool', ok: true })]);
  });

  it('applies an approved DNA replacement and leaves an audit trail', async () => {
    const applyDnaSequence = vi.fn();
    const ctx = context({ applyDnaSequence });
    mockedStream
      .mockResolvedValueOnce(call('apply_dna_sequence', { sequence: 'GGCC' }))
      .mockResolvedValueOnce(final('Replaced the construct with a 4 bp sequence.'));
    const audit: AgentAuditRecord[] = [];

    const result = await runAgentTurn({
      config: CONFIG,
      messages: [{ role: 'user', content: 'Replace the gene with GGCC.' }],
      tools: buildAgentTools(ctx),
      context: ctx,
      requestApproval: async () => true,
      audit: (entry) => audit.push(entry),
    });

    expect(applyDnaSequence).toHaveBeenCalledWith('GGCC');
    expect(ctx.gene.dnaSequence).toBe('GGCC');
    expect(result.toolEvents[0].approved).toBe(true);
    expect(audit.map((entry) => entry.kind)).toEqual(['approval', 'applied']);
    expect(result.messages.at(-1)).toMatchObject({ role: 'tool', name: 'apply_dna_sequence' });
  });

  it('refuses an unapproved DNA replacement and tells the model', async () => {
    const applyDnaSequence = vi.fn();
    const ctx = context({ applyDnaSequence });
    mockedStream
      .mockResolvedValueOnce(call('apply_dna_sequence', { sequence: 'GGCC' }))
      .mockResolvedValueOnce(final('I left the sequence unchanged.'));

    await runAgentTurn({
      config: CONFIG,
      messages: [{ role: 'user', content: 'Replace the gene with GGCC.' }],
      tools: buildAgentTools(ctx),
      context: ctx,
      requestApproval: async () => false,
    });

    expect(applyDnaSequence).not.toHaveBeenCalled();
    expect(ctx.gene.dnaSequence).toBe('ATGC'.repeat(15));
  });

  it('grounds an answer in retrieved project context', async () => {
    mockedStream
      .mockResolvedValueOnce(call('search_workspace', { query: 'BL21 expression' }))
      .mockResolvedValueOnce(final('The journal says BL21(DE3) at 16 °C.'));
    const ctx = context();
    ctx.documents = [{
      id: 'journal:1',
      kind: 'journal',
      title: 'Expression run',
      text: 'BL21(DE3) at 16 °C overnight',
    }];

    const result = await runAgentTurn({
      config: CONFIG,
      messages: [{ role: 'user', content: 'What expression conditions did we use?' }],
      tools: buildAgentTools(ctx),
      context: ctx,
    });

    expect(result.toolEvents[0].result?.data).toEqual([
      expect.objectContaining({ title: 'Expression run' }),
    ]);
  });
});
