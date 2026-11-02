import { describe, expect, it } from 'vitest';
import { NewickParseError, parseNewick, toNewick, type NewickErrorCode } from '$lib/tools/tree/newick';
import type { TreeNode } from '$lib/tools/tree/types';

function leafNames(node: TreeNode): string[] {
  if (node.children.length === 0) return [node.name];
  return node.children.flatMap(leafNames);
}

function describeError(input: string): NewickParseError {
  try {
    parseNewick(input);
  } catch (error) {
    expect(error).toBeInstanceOf(NewickParseError);
    return error as NewickParseError;
  }
  throw new Error(`expected parse failure for ${JSON.stringify(input)}`);
}

describe('parseNewick', () => {
  it('parses nested topology, names and branch lengths', () => {
    const { root, rooted } = parseNewick('(A:0.1,B:0.2,(C:0.3,D:0.4)E:0.5)R;');
    expect(root.name).toBe('R');
    expect(root.children).toHaveLength(3);
    expect(root.children[0]).toMatchObject({ name: 'A', length: 0.1, children: [] });
    expect(root.children[1]).toMatchObject({ name: 'B', length: 0.2, children: [] });
    const internal = root.children[2];
    expect(internal.name).toBe('E');
    expect(internal.length).toBe(0.5);
    expect(internal.children.map((c) => c.name)).toEqual(['C', 'D']);
    expect(leafNames(root)).toEqual(['A', 'B', 'C', 'D']);
    expect(rooted).toBe(false); // three root children, no rooting comment
  });

  it('accepts a trailing semicolon and omits it safely', () => {
    expect(parseNewick('(A,B);').root.children).toHaveLength(2);
    expect(parseNewick('(A,B)').root.children).toHaveLength(2);
  });

  it('parses quoted labels with escaped quotes', () => {
    const { root } = parseNewick("('Homo sapiens':1,'it''s ok':2,\"double quoted\":3);");
    expect(root.children.map((c) => c.name)).toEqual([
      'Homo sapiens',
      "it's ok",
      'double quoted',
    ]);
    expect(root.children.map((c) => c.length)).toEqual([1, 2, 3]);
  });

  it('parses scientific and negative branch lengths', () => {
    const { root } = parseNewick('(A:1e-3,B:-0.25);');
    expect(root.children[0].length).toBeCloseTo(0.001, 12);
    expect(root.children[1].length).toBe(-0.25);
  });

  it('reads support from a bare internal label', () => {
    const { root } = parseNewick('(A,B)95;');
    expect(root.name).toBe('');
    expect(root.support).toBe(95);
  });

  it('reads support and comments from bracket annotations', () => {
    const { root } = parseNewick('(A[&support=90]:1,B[bootstrap=75]:2)0.99:0.5;');
    expect(root.children[0].support).toBe(90);
    expect(root.children[0].comment).toBe('&support=90');
    expect(root.children[1].support).toBe(75);
    expect(root.support).toBe(0.99);
    expect(root.length).toBe(0.5);
  });

  it('supports nested comments', () => {
    const { root } = parseNewick('[outer[inner]]A;');
    expect(root.name).toBe('A');
    expect(root.comment).toBe('outer[inner]');
  });

  it('reads rooted/unrooted flags from leading comments', () => {
    expect(parseNewick('[&R](A,B,C);').rooted).toBe(true);
    expect(parseNewick('[&U](A,B,C);').rooted).toBe(false);
    expect(parseNewick('[&rooted=false](A,B,C);').rooted).toBe(false);
    expect(parseNewick('(A,B);').rooted).toBe(true);
  });

  it('handles an empty tree node list', () => {
    const { root } = parseNewick('A;');
    expect(root.name).toBe('A');
    expect(root.children).toEqual([]);
  });
});

describe('malformed Newick reports stable error codes', () => {
  const cases: Array<[string, NewickErrorCode]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    [';', 'noRoot'],
    ['(A,B', 'unclosed'],
    ['(A,B;', 'unclosed'],
    ['()', 'unexpected'],
    ['(A,B));', 'unexpected'],
    ['(A,]B);', 'unexpected'],
    ['A:abc', 'badLength'],
    ['A:', 'badLength'],
    ['A:1.2.3', 'badLength'],
    ["'abc", 'badQuoted'],
    ['[abc', 'badComment'],
  ];

  for (const [input, code] of cases) {
    it(`${JSON.stringify(input)} -> ${code}`, () => {
      const error = describeError(input);
      expect(error.code).toBe(code);
      expect(error.position).toBeGreaterThanOrEqual(0);
      expect(error.position).toBeLessThanOrEqual(input.length);
      expect(error.name).toBe('NewickParseError');
    });
  }
});

describe('toNewick', () => {
  it('serializes back to the original Newick text', () => {
    const input = '(A:0.1,B:0.2,(C:0.3,D:0.4)E:0.5)R;';
    expect(toNewick(parseNewick(input).root)).toBe(input);
  });

  it('round-trips quoted labels', () => {
    const parsed = parseNewick("('Homo sapiens':1,'it''s ok':2);");
    const serialized = toNewick(parsed.root);
    expect(serialized).toBe("('Homo sapiens':1,'it''s ok':2);");
    expect(parseNewick(serialized).root.children.map((c) => c.name)).toEqual([
      'Homo sapiens',
      "it's ok",
    ]);
  });

  it('round-trips supports and comments without duplicating them', () => {
    const parsed = parseNewick('(A[&support=90]:1,B:2)0.99:0.5;');
    const serialized = toNewick(parsed.root);
    expect(serialized).toBe('(A[&support=90]:1,B:2)0.99:0.5;');
    const again = parseNewick(serialized).root;
    expect(again.children[0].support).toBe(90);
    expect(again.support).toBe(0.99);
  });

  it('omits or includes the root length on request', () => {
    const root = parseNewick('(A:1,B:2)Root:0.75;').root;
    expect(toNewick(root)).toBe('(A:1,B:2)Root:0.75;');
    expect(toNewick(root, { includeRootLength: false })).toBe('(A:1,B:2)Root;');
  });

  it('serializes a collapsed internal node as a labelled terminal', () => {
    const parsed = parseNewick('((A:1,B:1)Inner:2,C:3)Root;');
    const inner = parsed.root.children[0];
    const collapsed = toNewick(parsed.root, { collapsed: new Set([inner.id]) });
    expect(collapsed).toBe('(Inner:2,C:3)Root;');
  });

  it('quotes labels containing Newick punctuation', () => {
    const root = parseNewick("('A B','C,D','E:F');").root;
    expect(toNewick(root)).toBe("('A B','C,D','E:F');");
  });
});
