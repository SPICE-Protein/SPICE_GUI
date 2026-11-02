// Table parsing for qPCR exports: TSV/CSV with quoted fields, numeric Ct
// values, efficiency percentages and optional standard quantities.
import {
  COLUMN_KEYS,
  emptyMapping,
  type ColumnKey,
  type ColumnMapping,
  type Well,
} from './types';

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const DELIMITERS = ['\t', ',', ';'];

/** Count delimiter candidates outside quoted sections of one line. */
function detectDelimiter(line: string): string {
  const counts: Record<string, number> = { '\t': 0, ',': 0, ';': 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch in counts) {
      counts[ch]++;
    }
  }
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    if (counts[d] > bestCount) {
      best = d;
      bestCount = counts[d];
    }
  }
  return best;
}

/** Parse a delimited text table, honouring double-quoted fields. */
export function parseDelimited(text: string, delimiter?: string): ParsedTable {
  const clean = text.replace(/^﻿/, '');
  const firstLineEnd = clean.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd);
  const delim = delimiter ?? detectDelimiter(firstLine);

  const rawRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rawRows.push(row);
      row = [];
    } else if (ch === '\r') {
      // CRLF: the LF branch closes the row. A lone CR is treated as a newline.
      if (clean[i + 1] !== '\n') {
        row.push(field);
        field = '';
        rawRows.push(row);
        row = [];
      }
    } else {
      field += ch;
    }
  }
  row.push(field);
  rawRows.push(row);

  const nonEmpty = rawRows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [], delimiter: delim };

  const headers = nonEmpty[0].map((h) => h.trim());
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded.map((c) => c.trim());
  });
  return { headers, rows, delimiter: delim };
}

const COLUMN_SYNONYMS: Record<ColumnKey, string[]> = {
  well: ['well', 'wellid', 'wellname', 'wellnumber', 'position', 'wellposition'],
  sample: ['sample', 'samplename', 'sampleid', 'samplenumber', 'name', 'id'],
  target: [
    'target',
    'targetname',
    'gene',
    'genename',
    'assay',
    'assayname',
    'detector',
    'primer',
    'amplicon',
  ],
  ct: ['ct', 'cq', 'ctvalue', 'cqvalue', 'ctmean', 'cqmean', 'thresholdcycle', 'cyclethreshold', 'cr'],
  group: ['group', 'groupname', 'condition', 'treatment', 'cohort', 'genotype', 'strain'],
  replicate: [
    'replicate',
    'rep',
    'replicatenumber',
    'replicateid',
    'technicalreplicate',
    'bioreplicate',
    'techrep',
    'biorep',
  ],
  efficiency: ['efficiency', 'eff', 'amplificationefficiency', 'pcr efficiency', 'primerefficiency'],
  tm: ['tm', 'melttemp', 'melttemperature', 'meltingtemperature', 'meltingtemp', 'temperature'],
  quantity: [
    'quantity',
    'quantitycopies',
    'copies',
    'copynumber',
    'standardquantity',
    'startingquantity',
    'log10quantity',
    'logquantity',
  ],
};

const AUTO_MAP_ORDER: ColumnKey[] = [
  'ct',
  'sample',
  'target',
  'well',
  'group',
  'replicate',
  'efficiency',
  'tm',
  'quantity',
];

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Case-insensitive header auto-mapping. A column is used at most once. */
export function autoMap(headers: string[]): ColumnMapping {
  const mapping = emptyMapping();
  const used = new Set<number>();
  const normalized = headers.map(normalizeHeader);

  // Exact synonym matches first, then a conservative containment pass.
  for (const key of AUTO_MAP_ORDER) {
    const synonyms = COLUMN_SYNONYMS[key].map(normalizeHeader);
    const index = normalized.findIndex((h, i) => !!h && !used.has(i) && synonyms.includes(h));
    if (index >= 0) {
      mapping[key] = index;
      used.add(index);
    }
  }
  for (const key of AUTO_MAP_ORDER) {
    if (mapping[key] >= 0) continue;
    const synonyms = COLUMN_SYNONYMS[key].map(normalizeHeader).filter((s) => s.length >= 3);
    const index = normalized.findIndex(
      (h, i) => !!h && !used.has(i) && synonyms.some((s) => h.includes(s)),
    );
    if (index >= 0) {
      mapping[key] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function missingRequiredColumns(mapping: ColumnMapping): ColumnKey[] {
  return (['sample', 'target', 'ct'] as ColumnKey[]).filter((k) => mapping[k] < 0);
}

export function mappedColumnCount(mapping: ColumnMapping): number {
  return COLUMN_KEYS.filter((k) => mapping[k] >= 0).length;
}

const UNDETERMINED = new Set([
  '',
  '-',
  '--',
  'na',
  'n/a',
  'nan',
  'none',
  'null',
  'undetermined',
  'undet',
  'noct',
  'no ct',
  'notdetected',
  'not detected',
]);

/** Parse a Ct cell. Returns null for undetermined or non-numeric values. */
export function parseCtCell(value: string): number | null {
  const raw = value.trim();
  if (UNDETERMINED.has(raw.toLowerCase())) return null;
  return parseNumericCell(raw);
}

export function parseNumericCell(value: string): number | null {
  let raw = value.trim();
  if (!raw) return null;
  if (/^-?\d+,\d+$/.test(raw)) raw = raw.replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse an efficiency cell. Values above 2 are treated as percentages. */
export function parseEfficiencyCell(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const percent = raw.endsWith('%');
  const n = parseNumericCell(percent ? raw.slice(0, -1) : raw);
  if (n === null || n <= 0) return null;
  const fraction = percent || n > 2 ? n / 100 : n;
  return fraction > 0 && Number.isFinite(fraction) ? fraction : null;
}

export function parseReplicateCell(value: string): number | null {
  const n = parseNumericCell(value);
  return n === null ? null : n;
}

export function parseQuantityCell(value: string): number | null {
  return parseNumericCell(value);
}

/** Build the editable well list from a parsed table and a column mapping. */
export function buildWells(
  table: ParsedTable,
  mapping: ColumnMapping,
  previous: Well[] = [],
): Well[] {
  const previousInclude = new Map(previous.map((w) => [w.row, w.include]));
  const cell = (row: string[], key: ColumnKey): string => {
    const index = mapping[key];
    return index >= 0 ? (row[index] ?? '').trim() : '';
  };
  return table.rows.map((row, index) => {
    const ct = parseCtCell(cell(row, 'ct'));
    const quantity = parseQuantityCell(cell(row, 'quantity'));
    return {
      id: `r${index}`,
      row: index,
      well: cell(row, 'well'),
      sample: cell(row, 'sample'),
      target: cell(row, 'target'),
      group: cell(row, 'group'),
      replicate: parseReplicateCell(cell(row, 'replicate')),
      ct,
      tm: parseNumericCell(cell(row, 'tm')),
      efficiency: parseEfficiencyCell(cell(row, 'efficiency')),
      quantity,
      include: previousInclude.get(index) ?? true,
    };
  });
}
