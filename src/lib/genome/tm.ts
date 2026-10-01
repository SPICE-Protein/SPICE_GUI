// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import { getComplementSequenceString } from "./sequence";
import { calculatePercentGC } from "./sequence";

// ---- SantaLucia (1998) nearest-neighbor parameters (Primer3) ----
export const SANTA_LUCIA_NN: Record<string, { dH: number; dS: number }> = {
  AA: { dH: -7.9, dS: -22.2 },
  TT: { dH: -7.9, dS: -22.2 },
  AT: { dH: -7.2, dS: -20.4 },
  TA: { dH: -7.2, dS: -21.3 },
  CA: { dH: -8.5, dS: -22.7 },
  TG: { dH: -8.5, dS: -22.7 },
  GT: { dH: -8.4, dS: -22.4 },
  AC: { dH: -8.4, dS: -22.4 },
  CT: { dH: -7.8, dS: -21.0 },
  AG: { dH: -7.8, dS: -21.0 },
  GA: { dH: -8.2, dS: -22.2 },
  TC: { dH: -8.2, dS: -22.2 },
  CG: { dH: -10.6, dS: -27.2 },
  GC: { dH: -9.8, dS: -24.4 },
  GG: { dH: -8.0, dS: -19.9 },
  CC: { dH: -8.0, dS: -19.9 }
};

export const SANTA_LUCIA_INIT: Record<string, { dH: number; dS: number }> = {
  GC: { dH: 0.1, dS: -2.8 },
  AT: { dH: 2.3, dS: 4.1 }
};

const PRIMER3_PARAMS = {
  saltMonovalent: 50.0,
  saltDivalent: 1.5,
  dntpConc: 0.6,
  dnaConc: 50.0,
  R: 1.987
};

function getEffectiveMonovalentConc(): number {
  let effectiveMono = PRIMER3_PARAMS.saltMonovalent;
  if (PRIMER3_PARAMS.saltDivalent > 0) {
    const freeMg = Math.max(0, PRIMER3_PARAMS.saltDivalent - PRIMER3_PARAMS.dntpConc);
    effectiveMono += 120 * Math.sqrt(freeMg);
  }
  return effectiveMono;
}

function applySaltCorrection(deltaS: number, nnPairs: number): number {
  const effectiveMono = getEffectiveMonovalentConc();
  return deltaS + 0.368 * nnPairs * Math.log(effectiveMono / 1000);
}

export function isValidSequence(sequence: string): boolean {
  return /^[ATGCN]+$/.test(sequence);
}

/**
 * Primer3 SantaLucia (1998) melting temperature in °C.
 */
export function calculateSantaLuciaTm(sequence: string): number | string {
  try {
    let seq = sequence?.toUpperCase().trim();
    if (!isValidSequence(seq)) {
      throw new Error("Invalid sequence: contains non-DNA characters");
    }
    if (seq.length < 2) {
      throw new Error("Sequence too short: minimum length is 2 bases");
    }

    let deltaH = 0;
    let deltaS = 0;

    for (let i = 0; i < seq.length - 1; i++) {
      const dinucleotide = seq.substring(i, i + 2);
      if (dinucleotide.includes("N")) continue;
      const params = SANTA_LUCIA_NN[dinucleotide];
      if (params) {
        deltaH += params.dH;
        deltaS += params.dS;
      }
    }

    const firstBase = seq[0];
    const lastBase = seq[seq.length - 1];

    if (firstBase === "G" || firstBase === "C") {
      deltaH += SANTA_LUCIA_INIT.GC.dH;
      deltaS += SANTA_LUCIA_INIT.GC.dS;
    } else {
      deltaH += SANTA_LUCIA_INIT.AT.dH;
      deltaS += SANTA_LUCIA_INIT.AT.dS;
    }
    if (lastBase === "G" || lastBase === "C") {
      deltaH += SANTA_LUCIA_INIT.GC.dH;
      deltaS += SANTA_LUCIA_INIT.GC.dS;
    } else {
      deltaH += SANTA_LUCIA_INIT.AT.dH;
      deltaS += SANTA_LUCIA_INIT.AT.dS;
    }

    const nnPairs = seq.length - 1;
    deltaS = applySaltCorrection(deltaS, nnPairs);

    const C = PRIMER3_PARAMS.dnaConc * 1e-9;
    const Tm = (deltaH * 1000) / (deltaS + PRIMER3_PARAMS.R * Math.log(C / 4));
    return Tm - 273.15;
  } catch (e) {
    return `Error calculating Tm for sequence ${sequence}. ${e}`;
  }
}

/**
 * NEB Tm calculator (SantaLucia 1998 + Owczarzy 2004 salt correction).
 */
export function calculateNebTm(
  sequence: string,
  { monovalentCationConc = 0.05, primerConc = 0.0000005 } = {}
): number | string {
  try {
    if (/[^atgc]/i.test(sequence)) {
      throw new Error(`Degenerate bases prohibited in Tm calculation of sequence ${sequence}`);
    }
    const seq = sequence.toUpperCase().split("");
    let h = 0;
    let s = 0;
    let hi = 0;
    let si = 0;
    const r = 1.987;
    const kelvinToCelsius = -273.15;
    const celsiusToKelvin = 273.15;
    const kilocalToCal = 1000;
    const sequenceToEnthalpyMap: Record<string, number> = {
      "AA/TT": -7.9, "AT/TA": -7.2, "TA/AT": -7.2, "CA/GT": -8.5,
      "GT/CA": -8.4, "CT/GA": -7.8, "GA/CT": -8.2, "CG/GC": -10.6,
      "GC/CG": -9.8, "GG/CC": -8.0, "TT/AA": -7.9, "TG/AC": -8.5,
      "AC/TG": -8.4, "AG/TC": -7.8, "TC/AG": -8.2, "CC/GG": -8.0,
      initiationWithTerminalGC: 0.1,
      initiationWithTerminalAT: 2.3
    };
    const sequenceToEntropyMap: Record<string, number> = {
      "AA/TT": -22.2, "AT/TA": -20.4, "TA/AT": -21.3, "CA/GT": -22.7,
      "GT/CA": -22.4, "CT/GA": -21.0, "GA/CT": -22.2, "CG/GC": -27.2,
      "GC/CG": -24.4, "GG/CC": -19.9, "TT/AA": -22.2, "TG/AC": -22.7,
      "AC/TG": -22.4, "AG/TC": -21.0, "TC/AG": -22.2, "CC/GG": -19.9,
      initiationWithTerminalGC: -2.8,
      initiationWithTerminalAT: 4.1
    };
    for (let i = 0; i < seq.length; i++) {
      if (i === 0 || i === seq.length - 1) {
        if (seq[i] === "G" || seq[i] === "C") {
          hi += sequenceToEnthalpyMap.initiationWithTerminalGC;
          si += sequenceToEntropyMap.initiationWithTerminalGC;
        } else if (seq[i] === "A" || seq[i] === "T") {
          hi += sequenceToEnthalpyMap.initiationWithTerminalAT;
          si += sequenceToEntropyMap.initiationWithTerminalAT;
        }
      }
      if (i < seq.length - 1) {
        const dimer = seq[i] + seq[i + 1];
        const complement = getComplementSequenceString(dimer).toUpperCase();
        const dimerDuplex = `${dimer}/${complement}`;
        if (!sequenceToEnthalpyMap[dimerDuplex] || !sequenceToEntropyMap[dimerDuplex]) {
          throw new Error(`Could not find value for ${dimerDuplex} of sequence ${sequence}`);
        }
        h += sequenceToEnthalpyMap[dimerDuplex];
        s += sequenceToEntropyMap[dimerDuplex];
      }
    }
    const deltaH = h + hi;
    const deltaS = s + si;
    const numerator = deltaH * kilocalToCal;
    const denominator = deltaS + r * Math.log(primerConc);
    const meltingTemp = numerator / denominator + kelvinToCelsius;
    if (monovalentCationConc) {
      const lnOfMonoConc = Math.log(monovalentCationConc);
      const gcContent = calculatePercentGC(sequence) / 100;
      const part = 4.29 * gcContent - 3.95;
      const saltCorrection =
        part * Math.pow(10, -5) * lnOfMonoConc + Math.pow(9.4, -6) * Math.pow(lnOfMonoConc, 2);
      return 1 / (1 / (meltingTemp + celsiusToKelvin) + saltCorrection) + kelvinToCelsius;
    }
    return meltingTemp;
  } catch (err) {
    return `Error calculating Tm for sequence ${sequence}: ${err}`;
  }
}

export type PolymeraseName = "Q5" | "Taq" | "Phusion" | "Other";

/**
 * NEB annealing temperature for a pair of primers.
 */
export function calculateNebTa(
  sequences: string[],
  primerConc?: number,
  { monovalentCationConc, polymerase }: { monovalentCationConc?: number; polymerase?: PolymeraseName } = {}
): number | string {
  try {
    if (sequences.length !== 2) {
      throw new Error(`${sequences.length} sequences received when 2 primers were expected`);
    }
    const meltingTemperatures = sequences.map((seq) =>
      calculateNebTm(seq, { monovalentCationConc, primerConc })
    );
    if (meltingTemperatures.some((t) => typeof t === "string")) {
      throw new Error("could not compute Tm for one of the primers");
    }
    const sorted = (meltingTemperatures as number[]).slice().sort((a, b) => a - b);
    const lowerMeltingTemp = sorted[0];
    let annealingTemp: number;
    if (polymerase === "Q5") {
      annealingTemp = lowerMeltingTemp + 1;
      if (annealingTemp > 72) annealingTemp = 72;
    } else {
      annealingTemp = lowerMeltingTemp - 3;
    }
    return annealingTemp;
  } catch (err) {
    return `Error calculating annealing temperature: ${err}`;
  }
}

/**
 * 3' end stability (max delta G of the last 5 3' bases), kcal/mol.
 */
export function calculateEndStability(sequence: string): number | string {
  try {
    let seq = sequence?.toUpperCase().trim();
    if (!isValidSequence(seq)) {
      throw new Error("Invalid sequence: contains non-DNA characters");
    }
    if (seq.length < 5) {
      throw new Error("Sequence too short: minimum length is 5 bases for end stability calculation");
    }
    const last5Bases = seq.substring(seq.length - 5);
    let deltaH = 0;
    let deltaS = 0;
    for (let i = 0; i < 4; i++) {
      const dinucleotide = last5Bases.substring(i, i + 2);
      if (dinucleotide.includes("N")) continue;
      const params = SANTA_LUCIA_NN[dinucleotide];
      if (params) {
        deltaH += params.dH;
        deltaS += params.dS;
      }
    }
    const firstBase = last5Bases[0];
    const lastBase = last5Bases[last5Bases.length - 1];
    if (firstBase === "G" || firstBase === "C") {
      deltaH += SANTA_LUCIA_INIT.GC.dH;
      deltaS += SANTA_LUCIA_INIT.GC.dS;
    } else {
      deltaH += SANTA_LUCIA_INIT.AT.dH;
      deltaS += SANTA_LUCIA_INIT.AT.dS;
    }
    if (lastBase === "G" || lastBase === "C") {
      deltaH += SANTA_LUCIA_INIT.GC.dH;
      deltaS += SANTA_LUCIA_INIT.GC.dS;
    } else {
      deltaH += SANTA_LUCIA_INIT.AT.dH;
      deltaS += SANTA_LUCIA_INIT.AT.dS;
    }
    return Math.round((deltaH + deltaS / 1000) * 100) / 100;
  } catch (e) {
    return `Error calculating end stability for sequence ${sequence}: ${e}`;
  }
}

/** Alias for calculateNebTm to match tg-oss API. */
export const calculateTm = calculateNebTm;
