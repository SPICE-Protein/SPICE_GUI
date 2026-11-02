import { describe, expect, it } from 'vitest';
import {
  PROJECT_VERSION,
  isToolDocKind,
  newProject,
  summarize,
  validateSpiceProject,
  type ProjectDoc,
  type SpiceProjectFile,
} from '$lib/project/types';

function projectWithDocs(docs: unknown[], extra: Partial<SpiceProjectFile> = {}): SpiceProjectFile {
  return { ...newProject('Test project', 'PI', 'desc'), docs: docs as ProjectDoc[], ...extra };
}

const validToolPayloads: Record<string, unknown> = {
  gel: { version: 2, exposures: [], lanes: [] },
  blot: { version: 1, imageDataUrl: 'data:image/png;base64,AA==', lanes: [] },
  qpcr: { format: 'SPICE_QPCR', wells: [] },
  plate: { kind: 'spice-plate', samples: [], assignments: [] },
  colony: { version: 1, markers: [], imageDataUrl: 'data:image/png;base64,AA==' },
  annotate: { version: 1, panels: [], annotations: [] },
  tree: { format: 'spice-tree', originalNewick: '(A,B);' },
};

describe('isToolDocKind', () => {
  it('recognizes all seven tool kinds', () => {
    expect(Object.keys(validToolPayloads).every((kind) => isToolDocKind(kind))).toBe(true);
    expect(isToolDocKind('gene')).toBe(false);
    expect(isToolDocKind(null)).toBe(false);
  });
});

describe('validateSpiceProject accepts', () => {
  it('a freshly created project', () => {
    const project = newProject('My project', 'Ada', 'notes');
    const result = validateSpiceProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.meta.name).toBe('My project');
    expect(result.project.meta.pi).toBe('Ada');
    expect(result.project.meta.description).toBe('notes');
    expect(result.project.version).toBe(PROJECT_VERSION);
    expect(result.project.docs).toEqual([]);
    expect(result.project.files).toEqual([]);
  });

  it('gene and protein documents with matching payload formats', () => {
    const project = projectWithDocs([
      {
        id: 'g1',
        kind: 'gene',
        name: 'Gene',
        payload: { format: 'SPICE_GENE', sequence: 'ATGC' },
        updatedAt: '2026-01-01',
      },
      {
        id: 'p1',
        kind: 'protein',
        name: 'Protein',
        payload: { format: 'SPICE_PROTEIN', sequence: 'MKT' },
      },
    ]);
    const result = validateSpiceProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.docs).toHaveLength(2);
    // Missing updatedAt is filled in.
    expect(typeof result.project.docs[1].updatedAt).toBe('string');
  });

  it('every supported tool document payload', () => {
    const docs = Object.entries(validToolPayloads).map(([kind, payload]) => ({
      id: `d-${kind}`,
      kind,
      name: kind,
      payload,
    }));
    const result = validateSpiceProject(projectWithDocs(docs));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.docs).toHaveLength(7);
  });

  it('legacy 1.0 projects and upgrades them in memory', () => {
    const legacy = { ...newProject('Legacy'), version: '1.0' } as unknown as SpiceProjectFile;
    const result = validateSpiceProject(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.version).toBe(PROJECT_VERSION);
  });

  it('normalizes soft fields, journal pages and attached files', () => {
    const project = projectWithDocs(
      [
        {
          id: 'd1',
          kind: 'tree',
          name: 'Tree',
          payload: validToolPayloads.tree,
          preview: 'javascript:alert(1)',
          summary: 'ok',
        },
        {
          id: 'd2',
          kind: 'tree',
          name: 'Tree 2',
          payload: validToolPayloads.tree,
          preview: 'data:image/png;base64,AA==',
        },
      ],
      {
        meta: { ...newProject('x').meta, description: undefined as never, pi: undefined as never },
        journal: {
          pages: [
            { id: 'p1', markdownContent: '# hi' } as never,
            { id: 'p2', title: 'T', markdownContent: 'body', date: 'today', category: 'Lab', tags: ['a', 3] as never },
          ],
        },
        files: [
          { id: 'f1', name: 'raw.txt', data: 'data:text/plain;base64,AA==' } as never,
        ],
      },
    );
    const result = validateSpiceProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.meta.description).toBe('');
    expect(result.project.meta.pi).toBe('');
    expect(result.project.docs[0].preview).toBeUndefined();
    expect(result.project.docs[0].summary).toBe('ok');
    expect(result.project.docs[1].preview).toBe('data:image/png;base64,AA==');
    expect(result.project.journal.pages[0]).toMatchObject({
      id: 'p1',
      title: '',
      category: 'General',
      tags: [],
    });
    expect(result.project.journal.pages[1].tags).toEqual(['a']);
    expect(result.project.files[0]).toMatchObject({
      id: 'f1',
      name: 'raw.txt',
      mime: 'application/octet-stream',
      size: 0,
    });
  });
});

describe('validateSpiceProject rejects', () => {
  const failures: Array<[string, unknown, RegExp]> = [
    ['non-object', null, /not an object/],
    ['missing format', {}, /format/],
    ['wrong format', { ...newProject('x'), format: 'OTHER' }, /format/],
    ['unsupported version', { ...newProject('x'), version: '2.0' }, /unsupported version/],
    ['missing meta', { ...newProject('x'), meta: undefined }, /meta\.id/],
    ['empty meta name', { ...newProject('x'), meta: { ...newProject('x').meta, name: '' } }, /meta\.id/],
    ['docs not array', { ...newProject('x'), docs: 'nope' }, /docs is not an array/],
    ['doc missing id', projectWithDocs([{ kind: 'tree', name: 'T', payload: validToolPayloads.tree }]), /doc missing id\/name/],
    ['doc missing name', projectWithDocs([{ id: 'd', kind: 'tree', payload: validToolPayloads.tree }]), /doc missing id\/name/],
    ['unknown kind', projectWithDocs([{ id: 'd', kind: 'bogus', name: 'B', payload: {} }]), /bad kind/],
    ['gene payload wrong', projectWithDocs([{ id: 'd', kind: 'gene', name: 'G', payload: { format: 'SPICE_PROTEIN' } }]), /not SPICE_GENE/],
    ['protein payload wrong', projectWithDocs([{ id: 'd', kind: 'protein', name: 'P', payload: { format: 'SPICE_GENE' } }]), /not SPICE_PROTEIN/],
    ['gel payload wrong', projectWithDocs([{ id: 'd', kind: 'gel', name: 'G', payload: { version: 1, exposures: [], lanes: [] } }]), /invalid gel payload/],
    ['blot payload wrong', projectWithDocs([{ id: 'd', kind: 'blot', name: 'B', payload: { version: 1, lanes: [] } }]), /invalid blot payload/],
    ['qpcr payload wrong', projectWithDocs([{ id: 'd', kind: 'qpcr', name: 'Q', payload: { format: 'OTHER', wells: [] } }]), /invalid qpcr payload/],
    ['plate payload wrong', projectWithDocs([{ id: 'd', kind: 'plate', name: 'P', payload: { kind: 'other', samples: [], assignments: [] } }]), /invalid plate payload/],
    ['colony payload wrong', projectWithDocs([{ id: 'd', kind: 'colony', name: 'C', payload: { version: 1, markers: [] } }]), /invalid colony payload/],
    ['annotate payload wrong', projectWithDocs([{ id: 'd', kind: 'annotate', name: 'A', payload: { version: 1, panels: [] } }]), /invalid annotate payload/],
    ['tree payload wrong', projectWithDocs([{ id: 'd', kind: 'tree', name: 'T', payload: { format: 'spice-tree' } }]), /invalid tree payload/],
    [
      'journal not an array',
      { ...newProject('x'), journal: { pages: 'nope' } },
      /journal\.pages is not an array/,
    ],
    [
      'journal page missing markdown',
      projectWithDocs([], { journal: { pages: [{ id: 'p1' } as never] } }),
      /journal page missing id\/markdownContent/,
    ],
    [
      'attached file missing data',
      projectWithDocs([], { files: [{ id: 'f', name: 'n', data: undefined } as never] }),
      /attached file missing id\/name\/data/,
    ],
  ];

  for (const [label, input, message] of failures) {
    it(label, () => {
      const result = validateSpiceProject(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
    });
  }
});

describe('summarize', () => {
  it('counts docs, journal pages and attached files', () => {
    const result = validateSpiceProject(
      projectWithDocs(
        [
          { id: 'g', kind: 'gene', name: 'G', payload: { format: 'SPICE_GENE' } },
          { id: 't', kind: 'tree', name: 'T', payload: validToolPayloads.tree },
        ],
        {
          journal: { pages: [{ id: 'p', markdownContent: '' } as never] },
          files: [{ id: 'f', name: 'f', data: 'data:x' } as never],
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = summarize(result.project, '/tmp/test.spiceproj');
    expect(summary).toMatchObject({
      id: result.project.meta.id,
      name: 'Test project',
      pi: 'PI',
      filePath: '/tmp/test.spiceproj',
      docCount: 2,
      journalCount: 1,
      fileCount: 1,
    });
    expect(summary.updatedAt).toBe(result.project.meta.updatedAt);
  });
});
