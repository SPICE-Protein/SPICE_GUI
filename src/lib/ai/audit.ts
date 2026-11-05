// Append-only audit trail for agent tool use.
//
// Every tool invocation, approval decision, and applied mutation is recorded
// locally so the user can inspect what the agent changed. The log is capped and
// never sent to the model.

export type AuditKind = 'tool' | 'approval' | 'applied' | 'memory';

export interface AuditEntry {
  id: string;
  at: string;
  kind: AuditKind;
  tool: string;
  permission: 'read' | 'write';
  approved?: boolean;
  ok: boolean;
  summary: string;
  args?: unknown;
}

const STORAGE_KEY = 'spice_ai_audit_v1';
const MAX_ENTRIES = 500;

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
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadAudit(): AuditEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.tool === 'string')
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveAudit(entries: AuditEntry[]): AuditEntry[] {
  const clean = entries.slice(0, MAX_ENTRIES);
  const store = storage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Audit failure must not break the active agent turn.
    }
  }
  return clean;
}

export function appendAudit(
  entries: AuditEntry[],
  entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string },
): AuditEntry[] {
  return saveAudit([
    {
      ...entry,
      id: makeId(),
      at: entry.at ?? new Date().toISOString(),
    },
    ...entries,
  ]);
}

export function clearAudit(): AuditEntry[] {
  return saveAudit([]);
}

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|credential)/i;

/** Keep audit arguments useful without persisting credentials or huge blobs. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => redactForAudit(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key) ? '[redacted]' : redactForAudit(entry, depth + 1),
    ]));
  }
  return value;
}
