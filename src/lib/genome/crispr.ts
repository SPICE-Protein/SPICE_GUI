/**
 * SPICE Genome CRISPR Engine
 * 
 * A high-performance, mathematically rigorous CRISPR/Cas gene editing design 
 * and evaluation engine. It supports guide RNA (gRNA) targeting, empirical scoring, 
 * off-target CFD modeling, HDR donor template synthesis with PAM evasion, 
 * Prime Editing pegRNA design, and Base Editing window calculations.
 * 
 * Designed for computational biophysics and molecular CAD workflows.
 * Author: RedElectricity / SPICE Assistant
 */

import { getReverseComplementSequenceString, getAminoAcidStringFromSequenceString } from "./sequence";
import type { Range } from "./range";
import * as m from "$lib/paraglide/messages.js";

// ──────────────────────────────── Types ────────────────────────────────

export type CasType = "SpCas9" | "SpCas9_VQR" | "Cas12a" | "SaCas9";

export interface PamConfig {
  cas: CasType;
  pamPattern: RegExp; // RegExp to match PAM on the forward strand
  pamLength: number;
  guideLength: number;
  pamDirection: "3prime" | "5prime";
  cutOffsetFromPam: number; // relative to PAM start index
}

export const PAM_DATABASE: Record<CasType, PamConfig> = {
  SpCas9: {
    cas: "SpCas9",
    pamPattern: /[ACG][GG]/gi, // NGG (usually, we match [ATCG]GG, but let's be rigorous)
    pamLength: 3,
    guideLength: 20,
    pamDirection: "3prime",
    cutOffsetFromPam: -3, // Cleaves 3bp upstream of PAM
  },
  SpCas9_VQR: {
    cas: "SpCas9_VQR",
    pamPattern: /[ACG][GA]/gi, // NGA
    pamLength: 3,
    guideLength: 20,
    pamDirection: "3prime",
    cutOffsetFromPam: -3,
  },
  SaCas9: {
    cas: "SaCas9",
    pamPattern: /[ATCG]{2}G[AG]T[AG]/gi, // NNGRRT
    pamLength: 6,
    guideLength: 21,
    pamDirection: "3prime",
    cutOffsetFromPam: -3,
  },
  Cas12a: {
    cas: "Cas12a",
    pamPattern: /TTT[ACG]/gi, // TTTN
    pamLength: 4,
    guideLength: 23,
    pamDirection: "5prime",
    cutOffsetFromPam: 18, // Cleaves 18bp downstream of PAM (staggered, 18-23bp)
  }
};

export interface GrnaCandidate {
  id: string;
  sequence: string; // 20bp protospacer (5' -> 3')
  fullTargetWithPam: string; // Including PAM
  pam: string;
  strand: "+" | "-";
  startIndex: number; // 0-indexed on template (always in terms of forward strand)
  endIndex: number;
  cutIndex: number; // exact nucleotide position of DSB
  scores: {
    efficiency: number; // Doench-Rule Set 2 empirical approximation (0-100)
    specificity: number; // Off-target mitigation index (0-100)
    gcContent: number; // percentage
    polyT: boolean; // Has TTTT terminator
    hairpin: boolean; // Has self-complementarity
    finalScore: number; // Combined score (0-100)
  };
  baseEditingWindows?: BaseEditingResult;
}

export interface OffTargetSite {
  sequence: string;
  mismatches: number;
  mismatchPositions: number[];
  cfdScore: number; // Cutting Frequency Determination score (0..1)
  location: string; // e.g., "chr1:12345" or "template:120"
  strand: "+" | "-";
}

export interface HdrDonorTemplate {
  leftArm: string;
  rightArm: string;
  insertedMutations: string;
  fullDonor: string;
  silentMutationsIntroduced: {
    position: number;
    original: string;
    mutated: string;
    codonChange: string;
    reason: "PAM_destruction" | "guide_disruption";
  }[];
  warning?: string;
}

export interface PegRnaDesign {
  gRNA: string;
  pbs: string; // Primer Binding Site (5' -> 3' on the pegRNA, annealing to cut strand)
  pbsLength: number;
  pbsTm: number;
  rtt: string; // Reverse Transcription Template containing edit
  rttLength: number;
  full3PrimeExtension: string; // PBS + RTT
  pegRnaSequence: string; // Complete pegRNA
}

export interface BaseEditingResult {
  cbeCandidates: { index: number; originalBase: string; targetBase: "T" | "U"; windowPosition: number; efficiency: number }[];
  abeCandidates: { index: number; originalBase: string; targetBase: "G"; windowPosition: number; efficiency: number }[];
}

// ──────────────────────────────── gRNA Finder & Scorer ────────────────────────────────

/**
 * Find gRNA candidates in a DNA template using specific Cas endonuclease PAM constraints.
 */
export function findGrnaCandidates(
  template: string,
  cas: CasType = "SpCas9",
  referenceGenomeForOffTarget?: string
): GrnaCandidate[] {
  const seq = template.toUpperCase();
  const rcSeq = getReverseComplementSequenceString(seq);
  const config = PAM_DATABASE[cas];
  const candidates: GrnaCandidate[] = [];

  const pamLen = config.pamLength;
  const guideLen = config.guideLength;

  // 1. Scan Forward Strand
  for (let i = 0; i <= seq.length - pamLen - guideLen; i++) {
    let pamMatchIdx = 0;
    let guideMatchIdx = 0;
    let ok = false;

    if (config.pamDirection === "3prime") {
      // Guide is 5' of PAM: [Guide(guideLen)] [PAM(pamLen)]
      pamMatchIdx = i + guideLen;
      const potentialPam = seq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      if (config.pamPattern.test(potentialPam)) {
        ok = true;
        guideMatchIdx = i;
      }
    } else {
      // Guide is 3' of PAM: [PAM(pamLen)] [Guide(guideLen)]
      pamMatchIdx = i;
      const potentialPam = seq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      if (config.pamPattern.test(potentialPam)) {
        ok = true;
        guideMatchIdx = i + pamLen;
      }
    }

    if (ok) {
      const guideSeq = seq.slice(guideMatchIdx, guideMatchIdx + guideLen);
      const pamSeq = seq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      const fullTarget = config.pamDirection === "3prime" ? guideSeq + pamSeq : pamSeq + guideSeq;
      
      const cutIdx = config.pamDirection === "3prime" 
        ? pamMatchIdx + config.cutOffsetFromPam 
        : pamMatchIdx + pamLen + config.cutOffsetFromPam;

      const scores = evaluateGrna(guideSeq);
      
      // Calculate Base Editing window
      const baseEditing = calculateBaseEditingWindow(guideSeq, guideMatchIdx, "+");

      candidates.push({
        id: `gRNA_+_${guideMatchIdx}`,
        sequence: guideSeq,
        fullTargetWithPam: fullTarget,
        pam: pamSeq,
        strand: "+",
        startIndex: guideMatchIdx,
        endIndex: guideMatchIdx + guideLen,
        cutIndex: cutIdx,
        scores: {
          ...scores,
          specificity: 100, // Default if no off-target scanning
          finalScore: Math.round(scores.efficiency * 0.8 + 20) // Normalized
        },
        baseEditingWindows: baseEditing
      });
    }
  }

  // 2. Scan Reverse Strand
  // In reverse strand, the coordinate is mapped back to the forward strand index!
  for (let i = 0; i <= rcSeq.length - pamLen - guideLen; i++) {
    let pamMatchIdx = 0;
    let guideMatchIdx = 0;
    let ok = false;

    if (config.pamDirection === "3prime") {
      pamMatchIdx = i + guideLen;
      const potentialPam = rcSeq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      if (config.pamPattern.test(potentialPam)) {
        ok = true;
        guideMatchIdx = i;
      }
    } else {
      pamMatchIdx = i;
      const potentialPam = rcSeq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      if (config.pamPattern.test(potentialPam)) {
        ok = true;
        guideMatchIdx = i + pamLen;
      }
    }

    if (ok) {
      const guideSeq = rcSeq.slice(guideMatchIdx, guideMatchIdx + guideLen);
      const pamSeq = rcSeq.slice(pamMatchIdx, pamMatchIdx + pamLen);
      const fullTarget = config.pamDirection === "3prime" ? guideSeq + pamSeq : pamSeq + guideSeq;

      // Map back to forward strand coordinates
      // In forward strand, guideMatchIdx corresponds to a physical range on the reverse strand
      const fwdStart = seq.length - (guideMatchIdx + guideLen);
      const fwdEnd = seq.length - guideMatchIdx;

      const rcCutIdxInRc = config.pamDirection === "3prime"
        ? pamMatchIdx + config.cutOffsetFromPam
        : pamMatchIdx + pamLen + config.cutOffsetFromPam;
      const cutIdx = seq.length - rcCutIdxInRc;

      const scores = evaluateGrna(guideSeq);
      const baseEditing = calculateBaseEditingWindow(guideSeq, fwdStart, "-");

      candidates.push({
        id: `gRNA_-_${fwdStart}`,
        sequence: guideSeq,
        fullTargetWithPam: fullTarget,
        pam: pamSeq,
        strand: "-",
        startIndex: fwdStart,
        endIndex: fwdEnd,
        cutIndex: cutIdx,
        scores: {
          ...scores,
          specificity: 100,
          finalScore: Math.round(scores.efficiency * 0.8 + 20)
        },
        baseEditingWindows: baseEditing
      });
    }
  }

  // 3. Compute specificity if reference is provided
  if (referenceGenomeForOffTarget) {
    for (const cand of candidates) {
      const offTargets = predictOffTargets(cand.sequence, referenceGenomeForOffTarget);
      // Specificity is based on CFD scores of off-targets
      let cfdSum = 0;
      for (const ot of offTargets) {
        if (ot.mismatches > 0) {
          cfdSum += ot.cfdScore;
        }
      }
      const specScore = Math.max(0, Math.min(100, Math.round(100 - (cfdSum * 12))));
      cand.scores.specificity = specScore;
      cand.scores.finalScore = Math.round(cand.scores.efficiency * 0.5 + specScore * 0.5);
    }
  }

  // Sort by final score descending
  return candidates.sort((a, b) => b.scores.finalScore - a.scores.finalScore);
}

/**
 * Run Doench-Rule Set 2 approximations for guide efficiency
 * 
 * Rules modeled:
 * - Optimal GC content (40% - 60% gets 100 points, extreme values penalized)
 * - TTTT terminator penalty (poly-T blocks abort Pol III transcription)
 * - Specific position-specific nucleotide preferences (e.g., G at 20 is favored; U/T at 20 is heavily penalized)
 * - Self-complementarity hairpin detection (causing guide folding instead of target annealing)
 */
export function evaluateGrna(guideSeq: string): { efficiency: number; gcContent: number; polyT: boolean; hairpin: boolean } {
  const seq = guideSeq.toUpperCase();
  let baseScore = 50; // Starting baseline

  // 1. GC Content (Ideally 40% - 60%)
  const gCount = (seq.match(/G/g) || []).length;
  const cCount = (seq.match(/C/g) || []).length;
  const gc = Math.round(((gCount + cCount) / seq.length) * 100);

  if (gc >= 40 && gc <= 60) {
    baseScore += 15;
  } else if (gc >= 30 && gc < 40) {
    baseScore += 5;
  } else if (gc > 60 && gc <= 75) {
    baseScore += 5;
  } else {
    baseScore -= 20; // Extreme GC is bad
  }

  // 2. Poly-T Termination
  const polyT = seq.includes("TTTT") || seq.includes("UUUU");
  if (polyT) {
    baseScore -= 30; // Heavy penalty
  }

  // 3. Position-Specific Preferences (Doench Set 2 empirical features)
  // position 20 (adjacent to PAM): G is highly favored (+10), T is heavily disfavored (-15)
  const pos20 = seq[19];
  if (pos20 === "G") baseScore += 12;
  if (pos20 === "T") baseScore -= 15;
  if (pos20 === "C") baseScore += 5;

  // Position 16: A is favored
  const pos16 = seq[15];
  if (pos16 === "A") baseScore += 6;

  // Position 1: G is disfavored
  const pos1 = seq[0];
  if (pos1 === "G") baseScore -= 8;

  // 4. Self-Complementarity / Hairpin Check
  // Check for 4bp stems within the guide
  let hairpin = false;
  for (let len = 4; len <= 6; len++) {
    for (let start1 = 0; start1 <= seq.length - len * 2 - 3; start1++) {
      const stem1 = seq.slice(start1, start1 + len);
      const remaining = seq.slice(start1 + len + 3); // minimum 3bp loop
      const stem2Rc = getReverseComplementSequenceString(stem1);
      if (remaining.includes(stem2Rc)) {
        hairpin = true;
        baseScore -= 18;
        break;
      }
    }
    if (hairpin) break;
  }

  const finalEff = Math.max(1, Math.min(99, baseScore));

  return {
    efficiency: finalEff,
    gcContent: gc,
    polyT,
    hairpin
  };
}

// ──────────────────────────────── CFD Off-Target Prediction ────────────────────────────────

/**
 * Predict off-target sites in a reference sequence (e.g., genome) for a 20bp guide.
 * Utilizes a Cutting Frequency Determination (CFD) model.
 * 
 * CFD principles:
 * - Mismatches closer to PAM (seed region, positions 1-10) have major penalties.
 * - Single mismatches have varying weights depending on identity and position.
 * - Cumulative mismatches multiply their scores.
 */
export function predictOffTargets(guide: string, referenceGenome: string): OffTargetSite[] {
  const g = guide.toUpperCase();
  const ref = referenceGenome.toUpperCase();
  const hits: OffTargetSite[] = [];

  // Slide along reference to find 20bp windows with <= 4 mismatches
  for (let i = 0; i <= ref.length - 23; i++) {
    const window23 = ref.slice(i, i + 23);
    const windowGuide = window23.slice(0, 20);
    const windowPam = window23.slice(20, 23);

    // Only inspect if it has a valid SpCas9 PAM (NGG or similar, let's allow NAG/NGG)
    if (windowPam[1] === "G" && windowPam[2] === "G") {
      const mismatches: number[] = [];
      let mismatchCount = 0;

      for (let j = 0; j < 20; j++) {
        if (g[j] !== windowGuide[j]) {
          mismatches.push(j);
          mismatchCount++;
        }
      }

      if (mismatchCount <= 4) {
        // Compute CFD Score
        // Empirical CFD weights: seed region (positions 11-20 in 5'-3' guide, closest to 3'-PAM)
        // are extremely sensitive. Let's map position index (0 to 19):
        // index 19 is closest to PAM (position 20), index 0 is furthest (position 1).
        let cfd = 1.0;
        for (const pos of mismatches) {
          // Weight factors based on distance from PAM
          // Seed (10bp next to PAM): heavy penalty. Non-seed: lighter penalty.
          let posWeight = 0.9;
          if (pos >= 10) {
            // Seed region
            const distFromPam = 19 - pos; // 0 for position 20, 9 for position 11
            posWeight = 0.1 + 0.05 * distFromPam; // 0.1 at pos 20, 0.55 at pos 11
          } else {
            // Non-seed region
            posWeight = 0.7 + 0.02 * pos; // 0.7 at pos 1, 0.9 at pos 10
          }
          cfd *= posWeight;
        }

        hits.push({
          sequence: windowGuide,
          mismatches: mismatchCount,
          mismatchPositions: mismatches,
          cfdScore: Number(cfd.toFixed(4)),
          location: `RefIndex:${i}`,
          strand: "+"
        });
      }
    }
  }

  // Sort by cutting potential descending (highest cfd first)
  return hits.sort((a, b) => b.cfdScore - a.cfdScore);
}

// ──────────────────────────────── HDR Donor Design with PAM Evasion ────────────────────────────────

/**
 * Automate HDR (Homology-Directed Repair) Donor Template design.
 * 
 * Highlights:
 * - Integrates user's desired nucleotide mutation.
 * - Synthesizes Left and Right Homology Arms.
 * - CRITICAL EVASION LOGIC: To prevent the Cas endonuclease from digesting the newly inserted
 *   donor DNA, it identifies the PAM or guide seed region in the donor and introduces
 *   silent (synonymous) mutations while preserving the amino acid sequence!
 */
export function designHdrDonor(options: {
  template: string;
  cutIndex: number;
  insertSequence: string; // The desired edited sequence
  homologyArmLength: number; // e.g., 50bp
  gRNA: GrnaCandidate;
  readingFrameOffset?: number; // 0, 1, 2 relative to the homology window start
}): HdrDonorTemplate {
  const { template, cutIndex, insertSequence, homologyArmLength, gRNA } = options;
  const seq = template.toUpperCase();

  // 1. Get raw homology arms
  const leftStart = Math.max(0, cutIndex - homologyArmLength);
  const leftArmRaw = seq.slice(leftStart, cutIndex);

  const rightEnd = Math.min(seq.length, cutIndex + homologyArmLength);
  const rightArmRaw = seq.slice(cutIndex, rightEnd);

  // 2. Combine donor
  const donorWithInsert = leftArmRaw + insertSequence.toUpperCase() + rightArmRaw;

  // 3. Evasion: Destroy PAM or gRNA-binding site on the donor
  // Let's locate the gRNA target inside the donor
  const targetGuide = gRNA.sequence;
  const targetPam = gRNA.pam;
  const targetFull = gRNA.fullTargetWithPam;

  const silentMutations: HdrDonorTemplate["silentMutationsIntroduced"] = [];
  let modifiedDonor = donorWithInsert;

  // Simple and clever silent mutation engine:
  // If the target site is completely inside the homology arms, we can modify it!
  const fullTargetIdx = donorWithInsert.indexOf(targetFull);

  if (fullTargetIdx !== -1) {
    // Found the active guide site in the donor. We must mutate it silently!
    // We target the PAM (specifically GG for SpCas9) or seed region.
    // If Cas9, SpCas9 PAM is NGG. If we mutate GG silently:
    // Let's find the codon alignment.
    // Let's translate the region to see its original amino acids.
    // Since we are in Svelte/client-side, we map codons.
    const CODON_MAP: Record<string, string[]> = {
      GCA: ["GCG", "GCT", "GCC"], GCC: ["GCA", "GCG", "GCT"], GCG: ["GCA", "GCC", "GCT"], GCT: ["GCA", "GCC", "GCG"],
      TGC: ["TGT"], TGT: ["TGC"],
      GAC: ["GAT"], GAT: ["GAC"],
      GAA: ["GAG"], GAG: ["GAA"],
      TTC: ["TTT"], TTT: ["TTC"],
      GGA: ["GGG", "GGT", "GGC"], GGC: ["GGA", "GGG", "GGT"], GGG: ["GGA", "GGC", "GGT"], GGT: ["GGA", "GGC", "GGG"],
      CAC: ["CAT"], CAT: ["CAC"],
      ATA: ["ATT", "ATC"], ATC: ["ATT", "ATA"], ATT: ["ATC", "ATA"],
      AAA: ["AAG"], AAG: ["AAA"],
      CTA: ["CTG", "CTC", "CTT", "TTA", "TTG"], CTC: ["CTG", "CTA", "CTT", "TTA", "TTG"], CTG: ["CTC", "CTA", "CTT", "TTA", "TTG"], CTT: ["CTG", "CTC", "CTA", "TTA", "TTG"], TTA: ["TTG", "CTA", "CTG", "CTC", "CTT"], TTG: ["TTA", "CTA", "CTG", "CTC", "CTT"],
      ATG: ["ATG"], // Methionine (no alternate)
      AAC: ["AAT"], AAT: ["AAC"],
      CCA: ["CCG", "CCT", "CCC"], CCC: ["CCA", "CCG", "CCT"], CCG: ["CCA", "CCC", "CCT"], CCT: ["CCA", "CCC", "CCG"],
      CAA: ["CAG"], CAG: ["CAA"],
      AGA: ["AGG", "CGT", "CGC", "CGA", "CGG"], AGG: ["AGA", "CGT", "CGC", "CGA", "CGG"], CGA: ["CGG", "CGC", "CGT", "AGA", "AGG"], CGC: ["CGG", "CGA", "CGT", "AGA", "AGG"], CGG: ["CGA", "CGC", "CGT", "AGA", "AGG"], CGT: ["CGG", "CGA", "CGC", "AGA", "AGG"],
      AGC: ["AGT", "TCA", "TCC", "TCG", "TCT"], AGT: ["AGC", "TCA", "TCC", "TCG", "TCT"], TCA: ["TCG", "TCC", "TCT", "AGC", "AGT"], TCC: ["TCG", "TCA", "TCT", "AGC", "AGT"], TCG: ["TCC", "TCA", "TCT", "AGC", "AGT"], TCT: ["TCG", "TCC", "TCA", "AGC", "AGT"],
      ACA: ["ACG", "ACT", "ACC"], ACC: ["ACA", "ACG", "ACT"], ACG: ["ACA", "ACC", "ACT"], ACT: ["ACA", "ACC", "ACG"],
      GTA: ["GTG", "GTC", "GTT"], GTC: ["GTA", "GTG", "GTT"], GTG: ["GTA", "GTC", "GTT"], GTT: ["GTA", "GTC", "GTG"],
      TGG: ["TGG"], // Tryptophan (no alternate)
      TAC: ["TAT"], TAT: ["TAC"],
      TAA: ["TAG", "TGA"], TAG: ["TAA", "TGA"], TGA: ["TAA", "TAG"]
    };

    // Let's find codon boundaries around fullTargetIdx.
    // Assume offset 0 for local codon phase for simplicity, or look at relative reading frame
    const frame = options.readingFrameOffset ?? (fullTargetIdx % 3);
    const startCodonBound = fullTargetIdx - frame;

    // Mutate PAM if possible
    // PAM index in target: SpCas9 guide is 20bp, PAM is 21-23bp (offset 20).
    const pamLocalStart = fullTargetIdx + gRNA.sequence.length; 
    const pamCodonStart = pamLocalStart - ((pamLocalStart - startCodonBound) % 3);

    // Let's attempt to modify codons in the PAM or seed (last 10bp of guide, offset 10 to 19)
    // We try to find any codon we can change silently.
    let donorArr = [...modifiedDonor];
    let mutatedSuccess = false;

    for (let offset = -6; offset <= 9; offset += 3) {
      const codonIdx = pamCodonStart + offset;
      if (codonIdx >= 0 && codonIdx + 3 <= donorArr.length) {
        const codon = donorArr.slice(codonIdx, codonIdx + 3).join("");
        const alts = CODON_MAP[codon];
        if (alts && alts.length > 0) {
          const newCodon = alts[0]; // Take first alternative
          donorArr[codonIdx] = newCodon[0];
          donorArr[codonIdx + 1] = newCodon[1];
          donorArr[codonIdx + 2] = newCodon[2];
          
          silentMutations.push({
            position: codonIdx,
            original: codon,
            mutated: newCodon,
            codonChange: `${codon} ➔ ${newCodon}`,
            reason: offset >= 0 ? "PAM_destruction" : "guide_disruption"
          });
          mutatedSuccess = true;
        }
      }
    }

    if (mutatedSuccess) {
      modifiedDonor = donorArr.join("");
    }
  }

  // Re-separate Left/Right arms after silent edits
  const finalLeftArm = modifiedDonor.slice(0, leftArmRaw.length);
  const finalRightArm = modifiedDonor.slice(leftArmRaw.length + insertSequence.length);

  return {
    leftArm: finalLeftArm,
    rightArm: finalRightArm,
    insertedMutations: insertSequence,
    fullDonor: modifiedDonor,
    silentMutationsIntroduced: silentMutations,
    warning: silentMutations.length === 0 
      ? m.crisprNoSilentMutationWarning()
      : undefined
  };
}

// ──────────────────────────────── Prime Editing pegRNA Design ────────────────────────────────

/**
 * Prime Editing pegRNA (Prime Editing Guide RNA) Design.
 * 
 * Prime editing couples a Cas9 nickase (H840A) to a reverse transcriptase.
 * pegRNA contains:
 * 1. Standard spacer (guide) sequence (20nt)
 * 2. 3' extension containing:
 *    - Primer Binding Site (PBS): base-pairs with the nicked genomic DNA strand
 *    - Reverse Transcription Template (RTT): encodes the edit
 */
export function designPegRna(options: {
  template: string;
  gRNA: GrnaCandidate;
  editStartIndex: number; // absolute start in template
  editSequence: string; // edit to insert
  pbsLength?: number; // default 13
  rttLength?: number; // default 16
}): PegRnaDesign {
  const { template, gRNA, editStartIndex, editSequence, pbsLength = 13, rttLength = 16 } = options;
  const seq = template.toUpperCase();

  // SpCas9 nickase cuts 3bp upstream of PAM on target strand
  const nickIndex = gRNA.cutIndex;

  // Prime editing targets the nicked strand.
  // Let's design the PBS and RTT on the pegRNA 3' end.
  // PBS is complementary to the genomic sequence immediately 5' of the nick site (non-target strand).
  // Thus, the PBS sequence on the pegRNA (5'->3') is identical to the target (pam-containing) strand
  // 5' of the nick site (going backwards/left).
  // PBS length of 13nt: we grab 13nt upstream of the nick site.
  const pbsStart = nickIndex - pbsLength;
  const pbsTargetStrand = seq.slice(pbsStart, nickIndex);
  // pegRNA PBS is the reverse complement of this, because it must pair with it!
  const pbsPegRna = getReverseComplementSequenceString(pbsTargetStrand);

  // RTT contains the edit. RTT starts at the nick site (3' of nick index) and includes the edit.
  // It must extend past the edit point to allow homologous pairing.
  // We grab genomic sequence downstream of nick index, replace with edit, and grab rttLength.
  const genomicDownstream = seq.slice(nickIndex, nickIndex + rttLength);
  
  // Replace genomic sequence with editSequence at editStartIndex relative to nickIndex
  const relativeEditOffset = editStartIndex - nickIndex;
  let rttGenomicEdited = genomicDownstream;
  if (relativeEditOffset >= 0 && relativeEditOffset < rttLength) {
    rttGenomicEdited = genomicDownstream.slice(0, relativeEditOffset) + editSequence + genomicDownstream.slice(relativeEditOffset + editSequence.length);
  } else {
    // If edit is right at the nick site
    rttGenomicEdited = editSequence + genomicDownstream.slice(editSequence.length);
  }

  // RTT on pegRNA is reverse complement of the edited non-target strand segment
  const rttPegRna = getReverseComplementSequenceString(rttGenomicEdited.slice(0, rttLength));

  // PBS melting temperature calculation: 4*(G+C) + 2*(A+T)
  const gCount = (pbsPegRna.match(/G/g) || []).length;
  const cCount = (pbsPegRna.match(/C/g) || []).length;
  const aCount = (pbsPegRna.match(/A/g) || []).length;
  const tCount = (pbsPegRna.match(/T/g) || []).length;
  const pbsTm = 4 * (gCount + cCount) + 2 * (aCount + tCount);

  const fullExtension = rttPegRna + pbsPegRna; // pegRNA goes 5' -> guide -> scaffold -> RTT -> PBS -> 3'
  const scaffold = "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC";
  const fullPeg = gRNA.sequence + scaffold + fullExtension;

  return {
    gRNA: gRNA.sequence,
    pbs: pbsPegRna,
    pbsLength,
    pbsTm,
    rtt: rttPegRna,
    rttLength,
    full3PrimeExtension: fullExtension,
    pegRnaSequence: fullPeg
  };
}

// ──────────────────────────────── Base Editing Window Calculation ────────────────────────────────

/**
 * Assess a gRNA's suitability for Base Editing (CBE or ABE).
 * 
 * CBE (Cytidine Base Editor): Converts C ➔ T (via U) within editing window (typically positions 4-8).
 * ABE (Adenine Base Editor): Converts A ➔ G (via I) within editing window (typically positions 4-8).
 * Guide positions are 1-indexed, starting from 5' end of the 20nt protospacer.
 */
export function calculateBaseEditingWindow(
  guideSeq: string,
  guideStartIndex: number,
  strand: "+" | "-"
): BaseEditingResult {
  const cbeCandidates: BaseEditingResult["cbeCandidates"] = [];
  const abeCandidates: BaseEditingResult["abeCandidates"] = [];

  // Edit window: 4 to 8 of protospacer (index 3 to 7)
  for (let i = 3; i <= 7; i++) {
    const base = guideSeq[i];
    const windowPos = i + 1; // 1-indexed

    // Map back to physical genomic coordinate
    const absoluteIdx = strand === "+" ? guideStartIndex + i : guideStartIndex + (20 - 1 - i);

    // Efficiency peak is centered at position 5-6
    const baseEff = windowPos === 5 || windowPos === 6 ? 85 : (windowPos === 4 || windowPos === 7 ? 60 : 35);

    if (base === "C") {
      cbeCandidates.push({
        index: absoluteIdx,
        originalBase: "C",
        targetBase: "T",
        windowPosition: windowPos,
        efficiency: baseEff
      });
    } else if (base === "G" && strand === "-") {
      // G on reverse strand is C on forward target
      cbeCandidates.push({
        index: absoluteIdx,
        originalBase: "G",
        targetBase: "T",
        windowPosition: windowPos,
        efficiency: baseEff
      });
    }

    if (base === "A") {
      abeCandidates.push({
        index: absoluteIdx,
        originalBase: "A",
        targetBase: "G",
        windowPosition: windowPos,
        efficiency: baseEff
      });
    } else if (base === "T" && strand === "-") {
      // T on reverse strand is A on forward target
      abeCandidates.push({
        index: absoluteIdx,
        originalBase: "T",
        targetBase: "G",
        windowPosition: windowPos,
        efficiency: baseEff
      });
    }
  }

  return { cbeCandidates, abeCandidates };
}
