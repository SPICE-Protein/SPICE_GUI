// Robinson-Foulds comparison on the leaf set shared by two trees.
//
// A split is the set of leaves on one side of an internal edge. The split is
// stored in a canonical orientation (smaller side, then lexicographic order),
// so the same bipartition obtained from either tree compares equal. Trivial
// splits (one side has fewer than two leaves) are excluded, which is the
// standard unrooted Robinson-Foulds convention and makes the result
// independent of where the root happens to sit.
import type { TreeNode } from './types';

export interface TreeComparison {
  sharedLeaves: string[];
  leavesOnlyA: string[];
  leavesOnlyB: string[];
  splitsA: number;
  splitsB: number;
  sharedSplits: number;
  uniqueA: number;
  uniqueB: number;
  /** Symmetric difference: unique splits in A plus unique splits in B. */
  rf: number;
  /** Largest possible distance for this pair (all splits different). */
  maxRf: number;
  /** rf / maxRf, 0 for identical split sets. */
  normalizedRf: number;
  identical: boolean;
  /** Canonical split keys, sorted; useful for diagnostics and tests. */
  sharedSplitKeys: string[];
  uniqueSplitKeysA: string[];
  uniqueSplitKeysB: string[];
}

interface WalkResult {
  names: Set<string>;
  splits: Set<string>;
}

function collectLeaves(root: TreeNode, out: Set<string>): void {
  if (root.children.length === 0) {
    if (root.name) out.add(root.name);
    return;
  }
  for (const child of root.children) collectLeaves(child, out);
}

function canonicalKey(side: Set<string>, all: Set<string>): string {
  const other: string[] = [];
  for (const name of all) {
    if (!side.has(name)) other.push(name);
  }
  const own = [...side].sort();
  other.sort();
  const ownFirst = own.length < other.length || (own.length === other.length && own.join('\u0001') <= other.join('\u0001'));
  return (ownFirst ? own : other).join('\u0001');
}

function walk(node: TreeNode, shared: Set<string>): WalkResult {
  const names = new Set<string>();
  const splits = new Set<string>();
  if (node.children.length === 0) {
    if (shared.has(node.name)) names.add(node.name);
    return { names, splits };
  }
  for (const child of node.children) {
    const result = walk(child, shared);
    for (const name of result.names) names.add(name);
    for (const split of result.splits) splits.add(split);
  }
  // The root has no parent edge, so only internal descendant edges are split.
  if (names.size >= 2 && shared.size - names.size >= 2) {
    splits.add(canonicalKey(names, shared));
  }
  return { names, splits };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

export function compareTrees(current: TreeNode, other: TreeNode): TreeComparison {
  const leafSetA = new Set<string>();
  const leafSetB = new Set<string>();
  collectLeaves(current, leafSetA);
  collectLeaves(other, leafSetB);

  const sharedLeaves = sorted([...leafSetA].filter((name) => leafSetB.has(name)));
  const leavesOnlyA = sorted([...leafSetA].filter((name) => !leafSetB.has(name)));
  const leavesOnlyB = sorted([...leafSetB].filter((name) => !leafSetA.has(name)));
  const shared = new Set(sharedLeaves);

  const splitsA = walk(current, shared).splits;
  const splitsB = walk(other, shared).splits;

  const sharedSplitKeys: string[] = [];
  const uniqueSplitKeysA: string[] = [];
  const uniqueSplitKeysB: string[] = [];
  for (const key of sorted(splitsA)) {
    if (splitsB.has(key)) sharedSplitKeys.push(key);
    else uniqueSplitKeysA.push(key);
  }
  for (const key of sorted(splitsB)) {
    if (!splitsA.has(key)) uniqueSplitKeysB.push(key);
  }

  const rf = uniqueSplitKeysA.length + uniqueSplitKeysB.length;
  const maxRf = splitsA.size + splitsB.size;
  return {
    sharedLeaves,
    leavesOnlyA,
    leavesOnlyB,
    splitsA: splitsA.size,
    splitsB: splitsB.size,
    sharedSplits: sharedSplitKeys.length,
    uniqueA: uniqueSplitKeysA.length,
    uniqueB: uniqueSplitKeysB.length,
    rf,
    maxRf,
    normalizedRf: maxRf > 0 ? rf / maxRf : 0,
    identical:
      rf === 0 && leavesOnlyA.length === 0 && leavesOnlyB.length === 0 && sharedLeaves.length > 0,
    sharedSplitKeys,
    uniqueSplitKeysA,
    uniqueSplitKeysB,
  };
}
