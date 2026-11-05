import { describe, expect, it } from 'vitest';
import { formatRetrievalContext, retrieve, tokenize } from '$lib/ai/retrieval';

const DOCUMENTS = [
  { id: '1', kind: 'journal', title: 'BL21 expression', text: 'Grew BL21(DE3) at 16 °C and induced with IPTG overnight.' },
  { id: '2', kind: 'gene', title: 'eGFP construct', text: 'The eGFP coding sequence uses an E. coli codon host.' },
  { id: '3', kind: 'protein', title: 'Stability scan', text: 'The pH 5.5 stability scan showed a folded core.' },
];

describe('tokenize', () => {
  it('indexes English terms and CJK bigrams', () => {
    expect(tokenize('BL21 expression')).toEqual(expect.arrayContaining(['bl21', 'expression']));
    expect(tokenize('蛋白稳定性')).toEqual(expect.arrayContaining(['蛋白', '白稳', '稳定', '定性']));
  });

  it('drops single Latin characters', () => {
    expect(tokenize('a b c')).toEqual([]);
  });
});

describe('retrieve', () => {
  it('ranks the document that matches the query', () => {
    const hits = retrieve('BL21 IPTG expression', DOCUMENTS);
    expect(hits[0].document.id).toBe('1');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain('BL21');
  });

  it('matches Chinese queries against Chinese text', () => {
    const docs = [{ id: 'zh', kind: 'journal', title: '稳定性实验', text: '在 pH 5.5 下蛋白稳定性下降。' }];
    expect(retrieve('蛋白稳定性', docs)[0].document.id).toBe('zh');
  });

  it('returns nothing for unrelated queries and empty corpora', () => {
    expect(retrieve('western blot', DOCUMENTS)).toEqual([]);
    expect(retrieve('anything', [])).toEqual([]);
    expect(retrieve('', DOCUMENTS)).toEqual([]);
  });

  it('honors the result limit', () => {
    const hits = retrieve('the sequence protein expression', DOCUMENTS, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('formats hits as a labelled context block', () => {
    const text = formatRetrievalContext(retrieve('BL21', DOCUMENTS, 1));
    expect(text).toContain('Potentially relevant workspace context');
    expect(text).toContain('[journal]');
    expect(formatRetrievalContext([])).toBe('');
  });
});
