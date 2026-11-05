import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMemory, loadMemory, removeMemory, saveMemory, searchMemory, type MemoryEntry } from '$lib/ai/memory';

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

describe('memory persistence', () => {
  it('starts empty and persists additions', () => {
    expect(loadMemory()).toEqual([]);

    const entries = addMemory([], 'Our lab uses BL21(DE3)', ['Strain', 'strain']);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      text: 'Our lab uses BL21(DE3)',
      tags: ['strain'],
    });
    expect(loadMemory()).toEqual(entries);
  });

  it('deduplicates case-insensitively and ignores blank text', () => {
    const first = addMemory([], 'Use pH 5.5');
    expect(addMemory(first, 'use ph 5.5')).toEqual(first);
    expect(addMemory(first, '   ')).toEqual(first);
  });

  it('removes entries by id', () => {
    const entries = addMemory(addMemory([], 'one'), 'two');
    const remaining = removeMemory(entries, entries[0].id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('one');
  });

  it('survives corrupt storage', () => {
    store.set('spice_ai_memory_v1', '{not json');
    expect(loadMemory()).toEqual([]);
  });
});

describe('searchMemory', () => {
  const entries: MemoryEntry[] = [
    { id: '1', text: 'Use BL21(DE3) for expression', tags: ['strain'], createdAt: '' },
    { id: '2', text: 'The pH 5.5 scan is the reference', tags: ['assay'], createdAt: '' },
    { id: '3', text: '蛋白稳定性在 pH 5.5 下下降', tags: [], createdAt: '' },
  ];

  it('ranks by lexical overlap', () => {
    expect(searchMemory('BL21 expression', entries)[0].id).toBe('1');
    expect(searchMemory('pH 5.5', entries).map((entry) => entry.id)).toEqual(['2', '3']);
  });

  it('matches CJK bigrams', () => {
    expect(searchMemory('蛋白稳定性', entries)[0].id).toBe('3');
  });

  it('returns nothing for an empty query', () => {
    expect(searchMemory('', entries)).toEqual([]);
  });
});

describe('saveMemory', () => {
  it('caps persisted entries', () => {
    const many = Array.from({ length: 250 }, (_, index) => ({
      id: String(index),
      text: `fact ${index}`,
      tags: [],
      createdAt: '',
    }));
    expect(saveMemory(many)).toHaveLength(200);
  });
});
