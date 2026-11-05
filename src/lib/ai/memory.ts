// Durable, user-editable memory for the Co-Pilot.
//
// Memories are explicit facts the agent was asked to remember ("our lab uses
// BL21(DE3)", "this construct is for pH 5.5"). They are stored locally and are
// injected only when lexically relevant, never as silent instructions.

export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

const STORAGE_KEY = 'spice_ai_memory_v1';
const MAX_ENTRIES = 200;
const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function makeId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTags(tags: unknown): string[] {
  const raw = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,;]/) : [];
  return [...new Set(raw
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 12);
}

export function loadMemory(): MemoryEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry
        && typeof entry.id === 'string'
        && typeof entry.text === 'string'
        && entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        tags: normalizeTags(entry.tags),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      }))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveMemory(entries: MemoryEntry[]): MemoryEntry[] {
  const clean = entries.slice(0, MAX_ENTRIES);
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // A full localStorage must not break the chat.
    }
  }
  return clean;
}

export function addMemory(
  entries: MemoryEntry[],
  text: string,
  tags: unknown = [],
): MemoryEntry[] {
  const cleanText = String(text ?? '').trim();
  if (!cleanText) return entries;
  const duplicate = entries.find((entry) => entry.text.toLowerCase() === cleanText.toLowerCase());
  if (duplicate) return entries;
  return saveMemory([
    {
      id: makeId(),
      text: cleanText.slice(0, 2000),
      tags: normalizeTags(tags),
      createdAt: new Date().toISOString(),
    },
    ...entries,
  ]);
}

export function removeMemory(entries: MemoryEntry[], id: string): MemoryEntry[] {
  return saveMemory(entries.filter((entry) => entry.id !== id));
}

function tokens(text: string): string[] {
  const lower = String(text ?? '').toLowerCase();
  const out = new Set<string>();
  for (const match of lower.matchAll(/[a-z0-9]+|[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]+/gu)) {
    const token = match[0];
    if (CJK.test(token)) {
      if (token.length <= 4) out.add(token);
      for (let i = 0; i + 1 < token.length; i += 1) out.add(token.slice(i, i + 2));
    } else if (token.length >= 2) {
      out.add(token);
    }
  }
  return [...out];
}

/** Rank memories by lexical overlap with the query. */
export function searchMemory(query: string, entries: MemoryEntry[], limit = 5): MemoryEntry[] {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  return entries
    .map((entry) => {
      const haystack = `${entry.text} ${entry.tags.join(' ')}`.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (haystack.includes(token)) score += token.length >= 3 ? 2 : 1;
      }
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
