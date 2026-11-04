// Global SPD record inspector. Any page can open the floating panel with a
// public SPD id; the panel itself fetches the current record on demand.

export type SpdInspectorKind = 'vector' | 'protein' | 'fold' | 'enzyme' | 'artifact' | 'gene';

export interface SpdInspectorTarget {
  kind: SpdInspectorKind;
  id: string;
  /** Optional display name from the list row, shown before the detail loads. */
  label?: string;
}

class SpdInspectorStore {
  target = $state<SpdInspectorTarget | null>(null);

  open(kind: SpdInspectorKind, id: string, label?: string) {
    this.target = { kind, id, label };
  }

  close() {
    this.target = null;
  }
}

export const spdInspector = new SpdInspectorStore();
