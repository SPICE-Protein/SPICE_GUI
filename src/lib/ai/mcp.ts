// Model Context Protocol client configuration for the Co-Pilot.
//
// User servers are arbitrary local commands (stdio). The built-in SPD catalog
// uses Streamable HTTP and authenticates with the SPD API token from Settings →
// Public Integrations; the token is resolved per call and never written into the
// server definition. Every MCP call is approval-gated and audited.

import { spdToken } from '$lib/spd/client';

export type McpTransport = 'stdio' | 'http';
export type McpAuth = 'none' | 'spd';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** HTTP transport endpoint. */
  url: string;
  /** Where the bearer token comes from at call time. */
  auth: McpAuth;
  enabled: boolean;
  /** Ships with the app; the URL and token source are not user-editable. */
  builtin?: boolean;
}

export const SPD_MCP_ID = 'spd_catalog';
export const SPD_MCP_URL = 'https://d-mcp.spicebio.top/mcp';

/** Built-in SPD Protein Database MCP server. */
export function spdMcpServer(enabled = true): McpServerConfig {
  return {
    id: SPD_MCP_ID,
    name: 'SPD Protein Database',
    transport: 'http',
    command: '',
    args: [],
    env: {},
    url: SPD_MCP_URL,
    auth: 'spd',
    enabled,
    builtin: true,
  };
}

export interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  /** Original MCP tool name used for tools/call. */
  name: string;
  /** OpenAI-safe function name used in the chat request. */
  callName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface McpToolListResult {
  tools: McpToolDescriptor[];
  errors: string[];
}

const STORAGE_KEY = 'spice_ai_mcp_servers_v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeServer(server: Record<string, unknown>): McpServerConfig | null {
  if (typeof server.id !== 'string' || !server.id) return null;
  const transport: McpTransport = server.transport === 'http' ? 'http' : 'stdio';
  const command = typeof server.command === 'string' ? server.command.trim() : '';
  const url = typeof server.url === 'string' ? server.url.trim() : '';
  if (transport === 'http' ? !url : !command) return null;
  return {
    id: server.id,
    name: typeof server.name === 'string' && server.name.trim() ? server.name : server.id,
    transport,
    command: transport === 'http' ? '' : command,
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    env: server.env && typeof server.env === 'object' && !Array.isArray(server.env)
      ? Object.fromEntries(Object.entries(server.env as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {},
    url: transport === 'http' ? url : '',
    auth: server.auth === 'spd' ? 'spd' : 'none',
    enabled: server.enabled !== false,
    builtin: server.builtin === true,
  };
}

export function loadMcpServers(): McpServerConfig[] {
  const store = storage();
  if (!store) return [spdMcpServer()];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    const servers = Array.isArray(parsed)
      ? parsed
        .filter((server): server is Record<string, unknown> => Boolean(server) && typeof server === 'object')
        .map(normalizeServer)
        .filter((server): server is McpServerConfig => server !== null)
      : [];
    // The built-in row is always present; its endpoint and token source come
    // from the app, while the user keeps control of the enabled flag.
    const existing = servers.find((server) => server.id === SPD_MCP_ID);
    if (!existing) return [spdMcpServer(), ...servers];
    return servers.map((server) => (server.id === SPD_MCP_ID ? spdMcpServer(server.enabled) : server));
  } catch {
    return [spdMcpServer()];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(servers));
    } catch {
      // Local persistence failure must not break the chat.
    }
  }
  return servers;
}

export function newMcpServerId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `mcp_${cryptoApi.randomUUID().slice(0, 8)}`;
  return `mcp_${Date.now().toString(36)}`;
}

/** Split a command-line argument string while preserving quoted segments. */
export function splitArgs(input: string): string[] {
  const source = String(input ?? '');
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      const next = source[index + 1];
      // Treat backslashes as escapes only before syntax characters; keep
      // Windows path separators intact.
      if (next !== undefined && (next === '"' || next === "'" || next === '\\' || /\s/.test(next))) {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function safeToolName(serverId: string, name: string, used: Set<string>): string {
  const base = `mcp__${serverId}__${name}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 60)}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function isRunnable(server: McpServerConfig): boolean {
  if (!server.enabled) return false;
  return server.transport === 'http' ? Boolean(server.url.trim()) : Boolean(server.command.trim());
}

function invokeConfig(server: McpServerConfig): McpServerConfig & { token: string } {
  return {
    ...server,
    token: server.auth === 'spd' ? spdToken() : '',
  };
}

/** Fetch tools/list from every enabled server. A broken server is reported but
 *  does not prevent other servers or the built-in tools from working. */
export async function listMcpTools(servers: McpServerConfig[]): Promise<McpToolListResult> {
  const enabled = servers.filter(isRunnable);
  if (!enabled.length) return { tools: [], errors: [] };

  const { invoke } = await import('@tauri-apps/api/core');
  const tools: McpToolDescriptor[] = [];
  const errors: string[] = [];
  const used = new Set<string>();

  for (const server of enabled) {
    if (server.auth === 'spd' && !spdToken().trim()) {
      errors.push(`${server.name}: SPD API token is not set (Settings → Public Integrations)`);
      continue;
    }
    try {
      const result = await invoke<{ tools?: unknown }>('mcp_list_tools', { server: invokeConfig(server) });
      const rawTools = Array.isArray(result?.tools) ? result.tools : [];
      for (const raw of rawTools) {
        const entry = raw as {
          name?: unknown;
          description?: unknown;
          inputSchema?: unknown;
          annotations?: { readOnlyHint?: unknown };
        };
        if (typeof entry?.name !== 'string' || !entry.name) continue;
        tools.push({
          serverId: server.id,
          serverName: server.name,
          name: entry.name,
          callName: safeToolName(server.id, entry.name, used),
          description: typeof entry.description === 'string' ? entry.description : `MCP tool ${entry.name}`,
          inputSchema: entry.inputSchema && typeof entry.inputSchema === 'object'
            ? entry.inputSchema as Record<string, unknown>
            : { type: 'object', properties: {} },
          readOnly: entry.annotations?.readOnlyHint === true,
        });
      }
    } catch (error) {
      errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { tools, errors };
}

/** Execute tools/call and flatten MCP content blocks into readable text. */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (server.auth === 'spd' && !spdToken().trim()) {
    throw new Error('SPD API token is not set (Settings → Public Integrations)');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  }>('mcp_call_tool', { server: invokeConfig(server), tool: toolName, arguments: args });

  const text = (Array.isArray(result?.content) ? result.content : [])
    .map((block) => block?.type === 'text' && typeof block.text === 'string'
      ? block.text
      : block?.type && block.type !== 'text'
        ? `[${block.type} content omitted]`
        : '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (result?.isError) throw new Error(text || 'MCP tool returned an error');
  return text || '(MCP tool returned no text content)';
}
