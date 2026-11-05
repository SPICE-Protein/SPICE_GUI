// Token-budgeted context assembly for the Co-Pilot.
//
// Exact tokenization is model-specific; the Co-Pilot only needs a stable,
// conservative estimate to avoid dropping the system prompt or the current
// question. CJK characters are counted as one token, other characters as a
// quarter token, which over-estimates English and under-estimates dense code.

import type { AiChatMessage } from './client';

export const DEFAULT_CONTEXT_TOKENS = 8192;

const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of String(text ?? '')) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

export interface BuildChatPayloadOptions {
  systemPrompt: string;
  /** Older turns, oldest first. */
  history: AiChatMessage[];
  /** The current user turn, already wrapped with workspace context. */
  userContent: string;
  /** Total prompt+completion window exposed by the model. */
  contextTokens?: number;
  /** Tokens reserved for the model's reply. */
  reserveTokens?: number;
}

export interface BuiltChatPayload {
  messages: AiChatMessage[];
  estimatedTokens: number;
  droppedMessages: number;
}

/** Build the final message list, dropping the oldest history first until the
 *  prompt fits. The system prompt and current user turn are never dropped. */
/** Trim an in-progress tool-calling conversation. Newest turns win, but the
 *  system prompt and the assistant message that owns a kept tool result are
 *  always preserved. */
export function trimAgentConversation(
  messages: AiChatMessage[],
  contextTokens = DEFAULT_CONTEXT_TOKENS,
  reserveTokens = 1024,
): AiChatMessage[] {
  const total = Math.max(512, contextTokens);
  const reserve = Math.max(0, Math.min(reserveTokens, total - 256));
  const budget = total - reserve;
  if (messages.reduce((sum, message) => sum + estimateTokens(message.content) + 6, 0) <= budget) {
    return messages;
  }

  let used = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(messages[index].content) + 6;
    if (used + cost > budget && start < messages.length) break;
    used += cost;
    start = index;
  }

  // A tool result is only valid alongside the assistant tool_calls message.
  while (start > 1 && messages[start]?.role === 'tool') start -= 1;

  const system = messages[0]?.role === 'system' ? [messages[0]] : [];
  const tailStart = Math.max(start, system.length);
  return [...system, ...messages.slice(tailStart)];
}

export function buildChatPayload(options: BuildChatPayloadOptions): BuiltChatPayload {
  const contextTokens = Math.max(512, options.contextTokens ?? DEFAULT_CONTEXT_TOKENS);
  const reserveTokens = Math.max(0, Math.min(options.reserveTokens ?? 1024, contextTokens - 256));
  const budget = Math.max(256, contextTokens - reserveTokens);

  const system: AiChatMessage = { role: 'system', content: options.systemPrompt };
  const current: AiChatMessage = { role: 'user', content: options.userContent };
  const history = options.history.filter((message) => message.content.trim());

  const fixedTokens = estimateTokens(system.content) + estimateTokens(current.content);
  let used = fixedTokens;
  const kept: AiChatMessage[] = [];

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const cost = estimateTokens(message.content) + 4;
    if (used + cost > budget) break;
    kept.unshift(message);
    used += cost;
  }

  return {
    messages: [system, ...kept, current],
    estimatedTokens: used,
    droppedMessages: history.length - kept.length,
  };
}
