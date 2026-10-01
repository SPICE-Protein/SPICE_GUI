// Ported from TeselaGen tg-oss `@teselagen/range-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
//
// All ranges use 0-based inclusive indices. A "circular" range has start > end.

export interface Range {
  start: number;
  end: number;
  [key: string]: unknown;
}

export type CaretPositionOrRange = number | Range;

/** Clamp a position into a valid position within a sequence of `sequenceLength` bases. */
export function normalizePositionByRangeLength(
  pPosition: number,
  sequenceLength: number,
  isInBetweenPositions = false
): number {
  // isInBetweenPositions:
  //  A T G C
  //  0 1 2 3    <- isInBetweenPositions=false counts the positions themselves
  // 0 1 2 3 4   <- isInBetweenPositions=true counts the spaces between positions
  let position = pPosition;
  if (position < 0) {
    position += sequenceLength;
  } else if (position + (isInBetweenPositions ? 0 : 1) > sequenceLength) {
    position -= sequenceLength;
  }
  return position < 0
    ? 0
    : position > sequenceLength - (isInBetweenPositions ? 0 : 1)
      ? sequenceLength - (isInBetweenPositions ? 0 : 1)
      : position;
}

/** Normalize a position that uses 1-based indexing (used for inputs, not annotations). */
export function normalizePositionByRangeLength1Based(
  position: number,
  sequenceLength: number
): number {
  return normalizePositionByRangeLength(position - 1, sequenceLength) + 1;
}

/** Length of a range. Handles circular ranges (start > end) and `overlapsSelf`. */
export function getRangeLength(range: Range, rangeMax?: number): number {
  let toRet: number;
  if (range.end < range.start) {
    toRet = rangeMax! - range.start + range.end + 1;
  } else {
    toRet = range.end - range.start + 1;
  }
  if (range.overlapsSelf && rangeMax) {
    toRet += rangeMax;
  }
  return toRet;
}

/** Return the sequence (string or array) that lies within `range`. */
export function getSequenceWithinRange<T extends string | unknown[]>(
  range: Range,
  sequence: T
): T {
  if (range.start < 0 || range.end < 0) return "" as T;
  if (range.start > range.end) {
    // circular range
    const part1 = sequence.slice(range.start, sequence.length) as T;
    const part2 = sequence.slice(0, range.end + 1) as T;
    if (typeof part1 === "string") {
      return ((part1 as string) + (part2 as string)) as T;
    }
    return (part1 as unknown[]).concat(part2 as unknown[]) as T;
  }
  return sequence.slice(range.start, range.end + 1) as T;
}

export interface RangeIndexType {
  inclusive1BasedStart?: boolean;
  inclusive1BasedEnd?: boolean;
}

/** Convert a range between 0/1-based and inclusive/exclusive index conventions. */
export function convertRangeIndices(
  range: Range,
  inputType: RangeIndexType = {},
  outputType: RangeIndexType = {}
): Range {
  return {
    ...range,
    start:
      Number(range.start) +
      (inputType.inclusive1BasedStart
        ? outputType.inclusive1BasedStart
          ? 0
          : -1
        : outputType.inclusive1BasedStart
          ? 1
          : 0),
    end:
      Number(range.end) +
      (inputType.inclusive1BasedEnd
        ? outputType.inclusive1BasedEnd
          ? 0
          : -1
        : outputType.inclusive1BasedEnd
          ? 1
          : 0)
  };
}

export function convertRangeTo0Based(range: Range): Range {
  return convertRangeIndices(range, { inclusive1BasedStart: true, inclusive1BasedEnd: true }, {});
}

export function convertRangeTo1Based(range: Range): Range {
  return convertRangeIndices(range, {}, { inclusive1BasedStart: true, inclusive1BasedEnd: true });
}

/** Split a potentially circular range into one/two non-circular ranges on the origin. */
export function splitRangeIntoTwoPartsIfItIsCircular(
  range: Range,
  sequenceLength: number
): (Range & { type: string })[] {
  const ranges: (Range & { type: string })[] = [];
  if (range.start > range.end) {
    ranges.push({ start: 0, end: range.end, type: "end" });
    ranges.push({ start: range.start, end: sequenceLength - 1, type: "beginning" });
  } else {
    ranges.push({ start: range.start, end: range.end, type: "beginningAndEnd" });
  }
  return ranges;
}

function getOverlapOfNonCircularRanges(rangeA: Range, rangeB: Range): Range | undefined {
  if (rangeA.start < rangeB.start) {
    if (rangeA.end < rangeB.start) {
      // no overlap
    } else {
      if (rangeA.end < rangeB.end) {
        return { start: rangeB.start, end: rangeA.end };
      }
      return { start: rangeB.start, end: rangeB.end };
    }
  } else {
    if (rangeA.start > rangeB.end) {
      // no overlap
    } else {
      if (rangeA.end < rangeB.end) {
        return { start: rangeA.start, end: rangeA.end };
      }
      return { start: rangeA.start, end: rangeB.end };
    }
  }
}

/** Overlaps between two potentially circular ranges (returns non-circular overlaps). */
export function getOverlapsOfPotentiallyCircularRanges(
  rangeA: Range,
  rangeB: Range,
  maxRangeLength?: number,
  joinIfPossible = false
): Range[] {
  const normalizedRangeA = splitRangeIntoTwoPartsIfItIsCircular(rangeA, maxRangeLength ?? 0);
  const normalizedRangeB = splitRangeIntoTwoPartsIfItIsCircular(rangeB, maxRangeLength ?? 0);

  const overlaps: Range[] = [];

  normalizedRangeA.forEach((nonCircularRangeA) => {
    normalizedRangeB.forEach((nonCircularRangeB) => {
      const overlap = getOverlapOfNonCircularRanges(nonCircularRangeA, nonCircularRangeB);
      if (overlap) {
        overlaps.push(overlap);
      }
    });
  });

  if (
    joinIfPossible &&
    normalizedRangeA.length === 2 &&
    normalizedRangeB.length === 2 &&
    maxRangeLength
  ) {
    const joinedOverlap = {} as Range;
    overlaps
      .filter((o) => o.start === 0 || o.end === maxRangeLength - 1)
      .forEach((o) => {
        if (o.start === 0) {
          joinedOverlap.end = o.end;
        } else if (o.end === maxRangeLength - 1) {
          joinedOverlap.start = o.start;
        }
      });
    overlaps.length = 0;
    overlaps.push(joinedOverlap);
  }
  return overlaps;
}

/** Length of the overlapping region(s) between two potentially circular ranges. */
export function getLengthOfOverlappingRegionsBetweenTwoRanges(
  rangeA: Range,
  rangeB: Range,
  rangeMax: number
): number {
  return getOverlapsOfPotentiallyCircularRanges(rangeA, rangeB, rangeMax).reduce(
    (acc, overlap) => acc + getRangeLength(overlap, rangeMax),
    0
  );
}

/**
 * Whether `position` (0-based caret) is within `range` (0-based inclusive).
 */
export function isPositionWithinRange(
  position: number,
  range: Range,
  sequenceLength: number,
  includeStartEdge = false,
  includeEndEdge = false
): boolean {
  const ranges = splitRangeIntoTwoPartsIfItIsCircular(range, sequenceLength);
  return ranges.some((r) => {
    if (includeStartEdge ? position < r.start : position <= r.start) {
      return false;
    }
    if (includeEndEdge ? position <= r.end + 1 : position <= r.end) {
      return true;
    }
    return false;
  });
}

/** Whether `innerRange` fits fully inside `outerRange` (both potentially circular). */
export function isRangeWithinRange(
  innerRange: Range,
  outerRange: Range,
  sequenceLength: number
): boolean {
  const outerRanges = splitRangeIntoTwoPartsIfItIsCircular(outerRange, sequenceLength);
  return outerRanges.some((r) =>
    isPositionWithinRange(innerRange.start, r, sequenceLength, true, true) &&
    isPositionWithinRange(innerRange.end, r, sequenceLength, true, true)
  );
}

/** Whether a range or caret position is inside `range`. */
export function isRangeOrPositionWithinRange(
  rangeOrCaret: CaretPositionOrRange,
  range: Range,
  sequenceLength: number
): boolean {
  if (typeof rangeOrCaret === "number") {
    return isPositionWithinRange(rangeOrCaret, range, sequenceLength);
  }
  return isRangeWithinRange(rangeOrCaret, range, sequenceLength);
}

/** Wrap a potentially out-of-bounds range back into `[0, sequenceLength-1]`. */
export function normalizeRange(range: Range, sequenceLength: number): Range {
  return {
    ...range,
    start: normalizePositionByRangeLength(range.start, sequenceLength),
    end: normalizePositionByRangeLength(range.end, sequenceLength)
  };
}

/** Translate (shift) a range by a given amount, wrapping as needed. */
export function translateRange(
  rangeToBeAdjusted: Range,
  translateBy: number,
  rangeLength: number
): Range {
  return {
    ...rangeToBeAdjusted,
    start: normalizePositionByRangeLength(rangeToBeAdjusted.start + translateBy, rangeLength),
    end: normalizePositionByRangeLength(rangeToBeAdjusted.end + translateBy, rangeLength)
  };
}

/**
 * Take a position and "flip" it within a range (used for reverse-strand translations).
 */
export function reversePositionInRange(
  position: number,
  rangeLength: number,
  isInBetweenPositions = false
): number {
  return rangeLength - position - (isInBetweenPositions ? 0 : 1);
}

/** Invert a range (return the range that is NOT covered by the input). */
export function invertRange(rangeOrCaret: CaretPositionOrRange, rangeMax: number): Range | undefined {
  if (typeof rangeOrCaret === "object" && rangeOrCaret.start > -1) {
    const start = rangeOrCaret.end + 1;
    const end = rangeOrCaret.start - 1;
    return {
      start: normalizePositionByRangeLength(start, rangeMax, false),
      end: normalizePositionByRangeLength(end, rangeMax, false)
    };
  }
  if (typeof rangeOrCaret === "number" && rangeOrCaret > -1) {
    return {
      start: normalizePositionByRangeLength(rangeOrCaret, rangeMax, false),
      end: normalizePositionByRangeLength(rangeOrCaret - 1, rangeMax, false)
    };
  }
}

/** Put a position that might not fit into `[0, range.end]`. */
export function modulatePositionByRange(position: number, range: Range): number {
  let returnVal = position;
  if (position < range.start) {
    returnVal = range.end - (range.start - (position + 1));
  } else if (position > range.end) {
    returnVal = range.start + (position - range.end - 1);
  }
  return returnVal;
}

/** Middle position of a range (0-based). */
export function getMiddleOfRange(range: Range, rangeMax?: number): number {
  const len = getRangeLength({ start: range.start, end: range.end }, rangeMax);
  return normalizePositionByRangeLength(range.start + Math.floor(len / 2), rangeMax ?? 0);
}

/** Expand (shiftBy > 0) or contract (shiftBy < 0) a range from one side. */
export function expandOrContractRangeByLength(
  range: Range,
  shiftBy: number,
  shiftStart: boolean,
  sequenceLength: number
): Range {
  const rangeToReturn = { ...range };
  if (shiftStart) {
    rangeToReturn.start -= shiftBy;
  } else {
    rangeToReturn.end += shiftBy;
  }
  return normalizeRange(rangeToReturn, sequenceLength);
}

/**
 * Adjust `rangeToBeAdjusted` for an insertion of `insertLength` bases at `insertStart`.
 */
export function adjustRangeToInsert(
  rangeToBeAdjusted: Range,
  insertStart: number,
  insertLength: number
): Range {
  const newRange = { ...rangeToBeAdjusted };
  if (rangeToBeAdjusted.start > rangeToBeAdjusted.end) {
    // circular range
    if (rangeToBeAdjusted.end >= insertStart) {
      newRange.start += insertLength;
      newRange.end += insertLength;
    } else if (rangeToBeAdjusted.start >= insertStart) {
      newRange.start += insertLength;
    }
  } else {
    if (rangeToBeAdjusted.start >= insertStart) {
      newRange.start += insertLength;
      newRange.end += insertLength;
    } else if (rangeToBeAdjusted.end >= insertStart) {
      newRange.end += insertLength;
    }
  }
  return newRange;
}

/** Adjust a range for a rotation to `rotateTo` (0-based) within `rangeLength`. */
export function adjustRangeToRotation(
  rangeToBeAdjusted: Range,
  rotateTo = 0,
  rangeLength?: number
): Range {
  const mod = rangeLength ? modulo : identity;
  return {
    ...rangeToBeAdjusted,
    start: mod(rangeToBeAdjusted.start - (rotateTo || 0), rangeLength),
    end: mod(rangeToBeAdjusted.end - (rotateTo || 0), rangeLength)
  };
}

function modulo(n: number, m?: number): number {
  if (!m) return n;
  return ((n % m) + m) % m;
}
function identity(n: number): number {
  return n;
}

/** Get the angles (in radians) of a (potentially circular) range in a circle of `rangeMax` bps. */
export function getRangeAngles(range: Range, rangeMax: number): {
  startAngle: number;
  totalAngle: number;
  endAngle: number;
  centerAngle: number;
  locationAngles?: ReturnType<typeof getRangeAngles>[];
} {
  const rangeLength = getRangeLength({ start: range.start, end: range.end }, rangeMax);
  const startAngle = 2 * Math.PI * (range.start / rangeMax);
  const totalAngle = (rangeLength / rangeMax) * Math.PI * 2;
  const endAngle = (2 * Math.PI * (range.end + 1)) / rangeMax;
  return {
    startAngle,
    totalAngle,
    endAngle,
    centerAngle: startAngle + totalAngle / 2,
    locationAngles: range.locations
      ? (range.locations as Range[]).map((location) => getRangeAngles(location, rangeMax))
      : undefined
  };
}

/** Convert an angle (radians) back to a 0-based position in a sequence of `rangeMax` bps. */
export function getPositionFromAngle(
  angle: number,
  rangeMax: number,
  isInBetweenPositions = false
): number {
  const unroundedPostion = (angle / Math.PI / 2) * rangeMax;
  return isInBetweenPositions ? Math.round(unroundedPostion) : Math.floor(unroundedPostion);
}

/**
 * Trim `rangeToBeTrimmed` by `trimmingRange` (both potentially circular).
 * Returns the trimmed range or undefined if fully removed.
 */
export function trimRangeByAnotherRange(
  rangeToBeTrimmed: Range | undefined,
  trimmingRange: Range | undefined,
  sequenceLength: number
): Range | undefined {
  if (!rangeToBeTrimmed || !trimmingRange) {
    return undefined;
  }
  for (const position of [
    rangeToBeTrimmed.start,
    rangeToBeTrimmed.end,
    trimmingRange.start,
    trimmingRange.end
  ]) {
    if (position < 0 || (!position && position !== 0)) {
      return undefined;
    }
  }
  const overlaps = getOverlapsOfPotentiallyCircularRanges(
    rangeToBeTrimmed,
    trimmingRange,
    sequenceLength
  );
  if (!overlaps.length) {
    return rangeToBeTrimmed;
  }
  const splitRangesToBeTrimmed = splitRangeIntoTwoPartsIfItIsCircular(
    rangeToBeTrimmed,
    sequenceLength
  );
  splitRangesToBeTrimmed.forEach((nonCircularRangeToBeTrimmed, index) => {
    let trimmed: Range | undefined = nonCircularRangeToBeTrimmed;
    overlaps.forEach((overlap) => {
      if (trimmed) {
        trimmed = trimNonCicularRangeByAnotherNonCircularRange(trimmed, overlap) ?? trimmed;
      }
    });
    splitRangesToBeTrimmed[index] = trimmed as Range & { type: string };
  });
  const outputSplitRanges = splitRangesToBeTrimmed.filter((r) => !!r);
  let outputTrimmedRange: Range | undefined;
  if (outputSplitRanges.length === 1) {
    outputTrimmedRange = outputSplitRanges[0];
  } else if (outputSplitRanges.length === 2) {
    if (outputSplitRanges[0].start < outputSplitRanges[1].start) {
      outputTrimmedRange = {
        start: outputSplitRanges[1].start,
        end: outputSplitRanges[0].end
      };
    } else {
      outputTrimmedRange = {
        start: outputSplitRanges[0].start,
        end: outputSplitRanges[1].end
      };
    }
  }
  if (outputTrimmedRange) {
    return {
      ...rangeToBeTrimmed,
      start: outputTrimmedRange.start,
      end: outputTrimmedRange.end
    };
  }
}

function trimNonCicularRangeByAnotherNonCircularRange(
  rangeToBeTrimmed: Range,
  trimmingRange: Range
): Range | undefined {
  let outputTrimmedRange: Range | undefined;
  if (!rangeToBeTrimmed) return outputTrimmedRange;
  if (rangeToBeTrimmed.start < trimmingRange.start) {
    if (rangeToBeTrimmed.end < trimmingRange.start) {
      outputTrimmedRange = { start: rangeToBeTrimmed.start, end: rangeToBeTrimmed.end };
    } else if (rangeToBeTrimmed.end > trimmingRange.end) {
      outputTrimmedRange = { start: rangeToBeTrimmed.start, end: rangeToBeTrimmed.end };
    } else {
      outputTrimmedRange = { start: rangeToBeTrimmed.start, end: trimmingRange.start - 1 };
    }
  } else {
    if (rangeToBeTrimmed.end <= trimmingRange.end) {
      // fully deleted
    } else if (rangeToBeTrimmed.start > trimmingRange.end) {
      outputTrimmedRange = { end: rangeToBeTrimmed.end, start: rangeToBeTrimmed.start };
    } else {
      outputTrimmedRange = { end: rangeToBeTrimmed.end, start: trimmingRange.end + 1 };
    }
  }
  return outputTrimmedRange;
}

/** Adjust a range for a deletion of `anotherRange` (both potentially circular). Returns undefined if fully removed. */
export function adjustRangeToDeletionOfAnotherRange(
  rangeToBeAdjusted: Range,
  anotherRange: Range,
  maxLength: number
): Range | undefined {
  const trimmedRange = trimRangeByAnotherRange(rangeToBeAdjusted, anotherRange, maxLength);
  if (!trimmedRange) return undefined;

  const nonCircularDeletionRanges = splitRangeIntoTwoPartsIfItIsCircular(
    anotherRange,
    maxLength
  );
  nonCircularDeletionRanges.forEach((nonCircularDeletionRange) => {
    const deletionLength = nonCircularDeletionRange.end - nonCircularDeletionRange.start + 1;
    if (trimmedRange.start > trimmedRange.end) {
      // trimmed range is circular
      if (nonCircularDeletionRange.start < trimmedRange.end) {
        trimmedRange.start -= deletionLength;
        trimmedRange.end -= deletionLength;
      } else if (nonCircularDeletionRange.start < trimmedRange.start) {
        trimmedRange.start -= deletionLength;
      }
    } else {
      if (nonCircularDeletionRange.start < trimmedRange.start) {
        trimmedRange.start -= deletionLength;
        trimmedRange.end -= deletionLength;
      } else if (nonCircularDeletionRange.start < trimmedRange.end) {
        trimmedRange.end -= deletionLength;
      }
    }
  });
  return trimmedRange;
}

/** Flip a contained range within an outer range (used for reverse-strand translations). */
export function flipContainedRange(
  innerRange: Range,
  outerRange: Range,
  sequenceLength: number
): Range {
  const innerLength = getRangeLength(innerRange, sequenceLength);
  const distanceFromInnerEndToOuterEnd = normalizePositionByRangeLength(
    outerRange.end - innerRange.end,
    sequenceLength,
    true
  );
  const newInnerStart = normalizePositionByRangeLength(
    outerRange.end - (innerLength - 1) - distanceFromInnerEndToOuterEnd,
    sequenceLength,
    true
  );
  return {
    ...innerRange,
    start: newInnerStart,
    end: normalizePositionByRangeLength(newInnerStart + innerLength - 1, sequenceLength, false)
  };
}

/** Expand/contract a range so it spans `sequenceLength` entirely or handles rotation. */
export function doesRangeSpanOrigin(range: Range): boolean {
  return range.start > range.end;
}

/** Each 0-based position in a range as an array. */
export function getEachPositionInRangeAsArray(range: Range): number[] {
  const arr: number[] = [];
  if (range.start <= range.end) {
    for (let i = range.start; i <= range.end; i++) arr.push(i);
  } else {
    return []; // circular ranges need a max; use loopEachPositionInRange for those
  }
  return arr;
}

/** Loop over each position in a (potentially circular) range, invoking `callback`. */
export function loopEachPositionInRange(
  range: Range,
  maxLength: number,
  callback: (position: number, index: number) => void
): void {
  const ranges = splitRangeIntoTwoPartsIfItIsCircular(range, maxLength);
  let index = 0;
  ranges.forEach((r) => {
    for (let i = r.start; i <= r.end; i++) {
      callback(i, index++);
    }
  });
}
