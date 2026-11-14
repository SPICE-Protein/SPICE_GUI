// Lua script library singleton.
//
// User scripts live in localStorage under `spice_lua_scripts`; built-ins are
// merged in on construction and never persisted. A corrupt snapshot is
// discarded instead of blocking the panel.

import { BUILTIN_SCRIPTS } from './builtins';
import { createScript, normalizeStoredScript } from './model';
import { SCRIPT_STORAGE_KEY, type SpiceScript } from './types';

const PERSIST_DELAY_MS = 400;

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class ScriptStore {
  /** Built-ins first, then user scripts in edit order. */
  scripts = $state<SpiceScript[]>([]);
  selectedId = $state<string>('');

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hydrate();
    if (!this.selectedId) this.selectedId = this.scripts[0]?.id ?? '';
  }

  private hydrate() {
    if (typeof localStorage === 'undefined') {
      this.scripts = [...BUILTIN_SCRIPTS];
      return;
    }
    const parsed = safeParse(localStorage.getItem(SCRIPT_STORAGE_KEY));
    if (parsed !== null && !Array.isArray(parsed)) {
      console.warn('[script] corrupt snapshot - reset');
      localStorage.removeItem(SCRIPT_STORAGE_KEY);
    }
    const userScripts = Array.isArray(parsed)
      ? parsed.map(normalizeStoredScript).filter((entry): entry is SpiceScript => entry !== null)
      : [];
    this.scripts = [...BUILTIN_SCRIPTS, ...userScripts];
    this.selectedId = this.scripts[0]?.id ?? '';
  }

  // ---------------- persistence ----------------

  private persistSoon() {
    if (typeof localStorage === 'undefined') return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, PERSIST_DELAY_MS);
  }

  persistNow() {
    if (typeof localStorage === 'undefined') return;
    this.persistTimer = null;
    const userScripts = this.scripts.filter((script) => !script.builtin);
    localStorage.setItem(SCRIPT_STORAGE_KEY, JSON.stringify(userScripts));
  }

  // ---------------- queries ----------------

  get(id: string): SpiceScript | null {
    return this.scripts.find((script) => script.id === id) ?? null;
  }

  get selected(): SpiceScript | null {
    return this.get(this.selectedId);
  }

  select(id: string) {
    if (this.get(id)) this.selectedId = id;
  }

  // ---------------- mutations ----------------

  add(init: Partial<Pick<SpiceScript, 'name' | 'description' | 'source' | 'permissions'>> = {}): SpiceScript {
    const script = createScript(init);
    this.scripts = [...this.scripts, script];
    this.selectedId = script.id;
    this.persistSoon();
    return script;
  }

  /** Update a user script. Built-ins are immutable; duplicate them instead. */
  update(id: string, patch: Partial<Pick<SpiceScript, 'name' | 'description' | 'source' | 'permissions'>>): SpiceScript | null {
    const index = this.scripts.findIndex((script) => script.id === id);
    if (index < 0) return null;
    const current = this.scripts[index];
    if (current.builtin) return null;
    const next: SpiceScript = {
      ...current,
      ...patch,
      name: patch.name?.trim() || current.name,
      updatedAt: new Date().toISOString(),
    };
    this.scripts = this.scripts.map((script, i) => (i === index ? next : script));
    this.persistSoon();
    return next;
  }

  duplicate(id: string): SpiceScript | null {
    const source = this.get(id);
    if (!source) return null;
    return this.add({
      name: `${source.name} (copy)`,
      description: source.description,
      source: source.source,
      permissions: source.permissions,
    });
  }

  remove(id: string): boolean {
    const target = this.get(id);
    if (!target || target.builtin) return false;
    this.scripts = this.scripts.filter((script) => script.id !== id);
    if (this.selectedId === id) this.selectedId = this.scripts[0]?.id ?? '';
    this.persistSoon();
    return true;
  }
}

export const scriptStore = new ScriptStore();
