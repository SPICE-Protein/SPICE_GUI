/**
 * SPICE High-Throughput Batch Mutant Evaluator (Feature D)
 * 
 * Provides CSV mutant library parsing and fast biophysical scoring 
 * representing SPICE's Rust parallelized (Rayon + Tokio) simulation loop.
 */

import { predictChouFasman } from "./proteinAnalysis";

export interface VariantCandidate {
  id: string;
  mutations: string; // e.g., "V15A, I32L"
  sequence: string;  // modified amino acid sequence
}

export interface MutationAnalysisResult {
  id: string;
  sequence: string;
  status: "success" | "failed";
  mutations: string;
  gravy: number;
  chargeAtPh7: number;
  predictedPi: number;
  isoelectricDelta: number;
  secondaryStructureHelixPercent: number;
  disorderScore: number; // FoldIndex disorder ratio
  thermostabilityScore: number; // Combined biophysical stability score (0..100)
}

// Kyte-Doolittle Hydrophobicity values
export const AA_HYDRO_SCALE: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2
};

/**
 * Parses mutant library specifications from a CSV string.
 * Supports "MutantID,Mutation_List" format (e.g. "Mutant_01, V15A + I32L").
 */
export function parseMutantsCsv(csvText: string, baseAaSeq: string): VariantCandidate[] {
  const lines = csvText.split(/\r?\n/);
  const candidates: VariantCandidate[] = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("ID,") || line.startsWith("id,")) continue;
    
    const parts = line.split(",");
    if (parts.length < 2) continue;
    
    const id = parts[0].trim();
    const mutationsRaw = parts.slice(1).join(",").trim().replace(/['"]/g, "");
    
    try {
      const arr = baseAaSeq.toUpperCase().split("");
      const singleMutations = mutationsRaw.split(/[,+;\s]+/).filter(m => m.trim().length > 0);
      
      for (const mut of singleMutations) {
        const match = mut.match(/^([ACDEFGHIKLMNPQRSTVWY])(\d+)([ACDEFGHIKLMNPQRSTVWY\*])$/i);
        if (!match) continue;
        
        const from = match[1].toUpperCase();
        const pos = parseInt(match[2], 10) - 1; // 1-based index to 0-based
        const to = match[3].toUpperCase();
        
        if (pos >= 0 && pos < arr.length && arr[pos] === from) {
          arr[pos] = to;
        }
      }
      
      candidates.push({
        id,
        mutations: mutationsRaw,
        sequence: arr.join("")
      });
    } catch (e) {
      // Skip malformed rows in the batch CSV
    }
  }
  return candidates;
}

/**
 * Evaluates physical/thermostability parameters on a batch of mutant candidates.
 * Calculates isoelectric changes, charge shifts, secondary structure propensities, and disorder.
 */
export function evaluateMutantsBatch(
  candidates: VariantCandidate[], 
  baseAaSeq: string,
  env: { ph: number; tempK: number; ionicStrengthM: number }
): MutationAnalysisResult[] {
  const basePi = calculatePI(baseAaSeq);

  return candidates.map(cand => {
    const seq = cand.sequence;
    const gravy = calculateGravy(seq);
    const charge = calculateChargeAtPh(seq, env.ph);
    const pI = calculatePI(seq);
    
    // Call Chou-Fasman module
    const chouFasman = predictChouFasman(seq);
    const helixPercent = chouFasman.filter(c => c.structure === "H").length / Math.max(1, seq.length) * 100;
    
    // Call local disorder module (FoldIndex)
    const disorder = calculateLocalDisorderFoldIndex(seq);
    
    // Combined biophysical scoring formula representing thermodynamic stability
    let baseScore = 70;
    
    const netChargeMagnitude = Math.abs(charge);
    if (netChargeMagnitude > 10) baseScore -= 8; // penalty for severe electrostatic repulsion
    if (gravy > 0.5) baseScore -= 12; // penalty for high aggregation propensity
    if (gravy < -1.5) baseScore -= 5;  // penalty for loss of hydrophobic core
    
    // Secondary structures promote compactness
    baseScore += (helixPercent - 25) * 0.35;
    
    // Disorder reduces core structural integrity
    baseScore -= disorder * 22;
    
    // Temperature decay above native (37C / 310K)
    const tCelsius = env.tempK - 273.15;
    if (tCelsius > 42) {
      baseScore -= (tCelsius - 42) * 1.1;
    }
    
    const finalScore = Math.max(0, Math.min(100, Math.round(baseScore)));

    return {
      id: cand.id,
      sequence: seq,
      status: "success",
      mutations: cand.mutations,
      gravy,
      chargeAtPh7: calculateChargeAtPh(seq, 7.0),
      predictedPi: pI,
      isoelectricDelta: Number((pI - basePi).toFixed(2)),
      secondaryStructureHelixPercent: Math.round(helixPercent),
      disorderScore: Number(disorder.toFixed(3)),
      thermostabilityScore: finalScore
    };
  });
}

// ──────────────────────────────── Biophysical Core Calculations ────────────────────────────────

export function calculateGravy(seq: string): number {
  if (seq.length === 0) return 0;
  let sum = 0;
  for (const c of seq) sum += AA_HYDRO_SCALE[c] || 0;
  return Number((sum / seq.length).toFixed(3));
}

export function calculateChargeAtPh(seq: string, pH: number): number {
  const pKa: Record<string, number> = { D: 3.65, E: 4.25, C: 8.18, Y: 10.07, H: 6.0, K: 10.53, R: 12.48 };
  let charge = 0.0;
  
  // N-terminus
  charge += 1.0 / (1.0 + Math.pow(10, pH - 8.0));
  // C-terminus
  charge -= 1.0 / (1.0 + Math.pow(10, 3.1 - pH));

  for (const c of seq) {
    if (c === "K" || c === "R") {
      charge += 1.0 / (1.0 + Math.pow(10, pH - pKa[c]));
    } else if (c === "D" || c === "E" || c === "C" || c === "Y") {
      charge -= 1.0 / (1.0 + Math.pow(10, pKa[c] - pH));
    } else if (c === "H") {
      charge += 1.0 / (1.0 + Math.pow(10, pH - 6.0));
    }
  }
  return Number(charge.toFixed(2));
}

export function calculatePI(seq: string): number {
  let low = 0.0;
  let high = 14.0;
  let pi = 7.0;
  for (let i = 0; i < 15; i++) {
    pi = (low + high) / 2;
    const charge = calculateChargeAtPh(seq, pi);
    if (charge > 0) low = pi;
    else high = pi;
  }
  return Number(pi.toFixed(2));
}

export function calculateLocalDisorderFoldIndex(aaSeq: string, windowSize = 21): number {
  const seq = aaSeq.toUpperCase();
  const len = seq.length;
  if (len === 0) return 0;

  let disorderedResidues = 0;
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < len; i++) {
    let netChargeSum = 0;
    let hydroSum = 0;
    let count = 0;

    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < len) {
        const aa = seq[idx];
        if (aa === "K" || aa === "R") netChargeSum += 1;
        if (aa === "D" || aa === "E") netChargeSum -= 1;
        
        const kd = AA_HYDRO_SCALE[aa] || 0;
        const normalizedKd = (kd + 4.5) / 9.0; // scale -4.5..4.5 to 0..1
        hydroSum += normalizedKd;
        count++;
      }
    }

    const meanCharge = Math.abs(netChargeSum / count);
    const meanHydro = hydroSum / count;
    
    // FoldIndex phase boundary formula
    const foldIndex = 2.785 * meanHydro - meanCharge - 1.151;
    if (foldIndex < 0) {
      disorderedResidues++;
    }
  }
  return disorderedResidues / len;
}
