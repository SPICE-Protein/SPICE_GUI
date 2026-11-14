// Pure helpers for the Lua scripting layer: script records, argument parsing,
// patch validation, and result formatting. No DOM, no worker, no wasmoon, so
// the same rules run in Vitest and in the browser.

import {
  SCRIPT_MAX_SOURCE_BYTES,
  SCRIPT_MAX_VALUE_BYTES,
  SCRIPT_PERMISSIONS,
  type ScriptPatch,
  type ScriptPermission,
  type SpiceScript,
} from './types';

const IUPAC_DNA = /^[ACGTURYSWKMBDHVN]+$/i;
const PATCH_KEYS = new Set(['sequence', 'name']);

export function newScriptId(): string {
  return `script_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createScript(
  init: Partial<Pick<SpiceScript, 'name' | 'description' | 'source' | 'permissions'>> = {},
): SpiceScript {
  const now = new Date().toISOString();
  return {
    id: newScriptId(),
    name: init.name?.trim() || 'Untitled script',
    description: init.description ?? '',
    source: init.source ?? '',
    permissions: normalizePermissions(init.permissions ?? ['doc:read']),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePermissions(input: unknown): ScriptPermission[] {
  if (!Array.isArray(input)) return ['doc:read'];
  const seen = new Set<ScriptPermission>();
  for (const entry of input) {
    if ((SCRIPT_PERMISSIONS as readonly string[]).includes(entry as string)) {
      seen.add(entry as ScriptPermission);
    }
  }
  // Reading the document is the baseline; a write-only script makes no sense.
  seen.add('doc:read');
  return SCRIPT_PERMISSIONS.filter((permission) => seen.has(permission));
}

export interface ScriptValidation {
  ok: boolean;
  error?: string;
}

export function validateScript(script: Pick<SpiceScript, 'name' | 'source'>): ScriptValidation {
  if (!script.name.trim()) return { ok: false, error: 'Script name is required' };
  if (!script.source.trim()) return { ok: false, error: 'Script source is empty' };
  if (new TextEncoder().encode(script.source).length > SCRIPT_MAX_SOURCE_BYTES) {
    return { ok: false, error: `Script source exceeds ${SCRIPT_MAX_SOURCE_BYTES} bytes` };
  }
  return { ok: true };
}

/** Parse the JSON object typed into the arguments box. */
export function parseArgsText(text: string): { args: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { args: {}, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { args: {}, error: 'Arguments must be a JSON object' };
  }
  return { args: parsed as Record<string, unknown> };
}

/** Validate a patch proposed by a script. Unknown keys are rejected so a typo
 *  cannot be mistaken for a no-op. */
export function sanitizePatch(input: unknown): { patch?: ScriptPatch; error?: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'apply() expects a table' };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PATCH_KEYS.has(key)) return { error: `Unknown patch field: ${key}` };
  }

  const patch: ScriptPatch = {};
  if (record.sequence !== undefined) {
    if (typeof record.sequence !== 'string') return { error: 'patch.sequence must be a string' };
    const sequence = record.sequence.replace(/\s+/g, '').toUpperCase();
    if (!sequence) return { error: 'patch.sequence is empty' };
    if (!IUPAC_DNA.test(sequence)) {
      return { error: 'patch.sequence contains characters outside the IUPAC DNA alphabet' };
    }
    patch.sequence = sequence;
  }
  if (record.name !== undefined) {
    if (typeof record.name !== 'string') return { error: 'patch.name must be a string' };
    const name = record.name.trim();
    if (!name) return { error: 'patch.name is empty' };
    if (name.length > 120) return { error: 'patch.name is longer than 120 characters' };
    patch.name = name;
  }
  if (patch.sequence === undefined && patch.name === undefined) {
    return { error: 'apply() received an empty table' };
  }
  return { patch };
}

/** JSON-serialise a Lua return value for display. The output is capped so a
 *  runaway table cannot freeze the UI. */
export function formatScriptValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text = JSON.stringify(
      value,
      (_key, entry: unknown) => {
        if (typeof entry === 'function') return '[function]';
        if (typeof entry === 'bigint') return entry.toString();
        if (typeof entry === 'object' && entry !== null) {
          if (seen.has(entry as object)) return '[circular]';
          seen.add(entry as object);
        }
        return entry;
      },
      2,
    );
  } catch (error) {
    return `[unserialisable result: ${error instanceof Error ? error.message : String(error)}]`;
  }
  if (text === undefined) return '';
  if (text.length > SCRIPT_MAX_VALUE_BYTES) {
    return `${text.slice(0, SCRIPT_MAX_VALUE_BYTES)}\n… (truncated)`;
  }
  return text;
}

/** Rehydrate a stored script, dropping records that no longer validate. */
export function normalizeStoredScript(input: unknown): SpiceScript | null {
  if (input === null || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.name !== 'string' || typeof record.source !== 'string') return null;
  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === 'string' ? record.description : '',
    source: record.source,
    permissions: normalizePermissions(record.permissions),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  };
}
