// Feature coordinates in the Gene Editor are 1-based and inclusive.
//
// A circular document may carry a feature that crosses the origin. Such a
// feature is stored with `end < start`: the feature runs from `start` to the
// last base and continues from the first base to `end`. Everything that reads
// bases from a range has to follow that wrap; everything that writes a range
// out has to split it, because no external format stores a reversed span.

export interface FeatureRange {
  start: number;
  end: number;
}

/** A range stored backwards is a feature that crosses the origin. */
export function isWrappedRange(range: FeatureRange): boolean {
  return range.end < range.start;
}

/** Both ends lie inside `1..sequenceLength`. */
export function isRangeInBounds(range: FeatureRange, sequenceLength: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 1 &&
    range.end >= 1 &&
    range.start <= sequenceLength &&
    range.end <= sequenceLength
  );
}

/** Number of bases a range covers. */
export function rangeLength(range: FeatureRange, sequenceLength: number): number {
  return isWrappedRange(range)
    ? sequenceLength - range.start + range.end + 1
    : range.end - range.start + 1;
}

/**
 * The bases a range covers, in document order for a forward feature. A wrapped
 * range continues at position 1 after the end of the sequence.
 */
export function extractRange(sequence: string, range: FeatureRange): string {
  if (!isWrappedRange(range)) return sequence.slice(range.start - 1, range.end);
  return sequence.slice(range.start - 1) + sequence.slice(0, range.end);
}

/** Map an offset inside a possibly wrapped range to a 1-based document position. */
export function positionAt(range: FeatureRange, offset: number, sequenceLength: number): number {
  return ((((range.start - 1 + offset) % sequenceLength) + sequenceLength) % sequenceLength) + 1;
}

/**
 * The one or two non-wrapping segments a range covers, in document order. Use
 * this when a serialised location has to be written or compared segment-wise.
 */
export function rangeSegments(range: FeatureRange, sequenceLength: number): FeatureRange[] {
  if (!isWrappedRange(range)) return [{ start: range.start, end: range.end }];
  return [
    { start: range.start, end: sequenceLength },
    { start: 1, end: range.end },
  ];
}

/** The first region two ranges share, or `null` when they do not overlap. */
export function firstOverlap(
  a: FeatureRange,
  b: FeatureRange,
  sequenceLength: number,
): FeatureRange | null {
  for (const left of rangeSegments(a, sequenceLength)) {
    for (const right of rangeSegments(b, sequenceLength)) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (start <= end) return { start, end };
    }
  }
  return null;
}
