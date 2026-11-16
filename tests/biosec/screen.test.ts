import { describe, expect, it } from 'vitest';
import type { AmrFinderRow, BioriskHit, CommecStatus, RiskCatalogEnvelope } from '$lib/backend/types';
import { amrCatalogFromEnvelope } from '$lib/biosec/catalog';
import { bioriskHitsToFindings } from '$lib/biosec/biorisk';
import { newRiskFindings, screenSequence } from '$lib/biosec/screen';
import { assessPlanRisk } from '$lib/biosec/gate';
import type { RiskCatalog } from '$lib/biosec/types';

function catalog(
  records: {
    gene: string;
    pattern: string;
    description?: string;
    allele?: string;
    accession?: string;
    kind?: string;
  }[],
): RiskCatalog {
  const envelope: RiskCatalogEnvelope<AmrFinderRow> = {
    source: 'amrfinder',
    origin: 'network',
    version: '2026-10-29.1',
    fetchedAt: 1_700_000_000,
    licence: 'Public domain (US Government Work)',
    endpoint: 'https://example.test/amrfinder/',
    error: null,
    records: records.map((row, index) => ({
      gene: row.gene,
      kind: row.kind ?? 'AMR',
      allele: row.allele ?? row.gene,
      description: row.description ?? 'Resistance gene',
      class: 'BETA-LACTAM',
      subclass: 'PENICILLIN',
      accession: row.accession ?? row.gene ?? `TEST_${index}`,
      pattern: row.pattern,
    })),
  };
  return amrCatalogFromEnvelope(envelope);
}

const commec: CommecStatus = {
  installed: true,
  version: '1.1.0',
  path: '/tmp/commec',
  models: 3091,
  mustFlagModels: 807,
  fetchedAt: 1_700_000_000,
  licence: 'MIT (IBBIS)',
  sourceUrl: 'https://example.test/commec',
  sha256: 'abc123',
  error: null,
};

function bioriskHit(overrides: Partial<BioriskHit> = {}): BioriskHit {
  return {
    model: 'P02879',
    description: 'Ricin',
    mustFlag: true,
    category: 'biorisk',
    evalue: 1e-40,
    score: 120,
    coverage: 0.9,
    frame: 1,
    strand: '+',
    start: 5,
    end: 200,
    ...overrides,
  };
}

describe('risk catalog normalisation', () => {
  it('drops signatures that are too short or not DNA and reports the count', () => {
    const parsed = catalog([
      { gene: 'short', pattern: 'ACGT' },
      { gene: 'ambiguous', pattern: 'ACGTZACGTACGT' },
      { gene: 'blaTEM-1', pattern: 'ATCAGTCAACC' },
    ]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].patterns).toEqual(['ATCAGTCAACC']);
    expect(parsed.records[0].category).toBe('amr');
    expect(parsed.droppedPatterns).toBe(2);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('keeps the catalogue accession as the stable record identity', () => {
    const parsed = catalog([
      { gene: 'blaTEM-1', pattern: 'ATCAGTCAACC', accession: 'WP_000000001.1' },
    ]);
    expect(parsed.records[0].id).toBe('amrfinder:WP_000000001.1');
    expect(parsed.records[0].class).toBe('BETA-LACTAM');
  });
});

describe('screenSequence', () => {
  const amr = catalog([{ gene: 'blaTEM-1', pattern: 'ATCAGTCAACC' }]);
  const marker = catalog([{ gene: 'marker', pattern: 'TCTGGAGCGCATGATT' }]);

  it('reports a forward match with a 1-based span', () => {
    const [hit] = screenSequence('AAAAATCAGTCAACCCCCC', [amr]);
    expect(hit.scope).toMatchObject({ start: 5, end: 15, strand: '+' });
    expect(hit.severity).toBe('warning');
    expect(hit.requiresReview).toBe(false);
    expect(hit.params?.name).toBe('blaTEM-1');
  });

  it('finds the reverse complement without moving the span', () => {
    // rc(AACCGGTTAACC) = GGTAACCGGTT
    const patternCatalog = catalog([{ gene: 'marker', pattern: 'AACCGGTTAACC' }]);
    const [hit] = screenSequence('TTTGGTTAACCGGTTAAA', [patternCatalog]);
    expect(hit.scope).toMatchObject({ start: 4, end: 15, strand: '-' });
  });

  it('wraps a circular match across the origin', () => {
    const patternCatalog = catalog([{ gene: 'marker', pattern: 'AAAACCCCGG' }]);
    expect(screenSequence('CCCCGGGGAAAA', [patternCatalog], { circular: false })).toHaveLength(0);
    const hits = screenSequence('CCCCGGGGAAAA', [patternCatalog], { circular: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].scope).toMatchObject({ start: 9, end: 18 });
    expect(hits[0].evidence?.wrapped).toBe(true);
  });

  it('keeps document coordinates when the sequence contains ambiguity codes', () => {
    const hits = screenSequence('NNNNNTCTGGAGCGCATGATTCCC', [marker]);
    expect(hits[0].scope).toMatchObject({ start: 6, end: 21 });
  });

  it('reports a single reverse-strand occurrence once', () => {
    const reverse = catalog([{ gene: 'marker', pattern: 'AACCGGTTAACC' }]);
    const hits = screenSequence('GGTTAACCGGTT', [reverse]);
    expect(hits).toHaveLength(1);
    expect(hits[0].scope.strand).toBe('-');
  });

  it('scans a large catalogue without one substring search per record', () => {
    const encode = (value: number) =>
      value
        .toString(4)
        .padStart(6, '0')
        .split('')
        .map((digit) => 'ACGT'[Number(digit)])
        .join('');
    const records = Array.from({ length: 2000 }, (_, index) => ({
      gene: `gene-${index}`,
      pattern: `AAAACCCCGGGGTTTT${encode(index)}`,
      accession: `TEST_${index}`,
    }));
    const big = catalog(records);
    const hits = screenSequence(`GGGGAAAACCCCGGGGTTTT${encode(42)}CCCC`, [big]);
    expect(hits).toHaveLength(1);
    expect(hits[0].params?.name).toBe('gene-42');
  });
});

describe('catalogue classes', () => {
  it('labels virulence and stress entries apart from resistance genes', () => {
    const parsed = catalog([
      { gene: 'stxA2b', pattern: 'ATCAGTCAACC', kind: 'VIRULENCE' },
      { gene: 'merA', pattern: 'GTGATCCTGGG', kind: 'STRESS' },
    ]);
    const hits = screenSequence('ATCAGTCAACCGGGGGGGGGGGGGTGATCCTGGG', [parsed]);
    const byName = new Map(hits.map((hit) => [hit.params?.name, hit]));
    expect(parsed.records.map((record) => record.category)).toEqual(['virulence', 'stress']);
    expect(byName.get('stxA2b')?.code).toBe('risk_virulence_match');
    expect(byName.get('merA')?.code).toBe('risk_stress_match');
  });
});

describe('biorisk findings', () => {
  it('marks a must-flag model as blocking and keeps document coordinates', () => {
    const [finding] = bioriskHitsToFindings([bioriskHit()], commec);
    expect(finding.severity).toBe('blocking');
    expect(finding.code).toBe('risk_match');
    expect(finding.requiresReview).toBe(true);
    expect(finding.scope).toMatchObject({ start: 5, end: 200, strand: '+' });
    expect(finding.evidence?.source).toBe('commec');
    expect(finding.evidence?.recordId).toBe('P02879');
  });

  it('marks a virulence-factor model as a warning without review', () => {
    const [finding] = bioriskHitsToFindings(
      [bioriskHit({ mustFlag: false, category: 'virulence', model: 'VF0001' })],
      commec,
    );
    expect(finding.severity).toBe('warning');
    expect(finding.code).toBe('risk_virulence_match');
    expect(finding.requiresReview).toBe(false);
  });
});

describe('newRiskFindings', () => {
  const first = catalog([{ gene: 'first', pattern: 'TCTGGAGCGCATGATT' }]);
  const second = catalog([{ gene: 'second', pattern: 'TATAATGAGTCACA' }]);

  it('reports only catalog records that did not already match', () => {
    const before = screenSequence('AAATCTGGAGCGCATGATT', [first, second]);
    const after = screenSequence('AAATCTGGAGCGCATGATTTATAATGAGTCACA', [first, second]);
    const introduced = newRiskFindings(before, after);
    expect(introduced).toHaveLength(1);
    expect(introduced[0].params?.name).toBe('second');
  });

  it('reports nothing when a plan keeps the same match', () => {
    const before = screenSequence('AAATCTGGAGCGCATGATT', [first]);
    const after = screenSequence('TTTAAATCTGGAGCGCATGATTGGG', [first]);
    expect(newRiskFindings(before, after)).toHaveLength(0);
  });
});

describe('assessPlanRisk', () => {
  const before = {
    name: 'pTEST',
    sequence: 'AAAACCCCGGGGTTTT',
    topology: 'circular' as const,
    features: [],
  };

  it('reports AMR records introduced by a plan without blocking them', () => {
    const amr = catalog([{ gene: 'blaTEM-1', pattern: 'ATCAGTCAACC' }]);
    const after = { ...before, sequence: 'AAAACCCCGGGGTTTTATCAGTCAACC' };
    const assessment = assessPlanRisk(before, after, [amr]);
    expect(assessment.introduced).toHaveLength(1);
    expect(assessment.blocking).toHaveLength(0);
  });

  it('allows a plan that keeps an existing match', () => {
    const amr = catalog([{ gene: 'blaTEM-1', pattern: 'ATCAGTCAACC' }]);
    const withMatch = { ...before, sequence: 'AAAAATCAGTCAACC' };
    const after = { ...withMatch, sequence: 'TTTAAAAATCAGTCAACCCCC' };
    const assessment = assessPlanRisk(withMatch, after, [amr]);
    expect(assessment.introduced).toHaveLength(0);
    expect(assessment.blocking).toHaveLength(0);
  });

  it('is a no-op when no catalogs are loaded', () => {
    const after = { ...before, sequence: 'ATCAGTCAACC' };
    expect(assessPlanRisk(before, after, []).blocking).toHaveLength(0);
  });
});
