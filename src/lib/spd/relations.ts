// Mapping between the inspector's six record kinds and SPD's catalog entity
// types, plus ordering helpers for the graph reads. Kept separate from the
// Svelte component so the mapping and the lineage ordering are testable.
import type { SpdInspectorKind } from './inspector.svelte';
import type { SpdLineageNode, SpdRelation } from './types';

/** Catalog type accepted by /entities/{type}/{id}/…; the inspector's `enzyme`
 *  is `restriction-enzyme` on the server, and vectors are plain `vector`. */
const KIND_TO_TYPE: Record<SpdInspectorKind, string> = {
  vector: 'vector',
  protein: 'protein',
  fold: 'fold',
  enzyme: 'restriction-enzyme',
  artifact: 'artifact',
  gene: 'gene',
  sequence: 'sequence',
};

/** Reverse map: which relation targets this inspector can open itself. Types
 *  without an entry (validation, pdb-entry, pathway, reaction, …) render as a
 *  plain id instead of a link. */
const TYPE_TO_KIND: Record<string, SpdInspectorKind> = {
  vector: 'vector',
  protein: 'protein',
  fold: 'fold',
  'restriction-enzyme': 'enzyme',
  enzyme: 'enzyme',
  artifact: 'artifact',
  gene: 'gene',
  sequence: 'sequence',
};

export function entityTypeForKind(kind: SpdInspectorKind): string {
  return KIND_TO_TYPE[kind];
}

export function inspectorKindForEntityType(type: string): SpdInspectorKind | null {
  return TYPE_TO_KIND[type] ?? null;
}

/** Display label for a relation's far side: the server-provided label when it
 *  has one, otherwise the id. A label such as "198 aa" is more useful than the
 *  id it belongs to. */
export function relationLabel(relation: SpdRelation): string {
  return relation.other.label || relation.other.subtitle || relation.other.id;
}

/** Ancestor chain in root-first order. The server already returns it that way,
 *  so this only has to survive a shuffled response: nodes are ordered by their
 *  distance from the root (0 = no parent present), ties keep the server order.
 *  A missing parent or a cycle therefore leaves the row where it arrived
 *  instead of dropping it. */
export function lineageChain(nodes: SpdLineageNode[]): SpdLineageNode[] {
  if (nodes.length <= 1) return [...nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  function depth(node: SpdLineageNode, seen: Set<string>): number {
    const parentId = node.parentSequenceId;
    if (!parentId) return 0;
    const parent = byId.get(parentId);
    if (!parent || seen.has(parent.id)) return 0;
    return 1 + depth(parent, new Set([...seen, node.id]));
  }

  return nodes
    .map((node, index) => ({ node, index, depth: depth(node, new Set([node.id])) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.node);
}
