/**
 * SPICE Synthetic Gene Quality Control Module (Features 1-6)
 * 
 * Provides rigorous mammalian expression pre-checks:
 * 1. Cryptic splice site detection and silent elimination
 * 2. Cryptic polyadenylation signal scanning and silent removal
 * 3. Kozak translation initiation strength analysis and optimization
 * 4. Premature termination codon (PTC) detection for NMD prevention
 * 5. Codon Pair Bias (CPB) scoring and optimization
 * 6. Low-complexity sequence detection and masking (DUST-style)
 */

import { getAminoAcidStringFromSequenceString } from "../sequence";
import * as m from "$lib/paraglide/messages.js";

// Synonymous codon map for silent mutation design
const CODON_TO_AA: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S", AGT: "S", AGC: "S", CCT: "P", CCC: "P",
  CCA: "P", CCG: "P", ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A",
  GCA: "A", GCG: "A", TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", TGA: "*", CAT: "H",
  CAC: "H", CAA: "Q", CAG: "Q", AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D",
  GAC: "D", GAA: "E", GAG: "E", TGT: "C", TGC: "C", TGG: "W", CGT: "R", CGC: "R",
  CGA: "R", CGG: "R", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G"
};

const AA_TO_CODONS: Record<string, string[]> = {};
for (const [codon, aa] of Object.entries(CODON_TO_AA)) {
  if (!AA_TO_CODONS[aa]) AA_TO_CODONS[aa] = [];
  AA_TO_CODONS[aa].push(codon);
}

// ──────────────────────────────── 1: Cryptic splice site detection & removal ────────────────────────────────

export interface SpliceSite {
  type: "donor" | "acceptor";
  position: number; // 0-based coordinate
  sequence: string;
  score: number; // 0-100% confidence estimate
}

/**
 * Scans a CDS sequence for mammalian consensus splice sites.
 * Donor consensus: MAG|GTRAGT (M=A/C, R=A/G)
 * Acceptor consensus: [C/T]11NYAG|G (Y=C/T)
 */
export function detectCrypticSpliceSites(cds: string): SpliceSite[] {
  const seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const sites: SpliceSite[] = [];
  
  // 1. Scan for Donor Sites: [A/C]AG GT [A/G]AGT
  // Let's use sliding window to score matches against standard PWM
  for (let i = 3; i < seq.length - 6; i++) {
    const sub = seq.slice(i - 3, i + 6); // 9bp window, splice is between pos 3 and 4
    if (seq.slice(i, i + 2) === "GT") {
      let score = 0;
      // Pos -3: A or C
      if (sub[0] === "A" || sub[0] === "C") score += 10;
      // Pos -2: A
      if (sub[1] === "A") score += 15;
      // Pos -1: G
      if (sub[2] === "G") score += 20;
      // Pos +1, +2: GT (mandatory)
      score += 25;
      // Pos +3: A or G
      if (sub[5] === "A" || sub[5] === "G") score += 15;
      // Pos +4: A
      if (sub[6] === "A") score += 5;
      // Pos +5: G
      if (sub[7] === "G") score += 5;
      // Pos +6: T
      if (sub[8] === "T") score += 5;

      if (score >= 60) {
        sites.push({
          type: "donor",
          position: i,
          sequence: sub,
          score
        });
      }
    }
  }

  // 2. Scan for Acceptor Sites: C/T rich region followed by N CAG/TAG G
  for (let i = 15; i < seq.length - 1; i++) {
    if (seq.slice(i - 2, i) === "AG") {
      const upstream = seq.slice(i - 15, i - 2); // 13bp polypyrimidine tract
      let ctCount = 0;
      for (const b of upstream) {
        if (b === "C" || b === "T") ctCount++;
      }
      
      let score = Math.round((ctCount / 13) * 50); // Up to 50% from polypyrimidine tract
      
      // AG presence
      score += 30;
      
      // Preferred base before AG is usually C or T (Y)
      if (seq[i - 3] === "C" || seq[i - 3] === "T") score += 10;
      // Base after AG is G
      if (seq[i] === "G") score += 10;

      if (score >= 65) {
        sites.push({
          type: "acceptor",
          position: i - 2,
          sequence: seq.slice(i - 15, i + 2),
          score
        });
      }
    }
  }

  return sites;
}

/**
 * Eliminates cryptic splice sites by introducing silent mutations in codons.
 */
export function eliminateCrypticSpliceSites(cds: string): {
  modifiedSequence: string;
  mutationsCount: number;
  log: string[];
} {
  let seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const log: string[] = [];
  let mutationsCount = 0;

  // Run iteratively up to 5 times (to handle overlapping situations)
  for (let iter = 0; iter < 5; iter++) {
    const sites = detectCrypticSpliceSites(seq);
    if (sites.length === 0) break;

    let changedThisIter = false;
    for (const site of sites) {
      // Find codons covering the core motif (GT or AG)
      // To perform a silent mutation, we must respect the reading frame. Let's assume frame is 0.
      const pos = site.position; // position of 'G' in 'GT' or 'A' in 'AG'
      
      // Mutate the codons that overlap this region
      const codonStart1 = Math.floor(pos / 3) * 3;
      const codonStart2 = Math.floor((pos + 1) / 3) * 3;
      
      const starts = Array.from(new Set([codonStart1, codonStart2])).sort();

      for (const start of starts) {
        if (start + 3 > seq.length) continue;
        const currentCodon = seq.slice(start, start + 3);
        const aa = CODON_TO_AA[currentCodon];
        if (!aa) continue;

        const synonyms = AA_TO_CODONS[aa].filter(c => c !== currentCodon);
        if (synonyms.length > 0) {
          // Find a synonym that breaks the GT or AG consensus
          for (const syn of synonyms) {
            const tempSeq = seq.slice(0, start) + syn + seq.slice(start + 3);
            const remainingSites = detectCrypticSpliceSites(tempSeq);
            // If the sites at this position are gone, accept it!
            const stillHasSite = remainingSites.some(s => Math.abs(s.position - pos) <= 5);
            if (!stillHasSite) {
              seq = tempSeq;
              log.push(site.type === "donor"
                ? m.sgqSpliceFixedDonor({ v1: start + 1, v2: currentCodon, v3: syn, v4: pos + 1 })
                : m.sgqSpliceFixedAcceptor({ v1: start + 1, v2: currentCodon, v3: syn, v4: pos + 1 }));
              mutationsCount++;
              changedThisIter = true;
              break;
            }
          }
        }
        if (changedThisIter) break;
      }
      if (changedThisIter) break; // Re-detect after change
    }
    if (!changedThisIter) {
      log.push(m.sgqSpliceFail());
      break;
    }
  }

  return { modifiedSequence: seq, mutationsCount, log };
}

// ──────────────────────────────── 2: Cryptic polyA signal detection & removal ────────────────────────────────

const POLYA_SIGNALS = [
  "AATAAA", "ATTAAA", "TATAAA", "AGTAAA", "AAGAAA", "AATACA",
  "CATAAA", "GATAAA", "AATATA", "AATGAA", "ACTAAA", "AATAGA"
];

export interface PolyASignalMatch {
  signal: string;
  position: number; // 0-based
}

/**
 * Scans CDS sequence for polyadenylation signals (like AATAAA).
 */
export function detectCrypticPolyASignals(cds: string): PolyASignalMatch[] {
  const seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const found: PolyASignalMatch[] = [];

  for (const signal of POLYA_SIGNALS) {
    let pos = seq.indexOf(signal);
    while (pos !== -1) {
      if (!found.some(f => f.position === pos)) {
        found.push({ signal, position: pos });
      }
      pos = seq.indexOf(signal, pos + 1);
    }
  }

  return found.sort((a, b) => a.position - b.position);
}

/**
 * Eliminates polyadenylation signals by introducing silent mutations.
 */
export function eliminateCrypticPolyASignals(cds: string): {
  modifiedSequence: string;
  mutationsCount: number;
  log: string[];
} {
  let seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const log: string[] = [];
  let mutationsCount = 0;

  for (let iter = 0; iter < 10; iter++) {
    const signals = detectCrypticPolyASignals(seq);
    if (signals.length === 0) break;

    let changedThisIter = false;
    for (const sig of signals) {
      const pos = sig.position;
      // Mutate codons spanning the 6bp signal window
      const codonStarts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const start = Math.floor((pos + i) / 3) * 3;
        if (!codonStarts.includes(start)) codonStarts.push(start);
      }

      for (const start of codonStarts) {
        if (start + 3 > seq.length) continue;
        const currentCodon = seq.slice(start, start + 3);
        const aa = CODON_TO_AA[currentCodon];
        if (!aa) continue;

        const synonyms = AA_TO_CODONS[aa].filter(c => c !== currentCodon);
        for (const syn of synonyms) {
          const tempSeq = seq.slice(0, start) + syn + seq.slice(start + 3);
          const remaining = detectCrypticPolyASignals(tempSeq);
          const stillHasSignal = remaining.some(s => Math.abs(s.position - pos) <= 5);
          if (!stillHasSignal) {
            seq = tempSeq;
            log.push(m.sgqPolyAFixed({ v1: start + 1, v2: currentCodon, v3: syn, v4: sig.signal }));
            mutationsCount++;
            changedThisIter = true;
            break;
          }
        }
        if (changedThisIter) break;
      }
      if (changedThisIter) break;
    }
    if (!changedThisIter) {
      log.push(m.sgqPolyAFail({ v1: signals[0].position + 1 }));
      break;
    }
  }

  return { modifiedSequence: seq, mutationsCount, log };
}

// ──────────────────────────────── 3: Kozak sequence analysis & optimization ────────────────────────────────

export interface KozakAnalysis {
  upstreamSeq: string; // 6bp before ATG
  startCodon: string; // ATG
  downstreamSeq: string; // 3bp after ATG (first codon after Met)
  score: number; // 0-100
  strength: "Strong" | "Adequate" | "Weak";
  recommendations: string[];
}

/**
 * Evaluates Kozak strength relative to consensus GCCRCCATGG.
 * @param dnaSeq full sequence containing ATG (or starting at ATG)
 * @param startIdx index of ATG start codon
 */
export function analyzeKozak(dnaSeq: string, startIdx: number): KozakAnalysis {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const recommendations: string[] = [];

  // Extract up to 6bp upstream and 3bp downstream of ATG
  const upStart = Math.max(0, startIdx - 6);
  const upstreamSeq = seq.slice(upStart, startIdx).padStart(6, "N");
  const startCodon = seq.slice(startIdx, startIdx + 3);
  const downstreamSeq = seq.slice(startIdx + 3, startIdx + 6).padEnd(3, "N");

  if (startCodon !== "ATG") {
    return {
      upstreamSeq,
      startCodon,
      downstreamSeq,
      score: 0,
      strength: "Weak",
      recommendations: [m.sgqKozakNoAtg()]
    };
  }

  // Consensus GCC [A/G] CC ATG G
  // Position -3 (index 3 in upstreamSeq 'N' padded) is most important, then +4 (index 0 in downstreamSeq)
  const baseMinus3 = upstreamSeq[3];
  const basePlus4 = downstreamSeq[0];

  let score = 0;
  // Weight major determinants
  if (baseMinus3 === "A") score += 40;
  else if (baseMinus3 === "G") score += 30;

  if (basePlus4 === "G") score += 30;

  // Weight minor determinants
  if (upstreamSeq[0] === "G") score += 6; // -6
  if (upstreamSeq[1] === "C") score += 6; // -5
  if (upstreamSeq[2] === "C") score += 6; // -4
  if (upstreamSeq[4] === "C") score += 6; // -2
  if (upstreamSeq[5] === "C") score += 6; // -1

  let strength: "Strong" | "Adequate" | "Weak" = "Weak";
  if (score >= 80) strength = "Strong";
  else if (score >= 50) strength = "Adequate";

  if (baseMinus3 !== "A" && baseMinus3 !== "G") {
    recommendations.push(m.sgqKozakSugMinus3());
  }
  if (basePlus4 !== "G") {
    recommendations.push(m.sgqKozakSugPlus4());
  }
  if (strength === "Weak") {
    recommendations.push(m.sgqKozakWeak());
  }

  return {
    upstreamSeq,
    startCodon,
    downstreamSeq,
    score,
    strength,
    recommendations
  };
}

/**
 * Optimizes Kozak sequence to GCCACCATGG
 */
export function optimizeKozak(dnaSeq: string, startIdx: number): {
  optimizedSequence: string;
  log: string[];
} {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  if (startIdx < 6 || startIdx + 6 > seq.length) {
    return { optimizedSequence: dnaSeq, log: [m.sgqKozakOutOfRange()] };
  }

  const log: string[] = [];
  const seqArr = seq.split("");

  // Consensus GCCACC ATG G...
  // 1. Mutate upstream bases safely (-6 to -1)
  const optimalUpstream = "GCCACC";
  for (let i = 0; i < 6; i++) {
    const idx = startIdx - 6 + i;
    if (seqArr[idx] !== optimalUpstream[i]) {
      log.push(m.sgqKozakUpstream({ v1: 6 - i, v2: seqArr[idx], v3: optimalUpstream[i] }));
      seqArr[idx] = optimalUpstream[i];
    }
  }

  // 2. Mutate downstream +4 position silently if possible
  // Codon immediately following ATG starts at startIdx + 3
  const nextCodon = seq.slice(startIdx + 3, startIdx + 6);
  if (nextCodon.length === 3) {
    const aa = CODON_TO_AA[nextCodon];
    if (aa) {
      // Find a synonym starting with 'G' (optimal +4)
      const synonyms = AA_TO_CODONS[aa] || [];
      const bestSyn = synonyms.find(s => s[0] === "G");
      if (bestSyn && bestSyn !== nextCodon) {
        seqArr[startIdx + 3] = bestSyn[0];
        seqArr[startIdx + 4] = bestSyn[1];
        seqArr[startIdx + 5] = bestSyn[2];
        log.push(m.sgqKozakSilent({ v1: nextCodon, v2: bestSyn, v3: aa }));
      } else if (nextCodon[0] !== "G") {
        log.push(m.sgqKozakHint({ v1: aa }));
      }
    }
  }

  return { optimizedSequence: seqArr.join(""), log };
}

// ──────────────────────────────── 4: Premature stop codon detection ────────────────────────────────

export interface PrematureStopCodon {
  codon: string;
  position: number; // 0-based coordinate of start of codon
  aaPosition: number; // 1-based index
  triggerNmd: boolean; // Triggers nonsense-mediated decay
}

/**
 * Scans CDS for stop codons before the very last codon.
 */
export function detectPrematureStopCodons(cds: string): {
  hasPtc: boolean;
  stops: PrematureStopCodon[];
  cleanCdsLength: number;
} {
  const seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const stops: PrematureStopCodon[] = [];
  const cleanCdsLength = Math.floor(seq.length / 3) * 3;

  for (let i = 0; i < cleanCdsLength - 3; i += 3) {
    const codon = seq.slice(i, i + 3);
    if (codon === "TAA" || codon === "TAG" || codon === "TGA") {
      // Eukaryotic NMD is typically triggered if the stop codon is more than 50-55 nucleotides upstream
      // of the final exon junction, or generally if it's a PTC far from the natural C-terminus.
      const ntRemaining = cleanCdsLength - i;
      const triggerNmd = ntRemaining > 50; 

      stops.push({
        codon,
        position: i,
        aaPosition: Math.floor(i / 3) + 1,
        triggerNmd
      });
    }
  }

  return {
    hasPtc: stops.length > 0,
    stops,
    cleanCdsLength
  };
}

// ──────────────────────────────── 5: Codon pair optimization ────────────────────────────────

// Simulated Codon Pair Score database (CPS scale based on human/mammalian preferences)
// Negative scores represent ribosome-stalling pairs; positive scores are optimal.
const CODON_PAIR_SCORES: Record<string, number> = {
  "GCC_GAA": 0.25, "GAA_GCC": 0.22, "CGC_CGA": -1.45, "CGC_CGG": -1.32,
  "CGG_CGC": -1.25, "CGA_CGC": -1.38, "AAA_AAA": 0.18, "AAA_GAA": 0.20,
  "CCG_CCG": -0.95, "CCG_CCG_C": -0.8, "CTA_CUA": -0.85, "ATT_ATA": -0.65
};

function getCodonPairScore(c1: string, c2: string): number {
  const key = `${c1}_${c2}`;
  if (key in CODON_PAIR_SCORES) return CODON_PAIR_SCORES[key];
  // Default values based on single codon GC values
  if (c1.includes("CG") || c2.includes("CG")) return -0.15; // CG dinucleotides are slightly repressed
  return 0.02;
}

/**
 * Calculates Codon Pair Bias (CPB) index.
 * CPB = Sum(CPS_i) / (N - 1)
 */
export function calculateCpbScore(cds: string): number {
  const seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const len = Math.floor(seq.length / 3) * 3;
  if (len < 6) return 0;

  let totalScore = 0;
  let pairsCount = 0;

  for (let i = 0; i < len - 5; i += 3) {
    const c1 = seq.slice(i, i + 3);
    const c2 = seq.slice(i + 3, i + 6);
    totalScore += getCodonPairScore(c1, c2);
    pairsCount++;
  }

  return Number((totalScore / Math.max(1, pairsCount)).toFixed(4));
}

/**
 * Optimizes Codon Pair Bias silently without changing protein sequence.
 */
export function optimizeCodonPairs(cds: string): {
  optimizedSequence: string;
  originalCpb: number;
  optimizedCpb: number;
  log: string[];
} {
  const seq = cds.toUpperCase().replace(/[^ATCG]/g, "");
  const len = Math.floor(seq.length / 3) * 3;
  const originalCpb = calculateCpbScore(seq);
  const log: string[] = [];

  const codons: string[] = [];
  for (let i = 0; i < len; i += 3) {
    codons.push(seq.slice(i, i + 3));
  }

  let optimizeCount = 0;
  // Optimize by sliding window
  for (let i = 0; i < codons.length - 1; i++) {
    const c1 = codons[i];
    const c2 = codons[i + 1];
    const currentScore = getCodonPairScore(c1, c2);

    if (currentScore < 0) { // If stalling or poor pair
      const aa1 = CODON_TO_AA[c1];
      const aa2 = CODON_TO_AA[c2];
      if (!aa1 || !aa2) continue;

      const synonyms1 = AA_TO_CODONS[aa1] || [];
      const synonyms2 = AA_TO_CODONS[aa2] || [];

      let bestScore = currentScore;
      let bestPair = [c1, c2];

      for (const s1 of synonyms1) {
        for (const s2 of synonyms2) {
          const score = getCodonPairScore(s1, s2);
          if (score > bestScore) {
            bestScore = score;
            bestPair = [s1, s2];
          }
        }
      }

      if (bestPair[0] !== c1 || bestPair[1] !== c2) {
        log.push(m.sgqCodonPairSwap({ v1: aa1, v2: aa2, v3: c1, v4: c2, v5: bestPair[0], v6: bestPair[1] }));
        codons[i] = bestPair[0];
        codons[i + 1] = bestPair[1];
        optimizeCount++;
      }
    }
  }

  const optimizedSequence = codons.join("") + seq.slice(len);
  const optimizedCpb = calculateCpbScore(optimizedSequence);

  log.unshift(m.sgqCodonPairSummary({ v1: optimizeCount, v2: originalCpb, v3: optimizedCpb }));

  return {
    optimizedSequence,
    originalCpb,
    optimizedCpb,
    log
  };
}

// ──────────────────────────────── 6: Low complexity region detection & masking ────────────────────────────────

export interface LowComplexityRegion {
  start: number;
  end: number;
  sequence: string;
  entropy: number; // Shannon entropy (0 to 2)
  type: "homopolymer" | "dinucleotide_repeat" | "low_entropy";
}

/**
 * Shannon entropy of a DNA sequence slice.
 */
export function calculateShannonEntropy(seq: string): number {
  const counts: Record<string, number> = {};
  for (const b of seq) counts[b] = (counts[b] || 0) + 1;
  let entropy = 0;
  for (const c of Object.values(counts)) {
    const p = c / seq.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Detects low-complexity regions (DUST-style) such as homopolymers or micro-repeats.
 */
export function detectLowComplexityRegions(
  dnaSeq: string,
  windowSize = 12,
  entropyThreshold = 1.2
): LowComplexityRegion[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const regions: LowComplexityRegion[] = [];

  // 1. Scan for homopolymers (e.g. AAAAAAAA >= 8bp)
  const homopolymerRegex = /([A|T|C|G])\1{7,}/g;
  let match: RegExpExecArray | null;
  while ((match = homopolymerRegex.exec(seq)) !== null) {
    regions.push({
      start: match.index,
      end: match.index + match[0].length - 1,
      sequence: match[0],
      entropy: calculateShannonEntropy(match[0]),
      type: "homopolymer"
    });
  }

  // 2. Sliding window entropy check
  for (let i = 0; i <= seq.length - windowSize; i += 3) {
    const sub = seq.slice(i, i + windowSize);
    const entropy = calculateShannonEntropy(sub);

    if (entropy < entropyThreshold) {
      // Check if it's already overlapping with homopolymer
      const isOverlapped = regions.some(r => i >= r.start && i + windowSize - 1 <= r.end);
      if (!isOverlapped) {
        // Detect dinucleotide repeats (e.g., ATATATATAT)
        const diRepeat = /([ATCG]{2})\1{3,}/g;
        const isDiRepeat = diRepeat.test(sub);

        regions.push({
          start: i,
          end: i + windowSize - 1,
          sequence: sub,
          entropy: Number(entropy.toFixed(3)),
          type: isDiRepeat ? "dinucleotide_repeat" : "low_entropy"
        });
      }
    }
  }

  // Merge nearby / overlapping regions
  const merged: LowComplexityRegion[] = [];
  const sorted = regions.sort((a, b) => a.start - b.start);

  for (const reg of sorted) {
    if (merged.length === 0) {
      merged.push(reg);
    } else {
      const last = merged[merged.length - 1];
      if (reg.start <= last.end + 3) { // merge if overlaps or very close
        last.end = Math.max(last.end, reg.end);
        last.sequence = seq.slice(last.start, last.end + 1);
        last.entropy = Number(calculateShannonEntropy(last.sequence).toFixed(3));
        if (last.type !== reg.type) last.type = "low_entropy";
      } else {
        merged.push(reg);
      }
    }
  }

  return merged;
}

/**
 * Masks low-complexity regions using lowercase bases.
 */
export function maskLowComplexityRegions(dnaSeq: string): {
  maskedSequence: string;
  regions: LowComplexityRegion[];
} {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const regions = detectLowComplexityRegions(seq);
  const arr = seq.split("");

  for (const reg of regions) {
    for (let i = reg.start; i <= reg.end; i++) {
      arr[i] = arr[i].toLowerCase();
    }
  }

  return {
    maskedSequence: arr.join(""),
    regions
  };
}
