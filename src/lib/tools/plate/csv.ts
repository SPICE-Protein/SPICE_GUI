// CSV/TSV helpers for sample import and plate map export.

import {
  clampInt,
  formatGeometry,
  normalizeColor,
  wellId,
  type PlateFormat,
  type SampleDraft,
  type SampleParseResult,
  type WellAssignment,
} from './types';

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function detectDelimiter(line: string): ',' | '\t' | ';' {
  let tabs = 0;
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '\t') tabs++;
    else if (ch === ',') commas++;
    else if (ch === ';') semicolons++;
  }
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

const NAME_HEADERS = new Set([
  'sample',
  'samples',
  'sample id',
  'sampleid',
  'sample name',
  'samplename',
  'sample_id',
  'name',
  'id',
]);

const GROUP_HEADERS = new Set(['group', 'condition', 'treatment', 'category', 'class']);

const COLOR_HEADERS = new Set(['color', 'colour', 'hex', 'fill']);

const REPLICATE_HEADERS = new Set(['replicate', 'replicates', 'reps', 'rep', 'n', 'count']);

function headerIndex(cells: string[], headers: Set<string>): number {
  for (let i = 0; i < cells.length; i++) {
    if (headers.has(cells[i].toLowerCase())) return i;
  }
  return -1;
}

function parseReplicates(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return null;
  return clampInt(value, 1, 12, 1);
}

/** Parses pasted or uploaded CSV/TSV sample tables. */
export function parseSampleTable(text: string): SampleParseResult {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  const firstLine = lines[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const firstCells = splitLine(firstLine, delimiter);
  const knownHeaders = new Set([
    ...NAME_HEADERS,
    ...GROUP_HEADERS,
    ...COLOR_HEADERS,
    ...REPLICATE_HEADERS,
  ]);
  const hasNameHeader = firstCells.some((cell) => NAME_HEADERS.has(cell.toLowerCase()));
  const allKnown = firstCells.every((cell) => !cell || knownHeaders.has(cell.toLowerCase()));
  const hadHeader = hasNameHeader && allKnown;

  let nameIndex = 0;
  let groupIndex = 1;
  let colorIndex = 2;
  let replicateIndex = 3;
  let start = 0;
  if (hadHeader) {
    start = 1;
    const name = headerIndex(firstCells, NAME_HEADERS);
    const group = headerIndex(firstCells, GROUP_HEADERS);
    const color = headerIndex(firstCells, COLOR_HEADERS);
    const replicates = headerIndex(firstCells, REPLICATE_HEADERS);
    nameIndex = name >= 0 ? name : 0;
    groupIndex = group;
    colorIndex = color;
    replicateIndex = replicates;
  }

  const rows: SampleDraft[] = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    const name = (cells[nameIndex] ?? '').trim();
    if (!name) {
      skipped++;
      continue;
    }
    const group = groupIndex >= 0 ? (cells[groupIndex] ?? '').trim() : '';
    const color = colorIndex >= 0 ? normalizeColor(cells[colorIndex]) : '';
    const replicates = replicateIndex >= 0 ? parseReplicates(cells[replicateIndex] ?? '') : null;
    rows.push({ name, group, color, replicates });
  }

  return { rows, skipped, delimiter, hadHeader };
}

export interface PlateTableRow {
  well: string;
  sample: string;
  group: string;
  type: 'sample' | 'control' | 'blank' | 'reserved' | 'empty';
  replicate: number | null;
}

export function buildPlateRows(
  format: PlateFormat,
  assignments: Record<string, WellAssignment>,
): PlateTableRow[] {
  const geometry = formatGeometry(format);
  const rows: PlateTableRow[] = [];
  for (let row = 0; row < geometry.rows; row++) {
    for (let col = 0; col < geometry.cols; col++) {
      const id = wellId(row, col);
      const assignment = assignments[id];
      if (!assignment) {
        rows.push({ well: id, sample: '', group: '', type: 'empty', replicate: null });
        continue;
      }
      rows.push({
        well: id,
        sample: assignment.sampleName || assignment.sampleId,
        group: assignment.group,
        type: assignment.type,
        replicate: assignment.type === 'reserved' ? null : assignment.replicate,
      });
    }
  }
  return rows;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function tsvCell(value: string | number | null): string {
  if (value === null) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

export function plateRowsToCsv(rows: PlateTableRow[]): string {
  const header = 'well,sample,group,type,replicate';
  const body = rows.map((row) =>
    [row.well, row.sample, row.group, row.type, row.replicate].map(csvCell).join(','),
  );
  return [header, ...body].join('\n');
}

export function plateRowsToTsv(rows: PlateTableRow[]): string {
  const header = 'well\tsample\tgroup\ttype\treplicate';
  const body = rows.map((row) =>
    [row.well, row.sample, row.group, row.type, row.replicate].map(tsvCell).join('\t'),
  );
  return [header, ...body].join('\n');
}

/** Safe ASCII file stem derived from the user-supplied plate title. */
export function fileBaseName(title: string, fallback = 'plate-layout'): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
