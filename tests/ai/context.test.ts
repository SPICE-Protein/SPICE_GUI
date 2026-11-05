import { describe, expect, it } from 'vitest';
import { buildChatPayload, estimateTokens, trimAgentConversation } from '$lib/ai/context';
import type { AiChatMessage } from '$lib/ai/client';

function history(count: number, size = 400): AiChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${index} ${'x'.repeat(size)}`,
  }));
}

describe('estimateTokens', () => {
  it('counts CJK characters as one token and other text as a quarter', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('你好 abcd')).toBe(4);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildChatPayload', () => {
  it('keeps the system prompt and current turn, and drops oldest history first', () => {
    const built = buildChatPayload({
      systemPrompt: 'system prompt',
      history: history(20),
      userContent: 'current question',
      contextTokens: 700,
      reserveTokens: 200,
    });

    expect(built.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(built.messages.at(-1)).toEqual({ role: 'user', content: 'current question' });
    expect(built.droppedMessages).toBeGreaterThan(0);
    expect(built.estimatedTokens).toBeLessThanOrEqual(500);
    // Newest retained turn must be the last history item, not the oldest.
    expect(built.messages.at(-2)?.content).toContain('turn 19');
  });

  it('keeps every turn when the budget is generous', () => {
    const turns = history(3);
    const built = buildChatPayload({
      systemPrompt: 'system',
      history: turns,
      userContent: 'current',
      contextTokens: 8192,
      reserveTokens: 1024,
    });

    expect(built.droppedMessages).toBe(0);
    expect(built.messages).toHaveLength(5);
    expect(built.messages.slice(1, -1)).toEqual(turns);
  });

  it('drops empty history entries', () => {
    const built = buildChatPayload({
      systemPrompt: 'system',
      history: [{ role: 'user', content: '   ' }],
      userContent: 'current',
    });

    expect(built.messages).toHaveLength(2);
    expect(built.droppedMessages).toBe(0);
  });

  it('trims an in-progress tool conversation without orphaning tool results', () => {
    const messages: AiChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: 'x'.repeat(4000) },
      { role: 'user', content: 'latest question' },
    ];

    const trimmed = trimAgentConversation(messages, 600, 200);
    expect(trimmed[0].role).toBe('system');
    expect(trimmed.at(-1)?.content).toBe('latest question');
    for (let i = 1; i < trimmed.length; i += 1) {
      if (trimmed[i].role === 'tool') {
        expect(trimmed[i - 1].role).not.toBe('system');
      }
    }
  });

  it('never reserves more than the available window', () => {
    const built = buildChatPayload({
      systemPrompt: 'system',
      history: history(2),
      userContent: 'current',
      contextTokens: 512,
      reserveTokens: 100_000,
    });

    expect(built.messages[0].role).toBe('system');
    expect(built.messages.at(-1)?.content).toBe('current');
  });
});
