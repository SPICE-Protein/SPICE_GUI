// Shared types and normalization helpers for the plate layout tool.
// Everything here is plain data so layouts can round-trip through JSON,
// localStorage and exported CSV without depending on component state.

export type PlateFormat = 6 | 12 | 24 | 48 | 96 | 384;

export const PLATE_FORMATS: PlateFormat[] = [6, 12, 24, 48, 96, 384];

export interface PlateGeometry {
  format: PlateFormat;
  rows: number;
  cols: number;
  total: number;
}

const GEOMETRY: Record<PlateFormat, [number, number]> = {
  6: [2, 3],
  12: [3, 4],
  24: [4, 6],
  48: [6, 8],
  96: [8, 12],
  384: [16, 24],
};

export function isPlateFormat(value: unknown): value is PlateFormat {
  return typeof value === 'number' && (PLATE_FORMATS as number[]).includes(value);
}

export function formatGeometry(format: PlateFormat): PlateGeometry {
  const [rows, cols] = GEOMETRY[format];
  return { format, rows, cols, total: rows * cols };
}

/** Row labels: A..Z, then AA, AB and so on. */
export function rowLabel(row: number): string {
  let n = row;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function wellId(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`;
}

export function isEdgeWell(row: number, col: number, rows: number, cols: number): boolean {
  return row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
}

export interface WellCell {
  id: string;
  row: number;
  col: number;
  edge: boolean;
}

export function buildWellCells(geometry: PlateGeometry): WellCell[] {
  const cells: WellCell[] = [];
  for (let row = 0; row < geometry.rows; row++) {
    for (let col = 0; col < geometry.cols; col++) {
      cells.push({
        id: wellId(row, col),
        row,
        col,
        edge: isEdgeWell(row, col, geometry.rows, geometry.cols),
      });
    }
  }
  return cells;
}

export function wellCellMap(geometry: PlateGeometry): Map<string, WellCell> {
  return new Map(buildWellCells(geometry).map((cell) => [cell.id, cell]));
}

export type StoredWellType = 'sample' | 'control' | 'blank' | 'reserved';
export type WellType = StoredWellType | 'empty';

export interface WellAssignment {
  well: string;
  row: number;
  col: number;
  type: StoredWellType;
  sampleId: string;
  sampleName: string;
  group: string;
  replicate: number;
  color: string;
  manual: boolean;
}

export interface SampleRow {
  id: string;
  name: string;
  group: string;
  /** Empty means the automatic palette color. */
  color: string;
  /** Null means the global replicate rule is used. */
  replicates: number | null;
}

export type GroupLayout = 'auto' | 'row' | 'column' | 'block';

export interface PlateRules {
  replicates: number;
  controls: number;
  blanks: number;
  reserveEdge: boolean;
  avoidEdge: boolean;
  keepTogether: boolean;
  groupLayout: GroupLayout;
  groupColumns: number;
  groupRows: number;
  randomize: boolean;
  seed: number;
}

export const MIN_REPLICATES = 1;
export const MAX_REPLICATES = 12;
export const MAX_SEED = 2147483647;

export function defaultRules(): PlateRules {
  return {
    replicates: 3,
    controls: 2,
    blanks: 2,
    reserveEdge: false,
    avoidEdge: true,
    keepTogether: true,
    groupLayout: 'auto',
    groupColumns: 0,
    groupRows: 0,
    randomize: true,
    seed: 20261102,
  };
}

export interface PlateProjectFile {
  version: 1;
  kind: 'spice-plate';
  title: string;
  format: PlateFormat;
  samples: SampleRow[];
  rules: PlateRules;
  assignments: WellAssignment[];
  colorBy: 'group' | 'sample';
  showLabels: boolean;
  updatedAt: string;
}

export type IssueSeverity = 'error' | 'warn' | 'info';

export interface LayoutIssue {
  key: string;
  severity: IssueSeverity;
  params?: Record<string, string | number>;
}

export interface UnplacedSample {
  sampleId: string;
  name: string;
  requested: number;
  placed: number;
  missing: number;
}

export interface SampleDraft {
  name: string;
  group: string;
  color: string;
  replicates: number | null;
}

export interface SampleParseResult {
  rows: SampleDraft[];
  skipped: number;
  delimiter: ',' | '\t' | ';';
  hadHeader: boolean;
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeColor(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return '';
}

export function requiredReplicates(sample: SampleRow, rules: PlateRules): number {
  const value = sample.replicates ?? rules.replicates;
  return clampInt(value, MIN_REPLICATES, MAX_REPLICATES, rules.replicates);
}

function normalizeSample(raw: unknown, index: number): SampleRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const group = typeof obj.group === 'string' ? obj.group.trim() : '';
  const color = normalizeColor(obj.color);
  const replicates =
    typeof obj.replicates === 'number' && Number.isFinite(obj.replicates)
      ? clampInt(obj.replicates, MIN_REPLICATES, MAX_REPLICATES, 1)
      : null;
  const id = typeof obj.id === 'string' && obj.id ? obj.id : `smp_import_${index + 1}`;
  return { id, name, group, color, replicates };
}

function normalizeRules(raw: unknown, geometry: PlateGeometry): PlateRules {
  const base = defaultRules();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const numberField = (key: string, min: number, max: number, fallback: number) =>
    typeof obj[key] === 'number' ? clampInt(obj[key] as number, min, max, fallback) : fallback;
  const boolField = (key: string, fallback: boolean) =>
    typeof obj[key] === 'boolean' ? (obj[key] as boolean) : fallback;
  const layout = obj.groupLayout;
  const groupLayout: GroupLayout =
    layout === 'auto' || layout === 'row' || layout === 'column' || layout === 'block'
      ? layout
      : base.groupLayout;
  return {
    replicates: numberField('replicates', MIN_REPLICATES, MAX_REPLICATES, base.replicates),
    controls: numberField('controls', 0, geometry.total, base.controls),
    blanks: numberField('blanks', 0, geometry.total, base.blanks),
    reserveEdge: boolField('reserveEdge', base.reserveEdge),
    avoidEdge: boolField('avoidEdge', base.avoidEdge),
    keepTogether: boolField('keepTogether', base.keepTogether),
    groupLayout,
    groupColumns: numberField('groupColumns', 0, geometry.cols, base.groupColumns),
    groupRows: numberField('groupRows', 0, geometry.rows, base.groupRows),
    randomize: boolField('randomize', base.randomize),
    seed: numberField('seed', 0, MAX_SEED, base.seed),
  };
}

export interface NormalizedProject {
  project: PlateProjectFile | null;
  duplicateWells: number;
  droppedAssignments: number;
}

/**
 * Accepts a saved project or a partial snapshot and returns a safe project.
 * Invalid wells are dropped and counted so the UI can report them instead of
 * silently discarding imported data.
 */
export function normalizeProject(raw: unknown): NormalizedProject {
  const result: NormalizedProject = { project: null, duplicateWells: 0, droppedAssignments: 0 };
  if (!raw || typeof raw !== 'object') return result;
  const obj = raw as Record<string, unknown>;
  const format = isPlateFormat(obj.format) ? obj.format : 96;
  const geometry = formatGeometry(format);
  const byWell = wellCellMap(geometry);

  const samples: SampleRow[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(obj.samples)) {
    obj.samples.forEach((entry, index) => {
      const sample = normalizeSample(entry, index);
      if (!sample) return;
      let id = sample.id;
      let suffix = 1;
      while (seenIds.has(id)) id = `${sample.id}_${suffix++}`;
      seenIds.add(id);
      samples.push({ ...sample, id });
    });
  }

  const rules = normalizeRules(obj.rules, geometry);

  const rawAssignments: unknown[] = Array.isArray(obj.assignments)
    ? obj.assignments
    : obj.assignments && typeof obj.assignments === 'object'
      ? Object.values(obj.assignments as Record<string, unknown>)
      : [];

  const assignments: WellAssignment[] = [];
  const seenWells = new Set<string>();
  for (const entry of rawAssignments) {
    if (!entry || typeof entry !== 'object') {
      result.droppedAssignments++;
      continue;
    }
    const value = entry as Record<string, unknown>;
    const id = typeof value.well === 'string' ? value.well.toUpperCase() : '';
    const cell = byWell.get(id);
    if (!cell) {
      result.droppedAssignments++;
      continue;
    }
    if (seenWells.has(id)) {
      result.duplicateWells++;
      continue;
    }
    const type = value.type;
    if (type !== 'sample' && type !== 'control' && type !== 'blank' && type !== 'reserved') {
      result.droppedAssignments++;
      continue;
    }
    seenWells.add(id);
    assignments.push({
      well: id,
      row: cell.row,
      col: cell.col,
      type,
      sampleId: typeof value.sampleId === 'string' ? value.sampleId : '',
      sampleName: typeof value.sampleName === 'string' ? value.sampleName : '',
      group: typeof value.group === 'string' ? value.group : '',
      replicate: typeof value.replicate === 'number' ? clampInt(value.replicate, 0, MAX_REPLICATES, 0) : 0,
      color: normalizeColor(value.color),
      manual: value.manual === true,
    });
  }
  assignments.sort((a, b) => a.row - b.row || a.col - b.col);

  const colorBy = obj.colorBy === 'sample' ? 'sample' : 'group';
  const title = typeof obj.title === 'string' ? obj.title : '';
  const showLabels = typeof obj.showLabels === 'boolean' ? obj.showLabels : format !== 384;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString();

  result.project = {
    version: 1,
    kind: 'spice-plate',
    title,
    format,
    samples,
    rules,
    assignments,
    colorBy,
    showLabels,
    updatedAt,
  };
  return result;
}

export function assignmentsToMap(assignments: WellAssignment[]): Record<string, WellAssignment> {
  const map: Record<string, WellAssignment> = {};
  for (const assignment of assignments) map[assignment.well] = assignment;
  return map;
}
