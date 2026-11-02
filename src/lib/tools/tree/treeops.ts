// Tree transformations used by the beautify controls. Every operation returns
// a fresh tree so the Svelte layer can assign it and invalidate derived state.
import type { ResolvedMetadata, TreeNode } from './types';

export function cloneTree(node: TreeNode): TreeNode {
  return {
    id: node.id,
    name: node.name,
    length: node.length,
    support: node.support,
    comment: node.comment,
    children: node.children.map(cloneTree)
  };
}

export function walkTree(node: TreeNode, fn: (n: TreeNode, parent: TreeNode | null) => void, parent: TreeNode | null = null): void {
  fn(node, parent);
  for (const child of node.children) walkTree(child, fn, node);
}

export function findNode(root: TreeNode, id: string): TreeNode | null {
  let found: TreeNode | null = null;
  walkTree(root, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

export function buildParentMap(root: TreeNode): Map<string, string | null> {
  const map = new Map<string, string | null>();
  walkTree(root, (node, parent) => map.set(node.id, parent?.id ?? null));
  return map;
}

export function collectLeafNodes(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  walkTree(root, (node) => {
    if (node.children.length === 0) out.push(node);
  });
  return out;
}

export function descendantLeafCount(node: TreeNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + descendantLeafCount(child), 0);
}

export function isDescendantOf(ancestor: TreeNode, id: string): boolean {
  let found = false;
  walkTree(ancestor, (node) => {
    if (node.id === id) found = true;
  });
  return found;
}

export function ancestorPath(root: TreeNode, id: string): string[] {
  const path: string[] = [];
  const parents = buildParentMap(root);
  let cursor: string | null | undefined = id;
  while (cursor) {
    path.push(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return path;
}

function minLeafName(node: TreeNode, cache: Map<string, string>): string {
  const hit = cache.get(node.id);
  if (hit !== undefined) return hit;
  let value: string;
  if (node.children.length === 0) {
    value = node.name || '';
  } else {
    value = node.children
      .map((child) => minLeafName(child, cache))
      .reduce((best, current) => (current < best ? current : best), String.fromCharCode(0xffff));
  }
  cache.set(node.id, value);
  return value;
}

export function ladderizeTree(root: TreeNode, descending = false): TreeNode {
  const nameCache = new Map<string, string>();
  const sizeCache = new Map<string, number>();
  function size(node: TreeNode): number {
    const hit = sizeCache.get(node.id);
    if (hit !== undefined) return hit;
    const value = node.children.length === 0
      ? 1
      : node.children.reduce((sum, child) => sum + size(child), 0);
    sizeCache.set(node.id, value);
    return value;
  }
  const cloned = cloneTree(root);
  function apply(node: TreeNode): void {
    for (const child of node.children) apply(child);
    node.children.sort((a, b) => {
      const diff = size(a) - size(b);
      if (diff !== 0) return descending ? -diff : diff;
      const nameDiff = minLeafName(a, nameCache).localeCompare(minLeafName(b, nameCache));
      return descending ? -nameDiff : nameDiff;
    });
  }
  apply(cloned);
  return cloned;
}

function groupIndex(group: string | null, order: string[]): number {
  if (!group) return order.length;
  const index = order.indexOf(group);
  return index < 0 ? order.length : index;
}

export function sortTreeAlphabetically(root: TreeNode): TreeNode {
  const cache = new Map<string, string>();
  const cloned = cloneTree(root);
  function apply(node: TreeNode): void {
    for (const child of node.children) apply(child);
    node.children.sort((a, b) => {
      const aLeaf = a.children.length === 0 ? a.name : minLeafName(a, cache);
      const bLeaf = b.children.length === 0 ? b.name : minLeafName(b, cache);
      return aLeaf.localeCompare(bLeaf);
    });
  }
  apply(cloned);
  return cloned;
}

export function sortTreeByGroup(root: TreeNode, metadata: ResolvedMetadata): TreeNode {
  const cache = new Map<string, string>();
  const groupCache = new Map<string, string | null>();
  const cloned = cloneTree(root);
  function groupOf(node: TreeNode): string | null {
    const hit = groupCache.get(node.id);
    if (hit !== undefined) return hit;
    let result: string | null = null;
    if (node.children.length === 0) {
      result = metadata.byLeaf[node.name]?.group ?? null;
    } else {
      let found: string | null | undefined;
      result = null;
      let same = true;
      for (const child of node.children) {
        const group = groupOf(child);
        if (group == null) {
          same = false;
          break;
        }
        if (found === undefined) found = group;
        else if (found !== group) {
          same = false;
          break;
        }
      }
      if (same && found !== undefined) result = found;
    }
    groupCache.set(node.id, result);
    return result;
  }
  function apply(node: TreeNode): void {
    for (const child of node.children) apply(child);
    node.children.sort((a, b) => {
      const diff = groupIndex(groupOf(a), metadata.groupOrder) - groupIndex(groupOf(b), metadata.groupOrder);
      if (diff !== 0) return diff;
      return minLeafName(a, cache).localeCompare(minLeafName(b, cache));
    });
  }
  apply(cloned);
  return cloned;
}

export function rotateChildren(root: TreeNode, nodeId: string): TreeNode {
  const cloned = cloneTree(root);
  const target = findNode(cloned, nodeId);
  if (target && target.children.length > 1) {
    target.children.push(target.children.shift() as TreeNode);
  }
  return cloned;
}

/**
 * Re-root the tree at the midpoint of the longest root-to-leaf path.
 * Returns null when no positive branch length is available.
 */
export function midpointRoot(root: TreeNode): TreeNode | null {
  interface Edge {
    node: TreeNode;
    length: number;
  }
  const adjacency = new Map<string, Edge[]>();
  const byId = new Map<string, TreeNode>();
  walkTree(root, (node) => {
    byId.set(node.id, node);
    if (!adjacency.has(node.id)) adjacency.set(node.id, []);
  });
  walkTree(root, (node) => {
    for (const child of node.children) {
      const length = Math.max(0, child.length ?? 0);
      adjacency.get(node.id)?.push({ node: child, length });
      adjacency.get(child.id)?.push({ node, length });
    }
  });

  // Find the farthest leaf and its path.
  let farthest: TreeNode | null = null;
  let farthestDistance = 0;
  const parents = new Map<string, string | null>();
  const distances = new Map<string, number>();

  function visit(node: TreeNode, parentId: string | null, distance: number): void {
    parents.set(node.id, parentId);
    distances.set(node.id, distance);
    if (node.children.length === 0) {
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = node;
      }
      return;
    }
    for (const child of node.children) {
      visit(child, node.id, distance + Math.max(0, child.length ?? 0));
    }
  }
  visit(root, null, 0);

  if (!farthest || farthestDistance <= 0) return null;

  const path: TreeNode[] = [];
  let cursor: string | null | undefined = (farthest as TreeNode).id;
  while (cursor) {
    const node = byId.get(cursor);
    if (!node) break;
    path.push(node);
    cursor = parents.get(cursor) ?? null;
  }
  path.reverse();
  if (path.length < 2) return null;

  const target = farthestDistance / 2;
  let splitIndex = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const before = distances.get(path[i].id) ?? 0;
    const after = distances.get(path[i + 1].id) ?? 0;
    if (before <= target && target <= after) {
      splitIndex = i;
      break;
    }
  }

  const left = path[splitIndex];
  const right = path[splitIndex + 1];
  const before = distances.get(left.id) ?? 0;
  const after = distances.get(right.id) ?? 0;
  const leftLength = target - before;
  const rightLength = after - target;

  const usedIds = new Set<string>();
  walkTree(root, (node) => usedIds.add(node.id));
  let rootId = 'root-midpoint';
  let suffix = 1;
  while (usedIds.has(rootId)) rootId = `root-midpoint-${suffix++}`;

  function buildDirected(node: TreeNode, fromId: string | null): TreeNode {
    const copy: TreeNode = {
      id: node.id,
      name: node.name,
      length: null,
      support: node.support,
      comment: node.comment,
      children: []
    };
    for (const edge of adjacency.get(node.id) ?? []) {
      if (edge.node.id === fromId) continue;
      const child = buildDirected(edge.node, node.id);
      child.length = edge.length;
      copy.children.push(child);
    }
    return copy;
  }

  const leftSide = buildDirected(left, right.id);
  const rightSide = buildDirected(right, left.id);
  leftSide.length = leftLength;
  rightSide.length = rightLength;

  return {
    id: rootId,
    name: '',
    length: null,
    support: null,
    comment: null,
    children: [leftSide, rightSide]
  };
}

export function expandAncestors(
  root: TreeNode,
  id: string,
  collapsed: Set<string>
): Set<string> {
  const next = new Set(collapsed);
  const parents = buildParentMap(root);
  let cursor: string | null | undefined = parents.get(id) ?? null;
  while (cursor) {
    next.delete(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  next.delete(id);
  return next;
}

export function nodeCount(root: TreeNode): number {
  let count = 0;
  walkTree(root, () => count++);
  return count;
}
