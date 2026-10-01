// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import {
  getSequenceWithinRange,
  isPositionWithinRange,
  translateRange,
  flipContainedRange,
  type Range
} from "./range";
import { getReverseComplementSequenceString } from "./sequence";

import proteinAlphabet from "./data/proteinAlphabet";
import threeLetterSequenceStringToAminoAcidMap from "./data/threeLetterSequenceStringToAminoAcidMap";

// data modules are @ts-nocheck, so index maps with Record<string, ...> views
const proteinAlphabetView = proteinAlphabet as Record<string, AminoAcidInfo>;
const threeLetterMap = threeLetterSequenceStringToAminoAcidMap as Record<string, AminoAcidInfo>;

export interface AminoAcidInfo {
  value: string;
  name: string;
  threeLettersName: string;
  hydrophobicity?: number;
  colorByFamily?: string;
  color?: string;
  mass?: number;
}

export interface AminoAcidDataForBase {
  aminoAcid: AminoAcidInfo | null;
  positionInCodon: number | null;
  aminoAcidIndex: number | null;
  sequenceIndex: number;
  codonRange: Range | null;
  fullCodon: boolean | null;
}

/**
 * Get the next triplet of bases in the sequenceString, skipping intron (non-exon) bases.
 */
function getNextTriplet(
  index: number,
  sequenceString: string,
  exonRange: Range[]
): { triplet: string; basesRead: number; codonPositions: number[] } {
  let triplet = "";
  let internalIndex: number;
  const codonPositions: number[] = [];

  const isBaseInExon = (baseIndex: number) =>
    exonRange.some((r) =>
      isPositionWithinRange(baseIndex, r, sequenceString.length, true, false)
    );

  for (internalIndex = index; internalIndex < sequenceString.length; internalIndex++) {
    if (triplet.length === 3) break;
    if (isBaseInExon(internalIndex)) {
      triplet += sequenceString[internalIndex];
      codonPositions.push(internalIndex);
    }
  }
  return { triplet, basesRead: internalIndex - index, codonPositions };
}

interface TranslationProperties {
  sequenceString: string;
  translationRange: Range;
  sequenceStringLength: number;
  originalSequenceStringLength: number;
  exonRange: Range[];
}

function getTranslatedSequenceProperties(
  originalSequenceString: string,
  forward: boolean,
  optionalSubrangeRange?: Range & { locations?: Range[] },
  isProteinSequence = false
): TranslationProperties {
  const originalSequenceStringLength = isProteinSequence
    ? originalSequenceString.length * 3
    : originalSequenceString.length;

  let sequenceString = originalSequenceString;
  const translationRange: Range = { start: 0, end: originalSequenceStringLength - 1 };

  if (optionalSubrangeRange) {
    sequenceString = getSequenceWithinRange(optionalSubrangeRange, originalSequenceString);
    translationRange.start = optionalSubrangeRange.start;
    translationRange.end = optionalSubrangeRange.end;
  }

  const sequenceStringLength = isProteinSequence
    ? sequenceString.length * 3
    : sequenceString.length;

  if (!isProteinSequence && !forward) {
    sequenceString = getReverseComplementSequenceString(sequenceString);
  }

  const absoluteExonRange: Range[] =
    !isProteinSequence && optionalSubrangeRange && optionalSubrangeRange.locations
      ? optionalSubrangeRange.locations
      : [translationRange];

  const exonRange = absoluteExonRange.map((range) => {
    let outputRange = translateRange(range, -translationRange.start, originalSequenceStringLength);
    if (!forward) {
      outputRange = flipContainedRange(
        outputRange,
        { start: 0, end: sequenceStringLength - 1 },
        sequenceStringLength
      );
    }
    return outputRange;
  });

  return {
    sequenceString,
    translationRange,
    sequenceStringLength,
    originalSequenceStringLength,
    exonRange
  };
}

function positionInCdsToPositionInMainSequence(
  index: number,
  forward: boolean,
  translationRange: Range,
  mainSequenceLength: number
): number {
  let outputRange = translateRange(
    { start: index, end: index },
    translationRange.start,
    mainSequenceLength
  );
  if (!forward) {
    outputRange = flipContainedRange(outputRange, translationRange, mainSequenceLength);
  }
  return outputRange.start;
}

/** Get the amino acid for a 3-base codon. */
export function getAA(triplet: string): AminoAcidInfo {
  const seq = triplet.toLowerCase();
  const aa = threeLetterMap[seq];
  if (aa) return aa;
  const degenerateDnaToAminoAcidMap: Record<string, string> = {
    atn: "I", ctn: "L", gtn: "V", ttn: "F",
    aan: "N", agn: "S", gan: "D", ggn: "G",
    can: "H", cgn: "R", gcn: "A",
    aay: "N", gay: "D", gar: "E",
    tgy: "C", tay: "Y", tgr: "*",
    tga: "*", tag: "*", taa: "*",
    xxx: "X"
  };
  const letter = degenerateDnaToAminoAcidMap[seq.replace("x", "n")] || "x";
  return proteinAlphabetView[letter.toUpperCase()];
}

/**
 * Gets aminoAcid data for each base of DNA, including position in string and position in codon.
 *
 * @param originalSequenceString DNA (or protein) sequence string
 * @param forward translate forward (true) or reverse (false)
 * @param optionalSubrangeRange restrict translation to this (potentially circular) range
 * @param isProteinSequence pass a protein string instead of DNA
 */
export function getAminoAcidDataForEachBaseOfDna(
  originalSequenceString: string,
  forward = true,
  optionalSubrangeRange?: Range & { locations?: Range[] },
  isProteinSequence = false
): AminoAcidDataForBase[] {
  if (!originalSequenceString) return [];

  const {
    sequenceString,
    translationRange,
    sequenceStringLength,
    originalSequenceStringLength,
    exonRange
  } = getTranslatedSequenceProperties(
    originalSequenceString,
    forward,
    optionalSubrangeRange,
    isProteinSequence
  );

  const aminoAcidDataForEachBaseOfDNA: AminoAcidDataForBase[] = [];

  for (let index = 0; index < sequenceStringLength; index += 3) {
    let aminoAcid: AminoAcidInfo;
    const aminoAcidIndex = Math.floor(index / 3);
    let codonPositionsInCDS: number[];
    let basesRead: number;

    if (isProteinSequence) {
      codonPositionsInCDS = [0, 1, 2].map((i) => index + i);
      basesRead = 3;
      aminoAcid = proteinAlphabetView[sequenceString[index / 3].toUpperCase()];
    } else {
      const { triplet, basesRead: _basesRead, codonPositions } = getNextTriplet(
        index,
        sequenceString,
        exonRange
      );
      basesRead = _basesRead;
      codonPositionsInCDS = codonPositions;
      aminoAcid = triplet.length === 3 ? getAA(triplet) : getAA("xxx");
    }

    const absoluteCodonPositions = codonPositionsInCDS.map((i) =>
      positionInCdsToPositionInMainSequence(
        i,
        forward,
        translationRange,
        originalSequenceStringLength
      )
    );

    const codonRange: Range = forward
      ? {
          start: absoluteCodonPositions[0],
          end: absoluteCodonPositions[codonPositionsInCDS.length - 1]
        }
      : {
          start: absoluteCodonPositions[codonPositionsInCDS.length - 1],
          end: absoluteCodonPositions[0]
        };

    let positionInCodon = 0;
    for (let i = 0; i < basesRead; i++) {
      const posInCds = i + index;
      const sequenceIndex = codonPositionsInCDS.includes(posInCds)
        ? absoluteCodonPositions[codonPositionsInCDS.indexOf(posInCds)]
        : positionInCdsToPositionInMainSequence(
            posInCds,
            forward,
            translationRange,
            originalSequenceStringLength
          );
      if (codonPositionsInCDS.includes(posInCds)) {
        aminoAcidDataForEachBaseOfDNA.push({
          aminoAcid,
          positionInCodon,
          aminoAcidIndex,
          sequenceIndex,
          codonRange,
          fullCodon: codonPositionsInCDS.length === 3
        });
        positionInCodon++;
      } else {
        aminoAcidDataForEachBaseOfDNA.push({
          aminoAcid: null,
          positionInCodon: null,
          aminoAcidIndex: null,
          sequenceIndex,
          codonRange: null,
          fullCodon: null
        });
      }
    }
    index += basesRead - codonPositionsInCDS.length;
  }

  if (!forward) {
    aminoAcidDataForEachBaseOfDNA.reverse();
  }
  return aminoAcidDataForEachBaseOfDNA;
}
