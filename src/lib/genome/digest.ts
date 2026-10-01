// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import { normalizePositionByRangeLength, getRangeLength } from "./range";
import { cutSequenceByRestrictionEnzyme, type Cutsite, type RestrictionEnzyme } from "./enzymes";

export interface DigestFragment {
  start: number;
  end: number;
  size: number;
  id: string;
  name?: string;
  cut1: Cutsite | { type: string; name: string; topSnipPosition: number; bottomSnipPosition: number; overhangSize: number; topSnipBeforeBottom?: boolean; restrictionEnzyme?: RestrictionEnzyme };
  cut2: Cutsite | { type: string; name: string; topSnipPosition: number; bottomSnipPosition: number; overhangSize: number; topSnipBeforeBottom?: boolean; restrictionEnzyme?: RestrictionEnzyme };
}

/**
 * Compute digest fragments given a list of cutsites.
 * Handles circular and linear sequences; optionally computes partial digests.
 */
export function getDigestFragmentsForCutsites(
  sequenceLength: number,
  circular: boolean,
  cutsites: Cutsite[],
  opts: { computePartialDigests?: boolean } = {}
): DigestFragment[] {
  const fragments: DigestFragment[] = [];
  const overlappingEnzymes: DigestFragment[] = [];
  const pairs: [any, any][] = [];
  if (!cutsites.length) return [];
  let sortedCutsites = [...cutsites].sort((a, b) => a.topSnipPosition - b.topSnipPosition);

  if (!circular) {
    const startFake = {
      topSnipPosition: 0,
      bottomSnipPosition: 0,
      overhangSize: 0,
      type: "START_OR_END_OF_SEQ",
      name: "START_OF_SEQ"
    } as Partial<Cutsite>;
    const endFake = {
      topSnipPosition: sequenceLength,
      bottomSnipPosition: sequenceLength,
      overhangSize: 0,
      type: "START_OR_END_OF_SEQ",
      name: "END_OF_SEQ"
    } as Partial<Cutsite>;
    sortedCutsites = [startFake as Cutsite, ...sortedCutsites, endFake as Cutsite];
  }

  sortedCutsites.forEach((cutsite1, index) => {
    if (!circular && !sortedCutsites[index + 1]) return;
    if (opts.computePartialDigests) {
      sortedCutsites.forEach((cs, index2) => {
        if (index2 === index + 1 || index2 === 0) return;
        pairs.push([cutsite1, sortedCutsites[index2]]);
      });
    }
    pairs.push([cutsite1, sortedCutsites[index + 1] ? sortedCutsites[index + 1] : sortedCutsites[0]]);
  });

  pairs.forEach(([cut1, cut2]) => {
    const start = normalizePositionByRangeLength(cut1.topSnipPosition, sequenceLength);
    const end = normalizePositionByRangeLength(cut2.topSnipPosition - 1, sequenceLength);
    const fragmentRange = { start, end };
    const size = getRangeLength(fragmentRange, sequenceLength);
    const id = `${start}-${end}-${size}-`;

    fragments.push({
      cut1: {
        ...cut1,
        isOverhangIncludedInFragmentSize:
          cut1.type !== "START_OR_END_OF_SEQ" &&
          cut1.overhangSize > 0 &&
          cut1.topSnipBeforeBottom
      },
      cut2: {
        ...cut2,
        isOverhangIncludedInFragmentSize:
          cut2.type !== "START_OR_END_OF_SEQ" &&
          cut2.overhangSize > 0 &&
          !cut2.topSnipBeforeBottom
      },
      ...fragmentRange,
      size,
      id
    } as DigestFragment);
  });

  return fragments.filter((fragment) => {
    if (!fragment.size) {
      overlappingEnzymes.push(fragment);
      return false;
    }
    return true;
  });
}

/** Compute digest fragments for one or more restriction enzymes. */
export function getDigestFragmentsForRestrictionEnzymes(
  sequence: string,
  circular: boolean,
  restrictionEnzymeOrEnzymes: RestrictionEnzyme | RestrictionEnzyme[],
  opts?: { computePartialDigests?: boolean }
): DigestFragment[] {
  const restrictionEnzymes = Array.isArray(restrictionEnzymeOrEnzymes)
    ? restrictionEnzymeOrEnzymes
    : [restrictionEnzymeOrEnzymes];
  const cutsites: Cutsite[] = [];
  restrictionEnzymes.forEach((re) => {
    cutsites.push(...cutSequenceByRestrictionEnzyme(sequence, circular, re));
  });
  return getDigestFragmentsForCutsites(sequence.length, circular, cutsites, opts);
}

export interface VirtualDigestResult {
  computePartialDigestDisabled?: boolean;
  computeDigestDisabled?: boolean;
  fragments: DigestFragment[];
  overlappingEnzymes: DigestFragment[];
}

/** Compute a virtual digest with nice fragment names. */
export function getVirtualDigest({
  cutsites,
  sequenceLength,
  isCircular,
  computePartialDigest,
  computePartialDigestDisabled,
  computeDigestDisabled
}: {
  cutsites: Cutsite[];
  sequenceLength: number;
  isCircular: boolean;
  computePartialDigest?: boolean;
  computePartialDigestDisabled?: boolean;
  computeDigestDisabled?: boolean;
}): VirtualDigestResult {
  let fragments: DigestFragment[] = [];
  const overlappingEnzymes: DigestFragment[] = [];
  const pairs: [any, any][] = [];

  const sortedCutsites = [...cutsites].sort((a, b) => a.topSnipPosition - b.topSnipPosition);

  sortedCutsites.forEach((cutsite1, index) => {
    if (computePartialDigest && !computePartialDigestDisabled) {
      sortedCutsites.forEach((cs, index2) => {
        pairs.push([cutsite1, sortedCutsites[index2]]);
      });
    }
    if (!computeDigestDisabled) {
      pairs.push([
        cutsite1,
        sortedCutsites[index + 1] ? sortedCutsites[index + 1] : sortedCutsites[0]
      ]);
    }
  });

  pairs.forEach(([cut1, cut2]) => {
    const start = normalizePositionByRangeLength(cut1.topSnipPosition, sequenceLength);
    const end = normalizePositionByRangeLength(cut2.topSnipPosition - 1, sequenceLength);

    if (!isCircular && start > end) {
      // fragment spans the origin in a linear sequence -> split in two
      const frag1 = {
        start,
        end: sequenceLength - 1,
        cut1,
        cut2: { type: "endOfSeq", restrictionEnzyme: { name: "End Of Seq" } }
      };
      const frag2 = {
        start: 0,
        end,
        cut1: { type: "startOfSeq", restrictionEnzyme: { name: "Start Of Seq" } },
        cut2
      };
      fragments.push(addSizeIdName(frag1 as any, sequenceLength));
      fragments.push(addSizeIdName(frag2 as any, sequenceLength));
    } else {
      fragments.push(addSizeIdName({ cut1, cut2, start, end } as any, sequenceLength));
    }
  });

  fragments = fragments.filter((fragment) => {
    if (!fragment.size) {
      overlappingEnzymes.push(fragment);
      return false;
    }
    return true;
  });

  return {
    computePartialDigestDisabled,
    computeDigestDisabled,
    fragments,
    overlappingEnzymes
  };
}

function addSizeIdName(frag: DigestFragment, sequenceLength: number): DigestFragment {
  const size = getRangeLength({ start: frag.start, end: frag.end }, sequenceLength);
  const name = `${(frag.cut1 as any).restrictionEnzyme?.name ?? "Untitled Cutsite"} -- ${
    (frag.cut2 as any).restrictionEnzyme?.name ?? "Untitled Cutsite"
  } ${size} bps`;
  return {
    ...frag,
    size,
    name,
    id: `${frag.start}-${frag.end}-${size}-`
  };
}
