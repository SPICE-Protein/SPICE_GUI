/**
 * SPICE Advanced Protein Analysis Module (Feature F)
 * 
 * Provides secondary structure Chou-Fasman propensity calculations, 
 * Kyte-Doolittle sliding window profiling, local FoldIndex disordered 
 * region predictors, and Pfam-style structural domain consensus searches.
 */

import { AA_HYDRO_SCALE } from "./batchEvaluator";
import * as m from "$lib/paraglide/messages.js";

export interface ChouFasmanResult {
  pos: number;
  residue: string;
  structure: "H" | "E" | "C"; // Helix, Sheet, Coil
}

// Chou-Fasman Alpha-helix propensities
const CF_P_HELIX: Record<string, number> = {
  A: 1.42, R: 0.98, N: 0.67, D: 1.01, C: 0.70, E: 1.51, Q: 1.11, G: 0.57, H: 1.00, I: 1.08,
  L: 1.21, K: 1.14, M: 1.45, F: 1.13, P: 0.57, S: 0.77, T: 0.83, W: 1.08, Y: 0.69, V: 1.06
};

// Chou-Fasman Beta-sheet propensities
const CF_P_SHEET: Record<string, number> = {
  A: 0.83, R: 0.93, N: 0.89, D: 0.54, C: 1.19, E: 0.37, Q: 1.10, G: 0.75, H: 0.87, I: 1.60,
  L: 1.30, K: 0.74, M: 1.05, F: 1.38, P: 0.55, S: 0.75, T: 1.19, W: 1.37, Y: 1.47, V: 1.70
};

/**
 * Chou-Fasman Secondary Structure Prediction algorithm.
 * Identifies helical and sheet nucleation zones, extensions, and overlap conflicts.
 */
export function predictChouFasman(aaSeq: string): ChouFasmanResult[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const len = seq.length;
  const struct = Array(len).fill("C") as ("H" | "E" | "C")[];

  // 1. Alpha-Helix scanning
  // Nucleation: Scan for a cluster of 4 helix initiators (P_helix >= 1.0) out of 6 consecutive residues
  for (let i = 0; i <= len - 6; i++) {
    let helixInitiators = 0;
    for (let j = 0; j < 6; j++) {
      if ((CF_P_HELIX[seq[i + j]] || 0) >= 1.0) helixInitiators++;
    }

    if (helixInitiators >= 4) {
      // Nucleation success, extend left
      let start = i;
      while (start > 0) {
        const win4 = seq.slice(start - 4, start).split("").reduce((sum, c) => sum + (CF_P_HELIX[c] || 0), 0) / 4;
        if (win4 < 1.0) break;
        start--;
      }

      // Extend right
      let end = i + 5;
      while (end < len - 1) {
        const win4 = seq.slice(end + 1, end + 5).split("").reduce((sum, c) => sum + (CF_P_HELIX[c] || 0), 0) / 4;
        if (win4 < 1.0) break;
        end++;
      }

      // Assign Helix
      for (let k = start; k <= end; k++) struct[k] = "H";
    }
  }

  // 2. Beta-Sheet scanning
  // Nucleation: Scan for a cluster of 3 sheet initiators (P_sheet >= 1.0) out of 5 consecutive residues
  for (let i = 0; i <= len - 5; i++) {
    let sheetInitiators = 0;
    for (let j = 0; j < 5; j++) {
      if ((CF_P_SHEET[seq[i + j]] || 0) >= 1.0) sheetInitiators++;
    }

    if (sheetInitiators >= 3) {
      let start = i;
      while (start > 0) {
        const win4 = seq.slice(start - 4, start).split("").reduce((sum, c) => sum + (CF_P_SHEET[c] || 0), 0) / 4;
        if (win4 < 1.0) break;
        start--;
      }

      let end = i + 4;
      while (end < len - 1) {
        const win4 = seq.slice(end + 1, end + 5).split("").reduce((sum, c) => sum + (CF_P_SHEET[c] || 0), 0) / 4;
        if (win4 < 1.0) break;
        end++;
      }

      // Assign Sheet (resolving helix overlap using propensity comparison)
      for (let k = start; k <= end; k++) {
        if (struct[k] === "H") {
          const pH = CF_P_HELIX[seq[k]] || 0;
          const pE = CF_P_SHEET[seq[k]] || 0;
          if (pE > pH) struct[k] = "E";
        } else {
          struct[k] = "E";
        }
      }
    }
  }

  return seq.split("").map((residue, pos) => ({
    pos,
    residue,
    structure: struct[pos],
  }));
}

/**
 * Kyte-Doolittle Hydrophobicity sliding window plot.
 */
export function calculateKyteDoolittleProfile(aaSeq: string, windowSize = 9): number[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const len = seq.length;
  const profile: number[] = Array(len).fill(0);
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < len; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < len) {
        sum += AA_HYDRO_SCALE[seq[idx]] || 0;
        count++;
      }
    }
    profile[i] = Number((sum / count).toFixed(3));
  }
  return profile;
}

/**
 * Scans protein for common domain consensus motifs (e.g. Zinc Fingers, GPCRs, SH3, Catalytic kinases).
 */
export function predictProteinDomains(aaSeq: string): { name: string; start: number; end: number; desc: string }[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const DOMAIN_PATTERNS = [
    { name: "Zinc Finger (C2H2)", pattern: /C.{2,4}C.{12}H.{3,5}H/g, desc: "C2H2-type DNA binding Zinc Finger domain" },
    { name: "SH3 Binding Domain", pattern: /P.[AP].P/g, desc: "Src Homology 3 (SH3) binding proline-rich core" },
    { name: "Ser/Thr Kinase Loop", pattern: /[LIVF]G.G.[FYSG].[VLA]/g, desc: "Serine/Threonine Protein Kinase catalytic active loop" },
    { name: "FP Chromophore Motif", pattern: /F.G[YF]G/g, desc: "Consensus beta-can chromophore nucleation (e.g. GFP-like SYG/GYG)" }
  ];

  const found: { name: string; start: number; end: number; desc: string }[] = [];
  for (const dom of DOMAIN_PATTERNS) {
    dom.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dom.pattern.exec(seq)) !== null) {
      found.push({
        name: dom.name,
        start: match.index,
        end: match.index + match[0].length - 1,
        desc: dom.desc
      });
      if (match.index === dom.pattern.lastIndex) dom.pattern.lastIndex++;
    }
  }
  return found;
}

// ──────────────────────────────── 16: Protein solubility & aggregation propensity prediction ────────────────────────────────

export interface SolubilityResult {
  solubilityScore: number;     // % probability of soluble expression
  aggregationHotspots: { start: number; end: number; sequence: string; score: number }[];
}

/**
 * Predicts E. coli recombinant expression solubility (Wilkinson-Harrison)
 * and scans for beta-aggregation hotspots (TANGO-style hydrophobic cores).
 */
export function predictSolubilityAndAggregation(aaSeq: string): SolubilityResult {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  if (seq.length === 0) return { solubilityScore: 0, aggregationHotspots: [] };

  // 1. Wilkinson-Harrison Solubility: depends on net charge and fraction of turn-forming residues
  let acidic = 0, basic = 0;
  let turns = 0; // Gly, Pro, Asp, Asn, Ser

  for (const c of seq) {
    if ("DE".includes(c)) acidic++;
    else if ("KR".includes(c)) basic++;
    
    if ("GPDNS".includes(c)) turns++;
  }

  const netCharge = Math.abs(basic - acidic);
  const compositeParameter = (netCharge / seq.length) * 0.45 + (turns / seq.length) * 0.55;
  const solubilityScore = Math.min(100, Math.round(compositeParameter * 190 + 35)); // empirical calibration

  // 2. TANGO-style beta-aggregation hotspots (windows of 5-8 highly hydrophobic residues)
  const hotspots: SolubilityResult["aggregationHotspots"] = [];
  const W_SIZE = 6;
  
  for (let i = 0; i <= seq.length - W_SIZE; i++) {
    const sub = seq.slice(i, i + W_SIZE);
    
    // Check if window is highly hydrophobic
    let hydroCount = 0;
    for (const c of sub) {
      if ("LIVFWMY".includes(c)) hydroCount++;
    }

    if (hydroCount >= 5) { // 5 out of 6 residues are strongly hydrophobic -> aggregation core!
      // Check overlaps
      const overlap = hotspots.find(h => i >= h.start && i <= h.end);
      if (!overlap) {
        hotspots.push({
          start: i,
          end: i + W_SIZE - 1,
          sequence: sub,
          score: Math.round((hydroCount / W_SIZE) * 100)
        });
      }
    }
  }

  return {
    solubilityScore,
    aggregationHotspots: hotspots
  };
}

// ──────────────────────────────── 17: Protein stability ΔΔG predictor ────────────────────────────────

export interface DdgPredictionResult {
  ddG: number;             // kcal/mol (negative means stabilized, positive means destabilized)
  classification: "Highly Stabilizing" | "Stabilizing" | "Neutral" | "Destabilizing" | "Highly Destabilizing";
  details: string;
}

const AA_VOLUME: Record<string, number> = {
  A: 88.6, R: 173.4, N: 114.1, D: 111.1, C: 108.5, Q: 143.8, E: 138.4, G: 60.1, H: 153.2, I: 166.7,
  L: 166.7, K: 168.6, M: 162.9, F: 189.9, P: 112.7, S: 89.0, T: 116.1, W: 227.8, Y: 193.6, V: 140.0
};

/**
 * Calculates a fast empirical ΔΔG estimation for a single point mutation:
 * ΔΔG = dG_mut - dG_wt (kcal/mol)
 * Models hydrophobic volume changes, electrostatic shifts, and hydrogen-bonding delta.
 */
export function predictMutationalStabilityDdG(
  wtRes: string,
  position: number, // 1-based index
  mutRes: string
): DdgPredictionResult {
  const wt = wtRes.toUpperCase();
  const mut = mutRes.toUpperCase();

  if (wt === mut) {
    return { ddG: 0, classification: "Neutral", details: m.ppDdgSame() };
  }

  // 1. Sidechain volume delta (cavity creation or steric clash)
  const volWt = AA_VOLUME[wt] || 100;
  const volMut = AA_VOLUME[mut] || 100;
  const dVol = volMut - volWt;
  
  let ddG_volume = 0;
  if (dVol < -40) {
    // Cavity creation: destabilizing
    ddG_volume = 0.04 * Math.abs(dVol); 
  } else if (dVol > 60) {
    // Steric clash: destabilizing
    ddG_volume = 0.05 * dVol;
  }

  // 2. Hydrophobicity delta (solvent exposure)
  const hydroWt = AA_HYDRO_SCALE[wt] || 0;
  const hydroMut = AA_HYDRO_SCALE[mut] || 0;
  const dHydro = hydroMut - hydroWt;
  const ddG_hydro = -0.6 * dHydro; // hydrophobic collapse: gain in hydrophobicity stabilizes core

  // 3. Charge disruption (salt bridges / electrostatic repulsion)
  let ddG_charge = 0;
  const wtCharged = "DERK".includes(wt);
  const mutCharged = "DERK".includes(mut);
  if (wtCharged && !mutCharged) {
    ddG_charge = 0.5; // disrupt a potential salt bridge
  } else if (!wtCharged && mutCharged) {
    ddG_charge = 0.2; // introduce charge into potentially hydrophobic core
  }

  const finalDdG = ddG_volume + ddG_hydro + ddG_charge;
  
  let classification: DdgPredictionResult["classification"] = "Neutral";
  let details = "";

  if (finalDdG < -1.0) {
    classification = "Highly Stabilizing";
    details = m.ppDdgHighStab({ v1: `${wt}${position}${mut}` });
  } else if (finalDdG < -0.2) {
    classification = "Stabilizing";
    details = m.ppDdgStab({ v1: `${wt}${position}${mut}`, v2: finalDdG.toFixed(2) });
  } else if (finalDdG <= 0.2) {
    classification = "Neutral";
    details = m.ppDdgNeutral({ v1: `${wt}${position}${mut}`, v2: finalDdG.toFixed(2) });
  } else if (finalDdG < 1.0) {
    classification = "Destabilizing";
    details = m.ppDdgDestab({ v1: `${wt}${position}${mut}`, v2: finalDdG.toFixed(2) });
  } else {
    classification = "Highly Destabilizing";
    details = m.ppDdgHighDestab({ v1: `${wt}${position}${mut}` });
  }

  return {
    ddG: Number(finalDdG.toFixed(2)),
    classification,
    details
  };
}

// ──────────────────────────────── 7: Peptide Mass Fingerprint (PMF) prediction ────────────────────────────────

export interface PeptideFragment {
  sequence: string;
  start: number; // 1-based index
  end: number;
  mass: number; // Monoisotopic mass (Da)
  chargeStates: Record<number, number>; // m/z for +1, +2, +3 charges
}

export const AA_MONO_MASS: Record<string, number> = {
  A: 71.03711, R: 156.10111, N: 114.04293, D: 115.02694, C: 103.00919, Q: 128.05858,
  E: 129.04259, G: 57.02146, H: 137.05891, I: 113.08406, L: 113.08406, K: 128.09496,
  M: 131.04049, F: 147.06841, P: 97.05276, S: 87.03203, T: 101.04768, W: 186.07931,
  Y: 163.06333, V: 99.06841
};

/**
 * Predicts peptide fragments from Trypsin digestion and computes mass fingerprinting (PMF).
 * Trypsin cleaves after K or R, unless followed by P.
 */
export function predictPeptideMassFingerprint(aaSeq: string): PeptideFragment[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const fragments: PeptideFragment[] = [];
  
  let currentStart = 0;
  for (let i = 0; i < seq.length; i++) {
    const residue = seq[i];
    const isCleavageSite = (residue === "K" || residue === "R") && (i === seq.length - 1 || seq[i + 1] !== "P");
    
    if (isCleavageSite || i === seq.length - 1) {
      const fragSeq = seq.slice(currentStart, i + 1);
      if (fragSeq.length > 0) {
        // Compute monoisotopic mass
        let mass = 18.01056; // H2O addition for free peptide
        for (const char of fragSeq) {
          mass += AA_MONO_MASS[char] || 0;
        }

        // Calculate m/z for common charge states [+1, +2, +3] (H+ addition = 1.00782)
        const chargeStates: Record<number, number> = {
          1: Number((mass + 1.00782).toFixed(4)),
          2: Number(((mass + 2 * 1.00782) / 2).toFixed(4)),
          3: Number(((mass + 3 * 1.00782) / 3).toFixed(4))
        };

        fragments.push({
          sequence: fragSeq,
          start: currentStart + 1,
          end: i + 1,
          mass: Number(mass.toFixed(4)),
          chargeStates
        });
      }
      currentStart = i + 1;
    }
  }

  return fragments.sort((a, b) => a.mass - b.mass);
}

/**
 * Compares WT vs Mutant tryptic digestion to find distinguishing peaks in MALDI-TOF.
 */
export function comparePmfWTvsMutant(wtSeq: string, mutSeq: string): {
  wtFragments: PeptideFragment[];
  mutFragments: PeptideFragment[];
  differentialPeaks: { fragment: string; wtMass: number; mutMass: number; type: "wt_only" | "mut_only" | "shifted" }[];
} {
  const wtFrags = predictPeptideMassFingerprint(wtSeq);
  const mutFrags = predictPeptideMassFingerprint(mutSeq);
  
  const differentialPeaks: { fragment: string; wtMass: number; mutMass: number; type: "wt_only" | "mut_only" | "shifted" }[] = [];

  // Simple differential scanning
  wtFrags.forEach(wt => {
    const matched = mutFrags.find(m => Math.abs(m.mass - wt.mass) < 0.05 && m.sequence === wt.sequence);
    if (!matched) {
      // Find if there's an overlapping fragment with a mutation
      const shifted = mutFrags.find(m => m.start === wt.start || m.end === wt.end);
      if (shifted) {
        differentialPeaks.push({
          fragment: `${wt.sequence} ➔ ${shifted.sequence}`,
          wtMass: wt.mass,
          mutMass: shifted.mass,
          type: "shifted"
        });
      } else {
        differentialPeaks.push({
          fragment: wt.sequence,
          wtMass: wt.mass,
          mutMass: 0,
          type: "wt_only"
        });
      }
    }
  });

  mutFrags.forEach(mut => {
    const matched = wtFrags.find(w => Math.abs(w.mass - mut.mass) < 0.05 && w.sequence === mut.sequence);
    if (!matched) {
      const isShiftedPartner = differentialPeaks.some(dp => dp.type === "shifted" && dp.fragment.endsWith(mut.sequence));
      if (!isShiftedPartner) {
        differentialPeaks.push({
          fragment: mut.sequence,
          wtMass: 0,
          mutMass: mut.mass,
          type: "mut_only"
        });
      }
    }
  });

  return {
    wtFragments: wtFrags,
    mutFragments: mutFrags,
    differentialPeaks
  };
}

// ──────────────────────────────── 8: Disulfide Bond Prediction ────────────────────────────────

export interface DisulfideBondPrediction {
  cys1: number; // 1-based index
  cys2: number;
  pairingProbability: number; // %
  redoxSensitivity: "stable" | "sensitive";
  score: number;
}

/**
 * Predicts potential disulfide bonds based on cysteine spacing, surrounding hydrophobic markers, 
 * and redox environmental parameters.
 */
export function predictDisulfideBonds(aaSeq: string): DisulfideBondPrediction[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const cysPositions: number[] = [];
  
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === "C") cysPositions.push(i + 1);
  }

  if (cysPositions.length < 2) return [];

  const predictions: DisulfideBondPrediction[] = [];

  // Pairwise evaluation of cysteines
  for (let i = 0; i < cysPositions.length; i++) {
    for (let j = i + 1; j < cysPositions.length; j++) {
      const c1 = cysPositions[i];
      const c2 = cysPositions[j];
      const dist = c2 - c1;

      // Biophysical heuristic for cysteine pairing
      let score = 50; // baseline probability

      // 1. Spacing preference (cysteines separated by 3-10 amino acids are often highly stable loop linkages)
      if (dist >= 3 && dist <= 12) score += 20;
      else if (dist > 50) score += 5; // Long range structural folds

      // 2. Local motif checks (CXXC and CXC motifs are active centers for redox action)
      const sub = seq.slice(c1 - 1, c2);
      if (sub.length === 4 && sub[1] === "X" && sub[2] === "X") { // CXXC
        score += 25;
      } else if (sub.length === 3 && sub[1] === "X") { // CXC
        score += 15;
      }

      // 3. Hydrophobic local context (stable disulfide bonds are usually buried in hydrophobic pockets)
      let hydroNeighborCount = 0;
      const neighbors = [c1 - 2, c1, c1 + 1, c2 - 2, c2, c2 + 1];
      neighbors.forEach(n => {
        if (n >= 1 && n <= seq.length && "LIVFWMY".includes(seq[n - 1])) {
          hydroNeighborCount++;
        }
      });
      score += hydroNeighborCount * 4;

      const finalScore = Math.min(98, score);
      predictions.push({
        cys1: c1,
        cys2: c2,
        pairingProbability: finalScore,
        redoxSensitivity: finalScore > 75 ? "stable" : "sensitive",
        score: finalScore
      });
    }
  }

  // Greedy filter: Cysteines usually pair 1-to-1. Select top scoring non-overlapping bonds
  const sorted = predictions.sort((a, b) => b.score - a.score);
  const result: DisulfideBondPrediction[] = [];
  const used = new Set<number>();

  for (const p of sorted) {
    if (!used.has(p.cys1) && !used.has(p.cys2)) {
      result.push(p);
      used.add(p.cys1);
      used.add(p.cys2);
    }
  }

  return result.sort((a, b) => a.cys1 - b.cys1);
}

// ──────────────────────────────── 9: Immunogenicity prediction ────────────────────────────────

export interface AntigenicEpitope {
  start: number; // 1-based index
  end: number;
  sequence: string;
  averageScore: number;
}

// Kolaskar & Tongaonkar Antigenicity Scale
export const ANTIGENICITY_SCALE: Record<string, number> = {
  A: 1.008, C: 1.080, D: 0.986, E: 0.941, F: 1.056, G: 1.017, H: 0.963, I: 1.077, K: 0.925,
  L: 1.065, M: 1.037, N: 0.916, P: 0.932, Q: 0.981, R: 0.918, S: 0.970, T: 0.980, V: 1.025,
  W: 1.043, Y: 1.052
};

/**
 * Predicts B-cell linear antigenic epitopes using the Kolaskar & Tongaonkar semi-empirical method.
 */
export function predictImmunogenicityAndAntigenicity(aaSeq: string, windowSize = 7): {
  averageAntigenicity: number;
  epitopes: AntigenicEpitope[];
  scores: number[];
} {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const len = seq.length;
  if (len === 0) return { averageAntigenicity: 0, epitopes: [], scores: [] };

  const scores: number[] = Array(len).fill(1.0);
  const half = Math.floor(windowSize / 2);

  // Compute sliding window average antigenicity
  let totalAll = 0;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < len) {
        sum += ANTIGENICITY_SCALE[seq[idx]] || 1.0;
        count++;
      }
    }
    scores[i] = Number((sum / count).toFixed(4));
    totalAll += scores[i];
  }

  const averageAntigenicity = totalAll / len;
  const threshold = 1.02; // Standard Kolaskar threshold for positive epitope projection

  // Group continuous regions above the threshold into epitopes (minimum length 6aa)
  const epitopes: AntigenicEpitope[] = [];
  let inEpitope = false;
  let epStart = 0;

  for (let i = 0; i < len; i++) {
    if (scores[i] >= threshold) {
      if (!inEpitope) {
        inEpitope = true;
        epStart = i;
      }
    } else {
      if (inEpitope) {
        inEpitope = false;
        const epLen = i - epStart;
        if (epLen >= 6) {
          const epSeq = seq.slice(epStart, i);
          const epAvg = scores.slice(epStart, i).reduce((a, b) => a + b, 0) / epLen;
          epitopes.push({
            start: epStart + 1,
            end: i,
            sequence: epSeq,
            averageScore: Number(epAvg.toFixed(3))
          });
        }
      }
    }
  }

  // Handle final epitope reaching end of sequence
  if (inEpitope) {
    const epLen = len - epStart;
    if (epLen >= 6) {
      const epSeq = seq.slice(epStart, len);
      const epAvg = scores.slice(epStart, len).reduce((a, b) => a + b, 0) / epLen;
      epitopes.push({
        start: epStart + 1,
        end: len,
        sequence: epSeq,
        averageScore: Number(epAvg.toFixed(3))
      });
    }
  }

  return {
    averageAntigenicity: Number(averageAntigenicity.toFixed(3)),
    epitopes,
    scores
  };
}

// ──────────────────────────────── 10: Protein charge distribution map (multi-domain pI) ────────────────────────────────

export interface DomainChargePoint {
  position: number; // Center of sliding window
  pI: number; // Local isoelectric point
  chargeAtPh7: number; // Net charge of this domain at physiological pH
  sequence: string;
}

// pKa values of basic and acidic residues
const PKA_ACIDIC: Record<string, number> = { D: 3.90, E: 4.25, C: 8.30, Y: 10.10, "C-term": 3.65 };
const PKA_BASIC: Record<string, number> = { K: 10.50, R: 12.50, H: 6.00, "N-term": 8.25 };

/**
 * Calculates net charge of an amino acid sequence at a specific pH.
 */
export function calculateNetChargeAtPh(seq: string, pH: number): number {
  let charge = 0;

  // Basic charges (positively charged at low pH, neutral at high pH)
  for (const c of seq) {
    if (c in PKA_BASIC) {
      const pKa = PKA_BASIC[c];
      charge += 1 / (1 + Math.pow(10, pH - pKa));
    }
  }
  // N-terminal contribution
  charge += 1 / (1 + Math.pow(10, pH - PKA_BASIC["N-term"]));

  // Acidic charges (neutral at low pH, negatively charged at high pH)
  for (const c of seq) {
    if (c in PKA_ACIDIC) {
      const pKa = PKA_ACIDIC[c];
      charge -= 1 / (1 + Math.pow(10, pKa - pH));
    }
  }
  // C-terminal contribution
  charge -= 1 / (1 + Math.pow(10, PKA_ACIDIC["C-term"] - pH));

  return charge;
}

/**
 * Estimates Isoelectric Point (pI) of an amino acid sequence by root finding (bisection method).
 */
export function estimateIsoelectricPoint(seq: string): number {
  let lowPh = 0.0;
  let highPh = 14.0;
  let pI = 7.0;

  for (let iter = 0; iter < 15; iter++) {
    pI = (lowPh + highPh) / 2;
    const charge = calculateNetChargeAtPh(seq, pI);

    if (Math.abs(charge) < 0.005) {
      break;
    } else if (charge > 0) {
      lowPh = pI; // too positive, raise pH to neutralize
    } else {
      highPh = pI; // too negative, lower pH to positive charge
    }
  }

  return Number(pI.toFixed(2));
}

/**
 * Generates sliding window profile of local charge and domain-specific isoelectric points.
 * Window size is usually 30-50aa to match structural domains or purification fragments.
 */
export function calculateProteinChargeDistribution(aaSeq: string, windowSize = 30): DomainChargePoint[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const len = seq.length;
  if (len < windowSize) {
    return [{
      position: Math.round(len / 2),
      pI: estimateIsoelectricPoint(seq),
      chargeAtPh7: Number(calculateNetChargeAtPh(seq, 7.0).toFixed(2)),
      sequence: seq
    }];
  }

  const result: DomainChargePoint[] = [];
  const step = Math.max(1, Math.floor(windowSize / 3));

  for (let i = 0; i <= len - windowSize; i += step) {
    const sub = seq.slice(i, i + windowSize);
    const pI = estimateIsoelectricPoint(sub);
    const chargeAtPh7 = calculateNetChargeAtPh(sub, 7.0);

    result.push({
      position: i + Math.floor(windowSize / 2),
      pI,
      chargeAtPh7: Number(chargeAtPh7.toFixed(2)),
      sequence: sub
    });
  }

  return result;
}

