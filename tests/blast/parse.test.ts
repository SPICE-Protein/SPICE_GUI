import { describe, expect, it } from 'vitest';
import {
  normalizeEbiDoc,
  normalizeNcbiDoc,
  parseNcbiPutResponse,
  parseNcbiSearchInfo,
  type EbiDoc,
  type NcbiDoc,
} from '$lib/blast/parse';

const NCBI: NcbiDoc = {
  BlastOutput2: [
    {
      report: {
        program: 'blastn',
        search_target: { db: 'refseq_rna' },
        results: {
          search: {
            query_len: 78,
            hits: [
              {
                num: 1,
                description: [
                  {
                    id: 'gi|915133124|ref|XM_013480425.1|',
                    accession: 'XM_013480425',
                    title: 'Eimeria maxima Green fluorescent protein, related partial mRNA',
                    sciname: 'Eimeria maxima',
                  },
                ],
                len: 870,
                hsps: [
                  {
                    bit_score: 113.997,
                    score: 125,
                    evalue: 9.7637e-22,
                    identity: 64,
                    align_len: 65,
                    gaps: 0,
                    query_from: 1,
                    query_to: 65,
                    hit_from: 82,
                    hit_to: 146,
                    query_strand: 'Plus',
                    hit_strand: 'Plus',
                    qseq: 'ATGGTG',
                    hseq: 'ATGGTG',
                    midline: '||||||',
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ],
};

const EBI: EbiDoc = {
  program: 'blastp',
  query_len: 238,
  hits: [
    {
      hit_acc: 'P42212',
      hit_id: 'GFP_AEQVI',
      hit_def: 'SP:P42212 GFP_AEQVI Green fluorescent protein',
      hit_desc: 'Green fluorescent protein OS=Aequorea victoria',
      hit_os: 'Aequorea victoria',
      hit_len: 238,
      hit_hsps: [
        {
          hsp_bit_score: 491.5,
          hsp_score: 1264,
          hsp_expect: 3.3e-178,
          hsp_identity: 99.6,
          hsp_align_len: 238,
          hsp_gaps: 0,
          hsp_query_from: 1,
          hsp_query_to: 238,
          hsp_hit_from: 1,
          hsp_hit_to: 238,
          hsp_qseq: 'MSKG',
          hsp_hseq: 'MSKG',
          hsp_mseq: '||||',
        },
      ],
    },
  ],
};

describe('normalizeNcbiDoc', () => {
  it('converts the NCBI residue count into percent identity', () => {
    const result = normalizeNcbiDoc(NCBI, 'refseq_rna');
    expect(result.provider).toBe('ncbi');
    expect(result.program).toBe('blastn');
    expect(result.database).toBe('refseq_rna');
    expect(result.queryLength).toBe(78);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].accession).toBe('XM_013480425');
    expect(result.hits[0].organism).toBe('Eimeria maxima');
    expect(result.hits[0].hsps[0].identity).toBeCloseTo((64 / 65) * 100, 4);
    expect(result.hits[0].hsps[0].evalue).toBeCloseTo(9.7637e-22);
  });

  it('tolerates a search without hits', () => {
    const result = normalizeNcbiDoc(
      { BlastOutput2: [{ report: { program: 'blastp', results: { search: { query_len: 12 } } } }] },
      'nr',
    );
    expect(result.hits).toEqual([]);
    expect(result.program).toBe('blastp');
    expect(result.database).toBe('nr');
  });
});

describe('normalizeEbiDoc', () => {
  it('keeps EBI percent identity and maps UniProt metadata', () => {
    const result = normalizeEbiDoc(EBI, 'uniprotkb_swissprot');
    expect(result.provider).toBe('ebi');
    expect(result.program).toBe('blastp');
    expect(result.database).toBe('uniprotkb_swissprot');
    expect(result.queryLength).toBe(238);
    expect(result.hits[0].accession).toBe('P42212');
    expect(result.hits[0].title).toContain('Green fluorescent protein');
    expect(result.hits[0].organism).toBe('Aequorea victoria');
    expect(result.hits[0].hsps[0].identity).toBe(99.6);
    expect(result.hits[0].hsps[0].midline).toBe('||||');
  });
});

describe('NCBI response parsing', () => {
  it('reads the RID and RTOE from the QBlastInfo block', () => {
    const text = [
      '<span id="QBlastInfoBegin">',
      '    RID = FG1SG6XF014',
      '    RTOE = 30',
      '</span>',
    ].join('\n');
    expect(parseNcbiPutResponse(text)).toEqual({ rid: 'FG1SG6XF014', rtoe: 30 });
  });

  it('ignores the RID link rendered above the QBlastInfo block', () => {
    const text = [
      '<a href="Blast.cgi?RID%3DFG1SG6XF014%26RTOE%3D30">Log in</a>',
      'QBlastInfoBegin',
      'RID = FG1SG6XF014',
      'RTOE = 30',
      'QBlastInfoEnd',
    ].join('\n');
    expect(parseNcbiPutResponse(text).rid).toBe('FG1SG6XF014');
  });

  it('reads SearchInfo status and hit flag', () => {
    expect(parseNcbiSearchInfo('Status=READY\nThereAreHits=yes')).toEqual({
      status: 'READY',
      hasHits: true,
      message: '',
    });
    expect(parseNcbiSearchInfo('Status=WAITING\nThereAreHits=no').status).toBe('WAITING');
    expect(parseNcbiSearchInfo('Status=FAILED\nMessage=Invalid query')).toMatchObject({
      status: 'FAILED',
      message: 'Invalid query',
    });
  });
});
