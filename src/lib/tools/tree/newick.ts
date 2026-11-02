// Newick parser and serializer.
// The parser tracks absolute character positions so the UI can point at the
// offending character instead of showing a generic failure.
import type { TreeNode } from './types';
import { formatNumber } from './types';

export type NewickErrorCode =
  | 'empty'
  | 'unexpected'
  | 'unclosed'
  | 'badLength'
  | 'unexpectedComma'
  | 'unexpectedEnd'
  | 'badQuoted'
  | 'badComment'
  | 'noRoot';

export class NewickParseError extends Error {
  code: NewickErrorCode;
  /** Zero-based character offset in the original input. */
  position: number;
  found: string;

  constructor(code: NewickErrorCode, position: number, found = '') {
    super(`${code} at ${position}`);
    this.name = 'NewickParseError';
    this.code = code;
    this.position = position;
    this.found = found;
  }
}

export interface ParsedTree {
  root: TreeNode;
  rooted: boolean;
}

const UNQUOTED_STOP = new Set(['(', ')', ',', ':', ';', '[', ']', "'", '"']);
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NUMERIC_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function isNumericLabel(label: string): boolean {
  return NUMERIC_RE.test(label.trim());
}

function extractSupport(comment: string): number | null {
  const flagged = /(?:^|[&;,\s])(?:support|boot(?:strap)?)\s*[=:]\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(comment);
  if (flagged) {
    const value = Number(flagged[1]);
    if (Number.isFinite(value)) return value;
  }
  const bare = /^\s*&?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/.exec(comment);
  if (bare) {
    const value = Number(bare[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function rootFlag(comment: string): boolean | null {
  const lower = comment.toLowerCase();
  if (/(?:^|[&;,\s])(?:r|rooted)\s*(?:[=:]\s*(?:true|yes|1))?\s*(?:$|[;,\s])/.test(lower)) {
    if (/\b(?:u|unrooted)\b/.test(lower)) return false;
    return true;
  }
  if (/(?:^|[&;,\s])(?:u|unrooted)\s*(?:[=:]\s*(?:true|yes|1))?\s*(?:$|[;,\s])/.test(lower)) {
    return false;
  }
  if (/rooted\s*[=:]\s*false/.test(lower)) return false;
  if (/rooted\s*[=:]\s*true/.test(lower)) return true;
  return null;
}

class NewickParser {
  private pos = 0;
  private nextId = 1;
  private rootedFlag: boolean | null = null;

  constructor(private readonly text: string) {}

  parse(): ParsedTree {
    this.skipWhitespace();
    const leadingComments: string[] = [];
    while (this.peek() === '[') {
      const comment = this.readComment();
      const flag = rootFlag(comment);
      if (flag !== null) {
        if (this.rootedFlag === null) this.rootedFlag = flag;
      } else {
        leadingComments.push(comment);
      }
      this.skipWhitespace();
    }

    if (this.pos >= this.text.length) {
      throw new NewickParseError('empty', this.pos, '');
    }
    if (this.peek() === ';') {
      throw new NewickParseError('noRoot', this.pos, ';');
    }

    const root = this.parseSubtree();
    this.attachLeadingComments(root, leadingComments);
    this.skipWhitespace();
    if (this.peek() === ';') {
      this.pos++;
      this.skipWhitespace();
    }
    if (this.pos < this.text.length) {
      throw new NewickParseError('unexpected', this.pos, this.peek());
    }

    const rooted = this.rootedFlag ?? (root.children.length === 0 || root.children.length <= 2);
    return { root, rooted };
  }

  private makeNode(): TreeNode {
    return {
      id: `n${this.nextId++}`,
      name: '',
      length: null,
      support: null,
      comment: null,
      children: []
    };
  }

  private parseSubtree(): TreeNode {
    this.skipWhitespace();
    const leadingComments: string[] = [];
    while (this.peek() === '[') {
      leadingComments.push(this.readComment());
      this.skipWhitespace();
    }
    const first = this.peek();

    if (first === '(') {
      this.pos++;
      const node = this.makeNode();
      this.skipWhitespace();
      if (this.peek() === ')') {
        throw new NewickParseError('unexpected', this.pos, ')');
      }
      while (true) {
        node.children.push(this.parseSubtree());
        this.skipWhitespace();
        const ch = this.peek();
        if (ch === ',') {
          this.pos++;
          continue;
        }
        if (ch === ')') {
          this.pos++;
          break;
        }
        if (ch === '') throw new NewickParseError('unclosed', this.pos, '');
        if (ch === ';') throw new NewickParseError('unclosed', this.pos, ';');
        throw new NewickParseError('unexpected', this.pos, ch);
      }
      this.parseSuffix(node, true);
      this.attachLeadingComments(node, leadingComments);
      return node;
    }

    if (first === '') throw new NewickParseError('unexpectedEnd', this.pos, '');
    if (first === ')' || first === ';') {
      throw new NewickParseError('unexpected', this.pos, first);
    }

    const node = this.makeNode();
    if (first !== ':' && first !== '[' && first !== ',') {
      node.name = this.readLabel();
    }
    this.parseSuffix(node, false);
    this.attachLeadingComments(node, leadingComments);
    return node;
  }

  private attachLeadingComments(node: TreeNode, comments: string[]): void {
    if (comments.length === 0) return;
    for (const comment of comments) {
      const support = extractSupport(comment);
      if (support !== null && node.support === null) node.support = support;
    }
    const combined = comments.join(' ');
    node.comment = node.comment ? `${combined} ${node.comment}` : combined;
  }

  private parseSuffix(node: TreeNode, internal: boolean): void {
    while (true) {
      this.skipWhitespace();
      const ch = this.peek();
      if (!ch || ch === ',' || ch === ')' || ch === ';') break;

      if (ch === ':') {
        this.pos++;
        node.length = this.readNumber();
        continue;
      }
      if (ch === '[') {
        const comment = this.readComment();
        node.comment = node.comment ? `${node.comment} ${comment}` : comment;
        const support = extractSupport(comment);
        if (support !== null && node.support === null) node.support = support;
        continue;
      }
      if (ch === '(') throw new NewickParseError('unexpected', this.pos, ch);
      if (ch === ']') throw new NewickParseError('unexpected', this.pos, ch);

      const label = this.readLabel();
      if (!label) throw new NewickParseError('unexpected', this.pos, ch);
      this.applyLabel(node, label, internal);
    }
  }

  private applyLabel(node: TreeNode, raw: string, internal: boolean): void {
    const label = raw.trim();
    if (!label) return;
    if (internal) {
      if (node.name === '' && isNumericLabel(label)) {
        if (node.support === null) node.support = Number(label);
        return;
      }
      if (node.name === '') {
        node.name = label;
      } else if (isNumericLabel(label) && node.support === null) {
        node.support = Number(label);
      } else {
        node.name += ` ${label}`;
      }
      return;
    }
    node.name = node.name ? `${node.name} ${label}` : label;
  }

  private readLabel(): string {
    const ch = this.peek();
    if (ch === "'" || ch === '"') return this.readQuoted();
    const start = this.pos;
    while (this.pos < this.text.length) {
      const current = this.text[this.pos];
      if (UNQUOTED_STOP.has(current)) break;
      this.pos++;
    }
    return this.text.slice(start, this.pos).trim();
  }

  private readQuoted(): string {
    const quote = this.peek();
    const start = this.pos;
    this.pos++;
    let out = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === quote) {
        if (this.text[this.pos + 1] === quote) {
          out += quote;
          this.pos += 2;
          continue;
        }
        this.pos++;
        return out;
      }
      out += ch;
      this.pos++;
    }
    throw new NewickParseError('badQuoted', start, quote);
  }

  private readComment(): string {
    const start = this.pos;
    this.pos++;
    let depth = 1;
    let out = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '[') {
        depth++;
        out += ch;
        this.pos++;
        continue;
      }
      if (ch === ']') {
        depth--;
        this.pos++;
        if (depth === 0) return out;
        out += ch;
        continue;
      }
      out += ch;
      this.pos++;
    }
    throw new NewickParseError('badComment', start, '[');
  }

  private readNumber(): number {
    this.skipWhitespace();
    const start = this.pos;
    const match = NUMBER_RE.exec(this.text.slice(this.pos));
    if (!match) throw new NewickParseError('badLength', start, this.peek());
    this.pos += match[0].length;
    const next = this.peek();
    if (next && !UNQUOTED_STOP.has(next) && !/\s/.test(next)) {
      throw new NewickParseError('badLength', this.pos, next);
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new NewickParseError('badLength', start, match[0]);
    }
    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }

  private peek(): string {
    return this.text[this.pos] ?? '';
  }
}

export function parseNewick(text: string): ParsedTree {
  return new NewickParser(text).parse();
}

function escapeLabel(label: string): string {
  if (!label) return '';
  if (/[\s(),:;\[\]'"]/.test(label)) {
    return `'${label.replace(/'/g, "''")}'`;
  }
  return label;
}

export interface SerializeOptions {
  collapsed?: Set<string>;
  includeRootLength?: boolean;
}

export function toNewick(root: TreeNode, options: SerializeOptions = {}): string {
  const collapsed = options.collapsed ?? new Set<string>();

  function serialize(node: TreeNode, isRoot: boolean): string {
    const isCollapsed = !isRoot && collapsed.has(node.id) && node.children.length > 0;
    const commentSupport = node.comment ? extractSupport(node.comment) : null;
    const supportInComment = commentSupport !== null && node.support !== null && commentSupport === node.support;
    const labelPart = node.name || (node.support !== null && !supportInComment ? formatNumber(node.support) : '');
    const commentPart = node.comment ? `[${node.comment}]` : '';
    let out = '';

    if (node.children.length > 0 && !isCollapsed) {
      out = `(${node.children.map((child) => serialize(child, false)).join(',')})`;
      if (node.name) {
        out += escapeLabel(node.name);
        if (node.support !== null && !supportInComment) out += `[&support=${formatNumber(node.support)}]`;
      } else if (node.support !== null && !supportInComment) {
        out += formatNumber(node.support);
      }
    } else {
      out += escapeLabel(labelPart);
      if (node.name && node.support !== null && !supportInComment) out += `[&support=${formatNumber(node.support)}]`;
    }

    out += commentPart;
    if ((!isRoot || options.includeRootLength !== false) && node.length !== null) {
      out += `:${formatNumber(node.length)}`;
    }
    return out;
  }

  return `${serialize(root, true)};`;
}
