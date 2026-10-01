// SPICE_PROJECT file schema — a single .spiceproj container that embeds full
// gene/protein documents plus a multi-page markdown journal.
// On disk, saved .spiceproj files use the private SPJB binary container
// (float32 chunks for numeric arrays + raw image blobs + gzip — see
// container.ts). This in-memory JSON shape is what the container encodes,
// what localStorage snapshots hold, and what legacy gen-1 files contain.

export type ProjectDocKind = 'gene' | 'protein';

export interface ProjectDoc {
  id: string;
  kind: ProjectDocKind;
  name: string;
  /** Full SpiceGeneFile / SPICE_PROTEIN payload, kept opaque here. */
  payload: unknown;
  updatedAt: string;
}

export interface ProjectJournalPage {
  id: string;
  title: string;
  markdownContent: string;
  date: string;
  category: string;
  tags: string[];
}

export interface SpiceProjectMeta {
  id: string;
  name: string;
  description: string;
  pi: string;
  createdAt: string;
  updatedAt: string;
  version: '1.0';
}

/** Arbitrary attached files (experimental data, other-software outputs).
 *  `data` is a data: URI in the in-memory/JSON shape; the SPJB container
 *  extracts it into a raw binary chunk on save (see container.ts). */
export interface ProjectFileEntry {
  id: string;
  name: string;
  mime: string;
  size: number;
  data: string;
  updatedAt: string;
}

export interface SpiceProjectFile {
  format: 'SPICE_PROJECT';
  version: '1.1';
  meta: SpiceProjectMeta;
  journal: { pages: ProjectJournalPage[] };
  docs: ProjectDoc[];
  files: ProjectFileEntry[];
}

/** Registry entry — deliberately payload-free so it stays tiny in localStorage. */
export interface ProjectSummary {
  id: string;
  name: string;
  pi: string;
  updatedAt: string;
  filePath: string | null;
  docCount: number;
  journalCount: number;
  fileCount: number;
}

export const PROJECT_FORMAT = 'SPICE_PROJECT';
export const PROJECT_VERSION = '1.1';
/** gen-1.0 files (no files[]) remain readable. */
export const PROJECT_ACCEPTED_VERSIONS = ['1.0', '1.1'];

export function newProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newJournalDocId(): string {
  return newDocId('doc');
}

export function newJournalPageId(): string {
  return newDocId('jp');
}

export function newProjectFileId(): string {
  return newDocId('file');
}

export function newProject(name: string, pi = '', description = ''): SpiceProjectFile {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta: { id: newProjectId(), name, description, pi, createdAt: now, updatedAt: now, version: '1.0' },
    journal: { pages: [] },
    docs: [],
    files: []
  };
}

export type ValidationResult = { ok: true; project: SpiceProjectFile } | { ok: false; error: string };

export function validateSpiceProject(x: unknown): ValidationResult {
  if (!x || typeof x !== 'object') return { ok: false, error: 'not an object' };
  const p = x as Partial<SpiceProjectFile>;
  if (p.format !== PROJECT_FORMAT) return { ok: false, error: `format !== ${PROJECT_FORMAT}` };
  if (!PROJECT_ACCEPTED_VERSIONS.includes(String(p.version))) {
    return { ok: false, error: `unsupported version: ${String(p.version)} (expected one of ${PROJECT_ACCEPTED_VERSIONS.join(', ')})` };
  }
  const meta = p.meta as Partial<SpiceProjectMeta> | undefined;
  if (!meta || typeof meta.id !== 'string' || typeof meta.name !== 'string' || !meta.name) {
    return { ok: false, error: 'meta.id / meta.name missing' };
  }
  if (!Array.isArray(p.docs)) return { ok: false, error: 'docs is not an array' };
  for (const d of p.docs as Partial<ProjectDoc>[]) {
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string') return { ok: false, error: 'doc missing id/name' };
    if (d.kind !== 'gene' && d.kind !== 'protein') return { ok: false, error: `doc ${d.id}: bad kind ${String(d.kind)}` };
    const payload = d.payload as { format?: string } | null;
    const expected = d.kind === 'gene' ? 'SPICE_GENE' : 'SPICE_PROTEIN';
    if (!payload || typeof payload !== 'object' || payload.format !== expected) {
      return { ok: false, error: `doc ${d.name}: payload is not ${expected}` };
    }
  }
  const pages = p.journal?.pages;
  if (!Array.isArray(pages)) return { ok: false, error: 'journal.pages is not an array' };
  for (const pg of pages as Partial<ProjectJournalPage>[]) {
    if (!pg || typeof pg.id !== 'string' || typeof pg.markdownContent !== 'string') {
      return { ok: false, error: 'journal page missing id/markdownContent' };
    }
  }
  // Normalize the softer fields so downstream UI never sees undefined.
  const project = p as SpiceProjectFile;
  project.meta.description = typeof meta.description === 'string' ? meta.description : '';
  project.meta.pi = typeof meta.pi === 'string' ? meta.pi : '';
  project.meta.createdAt = typeof meta.createdAt === 'string' ? meta.createdAt : new Date().toISOString();
  project.meta.updatedAt = typeof meta.updatedAt === 'string' ? meta.updatedAt : new Date().toISOString();
  project.docs = (project.docs || []).map(d => ({
    id: d.id,
    kind: d.kind,
    name: d.name,
    payload: d.payload,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString()
  }));
  project.journal.pages = pages.map(pg => ({
    id: pg.id as string,
    title: typeof pg.title === 'string' ? pg.title : '',
    markdownContent: pg.markdownContent as string,
    date: typeof pg.date === 'string' ? pg.date : new Date().toLocaleDateString(),
    category: typeof pg.category === 'string' ? pg.category : 'General',
    tags: Array.isArray(pg.tags) ? pg.tags.filter(t => typeof t === 'string') : []
  }));
  const files = Array.isArray(p.files) ? (p.files as Partial<ProjectFileEntry>[]) : [];
  for (const f of files) {
    if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.data !== 'string') {
      return { ok: false, error: 'attached file missing id/name/data' };
    }
  }
  project.files = files.map(f => ({
    id: f.id as string,
    name: f.name as string,
    mime: typeof f.mime === 'string' ? f.mime : 'application/octet-stream',
    size: typeof f.size === 'number' ? f.size : 0,
    data: f.data as string,
    updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : new Date().toISOString()
  }));
  // Upgrade in-memory to the current version (next save writes 1.1).
  project.version = PROJECT_VERSION;
  return { ok: true, project };
}

export function touchUpdated(p: SpiceProjectFile): void {
  p.meta.updatedAt = new Date().toISOString();
}

export function summarize(p: SpiceProjectFile, filePath: string | null): ProjectSummary {
  return {
    id: p.meta.id,
    name: p.meta.name,
    pi: p.meta.pi,
    updatedAt: p.meta.updatedAt,
    filePath,
    docCount: p.docs.length,
    journalCount: p.journal.pages.length,
    fileCount: p.files.length
  };
}
