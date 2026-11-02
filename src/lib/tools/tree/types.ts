// Shared types for the Newick tree viewer tool.
// The tree model is deliberately plain data (no parent pointers) so it can be
// cloned, serialized to project JSON and re-rooted without cycles.

export type LayoutMode = 'phylogram' | 'cladogram' | 'circular';
export type TreeTheme = 'dark' | 'light';
export type PaletteId = 'default' | 'warm' | 'cool' | 'colorblind';

export interface TreeNode {
  id: string;
  name: string;
  /** Branch length from the parent. null means the file omitted it. */
  length: number | null;
  /** Internal support value (bootstrap, posterior, ...). */
  support: number | null;
  /** Raw Newick comment text without the surrounding brackets. */
  comment: string | null;
  children: TreeNode[];
}

export interface TreeDoc {
  root: TreeNode;
  /** Newick text exactly as parsed, used by the "original" export. */
  originalNewick: string;
  rooted: boolean;
  sourceName: string | null;
}

export interface TreeSettings {
  mode: LayoutMode;
  fontSize: number;
  branchWidth: number;
  labelAngle: number;
  supportThreshold: number;
  showBranchLengths: boolean;
  showSupport: boolean;
  showNodeDots: boolean;
  showScaleBar: boolean;
  theme: TreeTheme;
}

export interface MetaEntry {
  leaf: string;
  group: string;
  color?: string | null;
}

export interface TreeMetadata {
  entries: MetaEntry[];
  paletteId: PaletteId;
}

export interface ResolvedMetadata {
  byLeaf: Record<string, { group: string; color: string }>;
  groupOrder: string[];
  groupColors: Record<string, string>;
  groupCounts: Record<string, number>;
  ungrouped: number;
}

export interface LayoutNode {
  id: string;
  name: string;
  length: number | null;
  support: number | null;
  comment: string | null;
  /** Ancestral distance in branch-length units (or levels in cladogram mode). */
  depth: number;
  level: number;
  parentId: string | null;
  /** Position in the active layout. For circular layouts x/y are the point. */
  x: number;
  y: number;
  radius: number;
  angle: number;
  /** Radius of the parent in circular layouts. */
  parentRadius: number;
  parentAngle: number;
  /** Rectangular parent position, used for elbow paths and measured labels. */
  parentX: number;
  parentY: number;
  isLeaf: boolean;
  isCollapsed: boolean;
  /** Number of original leaves below this node. */
  leafCount: number;
  /** Number of leaf slots this terminal consumes (1 for a collapsed clade). */
  terminalIndex: number | null;
  group: string | null;
  color: string | null;
  children: LayoutNode[];
  /** Angular span from the first to the last child (circular layout). */
  startAngle: number;
  endAngle: number;
}

export interface TreeLayout {
  mode: LayoutMode;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  root: LayoutNode;
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  terminals: LayoutNode[];
  leafCount: number;
  nodeCount: number;
  maxDepth: number;
  /** Pixels per branch-length unit. */
  depthScale: number;
  fallbackCladogram: boolean;
  titleLines: string[];
  captionLines: string[];
  titleY: number;
  captionY: number;
  titleFont: number;
  captionFont: number;
  scaleBar: { x: number; y: number; lengthPx: number; unit: number } | null;
}

export interface SerializedNode {
  id: string;
  name: string;
  length: number | null;
  support: number | null;
  comment: string | null;
  children: SerializedNode[];
}

export interface TreeProject {
  format: 'spice-tree';
  version: 1;
  originalNewick: string;
  tree: SerializedNode;
  rooted: boolean;
  sourceName: string | null;
  collapsedIds: string[];
  settings: TreeSettings;
  metadata: TreeMetadata;
  title: string;
  caption: string;
  savedAt: string;
}

export interface ScaleBarInfo {
  unit: number;
  lengthPx: number;
}

export function defaultSettings(): TreeSettings {
  return {
    mode: 'phylogram',
    fontSize: 11,
    branchWidth: 1.5,
    labelAngle: 0,
    supportThreshold: 0,
    showBranchLengths: false,
    showSupport: true,
    showNodeDots: true,
    showScaleBar: true,
    theme: 'dark'
  };
}

export function emptyMetadata(): TreeMetadata {
  return { entries: [], paletteId: 'default' };
}

export const PALETTES: Record<PaletteId, string[]> = {
  default: [
    '#4cd6ff', '#ffd23f', '#53d769', '#ff9f1c', '#b48cff', '#ff5d5d',
    '#2ee6c8', '#f472b6', '#a3e635', '#f59e0b', '#60a5fa', '#e879f9'
  ],
  warm: [
    '#ff9f1c', '#ff5d5d', '#ffd23f', '#f97316', '#e11d48', '#f43f5e',
    '#fbbf24', '#d97706', '#dc2626', '#fb7185', '#f59e0b', '#b45309'
  ],
  cool: [
    '#4cd6ff', '#60a5fa', '#2ee6c8', '#818cf8', '#38bdf8', '#a78bfa',
    '#22d3ee', '#3b82f6', '#14b8a6', '#6366f1', '#0ea5e9', '#8b5cf6'
  ],
  colorblind: [
    '#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00',
    '#f0e442', '#000000', '#4d4d4d', '#999999', '#117733', '#882255'
  ]
};

export const PALETTE_IDS: PaletteId[] = ['default', 'warm', 'cool', 'colorblind'];

/** Normalize bootstrap values written as fractions into percent space. */
export function normalizedSupport(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value * 100 : value;
}

export function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Number(value.toPrecision(digits));
  return String(rounded);
}
