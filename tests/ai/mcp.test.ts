import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPD_MCP_ID,
  SPD_MCP_URL,
  listMcpTools,
  loadMcpServers,
  saveMcpServers,
  spdMcpServer,
} from '$lib/ai/mcp';

const invoke = vi.fn(async (..._args: unknown[]): Promise<{ tools?: unknown }> => ({ tools: [] }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const store = new Map<string, string>();

function fakeStorage(): Storage {
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  };
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('built-in SPD server', () => {
  it('describes the streamable HTTP endpoint with token auth', () => {
    const server = spdMcpServer();
    expect(server.id).toBe(SPD_MCP_ID);
    expect(server.transport).toBe('http');
    expect(server.url).toBe(SPD_MCP_URL);
    expect(server.auth).toBe('spd');
    expect(server.builtin).toBe(true);
    expect(server.enabled).toBe(true);
    expect(server.command).toBe('');
  });

  it('appears even when no servers have been saved', () => {
    const servers = loadMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: SPD_MCP_ID, transport: 'http' });
  });

  it('keeps the user enabled flag but always restores the built-in endpoint', () => {
    saveMcpServers([{ ...spdMcpServer(false), url: 'https://wrong.example/mcp' }]);
    const builtin = loadMcpServers().find((server) => server.id === SPD_MCP_ID);
    expect(builtin?.enabled).toBe(false);
    expect(builtin?.url).toBe(SPD_MCP_URL);
  });
});

describe('SPD token hand-off', () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it('passes the SPD token per call without persisting it in the server', async () => {
    store.set('spice_spd_api_token', 'spd_live_token');
    invoke.mockResolvedValueOnce({ tools: [{ name: 'spd_search', description: 'Search' }] });

    const result = await listMcpTools([spdMcpServer()]);

    expect(result.errors).toEqual([]);
    expect(result.tools[0]).toMatchObject({ name: 'spd_search', serverId: SPD_MCP_ID });
    const sent = (invoke.mock.calls[0][1] as { server: Record<string, unknown> }).server;
    expect(sent.token).toBe('spd_live_token');
    expect(sent.transport).toBe('http');
    expect(JSON.stringify(loadMcpServers())).not.toContain('spd_live_token');
  });

  it('reports a missing token instead of calling the endpoint', async () => {
    const result = await listMcpTools([spdMcpServer()]);
    expect(result.tools).toEqual([]);
    expect(result.errors[0]).toContain('SPD API token');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('server normalisation', () => {
  it('upgrades legacy stdio entries and keeps their settings', () => {
    store.set('spice_ai_mcp_servers_v1', JSON.stringify([
      { id: 'mcp_local', name: 'Local', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'x' }, enabled: true },
    ]));
    const servers = loadMcpServers();
    expect(servers[0].id).toBe(SPD_MCP_ID);
    expect(servers[1]).toMatchObject({
      id: 'mcp_local',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      env: { TOKEN: 'x' },
      auth: 'none',
      url: '',
    });
  });

  it('drops entries that cannot run and survives broken JSON', () => {
    store.set('spice_ai_mcp_servers_v1', JSON.stringify([
      { id: 'empty' },
      { id: 'http_ok', transport: 'http', url: 'https://example.test/mcp' },
    ]));
    const ids = loadMcpServers().map((server) => server.id);
    expect(ids).toContain('http_ok');
    expect(ids).not.toContain('empty');

    store.set('spice_ai_mcp_servers_v1', '{not json');
    expect(loadMcpServers()).toHaveLength(1);
  });
});
