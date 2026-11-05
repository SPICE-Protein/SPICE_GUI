// Bounded tool-calling loop for the Co-Pilot.
//
// The loop is intentionally small and auditable: every model step is one chat
// completion, tools run sequentially, write tools require explicit approval,
// and the conversation is trimmed to the model window before each step.

import {
  AiRequestError,
  streamChatCompletion,
  type AiChatConfig,
  type AiChatMessage,
} from './client';
import { estimateTokens, trimAgentConversation } from './context';
import { redactForAudit, type AuditEntry } from './audit';
import type {
  AgentTool,
  AgentToolPermission,
  AgentToolResult,
  AgentWorkspaceContext,
} from './tools';

export interface AgentApprovalRequest {
  tool: AgentTool;
  title: string;
  permission: AgentToolPermission;
  args: Record<string, unknown>;
  preview: string;
}

export interface AgentToolEvent {
  tool: AgentTool;
  approved?: boolean;
  result?: AgentToolResult;
}

export interface AgentToolRecord {
  name: string;
  args: Record<string, unknown>;
  permission: AgentToolPermission;
  approved?: boolean;
  ok: boolean;
  summary: string;
  undoAvailable: boolean;
}

export type AgentAuditRecord = Omit<AuditEntry, 'id' | 'at'> & { at?: string };

export interface AgentRunOptions {
  config: AiChatConfig;
  messages: AiChatMessage[];
  tools: AgentTool[];
  context: AgentWorkspaceContext;
  maxSteps?: number;
  contextTokens?: number;
  reserveTokens?: number;
  signal?: AbortSignal;
  requestApproval?: (request: AgentApprovalRequest) => Promise<boolean>;
  onStepStart?: (step: number) => void;
  onToken?: (delta: string, full: string) => void;
  onToolStart?: (event: AgentToolEvent) => void;
  onToolEnd?: (event: AgentToolEvent) => void;
  audit?: (record: AgentAuditRecord) => void;
}

export interface AgentRunResult {
  content: string;
  steps: number;
  toolCalls: AgentToolRecord[];
  toolEvents: AgentToolEvent[];
  messages: AiChatMessage[];
  stoppedReason: 'complete' | 'max-steps';
}

function parseArguments(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toolResultPayload(result: AgentToolResult): string {
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    data: result.data ?? null,
  }).slice(0, 8000);
}

function failed(summary: string): AgentToolResult {
  return { ok: false, summary };
}

function unknownTool(name: string): AgentTool {
  return {
    name,
    definition: {
      type: 'function',
      function: { name, description: 'Unknown tool', parameters: { type: 'object', properties: {} } },
    },
    permission: 'read',
    execute: () => failed(`Unknown tool: ${name}`),
  };
}

/** Run one user turn to completion, allowing up to `maxSteps` model calls. */
export async function runAgentTurn(options: AgentRunOptions): Promise<AgentRunResult> {
  const maxSteps = Math.max(1, options.maxSteps ?? 6);
  const conversation: AiChatMessage[] = [...options.messages];
  const records: AgentToolRecord[] = [];
  const toolEvents: AgentToolEvent[] = [];
  const definitions = options.tools.map((tool) => tool.definition);
  // Tool schemas travel with every request and consume context budget too.
  const toolTokens = definitions.reduce(
    (sum, tool) => sum + estimateTokens(JSON.stringify(tool)) + 8,
    0,
  );
  let lastContent = '';

  for (let step = 1; step <= maxSteps; step += 1) {
    if (options.signal?.aborted) {
      throw new AiRequestError('network', 'request cancelled');
    }

    options.onStepStart?.(step - 1);

    const result = await streamChatCompletion(
      options.config,
      trimAgentConversation(
        conversation,
        options.contextTokens,
        (options.reserveTokens ?? 1024) + toolTokens,
      ),
      {
        signal: options.signal,
        tools: definitions,
        toolChoice: 'auto',
        onToken: options.onToken,
      },
    );
    lastContent = result.content;

    if (!result.toolCalls.length) {
      return {
        content: result.content,
        steps: step,
        toolCalls: records,
        toolEvents,
        messages: [...conversation],
        stoppedReason: 'complete',
      };
    }

    conversation.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const name = call.function.name;
      const tool = options.tools.find((candidate) => candidate.definition.function.name === name)
        ?? unknownTool(name);
      const args = parseArguments(call.function.arguments);
      const permission = tool.permission;

      const finish = (
        approved: boolean | undefined,
        toolResult: AgentToolResult,
      ) => {
        const record: AgentToolRecord = {
          name,
          args: args ?? {},
          permission,
          approved,
          ok: toolResult.ok,
          summary: toolResult.summary,
          undoAvailable: toolResult.undoAvailable === true,
        };
        records.push(record);
        toolEvents.push({ tool, approved, result: toolResult });
        options.onToolEnd?.({ tool, approved, result: toolResult });
        if (permission === 'write') {
          if (!approved) {
            options.audit?.({
              kind: 'approval',
              tool: name,
              permission,
              approved: false,
              ok: false,
              summary: toolResult.summary,
              args: redactForAudit(args ?? {}),
            });
          } else {
            options.audit?.({
              kind: 'approval',
              tool: name,
              permission,
              approved: true,
              ok: true,
              summary: 'Approved by user',
              args: redactForAudit(args ?? {}),
            });
            options.audit?.({
              kind: 'applied',
              tool: name,
              permission,
              approved: true,
              ok: toolResult.ok,
              summary: toolResult.summary,
              args: redactForAudit(args ?? {}),
            });
          }
        } else {
          options.audit?.({
            kind: 'tool',
            tool: name,
            permission,
            approved,
            ok: toolResult.ok,
            summary: toolResult.summary,
            args: redactForAudit(args ?? {}),
          });
        }
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: toolResultPayload(toolResult),
        });
      };

      options.onToolStart?.({ tool });

      if (args === null) {
        finish(false, failed('Invalid arguments: tool arguments must be a JSON object'));
        continue;
      }

      let approved: boolean | undefined;
      if (permission === 'write') {
        approved = options.requestApproval
          ? await options.requestApproval({
              tool,
              title: `Approve ${name}?`,
              permission,
              args,
              preview: tool.describe?.(args, options.context) ?? tool.preview?.(args, options.context) ?? JSON.stringify(args, null, 2),
            })
          : false;
        if (!approved) {
          finish(false, failed('The user rejected this action.'));
          continue;
        }
      }

      let toolResult: AgentToolResult;
      try {
        toolResult = await tool.execute(args, options.context);
      } catch (error) {
        toolResult = failed(error instanceof Error ? error.message : String(error));
      }
      finish(approved, toolResult);
    }
  }

  return {
    content: lastContent,
    steps: maxSteps,
    toolCalls: records,
    toolEvents,
    messages: [...conversation],
    stoppedReason: 'max-steps',
  };
}
