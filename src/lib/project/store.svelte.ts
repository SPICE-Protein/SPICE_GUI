// SPICE_PROJECT singleton store. Holds the open project (embedded docs +
// journal pages), the known-project registry, the dirty flag, and the
// handoff protocol between /project and the gene/protein carrier pages.
//
// Rules:
// - No module-scope $effect (illegal outside components). Persistence happens
//   via explicit debounced persistSoon() calls from mutators.
// - commit*() never touches the filesystem; only save()/saveActiveDoc() do.
// - localStorage is the session snapshot; the .spiceproj file is authoritative.
import {
  newProject,
  newProjectId,
  newJournalDocId,
  newJournalPageId,
  newProjectFileId,
  summarize,
  touchUpdated,
  validateSpiceProject,
  type ProjectDoc,
  type ProjectDocKind,
  type ProjectFileEntry,
  type ProjectJournalPage,
  type ProjectSummary,
  type SpiceProjectFile
} from './types';

/** Per-file cap for attached data (base64 data-URI length in memory). */
export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024;
import { writeProjectText, writeProjectWithDialog, type WriteResult } from './fileIo';
import { inflateBytesToText, looksGzip } from './codecs';
import { encodeProject, decodeProjectAsync, looksLikeContainer } from './container';
import { backend, isTauri } from '$lib/backend/api';
import { pushToast } from '$lib/ui/toast.svelte.ts';
import * as m from '$lib/paraglide/messages.js';

export type ProjectHandoff =
  | { nonce: number; type: 'openDoc'; docId: string; kind: ProjectDocKind }
  | { nonce: number; type: 'capture'; kind: ProjectDocKind };

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
  canceled?: boolean;
  snapshotOnly?: boolean;
}

const KEY_CURRENT = 'spice_project_current';
const KEY_REGISTRY = 'spice_project_registry';
const SNAP_PREFIX = 'spice_project_snap_';
const JOURNAL_ACTIVE_PREFIX = 'spice_project_journal_active_';

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class ProjectStore {
  current = $state<SpiceProjectFile | null>(null);
  /** Known .spiceproj location (Tauri only). Cleared when unknown. */
  filePath = $state<string | null>(null);
  dirty = $state(false);
  activeDocId = $state<string | null>(null);
  handoff = $state<ProjectHandoff | null>(null);
  registry = $state<ProjectSummary[]>([]);
  activeJournalPageId = $state<string | null>(null);

  private handoffSeq = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof localStorage === 'undefined') return;
    const reg = safeParse(localStorage.getItem(KEY_REGISTRY));
    if (Array.isArray(reg)) {
      this.registry = reg.filter(
        (r: ProjectSummary) => r && typeof r.id === 'string' && typeof r.name === 'string'
      );
    } else if (reg !== null) {
      console.warn('[project] corrupt registry — reset');
      this.registry = [];
      localStorage.removeItem(KEY_REGISTRY);
    }
  }

  // ---------------- getters ----------------

  get hasOpenProject(): boolean {
    return this.current !== null;
  }

  get activeDoc(): ProjectDoc | null {
    if (!this.current || !this.activeDocId) return null;
    return this.current.docs.find(d => d.id === this.activeDocId) ?? null;
  }

  get activeDocKind(): ProjectDocKind | null {
    return this.activeDoc?.kind ?? null;
  }

  get hasActiveDoc(): boolean {
    return this.activeDoc !== null;
  }

  get activePages(): ProjectJournalPage[] {
    return this.current?.journal.pages ?? [];
  }

  get activeJournalPage(): ProjectJournalPage | null {
    const pages = this.activePages;
    if (!pages.length) return null;
    return pages.find(p => p.id === this.activeJournalPageId) ?? pages[0];
  }

  /** Whether a session-restorable snapshot exists (for the hub empty state). */
  get hasSessionSnapshot(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(KEY_CURRENT) !== null;
  }

  // ---------------- persistence internals ----------------

  private persistSoon() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 400);
  }

  persistNow() {
    if (typeof localStorage === 'undefined') return;
    try {
      if (!this.current) {
        localStorage.removeItem(KEY_CURRENT);
        return;
      }
      localStorage.setItem(KEY_CURRENT, JSON.stringify({ project: this.current, filePath: this.filePath }));
    } catch {
      // QuotaExceeded: the snapshot is best-effort — the .spiceproj file remains authoritative.
      pushToast('warn', m.projectQuotaWarnToast(), undefined);
    }
  }

  private writePerProjectSnapshot() {
    if (typeof localStorage === 'undefined' || !this.current) return;
    try {
      localStorage.setItem(SNAP_PREFIX + this.current.meta.id, JSON.stringify(this.current));
    } catch {
      /* best effort */
    }
  }

  private upsertRegistry() {
    if (!this.current) return;
    const s = summarize(this.current, this.filePath);
    const i = this.registry.findIndex(r => r.id === s.id);
    if (i >= 0) this.registry[i] = s;
    else this.registry = [...this.registry, s];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY_REGISTRY, JSON.stringify(this.registry));
    }
  }

  private rememberJournalActive() {
    if (typeof localStorage === 'undefined' || !this.current || !this.activeJournalPageId) return;
    localStorage.setItem(JOURNAL_ACTIVE_PREFIX + this.current.meta.id, this.activeJournalPageId);
  }

  // ---------------- lifecycle ----------------

  createProject(name: string, pi = '', description = ''): SpiceProjectFile {
    this.current = newProject(name.trim() || newProjectId().slice(0, 8), pi, description);
    this.filePath = null;
    this.dirty = false;
    this.activeDocId = null;
    this.activeJournalPageId = null;
    this.addJournalPage(); // a fresh journal always opens with one page
    this.upsertRegistry();
    this.persistNow();
    return this.current;
  }

  openFromText(text: string): { ok: boolean; error?: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
    return this.openFromObject(raw);
  }

  openFromObject(raw: unknown): { ok: boolean; error?: string } {
    const v = validateSpiceProject(raw);
    if (!v.ok) return { ok: false, error: v.error };
    this.current = v.project;
    this.filePath = null;
    this.dirty = false;
    this.activeDocId = null;
    this.upsertRegistry();
    this.persistNow();
    const pages = this.current.journal.pages;
    const remembered =
      typeof localStorage !== 'undefined' ? localStorage.getItem(JOURNAL_ACTIVE_PREFIX + this.current.meta.id) : null;
    this.activeJournalPageId = pages.find(p => p.id === remembered)?.id ?? pages[0]?.id ?? null;
    return { ok: true };
  }

  restoreFromLocalSession(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const wrapped = safeParse(localStorage.getItem(KEY_CURRENT));
    if (!wrapped || typeof wrapped !== 'object') return false;
    const r = wrapped as { project?: unknown; filePath?: string | null };
    const v = validateSpiceProject(r.project);
    if (!v.ok) {
      localStorage.removeItem(KEY_CURRENT);
      return false;
    }
    this.current = v.project;
    this.filePath = typeof r.filePath === 'string' && isTauri() ? r.filePath : null;
    this.dirty = false;
    this.activeDocId = null;
    const pages = this.current.journal.pages;
    const remembered = localStorage.getItem(JOURNAL_ACTIVE_PREFIX + this.current.meta.id);
    this.activeJournalPageId = pages.find(p => p.id === remembered)?.id ?? pages[0]?.id ?? null;
    return true;
  }

  closeProject() {
    this.current = null;
    this.filePath = null;
    this.dirty = false;
    this.activeDocId = null;
    this.activeJournalPageId = null;
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY_CURRENT);
  }

  renameProject(name: string) {
    if (!this.current) return;
    this.current.meta.name = name.trim() || this.current.meta.name;
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
  }

  setMetaDescription(v: string) {
    if (!this.current) return;
    this.current.meta.description = v;
    this.dirty = true;
    this.persistSoon();
  }

  setMetaPi(v: string) {
    if (!this.current) return;
    this.current.meta.pi = v;
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
  }

  removeRegistryEntry(id: string) {
    this.registry = this.registry.filter(r => r.id !== id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY_REGISTRY, JSON.stringify(this.registry));
      localStorage.removeItem(SNAP_PREFIX + id);
    }
  }

  /** Re-open a known project from its last saved snapshot (registry row action). */
  openFromSnapshot(id: string): { ok: boolean; error?: string } {
    if (typeof localStorage === 'undefined') return { ok: false, error: 'no localStorage' };
    const raw = localStorage.getItem(SNAP_PREFIX + id) ?? (this.current?.meta.id === id ? localStorage.getItem(KEY_CURRENT) : null);
    if (!raw) return { ok: false, error: 'no snapshot' };
    let wrapped: unknown = safeParse(raw);
    // KEY_CURRENT stores {project, filePath}; SNAP_* stores the project directly.
    if (wrapped && typeof wrapped === 'object' && 'project' in (wrapped as object)) {
      wrapped = (wrapped as { project: unknown }).project;
    }
    return this.openFromText(JSON.stringify(wrapped ?? null));
  }

  // ---------------- docs ----------------

  addDoc(kind: ProjectDocKind, name: string, payload: unknown): string {
    if (!this.current) throw new Error('no project open');
    const doc: ProjectDoc = {
      id: newJournalDocId(),
      kind,
      name: (name || '').trim() || (kind === 'gene' ? 'Gene' : 'Protein'),
      payload,
      updatedAt: new Date().toISOString()
    };
    this.current.docs.push(doc);
    touchUpdated(this.current);
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
    return doc.id;
  }

  getDoc(id: string): ProjectDoc | null {
    return this.current?.docs.find(d => d.id === id) ?? null;
  }

  removeDoc(id: string) {
    if (!this.current) return;
    this.current.docs = this.current.docs.filter(d => d.id !== id);
    if (this.activeDocId === id) this.activeDocId = null;
    touchUpdated(this.current);
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
  }

  renameDoc(id: string, name: string) {
    const d = this.getDoc(id);
    if (!d || !this.current) return;
    d.name = name.trim() || d.name;
    this.dirty = true;
    this.persistSoon();
  }

  docToText(id: string): string | null {
    const d = this.getDoc(id);
    return d ? JSON.stringify(d.payload, null, 2) : null;
  }

  /** Export the embedded payload as a standalone .spiceg / .spicep file. */
  async exportDocStandalone(id: string): Promise<SaveResult> {
    const d = this.getDoc(id);
    if (!d) return { ok: false, error: 'no such doc' };
    const text = JSON.stringify(d.payload, null, 2);
    const fileName = `${d.name || (d.kind === 'gene' ? 'gene' : 'protein')}.${d.kind === 'gene' ? 'spiceg' : 'spicep'}`;
    const r = await backend.saveExport(fileName, text);
    if (r.data?.saved) return { ok: true, path: r.data.path };
    return { ok: false, error: r.error, canceled: !r.error };
  }

  // ---------------- attached files (experimental data, other-software outputs) ----------------

  addFile(name: string, mime: string, dataUri: string, size: number): string {
    if (!this.current) throw new Error('no project open');
    const entry: ProjectFileEntry = {
      id: newProjectFileId(),
      name: name.trim() || 'file',
      mime: mime || 'application/octet-stream',
      size,
      data: dataUri,
      updatedAt: new Date().toISOString()
    };
    this.current.files.push(entry);
    touchUpdated(this.current);
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
    return entry.id;
  }

  getFile(id: string): ProjectFileEntry | null {
    return this.current?.files.find(f => f.id === id) ?? null;
  }

  removeFile(id: string) {
    if (!this.current) return;
    this.current.files = this.current.files.filter(f => f.id !== id);
    touchUpdated(this.current);
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
  }

  renameFile(id: string, name: string) {
    const f = this.getFile(id);
    if (!f) return;
    f.name = name.trim() || f.name;
    this.dirty = true;
    this.persistSoon();
  }

  /** Raw bytes of an attached file (for save-as / preview decoding). */
  fileBytes(id: string): Uint8Array | null {
    const f = this.getFile(id);
    if (!f) return null;
    const comma = f.data.indexOf(',');
    if (comma < 0) return null;
    const bin = atob(f.data.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------------- write-back (carrier pages) ----------------

  commitGeneDoc(payload: unknown) {
    this.commitActiveDoc('gene', payload);
  }

  commitProteinDoc(payload: unknown) {
    this.commitActiveDoc('protein', payload);
  }

  private commitActiveDoc(kind: ProjectDocKind, payload: unknown) {
    const doc = this.activeDoc;
    if (!this.current || !doc || doc.kind !== kind) return;
    doc.payload = payload;
    doc.updatedAt = new Date().toISOString();
    this.dirty = true;
    this.persistSoon();
  }

  async saveActiveDoc(opts?: { silent?: boolean }): Promise<SaveResult> {
    return this.save(opts);
  }

  // ---------------- file IO ----------------

  async save(opts?: { silent?: boolean }): Promise<SaveResult> {
    if (!this.current) return { ok: false, error: 'no project open' };
    const silent = !!opts?.silent;
    touchUpdated(this.current);
    // On disk: private SPJB binary container (float32 chunks + raw image
    // blobs + gzip). localStorage snapshots stay plain JSON text.
    const data = await encodeProject(this.current);
    const r: WriteResult = await writeProjectText(data, this.current.meta.name, this.filePath, !silent);
    if (r.saved) {
      if (r.path) this.filePath = r.path;
      this.dirty = false;
      this.upsertRegistry();
      this.writePerProjectSnapshot();
      this.persistNow();
      return { ok: true, path: r.path ?? undefined };
    }
    if (r.snapshotOnly || (silent && !r.error)) {
      // Silent mode without a known path: keep memory snapshot warm, no dialog.
      this.upsertRegistry();
      this.persistNow();
      return { ok: true, snapshotOnly: true };
    }
    this.persistSoon();
    return { ok: false, error: r.error, canceled: r.canceled };
  }

  async saveAs(): Promise<SaveResult> {
    if (!this.current) return { ok: false, error: 'no project open' };
    touchUpdated(this.current);
    const data = await encodeProject(this.current);
    const r = await writeProjectWithDialog(data, this.current.meta.name);
    if (r.saved) {
      if (r.path) this.filePath = r.path;
      this.dirty = false;
      this.upsertRegistry();
      this.writePerProjectSnapshot();
      this.persistNow();
      return { ok: true, path: r.path ?? undefined };
    }
    return { ok: false, error: r.error, canceled: r.canceled ?? true };
  }

  /** Accepts all three on-disk generations, sniffed by magic bytes:
   *  SPJB binary container > gzip'ed JSON > plain UTF-8 JSON. */
  importFromFile(file: File): Promise<{ ok: boolean; error?: string }> {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const bytes = new Uint8Array(reader.result as ArrayBuffer);
          if (looksLikeContainer(bytes)) {
            const obj = await decodeProjectAsync(bytes);
            resolve(this.openFromObject(obj));
          } else if (looksGzip(bytes)) {
            resolve(this.openFromText(await inflateBytesToText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))));
          } else {
            resolve(this.openFromText(new TextDecoder().decode(bytes)));
          }
        } catch (e: any) {
          resolve({ ok: false, error: String(e?.message ?? e) });
        }
      };
      reader.onerror = () => resolve({ ok: false, error: String(reader.error?.message ?? 'read error') });
      reader.readAsArrayBuffer(file);
    });
  }

  // ---------------- handoff protocol ----------------

  openDocInGenePage(docId: string) {
    this.prepareHandoff({ type: 'openDoc', docId, kind: 'gene' });
  }

  openDocInProteinPage(docId: string) {
    this.prepareHandoff({ type: 'openDoc', docId, kind: 'protein' });
  }

  requestWorkspaceCapture(kind: ProjectDocKind) {
    this.prepareHandoff({ type: 'capture', kind });
  }

  private prepareHandoff(h: { type: 'openDoc'; docId: string; kind: ProjectDocKind } | { type: 'capture'; kind: ProjectDocKind }) {
    this.activeDocId = h.type === 'openDoc' ? h.docId : null;
    this.handoff = { ...h, nonce: ++this.handoffSeq } as ProjectHandoff;
  }

  /** Returns the pending handoff exactly once (carrier pages call in onMount). */
  takeHandoff(): ProjectHandoff | null {
    const h = this.handoff;
    this.handoff = null;
    return h;
  }

  // ---------------- journal ----------------

  addJournalPage(): ProjectJournalPage | null {
    if (!this.current) return null;
    const page: ProjectJournalPage = {
      id: newJournalPageId(),
      title: '',
      markdownContent: '',
      date: new Date().toLocaleDateString(),
      category: 'General',
      tags: []
    };
    this.current.journal.pages.push(page);
    this.activeJournalPageId = page.id;
    touchUpdated(this.current);
    this.dirty = true;
    this.upsertRegistry();
    this.rememberJournalActive();
    this.persistSoon();
    return page;
  }

  removeJournalPage(id: string) {
    if (!this.current) return;
    this.current.journal.pages = this.current.journal.pages.filter(p => p.id !== id);
    if (this.activeJournalPageId === id) {
      this.activeJournalPageId = this.current.journal.pages[0]?.id ?? null;
      this.rememberJournalActive();
    }
    this.dirty = true;
    this.upsertRegistry();
    this.persistSoon();
  }

  selectJournalPage(id: string) {
    this.activeJournalPageId = id;
    this.rememberJournalActive();
  }

  updateJournalMeta(id: string, patch: Partial<Pick<ProjectJournalPage, 'title' | 'category' | 'tags'>>) {
    const p = this.current?.journal.pages.find(pg => pg.id === id);
    if (!p || !this.current) return;
    Object.assign(p, patch);
    this.dirty = true;
    this.persistSoon();
  }

  /** Called when leaving a page / saving: mirrors editor content into the page object. */
  commitJournalPage(id: string, markdown: string) {
    const p = this.current?.journal.pages.find(pg => pg.id === id);
    if (!p || !this.current) return;
    if (p.markdownContent === markdown) return;
    p.markdownContent = markdown;
    this.dirty = true;
    this.persistSoon();
  }
}

export const projectStore = new ProjectStore();
