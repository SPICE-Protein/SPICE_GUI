import { describe, expect, it } from 'vitest';
import {
  INVENTORY_FORMAT,
  INVENTORY_VERSION,
  createInventoryItem,
  inventoryStats,
  itemLineage,
  locationLabel,
  newInventoryId,
  normalizeInventoryItem,
  searchInventory,
  validateInventoryFile,
  type InventoryItem
} from '$lib/inventory/types';

function make(partial: Partial<InventoryItem>): InventoryItem {
  return createInventoryItem(partial);
}

describe('inventory creation', () => {
  it('fills schema defaults and generates ids/timestamps', () => {
    const item = createInventoryItem({ name: '  pUC19  ', kind: 'plasmid' });

    expect(item.id).toMatch(/^inv_/);
    expect(item.name).toBe('pUC19');
    expect(item.kind).toBe('plasmid');
    expect(item.status).toBe('available');
    expect(item.qc).toBe('untested');
    expect(item.quantity).toBe(1);
    expect(item.quantityUnit).toBe('unit');
    expect(item.location).toEqual({});
    expect(item.tags).toEqual([]);
    expect(item.parentIds).toEqual([]);
    expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false);
    expect(item.createdAt).toBe(item.updatedAt);
  });

  it('supports custom id prefixes and preserves supplied fields', () => {
    expect(newInventoryId('strain')).toMatch(/^strain_/);
    expect(newInventoryId('')).toMatch(/^inv_/);

    const item = createInventoryItem({
      id: 'fixed-id',
      name: 'Top10',
      kind: 'strain',
      organism: 'E. coli',
      genotype: 'F- mcrA',
      quantity: 4,
      quantityUnit: 'vial',
      concentration: 2.5,
      concentrationUnit: 'OD600',
      location: { freezer: 'F2', box: 'B4' },
      status: 'low',
      qc: 'passed',
      tags: ['cloning'],
      projectId: 'proj_1',
      docId: 'doc_1',
      parentIds: ['parent_1']
    });

    expect(item).toMatchObject({
      id: 'fixed-id',
      organism: 'E. coli',
      genotype: 'F- mcrA',
      quantity: 4,
      quantityUnit: 'vial',
      concentration: 2.5,
      concentrationUnit: 'OD600',
      location: { freezer: 'F2', box: 'B4' },
      status: 'low',
      qc: 'passed',
      tags: ['cloning'],
      projectId: 'proj_1',
      docId: 'doc_1',
      parentIds: ['parent_1']
    });
  });

  it('defaults a missing name and drops invalid optional numbers', () => {
    const untitled = createInventoryItem();
    expect(untitled.name).toBe('Untitled');
    expect(untitled.kind).toBe('sample');

    const normalized = normalizeInventoryItem({
      name: 'Taq',
      kind: 'not-a-kind',
      quantity: -3,
      concentration: 'high'
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe('sample');
    expect(normalized?.quantity).toBe(0);
    expect(normalized?.concentration).toBeUndefined();
  });

  it('rejects payloads without a usable object or name', () => {
    expect(normalizeInventoryItem(null)).toBeNull();
    expect(normalizeInventoryItem('item')).toBeNull();
    expect(normalizeInventoryItem([])).toBeNull();
    expect(normalizeInventoryItem({ name: '   ' })).toBeNull();
  });
});

describe('inventory validation and normalization', () => {
  const validFile = {
    format: INVENTORY_FORMAT,
    version: INVENTORY_VERSION,
    meta: {
      name: 'Lab inventory',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    },
    items: [
      {
        id: 's1',
        kind: 'strain',
        name: 'DH5alpha',
        quantity: 3,
        quantityUnit: 'vial',
        location: { freezer: 'F1' },
        status: 'available',
        qc: 'passed',
        tags: ['cloning'],
        parentIds: []
      }
    ]
  };

  it('accepts a current file and normalizes item defaults', () => {
    const result = validateInventoryFile(validFile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.file.format).toBe(INVENTORY_FORMAT);
    expect(result.file.version).toBe(INVENTORY_VERSION);
    expect(result.file.meta.name).toBe('Lab inventory');
    expect(result.file.items).toHaveLength(1);
    expect(result.file.items[0]).toMatchObject({
      id: 's1',
      kind: 'strain',
      name: 'DH5alpha',
      quantity: 3,
      location: { freezer: 'F1' },
      status: 'available',
      qc: 'passed',
      tags: ['cloning']
    });
  });

  it('rejects non-objects, wrong formats, and unsupported versions', () => {
    expect(validateInventoryFile(null).ok).toBe(false);
    expect(validateInventoryFile('file').ok).toBe(false);

    const wrongFormat = validateInventoryFile({ ...validFile, format: 'SPICE_OTHER' });
    expect(wrongFormat.ok).toBe(false);
    if (!wrongFormat.ok) expect(wrongFormat.error).toContain('format');

    const wrongVersion = validateInventoryFile({ ...validFile, version: '9.9' });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) expect(wrongVersion.error).toContain('version');

    const badItems = validateInventoryFile({ ...validFile, items: 'nope' });
    expect(badItems.ok).toBe(false);
  });

  it('tolerates legacy objects and bare arrays, dropping unusable entries', () => {
    const legacy = {
      items: [
        { name: 'Taq polymerase', kind: 'enzyme', quantity: -4, tags: ['PCR', 7], parentIds: 'not-an-array' },
        { name: '   ', kind: 'plasmid' },
        { id: 'dup', name: 'First' },
        { id: 'dup', name: 'Second' }
      ]
    };

    const result = validateInventoryFile(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.file.format).toBe(INVENTORY_FORMAT);
    expect(result.file.version).toBe(INVENTORY_VERSION);
    expect(result.file.meta.name).toBe('Inventory');
    expect(result.file.items).toHaveLength(3);

    const [taq, first, second] = result.file.items;
    expect(taq.kind).toBe('sample');
    expect(taq.quantity).toBe(0);
    expect(taq.quantityUnit).toBe('unit');
    expect(taq.tags).toEqual(['PCR']);
    expect(taq.parentIds).toEqual([]);
    expect(taq.id).toMatch(/^inv_/);

    // Duplicate ids are regenerated so the store stays addressable by id.
    expect(first.id).toBe('dup');
    expect(second.id).not.toBe('dup');
    expect(second.id).not.toBe(first.id);

    // A bare item array is treated as a legacy inventory export.
    const bare = validateInventoryFile([{ name: 'Glycerol stock', kind: 'reagent' }]);
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.file.items).toHaveLength(1);
      expect(bare.file.items[0].name).toBe('Glycerol stock');
    }
  });
});

describe('inventory stats', () => {
  it('counts totals by kind, status, and qc', () => {
    const items = [
      make({ name: 'A', kind: 'strain', status: 'available', qc: 'passed' }),
      make({ name: 'B', kind: 'plasmid', status: 'low', qc: 'untested' }),
      make({ name: 'C', kind: 'plasmid', status: 'depleted', qc: 'failed' }),
      make({ name: 'D', kind: 'primer', status: 'quarantine', qc: 'passed' }),
      make({ name: 'E', kind: 'reagent', status: 'archived', qc: 'untested' })
    ];

    const stats = inventoryStats(items);
    expect(stats.total).toBe(5);
    expect(stats.available).toBe(1);
    expect(stats.low).toBe(1);
    expect(stats.depleted).toBe(1);
    expect(stats.quarantine).toBe(1);
    expect(stats.archived).toBe(1);
    expect(stats.byKind.strain).toBe(1);
    expect(stats.byKind.plasmid).toBe(2);
    expect(stats.byKind.primer).toBe(1);
    expect(stats.byKind.reagent).toBe(1);
    expect(stats.byKind.sample).toBe(0);
    expect(stats.byStatus.low).toBe(1);
    expect(stats.byQc.failed).toBe(1);
    expect(stats.byQc.passed).toBe(2);
    expect(stats.byQc.untested).toBe(2);
  });

  it('returns zeroed buckets for an empty list', () => {
    const stats = inventoryStats([]);
    expect(stats.total).toBe(0);
    expect(stats.byKind.plasmid).toBe(0);
    expect(stats.byStatus.available).toBe(0);
    expect(stats.byQc.untested).toBe(0);
  });
});

describe('inventory search and filters', () => {
  const plasmid = make({
    id: 'puc19',
    name: 'pUC19',
    kind: 'plasmid',
    alias: 'cloning vector',
    sequence: 'ATGCGTAC',
    tags: ['cloning', 'amp'],
    projectId: 'proj_1'
  });
  const strain = make({
    id: 'dh5a',
    name: 'DH5alpha',
    kind: 'strain',
    organism: 'E. coli',
    tags: ['cloning'],
    projectId: 'proj_2',
    parentIds: ['puc19']
  });
  const reagent = make({
    id: 'taq',
    name: 'Taq polymerase',
    kind: 'reagent',
    status: 'low',
    qc: 'failed',
    tags: ['pcr']
  });
  const items = [plasmid, strain, reagent];

  it('matches names, aliases, sequences, organisms, tags, and location labels', () => {
    expect(searchInventory(items, '')).toHaveLength(3);
    expect(searchInventory(items, '  ')).toHaveLength(3);
    expect(searchInventory(items, 'puc19')).toEqual([plasmid]);
    expect(searchInventory(items, 'cloning')).toHaveLength(2);
    expect(searchInventory(items, 'atgcgtac')).toEqual([plasmid]);
    expect(searchInventory(items, 'e. coli')).toEqual([strain]);
    expect(searchInventory(items, 'pcr')).toEqual([reagent]);
    expect(searchInventory(items, 'cloning vector')).toEqual([plasmid]);
    expect(searchInventory(items, 'puc19 amp')).toEqual([plasmid]);
    expect(searchInventory(items, 'puc19 missing')).toEqual([]);
  });

  it('applies kind, status, qc, tag, project, and parent filters', () => {
    expect(searchInventory(items, '', { kinds: ['plasmid'] })).toEqual([plasmid]);
    expect(searchInventory(items, '', { kinds: ['plasmid', 'strain'] })).toHaveLength(2);
    expect(searchInventory(items, '', { statuses: ['low'] })).toEqual([reagent]);
    expect(searchInventory(items, '', { qc: ['failed'] })).toEqual([reagent]);
    expect(searchInventory(items, '', { tags: ['cloning', 'amp'] })).toEqual([plasmid]);
    expect(searchInventory(items, '', { projectId: 'proj_2' })).toEqual([strain]);
    expect(searchInventory(items, '', { parentId: 'puc19' })).toEqual([strain]);
    expect(searchInventory(items, 'cloning', { kinds: ['reagent'] })).toEqual([]);
  });
});

describe('inventory lineage', () => {
  it('walks parents nearest first and stops on cycles', () => {
    const a = make({ id: 'a', name: 'A', parentIds: ['b'] });
    const b = make({ id: 'b', name: 'B', parentIds: ['c'] });
    const c = make({ id: 'c', name: 'C', parentIds: ['a'] });

    expect(itemLineage([a, b, c], 'a').map(item => item.id)).toEqual(['b', 'c']);
    expect(itemLineage([a, b, c], 'b').map(item => item.id)).toEqual(['c', 'a']);
  });

  it('guards self-cycles and unknown parents', () => {
    const self = make({ id: 'self', name: 'Self', parentIds: ['self'] });
    expect(itemLineage([self], 'self')).toEqual([]);

    const orphan = make({ id: 'orphan', name: 'Orphan', parentIds: ['missing'] });
    expect(itemLineage([orphan], 'orphan')).toEqual([]);

    const shared = make({ id: 'shared', name: 'Shared', parentIds: ['a', 'a'] });
    expect(itemLineage([shared], 'shared')).toEqual([]);
  });

  it('returns an empty ancestry for unknown ids', () => {
    expect(itemLineage([make({ id: 'a', name: 'A' })], 'nope')).toEqual([]);
  });
});

describe('inventory location labels', () => {
  it('joins the populated location fields in storage order', () => {
    expect(locationLabel({ freezer: 'F1', rack: 'R2', box: 'B3', position: 'P4' }))
      .toBe('F1 / R2 / B3 / P4');
    expect(locationLabel({ freezer: ' F1 ', position: 'P4' })).toBe('F1 / P4');
    expect(locationLabel({ rack: 'R2' })).toBe('R2');
    expect(locationLabel({})).toBe('');
    expect(locationLabel(undefined)).toBe('');
    expect(locationLabel(null)).toBe('');
  });
});
