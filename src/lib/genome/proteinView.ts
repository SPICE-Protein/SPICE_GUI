// Protein sequence view helpers: multi-view, post-translational modifications,
// 3-letter / 1-letter conversion, codon frequency, ORF annotation.

import { getAminoAcidDataForEachBaseOfDna, type AminoAcidDataForBase } from "./aa";
import { getAminoAcidStringFromSequenceString } from "./sequence";
import { calculatePercentGC } from "./sequence";

// ──────────────────────────────── Types ────────────────────────────────

export interface ProteinFeature {
  id: string;
  name: string;
  type: string;
  start: number; // 0-based AA position
  end: number;
  color: string;
  description?: string;
}

export interface PostTranslationalModification {
  type: "phosphorylation" | "glycosylation" | "ubiquitination" | "acetylation" | "methylation" | "disulfide";
  position: number;
  residue: string;
  motif: string;
  confidence: number;
}

export interface CodonFrequency {
  codon: string;
  aa: string;
  count: number;
  fraction: number;
  perThousand: number;
}

export interface ProteinProperties {
  length: number;
  molecularWeight: number; // Da
  isoelectricPoint: number; // pI
  extinctionCoeff: number; // M-1 cm-1 at 280nm
  aromaticity: number;
  instability: number;
  gravy: number; // grand average of hydropathy
  charge: number; // at pH 7
}

export interface ProteinViewData {
  sequence: string;
  dnaSequence: string;
  features: ProteinFeature[];
  ptms: PostTranslationalModification[];
  properties: ProteinProperties;
  codonFrequencies: CodonFrequency[];
  aminoAcidData: AminoAcidDataForBase[];
}

// ──────────────────────────────── Amino acid maps ────────────────────────────────

const AA_3LETTER: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys",
  E: "Glu", Q: "Gln", G: "Gly", H: "His", I: "Ile",
  L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro",
  S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val",
  "*": "***",
};

const AA_MONO_MW: Record<string, number> = {
  A: 71.03711, R: 156.10111, N: 114.04293, D: 115.02694, C: 103.00919,
  E: 129.04259, Q: 128.05858, G: 57.02146, H: 137.05891, I: 113.08406,
  L: 113.08406, K: 128.09496, M: 131.04049, F: 147.06841, P: 97.05276,
  S: 87.03203, T: 101.04768, W: 186.07931, Y: 163.06333, V: 99.06841,
};

const AA_PKA: Record<string, number> = {
  D: 3.65, E: 4.25, C: 8.18, Y: 10.07, H: 6.0,
  K: 10.53, R: 12.48, // termini: N-term ~8.0, C-term ~3.1
};

const AA_HYDRO: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5,
  E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6,
  S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

const AROMATIC_AA = new Set(["F", "W", "Y", "H"]);

// ──────────────────────────────── Conversion ────────────────────────────────

export function toThreeLetter(aaString: string): string {
  return aaString.split("").map(c => AA_3LETTER[c.toUpperCase()] || "Xxx").join("-");
}

export function toOneLetter(threeLetter: string): string {
  const reversed = Object.entries(AA_3LETTER).reduce((acc, [k, v]) => {
    acc[v] = k;
    return acc;
  }, {} as Record<string, string>);
  return threeLetter.split(/[-\s]+/).map(t => reversed[t] || "X").join("");
}

// ──────────────────────────────── PTM Prediction ────────────────────────────────

const PHOSPHO_MOTIFS: { motif: RegExp; type: string; aa: string }[] = [
  { motif: /S[T]E/g, type: "CK1", aa: "S" }, // CK1
  { motif: /S[T]P/g, type: "Proline-directed", aa: "S" }, // Pro-directed
  { motif: /R.[ST]/g, type: "PKA", aa: "S" }, // PKA
  { motif: /[ST]xxE/g, type: "CK2", aa: "S" }, // CK2
];

const GLYCO_N_LINK = /N[^P][ST][^P]/gi;
const GLYCO_O_LINK = /[^P][ST][^P]/gi;

export function predictPTMs(proteinSeq: string): PostTranslationalModification[] {
  const ptms: PostTranslationalModification[] = [];
  const seq = proteinSeq.toUpperCase();

  // Phosphorylation
  for (const motif of PHOSPHO_MOTIFS) {
    motif.motif.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = motif.motif.exec(seq)) !== null) {
      ptms.push({
        type: "phosphorylation",
        position: m.index,
        residue: seq[m.index],
        motif: motif.type,
        confidence: 0.7,
      });
      if (m.index === motif.motif.lastIndex) motif.motif.lastIndex++;
    }
  }

  // N-linked glycosylation
  let gmatch: RegExpExecArray | null;
  GLYCO_N_LINK.lastIndex = 0;
  while ((gmatch = GLYCO_N_LINK.exec(seq)) !== null) {
    if (gmatch[0][1] !== "P" && gmatch[0][2] !== "P") {
      ptms.push({
        type: "glycosylation",
        position: gmatch.index,
        residue: seq[gmatch.index],
        motif: "N-X-S/T (N-linked)",
        confidence: 0.85,
      });
    }
    if (gmatch.index === GLYCO_N_LINK.lastIndex) GLYCO_N_LINK.lastIndex++;
  }

  // Cysteine (disulfide / palmitoylation)
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === "C") {
      ptms.push({
        type: "disulfide",
        position: i,
        residue: "C",
        motif: "Cysteine",
        confidence: 0.5,
      });
    }
    // Lysine (ubiquitination / acetylation)
    if (seq[i] === "K") {
      ptms.push({
        type: "ubiquitination",
        position: i,
        residue: "K",
        motif: "Lysine",
        confidence: 0.3,
      });
    }
  }

  return ptms;
}

// ──────────────────────────────── Properties ────────────────────────────────

export function calculateProteinProperties(proteinSeq: string): ProteinProperties {
  const seq = proteinSeq.toUpperCase();
  const n = seq.length;
  if (n === 0) {
    return {
      length: 0, molecularWeight: 0, isoelectricPoint: 7,
      extinctionCoeff: 0, aromaticity: 0, instability: 0, gravy: 0, charge: 0,
    };
  }

  // Molecular weight
  let mw = 18.0153; // water
  for (const c of seq) mw += AA_MONO_MW[c] || 0;
  mw -= (n - 1) * 18.0153; // peptide bonds remove water

  // Extinction coefficient (reduced Cys, Pace et al.)
  let tyr = 0, trp = 0, cys = 0;
  for (const c of seq) {
    if (c === "Y") tyr++;
    if (c === "W") trp++;
    if (c === "C") cys++;
  }
  const extCoeff = (trp * 5500 + tyr * 1490) / n * n || 0;
  const extCoeffCys = trp * 5500 + tyr * 1490 + cys * 125;

  // Aromaticity
  let aromatic = 0;
  for (const c of seq) if (AROMATIC_AA.has(c)) aromatic++;
  const aromaticity = aromatic / n;

  // Instability index (simplified)
  let instability = 0;
  if (n > 1) {
    for (let i = 0; i < n - 1; i++) {
      instability += (AA_HYDRO[seq[i]] || 0) * 0.1;
    }
    instability /= n;
  }

  // GRAVY
  let gravy = 0;
  for (const c of seq) gravy += AA_HYDRO[c] || 0;
  gravy /= n;

  // Charge at pH 7
  let charge = 0;
  for (const c of seq) {
    if (c === "K" || c === "R") charge += 1;
    if (c === "D" || c === "E") charge -= 1;
    if (c === "H") charge += 0.1;
  }
  // N-terminus +1, C-terminus -1
  charge += 1 - 1;

  // pI (simplified using Henderson-Hasselbalch)
  let pI = 7.0;
  const acidic = (seq.match(/[DE]/g) || []).length;
  const basic = (seq.match(/[KR]/g) || []).length;
  if (acidic > basic) {
    pI = 3.0 + (acidic - basic) * 0.5;
  } else if (basic > acidic) {
    pI = 10.0 - (basic - acidic) * 0.5;
  }

  return {
    length: n,
    molecularWeight: Math.round(mw * 100) / 100,
    isoelectricPoint: Math.round(pI * 100) / 100,
    extinctionCoeff: Math.round(extCoeffCys),
    aromaticity: Math.round(aromaticity * 1000) / 1000,
    instability: Math.round(instability * 100) / 100,
    gravy: Math.round(gravy * 1000) / 1000,
    charge: Math.round(charge * 100) / 100,
  };
}

// ──────────────────────────────── Codon Frequency ────────────────────────────────

export function calculateCodonFrequencies(dnaSeq: string): CodonFrequency[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const counts: Record<string, number> = {};
  const aaMap: Record<string, string> = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L",
    CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    ATT: "I", ATC: "I", ATA: "I",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T",
    GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K",
    GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W",
    CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    AGA: "R", AGG: "R", AGT: "S", AGC: "S",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };
  for (let i = 0; i + 2 < seq.length; i += 3) {
    const codon = seq.slice(i, i + 3);
    counts[codon] = (counts[codon] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const aaTotals: Record<string, number> = {};
  for (const [codon, cnt] of Object.entries(counts)) {
    const aa = aaMap[codon] || "X";
    aaTotals[aa] = (aaTotals[aa] || 0) + cnt;
  }
  return Object.entries(counts)
    .map(([codon, count]) => {
      const aa = aaMap[codon] || "X";
      const aaTotal = aaTotals[aa] || 1;
      return {
        codon,
        aa,
        count,
        fraction: aaTotal > 0 ? count / aaTotal : 0,
        perThousand: total > 0 ? (count / total) * 1000 : 0,
      };
    })
    .sort((a, b) => a.aa.localeCompare(b.aa) || b.fraction - a.fraction);
}

// ──────────────────────────────── Main Builder ────────────────────────────────

export function buildProteinView(
  dnaSeq: string,
  features: ProteinFeature[] = [],
  useLowercase = false
): ProteinViewData {
  const proteinSeq = useLowercase
    ? getAminoAcidStringFromSequenceString(dnaSeq, { forward: true }).toLowerCase()
    : getAminoAcidStringFromSequenceString(dnaSeq, { forward: true });

  const aminoAcidData = getAminoAcidDataForEachBaseOfDna(proteinSeq, true, undefined, true);

  return {
    sequence: proteinSeq,
    dnaSequence: dnaSeq,
    features,
    ptms: predictPTMs(proteinSeq),
    properties: calculateProteinProperties(proteinSeq),
    codonFrequencies: calculateCodonFrequencies(dnaSeq),
    aminoAcidData,
  };
}

export function formatMw(mw: number): string {
  if (mw < 1000) return `${mw.toFixed(1)} Da`;
  return `${(mw / 1000).toFixed(1)} kDa`;
}
