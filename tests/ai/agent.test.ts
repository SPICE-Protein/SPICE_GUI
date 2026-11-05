import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStreamResult } from '$lib/ai/client';
import { runAgentTurn } from '$lib/ai/agent';
import type { AgentTool, AgentWorkspaceContext } from '$lib/ai/tools';

vi.mock('$lib/ai/client', () => ({
  streamChatCompletion: vi.fn(),
}));

import { streamChatCompletion } from '$lib/ai/client';

const mockedStream = vi.mocked(streamChatCompletion);

function context(): AgentWorkspaceContext {
  return {
    workspace: 'gene',
    protein: {
      sequence: 'MKTA',
      env: { ph: 7, tempK: 310, pressureBar: 1, ionicStrengthM: 0 },
      metrics: null,
    },
    gene: { dnaSequence: 'ATGC', plasmidName: 'pTEST', gcContent: 50, codonHost: 'ecoli' },
    documents: [],
    memory: [],
    actions: {},
    mcpServers: [],
  };
}

function definition(name: string) {
  return {
    type: 'function' as const,
    function: { name, description: name, parameters: { type: 'object', properties: {} } },
  };
}

function readTool(execute = vi.fn(() => ({ ok: true, summary: 'read ok', data: { value: 42 } }))): AgentTool {
  return { name: 'read_thing', permission: 'read', definition: definition('read_thing'), execute };
}

function writeTool(execute = vi.fn(() => ({ ok: true, summary: 'wrote ok' }))): AgentTool {
  return {
    name: 'write_thing',
    permission: 'write',
    definition: definition('write_thing'),
    describe: () => 'Change the thing.',
    execute,
  };
}

function toolCallResult(name: string, args: unknown, id = 'call_1'): AiStreamResult {
  return {
    content: '',
    toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    finishReason: 'tool_calls',
  };
}

function finalResult(content: string): AiStreamResult {
  return { content, toolCalls: [], finishReason: 'stop' };
}

const CONFIG = { endpoint: 'http://localhost/v1/chat/completions', model: 'test' };
const MESSAGES = [{ role: 'user' as const, content: 'hello' }];

beforeEach(() => {
  mockedStream.mockReset();
});

describe('runAgentTurn', () => {
  it('executes a read tool and feeds the result back before answering', async () => {
    mockedStream
      .mockResolvedValueOnce(toolCallResult('read_thing', { query: 'x' }))
      .mockResolvedValueOnce(finalResult('The answer is 42.'));
    const audit = vi.fn();

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool()],
      context: context(),
      audit,
    });

    expect(result.content).toBe('The answer is 42.');
    expect(result.stoppedReason).toBe('complete');
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0].result).toMatchObject({ ok: true, summary: 'read ok' });
    expect(result.messages.some((message) => message.role === 'tool')).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'tool',
      tool: 'read_thing',
      permission: 'read',
      ok: true,
    }));
    expect(mockedStream.mock.calls[1][1].some((message) => message.role === 'tool')).toBe(true);
  });

  it('rejects a write tool when no approval handler exists', async () => {
    const execute = vi.fn(() => ({ ok: true, summary: 'wrote' }));
    mockedStream
      .mockResolvedValueOnce(toolCallResult('write_thing', { value: 1 }))
      .mockResolvedValueOnce(finalResult('I did not change anything.'));
    const audit = vi.fn();

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [writeTool(execute)],
      context: context(),
      audit,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.toolEvents[0].result).toMatchObject({ ok: false });
    expect(result.toolEvents[0].approved).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'approval', approved: false }));
  });

  it('executes an approved write tool and records an applied audit entry', async () => {
    const execute = vi.fn(() => ({ ok: true, summary: 'wrote' }));
    mockedStream
      .mockResolvedValueOnce(toolCallResult('write_thing', { value: 2 }))
      .mockResolvedValueOnce(finalResult('Done.'));
    const audit = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue(true);

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [writeTool(execute)],
      context: context(),
      requestApproval,
      audit,
    });

    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      preview: 'Change the thing.',
      args: { value: 2 },
    }));
    expect(execute).toHaveBeenCalledWith({ value: 2 }, expect.anything());
    expect(result.toolEvents[0].approved).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'applied', tool: 'write_thing' }));
  });

  it('does not execute a write tool when the user rejects it', async () => {
    const execute = vi.fn(() => ({ ok: true, summary: 'wrote' }));
    mockedStream
      .mockResolvedValueOnce(toolCallResult('write_thing', { value: 3 }))
      .mockResolvedValueOnce(finalResult('Cancelled.'));
    const requestApproval = vi.fn().mockResolvedValue(false);

    await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [writeTool(execute)],
      context: context(),
      requestApproval,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('returns malformed tool arguments to the model instead of crashing', async () => {
    mockedStream
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'bad', type: 'function', function: { name: 'read_thing', arguments: '{not json' } }],
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce(finalResult('Recovered.'));
    const execute = vi.fn(() => ({ ok: true, summary: 'should not run' }));

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool(execute)],
      context: context(),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.content).toBe('Recovered.');
    expect(result.toolEvents[0].result?.summary).toContain('Invalid arguments');
  });

  it('turns tool exceptions into model-visible failures', async () => {
    const execute = vi.fn(() => {
      throw new Error('calculator exploded');
    });
    mockedStream
      .mockResolvedValueOnce(toolCallResult('read_thing', {}))
      .mockResolvedValueOnce(finalResult('The tool failed.'));

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool(execute)],
      context: context(),
    });

    expect(result.toolEvents[0].result).toEqual({ ok: false, summary: 'calculator exploded' });
  });

  it('stops at the configured step limit', async () => {
    mockedStream.mockResolvedValue(toolCallResult('read_thing', {}));

    const result = await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool()],
      context: context(),
      maxSteps: 2,
    });

    expect(result.stoppedReason).toBe('max-steps');
    expect(result.steps).toBe(2);
    expect(result.toolEvents).toHaveLength(2);
    expect(mockedStream).toHaveBeenCalledTimes(2);
  });

  it('reports the step index to token callbacks', async () => {
    mockedStream
      .mockResolvedValueOnce(toolCallResult('read_thing', {}))
      .mockResolvedValueOnce(finalResult('done'));
    const onToken = vi.fn();
    const onStepStart = vi.fn();

    await runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool()],
      context: context(),
      onToken,
      onStepStart,
    });

    expect(onStepStart.mock.calls.map(([step]) => step)).toEqual([0, 1]);
  });

  it('propagates transport cancellation', async () => {
    mockedStream.mockRejectedValueOnce(new Error('request cancelled'));

    await expect(runAgentTurn({
      config: CONFIG,
      messages: MESSAGES,
      tools: [readTool()],
      context: context(),
    })).rejects.toThrow('request cancelled');
  });
});
