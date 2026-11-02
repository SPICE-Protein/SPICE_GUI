import { describe, expect, it } from 'vitest';
import { parseNewick } from '$lib/tools/tree/newick';
import {
  ancestorPath,
  buildParentMap,
  cloneTree,
  collectLeafNodes,
  descendantLeafCount,
  expandAncestors,
  findNode,
  isDescendantOf,
  ladderizeTree,
  midpointRoot,
  nodeCount,
  rotateChildren,
  sortTreeAlphabetically,
  sortTreeByGroup,
  walkTree,
} from '$lib/tools/tree/treeops';
import type { ResolvedMetadata, TreeNode } from '$lib/tools/tree/types';

function names(node: TreeNode): string[] {
  return node.children.map((c) => c.name);
}

function allNames(root: TreeNode): string[] {
  const out: string[] = [];
  walkTree(root, (node) => out.push(node.name));
  return out;
}

describe('tree traversal helpers', () => {
  const root = parseNewick('((A:1,B:1)X:2,(C:1,D:1)Y:3)R;').root;

  it('walks every node with its parent', () => {
    const seen: Array<[string, string | null]> = [];
    walkTree(root, (node, parent) => seen.push([node.name, parent?.name ?? null]));
    expect(seen).toEqual([
      ['R', null],
      ['X', 'R'],
      ['A', 'X'],
      ['B', 'X'],
      ['Y', 'R'],
      ['C', 'Y'],
      ['D', 'Y'],
    ]);
  });

  it('finds nodes by id and builds a parent map', () => {
    const x = findNode(root, root.children[0].id)!;
    expect(x.name).toBe('X');
    expect(findNode(root, 'missing')).toBeNull();
    const parents = buildParentMap(root);
    expect(parents.get(root.children[0].id)).toBe(root.id);
    expect(parents.get(root.id)).toBeNull();
  });

  it('counts leaves and descendants', () => {
    expect(collectLeafNodes(root).map((n) => n.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(descendantLeafCount(root)).toBe(4);
    expect(descendantLeafCount(root.children[0])).toBe(2);
    expect(nodeCount(root)).toBe(7);
  });

  it('computes ancestor paths and descendant checks', () => {
    const leaf = collectLeafNodes(root).find((n) => n.name === 'A')!;
    expect(ancestorPath(root, leaf.id).map((id) => findNode(root, id)?.name)).toEqual([
      'A',
      'X',
      'R',
    ]);
    expect(isDescendantOf(root.children[0], leaf.id)).toBe(true);
    expect(isDescendantOf(root.children[1], leaf.id)).toBe(false);
  });

  it('clones deeply without sharing children', () => {
    const clone = cloneTree(root);
    expect(clone).toEqual(root);
    expect(clone).not.toBe(root);
    expect(clone.children[0]).not.toBe(root.children[0]);
    clone.children[0].name = 'changed';
    expect(root.children[0].name).toBe('X');
  });
});

describe('sorting and ladderizing', () => {
  const root = parseNewick('((B:1,A:1)Two,(E:1,D:1,C:1)Three);').root;

  it('orders sibling clades by size ascending and descending', () => {
    const ascending = ladderizeTree(root);
    expect(names(ascending)).toEqual(['Two', 'Three']);
    const descending = ladderizeTree(root, true);
    expect(names(descending)).toEqual(['Three', 'Two']);
  });

  it('breaks size ties by the smallest leaf name', () => {
    const tie = parseNewick('((B:1,A:1)Z,(D:1,C:1)Y);').root;
    // Z's smallest leaf is A, Y's is C, so ascending puts Z first.
    expect(names(ladderizeTree(tie))).toEqual(['Z', 'Y']);
    expect(names(ladderizeTree(tie, true))).toEqual(['Y', 'Z']);
  });

  it('sorts children alphabetically by their smallest leaf', () => {
    const sorted = sortTreeAlphabetically(root);
    expect(names(sorted)).toEqual(['Two', 'Three']);
    expect(names(sorted.children[0])).toEqual(['A', 'B']);
    expect(names(sorted.children[1])).toEqual(['C', 'D', 'E']);
  });

  it('sorts by metadata group order and then leaf name', () => {
    const tree = parseTree('((A:1,B:1)X,(C:1,D:1)Y,(E:1,F:1)Z);');
    const metadata: ResolvedMetadata = {
      byLeaf: {
        A: { group: 'case', color: '' },
        B: { group: 'case', color: '' },
        C: { group: 'control', color: '' },
        D: { group: 'control', color: '' },
        E: { group: 'treated', color: '' },
        F: { group: 'treated', color: '' },
      },
      groupOrder: ['control', 'treated', 'case'],
      groupColors: {},
      groupCounts: { control: 2, treated: 2, case: 2 },
      ungrouped: 0,
    };
    const sorted = sortTreeByGroup(tree, metadata);
    expect(names(sorted)).toEqual(['Y', 'Z', 'X']);
  });
});

function parseTree(text: string): TreeNode {
  return parseNewick(text).root;
}

describe('rotateChildren', () => {
  it('moves the first child to the end without mutating the source', () => {
    const root = parseNewick('(A:1,B:1,C:1);').root;
    const rotated = rotateChildren(root, root.id);
    expect(names(root)).toEqual(['A', 'B', 'C']);
    expect(names(rotated)).toEqual(['B', 'C', 'A']);
    // Rotating a leaf is a no-op, and the input is still untouched.
    const leaf = rotated.children[0];
    expect(names(rotateChildren(rotated, leaf.id))).toEqual(['B', 'C', 'A']);
    expect(names(root)).toEqual(['A', 'B', 'C']);
  });
});

describe('midpointRoot', () => {
  it('splits the longest root-to-leaf edge at its midpoint', () => {
    const root = parseNewick('((A:1,B:1)X:2,C:4);').root;
    const rerooted = midpointRoot(root)!;
    expect(rerooted).not.toBeNull();
    expect(rerooted.children).toHaveLength(2);
    expect(rerooted.children.map((c) => c.length)).toEqual([2, 2]);
    const leaves = collectLeafNodes(rerooted).map((n) => n.name).sort();
    expect(leaves).toEqual(['A', 'B', 'C']);
    // The rerooted tree is a different object graph.
    expect(rerooted).not.toBe(root);
  });

  it('returns null when no positive branch length exists', () => {
    expect(midpointRoot(parseNewick('(A,B,C);').root)).toBeNull();
    expect(midpointRoot(parseNewick('A;').root)).toBeNull();
  });
});

describe('expandAncestors', () => {
  it('removes a node and all of its ancestors from the collapsed set', () => {
    const root = parseNewick('((A:1,B:1)X:2,C:1);').root;
    const a = collectLeafNodes(root).find((n) => n.name === 'A')!;
    const x = root.children[0];
    const collapsed = new Set([root.id, x.id, a.id, 'unrelated']);
    const expanded = expandAncestors(root, a.id, collapsed);
    expect(expanded.has(a.id)).toBe(false);
    expect(expanded.has(x.id)).toBe(false);
    expect(expanded.has(root.id)).toBe(false);
    expect(expanded.has('unrelated')).toBe(true);
  });
});

describe('allNames helper sanity', () => {
  it('is empty for a named leaf except itself', () => {
    expect(allNames(parseNewick('A;').root)).toEqual(['A']);
  });
});
