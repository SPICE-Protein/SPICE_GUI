// Geometry for the three tree layouts. The layout pass is deliberately
// independent of Svelte: it returns a flat node list plus lookup maps that the
// renderer and the interaction layer both consume.
import type {
  LayoutMode,
  LayoutNode,
  ResolvedMetadata,
  TreeNode,
  TreeLayout
} from './types';

export interface LayoutInput {
  root: TreeNode;
  mode: LayoutMode;
  fontSize: number;
  labelAngle: number;
  showBranchLengths: boolean;
  showScaleBar: boolean;
  title: string;
  caption: string;
  collapsed: Set<string>;
  metadata: ResolvedMetadata;
  rowHeight?: number;
}

interface BuildContext {
  collapsed: Set<string>;
  byLeaf: ResolvedMetadata['byLeaf'];
  groupColors: ResolvedMetadata['groupColors'];
  useLevels: boolean;
  leafCounts: Map<string, number>;
  groups: Map<string, string | null>;
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  terminals: LayoutNode[];
}

function walk(node: TreeNode, fn: (n: TreeNode) => void) {
  fn(node);
  for (const child of node.children) walk(child, fn);
}

function countLeaves(node: TreeNode, cache: Map<string, number>): number {
  const hit = cache.get(node.id);
  if (hit !== undefined) return hit;
  const value = node.children.length === 0
    ? 1
    : node.children.reduce((sum, child) => sum + countLeaves(child, cache), 0);
  cache.set(node.id, value);
  return value;
}

function maxDistance(
  node: TreeNode,
  useLevels: boolean,
  cache: Map<string, number>
): number {
  const key = `${node.id}:${useLevels ? 'l' : 'b'}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let value = 0;
  if (!useLevels) {
    for (const child of node.children) {
      const edge = Math.max(0, child.length ?? 0);
      value = Math.max(value, edge + maxDistance(child, useLevels, cache));
    }
  } else if (node.children.length > 0) {
    let deepest = 0;
    for (const child of node.children) {
      deepest = Math.max(deepest, maxDistance(child, useLevels, cache));
    }
    value = 1 + deepest;
  }
  cache.set(key, value);
  return value;
}

function uniformGroup(
  node: TreeNode,
  byLeaf: ResolvedMetadata['byLeaf'],
  cache: Map<string, string | null>
): string | null {
  const hit = cache.get(node.id);
  if (hit !== undefined) return hit;
  let group: string | null = null;
  if (node.children.length === 0) {
    group = byLeaf[node.name]?.group ?? null;
  } else {
    let first: string | null | undefined;
    let same = true;
    for (const child of node.children) {
      const childGroup = uniformGroup(child, byLeaf, cache);
      if (childGroup == null) {
        same = false;
        break;
      }
      if (first === undefined) first = childGroup;
      else if (first !== childGroup) {
        same = false;
        break;
      }
    }
    group = same && first !== undefined ? first : null;
  }
  cache.set(node.id, group);
  return group;
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const out: string[] = [];
  for (const paragraph of clean.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxChars) {
        line += ' ' + word;
      } else {
        out.push(line);
        line = word;
      }
      // Hard-break very long tokens (CJK captions often have no spaces).
      while (line.length > maxChars) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function niceUnit(target: number): number | null {
  if (!(target > 0) || !Number.isFinite(target)) return null;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  const fraction = target / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

export function computeLayout(input: LayoutInput): TreeLayout {
  const leafCounts = new Map<string, number>();
  const groupCache = new Map<string, string | null>();
  const distanceCache = new Map<string, number>();

  const branchMax = maxDistance(input.root, false, distanceCache);
  const useLevels = input.mode === 'cladogram' || branchMax <= 0;
  const fallbackCladogram = input.mode !== 'cladogram' && branchMax <= 0;

  const fontSize = input.fontSize;
  const rowHeight = input.rowHeight ?? Math.max(fontSize * 2.3, 13);
  const titleFont = Math.max(12, fontSize * 1.35);
  const captionFont = Math.max(9, fontSize * 0.85);
  const margin = { top: 16, right: 24, bottom: 16, left: 26 };

  const ctx: BuildContext = {
    collapsed: input.collapsed,
    byLeaf: input.metadata.byLeaf,
    groupColors: input.metadata.groupColors,
    useLevels,
    leafCounts,
    groups: groupCache,
    nodes: [],
    byId: new Map(),
    terminals: []
  };

  let terminalCursor = 0;

  function build(
    node: TreeNode,
    parent: LayoutNode | null,
    depth: number,
    level: number
  ): LayoutNode {
    const isCollapsed = node.children.length > 0 && ctx.collapsed.has(node.id);
    const childNodes = isCollapsed
      ? []
      : node.children.map((child) =>
          build(
            child,
            null,
            depth + (useLevels ? 1 : Math.max(0, child.length ?? 0)),
            level + 1
          )
        );

    const group = uniformGroup(node, ctx.byLeaf, ctx.groups);
    const leafMeta = ctx.byLeaf[node.name];
    const color = node.children.length === 0
      ? leafMeta?.color ?? (group ? ctx.groupColors[group] ?? null : null)
      : group
        ? ctx.groupColors[group] ?? null
        : null;

    const lnode: LayoutNode = {
      id: node.id,
      name: node.name,
      length: node.length,
      support: node.support,
      comment: node.comment,
      depth,
      level,
      parentId: parent?.id ?? null,
      x: 0,
      y: 0,
      radius: 0,
      angle: 0,
      parentRadius: 0,
      parentAngle: 0,
      parentX: 0,
      parentY: 0,
      isLeaf: node.children.length === 0,
      isCollapsed,
      leafCount: countLeaves(node, ctx.leafCounts),
      terminalIndex: null,
      group,
      color,
      children: childNodes,
      startAngle: 0,
      endAngle: 0
    };

    for (const child of childNodes) child.parentId = lnode.id;
    ctx.nodes.push(lnode);
    ctx.byId.set(lnode.id, lnode);

    if (childNodes.length === 0) {
      lnode.terminalIndex = terminalCursor++;
      ctx.terminals.push(lnode);
    }

    return lnode;
  }

  const root = build(input.root, null, 0, 0);
  const terminalCount = Math.max(1, terminalCursor);
  let maxDepth = 0.000001;
  for (const terminal of ctx.terminals) {
    if (terminal.depth > maxDepth) maxDepth = terminal.depth;
  }

  let maxNameChars = 1;
  for (const terminal of ctx.terminals) {
    const name = terminal.name || 'Unnamed';
    maxNameChars = Math.max(
      maxNameChars,
      name.length + (terminal.isCollapsed ? String(terminal.leafCount).length + 3 : 0)
    );
  }
  const branchLengthChars = input.showBranchLengths ? 9 : 0;
  const labelWidth = Math.min(
    430,
    Math.max(52, (maxNameChars + branchLengthChars) * fontSize * 0.62 + 12)
  );

  if (input.mode !== 'circular' && input.labelAngle > 0) {
    const angleRadians = (input.labelAngle * Math.PI) / 180;
    margin.top += Math.min(180, Math.ceil(labelWidth * Math.sin(angleRadians) * 0.8));
  }

  const plotWidth = Math.max(420, Math.min(820, 420 + terminalCount * 4));
  const circularRadius = Math.max(
    185,
    (terminalCount * rowHeight) / (2 * Math.PI) * 1.12
  );
  const circularOuter = circularRadius + labelWidth + 18;

  let width: number;
  if (input.mode === 'circular') {
    width = Math.max(520, circularOuter * 2 + margin.left + margin.right);
  } else {
    width = margin.left + plotWidth + 14 + labelWidth + margin.right;
  }

  const maxTitleChars = Math.max(
    20,
    Math.floor((width - margin.left - margin.right) / Math.max(1, titleFont * 0.62))
  );
  const titleLines = wrapText(input.title, maxTitleChars);
  const captionLines = wrapText(input.caption, maxTitleChars);
  const titleHeight = titleLines.length
    ? titleLines.length * titleFont * 1.35 + 12
    : 0;
  const captionHeight = captionLines.length
    ? captionLines.length * captionFont * 1.35 + 8
    : 0;
  const showScale = input.showScaleBar && !useLevels;
  const scaleHeight = showScale ? 34 : 0;

  let height: number;
  let plotTop: number;
  let plotHeight: number;
  let centerX: number;
  let centerY: number;
  let contentBottom: number;
  let depthScale: number;

  if (input.mode === 'circular') {
    plotTop = margin.top + titleHeight;
    centerX = width / 2;
    centerY = plotTop + circularOuter;
    const diameter = circularRadius * 2;
    plotHeight = diameter;
    contentBottom = centerY + circularOuter;
    height = contentBottom + captionHeight + scaleHeight + margin.bottom;
    depthScale = circularRadius / maxDepth;
  } else {
    plotTop = margin.top + titleHeight;
    plotHeight = terminalCount * rowHeight;
    centerX = margin.left + plotWidth / 2;
    centerY = plotTop + plotHeight / 2;
    contentBottom = plotTop + plotHeight;
    height = contentBottom + captionHeight + scaleHeight + margin.bottom;
    depthScale = plotWidth / maxDepth;
  }

  // Rectangular y coordinates (kept meaningful in circular mode too, where
  // they are simply the slot centers before polar conversion).
  for (const node of ctx.nodes) {
    if (node.terminalIndex !== null) {
      node.y = plotTop + (node.terminalIndex + 0.5) * rowHeight;
    }
  }
  // ctx.nodes is post-order (children are pushed before their parent), so a
  // forward pass averages child positions after those children are final.
  for (const node of ctx.nodes) {
    if (node.children.length > 0) {
      node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
    }
  }

  if (input.mode === 'circular') {
    const step = (Math.PI * 2) / terminalCount;
    const start = -Math.PI / 2;
    for (const node of ctx.nodes) {
      if (node.terminalIndex !== null) {
        node.angle = start + (node.terminalIndex + 0.5) * step;
        node.startAngle = node.angle;
        node.endAngle = node.angle;
      }
    }
    for (const node of ctx.nodes) {
      if (node.children.length > 0) {
        node.startAngle = node.children[0].startAngle;
        node.endAngle = node.children[node.children.length - 1].endAngle;
        node.angle = (node.startAngle + node.endAngle) / 2;
      }
    }
    for (const node of ctx.nodes) {
      node.radius = node.depth * depthScale;
      node.x = centerX + node.radius * Math.cos(node.angle);
      node.y = centerY + node.radius * Math.sin(node.angle);
    }
  } else {
    for (const node of ctx.nodes) {
      node.x = margin.left + node.depth * depthScale;
      node.radius = 0;
      node.angle = 0;
    }
  }

  // Parent coordinates for edge drawing.
  for (const node of ctx.nodes) {
    if (!node.parentId) continue;
    const parent = ctx.byId.get(node.parentId);
    if (!parent) continue;
    if (input.mode === 'circular') {
      node.parentRadius = parent.radius;
      node.parentAngle = parent.angle;
      node.parentX = centerX + parent.radius * Math.cos(node.angle);
      node.parentY = centerY + parent.radius * Math.sin(node.angle);
    } else {
      node.parentRadius = 0;
      node.parentAngle = 0;
      node.parentX = parent.x;
      node.parentY = parent.y;
    }
  }

  const titleY = margin.top + titleFont;
  const captionY = contentBottom + 10 + captionFont;
  let scaleBar: TreeLayout['scaleBar'] = null;
  if (showScale) {
    const target = 105 / Math.max(0.000001, depthScale);
    const unit = niceUnit(target);
    if (unit) {
      scaleBar = {
        x: input.mode === 'circular' ? margin.left + 10 : margin.left + 2,
        y: height - margin.bottom - 5,
        lengthPx: unit * depthScale,
        unit
      };
    }
  }

  return {
    mode: input.mode,
    width,
    height,
    centerX,
    centerY,
    plotLeft: margin.left,
    plotTop,
    plotWidth: input.mode === 'circular' ? circularRadius * 2 : plotWidth,
    plotHeight,
    root,
    nodes: ctx.nodes,
    byId: ctx.byId,
    terminals: ctx.terminals,
    leafCount: countLeaves(input.root, leafCounts),
    nodeCount: ctx.nodes.length,
    maxDepth,
    depthScale,
    fallbackCladogram,
    titleLines,
    captionLines,
    titleY,
    captionY,
    titleFont,
    captionFont,
    scaleBar
  };
}

export function collectLeaves(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  walk(root, (node) => {
    if (node.children.length === 0) out.push(node);
  });
  return out;
}
