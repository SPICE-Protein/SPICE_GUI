// Normalisation of the AMRFinderPlus catalogue into the local screening shape.
//
// The transport envelope (source, origin, version, licence) is preserved so the
// UI and audit trail can say exactly which copy produced a verdict. Signatures
// shorter than the minimum, or containing anything other than A/C/G/T, are
// dropped and counted rather than silently treated as a clean screen.

import type { AmrFinderRow, RiskCatalogEnvelope } from '$lib/backend/types';
import type { RiskCatalog, RiskCategory, RiskRecord } from './types';

export const MIN_PATTERN_LENGTH = 10;
/** Below this a signature is a marker, not a gene; findings say so. */
export const SHORT_SIGNATURE_LENGTH = 20;

export function amrCatalogFromEnvelope(
  envelope: RiskCatalogEnvelope<AmrFinderRow>,
): RiskCatalog {
  const records: RiskRecord[] = [];
  const seen = new Set<string>();
  let patternCount = 0;
  let droppedPatterns = 0;

  for (const row of envelope.records ?? []) {
    const name = (row.gene || row.allele || row.accession || '').trim();
    if (!name) {
      droppedPatterns += 1;
      continue;
    }
    const patterns = normalisePatterns(row.pattern);
    droppedPatterns += patterns.dropped;
    if (patterns.values.length === 0) continue;

    let id = `amrfinder:${row.accession || slug(name)}`;
    let suffix = 2;
    while (seen.has(id)) id = `amrfinder:${slug(name)}-${suffix++}`;
    seen.add(id);

    patternCount += patterns.values.length;
    records.push({
      source: 'amrfinder',
      id,
      name,
      description: row.description || row.allele || '',
      category: catalogCategory(row.kind),
      class: row.class,
      subclass: row.subclass,
      patterns: patterns.values,
    });
  }

  return {
    source: 'amrfinder',
    origin: envelope.origin,
    version: envelope.version || 'unknown',
    contentHash: hashRecords(records),
    fetchedAt: envelope.fetchedAt || 0,
    licence: envelope.licence || 'unknown',
    endpoint: envelope.endpoint ?? null,
    error: envelope.error ?? null,
    records,
    patternCount,
    droppedPatterns,
  };
}

/**
 * Aggregate freshness. `sample` means the bundled sample is in use; `stale`
 * means the last refresh failed and the cached copy is being screened.
 */
export function catalogCoverage(catalogs: RiskCatalog[]): 'network' | 'cache' | 'sample' | 'none' {
  if (catalogs.length === 0) return 'none';
  if (catalogs.some((catalog) => catalog.origin === 'builtin')) return 'sample';
  if (catalogs.some((catalog) => catalog.origin === 'cache' || catalog.error)) return 'cache';
  return 'network';
}

/** The catalogue sorts its entries into resistance, virulence and stress genes. */
function catalogCategory(kind: string | undefined): RiskCategory {
  switch ((kind ?? '').trim().toUpperCase()) {
    case 'VIRULENCE':
      return 'virulence';
    case 'STRESS':
      return 'stress';
    default:
      return 'amr';
  }
}

export function hashRecords(records: RiskRecord[]): string {
  const canonical = records
    .map((record) => [record.id, record.category, ...record.patterns].join('\u001f'))
    .sort()
    .join('\u001e');
  return fnv1a(canonical);
}

function normalisePatterns(raw: unknown): { values: string[]; dropped: number } {
  const rows = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const values: string[] = [];
  let dropped = 0;
  for (const row of rows) {
    const pattern = String(row).replace(/\s+/g, '').toUpperCase();
    if (pattern.length < MIN_PATTERN_LENGTH || !/^[ACGT]+$/.test(pattern)) {
      dropped += 1;
      continue;
    }
    if (!values.includes(pattern)) values.push(pattern);
  }
  return { values, dropped };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'record'
  );
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
