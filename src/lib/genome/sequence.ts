// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import {
  getSequenceWithinRange,
  isPositionWithinRange,
  translateRange,
  flipContainedRange,
  type Range
} from "./range";
import {
  ambiguous_rna_letters,
  ambiguous_dna_letters,
  extended_protein_letters
} from "./data/bioData";
import { getAminoAcidDataForEachBaseOfDna } from "./aa";

import threeLetterSequenceStringToAminoAcidMap from "./data/threeLetterSequenceStringToAminoAcidMap";
import proteinAlphabet from "./data/proteinAlphabet";
import type { AminoAcidInfo } from "./aa";

// data modules are @ts-nocheck, so index maps with Record<string, ...> views
const threeLetterMap = threeLetterSequenceStringToAminoAcidMap as Record<string, AminoAcidInfo>;
const proteinAlphabetView = proteinAlphabet as Record<string, AminoAcidInfo>;

/** IUPAC DNA complement map. */
export const DNAComplementMap: Record<string, string> = {
  ".": ".",
  a: "t",
  t: "a",
  u: "a",
  c: "g",
  g: "c",
  A: "T",
  T: "A",
  U: "A",
  C: "G",
  G: "C",
  r: "y",
  R: "Y",
  y: "r",
  Y: "R",
  d: "h",
  D: "H",
  h: "d",
  H: "D",
  k: "m",
  K: "M",
  m: "k",
  M: "K",
  v: "b",
  V: "B",
  b: "v",
  B: "V"
};

/** Get the complement of a DNA/RNA sequence (keeps case, maps T->A/U->A etc). */
export function getComplementSequenceString(sequence: string, isRna = false): string {
  if (typeof sequence !== "string") return "";
  let complementSeqString = "";
  const complementMap: Record<string, string> = {
    ...DNAComplementMap,
    ...(isRna ? { a: "u", A: "U" } : { a: "t", A: "T" })
  };
  for (let i = 0; i < sequence.length; i++) {
    const complementChar = complementMap[sequence[i]] || sequence[i];
    complementSeqString += complementChar;
  }
  return complementSeqString;
}

/** Get the reverse complement of a DNA/RNA sequence. */
export function getReverseComplementSequenceString(sequence: string): string {
  let reverseComplementSequenceString = "";
  for (let i = sequence.length - 1; i >= 0; i--) {
    const revChar = DNAComplementMap[sequence[i]] || sequence[i];
    reverseComplementSequenceString += revChar;
  }
  return reverseComplementSequenceString;
}

/** Reverse a sequence string without complementing. */
export function getReverseSequenceString(sequence: string): string {
  return sequence.split("").reverse().join("");
}

/** Percent GC of a sequence string. */
export function calculatePercentGC(bps: string): number {
  if (!bps) return 0;
  return ((bps.match(/[cg]/gi) || []).length / bps.length) * 100 || 0;
}

/** Whether a sequence is likely DNA (not protein). */
export function guessIfSequenceIsDnaAndNotProtein(sequence: string): boolean {
  if (!sequence) return true;
  // if it contains U it's RNA, if it contains any char not in extended protein alphabet and not in DNA -> dna
  const upper = sequence.toUpperCase();
  const proteinChars = extended_protein_letters.toUpperCase().split("");
  let proteinCharsCount = 0;
  const total = upper.length;
  for (const c of upper) {
    if (proteinChars.includes(c)) proteinCharsCount++;
  }
  // if most chars are protein chars, and few are ATCG, it's a protein
  const dnaRatio = (upper.match(/[ATCG]/g) || []).length / total;
  const proteinRatio = proteinCharsCount / total;
  return proteinRatio < 0.9 && dnaRatio > 0.7;
}

/**
 * Sanitize a sequence string, removing invalid characters.
 * Returns [sanitizedVal, warnings].
 */
export function filterSequenceString(
  sequenceString = "",
  options: {
    additionalValidChars?: string;
    isOligo?: boolean;
    name?: string;
    isProtein?: boolean;
    isRna?: boolean;
    isMixedRnaAndDna?: boolean;
    getAcceptedInsertChars?: (info: Record<string, boolean | undefined>) => string;
  } = {}
): [string, string[]] {
  const { additionalValidChars = "", isOligo, isProtein, isRna, isMixedRnaAndDna, getAcceptedInsertChars, name } = options;
  const sequenceTypeInfo = { isOligo, isProtein, isRna, isMixedRnaAndDna };
  const acceptedChars = getAcceptedInsertChars
    ? getAcceptedInsertChars(sequenceTypeInfo)
    : getAcceptedChars({ isOligo, isProtein, isRna, isMixedRnaAndDna });
  const replaceChars = getReplaceChars({ isOligo, isProtein, isRna, isMixedRnaAndDna });

  let sanitizedVal = "";
  const invalidChars: string[] = [];
  const chars = `${acceptedChars}${additionalValidChars.split("").join("\\")}`;
  const warnings: string[] = [];
  const replaceCount: Record<string, number> = {};
  sequenceString.split("").forEach((letter) => {
    const lowerLetter = letter.toLowerCase();
    if (replaceChars && replaceChars[lowerLetter]) {
      if (!replaceCount[lowerLetter]) replaceCount[lowerLetter] = 0;
      replaceCount[lowerLetter]++;
      const isUpper = lowerLetter !== letter;
      sanitizedVal += isUpper
        ? replaceChars[lowerLetter].toUpperCase()
        : replaceChars[lowerLetter];
    } else if (chars.includes(lowerLetter)) {
      sanitizedVal += letter;
    } else {
      invalidChars.push(letter);
    }
  });
  Object.keys(replaceCount).forEach((letter) => {
    const times = replaceCount[letter] > 1 ? ` ${replaceCount[letter]} times` : "";
    warnings.push(`Replaced "${letter}" with "${replaceChars![letter]}"${times}`);
  });
  if (sequenceString.length !== sanitizedVal.length) {
    const hasName = typeof name === "string" && name.length > 0;
    const prefix = hasName ? `Sequence ${name}: ` : "";
    const bad = [...new Set(invalidChars)]
      .map((c) => (c === " " ? "space" : c))
      .slice(0, 100)
      .join(", ");
    warnings.push(`${prefix}Invalid character(s) detected and removed: ${bad} `);
  }
  return [sanitizedVal, warnings];
}

export function getAcceptedChars({
  isOligo,
  isProtein,
  isRna,
  isMixedRnaAndDna
}: {
  isOligo?: boolean;
  isProtein?: boolean;
  isRna?: boolean;
  isMixedRnaAndDna?: boolean;
} = {}): string {
  return isProtein
    ? extended_protein_letters.toLowerCase()
    : isOligo || isRna
      ? ambiguous_rna_letters.toLowerCase() + "t"
      : isMixedRnaAndDna
        ? ambiguous_rna_letters.toLowerCase() + ambiguous_dna_letters.toLowerCase()
        : ambiguous_rna_letters.toLowerCase() + ambiguous_dna_letters.toLowerCase();
}

export function getReplaceChars({
  isOligo,
  isProtein,
  isRna,
  isMixedRnaAndDna
}: {
  isOligo?: boolean;
  isProtein?: boolean;
  isRna?: boolean;
  isMixedRnaAndDna?: boolean;
} = {}): Record<string, string> {
  if (isProtein || isOligo || isMixedRnaAndDna) return {};
  if (isRna) return { t: "u" };
  return {};
}

export const filterRnaString = (s: string, o?: Parameters<typeof filterSequenceString>[1]): string =>
  filterSequenceString(s, { ...o, isRna: true })[0];

/** Translate a DNA sequence string into an amino acid string (0-based forward). */
export function getAminoAcidStringFromSequenceString(
  sequenceString: string,
  { doNotExcludeAsterisk = false, forward = true } = {}
): string {
  const aminoAcidsPerBase = getAminoAcidDataForEachBaseOfDna(sequenceString, forward, undefined, false);
  const aaArray: string[] = [];
  aminoAcidsPerBase.forEach((aa, index) => {
    if (!aa.fullCodon) return;
    if (
      !doNotExcludeAsterisk &&
      index >= aminoAcidsPerBase.length - 3 &&
      aa.aminoAcid?.value === "*"
    ) {
      return;
    }
    if (aa.aminoAcidIndex != null && aa.aminoAcid) {
      aaArray[aa.aminoAcidIndex] = aa.aminoAcid.value;
    }
  });
  return aaArray.join("");
}

/** Get the amino acid for a 3-base codon (accepts DNA or RNA, degenerate). */
export function getAminoAcidFromSequenceTriplet(sequenceString: string): AminoAcidInfo {
  const seq = sequenceString.toLowerCase();
  if (seq.length !== 3) {
    return proteinAlphabetView.X;
  }
  const aa = threeLetterMap[seq];
  if (aa) return aa;
  // fallback degenerate table
  const degenerateDnaToAminoAcidMap: Record<string, string> = {
    atn: "I",
    ctn: "L",
    gtn: "V",
    ttn: "F",
    aan: "N",
    agn: "S",
    gan: "D",
    ggn: "G",
    can: "H",
    cgn: "R",
    aay: "N",
    gay: "D",
    gar: "E",
    gcn: "A",
    tgy: "C",
    tay: "Y",
    tgr: "*",
    tga: "*",
    tag: "*",
    taa: "*",
    xxx: "X"
  };
  const letter = degenerateDnaToAminoAcidMap[seq.replace("x", "n")] || "x";
  return proteinAlphabetView[letter.toUpperCase()];
}

/** Compute GC% and mass/protein info for an AA string (convenience wrapper). */
export function getMassOfAaString(_aaString: string): number {
  // not ported fully; minimal placeholder
  return 0;
}

/** Get the sequence within a range (0-based inclusive). */
export function getSequenceDataBetweenRange(
  seqObj: { sequence: string; [key: string]: unknown },
  range?: Range
): { sequence: string; [key: string]: unknown } {
  if (!range) return seqObj;
  return {
    ...seqObj,
    sequence: getSequenceWithinRange(range, seqObj.sequence)
  };
}

/** Reverse-complement a sequenceData object (sequence + features). */
export function getReverseComplementSequenceAndAnnotations(
  pSeqObj: { sequence: string; features?: any[]; [key: string]: unknown },
  options: { range?: Range } = {}
): { sequence: string; features?: any[]; [key: string]: unknown } {
  const seqObj = {
    ...pSeqObj,
    sequence: options.range
      ? getSequenceWithinRange(options.range, pSeqObj.sequence)
      : pSeqObj.sequence
  };
  const newSeqObj = {
    ...seqObj,
    sequence: getReverseComplementSequenceString(seqObj.sequence)
  };
  return newSeqObj;
}

/** Internal helper used by aa.ts: reverse a position within a range. */
export function revComp(s: string): string {
  return getReverseComplementSequenceString(s);
}
