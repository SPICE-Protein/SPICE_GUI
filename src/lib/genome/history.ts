// Edit history and undo/redo system for the SPICE gene editor.
// Tracks sequence snapshots, cloning operations, and all edits.

export interface HistorySnapshot {
  id: string;
  timestamp: string;
  label: string;
  operationType: "edit" | "clone" | "import" | "feat-add" | "feat-del" | "feat-edit" | "optimize" | "reset";
  sequence: string;
  features?: { id: number; name: string; start: number; end: number; type: string; color: string; forward?: boolean }[];
  meta?: Record<string, unknown>;
  parentId?: string | null;
  color?: string;
}

export interface HistoryTree extends HistorySnapshot {
  children: HistoryTree[];
}

export class HistoryManager {
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private maxStack: number;
  private counter = 0;

  constructor(maxStack = 100) {
    this.maxStack = maxStack;
  }

  private genId(): string {
    return `hs_${Date.now()}_${(this.counter++).toString(36)}`;
  }

  push(snapshot: Omit<HistorySnapshot, "id" | "timestamp" | "parentId"> & { parentId?: string | null }): HistorySnapshot {
    const full: HistorySnapshot = {
      ...snapshot,
      id: this.genId(),
      timestamp: new Date().toISOString(),
      parentId: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].id : null,
    };
    this.undoStack.push(full);
    if (this.undoStack.length > this.maxStack) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return full;
  }

  canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): HistorySnapshot | null {
    if (!this.canUndo()) return null;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    return this.undoStack[this.undoStack.length - 1] ?? current;
  }

  redo(): HistorySnapshot | null {
    if (!this.canRedo()) return null;
    const snap = this.redoStack.pop()!;
    this.undoStack.push(snap);
    return snap;
  }

  current(): HistorySnapshot | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  getAll(): HistorySnapshot[] {
    return [...this.undoStack];
  }

  getTree(): HistoryTree | null {
    const all = this.getAll();
    if (all.length === 0) return null;
    const map = new Map<string, HistoryTree>();
    const rootList: HistoryTree[] = [];
    for (const s of all) {
      const node: HistoryTree = { ...s, children: [] };
      map.set(s.id, node);
    }
    for (const s of all) {
      const node = map.get(s.id)!;
      if (s.parentId && map.has(s.parentId)) {
        map.get(s.parentId)!.children.push(node);
      } else {
        rootList.push(node);
      }
    }
    return rootList[0] ?? null;
  }

  trim(maxKeep = 50): void {
    if (this.undoStack.length <= maxKeep) return;
    this.undoStack = this.undoStack.slice(-maxKeep);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  size(): number {
    return this.undoStack.length;
  }

  redoSize(): number {
    return this.redoStack.length;
  }
}

export const HISTORY_COLORS: Record<HistorySnapshot["operationType"], string> = {
  edit: "#4cd6ff",
  clone: "#53d769",
  import: "#ff9f1c",
  "feat-add": "#b48cff",
  "feat-del": "#ff5d5d",
  "feat-edit": "#ffd23f",
  optimize: "#ff5df6",
  reset: "#a0a5b5",
};

export function formatHistoryLabel(snap: HistorySnapshot): string {
  const time = new Date(snap.timestamp).toLocaleTimeString();
  return `${snap.label} [${time}]`;
}
