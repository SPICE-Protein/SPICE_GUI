// Data model for the qPCR analysis tool. Everything is plain JSON so a project
// can be downloaded, imported and autosaved without extra serialization code.

export type QpcrMode = 'ddct' | 'standard';

export type ColumnKey =
  | 'well'
  | 'sample'
  | 'target'
  | 'ct'
  | 'group'
  | 'replicate'
  | 'efficiency'
  | 'tm'
  | 'quantity';

export const COLUMN_KEYS: ColumnKey[] = [
  'well',
  'sample',
  'target',
  'ct',
  'group',
  'replicate',
  'efficiency',
  'tm',
  'quantity',
];

export type ColumnMapping = Record<ColumnKey, number>;

export interface Well {
  id: string;
  /** Zero-based data row index (the header is not counted). */
  row: number;
  well: string;
  sample: string;
  target: string;
  group: string;
  replicate: number | null;
  ct: number | null;
  tm: number | null;
  efficiency: number | null;
  /** Known standard quantity. Wells with a value are treated as standards. */
  quantity: number | null;
  /** User-controlled inclusion flag from the raw data table. */
  include: boolean;
}

export interface QpcrSettings {
  highCt: number;
  sdLimit: number;
  outlierLimit: number;
  excludeOutliers: boolean;
  efficiencyCorrection: boolean;
  defaultEfficiencyPct: number;
  quantityIsLog10: boolean;
  showHeatmap: boolean;
  /** Legacy single reference; kept in sync with the first reference target. */
  referenceTarget: string;
  /** One or more reference targets; their Ct geometric mean is the reference.
   *  Optional so older projects and callers that only set referenceTarget stay
   *  valid; sanitizeSettings migrates them. */
  referenceTargets?: string[];
  controlGroup: string;
  controlSample: string;
}

export interface QpcrProject {
  format: 'SPICE_QPCR';
  version: 1;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  rawText: string;
  mapping: ColumnMapping;
  wells: Well[];
  settings: QpcrSettings;
  mode: QpcrMode;
}

export function emptyMapping(): ColumnMapping {
  return {
    well: -1,
    sample: -1,
    target: -1,
    ct: -1,
    group: -1,
    replicate: -1,
    efficiency: -1,
    tm: -1,
    quantity: -1,
  };
}

export function defaultSettings(): QpcrSettings {
  return {
    highCt: 35,
    sdLimit: 0.5,
    outlierLimit: 0.5,
    excludeOutliers: false,
    efficiencyCorrection: false,
    defaultEfficiencyPct: 100,
    quantityIsLog10: false,
    showHeatmap: false,
    referenceTarget: '',
    referenceTargets: [],
    controlGroup: '',
    controlSample: '',
  };
}

/** Clamp numeric settings and normalize optional booleans/strings. */
export function sanitizeSettings(settings: QpcrSettings): QpcrSettings {
  const number = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const legacy = text(settings.referenceTarget).trim();
  const rawList = (settings as Partial<QpcrSettings> & { referenceTargets?: unknown })
    .referenceTargets;
  const list = Array.isArray(rawList)
    ? rawList
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  const unique: string[] = [];
  for (const value of list.length ? list : legacy ? [legacy] : []) {
    if (!unique.some((item) => item.toLowerCase() === value.toLowerCase())) unique.push(value);
  }
  return {
    highCt: number(settings.highCt, 10, 45, 35),
    sdLimit: number(settings.sdLimit, 0, 5, 0.5),
    outlierLimit: number(settings.outlierLimit, 0, 5, 0.5),
    excludeOutliers: settings.excludeOutliers === true,
    efficiencyCorrection: settings.efficiencyCorrection === true,
    defaultEfficiencyPct: number(settings.defaultEfficiencyPct, 1, 200, 100),
    quantityIsLog10: settings.quantityIsLog10 === true,
    showHeatmap: settings.showHeatmap === true,
    referenceTarget: unique[0] ?? legacy,
    referenceTargets: unique,
    controlGroup: text(settings.controlGroup),
    controlSample: text(settings.controlSample),
  };
}

export function emptyProject(): QpcrProject {
  const now = new Date().toISOString();
  return {
    format: 'SPICE_QPCR',
    version: 1,
    createdAt: now,
    updatedAt: now,
    fileName: '',
    rawText: '',
    mapping: emptyMapping(),
    wells: [],
    settings: defaultSettings(),
    mode: 'ddct',
  };
}

function normalizeWell(input: unknown, index: number): Well | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<Well>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `r${index}`,
    row: typeof raw.row === 'number' ? raw.row : index,
    well: typeof raw.well === 'string' ? raw.well : '',
    sample: typeof raw.sample === 'string' ? raw.sample : '',
    target: typeof raw.target === 'string' ? raw.target : '',
    group: typeof raw.group === 'string' ? raw.group : '',
    replicate: num(raw.replicate),
    ct: num(raw.ct),
    tm: num(raw.tm),
    efficiency: num(raw.efficiency),
    quantity: num(raw.quantity),
    include: raw.include !== false,
  };
}

/** Validate an imported project and fill missing optional fields. */
export function normalizeProject(input: unknown): QpcrProject | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<QpcrProject>;
  if (raw.format !== 'SPICE_QPCR' || raw.version !== 1) return null;
  if (typeof raw.rawText !== 'string' || !Array.isArray(raw.wells)) return null;
  const base = emptyProject();
  const seenIds = new Set<string>();
  const wells = raw.wells
    .map((w, i) => normalizeWell(w, i))
    .filter((w): w is Well => !!w)
    .map((well, i) => {
      if (seenIds.has(well.id)) well.id = `r${i}-${seenIds.size}`;
      seenIds.add(well.id);
      return well;
    });
  return {
    ...base,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    rawText: raw.rawText,
    mapping: { ...emptyMapping(), ...(raw.mapping ?? {}) },
    settings: sanitizeSettings({ ...defaultSettings(), ...(raw.settings ?? {}) }),
    mode: raw.mode === 'standard' ? 'standard' : 'ddct',
    wells,
  };
}
