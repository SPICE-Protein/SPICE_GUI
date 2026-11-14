import { describe, expect, it } from 'vitest';
import {
  legacyPrimerToInventoryItem,
  migrateLegacyPrimers,
  parseLegacyLocation,
} from '../../src/lib/inventory/primers';

describe('legacy primer location parsing', () => {
  it('splits a box and position', () => {
    expect(parseLegacyLocation('Box A - A3')).toEqual({ box: 'Box A', position: 'A3' });
  });

  it('keeps a bare coordinate', () => {
    expect(parseLegacyLocation('A3')).toEqual({ position: 'A3' });
  });

  it('splits freezer, rack, box, and position', () => {
    expect(parseLegacyLocation('Freezer 1/Rack 2/Box A/A3')).toEqual({
      freezer: 'Freezer 1',
      rack: 'Rack 2',
      box: 'Box A',
      position: 'A3',
    });
  });

  it('returns an empty location for blank input', () => {
    expect(parseLegacyLocation('   ')).toEqual({});
  });
});

describe('legacy primer conversion', () => {
  it('maps the old record into a primer inventory item', () => {
    const item = legacyPrimerToInventoryItem({
      id: 'p1',
      name: 'pUC19_Fwd_Seq',
      sequence: 'gttttcccagtcacgac',
      tm: 54,
      concentration: 100,
      volume: 45,
      location: 'Box A - A3',
    });

    expect(item).not.toBeNull();
    expect(item?.id).toBe('inv_primer_p1');
    expect(item?.kind).toBe('primer');
    expect(item?.sequence).toBe('GTTTTCCCAGTCACGAC');
    expect(item?.concentration).toBe(100);
    expect(item?.concentrationUnit).toBe('µM');
    expect(item?.quantity).toBe(45);
    expect(item?.quantityUnit).toBe('µL');
    expect(item?.location).toEqual({ box: 'Box A', position: 'A3' });
    expect(item?.tags).toContain('lims-migrated');
  });

  it('defaults missing volume and concentration', () => {
    const item = legacyPrimerToInventoryItem({ name: 'P', sequence: 'ACGT' });
    expect(item?.quantity).toBe(50);
    expect(item?.concentration).toBe(100);
  });

  it('drops records without a usable name or sequence', () => {
    expect(legacyPrimerToInventoryItem({ sequence: 'ACGT' })).toBeNull();
    expect(legacyPrimerToInventoryItem({ name: 'P', sequence: '   ' })).toBeNull();
    expect(legacyPrimerToInventoryItem('nope')).toBeNull();
  });

  it('filters invalid entries from a whole snapshot', () => {
    const items = migrateLegacyPrimers([
      { id: 'p1', name: 'Keep', sequence: 'ACGT' },
      { id: 'p2', name: 'Drop', sequence: '' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Keep');
    expect(migrateLegacyPrimers({})).toEqual([]);
  });
});
