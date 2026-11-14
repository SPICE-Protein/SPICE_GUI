// SPICE_INVENTORY file schema and pure helpers for the local lab inventory.
// The in-memory shape is plain JSON so it can be persisted to localStorage or
// exported as a standalone .json document. Nothing here touches Svelte, the
// DOM, or the filesystem — validation and normalization stay testable.

export const INVENTORY_FORMAT = 'SPICE_INVENTORY';
export const INVENTORY_VERSION = '1.0';
/** Files written by older builds (format/version absent) stay readable. */
export const INVENTORY_ACCEPTED_VERSIONS = ['1.0'] as const;

export const INVENTORY_KINDS = ['strain', 'plasmid', 'primer', 'reagent', 'sample'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const INVENTORY_STATUSES = ['available', 'low', 'depleted', 'quarantine', 'archived'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_QC_STATUSES = ['untested', 'passed', 'failed'] as const;
export type QcStatus = (typeof INVENTORY_QC_STATUSES)[number];

export interface InventoryLocation {
  freezer?: string;
  rack?: string;
  box?: string;
  position?: string;
}

export interface InventoryItem {
  id: string;
  kind: InventoryKind;
  name: string;
  alias?: string;
  description?: string;
  organism?: string;
  genotype?: string;
  /** Raw sequence for plasmids/primers; free text for anything else. */
  sequence?: string;
  concentration?: number;
  concentrationUnit?: string;
  quantity: number;
  quantityUnit: string;
  location: InventoryLocation;
  status: InventoryStatus;
  qc: QcStatus;
  tags: string[];
  /** Optional links back into the project layer. */
  projectId?: string;
  docId?: string;
  /** Other inventory items this one derives from (plasmid -> strain, ...). */
  parentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpiceInventoryFile {
  format: typeof INVENTORY_FORMAT;
  version: typeof INVENTORY_VERSION;
  meta: InventoryMeta;
  items: InventoryItem[];
}

export type InventoryValidationResult =
  | { ok: true; file: SpiceInventoryFile }
  | { ok: false; error: string };

export interface InventoryFilter {
  kinds?: readonly InventoryKind[];
  statuses?: readonly InventoryStatus[];
  qc?: readonly QcStatus[];
  /** Every requested tag must be present (case-insensitive). */
  tags?: readonly string[];
  projectId?: string;
  /** Match items that list this id as a direct parent. */
  parentId?: string;
}

export interface InventoryStats {
  total: number;
  available: number;
  low: number;
  depleted: number;
  quarantine: number;
  archived: number;
  byKind: Record<InventoryKind, number>;
  byStatus: Record<InventoryStatus, number>;
  byQc: Record<QcStatus, number>;
}

export function newInventoryId(prefix = 'inv'): string {
  const p = prefix.trim() || 'inv';
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isInventoryKind(value: unknown): value is InventoryKind {
  return typeof value === 'string' && (INVENTORY_KINDS as readonly string[]).includes(value);
}

export function isInventoryStatus(value: unknown): value is InventoryStatus {
  return typeof value === 'string' && (INVENTORY_STATUSES as readonly string[]).includes(value);
}

export function isQcStatus(value: unknown): value is QcStatus {
  return typeof value === 'string' && (INVENTORY_QC_STATUSES as readonly string[]).includes(value);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isoOr(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = optionalText(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeLocation(raw: unknown): InventoryLocation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: InventoryLocation = {};
  for (const key of ['freezer', 'rack', 'box', 'position'] as const) {
    const text = optionalText(source[key]);
    if (text) out[key] = text;
  }
  return out;
}

/** Fill every optional field with a safe default. Returns null when the
 *  payload cannot describe an item (missing/blank name). */
export function normalizeInventoryItem(raw: unknown): InventoryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const name = optionalText(source.name);
  if (!name) return null;
  const now = new Date().toISOString();
  const createdAt = isoOr(source.createdAt, now);
  const item: InventoryItem = {
    id: optionalText(source.id) ?? newInventoryId(),
    kind: isInventoryKind(source.kind) ? source.kind : 'sample',
    name,
    quantity: Math.max(0, optionalNumber(source.quantity) ?? 0),
    quantityUnit: optionalText(source.quantityUnit) ?? 'unit',
    location: normalizeLocation(source.location),
    status: isInventoryStatus(source.status) ? source.status : 'available',
    qc: isQcStatus(source.qc) ? source.qc : 'untested',
    tags: uniqueStrings(source.tags),
    parentIds: uniqueStrings(source.parentIds),
    createdAt,
    updatedAt: isoOr(source.updatedAt, createdAt)
  };
  const alias = optionalText(source.alias);
  if (alias) item.alias = alias;
  const description = optionalText(source.description);
  if (description) item.description = description;
  const organism = optionalText(source.organism);
  if (organism) item.organism = organism;
  const genotype = optionalText(source.genotype);
  if (genotype) item.genotype = genotype;
  const sequence = optionalText(source.sequence);
  if (sequence) item.sequence = sequence;
  const concentration = optionalNumber(source.concentration);
  if (concentration !== undefined && concentration >= 0) item.concentration = concentration;
  const concentrationUnit = optionalText(source.concentrationUnit);
  if (concentrationUnit) item.concentrationUnit = concentrationUnit;
  const projectId = optionalText(source.projectId);
  if (projectId) item.projectId = projectId;
  const docId = optionalText(source.docId);
  if (docId) item.docId = docId;
  return item;
}

export interface CreateInventoryItemInput extends Partial<Omit<InventoryItem, 'name'>> {
  name?: string;
}

/** Build a complete item with defaults. Ids and timestamps are generated when
 *  the caller does not supply them. */
export function createInventoryItem(partial: CreateInventoryItemInput = {}): InventoryItem {
  const now = new Date().toISOString();
  const item = normalizeInventoryItem({
    ...partial,
    name: optionalText(partial.name) ?? 'Untitled',
    id: partial.id ?? newInventoryId(),
    // A newly created stock starts with one unit; legacy imports default to 0.
    quantity: partial.quantity ?? 1,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  });
  // normalize only rejects a blank name, which the fallback above prevents.
  return item as InventoryItem;
}

/** Tolerant reader: accepts the current file shape, a legacy object without
 *  format/version, or a bare item array. Invalid entries are dropped instead
 *  of failing the whole import. */
export function validateInventoryFile(raw: unknown): InventoryValidationResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: 'not an object' };

  let rawItems: unknown = [];
  let rawMeta: unknown;
  if (Array.isArray(raw)) {
    rawItems = raw;
  } else {
    const source = raw as Record<string, unknown>;
    if (source.format !== undefined && source.format !== INVENTORY_FORMAT) {
      return { ok: false, error: `format !== ${INVENTORY_FORMAT}` };
    }
    if (source.version !== undefined) {
      const version = String(source.version);
      if (!(INVENTORY_ACCEPTED_VERSIONS as readonly string[]).includes(version)) {
        return { ok: false, error: `unsupported version: ${version} (expected ${INVENTORY_ACCEPTED_VERSIONS.join(', ')})` };
      }
    }
    rawItems = source.items ?? [];
    rawMeta = source.meta;
  }

  if (!Array.isArray(rawItems)) return { ok: false, error: 'items is not an array' };

  const seen = new Set<string>();
  const items: InventoryItem[] = [];
  for (const entry of rawItems) {
    const item = normalizeInventoryItem(entry);
    if (!item) continue;
    if (seen.has(item.id)) item.id = newInventoryId();
    seen.add(item.id);
    items.push(item);
  }

  const now = new Date().toISOString();
  const metaSource = rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>)
    : {};
  const file: SpiceInventoryFile = {
    format: INVENTORY_FORMAT,
    version: INVENTORY_VERSION,
    meta: {
      name: optionalText(metaSource.name) ?? 'Inventory',
      createdAt: isoOr(metaSource.createdAt, now),
      updatedAt: isoOr(metaSource.updatedAt, now)
    },
    items
  };
  return { ok: true, file };
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of keys) out[key] = 0;
  return out;
}

export function inventoryStats(items: readonly InventoryItem[]): InventoryStats {
  const stats: InventoryStats = {
    total: items.length,
    available: 0,
    low: 0,
    depleted: 0,
    quarantine: 0,
    archived: 0,
    byKind: zeroCounts(INVENTORY_KINDS),
    byStatus: zeroCounts(INVENTORY_STATUSES),
    byQc: zeroCounts(INVENTORY_QC_STATUSES)
  };
  for (const item of items) {
    stats.byKind[item.kind] += 1;
    stats.byStatus[item.status] += 1;
    stats.byQc[item.qc] += 1;
    stats[item.status] += 1;
  }
  return stats;
}

function searchableText(item: InventoryItem): string {
  return [
    item.name,
    item.alias ?? '',
    item.description ?? '',
    item.organism ?? '',
    item.genotype ?? '',
    item.sequence ?? '',
    item.concentrationUnit ?? '',
    item.quantityUnit,
    item.projectId ?? '',
    item.docId ?? '',
    ...item.tags,
    locationLabel(item.location)
  ].join(' ').toLowerCase();
}

/** Every whitespace-separated query token must appear somewhere on the item. */
export function searchInventory(
  items: readonly InventoryItem[],
  query: string,
  filters: InventoryFilter = {}
): InventoryItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = filters.kinds?.length ? new Set(filters.kinds) : null;
  const statuses = filters.statuses?.length ? new Set(filters.statuses) : null;
  const qc = filters.qc?.length ? new Set(filters.qc) : null;
  const tags = filters.tags?.map(tag => tag.trim().toLowerCase()).filter(Boolean) ?? [];
  const projectId = filters.projectId?.trim() || null;
  const parentId = filters.parentId?.trim() || null;

  return items.filter(item => {
    if (kinds && !kinds.has(item.kind)) return false;
    if (statuses && !statuses.has(item.status)) return false;
    if (qc && !qc.has(item.qc)) return false;
    if (projectId && item.projectId !== projectId) return false;
    if (parentId && !item.parentIds.includes(parentId)) return false;
    if (tags.length) {
      const itemTags = item.tags.map(tag => tag.toLowerCase());
      if (!tags.every(tag => itemTags.includes(tag))) return false;
    }
    if (tokens.length) {
      const haystack = searchableText(item);
      if (!tokens.every(token => haystack.includes(token))) return false;
    }
    return true;
  });
}

/** Ancestors reachable through parentIds, nearest parent first. Visited ids
 *  are tracked so malformed cycles terminate instead of hanging the UI. */
export function itemLineage(items: readonly InventoryItem[], id: string): InventoryItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const seen = new Set<string>([id]);
  const lineage: InventoryItem[] = [];
  const queue: string[] = [id];
  for (let head = 0; head < queue.length; head += 1) {
    const current = byId.get(queue[head]);
    if (!current) continue;
    for (const parentId of current.parentIds) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) continue;
      lineage.push(parent);
      queue.push(parent.id);
    }
  }
  return lineage;
}

/** Human-readable freezer/rack/box/position path; empty string when unset. */
export function locationLabel(location?: InventoryLocation | null): string {
  if (!location) return '';
  return [location.freezer, location.rack, location.box, location.position]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' / ');
}
