// Metadata import (CSV/TSV) and palette assignment for leaf/group colors.
import type { MetaEntry, ResolvedMetadata, TreeMetadata } from './types';
import { PALETTES } from './types';

export class MetadataParseError extends Error {
  row: number;
  constructor(row: number) {
    super(`metadata row ${row}`);
    this.name = 'MetadataParseError';
    this.row = row;
  }
}

const NAMED_COLORS = new Set([
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple',
  'fuchsia', 'magenta', 'green', 'lime', 'olive', 'yellow', 'navy', 'blue',
  'teal', 'aqua', 'cyan', 'orange', 'gold', 'brown', 'pink', 'indigo',
  'violet', 'turquoise', 'salmon', 'coral', 'crimson', 'darkgreen',
  'darkblue', 'darkred', 'steelblue', 'seagreen', 'tomato', 'orchid'
]);

export function sanitizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (NAMED_COLORS.has(value.toLowerCase())) return value.toLowerCase();
  return null;
}

function countDelimiters(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && ch === delimiter) {
      count++;
    }
  }
  return count;
}

function detectDelimiter(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const tabs = countDelimiters(line, '\t');
    const commas = countDelimiters(line, ',');
    return tabs > commas ? '\t' : ',';
  }
  return ',';
}

function splitRow(line: string, delimiter: string, row: number): string[] {
  const cells: string[] = [];
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
    if (ch === '"' && current.trim() === '') {
      current = '';
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quoted) throw new MetadataParseError(row);
  cells.push(current.trim());
  return cells;
}

function findColumn(header: string[], aliases: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const cell = header[i].trim().toLowerCase();
    if (aliases.includes(cell)) return i;
  }
  return -1;
}

/**
 * Parse a metadata table. The header row is optional. Accepted columns are
 * leaf/name/taxon, group/clade/category and color/colour.
 */
export function parseMetadataTable(text: string): MetaEntry[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!clean.trim()) return [];

  const delimiter = detectDelimiter(clean);
  const lines = clean.split('\n');
  let leafIndex = 0;
  let groupIndex = 1;
  let colorIndex = 2;
  let startRow = 0;

  let firstDataRow = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() && !lines[i].trim().startsWith('#')) {
      firstDataRow = i;
      break;
    }
  }
  if (firstDataRow < 0) return [];

  const headerCells = splitRow(lines[firstDataRow], delimiter, firstDataRow + 1);
  const header = headerCells.map((cell) => cell.toLowerCase());
  const hasHeader =
    findColumn(header, ['leaf', 'name', 'taxon', 'tip', 'label']) >= 0 ||
    findColumn(header, ['group', 'clade', 'category', 'family']) >= 0;

  if (hasHeader) {
    leafIndex = findColumn(header, ['leaf', 'name', 'taxon', 'tip', 'label']);
    groupIndex = findColumn(header, ['group', 'clade', 'category', 'family']);
    colorIndex = findColumn(header, ['color', 'colour', 'hex']);
    startRow = firstDataRow + 1;
    if (leafIndex < 0 || groupIndex < 0) throw new MetadataParseError(firstDataRow + 1);
  } else {
    startRow = firstDataRow;
  }

  const entries: MetaEntry[] = [];
  const position = new Map<string, number>();

  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const cells = splitRow(line, delimiter, i + 1);
    if (cells.length < 2) throw new MetadataParseError(i + 1);

    const maxIndex = Math.max(leafIndex, groupIndex, colorIndex);
    if (cells.length <= maxIndex && cells.length <= Math.max(leafIndex, groupIndex)) {
      throw new MetadataParseError(i + 1);
    }

    const leaf = (cells[leafIndex] ?? '').trim();
    if (!leaf) continue;
    const group = (cells[groupIndex] ?? '').trim();
    const color = colorIndex >= 0 ? sanitizeColor(cells[colorIndex]) : null;

    const entry: MetaEntry = { leaf, group, color };
    const existing = position.get(leaf);
    if (existing !== undefined) entries[existing] = entry;
    else {
      position.set(leaf, entries.length);
      entries.push(entry);
    }
  }

  return entries;
}

export function resolveMetadata(metadata: TreeMetadata): ResolvedMetadata {
  const byLeaf: ResolvedMetadata['byLeaf'] = {};
  const groupOrder: string[] = [];
  const groupCounts: Record<string, number> = {};
  const explicitGroupColors: Record<string, string> = {};

  for (const entry of metadata.entries) {
    if (!entry.leaf) continue;
    const group = (entry.group ?? '').trim();
    const color = sanitizeColor(entry.color);
    if (group) {
      if (!(group in groupCounts)) {
        groupOrder.push(group);
        groupCounts[group] = 0;
      }
      groupCounts[group]++;
      if (color && !explicitGroupColors[group]) explicitGroupColors[group] = color;
    }
    byLeaf[entry.leaf] = { group, color: color ?? '' };
  }

  const palette = PALETTES[metadata.paletteId] ?? PALETTES.default;
  const groupColors: Record<string, string> = {};
  let cursor = 0;
  for (const group of groupOrder) {
    groupColors[group] = explicitGroupColors[group] ?? palette[cursor % palette.length];
    cursor++;
  }

  for (const leaf of Object.keys(byLeaf)) {
    const entry = byLeaf[leaf];
    if (!entry.color) entry.color = groupColors[entry.group] ?? '';
  }

  return {
    byLeaf,
    groupOrder,
    groupColors,
    groupCounts,
    ungrouped: metadata.entries.filter((entry) => !(entry.group ?? '').trim()).length
  };
}

export function metadataToCsv(metadata: TreeMetadata): string {
  const lines = ['leaf,group,color'];
  for (const entry of metadata.entries) {
    const quote = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    lines.push(`${quote(entry.leaf)},${quote(entry.group)},${quote(entry.color ?? '')}`);
  }
  return lines.join('\n');
}
