// Model Context Protocol (stdio) client configuration for the Co-Pilot.
//
// MCP servers are arbitrary local commands. They are disabled by default, their
// tools are reviewed at approval time, and every call is recorded in the audit
// trail. The Rust side performs the JSON-RPC handshake (see src-tauri/src/mcp.rs).

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
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

export function loadMcpServers(): McpServerConfig[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((server) => server && typeof server.id === 'string' && typeof server.command === 'string')
      .map((server) => ({
        id: server.id,
        name: typeof server.name === 'string' && server.name.trim() ? server.name : server.id,
        command: server.command.trim(),
        args: Array.isArray(server.args) ? server.args.map(String) : [],
        env: server.env && typeof server.env === 'object'
          ? Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, String(value)]))
          : {},
        enabled: server.enabled !== false,
      }));
  } catch {
    return [];
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

/** Fetch tools/list from every enabled server. A broken server is reported but
 *  does not prevent other servers or the built-in tools from working. */
export async function listMcpTools(servers: McpServerConfig[]): Promise<McpToolListResult> {
  const enabled = servers.filter((server) => server.enabled && server.command.trim());
  if (!enabled.length) return { tools: [], errors: [] };

  const { invoke } = await import('@tauri-apps/api/core');
  const tools: McpToolDescriptor[] = [];
  const errors: string[] = [];
  const used = new Set<string>();

  for (const server of enabled) {
    try {
      const result = await invoke<{ tools?: unknown }>('mcp_list_tools', { server });
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
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  }>('mcp_call_tool', { server, tool: toolName, arguments: args });

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
