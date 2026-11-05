import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMcpServers, saveMcpServers, splitArgs } from '$lib/ai/mcp';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  });
});

describe('splitArgs', () => {
  it('splits plain arguments and preserves quoted segments', () => {
    expect(splitArgs('-y @modelcontextprotocol/server-filesystem "/Users/me/My Docs"'))
      .toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Docs']);
    expect(splitArgs("--name 'SPICE GUI' --flag")).toEqual(['--name', 'SPICE GUI', '--flag']);
  });

  it('handles escaped characters and empty input', () => {
    expect(splitArgs('a\\ b c')).toEqual(['a b', 'c']);
    expect(splitArgs('   ')).toEqual([]);
  });
});

describe('MCP server persistence', () => {
  it('round-trips server configuration', () => {
    const servers = [{
      id: 'mcp_1',
      name: 'Filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
      enabled: true,
    }];
    saveMcpServers(servers);
    expect(loadMcpServers()).toEqual(servers);
  });

  it('normalizes missing optional fields', () => {
    store.set('spice_ai_mcp_servers_v1', JSON.stringify([
      { id: 'x', command: 'npx' },
    ]));
    expect(loadMcpServers()).toEqual([{
      id: 'x',
      name: 'x',
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
    }]);
  });

  it('ignores corrupt storage', () => {
    store.set('spice_ai_mcp_servers_v1', 'nope');
    expect(loadMcpServers()).toEqual([]);
  });
});
