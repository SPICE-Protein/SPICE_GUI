// Cross-tool sample sheet ("SPICE_SAMPLES") and plate-map interchange.
// The plate designer can write it, qPCR/blot/colony can read it, and the
// generic sample fields stay intentionally small so every tool can map them.

export interface SampleSheetEntry {
  id?: string;
  name: string;
  group: string;
  color?: string;
  replicates?: number;
  notes?: string;
}

export interface SampleSheet {
  format: 'SPICE_SAMPLES';
  version: 1;
  name: string;
  samples: SampleSheetEntry[];
  updatedAt: string;
}

export interface PlateMapRow {
  well: string;
  sample: string;
  group: string;
  type: string;
  replicate: number | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function emptySampleSheet(name = 'Samples'): SampleSheet {
  return { format: 'SPICE_SAMPLES', version: 1, name, samples: [], updatedAt: new Date().toISOString() };
}

export function normalizeSampleSheet(input: unknown): SampleSheet | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const list = Array.isArray(raw.samples) ? raw.samples : Array.isArray(input) ? input : null;
  if (!list) return null;
  const samples: SampleSheetEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const name = clean(e.name) || clean(e.sample);
    if (!name) continue;
    const replicateValue = Number(e.replicates ?? e.n ?? 1);
    samples.push({
      id: clean(e.id) || undefined,
      name,
      group: clean(e.group) || clean(e.condition),
      color: clean(e.color) || undefined,
      replicates: Number.isFinite(replicateValue) && replicateValue > 0 ? Math.round(replicateValue) : undefined,
      notes: clean(e.notes) || undefined
    });
  }
  return {
    format: 'SPICE_SAMPLES',
    version: 1,
    name: clean(raw.name) || 'Samples',
    samples,
    updatedAt: clean(raw.updatedAt) || new Date().toISOString()
  };
}

export function parseSampleSheet(text: string): SampleSheet | null {
  try {
    return normalizeSampleSheet(JSON.parse(text));
  } catch {
    return null;
  }
}

export function sampleSheetToJson(sheet: SampleSheet): string {
  return JSON.stringify({ ...sheet, updatedAt: new Date().toISOString() }, null, 2);
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sampleSheetToCsv(sheet: SampleSheet): string {
  const rows = sheet.samples.map((s) =>
    [s.name, s.group, s.color ?? '', s.replicates ?? '', s.notes ?? ''].map(csvCell).join(',')
  );
  return ['sample,group,color,replicates,notes', ...rows].join('\n');
}

function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((v) => v.trim());
}

/** Parse the `well,sample,group,type,replicate` CSV/TSV emitted by plate. */
export function parsePlateMap(text: string): PlateMapRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const header = splitDelimited(lines[0], delimiter).map((h) => h.toLowerCase());
  const at = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const wellAt = at('well', 'well_id', 'position');
  const sampleAt = at('sample', 'sample_name', 'name');
  const groupAt = at('group', 'condition', 'treatment');
  const typeAt = at('type', 'kind');
  const repAt = at('replicate', 'rep', 'n');
  if (wellAt < 0) return [];
  const rows: PlateMapRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter);
    const well = clean(cells[wellAt]).toUpperCase();
    if (!well) continue;
    const rep = repAt >= 0 ? Number(cells[repAt]) : NaN;
    rows.push({
      well,
      sample: sampleAt >= 0 ? clean(cells[sampleAt]) : '',
      group: groupAt >= 0 ? clean(cells[groupAt]) : '',
      type: typeAt >= 0 ? clean(cells[typeAt]).toLowerCase() : 'sample',
      replicate: Number.isFinite(rep) && rep > 0 ? Math.round(rep) : null
    });
  }
  return rows;
}

/**
 * Normalise plate-map labels into a qPCR-ready TSV. Target and Ct are left
 * blank for the user/instrument to fill; the sample/group/replicate skeleton
 * is the part worth carrying across tools.
 */
export function plateMapToQpcrTsv(rows: PlateMapRow[], target = ''): string {
  const header = 'well\tsample\ttarget\tct\tgroup\treplicate';
  const body = rows.map((r) =>
    [r.well, r.sample, target, '', r.group, r.replicate ?? ''].join('\t')
  );
  return [header, ...body].join('\n');
}
