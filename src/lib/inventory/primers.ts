// One-time import of the former Gene Editor primer LIMS store.
//
// Older builds kept primers under `spice_primer_inventory` with a shape of
// { id, name, sequence, tm, concentration, volume, location }. The Lab
// inventory is now the single registry, so those records are converted into
// regular `kind: 'primer'` items the first time the Lab page opens. The legacy
// key is left untouched, so a failed migration never destroys the source.

import { normalizeInventoryItem, type InventoryItem, type InventoryLocation } from './types';

export const PRIMER_LEGACY_STORAGE_KEY = 'spice_primer_inventory';
export const PRIMER_MIGRATION_KEY = 'spice_primer_inventory_migrated';

const POSITION_PATTERN = /^[A-Z]\d{1,2}$/i;

/**
 * Split a free-form legacy location into structured slots.
 *
 * Examples:
 * - `Box A - A3`          -> { box: 'Box A', position: 'A3' }
 * - `A3`                  -> { position: 'A3' }
 * - `Freezer 1/Rack 2/A3` -> { freezer: 'Freezer 1', rack: 'Rack 2', position: 'A3' }
 */
export function parseLegacyLocation(value: string): InventoryLocation {
  const parts = value
    .split(/\s*[-/,]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};

  const location: InventoryLocation = {};
  if (POSITION_PATTERN.test(parts[parts.length - 1])) {
    location.position = parts.pop();
  }
  if (parts.length === 1) {
    location.box = parts[0];
  } else if (parts.length === 2) {
    location.rack = parts[0];
    location.box = parts[1];
  } else if (parts.length >= 3) {
    location.freezer = parts[0];
    location.rack = parts.slice(1, -1).join(' / ');
    location.box = parts[parts.length - 1];
  }
  return location;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Convert one legacy primer record; invalid entries return null. */
export function legacyPrimerToInventoryItem(raw: unknown): InventoryItem | null {
  const source = record(raw);
  if (!source) return null;

  const name = text(source.name);
  const sequence = text(source.sequence)?.toUpperCase().replace(/[^ACGTN]/g, '');
  if (!name || !sequence) return null;

  const legacyId = text(source.id);
  const location = parseLegacyLocation(text(source.location) ?? '');
  const volume = number(source.volume) ?? 50;
  const concentration = number(source.concentration) ?? 100;

  return normalizeInventoryItem({
    id: legacyId ? `inv_primer_${legacyId}` : undefined,
    kind: 'primer',
    name,
    sequence,
    concentration,
    concentrationUnit: 'µM',
    quantity: volume,
    quantityUnit: 'µL',
    location,
    status: 'available',
    qc: 'untested',
    tags: ['lims-migrated'],
    parentIds: [],
  });
}

/** Convert a whole legacy array, dropping invalid records. */
export function migrateLegacyPrimers(raw: unknown): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(legacyPrimerToInventoryItem)
    .filter((item): item is InventoryItem => item !== null);
}
