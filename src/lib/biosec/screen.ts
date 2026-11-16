// Exact DNA screening against the local AMRFinderPlus catalogue.
//
// A 10,000-signature catalogue cannot be scanned with one substring search per
// record. Each pattern contributes a 12-mer at a known offset to a hash index;
// the subject is walked once, and only the patterns whose 12-mer occurs are
// verified. Both strands and circular wrap are handled here, and coordinates
// are 1-based on the document.

import type { DiagnosticFinding } from '$lib/diagnostics/types';
import type { RiskCatalog, RiskRecord } from './types';
import { SHORT_SIGNATURE_LENGTH } from './catalog';

export interface ScreenOptions {
  circular?: boolean;
  /** Raise to ignore very short signatures; defaults to the catalog floor. */
  minPatternLength?: number;
  /** Per record, so one repetitive element cannot flood the panel. */
  maxHitsPerRecord?: number;
}

const K = 12;

interface PatternEntry {
  record: RiskRecord;
  pattern: string;
  needle: string;
  strand: '+' | '-';
  /** Offset of the indexed k-mer inside `needle`. */
  offset: number;
}

interface CatalogIndex {
  kmers: Map<string, PatternEntry[]>;
  short: PatternEntry[];
  maxLength: number;
}

const INDEX_CACHE = new WeakMap<RiskCatalog, CatalogIndex>();

function indexFor(catalog: RiskCatalog): CatalogIndex {
  const cached = INDEX_CACHE.get(catalog);
  if (cached) return cached;

  const index: CatalogIndex = { kmers: new Map(), short: [], maxLength: 0 };
  for (const record of catalog.records) {
    for (const pattern of record.patterns) {
      index.maxLength = Math.max(index.maxLength, pattern.length);
      const reverse = reverseComplement(pattern);
      if (pattern.length < K) {
        index.short.push({ record, pattern, needle: pattern, strand: '+', offset: 0 });
        index.short.push({ record, pattern, needle: reverse, strand: '-', offset: 0 });
        continue;
      }
      const offset = Math.floor((pattern.length - K) / 2);
      const entries: PatternEntry[] = [
        { record, pattern, needle: pattern, strand: '+', offset },
        { record, pattern, needle: reverse, strand: '-', offset },
      ];
      for (const entry of entries) {
        const key = entry.needle.slice(offset, offset + K);
        const bucket = index.kmers.get(key);
        if (bucket) bucket.push(entry);
        else index.kmers.set(key, [entry]);
      }
    }
  }

  INDEX_CACHE.set(catalog, index);
  return index;
}

export function screenSequence(
  sequence: string,
  catalogs: RiskCatalog[],
  options: ScreenOptions = {},
): DiagnosticFinding[] {
  const subject = sequence.toUpperCase();
  if (!subject) return [];
  const length = subject.length;
  const circular = options.circular === true;
  const minPatternLength = options.minPatternLength ?? 1;
  const maxHitsPerRecord = options.maxHitsPerRecord ?? 25;

  const findings: DiagnosticFinding[] = [];
  const hitCounts = new Map<string, number>();

  for (const catalog of catalogs) {
    const index = indexFor(catalog);
    const extension = circular ? Math.max(0, index.maxLength - 1) : 0;
    const hay = extension > 0 ? subject + subject.slice(0, Math.min(extension, length)) : subject;
    const seen = new Set<string>();

    const add = (entry: PatternEntry, start0: number) => {
      if (entry.pattern.length < minPatternLength) return;
      if (start0 < 0 || start0 >= length) return;
      if (!circular && start0 + entry.pattern.length > length) return;
      const count = hitCounts.get(entry.record.id) ?? 0;
      if (count >= maxHitsPerRecord) return;

      const mapped = mapHit(entry.strand, start0, entry.pattern.length, length, circular);
      if (!mapped) return;
      const key = `${entry.record.id}:${entry.strand}:${mapped.start}:${entry.pattern.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      hitCounts.set(entry.record.id, count + 1);
      findings.push(buildFinding(catalog, entry, mapped));
    };

    for (let position = 0; position + K <= hay.length; position += 1) {
      const bucket = index.kmers.get(hay.slice(position, position + K));
      if (!bucket) continue;
      for (const entry of bucket) {
        const start0 = position - entry.offset;
        if (start0 < 0) continue;
        if (!hay.startsWith(entry.needle, start0)) continue;
        add(entry, start0);
      }
    }

    for (const entry of index.short) {
      let position = hay.indexOf(entry.needle);
      while (position !== -1) {
        add(entry, position);
        position = hay.indexOf(entry.needle, position + 1);
      }
    }
  }

  findings.sort(
    (a, b) => (a.scope.start ?? 0) - (b.scope.start ?? 0) || a.id.localeCompare(b.id),
  );
  return findings;
}

interface MappedHit {
  start: number;
  end: number;
  wrapped: boolean;
}

function mapHit(
  strand: '+' | '-',
  start0: number,
  patternLength: number,
  length: number,
  circular: boolean,
): MappedHit | null {
  if (strand === '+') {
    if (!circular && start0 + patternLength > length) return null;
    const end0 = start0 + patternLength;
    return {
      start: start0 + 1,
      end: end0,
      wrapped: end0 > length,
    };
  }
  let originalStart = length - (start0 + patternLength);
  if (originalStart < 0) {
    if (!circular) return null;
    originalStart += length;
  }
  const end0 = originalStart + patternLength;
  return {
    start: originalStart + 1,
    end: end0,
    wrapped: end0 > length,
  };
}

/** The catalogue names its own class; the panel words each one differently. */
function catalogVariant(category: string): { code: string; label: string } {
  switch (category) {
    case 'virulence':
      return { code: 'risk_virulence_match', label: 'virulence factor' };
    case 'stress':
      return { code: 'risk_stress_match', label: 'stress response' };
    default:
      return { code: 'risk_amr_match', label: 'AMR' };
  }
}

function buildFinding(
  catalog: RiskCatalog,
  entry: PatternEntry,
  mapped: MappedHit,
): DiagnosticFinding {
  const { record, pattern, strand } = entry;
  const short = pattern.length < SHORT_SIGNATURE_LENGTH;
  const variant = catalogVariant(record.category);

  return {
    id: `risk:${catalog.source}:${record.id}:${strand}:${mapped.start}-${mapped.end}:${pattern}`,
    provider: 'biosec',
    severity: 'warning',
    code: variant.code,
    title: `${record.name} (${variant.label})`,
    detail: `Matched ${pattern.length} nt on the ${strand} strand at ${mapped.start}..${mapped.end}${mapped.wrapped ? ' across the origin' : ''}; catalogue ${catalog.source} ${catalog.version} (${catalog.origin}).`,
    scope: {
      kind: 'sequence',
      start: mapped.start,
      end: mapped.end,
      strand,
    },
    params: {
      name: record.name,
      description: record.description,
      category: record.category,
      class: record.class ?? '',
      subclass: record.subclass ?? '',
      source: catalog.source,
      strand,
      start: mapped.start,
      end: mapped.end,
      length: pattern.length,
      pattern,
    },
    evidence: {
      source: catalog.source,
      recordId: record.id,
      category: record.category,
      licence: catalog.licence,
      catalogVersion: catalog.version,
      catalogHash: catalog.contentHash,
      origin: catalog.origin,
      pattern,
      quality: short ? 'short-signature' : 'signature',
      wrapped: mapped.wrapped,
    },
    requiresReview: false,
  };
}

/** Identity used to compare two screens: a catalog record, not a span. */
export function riskKey(finding: DiagnosticFinding): string {
  const evidence = finding.evidence ?? {};
  return `${String(evidence.source ?? '')}:${String(evidence.recordId ?? '')}`;
}

/**
 * Findings introduced by a plan. A record that already matched before the plan
 * is not new: otherwise every later edit of a document that legitimately holds
 * an AMR marker would be blocked.
 */
export function newRiskFindings(
  before: DiagnosticFinding[],
  after: DiagnosticFinding[],
): DiagnosticFinding[] {
  const known = new Set(before.map(riskKey));
  return after.filter((finding) => !known.has(riskKey(finding)));
}

export function hasBlockingRisk(findings: DiagnosticFinding[]): boolean {
  return findings.some(
    (finding) => finding.provider === 'biosec' && finding.severity === 'blocking',
  );
}

function reverseComplement(pattern: string): string {
  let out = '';
  for (let index = pattern.length - 1; index >= 0; index -= 1) {
    out += complement(pattern[index]);
  }
  return out;
}

function complement(base: string): string {
  switch (base) {
    case 'A':
      return 'T';
    case 'C':
      return 'G';
    case 'G':
      return 'C';
    case 'T':
      return 'A';
    default:
      return 'N';
  }
}
