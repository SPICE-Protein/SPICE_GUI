// SPICE local lab inventory singleton store.
//
// Items live in localStorage as a plain JSON array under
// `spice_inventory_items`. Writes are debounced (400ms) so rapid quantity
// edits do not hammer storage, matching the project store's persistence style.
//
// Rules:
// - No module-scope $effect (illegal outside components). The constructor only
//   hydrates; mutators call persistSoon().
// - A corrupt snapshot is discarded instead of blocking the UI.
import {
  PRIMER_LEGACY_STORAGE_KEY,
  PRIMER_MIGRATION_KEY,
  migrateLegacyPrimers as migrateLegacyPrimerRecords,
} from './primers';
import {
  createInventoryItem,
  normalizeInventoryItem,
  searchInventory,
  validateInventoryFile,
  INVENTORY_FORMAT,
  INVENTORY_VERSION,
  type CreateInventoryItemInput,
  type InventoryFilter,
  type InventoryItem,
  type SpiceInventoryFile
} from './types';

export const INVENTORY_STORAGE_KEY = 'spice_inventory_items';
export const INVENTORY_LOW_THRESHOLD = 1;
const PERSIST_DELAY_MS = 400;

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class InventoryStore {
  items = $state<InventoryItem[]>([]);

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hydrate();
    this.migrateLegacyPrimers();
  }

  private hydrate() {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (!raw) {
      this.items = [];
      return;
    }
    const parsed = safeParse(raw);
    // Current snapshots are a bare array; accept an { items } wrapper too.
    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? ((parsed as { items: unknown[] }).items)
        : null;
    if (!source) {
      console.warn('[inventory] corrupt snapshot - reset');
      localStorage.removeItem(INVENTORY_STORAGE_KEY);
      this.items = [];
      return;
    }
    this.items = source
      .map(entry => normalizeInventoryItem(entry))
      .filter((entry): entry is InventoryItem => entry !== null);
  }

  /** Import primers from the retired Gene Editor LIMS store exactly once. The
   *  legacy key is kept so a bad migration can still be recovered by hand. */
  private migrateLegacyPrimers() {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(PRIMER_MIGRATION_KEY)) return;
    const raw = localStorage.getItem(PRIMER_LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = safeParse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[inventory] corrupt primer snapshot - migration skipped');
      return;
    }
    const existing = new Set(this.items.map(item => item.id));
    const additions = migrateLegacyPrimerRecords(parsed).filter(item => !existing.has(item.id));
    if (additions.length > 0) {
      this.items = [...this.items, ...additions];
      this.persistNow();
    }
    localStorage.setItem(PRIMER_MIGRATION_KEY, new Date().toISOString());
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

  /** Flush immediately (lifecycle hooks, tests, export-to-disk flows). */
  persistNow() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // QuotaExceeded: the inventory is a local convenience cache; keep the
      // in-memory state usable and let the caller export explicitly.
    }
  }

  // ---------------- reads ----------------

  getById(id: string): InventoryItem | null {
    return this.items.find(item => item.id === id) ?? null;
  }

  search(query: string, filters: InventoryFilter = {}): InventoryItem[] {
    return searchInventory(this.items, query, filters);
  }

  // ---------------- mutations ----------------

  addItem(partial: CreateInventoryItemInput = {}): InventoryItem {
    const item = createInventoryItem(partial);
    this.items = [...this.items, item];
    this.persistSoon();
    return item;
  }

  updateItem(id: string, patch: Partial<InventoryItem>): InventoryItem | null {
    const index = this.items.findIndex(item => item.id === id);
    if (index < 0) return null;
    const current = this.items[index];
    const next = normalizeInventoryItem({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (!next) return null;
    const items = [...this.items];
    items[index] = next;
    this.items = items;
    this.persistSoon();
    return next;
  }

  removeItem(id: string): boolean {
    if (!this.items.some(item => item.id === id)) return false;
    this.items = this.items.filter(item => item.id !== id);
    this.persistSoon();
    return true;
  }

  /** Relative stock change. Quantity is clamped at zero. Archived and
   *  quarantined items keep their status; everything else follows stock:
   *  <= 0 depleted, <= threshold low, otherwise available. */
  adjustQuantity(id: string, delta: number, opts: { lowThreshold?: number } = {}): InventoryItem | null {
    const current = this.getById(id);
    if (!current) return null;
    const threshold =
      typeof opts.lowThreshold === 'number' && Number.isFinite(opts.lowThreshold)
        ? opts.lowThreshold
        : INVENTORY_LOW_THRESHOLD;
    const step = Number.isFinite(delta) ? delta : 0;
    const quantity = Math.max(0, current.quantity + step);
    let status = current.status;
    if (status !== 'archived' && status !== 'quarantine') {
      status = quantity <= 0 ? 'depleted' : quantity <= threshold ? 'low' : 'available';
    }
    return this.updateItem(id, { quantity, status });
  }

  // ---------------- import / export ----------------

  /** Replace the current inventory with a validated file or bare item array. */
  importText(text: string): { ok: boolean; error?: string; added?: number } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const result = validateInventoryFile(parsed);
    if (!result.ok) return { ok: false, error: result.error };
    this.items = result.file.items;
    this.persistNow();
    return { ok: true, added: this.items.length };
  }

  exportText(name = 'Inventory'): string {
    const now = new Date().toISOString();
    const file: SpiceInventoryFile = {
      format: INVENTORY_FORMAT,
      version: INVENTORY_VERSION,
      meta: { name: name.trim() || 'Inventory', createdAt: now, updatedAt: now },
      items: this.items
    };
    return JSON.stringify(file, null, 2);
  }
}

export const inventoryStore = new InventoryStore();
