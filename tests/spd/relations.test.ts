import { describe, expect, it } from 'vitest';
import {
  entityTypeForKind,
  inspectorKindForEntityType,
  lineageChain,
  relationLabel,
} from '$lib/spd/relations';
import type { SpdLineageNode, SpdRelation } from '$lib/spd/types';

function node(id: string, parentSequenceId: string | null): SpdLineageNode {
  return { id, parentSequenceId };
}

function relation(overrides: Partial<SpdRelation['other']>): SpdRelation {
  const other = { id: 'spd:sequence:abc', type: 'sequence', ...overrides };
  return {
    id: 'derived:seq:1',
    relationType: 'sequence_of',
    direction: 'out',
    from: { id: 'spd:protein:1', type: 'protein' },
    to: { id: other.id, type: other.type },
    other,
  };
}

describe('entity type mapping', () => {
  it('uses the server catalog name for enzymes and vectors', () => {
    expect(entityTypeForKind('enzyme')).toBe('restriction-enzyme');
    expect(entityTypeForKind('vector')).toBe('vector');
    expect(entityTypeForKind('sequence')).toBe('sequence');
  });

  it('maps relation targets back to inspector kinds', () => {
    expect(inspectorKindForEntityType('restriction-enzyme')).toBe('enzyme');
    expect(inspectorKindForEntityType('protein')).toBe('protein');
    expect(inspectorKindForEntityType('sequence')).toBe('sequence');
  });

  it('leaves catalog-only types unlinked', () => {
    expect(inspectorKindForEntityType('validation')).toBeNull();
    expect(inspectorKindForEntityType('pdb-entry')).toBeNull();
    expect(inspectorKindForEntityType('pathway')).toBeNull();
  });
});

describe('relationLabel', () => {
  it('prefers the server label, then the subtitle, then the id', () => {
    expect(relationLabel(relation({ label: '198 aa' }))).toBe('198 aa');
    expect(relationLabel(relation({ subtitle: 'Escherichia coli' }))).toBe('Escherichia coli');
    expect(relationLabel(relation({}))).toBe('spd:sequence:abc');
  });
});

describe('lineageChain', () => {
  it('returns a single node unchanged', () => {
    expect(lineageChain([node('a', null)])).toEqual([node('a', null)]);
  });

  it('orders an ancestor chain root first even when rows arrive shuffled', () => {
    const chain = lineageChain([
      node('leaf', 'mid'),
      node('root', null),
      node('mid', 'root'),
    ]);
    expect(chain.map((item) => item.id)).toEqual(['root', 'mid', 'leaf']);
  });

  it('keeps a row whose parent is missing in server order', () => {
    const chain = lineageChain([node('leaf', 'absent'), node('root', null)]);
    expect(chain.map((item) => item.id)).toEqual(['leaf', 'root']);
  });

  it('stops on a cycle rather than looping forever', () => {
    const chain = lineageChain([node('a', 'b'), node('b', 'a')]);
    expect(chain.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
