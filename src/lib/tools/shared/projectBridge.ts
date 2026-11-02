// Bridge between a tool editor and the SPICE_PROJECT store. Tool pages call
// takeToolHandoff() once on mount; capture flows jump back to /project.
import { goto } from '$app/navigation';
import { projectStore } from '$lib/project/store.svelte.ts';
import type { ToolDocKind } from '$lib/project/types';

export type ToolHandoff =
  | { type: 'open'; docId: string; payload: unknown }
  | { type: 'capture' }
  | null;

/** Hydrate the project singleton when a tool page is opened directly. */
export function ensureProjectLoaded(): void {
  if (!projectStore.hasOpenProject) projectStore.restoreFromLocalSession();
}

/** Consume a pending handoff only when it targets this tool. */
export function takeToolHandoff(kind: ToolDocKind): ToolHandoff {
  ensureProjectLoaded();
  const h = projectStore.takeHandoff();
  if (!h || h.kind !== kind) return null;
  if (h.type === 'capture') return { type: 'capture' };
  const doc = projectStore.getDoc(h.docId);
  if (!doc || doc.kind !== kind) return null;
  projectStore.activeDocId = doc.id;
  return { type: 'open', docId: doc.id, payload: doc.payload };
}

/** Add the current tool state as a project document and return to the hub. */
export function finishToolCapture(
  kind: ToolDocKind,
  name: string,
  payload: unknown,
  preview?: string,
  summary?: string
): string | null {
  if (!projectStore.hasOpenProject) return null;
  const id = projectStore.addDoc(kind, name, payload, { preview, summary });
  projectStore.activeDocId = id;
  goto('/project');
  return id;
}

export function activePayloadFor(kind: ToolDocKind): unknown | null {
  return projectStore.activeDocKind === kind ? projectStore.activeDoc?.payload ?? null : null;
}
