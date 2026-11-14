// SPICE_PROTOCOL_LIBRARY singleton store.
//
// Templates and runs live in a single localStorage snapshot. Every mutator
// schedules a 400 ms debounced persist; callers never touch localStorage.
// A corrupt snapshot is discarded rather than partially loaded.
//
// Rules:
// - No module-scope $effect (illegal outside components).
// - Mutators update $state and call persistSoon(); the store owns all I/O.
import {
  PROTOCOL_FORMAT,
  PROTOCOL_VERSION,
  completeProtocolRun,
  createProtocolTemplate,
  createRunFromTemplate,
  setRunStep,
  validateProtocolLibrary,
  type ProtocolLibraryFile,
  type ProtocolRun,
  type ProtocolRunLinks,
  type ProtocolTemplate,
  type ProtocolValidationResult,
  type StepStatus
} from './types';

export const PROTOCOL_STORAGE_KEY = 'spice_protocol_library';

export type ProtocolImportResult = { ok: true } | { ok: false; error: string };

class ProtocolStore {
  templates = $state<ProtocolTemplate[]>([]);
  runs = $state<ProtocolRun[]>([]);

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private metaName = 'Protocol Library';
  private createdAt = new Date().toISOString();

  constructor() {
    this.load();
  }

  // ---------------- persistence ----------------

  private storage(): Storage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
  }

  private load() {
    const storage = this.storage();
    if (!storage) return;
    const raw = storage.getItem(PROTOCOL_STORAGE_KEY);
    if (raw === null) return;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const result = validateProtocolLibrary(parsed);
    if (!result.ok) {
      console.warn(`[protocol] corrupt library (${result.error}) - reset`);
      this.templates = [];
      this.runs = [];
      storage.removeItem(PROTOCOL_STORAGE_KEY);
      return;
    }
    this.applyLibrary(result.library);
  }

  private applyLibrary(library: ProtocolLibraryFile) {
    this.templates = library.templates;
    this.runs = library.runs;
    this.metaName = library.meta.name;
    this.createdAt = library.meta.createdAt;
  }

  private persistSoon() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 400);
  }

  persistNow() {
    const storage = this.storage();
    if (!storage) return;
    try {
      storage.setItem(PROTOCOL_STORAGE_KEY, this.exportText());
    } catch (error) {
      // Quota or private-mode failures must not break the editor.
      console.warn('[protocol] persist failed', error);
    }
  }

  // ---------------- import / export ----------------

  get library(): ProtocolLibraryFile {
    return {
      format: PROTOCOL_FORMAT,
      version: PROTOCOL_VERSION,
      meta: {
        name: this.metaName,
        createdAt: this.createdAt,
        updatedAt: new Date().toISOString()
      },
      templates: this.templates,
      runs: this.runs
    };
  }

  exportText(): string {
    return JSON.stringify(this.library, null, 2);
  }

  importText(text: string): ProtocolImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) };
    }
    const result: ProtocolValidationResult = validateProtocolLibrary(parsed);
    if (!result.ok) return { ok: false, error: result.error };
    this.applyLibrary(result.library);
    this.persistNow();
    return { ok: true };
  }

  /** Drop all local protocol data (used by tests and "clear library"). */
  reset() {
    this.templates = [];
    this.runs = [];
    this.metaName = 'Protocol Library';
    this.createdAt = new Date().toISOString();
    this.persistNow();
  }

  // ---------------- templates ----------------

  getTemplate(id: string): ProtocolTemplate | null {
    return this.templates.find(template => template.id === id) ?? null;
  }

  addTemplate(template: ProtocolTemplate): ProtocolTemplate {
    this.templates = [...this.templates, template];
    this.persistSoon();
    return template;
  }

  createTemplate(partial: Partial<ProtocolTemplate> = {}): ProtocolTemplate {
    return this.addTemplate(createProtocolTemplate(partial));
  }

  updateTemplate(
    id: string,
    patch: Partial<Omit<ProtocolTemplate, 'id' | 'createdAt'>>
  ): ProtocolTemplate | null {
    const index = this.templates.findIndex(template => template.id === id);
    if (index < 0) return null;
    const current = this.templates[index];
    const next: ProtocolTemplate = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };
    this.templates = this.templates.map((template, i) => (i === index ? next : template));
    this.persistSoon();
    return next;
  }

  removeTemplate(id: string): boolean {
    const next = this.templates.filter(template => template.id !== id);
    if (next.length === this.templates.length) return false;
    this.templates = next;
    this.persistSoon();
    return true;
  }

  // ---------------- runs ----------------

  getRun(id: string): ProtocolRun | null {
    return this.runs.find(run => run.id === id) ?? null;
  }

  addRun(run: ProtocolRun): ProtocolRun {
    this.runs = [...this.runs, run];
    this.persistSoon();
    return run;
  }

  createRun(
    template: ProtocolTemplate,
    values: Record<string, string | number | boolean> = {},
    links: ProtocolRunLinks = {}
  ): ProtocolRun {
    return this.addRun(createRunFromTemplate(template, values, links));
  }

  updateRun(
    id: string,
    patch: Partial<Omit<ProtocolRun, 'id' | 'createdAt'>>
  ): ProtocolRun | null {
    const index = this.runs.findIndex(run => run.id === id);
    if (index < 0) return null;
    const current = this.runs[index];
    const next: ProtocolRun = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };
    this.runs = this.runs.map((run, i) => (i === index ? next : run));
    this.persistSoon();
    return next;
  }

  setStep(runId: string, stepId: string, status: StepStatus): ProtocolRun | null {
    const run = this.getRun(runId);
    if (!run) return null;
    setRunStep(run, stepId, status);
    this.persistSoon();
    return run;
  }

  completeRun(runId: string, resultMarkdown: string): ProtocolRun | null {
    const run = this.getRun(runId);
    if (!run) return null;
    completeProtocolRun(run, resultMarkdown);
    this.persistSoon();
    return run;
  }

  removeRun(id: string): boolean {
    const next = this.runs.filter(run => run.id !== id);
    if (next.length === this.runs.length) return false;
    this.runs = next;
    this.persistSoon();
    return true;
  }

  runsForProject(projectId: string): ProtocolRun[] {
    return this.runs.filter(run => run.projectId === projectId);
  }

  runsForJournalPage(pageId: string): ProtocolRun[] {
    return this.runs.filter(run => run.journalPageId === pageId);
  }
}

export const protocolStore = new ProtocolStore();
