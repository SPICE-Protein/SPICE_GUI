// SPICE_PROJECT adapter for the phylogenetic tree tool. Pure helpers only;
// the Svelte editor supplies the current TreeProject snapshot.
import type { TreeNode, TreeProject } from './types';
import { parseProjectJson } from './export';
import { collectLeafNodes, nodeCount } from './treeops';
import { supportSummary } from './support';

export const TREE_DOC_KIND = 'tree' as const;

/** Validate an untrusted project payload through the same path as file import. */
export function normalizeTreePayload(value: unknown): TreeProject | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return parseProjectJson(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function treeDocName(project: TreeProject): string {
  const title = project.title.trim();
  if (title) return title;
  const source = project.sourceName?.trim();
  if (source) return source;
  return 'Phylogenetic tree';
}

export interface TreeCountStats {
  nodes: number;
  leaves: number;
  internal: number;
  withSupport: number;
  shownSupport: number;
  filteredSupport: number;
  threshold: number;
}

export function treeStats(project: TreeProject): TreeCountStats {
  const root = project.tree as unknown as TreeNode;
  const summary = supportSummary(root, project.settings.supportThreshold);
  const leaves = collectLeafNodes(root).length;
  return {
    nodes: nodeCount(root),
    leaves,
    internal: summary.internal,
    withSupport: summary.withSupport,
    shownSupport: summary.shown,
    filteredSupport: summary.filtered,
    threshold: summary.threshold,
  };
}

/** One-line hub/ELN summary that includes node and support counts. */
export function treeSummary(project: TreeProject): string {
  const stats = treeStats(project);
  const collapsed = project.collapsedIds.length;
  const parts = [
    `${stats.leaves} leaves`,
    `${stats.nodes} nodes`,
    `${stats.internal} internal`,
    `${stats.withSupport} with support`,
    `${stats.shownSupport} shown at threshold ${stats.threshold}`,
    `${project.settings.mode}`,
  ];
  if (collapsed) parts.push(`${collapsed} collapsed`);
  return parts.join('; ');
}

/** Processing settings recorded in parameters.json. */
export function treeParameters(project: TreeProject): Record<string, unknown> {
  const stats = treeStats(project);
  const support = supportSummary(
    project.tree as unknown as TreeNode,
    project.settings.supportThreshold,
  );
  return {
    settings: project.settings,
    rooted: project.rooted,
    sourceName: project.sourceName,
    counts: stats,
    support: {
      min: support.min,
      max: support.max,
      mean: support.mean,
      threshold: support.threshold,
      bins: support.bins,
    },
    collapsedIds: project.collapsedIds,
    metadata: {
      entries: project.metadata.entries.length,
      paletteId: project.metadata.paletteId,
    },
    title: project.title,
    caption: project.caption,
  };
}

/** Draft methods paragraph included in the reproducible bundle. */
export function treeMethods(project: TreeProject): string {
  const stats = treeStats(project);
  const lines = [
    `A Newick tree with ${stats.leaves} leaves and ${stats.nodes} nodes was parsed in the SPICE tree tool and drawn as a ${project.settings.mode} layout.`,
    'Branch lengths were used when present; trees without usable lengths fall back to a cladogram geometry.',
  ];
  if (stats.withSupport) {
    lines.push(
      `Internal support values (${stats.withSupport} nodes) were normalized to percent space and labels were displayed at a threshold of ${stats.threshold}%, corresponding to ${stats.shownSupport} shown nodes and ${stats.filteredSupport} filtered nodes.`,
    );
  }
  if (project.metadata.entries.length) {
    lines.push(
      `Leaf groups were colored from an imported metadata table with ${project.metadata.entries.length} rows and the ${project.metadata.paletteId} palette.`,
    );
  }
  lines.push(
    'The figure was exported as an SVG with live text elements and as a 300 dpi PNG rasterized from that same SVG. Edited and original Newick files, the full project JSON and processing parameters accompany the figure in this bundle.',
  );
  return lines.join(' ');
}
