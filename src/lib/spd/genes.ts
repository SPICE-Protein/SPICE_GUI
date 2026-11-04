// SPD gene pipeline: publish a gene record together with its asserted DNA
// regions, and load a gene back into the gene-workbench feature model.
//
// The SPD gene record self-carries its DNA sequence (`dnaSequence`), so unlike
// vectors no artifact upload is needed. Region coordinates are 1-based
// inclusive on both sides — the GUI stores them that way, so they pass through
// unchanged (the vector publisher, by contrast, converts 0-based half-open).
import { configureSpdClient } from './store.svelte';
import type { SpdGeneInput, SpdGeneRecord, SpdGeneRegion, SpdGeneRegionInput } from './types';

/** The gene-workbench feature shape consumed by the publisher. */
export interface GeneWorkspaceFeature {
  name: string;
  start: number;
  end: number;
  type: string;
  forward?: boolean;
}

/** A gene as staged in the workbench before publication. */
export interface GeneWorkspaceInput {
  name: string;
  sequence: string;
  circular: boolean;
  host?: 'ecoli' | 'yeast' | 'human' | string;
  geneType?: string;
  symbol?: string;
  description?: string;
  features: GeneWorkspaceFeature[];
}

/** A gene pulled back from SPD, mapped into GUI coordinates and types. */
export interface LoadedSpdGene {
  geneId: string;
  record: SpdGeneRecord;
  sequence: string;
  /** Which asserted molecule the workbench sequence came from. RNA-only
   *  records are converted U→T so they can be edited in the DNA canvas. */
  sourceMolecule: 'dna' | 'rna';
  features: GeneWorkspaceFeature[];
  regions: SpdGeneRegion[];
}

export interface PublishGeneResult {
  geneId: string;
  regionCount: number;
  duplicateCount: number;
  skippedCount: number;
  /** Present when the gene was created but its region batch was rejected. */
  regionError?: string;
}

/** SPD accepts at most this many region rows in one batch. */
const MAX_REGION_COUNT = 500;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_FEATURE_KEY_LENGTH = 64;

/** The server's GeneRegion.regionType enum. Anything else is rejected. */
const SPD_REGION_TYPES = new Set([
  'promoter', 'operator', 'enhancer', 'silencer', 'tata_box', 'caat_signal',
  'terminator', 'origin', 'exon', 'intron', 'five_prime_utr', 'three_prime_utr',
  'cds', 'rnase_site', 'other',
]);

/** Common GenBank / GUI spellings that are not already SPD enum members. */
const REGION_TYPE_ALIASES: Record<string, string> = {
  '5utr': 'five_prime_utr',
  '5_utr': 'five_prime_utr',
  '5_prime_utr': 'five_prime_utr',
  '3utr': 'three_prime_utr',
  '3_utr': 'three_prime_utr',
  '3_prime_utr': 'three_prime_utr',
  misc_feature: 'other',
  miscellaneous: 'other',
  feature: 'other',
  gene: 'other',
};

/** Upper-case the sequence and strip ASCII whitespace only. Ambiguous IUPAC
 *  letters are preserved: coordinates belong to this exact string, so silently
 *  deleting characters would shift every downstream feature. The server
 *  validates the alphabet and returns a clear error for invalid letters. */
export function normalizeGeneDna(sequence: string): string {
  const normalized = String(sequence ?? '').replace(/[ \t\n\r\f\v]/g, '').toUpperCase();
  if (!normalized) throw new Error('gene sequence is empty');
  return normalized;
}

/** Normalize a GUI/GenBank feature name to an SPD region type. */
export function mapFeatureTypeToRegionType(type: string): string {
  const key = String(type ?? '')
    .trim()
    .toLowerCase()
    // 5'UTR / 5′UTR variants drop the prime so they collapse to `5utr`.
    .replace(/['′’]/g, '')
    // GenBank uses spaces and hyphens interchangeably with underscores.
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const alias = REGION_TYPE_ALIASES[key];
  if (alias) return alias;
  return SPD_REGION_TYPES.has(key) ? key : 'other';
}

/** Map GUI features to SPD DNA region inputs. Invalid rows (non-integer,
 *  out-of-range, reversed, or origin-spanning circular features) are skipped
 *  rather than clamped, because a clamped interval would be a false assertion. */
export function toGeneRegions(
  features: GeneWorkspaceFeature[],
  sequenceLength: number,
): { regions: SpdGeneRegionInput[]; skipped: number } {
  const regions: SpdGeneRegionInput[] = [];
  let skipped = 0;
  const list = Array.isArray(features) ? features : [];

  for (const feature of list) {
    // Once the batch is full every remaining row counts as skipped.
    if (regions.length >= MAX_REGION_COUNT) {
      skipped += 1;
      continue;
    }

    const start = feature?.start;
    const end = feature?.end;
    const valid = Number.isInteger(start)
      && Number.isInteger(end)
      && start >= 1
      && end >= start
      && end <= sequenceLength;
    if (!valid) {
      skipped += 1;
      continue;
    }

    const rawType = typeof feature.type === 'string' ? feature.type.trim() : '';
    const description = ((feature.name ?? '').trim() || rawType).slice(0, MAX_DESCRIPTION_LENGTH);
    if (!description) {
      skipped += 1;
      continue;
    }

    regions.push({
      molecule: 'dna',
      regionType: mapFeatureTypeToRegionType(rawType),
      description,
      startPosition: start,
      endPosition: end,
      strand: feature.forward === false ? 'reverse' : 'forward',
      featureKey: rawType.slice(0, MAX_FEATURE_KEY_LENGTH),
    } as SpdGeneRegionInput);
  }

  return { regions, skipped };
}

/** Read a coordinate from the server spelling, falling back to the short
 *  `start`/`end` spelling some older payloads used. */
function readCoordinate(region: Record<string, unknown>, primary: string, fallback: string): number | undefined {
  const value = region[primary];
  if (typeof value === 'number') return value;
  const legacy = region[fallback];
  return typeof legacy === 'number' ? legacy : undefined;
}

/** Map SPD DNA regions back to GUI features. RNA rows, unplaced rows, and
 *  rows outside the loaded sequence are skipped. */
export function mapGeneRegionsToFeatures(
  regions: SpdGeneRegion[],
  sequenceLength: number,
  molecule: 'dna' | 'rna' = 'dna',
): GeneWorkspaceFeature[] {
  const features: GeneWorkspaceFeature[] = [];
  for (const region of Array.isArray(regions) ? regions : []) {
    const row = region as unknown as Record<string, unknown>;
    if (row.molecule !== molecule) continue;

    const start = readCoordinate(row, 'startPosition', 'start');
    const end = readCoordinate(row, 'endPosition', 'end');
    const valid = Number.isInteger(start)
      && Number.isInteger(end)
      && start! >= 1
      && end! >= start!
      && end! <= sequenceLength;
    if (!valid) continue;

    const regionType = typeof row.regionType === 'string' ? row.regionType : 'other';
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    features.push({
      name: description || regionType,
      start,
      end,
      type: regionType,
      forward: row.strand !== 'reverse',
    } as GeneWorkspaceFeature);
  }
  return features;
}

// ─────────────────────────── receipt helpers ───────────────────────────

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/** Creation receipts vary between a bare `{id}` row and an enveloped
 *  `{gene:{id}}`; accept every shape the server has used. */
function extractGeneId(receipt: unknown): string {
  const root = asRecord(receipt);
  const direct = firstString(root, ['geneId', 'id']);
  if (direct) return direct;

  const gene = asRecord(root.gene);
  const geneId = firstString(gene, ['id', 'geneId']);
  if (geneId) return geneId;

  const data = asRecord(root.data);
  const dataId = firstString(data, ['geneId', 'id']);
  if (dataId) return dataId;
  return firstString(asRecord(data.gene), ['id', 'geneId']);
}

function toRows(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.map(asRecord);
  const record = asRecord(value);
  for (const key of ['items', 'regions', 'rows']) {
    if (Array.isArray(record[key])) return toRows(record[key]);
  }
  return [];
}

/** Region receipts may be `{regions:[...]}`, `{items:[...]}`, or enveloped. */
function extractRegionRows(receipt: unknown): UnknownRecord[] {
  const root = asRecord(receipt);
  for (const key of ['regions', 'items', 'rows']) {
    const rows = toRows(root[key]);
    if (rows.length) return rows;
  }
  return toRows(root.data);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Prefer an explicit receipt counter; otherwise derive duplicates from the
 *  per-row `deduplicated` / `created` flags. */
function extractDuplicateCount(receipt: unknown, rows: UnknownRecord[], mappedCount: number): number {
  const root = asRecord(receipt);
  const data = asRecord(root.data);
  for (const source of [root, data]) {
    for (const key of ['duplicateCount', 'duplicates', 'deduplicatedCount']) {
      const count = finiteNumber(source[key]);
      if (count !== undefined) return count;
    }
  }
  if (root.deduplicated === true && rows.length === 0) return mappedCount;

  let count = 0;
  for (const row of rows) {
    if (row.deduplicated === true || row.created === false) count += 1;
  }
  return count;
}

/** Count rows the server actually inserted. When the receipt has no per-row
 *  `created` flag, fall back to mapped rows minus duplicates. */
function extractRegionCount(rows: UnknownRecord[], mappedCount: number, duplicateCount: number): number {
  const hasCreatedFlag = rows.some((row) => typeof row.created === 'boolean');
  if (hasCreatedFlag) return rows.filter((row) => row.created === true).length;
  return Math.max(0, mappedCount - duplicateCount);
}

function regionList(value: unknown): SpdGeneRegion[] {
  if (Array.isArray(value)) return value as SpdGeneRegion[];
  const record = asRecord(value);
  for (const key of ['items', 'regions', 'rows']) {
    if (Array.isArray(record[key])) return record[key] as SpdGeneRegion[];
  }
  return [];
}

// ─────────────────────────── network operations ───────────────────────────

/** Create a gene record and append its DNA regions. A region failure never
 *  discards the created gene: the id is returned with `regionError` so the
 *  caller can retry the region batch without creating a duplicate record. */
export async function publishGene(ws: GeneWorkspaceInput): Promise<PublishGeneResult> {
  const sequence = normalizeGeneDna(ws.sequence);
  const name = (ws.name ?? '').trim();
  if (!name) throw new Error('gene name is required');

  const client = configureSpdClient();
  const topology = ws.circular ? 'circular' : 'linear';
  const input: SpdGeneInput = {
    name,
    symbol: (ws.symbol ?? '').trim() || undefined,
    description: (ws.description ?? '').trim() || undefined,
    geneType: (ws.geneType ?? '').trim() || 'other',
    dnaSequence: sequence,
    topology,
    metadata: {
      source: 'SPICE GUI',
      tool: 'gene workbench',
      topology,
      host: ws.host,
    },
  };

  const receipt = await client.createGene(input);
  const geneId = extractGeneId(receipt);
  if (!geneId) throw new Error('SPD did not return a gene id');

  const { regions, skipped } = toGeneRegions(ws.features ?? [], sequence.length);
  if (!regions.length) {
    return { geneId, regionCount: 0, duplicateCount: 0, skippedCount: skipped };
  }

  try {
    const regionReceipt = await client.addGeneRegions(geneId, regions);
    const rows = extractRegionRows(regionReceipt);
    const duplicateCount = extractDuplicateCount(regionReceipt, rows, regions.length);
    const regionCount = extractRegionCount(rows, regions.length, duplicateCount);
    return { geneId, regionCount, duplicateCount, skippedCount: skipped };
  } catch (error) {
    return {
      geneId,
      regionCount: 0,
      duplicateCount: 0,
      skippedCount: skipped,
      regionError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Load a gene and its regions, mapping the DNA rows into GUI features. */
export async function loadGene(id: string): Promise<LoadedSpdGene> {
  const client = configureSpdClient();
  const [recordPayload, regionPayload] = await Promise.all([
    client.getGene(id),
    client.listGeneRegions(id),
  ]);

  const rawRecord = asRecord(recordPayload);
  const record = (rawRecord.gene ? asRecord(rawRecord.gene) : rawRecord) as unknown as SpdGeneRecord;
  const dnaSequence = typeof record.dnaSequence === 'string' ? record.dnaSequence : '';
  const rnaSequence = typeof record.rnaSequence === 'string' ? record.rnaSequence : '';
  if (!dnaSequence.trim() && !rnaSequence.trim()) {
    throw new Error('SPD gene has no DNA or RNA sequence');
  }

  // Public gene records imported from RefSeq are commonly mRNA-only. The
  // workbench is a DNA canvas, so a transcript loads as its coding DNA
  // equivalent (U→T) with the same coordinates; `sourceMolecule` lets the UI
  // say so instead of silently presenting the conversion as the record.
  const sourceMolecule: 'dna' | 'rna' = dnaSequence.trim() ? 'dna' : 'rna';
  const rawSequence = sourceMolecule === 'dna' ? dnaSequence : rnaSequence;
  const normalized = normalizeGeneDna(rawSequence);
  const sequence = sourceMolecule === 'dna' ? normalized : normalized.replace(/U/g, 'T');
  const regions = regionList(regionPayload);
  return {
    geneId: record.id || id,
    record,
    sequence,
    sourceMolecule,
    features: mapGeneRegionsToFeatures(regions, sequence.length, sourceMolecule),
    regions,
  };
}
