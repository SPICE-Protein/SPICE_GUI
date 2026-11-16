import { describe, expect, it } from 'vitest';
import {
  applyGenePlan,
  describeGenePlan,
  verifyGeneSnapshot,
  workspaceVersion,
  type GeneWorkspaceSnapshot
} from '$lib/gene/workspaceIntents';

function snapshot(overrides: Partial<GeneWorkspaceSnapshot> = {}): GeneWorkspaceSnapshot {
  return {
    name: 'pTEST',
    sequence: 'ATGCGTACGTAGCTAGCTAG',
    topology: 'circular',
    features: [{ id: 3, name: 'ampR', start: 2, end: 8, type: 'cds', forward: true }],
    ...overrides
  };
}

describe('workspaceVersion', () => {
  it('is stable for identical content', () => {
    expect(workspaceVersion(snapshot())).toBe(workspaceVersion(snapshot()));
  });

  it('changes when the sequence, name, topology or a feature changes', () => {
    const base = workspaceVersion(snapshot());
    expect(workspaceVersion(snapshot({ sequence: 'ATGCGTACGTAGCTAGCTA' }))).not.toBe(base);
    expect(workspaceVersion(snapshot({ name: 'pOTHER' }))).not.toBe(base);
    expect(workspaceVersion(snapshot({ topology: 'linear' }))).not.toBe(base);
    expect(
      workspaceVersion(snapshot({ features: [{ id: 3, name: 'ampR', start: 3, end: 8, type: 'cds' }] }))
    ).not.toBe(base);
  });

  it('ignores case of the sequence and feature type', () => {
    const lower = snapshot({ sequence: 'atgcgtacgtagctagctag', features: [{ id: 3, name: 'ampR', start: 2, end: 8, type: 'CDS' }] });
    expect(workspaceVersion(lower)).toBe(workspaceVersion(snapshot()));
  });
});

describe('applyGenePlan: sequence', () => {
  it('normalises whitespace and case', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'replace_sequence', sequence: 'atg cgt\nacg' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.sequence).toBe('ATGCGTACG');
    expect(result.changes).toHaveLength(1);
  });

  it('rejects non-IUPAC characters with the offending position', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'replace_sequence', sequence: 'ATGCZ' }]);
    expect(result).toMatchObject({ ok: false, code: 'invalid_sequence', intentIndex: 0 });
    if (result.ok) return;
    expect(result.message).toContain('position 5');
  });

  it('refuses to strand features past a shorter sequence', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'replace_sequence', sequence: 'ATGC' }]);
    expect(result).toMatchObject({ ok: false, code: 'feature_out_of_range' });
    if (result.ok) return;
    expect(result.message).toContain('"ampR" (id 3)');
  });

  it('records no change for an identical sequence', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'replace_sequence', sequence: 'atgcgtacgtagctagctag' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(0);
    expect(result.version).toBe(result.previousVersion);
  });
});

describe('applyGenePlan: features', () => {
  it('assigns the next id and a type colour', () => {
    const result = applyGenePlan(snapshot(), [
      { type: 'add_feature', name: '  lac   promoter ', start: 10, end: 15, featureType: 'Promoter', forward: false }
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.snapshot.features.at(-1)!;
    expect(added).toMatchObject({ id: 4, name: 'lac promoter', start: 10, end: 15, type: 'promoter', forward: false });
    expect(added.color).toBe('#31b440');
  });

  it('rejects unknown feature types', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'add_feature', name: 'x', start: 1, end: 2, featureType: 'orf' }]);
    expect(result).toMatchObject({ ok: false, code: 'unknown_feature_type' });
  });

  it('rejects ranges outside the sequence', () => {
    expect(applyGenePlan(snapshot(), [{ type: 'add_feature', name: 'x', start: 19, end: 25 }])).toMatchObject({
      ok: false,
      code: 'invalid_range'
    });
  });

  it('accepts a range that crosses the origin on a circular document only', () => {
    const circular = applyGenePlan(snapshot(), [{ type: 'add_feature', name: 'backbone', start: 15, end: 5 }]);
    expect(circular.ok).toBe(true);
    if (!circular.ok) return;
    expect(circular.snapshot.features.at(-1)).toMatchObject({ start: 15, end: 5 });

    expect(
      applyGenePlan(snapshot({ topology: 'linear' }), [{ type: 'add_feature', name: 'x', start: 15, end: 5 }])
    ).toMatchObject({ ok: false, code: 'invalid_range' });
  });

  it('renames, moves and removes by id', () => {
    const renamed = applyGenePlan(snapshot(), [{ type: 'rename_feature', featureId: 3, name: 'bla' }]);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.snapshot.features[0].name).toBe('bla');

    const moved = applyGenePlan(snapshot(), [{ type: 'move_feature', featureId: 3, start: 4, end: 12 }]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.snapshot.features[0]).toMatchObject({ start: 4, end: 12 });

    const removed = applyGenePlan(snapshot(), [{ type: 'remove_feature', featureId: 3 }]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.snapshot.features).toHaveLength(0);
  });

  it('reports the ids that exist when a lookup fails', () => {
    const result = applyGenePlan(snapshot(), [{ type: 'remove_feature', featureId: 99 }]);
    expect(result).toMatchObject({ ok: false, code: 'feature_not_found', intentIndex: 0 });
    if (result.ok) return;
    expect(result.message).toContain('3');
  });
});

describe('applyGenePlan: atomicity and plan shape', () => {
  it('leaves the workspace untouched when a later intent fails', () => {
    const start = snapshot();
    const before = workspaceVersion(start);
    const result = applyGenePlan(start, [
      { type: 'rename_construct', name: 'pNEW' },
      { type: 'remove_feature', featureId: 42 }
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.intentIndex).toBe(1);
    expect(workspaceVersion(start)).toBe(before);
    expect(start.name).toBe('pTEST');
  });

  it('rejects empty plans, non-arrays and oversized plans', () => {
    expect(applyGenePlan(snapshot(), [])).toMatchObject({ ok: false, code: 'invalid_plan' });
    expect(applyGenePlan(snapshot(), { type: 'rename_construct', name: 'x' })).toMatchObject({ ok: false, code: 'invalid_plan' });
    const many = Array.from({ length: 51 }, () => ({ type: 'set_topology', topology: 'linear' }));
    expect(applyGenePlan(snapshot(), many)).toMatchObject({ ok: false, code: 'invalid_plan' });
  });

  it('rejects unknown intent types and badly typed fields', () => {
    expect(applyGenePlan(snapshot(), [{ type: 'delete_everything' }])).toMatchObject({ ok: false, code: 'invalid_intent' });
    expect(applyGenePlan(snapshot(), [{ type: 'add_feature', name: 'x', start: '1', end: 2 }])).toMatchObject({
      ok: false,
      code: 'invalid_intent'
    });
    expect(applyGenePlan(snapshot(), [{ type: 'set_topology', topology: 'wrapped' }])).toMatchObject({
      ok: false,
      code: 'invalid_topology'
    });
  });

  it('applies a mixed plan in order and returns the new version', () => {
    const result = applyGenePlan(snapshot(), [
      { type: 'rename_construct', name: 'pMIX' },
      { type: 'add_feature', name: 'ori', start: 1, end: 5, featureType: 'rep_origin' },
      { type: 'set_topology', topology: 'linear' }
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.name).toBe('pMIX');
    expect(result.snapshot.topology).toBe('linear');
    expect(result.snapshot.features.map((f) => f.id)).toEqual([3, 4]);
    expect(result.version).not.toBe(result.previousVersion);
    expect(describeGenePlan(result)).toContain('renamed construct');
  });
});

describe('applyGenePlan: pre-existing defects', () => {
  it('lets a plan through when the document already carried the defect', () => {
    const start = snapshot({
      features: [
        { id: 1, name: '', start: 2, end: 8, type: 'misc_feature', forward: true },
        { id: 3, name: 'ampR', start: 2, end: 8, type: 'cds', forward: true }
      ]
    });
    // An unnamed feature was already there; renaming the construct does not
    // make it this plan's problem.
    const result = applyGenePlan(start, [{ type: 'rename_construct', name: 'pKEEP' }]);
    expect(result.ok).toBe(true);
  });

  it('still refuses a defect the plan introduces', () => {
    // A circular document may hold a feature across the origin; making the
    // document linear is what turns that feature into a defect.
    const start = snapshot({
      features: [{ id: 1, name: 'backbone', start: 15, end: 5, type: 'misc_feature' }]
    });
    const result = applyGenePlan(start, [{ type: 'set_topology', topology: 'linear' }]);
    expect(result).toMatchObject({ ok: false, code: 'post_verify_failed' });
    if (result.ok) return;
    expect(result.message).toContain('wraps the origin');
  });
});

describe('verifyGeneSnapshot', () => {
  it('accepts a valid workspace', () => {
    expect(verifyGeneSnapshot(snapshot())).toEqual([]);
  });

  it('reports duplicate ids, dangling ranges and empty names', () => {
    const issues = verifyGeneSnapshot(
      snapshot({
        name: ' ',
        features: [
          { id: 1, name: 'a', start: 1, end: 5, type: 'cds' },
          { id: 1, name: '', start: 0, end: 2, type: 'cds' },
          { id: 2, name: 'c', start: 1, end: 999, type: 'cds' }
        ]
      })
    );
    expect(issues.map((issue) => issue.code).sort()).toEqual(
      ['duplicate_feature_id', 'invalid_name', 'invalid_name', 'invalid_range', 'invalid_range'].sort()
    );
  });

  it('accepts a range that crosses the origin on a circular document only', () => {
    const wrapped = [{ id: 1, name: 'backbone', start: 15, end: 5, type: 'misc_feature' }];
    expect(verifyGeneSnapshot(snapshot({ features: wrapped }))).toEqual([]);
    expect(verifyGeneSnapshot(snapshot({ topology: 'linear', features: wrapped }))).toEqual([
      {
        code: 'invalid_range',
        message: 'feature 1 wraps the origin (15..5) in a linear document'
      }
    ]);
  });

  it('reports a non-IUPAC sequence', () => {
    expect(verifyGeneSnapshot(snapshot({ sequence: 'ATGCZ', features: [] }))).toEqual([
      { code: 'invalid_sequence', message: 'the sequence contains non-IUPAC characters' }
    ]);
  });
});
