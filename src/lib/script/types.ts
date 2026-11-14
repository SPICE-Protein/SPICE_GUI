// Types for the Lua scripting layer.
//
// A script runs in a dedicated Web Worker with a Lua 5.4 VM (wasmoon). The VM
// has no IO, OS, package, or debug library: everything it can touch is the
// `spice` table assembled in `lua.worker.ts`, and document changes never apply
// directly — they come back as a patch the user reviews.

export const SCRIPT_API_VERSION = 1;
export const SCRIPT_STORAGE_KEY = 'spice_lua_scripts';
export const SCRIPT_TIMEOUT_MS = 15_000;
export const SCRIPT_MAX_SOURCE_BYTES = 200_000;
export const SCRIPT_MAX_VALUE_BYTES = 2_000_000;

/** Permissions a script can request. Read is implied by receiving the document
 *  snapshot; write only allows returning a patch, never a silent mutation. */
export const SCRIPT_PERMISSIONS = ['doc:read', 'doc:write'] as const;
export type ScriptPermission = (typeof SCRIPT_PERMISSIONS)[number];

export type ScriptLogLevel = 'log' | 'warn' | 'error';

export interface ScriptFeatureSnapshot {
  name: string;
  start: number;
  end: number;
  type: string;
  strand: '+' | '-';
}

/** Read-only view of the document handed to the script. */
export interface ScriptDocumentSnapshot {
  kind: 'gene';
  name: string;
  sequence: string;
  topology: 'circular' | 'linear';
  features: ScriptFeatureSnapshot[];
}

/** Patch a script can propose. Applied through the page's normal edit path so
 *  undo, dirty tracking, and project write-back keep working. */
export interface ScriptPatch {
  sequence?: string;
  name?: string;
}

export interface SpiceScript {
  id: string;
  name: string;
  description: string;
  source: string;
  permissions: ScriptPermission[];
  createdAt: string;
  updatedAt: string;
  /** Shipped with the app and restored on every launch; edit a copy instead. */
  builtin?: boolean;
}

export interface ScriptLogEntry {
  level: ScriptLogLevel;
  message: string;
}

export interface ScriptRunOptions {
  name: string;
  source: string;
  permissions: ScriptPermission[];
  document: ScriptDocumentSnapshot;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  onLog?: (entry: ScriptLogEntry) => void;
}

export interface ScriptRunResult {
  ok: boolean;
  valueText?: string;
  logs: ScriptLogEntry[];
  error?: string;
  durationMs: number;
  timedOut?: boolean;
  patch?: ScriptPatch;
}

/** Messages exchanged with the Lua worker. */
export interface ScriptWorkerRun {
  type: 'run';
  name: string;
  source: string;
  permissions: ScriptPermission[];
  document: ScriptDocumentSnapshot;
  args: Record<string, unknown>;
}

export type ScriptWorkerResponse =
  | { type: 'log'; entry: ScriptLogEntry }
  | { type: 'done'; valueText?: string; patch?: ScriptPatch; error?: string }
  | { type: 'fatal'; error: string };
