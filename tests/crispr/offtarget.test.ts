import { describe, expect, it } from 'vitest';
import {
  findGenomeWideOfftargets,
  scoreGuideSpecificity,
  type OfftargetHit
} from '$lib/genome/crisprOfftarget';

const GUIDE = 'GTCAGTACGATCGTAGCTAG'; // 20 nt
const SPACER = 'AAAAAAAAAA';

function mutate(sequence: string, substitutions: Record<number, string>): string {
  const bases = [...sequence];
  for (const [position, base] of Object.entries(substitutions)) {
    bases[Number(position)] = base;
  }
  return bases.join('');
}

function reverseComplement(sequence: string): string {
  const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  return [...sequence].reverse().map((base) => complement[base]).join('');
}

const PLUS_OFFTARGET = mutate(GUIDE, { 5: 'A' }); // one mismatch
const MINUS_OFFTARGET = mutate(GUIDE, { 2: 'T', 12: 'A' }); // two mismatches

describe('findGenomeWideOfftargets', () => {
  it('finds the exact on-target and mismatched hits on both strands', () => {
    // Place the minus-strand site in the forward genome as the reverse
    // complement of [protospacer][PAM]; the scan then rediscovers it on "-".
    const minusSite = reverseComplement(`${MINUS_OFFTARGET}CGG`);
    const sequence =
      SPACER +
      `${GUIDE}TGG` +
      SPACER +
      `${PLUS_OFFTARGET}AGG` +
      SPACER +
      minusSite +
      SPACER;

    const hits = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'NGG', maxMismatches: 2, maxHits: 100 }
    );

    const exact = hits.filter((hit) => hit.mismatches === 0);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({
      genomeId: 'chr1',
      position: 10,
      strand: '+',
      guide: GUIDE,
      pam: 'TGG',
      mismatches: 0,
      cfd: 1,
      onTarget: true
    });

    const plusOfftarget = hits.find((hit) => hit.strand === '+' && hit.mismatches === 1);
    expect(plusOfftarget).toMatchObject({
      position: 43,
      guide: PLUS_OFFTARGET,
      pam: 'AGG',
      mismatches: 1,
      onTarget: false
    });

    const minusOfftarget = hits.find((hit) => hit.strand === '-' && hit.mismatches === 2);
    expect(minusOfftarget).toMatchObject({
      position: 79,
      guide: MINUS_OFFTARGET,
      pam: 'CGG',
      mismatches: 2,
      onTarget: false
    });

    // Exact matches score highest; otherwise heuristic CFD desc, mismatches asc.
    expect(hits[0].onTarget).toBe(true);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].cfd).toBeGreaterThanOrEqual(hits[i].cfd);
      if (hits[i - 1].cfd === hits[i].cfd) {
        expect(hits[i - 1].mismatches).toBeLessThanOrEqual(hits[i].mismatches);
      }
    }
  });

  it('respects maxMismatches and the PAM pattern', () => {
    const sequence =
      SPACER +
      `${GUIDE}TGG` +
      SPACER +
      `${PLUS_OFFTARGET}AGG` +
      SPACER +
      `${GUIDE}AAA` + // exact protospacer but no valid NGG PAM
      SPACER;

    const strict = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'NGG', maxMismatches: 0 }
    );
    expect(strict).toHaveLength(1);
    expect(strict[0]).toMatchObject({ position: 10, mismatches: 0, pam: 'TGG' });

    const relaxed = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'NGG', maxMismatches: 1 }
    );
    expect(relaxed.some((hit) => hit.guide === PLUS_OFFTARGET && hit.mismatches === 1)).toBe(true);
    expect(relaxed.some((hit) => hit.pam === 'AAA')).toBe(false);

    const tggOnly = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'TGG', maxMismatches: 1 }
    );
    expect(tggOnly).toHaveLength(1);
    expect(tggOnly.every((hit) => hit.pam === 'TGG')).toBe(true);
  });

  it('matches IUPAC PAM codes', () => {
    const sequence =
      SPACER +
      `${GUIDE}AGG` +
      SPACER +
      `${GUIDE}CGG` +
      SPACER +
      `${GUIDE}GGG` +
      SPACER +
      `${GUIDE}TGG` +
      SPACER;

    const nggHits = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'NGG', maxMismatches: 0 }
    );
    expect(nggHits).toHaveLength(4);
    expect(new Set(nggHits.map((hit) => hit.pam))).toEqual(
      new Set(['AGG', 'CGG', 'GGG', 'TGG'])
    );

    // CNG restricts the first base to C, so only the CGG site remains.
    const cngHits = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'CNG', maxMismatches: 0 }
    );
    expect(cngHits).toHaveLength(1);
    expect(cngHits[0].pam).toBe('CGG');
  });

  it('supports a 5-prime PAM direction', () => {
    const sequence = SPACER + `TTTA${GUIDE}` + SPACER;

    const hits = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'TTTV', pamDirection: '5prime', maxMismatches: 0 }
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      position: 14,
      strand: '+',
      guide: GUIDE,
      pam: 'TTTA',
      mismatches: 0,
      onTarget: true
    });
  });

  it('caps the default result count at 100', () => {
    // Spacers keep each exact site independent and prevent incidental PAMs.
    const sequence = `${GUIDE}TGGCCCCCC`.repeat(101);

    const hits = findGenomeWideOfftargets(
      GUIDE,
      [{ id: 'chr1', sequence }],
      { pam: 'NGG', maxMismatches: 0 }
    );

    expect(hits).toHaveLength(100);
  });
});

describe('scoreGuideSpecificity', () => {
  const hit = (onTarget: boolean, mismatches: number): OfftargetHit => ({
    genomeId: 'chr1',
    position: 0,
    strand: '+',
    guide: GUIDE,
    pam: 'TGG',
    mismatches,
    cfd: onTarget ? 1 : 0.5,
    onTarget
  });

  it('counts on-target and off-target hits and reports specificity', () => {
    const hits = [hit(true, 0), hit(false, 1), hit(false, 2), hit(false, 3)];

    expect(scoreGuideSpecificity(hits)).toEqual({
      onTarget: 1,
      offTargets: 3,
      specificity: 25
    });
  });

  it('returns a zero summary for an empty hit list', () => {
    expect(scoreGuideSpecificity([])).toEqual({
      onTarget: 0,
      offTargets: 0,
      specificity: 0
    });
  });
});
