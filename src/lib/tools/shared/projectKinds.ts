// Shared mapping between project document kinds and their tool routes.
// Kept free of Svelte imports so unit tests and plain modules can use it.
import type { ToolDocKind } from '$lib/project/types';

export interface ToolDocMeta {
  route: string;
  /** Label used in file names and fallback UI, never translated. */
  label: string;
}

export const TOOL_DOC_META: Record<ToolDocKind, ToolDocMeta> = {
  gel: { route: '/tools/gel', label: 'Gel figure' },
  blot: { route: '/tools/blot', label: 'Western blot' },
  qpcr: { route: '/tools/qpcr', label: 'qPCR analysis' },
  plate: { route: '/tools/plate', label: 'Plate layout' },
  colony: { route: '/tools/colony', label: 'Colony counter' },
  annotate: { route: '/tools/annotate', label: 'Image annotator' },
  tree: { route: '/tools/tree', label: 'Phylogenetic tree' }
};

export function toolRoute(kind: ToolDocKind): string {
  return TOOL_DOC_META[kind].route;
}

export function toolLabel(kind: ToolDocKind): string {
  return TOOL_DOC_META[kind].label;
}
