// Support-value summaries for the tree inspector and reproducibility bundle.
// Values are normalized into percent space (fractions become percentages) and
// binned over the fixed 0..100 range so the histogram is stable across files.
import { normalizedSupport, type TreeNode } from './types';

export interface SupportBin {
  index: number;
  from: number;
  to: number;
  /** Internal nodes above the display threshold. */
  shown: number;
  /** Internal nodes hidden by the current threshold. */
  filtered: number;
  total: number;
}

export interface SupportSummary {
  /** Every internal node, including nodes without a support value. */
  internal: number;
  /** Internal nodes with a finite support value. */
  withSupport: number;
  /** Nodes with support at or above the threshold (labels are displayed). */
  shown: number;
  /** Nodes with support below the threshold. */
  filtered: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  threshold: number;
  bins: SupportBin[];
}

export function emptySupportSummary(binCount = 10): SupportSummary {
  const bins = Math.max(1, Math.round(binCount));
  const width = 100 / bins;
  return {
    internal: 0,
    withSupport: 0,
    shown: 0,
    filtered: 0,
    min: null,
    max: null,
    mean: null,
    threshold: 0,
    bins: Array.from({ length: bins }, (_, index) => ({
      index,
      from: index * width,
      to: (index + 1) * width,
      shown: 0,
      filtered: 0,
      total: 0,
    })),
  };
}

function walk(root: TreeNode, visit: (node: TreeNode) => void): void {
  visit(root);
  for (const child of root.children) walk(child, visit);
}

export function supportSummary(root: TreeNode, threshold = 0, binCount = 10): SupportSummary {
  const bins = Math.max(1, Math.round(binCount));
  const limit = Math.min(100, Math.max(0, threshold));
  const width = 100 / bins;
  const table: SupportBin[] = Array.from({ length: bins }, (_, index) => ({
    index,
    from: index * width,
    to: (index + 1) * width,
    shown: 0,
    filtered: 0,
    total: 0,
  }));

  let internal = 0;
  let withSupport = 0;
  let shown = 0;
  let filtered = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  walk(root, (node) => {
    if (node.children.length === 0) return;
    internal++;
    const support = normalizedSupport(node.support);
    if (support === null) return;
    withSupport++;
    sum += support;
    if (support < min) min = support;
    if (support > max) max = support;
    const index = Math.min(bins - 1, Math.max(0, Math.floor(support / width)));
    const bin = table[index];
    bin.total++;
    if (support >= limit) {
      bin.shown++;
      shown++;
    } else {
      bin.filtered++;
      filtered++;
    }
  });

  return {
    internal,
    withSupport,
    shown,
    filtered,
    min: withSupport ? min : null,
    max: withSupport ? max : null,
    mean: withSupport ? sum / withSupport : null,
    threshold: limit,
    bins: table,
  };
}
