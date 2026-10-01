// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import {
  getRangeLength,
  splitRangeIntoTwoPartsIfItIsCircular,
  getSequenceWithinRange,
  invertRange,
  isPositionWithinRange,
  adjustRangeToDeletionOfAnotherRange,
  adjustRangeToRotation,
  adjustRangeToInsert,
  normalizePositionByRangeLength,
  type Range,
  type CaretPositionOrRange
} from "./range";
import { getReverseComplementSequenceString } from "./sequence";
import { getAminoAcidDataForEachBaseOfDna } from "./aa";
import { getAminoAcidStringFromSequenceString } from "./sequence";
import { cutSequenceByRestrictionEnzyme, type Cutsite, type RestrictionEnzyme } from "./enzymes";

export const annotationTypes = [
  "features",
  "warnings",
  "assemblyPieces",
  "lineageAnnotations",
  "parts",
  "cutsites",
  "orfs",
  "translations",
  "primers",
  "guides"
];

export const modifiableTypes = [
  "features",
  "assemblyPieces",
  "lineageAnnotations",
  "warnings",
  "parts",
  "translations",
  "primers",
  "guides"
];

export interface SequenceData {
  sequence: string;
  circular?: boolean;
  isProtein?: boolean;
  isRna?: boolean;
  proteinSequence?: string;
  size?: number;
  proteinSize?: number;
  name?: string;
  [key: string]: unknown;
}

export interface Orf {
  start: number;
  end: number;
  length: number;
  internalStartCodonIndices: number[];
  frame: number;
  forward: boolean;
  annotationTypePlural: string;
  isOrf: boolean;
  id: string;
  remove?: boolean;
}

let orfIdCounter = 0;
function orfId(): string {
  return `orf_${(orfIdCounter++).toString(36)}_${Date.now().toString(36)}`;
}

/**
 * Find ORFs in a DNA sequence (forward + reverse), optionally circular.
 */
export function getOrfsFromSequence(options: {
  sequence: string;
  minimumOrfSize: number;
  forward: boolean;
  circular: boolean;
  useAdditionalOrfStartCodons?: boolean;
}): Orf[] {
  let sequence = options.sequence;
  const minimumOrfSize = options.minimumOrfSize;
  const forward = options.forward;
  const circular = options.circular;
  const useAdditionalOrfStartCodons = options.useAdditionalOrfStartCodons;

  const originalSequenceLength = sequence.length;
  if (!forward) {
    sequence = getReverseComplementSequenceString(sequence);
  }
  if (circular) {
    sequence += sequence;
  }
  const re = useAdditionalOrfStartCodons
    ? /(?=((?:A[TU]G|G[TU]G|C[TU]G)(?:.{3})*?(?:[TU]AG|[TU]AA|[TU]GA)))/gi
    : /(?=((?:A[TU]G)(?:.{3})*?(?:[TU]AG|[TU]AA|[TU]GA)))/gi;
  let m: RegExpExecArray | null;
  const orfRanges: Orf[] = [];

  while ((m = re.exec(sequence)) !== null) {
    if (m.index === re.lastIndex) {
      re.lastIndex++;
    }
    const orfLength = m[1].length;
    if (orfLength >= minimumOrfSize) {
      const start = m.index;
      let end = orfLength + start - 1;
      if (end >= originalSequenceLength) {
        end -= originalSequenceLength;
      }
      if (start < originalSequenceLength) {
        orfRanges.push({
          start,
          end,
          length: m[1].length,
          internalStartCodonIndices: [],
          frame: start % 3,
          forward,
          annotationTypePlural: "orfs",
          isOrf: true,
          id: orfId()
        });
      }
    }
  }

  const orfEnds: Record<number, number> = {};
  orfRanges.forEach((orf, index) => {
    const indexOfAlreadyExistingOrf = orfEnds[orf.end];
    if (typeof indexOfAlreadyExistingOrf !== "undefined") {
      let internalOrf = orf;
      let containingOrf = orfRanges[indexOfAlreadyExistingOrf];
      if (containingOrf.length < internalOrf.length) {
        internalOrf = orfRanges[indexOfAlreadyExistingOrf];
        containingOrf = orf;
        orfEnds[orf.end] = index;
      }
      const internalStartCodonIndex = forward
        ? internalOrf.start
        : originalSequenceLength - internalOrf.start - 1;
      containingOrf.internalStartCodonIndices = [
        ...containingOrf.internalStartCodonIndices,
        ...internalOrf.internalStartCodonIndices,
        internalStartCodonIndex
      ];
      internalOrf.remove = true;
    } else {
      orfEnds[orf.end] = index;
      if (!forward) {
        const endHolder = orf.end;
        orf.end = originalSequenceLength - orf.start - 1;
        orf.start = originalSequenceLength - endHolder - 1;
      }
    }
  });

  return orfRanges.filter((orf) => !orf.remove);
}

/** Find ORFs in a plasmid (forward + reverse). */
export function findOrfsInPlasmid(
  sequence: string,
  circular: boolean,
  minimumOrfSize: number,
  useAdditionalOrfStartCodons?: boolean,
  isProteinOrOligo?: boolean
): Orf[] {
  if (isProteinOrOligo) return [];
  const forwardOrfs = getOrfsFromSequence({
    sequence,
    minimumOrfSize,
    forward: true,
    circular,
    useAdditionalOrfStartCodons
  });
  const reverseOrfs = getOrfsFromSequence({
    sequence,
    minimumOrfSize,
    forward: false,
    circular,
    useAdditionalOrfStartCodons
  });
  return forwardOrfs.concat(reverseOrfs);
}

// ---------------- sequence editing ----------------

function spliceString(str: string, start: number, delCount: number, insert = ""): string {
  return str.slice(0, start) + insert + str.slice(start + delCount);
}

/** Replace or insert a string at a caret position or range (0-based). */
export function adjustBpsToReplaceOrInsert(
  bpString: string,
  insertString = "",
  caretPositionOrRange?: CaretPositionOrRange
): string {
  let stringToReturn = bpString;

  if (caretPositionOrRange && typeof caretPositionOrRange === "object" && caretPositionOrRange.start > -1) {
    const range = caretPositionOrRange as Range;
    if (getRangeLength(range, bpString.length) === bpString.length) {
      return insertString;
    }
    const inverted = invertRange(range, bpString.length);
    if (!inverted) return insertString;
    const ranges = splitRangeIntoTwoPartsIfItIsCircular(inverted, bpString.length);
    stringToReturn = "";
    ranges.forEach((r, index) => {
      stringToReturn += getSequenceWithinRange(r, bpString);
      if (ranges.length === 1) {
        if (isPositionWithinRange(0, r, bpString.length, true, true)) {
          stringToReturn = stringToReturn + insertString;
        } else {
          stringToReturn = insertString + stringToReturn;
        }
      } else {
        if (index === 0) stringToReturn += insertString;
      }
    });
  } else {
    const caretPosition =
      typeof caretPositionOrRange === "number"
        ? caretPositionOrRange
        : (caretPositionOrRange as Range | undefined)?.start ?? 0;
    stringToReturn = spliceString(bpString, caretPosition, 0, insertString);
  }
  return stringToReturn;
}

/** Rotate (rotateBpsToPosition) the bps of a sequence string to a new caret position. */
export function rotateBpsToPosition(bps: string, caretPosition: number): string {
  const arr = bps.split("");
  const count = caretPosition - arr.length * Math.floor(caretPosition / arr.length);
  arr.push(...arr.splice(0, count));
  return arr.join("");
}

/** Rotate a sequenceData object (sequence + annotations) to a caret position. */
export function rotateSequenceDataToPosition(
  sequenceData: SequenceData,
  caretPosition: number
): SequenceData {
  const newSequenceData: SequenceData = { ...sequenceData, sequence: sequenceData.sequence || "" };
  newSequenceData.sequence = rotateBpsToPosition(newSequenceData.sequence, caretPosition);
  modifiableTypes.forEach((annotationType) => {
    const annotations = (newSequenceData[annotationType] as any[]) || [];
    newSequenceData[annotationType] = adjustAnnotationsToRotation(
      annotations,
      caretPosition,
      newSequenceData.sequence.length
    );
  });
  return newSequenceData;
}

function adjustAnnotationsToRotation(
  annotationsToBeAdjusted: any[],
  positionToRotateTo: number,
  maxLength: number
): any[] {
  return annotationsToBeAdjusted
    .map((annotation) => {
      return {
        ...adjustRangeToRotation(annotation, positionToRotateTo, maxLength),
        locations: annotation.locations
          ? annotation.locations.map((location: Range) =>
              adjustRangeToRotation(location, positionToRotateTo, maxLength)
            )
          : undefined
      };
    })
    .filter((r) => !!r);
}

/** Insert sequenceData (or delete a range) at a caret position or range, adjusting annotations. */
export function insertSequenceDataAtPositionOrRange(
  _sequenceDataToInsert: SequenceData,
  _existingSequenceData: SequenceData,
  caretPositionOrRange: CaretPositionOrRange
): SequenceData {
  const existingSequenceData: SequenceData = {
    ..._existingSequenceData,
    sequence: _existingSequenceData.sequence ?? "",
    proteinSequence: _existingSequenceData.proteinSequence ?? ""
  };
  const sequenceDataToInsert: SequenceData = {
    ..._sequenceDataToInsert,
    sequence: _sequenceDataToInsert.sequence ?? ""
  };
  const newSequenceData: SequenceData = { ...existingSequenceData, sequence: existingSequenceData.sequence || "" };

  const insertLength = sequenceDataToInsert.sequence.length;
  let caretPosition =
    typeof caretPositionOrRange === "number"
      ? caretPositionOrRange
      : caretPositionOrRange.start > -1
        ? caretPositionOrRange.start
        : 0;

  // update sequence
  newSequenceData.sequence = adjustBpsToReplaceOrInsert(
    existingSequenceData.sequence,
    sequenceDataToInsert.sequence,
    caretPositionOrRange
  );
  newSequenceData.size = newSequenceData.sequence.length;

  // update annotations
  modifiableTypes.forEach((annotationType) => {
    let existingAnnotations = (existingSequenceData[annotationType] as any[]) || [];
    if (
      typeof caretPositionOrRange === "object" &&
      caretPositionOrRange.start > -1
    ) {
      const range = caretPositionOrRange as Range;
      caretPosition = range.start > range.end ? 0 : range.start;
      existingAnnotations = adjustAnnotationsToDelete(
        existingAnnotations,
        range,
        existingSequenceData.sequence.length
      );
    }
    newSequenceData[annotationType] = [
      ...adjustAnnotationsToInsert(existingAnnotations, caretPosition, insertLength),
      ...adjustAnnotationsToInsert(
        (sequenceDataToInsert[annotationType] as any[]) || [],
        0,
        caretPosition
      )
    ];
  });
  return newSequenceData;
}

/** Delete a range from sequenceData (adjusting annotations). */
export function deleteSequenceDataAtRange(
  sequenceData: SequenceData,
  range: Range
): SequenceData {
  return insertSequenceDataAtPositionOrRange({ sequence: "" }, sequenceData, range);
}

function adjustAnnotationsToDelete(annotationsToBeAdjusted: any[], range: Range, maxLength: number): any[] {
  return annotationsToBeAdjusted
    .map((annotation) => {
      const newRange = adjustRangeToDeletionOfAnotherRange(annotation, range, maxLength);
      if (!newRange) return undefined;
      const newLocations =
        annotation.locations &&
        annotation.locations
          .map((loc: Range) => adjustRangeToDeletionOfAnotherRange(loc, range, maxLength))
          .filter((r: Range | undefined) => !!r);
      if (newLocations && newLocations.length) {
        return {
          ...newRange,
          start: newLocations[0].start,
          end: newLocations[newLocations.length - 1].end,
          ...(newLocations.length > 0 && { locations: newLocations })
        };
      }
      return newRange;
    })
    .filter((range: Range | undefined) => !!range);
}

/** Adjust a list of annotations for an insertion. */
export function adjustAnnotationsToInsert(
  annotationsToBeAdjusted: any[],
  insertStart: number,
  insertLength: number
): any[] {
  return annotationsToBeAdjusted.map((annotation) => {
    return {
      ...adjustRangeToInsert(annotation, insertStart, insertLength),
      ...(annotation.locations && {
        locations: annotation.locations.map((loc: Range) =>
          adjustRangeToInsert(loc, insertStart, insertLength)
        )
      })
    };
  });
}

// ---------------- cloning / parts ----------------

/** All possible fragments ("parts") between pairs of cutsites from a set of enzymes. */
export function getPossiblePartsFromSequenceAndEnzyme(
  seqData: SequenceData,
  restrictionEnzymes: RestrictionEnzyme | RestrictionEnzyme[]
): any[] {
  const enzymes = (Array.isArray(restrictionEnzymes) ? restrictionEnzymes : [restrictionEnzymes]) as RestrictionEnzyme[];
  const bps = seqData.sequence;
  const seqLen = bps.length;
  const circular = !!seqData.circular;
  let cutsites: Cutsite[] = [];
  enzymes.forEach((enzyme) => {
    cutsites = cutsites.concat(cutSequenceByRestrictionEnzyme(bps, circular, enzyme));
  });
  const parts: any[] = [];
  if (cutsites.length < 1) {
    return parts;
  } else if (cutsites.length === 1) {
    parts.push(getPartBetweenEnzymesWithInclusiveOverhangs(cutsites[0], cutsites[0], seqLen));
    return parts;
  }
  const pairs = pairwise(cutsites);
  pairs.forEach((pair) => {
    const cut1 = pair[0];
    const cut2 = pair[1];
    const part1 = getPartBetweenEnzymesWithInclusiveOverhangs(cut1, cut2, seqLen);
    const part2 = getPartBetweenEnzymesWithInclusiveOverhangs(cut2, cut1, seqLen);
    if (circular || !(part1.start > part1.end)) parts.push(part1);
    if (circular || !(part2.start > part2.end)) parts.push(part2);
  });
  return parts;
}

function getPartBetweenEnzymesWithInclusiveOverhangs(
  cut1: Cutsite,
  cut2: Cutsite,
  seqLen: number
) {
  const firstCutOffset = getEnzymeRelativeOffset(cut1.restrictionEnzyme);
  const secondCutOffset = getEnzymeRelativeOffset(cut2.restrictionEnzyme);
  const start = cut1.topSnipBeforeBottom ? cut1.topSnipPosition : cut1.bottomSnipPosition;
  const end = normalizePositionByRangeLength(
    (cut2.topSnipBeforeBottom ? cut2.bottomSnipPosition : cut2.topSnipPosition) - 1,
    seqLen
  );
  return {
    start,
    start1Based: start + 1,
    end,
    end1Based: end + 1,
    firstCut: cut1,
    firstCutOffset,
    firstCutOverhang: cut1.overhangBps,
    firstCutOverhangTop: firstCutOffset > 0 ? cut1.overhangBps : "",
    firstCutOverhangBottom:
      firstCutOffset < 0 ? getReverseComplementSequenceString(cut1.overhangBps) : "",
    secondCut: cut2,
    secondCutOffset,
    secondCutOverhang: cut2.overhangBps,
    secondCutOverhangTop: secondCutOffset < 0 ? cut2.overhangBps : "",
    secondCutOverhangBottom:
      secondCutOffset > 0 ? getReverseComplementSequenceString(cut2.overhangBps) : ""
  };
}

function getEnzymeRelativeOffset(enzyme: RestrictionEnzyme): number {
  return enzyme.bottomSnipOffset - enzyme.topSnipOffset;
}

function pairwise<T>(list: T[]): [T, T][] {
  if (list.length < 2) return [];
  const [first, ...rest] = list;
  const pairs = rest.map((x) => [first, x] as [T, T]);
  return pairs.concat(pairwise(rest));
}

/** Get the codon range (0-based) for a given AA sliver. */
export function getCodonRangeForAASliver(
  aminoAcidPositionInSequence: number,
  aminoAcidSliver: { aminoAcidIndex: number; fullCodon?: boolean | null },
  AARepresentationOfTranslation: any[],
  relativeAAPositionInTranslation: number
): Range {
  const AASliverOneBefore = AARepresentationOfTranslation[relativeAAPositionInTranslation - 1];
  if (AASliverOneBefore && AASliverOneBefore.aminoAcidIndex === aminoAcidSliver.aminoAcidIndex) {
    const AASliverTwoBefore = AARepresentationOfTranslation[relativeAAPositionInTranslation - 2];
    if (AASliverTwoBefore && AASliverTwoBefore.aminoAcidIndex === aminoAcidSliver.aminoAcidIndex) {
      return { start: aminoAcidPositionInSequence - 2, end: aminoAcidPositionInSequence };
    }
    if (aminoAcidSliver.fullCodon === true) {
      return { start: aminoAcidPositionInSequence - 1, end: aminoAcidPositionInSequence + 1 };
    }
    return { start: aminoAcidPositionInSequence - 1, end: aminoAcidPositionInSequence };
  }
  if (aminoAcidSliver.fullCodon === true) {
    return { start: aminoAcidPositionInSequence, end: aminoAcidPositionInSequence + 2 };
  }
  const AASliverOneAhead = AARepresentationOfTranslation[relativeAAPositionInTranslation + 1];
  if (AASliverOneAhead && AASliverOneAhead.aminoAcidIndex === aminoAcidSliver.aminoAcidIndex) {
    return { start: aminoAcidPositionInSequence, end: aminoAcidPositionInSequence + 1 };
  }
  return { start: aminoAcidPositionInSequence, end: aminoAcidPositionInSequence + 1 };
}

export { getAminoAcidStringFromSequenceString, getAminoAcidDataForEachBaseOfDna };
