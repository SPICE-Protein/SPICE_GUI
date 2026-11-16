import { describe, expect, it } from 'vitest';
import { diagnoseGeneWorkspace } from '$lib/gene/diagnostics';
import { loadOveDemoPlasmid } from '$lib/genome/demo';
import type { GeneWorkspaceSnapshot } from '$lib/gene/workspaceIntents';

function snapshot(overrides: Partial<GeneWorkspaceSnapshot> = {}): GeneWorkspaceSnapshot {
  return {
    name: 'pTEST',
    sequence: 'ATGAAACCCGGGTTTAAATAG',
    topology: 'circular',
    features: [
      { id: 1, name: 'orfA', start: 1, end: 21, type: 'cds', forward: true },
    ],
    ...overrides,
  };
}

describe('diagnoseGeneWorkspace: structure', () => {
  it('returns no findings for a clean document', () => {
    expect(diagnoseGeneWorkspace(snapshot())).toEqual([]);
  });

  it('blocks a non-IUPAC base at its position', () => {
    const findings = diagnoseGeneWorkspace(snapshot({ sequence: 'ATGZ' }));
    const hit = findings.find((finding) => finding.code === 'seq_non_iupac');
    expect(hit).toMatchObject({ severity: 'blocking', scope: { start: 4, end: 4 } });
  });

  it('blocks a feature outside the sequence and duplicate ids', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'ATGAAA',
        features: [
          { id: 1, name: 'a', start: 1, end: 9, type: 'misc_feature' },
          { id: 1, name: 'b', start: 1, end: 3, type: 'misc_feature' },
        ],
      }),
    );
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['feature_range', 'feature_duplicate_id']),
    );
  });
});

describe('diagnoseGeneWorkspace: finding identity', () => {
  it('keeps ids unique when several sites fall inside one feature', () => {
    // Two EcoRI sites inside one CDS: a feature-level id would collide and the
    // panel keys its list by id.
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'ATGGAATTCAAAGAATTCTAAGGG',
        features: [
          { id: 1, name: 'cds', start: 1, end: 24, type: 'cds', forward: true },
        ],
      }),
      { enzymeSites: [{ name: 'EcoRI', motif: 'GAATTC' }] },
    );
    const sites = findings.filter((finding) => finding.code === 'cds_enzyme_site');
    expect(sites).toHaveLength(2);
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('diagnoseGeneWorkspace: CDS', () => {
  it('warns when the length is not a multiple of three', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({ sequence: 'ATGAAACCCT', features: [{ id: 1, name: 'cds', start: 1, end: 10, type: 'cds' }] }),
    );
    expect(findings.find((finding) => finding.code === 'cds_frame')).toMatchObject({
      severity: 'warning',
      params: { remainder: 1 },
    });
  });

  it('reports an internal stop codon at its base position', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'ATGTAATTTTAA',
        features: [{ id: 1, name: 'cds', start: 1, end: 12, type: 'cds' }],
      }),
    );
    expect(findings.find((finding) => finding.code === 'cds_internal_stop')).toMatchObject({
      severity: 'warning',
      scope: { start: 4, end: 6 },
    });
  });

  it('translates a reverse-strand CDS before checking it', () => {
    // rc(ATGAAACCCTAA) = TTAGGGTTTCAT, which starts with TTG (allowed) and stops once.
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'TTAGGGTTTCAT',
        features: [{ id: 1, name: 'rev', start: 1, end: 12, type: 'cds', forward: false }],
      }),
    );
    expect(findings.some((finding) => finding.code === 'cds_start')).toBe(false);
    expect(findings.some((finding) => finding.code === 'cds_internal_stop')).toBe(false);
  });

  it('warns about a selected restriction site inside a CDS', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'ATGGAATTCTAA',
        features: [{ id: 1, name: 'cds', start: 1, end: 12, type: 'cds' }],
      }),
      { enzymeSites: [{ name: 'EcoRI', motif: 'GAATTC' }] },
    );
    expect(findings.find((finding) => finding.code === 'cds_enzyme_site')).toMatchObject({
      severity: 'warning',
      params: { enzyme: 'EcoRI', position: 4 },
    });
  });
});

describe('diagnoseGeneWorkspace: circular ranges', () => {
  it('accepts a feature that crosses the origin on a circular document', () => {
    const features = [{ id: 1, name: 'backbone', start: 15, end: 5, type: 'misc_feature' }];
    expect(diagnoseGeneWorkspace(snapshot({ features }))).toEqual([]);
    expect(
      diagnoseGeneWorkspace(snapshot({ topology: 'linear', features })).find(
        (finding) => finding.code === 'feature_range',
      ),
    ).toMatchObject({ severity: 'blocking', detail: expect.stringContaining('linear') });
  });

  it('maps a wrapped CDS back across the origin', () => {
    // 19..20 then 1..10 reads ATG AAA TAA CCC: the stop is at 5..7.
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'GAAATAACCCACGTACGTAT',
        features: [{ id: 1, name: 'cds', start: 19, end: 10, type: 'cds', forward: true }],
      }),
    );
    expect(findings.find((finding) => finding.code === 'cds_internal_stop')).toMatchObject({
      scope: { start: 5, end: 7 },
      params: { codon: 'TAA', position: 5 },
    });
  });

  it('detects an opposite-strand overlap that only exists across the origin', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'ACGTACGTACGTACGTACGT',
        features: [
          { id: 1, name: 'backbone', start: 15, end: 5, type: 'misc_feature', forward: true },
          { id: 2, name: 'rep', start: 18, end: 2, type: 'misc_feature', forward: false },
        ],
      }),
    );
    expect(findings.find((finding) => finding.code === 'feature_overlap_opposite')).toMatchObject({
      scope: { start: 18, end: 20 },
    });
  });
});

describe('diagnoseGeneWorkspace: demo document', () => {
  it('has no blocking finding: the backbone crosses the origin of a circular plasmid', () => {
    const demo = loadOveDemoPlasmid();
    const findings = diagnoseGeneWorkspace({
      name: demo.name,
      sequence: demo.sequence,
      topology: demo.circular ? 'circular' : 'linear',
      features: demo.features.map((feature) => ({
        id: feature.id,
        name: feature.name,
        start: feature.start,
        end: feature.end,
        type: feature.type,
        forward: feature.forward,
      })),
    });
    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([]);
  });
});

describe('diagnoseGeneWorkspace: annotations', () => {
  it('offers rename intents for duplicate names', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        features: [
          { id: 1, name: 'ampR', start: 1, end: 6, type: 'misc_feature' },
          { id: 2, name: 'ampR', start: 7, end: 12, type: 'misc_feature' },
        ],
      }),
    );
    const hit = findings.find((finding) => finding.code === 'feature_duplicate_name');
    expect(hit?.fixes?.[0].intents).toEqual([{ type: 'rename_feature', featureId: 2, name: 'ampR (2)' }]);
  });

  it('flags opposite-strand overlaps and long homopolymers with positions', () => {
    const findings = diagnoseGeneWorkspace(
      snapshot({
        sequence: 'AAAAAAAAAACCCCCCCCCCTTTTTTTTTT',
        features: [
          { id: 1, name: 'fwd', start: 1, end: 20, type: 'misc_feature', forward: true },
          { id: 2, name: 'rev', start: 10, end: 30, type: 'misc_feature', forward: false },
        ],
      }),
    );
    expect(findings.find((finding) => finding.code === 'feature_overlap_opposite')).toMatchObject({
      scope: { start: 10, end: 20 },
    });
    expect(findings.find((finding) => finding.code === 'sequence_homopolymer')).toMatchObject({
      params: { base: 'A', length: 10 },
      scope: { start: 1, end: 10 },
    });
  });
});
