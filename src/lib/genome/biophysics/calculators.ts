/**
 * SPICE Molecular Biology & PCR Reaction Calculators (Feature 5)
 * 
 * Provides stoichiometric and biophysical calculations for PCR master mixes, 
 * primer dilutions, cohesive/blunt ligation molar ratios, and double digests.
 */

import * as m from "$lib/paraglide/messages.js";
export interface DilutionInput {
  sourceConc: number;      // e.g. 100 uM
  targetConc: number;      // e.g. 10 uM
  targetVol: number;       // e.g. 50 uL
}

export interface DilutionResult {
  sourceVol: number;       // uL of source
  waterVol: number;        // uL of water/buffer
}

export interface LigationInput {
  vectorSizeBp: number;    // bp, e.g. 5000
  insertSizeBp: number;    // bp, e.g. 1000
  vectorMassNg: number;    // ng, e.g. 100
  molarRatio: number;      // e.g. 3 (for 3:1 insert:vector ratio)
}

export interface PcrMixInput {
  reactionsCount: number;  // number of wells
  totalVolume: number;     // volume per reaction, e.g. 50 uL
  polymeraseType: "Taq" | "Phusion" | "Q5";
}

export interface PcrMixRow {
  component: string;
  volumePerWell: number;   // uL
  totalVolume: number;     // uL (with 10% pipetting excess)
}

/**
 * Calculates dilution metrics: C1 * V1 = C2 * V2
 */
export function calculateDilution(input: DilutionInput): DilutionResult {
  const { sourceConc, targetConc, targetVol } = input;
  if (sourceConc <= 0 || targetConc <= 0 || targetConc > sourceConc || targetVol <= 0) {
    return { sourceVol: 0, waterVol: targetVol };
  }
  const sourceVol = (targetConc * targetVol) / sourceConc;
  const waterVol = Math.max(0, targetVol - sourceVol);
  return {
    sourceVol: Number(sourceVol.toFixed(2)),
    waterVol: Number(waterVol.toFixed(2))
  };
}

/**
 * Calculates the exact insert mass needed for a ligation reaction:
 * Mass_insert = Mass_vector * (Size_insert / Size_vector) * Molar_Ratio
 */
export function calculateLigationMass(input: LigationInput): number {
  const { vectorSizeBp, insertSizeBp, vectorMassNg, molarRatio } = input;
  if (vectorSizeBp <= 0 || insertSizeBp <= 0 || vectorMassNg <= 0 || molarRatio <= 0) {
    return 0;
  }
  const mass = vectorMassNg * (insertSizeBp / vectorSizeBp) * molarRatio;
  return Number(mass.toFixed(1));
}

/**
 * Dynamically builds a standard PCR reaction setup table with a 10% pipetting excess buffer.
 */
export function calculatePcrMasterMix(input: PcrMixInput): PcrMixRow[] {
  const { reactionsCount, totalVolume, polymeraseType } = input;
  const excessFactor = 1.10; // 10% safety margin for pipetting
  const totalMult = reactionsCount * excessFactor;

  const rows: PcrMixRow[] = [];

  if (polymeraseType === "Q5") {
    // 50 uL typical Q5 reaction
    const scale = totalVolume / 50;
    rows.push({ component: "2X Q5 High-Fidelity Master Mix", volumePerWell: 25 * scale, totalVolume: 25 * scale * totalMult });
    rows.push({ component: "10 uM Forward Primer", volumePerWell: 2.5 * scale, totalVolume: 2.5 * scale * totalMult });
    rows.push({ component: "10 uM Reverse Primer", volumePerWell: 2.5 * scale, totalVolume: 2.5 * scale * totalMult });
    rows.push({ component: "Template DNA (1-10 ng)", volumePerWell: 2 * scale, totalVolume: 2 * scale * totalMult });
    rows.push({ component: "Nuclease-Free Water", volumePerWell: 18 * scale, totalVolume: 18 * scale * totalMult });
  } else if (polymeraseType === "Phusion") {
    // 50 uL typical Phusion reaction
    const scale = totalVolume / 50;
    rows.push({ component: "5X Phusion HF Buffer", volumePerWell: 10 * scale, totalVolume: 10 * scale * totalMult });
    rows.push({ component: "10 mM dNTPs", volumePerWell: 1.0 * scale, totalVolume: 1 * scale * totalMult });
    rows.push({ component: "10 uM Forward Primer", volumePerWell: 2.5 * scale, totalVolume: 2.5 * scale * totalMult });
    rows.push({ component: "10 uM Reverse Primer", volumePerWell: 2.5 * scale, totalVolume: 2.5 * scale * totalMult });
    rows.push({ component: "Phusion DNA Polymerase", volumePerWell: 0.5 * scale, totalVolume: 0.5 * scale * totalMult });
    rows.push({ component: "Template DNA", volumePerWell: 2 * scale, totalVolume: 2 * scale * totalMult });
    rows.push({ component: "Nuclease-Free Water", volumePerWell: 31.5 * scale, totalVolume: 31.5 * scale * totalMult });
  } else {
    // Standard Taq polymerase setup
    const scale = totalVolume / 50;
    rows.push({ component: "10X Taq Buffer with MgCl2", volumePerWell: 5 * scale, totalVolume: 5 * scale * totalMult });
    rows.push({ component: "10 mM dNTPs Mix", volumePerWell: 1.0 * scale, totalVolume: 1 * scale * totalMult });
    rows.push({ component: "10 uM Forward Primer", volumePerWell: 1.0 * scale, totalVolume: 1 * scale * totalMult });
    rows.push({ component: "10 uM Reverse Primer", volumePerWell: 1.0 * scale, totalVolume: 1 * scale * totalMult });
    rows.push({ component: "Taq DNA Polymerase", volumePerWell: 0.25 * scale, totalVolume: 0.25 * scale * totalMult });
    rows.push({ component: "Template DNA", volumePerWell: 2 * scale, totalVolume: 2 * scale * totalMult });
    rows.push({ component: "Nuclease-Free Water", volumePerWell: 39.75 * scale, totalVolume: 39.75 * scale * totalMult });
  }

  // Round results for pixel precision
  return rows.map(r => ({
    component: r.component,
    volumePerWell: Number(r.volumePerWell.toFixed(2)),
    totalVolume: Number(r.totalVolume.toFixed(2))
  }));
}

// ──────────────────────────────── 19: DNA Concentration Converter ────────────────────────────────

export interface DnaConcentrationResult {
  nM: number;
  molWt: number;
  ngPerUl: number;
}

/**
 * Converts ng/µL concentration to nM and vice versa based on sequence length.
 */
export function convertDnaConcentration(options: {
  value: number; // raw value to convert
  direction: "ng_to_nM" | "nM_to_ng";
  lengthBp: number;
  isDoubleStranded?: boolean; // dsDNA vs ssDNA/RNA
}): DnaConcentrationResult {
  const { value, direction, lengthBp } = options;
  const isDs = options.isDoubleStranded !== false;

  // Average molecular weight calculation (g/mol)
  // dsDNA: length * 617.96 + 36.04 (approx 660g/mol per basepair)
  // ssDNA: length * 307.0 + 79.0 (approx 330g/mol per base)
  const molWt = isDs ? (lengthBp * 617.96 + 36.04) : (lengthBp * 307.0 + 79.0);

  let nM = 0;
  let ngPerUl = 0;

  if (direction === "ng_to_nM") {
    ngPerUl = value;
    // (ng/uL) / (g/mol) * 10^6 = (ug/mL) / (g/mol) * 10^6 = nM
    nM = (value / molWt) * 1000000;
  } else {
    nM = value;
    // nM * (g/mol) / 10^6 = ng/uL
    ngPerUl = (value * molWt) / 1000000;
  }

  return {
    nM: Number(nM.toFixed(2)),
    molWt: Number(molWt.toFixed(2)),
    ngPerUl: Number(ngPerUl.toFixed(2))
  };
}

// ──────────────────────────────── 20: Gradient PCR Tm Optimizer ────────────────────────────────

export interface GradientPcrColumn {
  column: number;
  temperature: number; // °C
  efficiencyRating: string; // "Poor" | "Optimal" | "Good" | "Suboptimal"
  recommendation: string;
}

/**
 * Calculates temperature distributions across 12-well columns on a gradient thermocycler block 
 * and recommends the best annealing target temperatures.
 */
export function optimizeGradientPcr(
  primer1Tm: number,
  primer2Tm: number,
  minTemp = 50,
  maxTemp = 65
): {
  columns: GradientPcrColumn[];
  optimalTempRange: string;
  bestColumn: number;
} {
  const minTm = Math.min(primer1Tm, primer2Tm);
  const targetAnnealingTemp = minTm - 5.0; // Standard empirical rule: Tm - 5°C

  const columns: GradientPcrColumn[] = [];
  const totalCols = 12;

  // Linear distribution of temperatures from column 1 to 12
  const tempStep = (maxTemp - minTemp) / (totalCols - 1);
  let bestCol = 1;
  let minDiff = Infinity;

  for (let col = 1; col <= totalCols; col++) {
    const temp = minTemp + (col - 1) * tempStep;
    const diff = temp - targetAnnealingTemp;
    
    let efficiencyRating = "Suboptimal";
    let recommendation = m.calcTaLow();

    if (temp < targetAnnealingTemp - 5) {
      efficiencyRating = "Poor";
      recommendation = m.calcTaTooLow();
    } else if (Math.abs(diff) <= 1.5) {
      efficiencyRating = "Optimal";
      recommendation = m.calcTaOptimal();
      if (Math.abs(diff) < minDiff) {
        minDiff = Math.abs(diff);
        bestCol = col;
      }
    } else if (temp > targetAnnealingTemp + 1.5 && temp <= targetAnnealingTemp + 4) {
      efficiencyRating = "Good";
      recommendation = m.calcTaGood();
    } else if (temp > targetAnnealingTemp + 4) {
      efficiencyRating = "Poor";
      recommendation = m.calcTaTooHigh();
    }

    columns.push({
      column: col,
      temperature: Number(temp.toFixed(1)),
      efficiencyRating,
      recommendation
    });
  }

  return {
    columns,
    optimalTempRange: `${(targetAnnealingTemp - 1.5).toFixed(1)}°C - ${(targetAnnealingTemp + 1.5).toFixed(1)}°C`,
    bestColumn: bestCol
  };
}

// ──────────────────────────────── 21: Gel Band Estimator ────────────────────────────────

export interface GelStandardMarker {
  distanceMm: number;
  sizeBp: number;
}

/**
 * Uses a semi-log linear regression (log10(size) vs distance) calibrated by standard ladder bands 
 * to estimate unknown band molecular weights.
 */
export function estimateGelBandSizes(
  standards: GelStandardMarker[],
  unknownDistances: number[]
): {
  estimatedSizes: number[];
  rSquared: number;
} {
  const n = standards.length;
  if (n < 2) return { estimatedSizes: unknownDistances.map(() => 0), rSquared: 0 };

  // Calculate means
  let sumX = 0; // distance
  let sumY = 0; // log10(size)
  for (const std of standards) {
    sumX += std.distanceMm;
    sumY += Math.log10(std.sizeBp);
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Compute slope (m) and intercept (b): y = m * x + b
  let num = 0;
  let den = 0;
  for (const std of standards) {
    const x = std.distanceMm;
    const y = Math.log10(std.sizeBp);
    num += (x - meanX) * (y - meanY);
    den += Math.pow(x - meanX, 2);
  }

  const slope = den !== 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R^2 coefficient of determination
  let totalSS = 0;
  let residualSS = 0;
  for (const std of standards) {
    const y = Math.log10(std.sizeBp);
    const predictedY = slope * std.distanceMm + intercept;
    totalSS += Math.pow(y - meanY, 2);
    residualSS += Math.pow(y - predictedY, 2);
  }
  const rSquared = totalSS !== 0 ? 1 - (residualSS / totalSS) : 0;

  // Predict unknown sizes
  const estimatedSizes = unknownDistances.map(dist => {
    const logSize = slope * dist + intercept;
    return Math.round(Math.pow(10, logSize));
  });

  return {
    estimatedSizes,
    rSquared: Number(rSquared.toFixed(4))
  };
}

// ──────────────────────────────── 22: ELISA Standard Curve Fitter ────────────────────────────────

export interface ElisaDataPoint {
  concentration: number;
  odValue: number;
}

/**
 * Fits a 4-Parameter Logistic (4PL) regression model to ELISA standard points 
 * and back-calculates unknown concentrations.
 * 4PL: y = d + (a - d) / (1 + (x / c)^b)
 */
export function fitElisaStandardCurve(
  standards: ElisaDataPoint[],
  unknownOds: number[]
): {
  fittedConcentrations: number[];
  parameters: { a: number; b: number; c: number; d: number };
  rSquared: number;
} {
  // Since non-linear Marquardt-Levenberg estimation is heavy in client browser JS,
  // we use a highly robust log-logit linear transformation fallback for calibration:
  // logit(y_scaled) = b * log10(x) - b * log10(c)
  // Standard limits
  const ods = standards.map(s => s.odValue);
  const minOd = Math.min(...ods);
  const maxOd = Math.max(...ods);

  // Estimating asymptotes a (min response) and d (max response)
  const a = minOd * 0.95;
  const d = maxOd * 1.05;

  const validStandards = standards.filter(s => s.odValue > a && s.odValue < d && s.concentration > 0);
  const n = validStandards.length;

  if (n < 2) {
    return {
      fittedConcentrations: unknownOds.map(() => 0),
      parameters: { a, b: 1, c: 1, d },
      rSquared: 0
    };
  }

  // Linear regression over log-logit space
  let sumX = 0; // log10(conc)
  let sumY = 0; // logit((y - a)/(d - a))
  
  const transformedPoints = validStandards.map(s => {
    const yScaled = (s.odValue - a) / (d - a);
    return {
      x: Math.log10(s.concentration),
      y: Math.log(yScaled / (1 - yScaled))
    };
  });

  for (const p of transformedPoints) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let den = 0;
  for (const p of transformedPoints) {
    num += (p.x - meanX) * (p.y - meanY);
    den += Math.pow(p.x - meanX, 2);
  }

  const b = den !== 0 ? num / den : 1; // Hill slope
  const intercept = meanY - b * meanX;
  const c = Math.pow(10, -intercept / b); // EC50 (inflection point c)

  // Calculate back-fitted concentrations for unknown samples
  const fittedConcentrations = unknownOds.map(od => {
    // Clamp OD within bounds to prevent Infinity log calculation
    const clampedOd = Math.max(a + 0.001, Math.min(d - 0.001, od));
    const yScaled = (clampedOd - a) / (d - a);
    const logitY = Math.log(yScaled / (1 - yScaled));
    
    // x = log10(conc) = (logit(y) - intercept) / b
    const logConc = (logitY - intercept) / b;
    return Number(Math.pow(10, logConc).toFixed(3));
  });

  // Calculate R^2 back-fit accuracy
  let totalVar = 0;
  let residualVar = 0;
  const meanOd = ods.reduce((s, v) => s + v, 0) / ods.length;
  
  for (const s of standards) {
    const predictedOd = d + (a - d) / (1 + Math.pow(s.concentration / c, b));
    totalVar += Math.pow(s.odValue - meanOd, 2);
    residualVar += Math.pow(s.odValue - predictedOd, 2);
  }
  const rSquared = totalVar !== 0 ? 1 - (residualVar / totalVar) : 1;

  return {
    fittedConcentrations,
    parameters: { a: Number(a.toFixed(3)), b: Number(b.toFixed(3)), c: Number(c.toFixed(3)), d: Number(d.toFixed(3)) },
    rSquared: Number(Math.min(1, rSquared).toFixed(4))
  };
}

// ──────────────────────────────── 23: Enzyme Kinetics Calculator ────────────────────────────────

export interface EnzymeKineticsPoint {
  substrateConc: number; // [S] in mM or uM
  velocity: number; // v in uM/min
}

export interface EnzymeKineticsResult {
  vMax: number;
  kM: number;
  rSquared: number;
  fittedVelocities: number[];
}

/**
 * Fits substrate-velocity data points using the Michaelis-Menten model 
 * via Lineweaver-Burk double reciprocal transformation.
 */
export function calculateEnzymeKinetics(points: EnzymeKineticsPoint[]): EnzymeKineticsResult {
  const validPoints = points.filter(p => p.substrateConc > 0 && p.velocity > 0);
  const n = validPoints.length;

  if (n < 2) return { vMax: 0, kM: 0, rSquared: 0, fittedVelocities: points.map(() => 0) };

  // Double reciprocal transform: Y = 1/v, X = 1/[S]
  const xRecip = validPoints.map(p => 1 / p.substrateConc);
  const yRecip = validPoints.map(p => 1 / p.velocity);

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xRecip[i];
    sumY += yRecip[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xRecip[i] - meanX) * (yRecip[i] - meanY);
    den += Math.pow(xRecip[i] - meanX, 2);
  }

  const slope = den !== 0 ? num / den : 1; // Km / Vmax
  const intercept = meanY - slope * meanX; // 1 / Vmax

  // Vmax = 1 / intercept
  const vMax = intercept !== 0 ? 1 / intercept : 0;
  // Km = slope * Vmax
  const kM = slope * vMax;

  // Calculate R^2 fit quality
  let totalSS = 0;
  let residualSS = 0;
  const meanV = validPoints.reduce((s, p) => s + p.velocity, 0) / n;

  const fittedVelocities = points.map(p => {
    if (p.substrateConc <= 0) return 0;
    const v = (vMax * p.substrateConc) / (kM + p.substrateConc);
    return Number(v.toFixed(3));
  });

  for (let i = 0; i < n; i++) {
    const p = validPoints[i];
    const fittedV = (vMax * p.substrateConc) / (kM + p.substrateConc);
    totalSS += Math.pow(p.velocity - meanV, 2);
    residualSS += Math.pow(p.velocity - fittedV, 2);
  }

  const rSquared = totalSS !== 0 ? 1 - (residualSS / totalSS) : 0;

  return {
    vMax: Number(vMax.toFixed(3)),
    kM: Number(kM.toFixed(3)),
    rSquared: Number(rSquared.toFixed(4)),
    fittedVelocities
  };
}

