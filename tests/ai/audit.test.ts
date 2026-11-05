import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAudit, clearAudit, loadAudit } from '$lib/ai/audit';

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

describe('audit trail', () => {
  it('appends newest-first and persists', () => {
    const first = appendAudit([], {
      kind: 'tool',
      tool: 'analyze_dna',
      permission: 'read',
      ok: true,
      summary: 'Analyzed',
    });
    const second = appendAudit(first, {
      kind: 'applied',
      tool: 'apply_dna_sequence',
      permission: 'write',
      approved: true,
      ok: true,
      summary: 'Applied',
      args: { sequence: 'ATGC' },
    });

    expect(second).toHaveLength(2);
    expect(second[0].tool).toBe('apply_dna_sequence');
    expect(loadAudit()).toEqual(second);
  });

  it('clears the log', () => {
    const entries = appendAudit([], {
      kind: 'tool', tool: 'x', permission: 'read', ok: false, summary: 'failed',
    });
    expect(clearAudit()).toEqual([]);
    expect(loadAudit()).toEqual([]);
    expect(entries).toHaveLength(1);
  });

  it('ignores corrupt storage', () => {
    store.set('spice_ai_audit_v1', 'not json');
    expect(loadAudit()).toEqual([]);
  });
});
