/**
 * SPICE Gene-Protein Lifecycle Closed-loop Integration (Feature B)
 * 
 * Establishes bidirectional tracing and coordinate mapping between 
 * nucleotide codon sequences (.spiceg) and 3D protein structures (.spicep).
 * Enables back-translating mutations with host-specific codon optimization.
 */

import { getAminoAcidStringFromSequenceString } from "../sequence";
import { BEST_CODONS, CODON_WEIGHTS, type CodonHost } from "../codon";
import { nussinovFold } from "../rnaStructure";
import * as m from "$lib/paraglide/messages.js";

export interface LifecycleTraceItem {
  codonIndex: number; // 0-indexed amino acid residue index
  codonSeq: string;   // 3bp DNA codon
  aminoAcid: string;  // 1-letter amino acid code
  dnaStart: number;   // 0-indexed DNA start coordinate
  dnaEnd: number;     // 0-indexed DNA end coordinate (inclusive)
}

/**
 * Builds a bidirectional trace coordinate map between DNA codons and translated protein residues.
 * Highly useful for highlighting specific residues in 3D when hovering over DNA features and vice versa.
 */
export function buildLifecyleTraceMap(dnaSeq: string, cdsStartIdx: number, cdsEndIdx: number): LifecycleTraceItem[] {
  const cleanDna = dnaSeq.toUpperCase().replace(/[^ATCGN]/g, "");
  const cdsSeq = cleanDna.slice(cdsStartIdx, cdsEndIdx + 1);
  const traceMap: LifecycleTraceItem[] = [];

  for (let i = 0; i + 3 <= cdsSeq.length; i += 3) {
    const codon = cdsSeq.slice(i, i + 3);
    const aa = getAminoAcidStringFromSequenceString(codon);
    traceMap.push({
      codonIndex: i / 3,
      codonSeq: codon,
      aminoAcid: aa,
      dnaStart: cdsStartIdx + i,
      dnaEnd: cdsStartIdx + i + 2,
    });
  }
  return traceMap;
}

/**
 * Back-translates a targeted protein mutation into the DNA sequence
 * utilizing host-specific optimal codon selections while preserving the open reading frame.
 */
export function applyBackMutationWithOptimization(options: {
  dnaSequence: string;
  cdsStartIdx: number;
  aaPosition: number; // 0-indexed amino acid residue position
  targetAa: string;   // 1-letter target amino acid code
  host: CodonHost;
}): { updatedDna: string; introducedCodon: string; originalCodon: string } {
  const { dnaSequence, cdsStartIdx, aaPosition, targetAa, host } = options;
  const cleanDna = dnaSequence.toUpperCase();
  const targetCodon = BEST_CODONS[host][targetAa.toUpperCase()] || BEST_CODONS[host]["*"];

  const codonStartIdx = cdsStartIdx + aaPosition * 3;
  if (codonStartIdx + 2 >= cleanDna.length) {
    throw new Error(m.lcMutPosOutOfScope());
  }

  const originalCodon = cleanDna.slice(codonStartIdx, codonStartIdx + 3);
  const prefix = cleanDna.slice(0, codonStartIdx);
  const suffix = cleanDna.slice(codonStartIdx + 3);

  return {
    updatedDna: prefix + targetCodon + suffix,
    introducedCodon: targetCodon,
    originalCodon
  };
}

/**
 * Computes the exact modified nucleotide range between an old sequence and a new sequence.
 * This supports the "History Highlighting" feature (Feature 5) automatically.
 */
export function calculateSequenceDiff(oldSeq: string, newSeq: string): { start: number; end: number }[] {
  if (!oldSeq || !newSeq || oldSeq === newSeq) return [];

  const oLen = oldSeq.length;
  const nLen = newSeq.length;

  // Find first mismatch from left
  let start = 0;
  while (start < oLen && start < nLen && oldSeq[start] === newSeq[start]) {
    start++;
  }

  // Find last mismatch from right
  let oEnd = oLen - 1;
  let nEnd = nLen - 1;
  while (oEnd >= start && nEnd >= start && oldSeq[oEnd] === newSeq[nEnd]) {
    oEnd--;
    nEnd--;
  }

  // Return 1-based inclusive range
  return [{
    start: start + 1,
    end: Math.max(start + 1, nEnd + 1)
  }];
}

// ──────────────────────────────── 14: Codon Harmonization ────────────────────────────────

/**
 * Codon Harmonization: Matches the translation speed (codon frequency profile) of the target
 * host to the original host, allowing the protein to fold correctly co-translationally.
 */
export function codonHarmonization(options: {
  dnaSeq: string;
  originalHost: CodonHost;
  targetHost: CodonHost;
  cdsStartIdx: number;
  cdsEndIdx: number;
}): { harmonizedDna: string; logs: string[] } {
  const { dnaSeq, originalHost, targetHost, cdsStartIdx, cdsEndIdx } = options;
  const cleanDna = dnaSeq.toUpperCase();
  const cdsSeq = cleanDna.slice(cdsStartIdx, cdsEndIdx + 1);
  const logs: string[] = [];

  const originalDb = CODON_WEIGHTS[originalHost];
  const targetDb = CODON_WEIGHTS[targetHost];

  let harmonizedCds = "";

  for (let i = 0; i + 3 <= cdsSeq.length; i += 3) {
    const codon = cdsSeq.slice(i, i + 3);
    const aa = getAminoAcidStringFromSequenceString(codon);

    if (aa === "X" || !originalDb[aa] || !targetDb[aa]) {
      harmonizedCds += codon; // Keep unchanged if unrecognized
      continue;
    }

    // 1. Find relative adaptiveness in original host
    const origFraction = originalDb[aa][codon] ?? 0.1;

    // 2. Find target host codon with closest adaptiveness (harmonized translation speed!)
    const synonymousCodons = Object.keys(targetDb[aa]);
    let bestCodon = synonymousCodons[0];
    let minDiff = Infinity;

    for (const cand of synonymousCodons) {
      const candFraction = targetDb[aa][cand];
      const diff = Math.abs(candFraction - origFraction);
      if (diff < minDiff) {
        minDiff = diff;
        bestCodon = cand;
      }
    }

    harmonizedCds += bestCodon;
    if (bestCodon !== codon) {
      logs.push(`Residue ${aa}${(i/3)+1}: ${codon} (fraction ${origFraction.toFixed(2)} in ${originalHost}) ➔ ${bestCodon} (fraction ${(targetDb[aa][bestCodon]).toFixed(2)} in ${targetHost})`);
    }
  }

  const prefix = cleanDna.slice(0, cdsStartIdx);
  const suffix = cleanDna.slice(cdsEndIdx + 1);

  return {
    harmonizedDna: prefix + harmonizedCds + suffix,
    logs
  };
}

// ──────────────────────────────── 15: mRNA 5' End Secondary Structure Optimization ────────────────────────────────

/**
 * Optimizes the mRNA 5' end secondary structure around the start codon.
 * Introduces synonymous mutations in the first 5 codons to minimize base pairing (maximize MFE/dG).
 */
export function optimizeMrna5PrimeFolding(options: {
  dnaSeq: string;
  cdsStartIdx: number;
  host: CodonHost;
}): { optimizedDna: string; originalPairs: number; optimizedPairs: number; dGDelta: number } {
  const { dnaSeq, cdsStartIdx, host } = options;
  const cleanDna = dnaSeq.toUpperCase();

  // We grab the 5' region: -15bp upstream of ATG to +15bp downstream (total 30bp window)
  const windowStart = Math.max(0, cdsStartIdx - 15);
  const windowEnd = Math.min(cleanDna.length, cdsStartIdx + 15);
  const originalWindow = cleanDna.slice(windowStart, windowEnd);

  // Fold original window
  const originalFold = nussinovFold(originalWindow, true);
  const originalPairs = originalFold.pairs.length;

  // Let's introduce synonymous mutations in the first 3 codons (9 bp starting at cdsStartIdx)
  // to search for a sequence that has the MINIMUM number of base pairs (i.e. most open structure)
  const codonsToMutate = 3;
  const targetStart = cdsStartIdx;
  const targetEnd = cdsStartIdx + codonsToMutate * 3;

  if (targetEnd > cleanDna.length) {
    return { optimizedDna: dnaSeq, originalPairs, optimizedPairs: originalPairs, dGDelta: 0 };
  }

  const targetCdsPart = cleanDna.slice(targetStart, targetEnd);
  const aas: string[] = [];
  for (let i = 0; i < codonsToMutate; i++) {
    aas.push(getAminoAcidStringFromSequenceString(targetCdsPart.slice(i * 3, (i + 1) * 3)));
  }

  // Generate all synonymous codon combinations for these amino acids
  const targetDb = CODON_WEIGHTS[host];
  const combinations: string[][] = [[]];

  for (const aa of aas) {
    const synonymous = Object.keys(targetDb[aa] || {});
    const nextCombos: string[][] = [];
    for (const curr of combinations) {
      for (const syn of synonymous) {
        nextCombos.push([...curr, syn]);
      }
    }
    combinations.length = 0;
    combinations.push(...nextCombos);
  }

  // Evaluate combinations
  let bestSequence = targetCdsPart;
  let minPairs = originalPairs;

  for (const combo of combinations) {
    const mutantCdsPart = combo.join("");
    const mutantFull = cleanDna.slice(0, targetStart) + mutantCdsPart + cleanDna.slice(targetEnd);
    const mutantWindow = mutantFull.slice(windowStart, windowEnd);
    
    const foldResult = nussinovFold(mutantWindow, true);
    if (foldResult.pairs.length < minPairs) {
      minPairs = foldResult.pairs.length;
      bestSequence = mutantCdsPart;
    }
  }

  const optimizedDna = cleanDna.slice(0, targetStart) + bestSequence + cleanDna.slice(targetEnd);
  const dGDelta = (originalPairs - minPairs) * -1.2; // approx -1.2 kcal/mol per base pair disrupted

  return {
    optimizedDna,
    originalPairs,
    optimizedPairs: minPairs,
    dGDelta: Number(dGDelta.toFixed(1))
  };
}
