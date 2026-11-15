import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Browser transport: the desktop branch would call into Tauri. The client
// checks isTauri() once per request, so a stub keeps the test on fetch.
vi.mock('$lib/backend/api', () => ({ isTauri: () => false }));

import { SpdClient } from '$lib/spd/client';

const base = 'https://example.test/api/v1';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => json({ data: {}, error: null, meta: {} }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestedUrl(): string {
  return String(fetchMock.mock.calls[0][0]);
}

describe('SpdClient graph reads', () => {
  it("reads sequence lineage from the sequence endpoint, not the generic one", async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: {
        rootSequenceId: 'spd:sequence:root',
        nodes: [
          { id: 'spd:sequence:root', parentSequenceId: null, sequenceRole: 'native' },
          { id: 'spd:sequence:child', parentSequenceId: 'spd:sequence:root', sequenceRole: 'variant' },
        ],
        edges: [{ from: 'spd:sequence:root', to: 'spd:sequence:child' }],
      },
      error: null,
      meta: { schemaVersion: '1.0.0' },
    }));
    const result = await new SpdClient({ baseUrl: base }).entityLineage('sequence', 'spd:sequence:child');
    expect(requestedUrl()).toContain('/sequences/spd%3Asequence%3Achild/lineage');
    expect(requestedUrl()).not.toContain('/entities/');
    expect(result.nodes.map((node) => node.id)).toEqual(['spd:sequence:root', 'spd:sequence:child']);
  });

  it('tolerates a dossier-shaped generic lineage response', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: { entity: { entityId: 'spd:protein:1', entityType: 'protein' }, measurements: [] },
      error: null,
      meta: {},
    }));
    const result = await new SpdClient({ baseUrl: base }).entityLineage('protein', 'spd:protein:1');
    expect(requestedUrl()).toContain('/entities/protein/spd%3Aprotein%3A1/lineage');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('normalizes relations and keeps the server label for the far side', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: {
        entity: { id: 'spd:protein:1', type: 'protein' },
        relations: [{
          id: 'derived:1', relationType: 'sequence_of', direction: 'in', source: 'derived',
          from: { id: 'spd:sequence:1', type: 'sequence' },
          to: { id: 'spd:protein:1', type: 'protein' },
          other: { id: 'spd:sequence:1', type: 'sequence', label: '198 aa', subtitle: null },
        }],
      },
      error: null,
      meta: {},
    }));
    const result = await new SpdClient({ baseUrl: base }).entityRelations('protein', 'spd:protein:1');
    expect(requestedUrl()).toContain('/entities/protein/spd%3Aprotein%3A1/relations');
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0].other.label).toBe('198 aa');
    expect(result.entity).toEqual({ id: 'spd:protein:1', type: 'protein' });
  });

  it('passes relation filters as query parameters', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { entity: { id: 'x', type: 'fold' }, relations: [] }, error: null, meta: {} }));
    await new SpdClient({ baseUrl: base }).entityRelations('fold', 'spd:fold:1', { direction: 'out', relationType: 'fold_of' });
    expect(requestedUrl()).toContain('direction=out');
    expect(requestedUrl()).toContain('relation_type=fold_of');
  });

  it('returns an empty list when the server omits relations', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: {}, error: null, meta: {} }));
    const result = await new SpdClient({ baseUrl: base }).entityRelations('gene', 'spd:gene:1');
    expect(result.relations).toEqual([]);
    expect(result.entity).toEqual({ id: 'spd:gene:1', type: 'gene' });
  });
});

describe('SpdClient evidence reads', () => {
  it('normalizes a fold history into arrays and keeps the prediction blob', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: {
        foldId: 'spd:fold:1',
        validations: [{ id: 'v1', status: 'accepted' }],
        observedStructures: [],
        prediction: { length: 120 },
      },
      error: null,
      meta: {},
    }));
    const history = await new SpdClient({ baseUrl: base }).foldHistory('spd:fold:1');
    expect(requestedUrl()).toContain('/folds/spd%3Afold%3A1/history');
    expect(history.validations).toHaveLength(1);
    expect(history.observedStructures).toEqual([]);
    expect(history.mdVerifications).toEqual([]);
    expect(history.prediction).toEqual({ length: 120 });
  });

  it('fills sequence-tree counters when the server omits them', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: { nodes: [{ id: 'spd:sequence:1', depth: 0 }], edges: [] },
      error: null,
      meta: {},
    }));
    const tree = await new SpdClient({ baseUrl: base }).sequenceTree('spd:sequence:1');
    expect(requestedUrl()).toContain('/sequences/spd%3Asequence%3A1/tree');
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodeCount).toBe(0);
    expect(tree.maxDepth).toBe(0);
  });

  it('reads fold context through the graph DSL and rejects array-shaped edges', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: {
        results: [{
          id: 'spd:fold:1',
          sequence: { id: 'spd:sequence:1', length: 120 },
          environment: { ph: 7, temperatureK: 310 },
          model: [{ id: 'not-a-single-record' }],
        }],
        tier: 'standard', budgetMax: 40, budgetUsed: 3,
      },
      error: null,
      meta: {},
    }));
    const context = await new SpdClient({ baseUrl: base }).graphFoldContext('spd:fold:1');
    expect(requestedUrl()).toContain('/query');
    expect(context?.sequence).toEqual({ id: 'spd:sequence:1', length: 120 });
    expect(context?.environment).toEqual({ ph: 7, temperatureK: 310 });
    expect(context?.model).toBeNull();
  });

  it('returns null when the graph read fails so the caller can fall back', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: null, error: { code: 'VALIDATION_ERROR', message: 'unknown edge fold.sequence' }, meta: {},
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const context = await new SpdClient({ baseUrl: base }).graphFoldContext('spd:fold:1');
    expect(context).toBeNull();
  });

  it('accepts both the wrapped and the bare provenance payload', async () => {
    fetchMock.mockResolvedValueOnce(json({
      data: { entityId: 'spd:protein:1', snapshots: [{ id: 's1', source: 'uniprot' }] },
      error: null,
      meta: {},
    }));
    const wrapped = await new SpdClient({ baseUrl: base }).provenanceSnapshots('protein', 'spd:protein:1');
    expect(wrapped.map((snapshot) => snapshot.source)).toEqual(['uniprot']);
    expect(requestedUrl()).toContain('/provenance/snapshots/by-entity/protein/spd%3Aprotein%3A1');

    fetchMock.mockResolvedValueOnce(json({ data: [{ id: 's2', source: 'pdb' }], error: null, meta: {} }));
    const bare = await new SpdClient({ baseUrl: base }).provenanceSnapshots('protein', 'spd:protein:1');
    expect(bare.map((snapshot) => snapshot.source)).toEqual(['pdb']);
  });
});
