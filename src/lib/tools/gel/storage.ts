// Local persistence: autosave snapshot, recent projects and style templates.
// Everything stays in this browser; a .gel.json file remains the authoritative
// backup because site data can be cleared.
import type { GelLayoutSettings, GelProject } from './types';
import { forStorage, isGelProject, migrateV1, type GelProjectV1 } from './types';
import type { LadderDef } from './ladders';
import { defaultDetectConfig, sanitizeDetectConfig, type GelDetectConfig } from './presets';
import { normalizeProject } from './projectDoc';

const SNAPSHOT_KEY = 'spice_gel_project_v2';
const LEGACY_KEY = 'spice_gel_project_v1';
const RECENT_INDEX = 'spice_gel_recent_index_v2';
const RECENT_PREFIX = 'spice_gel_recent_v2_';
const STYLES_KEY = 'spice_gel_styles_v1';
const LIBRARY_KEY = 'spice_gel_ladder_library_v1';
const DETECT_DEFAULTS_KEY = 'spice_gel_detect_defaults_v1';
const MAX_RECENT = 6;

export function loadSnapshot(): GelProject | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isGelProject(parsed)) return normalizeProject(parsed);
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsedLegacy = JSON.parse(legacy) as GelProjectV1;
      if (parsedLegacy?.version === 1 && parsedLegacy.imageDataUrl) {
        return migrateV1(parsedLegacy);
      }
    }
  } catch {
    /* corrupt snapshot: start clean */
  }
  return null;
}

export function saveSnapshot(project: GelProject): boolean {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(forStorage(project)));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

export interface RecentEntry {
  id: string;
  name: string;
  updatedAt: string;
}

export function listRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_INDEX);
    const arr = raw ? (JSON.parse(raw) as RecentEntry[]) : [];
    return Array.isArray(arr) ? arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: RecentEntry[]) {
  localStorage.setItem(RECENT_INDEX, JSON.stringify(entries.slice(0, MAX_RECENT)));
}

/** Cache a project; returns false when the browser storage is full. */
export function saveRecent(project: GelProject): boolean {
  const id = project.createdAt;
  const entry: RecentEntry = { id, name: project.imageName || project.notes || id, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(RECENT_PREFIX + id, JSON.stringify(forStorage(project)));
    const rest = listRecent().filter((e) => e.id !== id);
    const next = [entry, ...rest].slice(0, MAX_RECENT);
    // Evict the payloads that no longer fit in the index.
    for (const old of rest.slice(MAX_RECENT - 1)) localStorage.removeItem(RECENT_PREFIX + old.id);
    writeIndex(next);
    return true;
  } catch {
    return false;
  }
}

export function loadRecent(id: string): GelProject | null {
  try {
    const raw = localStorage.getItem(RECENT_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isGelProject(parsed) ? normalizeProject(parsed) : null;
  } catch {
    return null;
  }
}

export function renameRecent(id: string, name: string) {
  const list = listRecent().map((e) => (e.id === id ? { ...e, name } : e));
  writeIndex(list);
  try {
    const raw = localStorage.getItem(RECENT_PREFIX + id);
    if (raw) {
      const p = JSON.parse(raw) as GelProject;
      p.imageName = name;
      localStorage.setItem(RECENT_PREFIX + id, JSON.stringify(p));
    }
  } catch {
    /* ignore */
  }
}

export function removeRecent(id: string) {
  try {
    localStorage.removeItem(RECENT_PREFIX + id);
  } catch {
    /* ignore */
  }
  writeIndex(listRecent().filter((e) => e.id !== id));
}

export interface GelStyle {
  id: string;
  name: string;
  layout: GelLayoutSettings;
  customLadders: LadderDef[];
  favorites: string[];
  gelType: GelProject['gelType'];
  createdAt: string;
}

export function listStyles(): GelStyle[] {
  try {
    const raw = localStorage.getItem(STYLES_KEY);
    const arr = raw ? (JSON.parse(raw) as GelStyle[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveStyle(style: GelStyle): boolean {
  try {
    const rest = listStyles().filter((s) => s.id !== style.id);
    localStorage.setItem(STYLES_KEY, JSON.stringify([style, ...rest].slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

export function removeStyle(id: string) {
  try {
    localStorage.setItem(STYLES_KEY, JSON.stringify(listStyles().filter((s) => s.id !== id)));
  } catch {
    /* ignore */
  }
}

/** Detection configuration used for new imports and batch runs. Built-in
 *  presets stay read-only; this stores the user's last "save as default". */
export function loadDetectDefault(): GelDetectConfig | null {
  try {
    const raw = localStorage.getItem(DETECT_DEFAULTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; config?: unknown };
    if (parsed?.version !== 1) return null;
    return sanitizeDetectConfig(parsed.config);
  } catch {
    return null;
  }
}

export function saveDetectDefault(config: GelDetectConfig): boolean {
  try {
    localStorage.setItem(DETECT_DEFAULTS_KEY, JSON.stringify({ version: 1, config }));
    return true;
  } catch {
    return false;
  }
}

export function clearDetectDefault() {
  try {
    localStorage.removeItem(DETECT_DEFAULTS_KEY);
  } catch {
    /* ignore */
  }
}

/** Fresh imports inherit the saved default; anything else starts neutral. */
export function detectConfigForNewImport(): GelDetectConfig {
  return loadDetectDefault() ?? defaultDetectConfig();
}

export interface LadderLibrary {
  version: 1;
  custom: LadderDef[];
  favorites: string[];
}

export function loadLadderLibrary(): LadderLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { version: 1, custom: [], favorites: [] };
    const parsed = JSON.parse(raw) as LadderLibrary;
    if (parsed?.version !== 1 || !Array.isArray(parsed.custom)) return { version: 1, custom: [], favorites: [] };
    return {
      version: 1,
      custom: parsed.custom.filter(
        (l) => l && typeof l.id === 'string' && Array.isArray(l.sizes) && l.sizes.length >= 2,
      ),
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return { version: 1, custom: [], favorites: [] };
  }
}

export function saveLadderLibrary(custom: LadderDef[], favorites: string[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, custom, favorites }));
    return true;
  } catch {
    return false;
  }
}
