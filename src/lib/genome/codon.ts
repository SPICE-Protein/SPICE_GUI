// Codon optimization helpers for SPICE gene editor.
// Host usage tables adapted from the original SPICE CodonOptimizer component.

export type CodonHost = "ecoli" | "yeast" | "human";

export interface CodonUsage {
  codon: string;
  aa: string;
  fraction: number; // relative adaptiveness (0..1)
  perThousand: number;
}

const AA_OF_CODON: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y",
  CAT: "H", CAC: "H",
  CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N",
  AAA: "K", AAG: "K",
  GAT: "D", GAC: "D",
  GAA: "E", GAG: "E",
  TGT: "C", TGC: "C",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R", AGA: "R", AGG: "R",
  AGT: "S", AGC: "S",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  ATG: "M",
  TGG: "W",
  TAA: "*", TAG: "*", TGA: "*"
};

/** Relative adaptiveness weights per host (0..1, from the original SPICE optimizer). */
export const CODON_WEIGHTS: Record<CodonHost, Record<string, Record<string, number>>> = {
  ecoli: {
    F: { TTT: 0.3, TTC: 1.0 },
    L: { TTA: 0.1, TTG: 0.1, CTT: 0.1, CTC: 0.1, CTA: 0.05, CTG: 1.0 },
    I: { ATT: 0.5, ATC: 1.0, ATA: 0.05 },
    V: { GTT: 0.4, GTC: 0.2, GTA: 0.15, GTG: 1.0 },
    S: { TCT: 0.3, TCC: 0.4, TCA: 0.1, TCG: 0.1, AGT: 0.15, AGC: 1.0 },
    P: { CCT: 0.15, CCC: 0.1, CCA: 0.2, CCG: 1.0 },
    T: { ACT: 0.35, ACC: 1.0, ACA: 0.1, ACG: 0.15 },
    A: { GCT: 0.3, GCC: 0.2, GCA: 0.3, GCG: 1.0 },
    Y: { TAT: 0.3, TAC: 1.0 },
    H: { CAT: 0.3, CAC: 1.0 },
    Q: { CAA: 0.3, CAG: 1.0 },
    N: { AAT: 0.3, AAC: 1.0 },
    K: { AAA: 0.25, AAG: 1.0 },
    D: { GAT: 0.4, GAC: 1.0 },
    E: { GAA: 1.0, GAG: 0.3 },
    C: { TGT: 0.4, TGC: 1.0 },
    R: { CGT: 0.4, CGC: 0.4, CGA: 0.05, CGG: 0.05, AGA: 0.1, AGG: 0.1 },
    G: { GGT: 0.4, GGC: 1.0, GGA: 0.1, GGG: 0.15 },
    M: { ATG: 1.0 },
    W: { TGG: 1.0 },
    "*": { TAA: 1.0, TAG: 0.1, TGA: 0.1 }
  },
  yeast: {
    F: { TTT: 1.0, TTC: 0.6 },
    L: { TTA: 1.0, TTG: 0.8, CTT: 0.1, CTC: 0.1, CTA: 0.2, CTG: 0.1 },
    I: { ATT: 1.0, ATC: 0.4, ATA: 0.15 },
    V: { GTT: 1.0, GTC: 0.4, GTA: 0.3, GTG: 0.2 },
    S: { TCT: 1.0, TCC: 0.5, TCA: 0.4, TCG: 0.1, AGT: 0.3, AGC: 0.2 },
    P: { CCT: 0.4, CCC: 0.15, CCA: 1.0, CCG: 0.05 },
    T: { ACT: 1.0, ACC: 0.4, ACA: 0.3, ACG: 0.1 },
    A: { GCT: 1.0, GCC: 0.4, GCA: 0.5, GCG: 0.1 },
    Y: { TAT: 1.0, TAC: 0.4 },
    H: { CAT: 1.0, CAC: 0.4 },
    Q: { CAA: 1.0, CAG: 0.3 },
    N: { AAT: 1.0, AAC: 0.5 },
    K: { AAA: 1.0, AAG: 0.4 },
    D: { GAT: 1.0, GAC: 0.4 },
    E: { GAA: 1.0, GAG: 0.3 },
    C: { TGT: 1.0, TGC: 0.2 },
    R: { CGT: 0.2, CGC: 0.1, CGA: 0.1, CGG: 0.05, AGA: 1.0, AGG: 0.2 },
    G: { GGT: 1.0, GGC: 0.2, GGA: 0.3, GGG: 0.1 },
    M: { ATG: 1.0 },
    W: { TGG: 1.0 },
    "*": { TAA: 1.0, TAG: 0.1, TGA: 0.1 }
  },
  human: {
    F: { TTT: 0.4, TTC: 1.0 },
    L: { TTA: 0.1, TTG: 0.25, CTT: 0.2, CTC: 0.3, CTA: 0.1, CTG: 1.0 },
    I: { ATT: 0.45, ATC: 1.0, ATA: 0.15 },
    V: { GTT: 0.3, GTC: 0.4, GTA: 0.15, GTG: 1.0 },
    S: { TCT: 0.2, TCC: 0.4, TCA: 0.2, TCG: 0.1, AGT: 0.25, AGC: 1.0 },
    P: { CCT: 0.3, CCC: 0.4, CCA: 0.3, CCG: 1.0 },
    T: { ACT: 0.25, ACC: 1.0, ACA: 0.3, ACG: 0.15 },
    A: { GCT: 0.4, GCC: 1.0, GCA: 0.3, GCG: 0.15 },
    Y: { TAT: 0.4, TAC: 1.0 },
    H: { CAT: 0.4, CAC: 1.0 },
    Q: { CAA: 0.35, CAG: 1.0 },
    N: { AAT: 0.4, AAC: 1.0 },
    K: { AAA: 0.4, AAG: 1.0 },
    D: { GAT: 0.45, GAC: 1.0 },
    E: { GAA: 0.45, GAG: 1.0 },
    C: { TGT: 0.4, TGC: 1.0 },
    R: { CGT: 0.1, CGC: 0.35, CGA: 0.1, CGG: 0.2, AGA: 1.0, AGG: 0.9 },
    G: { GGT: 0.3, GGC: 1.0, GGA: 0.4, GGG: 0.3 },
    M: { ATG: 1.0 },
    W: { TGG: 1.0 },
    "*": { TAA: 0.3, TAG: 0.2, TGA: 1.0 }
  }
};

/** Best (most-adaptive) codon per AA for each host. */
export const BEST_CODONS: Record<CodonHost, Record<string, string>> = {
  ecoli: {
    M: "ATG", W: "TGG", F: "TTC", L: "CTG", I: "ATC", V: "GTG",
    S: "AGC", P: "CCG", T: "ACC", A: "GCG", Y: "TAC", H: "CAC",
    Q: "CAG", N: "AAC", K: "AAG", D: "GAC", E: "GAA", C: "TGC",
    R: "CGT", G: "GGC", "*": "TAA"
  },
  yeast: {
    M: "ATG", W: "TGG", F: "TTT", L: "TTA", I: "ATT", V: "GTT",
    S: "TCT", P: "CCA", T: "ACT", A: "GCT", Y: "TAT", H: "CAT",
    Q: "CAA", N: "AAT", K: "AAA", D: "GAT", E: "GAA", C: "TGT",
    R: "AGA", G: "GGT", "*": "TAA"
  },
  human: {
    M: "ATG", W: "TGG", F: "TTC", L: "CTG", I: "ATC", V: "GTG",
    S: "AGC", P: "CCG", T: "ACC", A: "GCC", Y: "TAC", H: "CAC",
    Q: "CAG", N: "AAC", K: "AAG", D: "GAC", E: "GAG", C: "TGC",
    R: "AGA", G: "GGC", "*": "TGA"
  }
};

export function getAminoAcidOfCodon(codon: string): string | undefined {
  return AA_OF_CODON[codon.toUpperCase()];
}

/** Compute the Codon Adaptation Index (CAI) of a DNA sequence for a given host. */
export function calculateCai(
  dnaSequence: string,
  host: CodonHost
): { cai: number; gc: number; optimizedCount: number; totalCodons: number } {
  const weights = CODON_WEIGHTS[host];
  const clean = dnaSequence.toUpperCase().replace(/[^ATCG]/g, "");
  let geometricSum = 0;
  let totalCodons = 0;
  let optimizedCount = 0;
  let gcCount = 0;
  for (let i = 0; i + 3 <= clean.length; i += 3) {
    const codon = clean.slice(i, i + 3);
    const aa = AA_OF_CODON[codon];
    if (!aa) continue;
    const w = weights[aa]?.[codon];
    if (w === undefined) continue;
    geometricSum += Math.log(Math.max(w, 0.0001));
    totalCodons++;
    if (w === 1) optimizedCount++;
    for (const c of codon) if (c === "G" || c === "C") gcCount++;
  }
  const cai = totalCodons > 0 ? Math.exp(geometricSum / totalCodons) : 0;
  const gc = clean.length > 0 ? (gcCount / clean.length) * 100 : 0;
  return { cai, gc, optimizedCount, totalCodons };
}

/**
 * Optimize a protein (AA) or DNA sequence for a host. If `isDna`, translates first.
 * Returns the optimized DNA sequence.
 */
export function optimizeCodons(
  input: string,
  host: CodonHost,
  isDna = false
): { optimized: string; changed: number } {
  const clean = input.toUpperCase().replace(/[^ATCG]/g, "");
  let aaString: string;
  if (isDna) {
    aaString = "";
    for (let i = 0; i + 3 <= clean.length; i += 3) {
      aaString += AA_OF_CODON[clean.slice(i, i + 3)] ?? "X";
    }
  } else {
    aaString = clean;
  }
  let optimized = "";
  let changed = 0;
  for (const aa of aaString) {
    const best = BEST_CODONS[host][aa];
    if (best) {
      optimized += best;
      if (isDna && AA_OF_CODON[best] !== aa) changed++;
    } else {
      optimized += "NNN";
    }
  }
  return { optimized, changed };
}
