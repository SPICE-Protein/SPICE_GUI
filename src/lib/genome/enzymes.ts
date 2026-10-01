// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import {
  normalizePositionByRangeLength,
  getSequenceWithinRange,
  reversePositionInRange
} from "./range";
import { getReverseComplementSequenceString } from "./sequence";

import aliasedEnzymesByName from "./data/aliasedEnzymesByName";
import defaultEnzymesByName from "./data/defaultEnzymesByName";

// data modules are @ts-nocheck
const defaultDb = defaultEnzymesByName as Record<string, RestrictionEnzyme>;

export { aliasedEnzymesByName, defaultEnzymesByName };

export interface RestrictionEnzyme {
  name: string;
  site: string;
  forwardRegex: string;
  reverseRegex: string;
  topSnipOffset: number;
  bottomSnipOffset: number;
  cutType?: number;
  usForward?: number;
  usReverse?: number;
  isType2S?: boolean;
  [key: string]: unknown;
}

export interface Cutsite {
  id: string;
  start: number;
  end: number;
  topSnipPosition: number;
  bottomSnipPosition: number;
  topSnipBeforeBottom: boolean;
  overhangBps: string;
  overhangSize: number;
  upstreamTopBeforeBottom: boolean;
  upstreamTopSnip: number | null;
  annotationTypePlural: string;
  upstreamBottomSnip: number | null;
  recognitionSiteRange: { start: number; end: number };
  forward: boolean;
  name: string;
  restrictionEnzyme: RestrictionEnzyme;
  cutsTwice?: boolean;
  type?: string;
  methylationStatus?: MethylationStatus;
}

let shortidCounter = 0;
function shortid(): string {
  return `cs_${Date.now().toString(36)}_${(shortidCounter++).toString(36)}`;
}

export function isEnzymeType2S(e: RestrictionEnzyme): boolean {
  return e.site.length < e.topSnipOffset || e.site.length < e.bottomSnipOffset;
}

export function doesEnzymeChopOutsideOfRecognitionSite(enzyme: RestrictionEnzyme): boolean {
  return (
    enzyme.topSnipOffset > enzyme.site.length ||
    enzyme.bottomSnipOffset > enzyme.site.length
  );
}

export function getCutsiteType(restrictionEnzyme: RestrictionEnzyme): string {
  const { topSnipOffset, bottomSnipOffset } = restrictionEnzyme;
  if (topSnipOffset === bottomSnipOffset) return "blunt";
  if (topSnipOffset < bottomSnipOffset) return "5' overhang";
  return "3' overhang";
}

/** Find all cutsites of a single enzyme in a sequence. */
export function cutSequenceByRestrictionEnzyme(
  pSequence: string,
  circular: boolean,
  restrictionEnzyme: RestrictionEnzyme
): Cutsite[] {
  if (
    !restrictionEnzyme.forwardRegex ||
    restrictionEnzyme.forwardRegex.length === 0 ||
    restrictionEnzyme.reverseRegex.length === 0
  ) {
    const returnArray: Cutsite[] = [];
    (returnArray as Cutsite[] & { error?: string }).error =
      "Cannot cut sequence. Enzyme restriction site must be at least 1 bp long.";
    return returnArray;
  }
  const forwardRegExpPattern = new RegExp(restrictionEnzyme.forwardRegex, "ig");
  const sequence = pSequence;

  const cutsitesForward = cutSequence(forwardRegExpPattern, restrictionEnzyme, sequence, circular);
  let cutsitesReverse: Cutsite[] = [];
  if (restrictionEnzyme.forwardRegex !== restrictionEnzyme.reverseRegex) {
    const revSequence = getReverseComplementSequenceString(sequence);
    cutsitesReverse = cutSequence(forwardRegExpPattern, restrictionEnzyme, revSequence, circular);
    cutsitesReverse = cutsitesReverse.map((cutsite) =>
      reverseAllPositionsOfCutsite(cutsite, sequence.length)
    );
  }
  return cutsitesForward.concat(cutsitesReverse);
}

function reverseAllPositionsOfCutsite(cutsite: Cutsite, rangeLength: number): Cutsite {
  const reversed: Cutsite = {
    ...cutsite,
    start: reversePositionInRange(cutsite.start, rangeLength, false),
    end: reversePositionInRange(cutsite.end, rangeLength, false),
    topSnipPosition: reversePositionInRange(cutsite.topSnipPosition, rangeLength, true),
    bottomSnipPosition: reversePositionInRange(cutsite.bottomSnipPosition, rangeLength, true),
    upstreamTopSnip: cutsite.upstreamTopSnip != null ? reversePositionInRange(cutsite.upstreamTopSnip, rangeLength, true) : null,
    upstreamBottomSnip: cutsite.upstreamBottomSnip != null ? reversePositionInRange(cutsite.upstreamBottomSnip, rangeLength, true) : null,
    recognitionSiteRange: {
      start: reversePositionInRange(cutsite.recognitionSiteRange.start, rangeLength, false),
      end: reversePositionInRange(cutsite.recognitionSiteRange.end, rangeLength, false)
    },
    forward: false,
    name: cutsite.restrictionEnzyme.name,
    restrictionEnzyme: cutsite.restrictionEnzyme
  };
  // swap start/end and snips
  reversed.start = cutsite.end;
  reversed.end = cutsite.start;
  reversed.overhangBps = getReverseComplementSequenceString(cutsite.overhangBps);
  reversed.topSnipPosition = cutsite.bottomSnipPosition;
  reversed.bottomSnipPosition = cutsite.topSnipPosition;
  reversed.upstreamTopSnip = cutsite.upstreamBottomSnip;
  reversed.upstreamBottomSnip = cutsite.upstreamTopSnip;
  reversed.upstreamTopBeforeBottom = !!cutsite.upstreamTopBeforeBottom;
  reversed.topSnipBeforeBottom = !!cutsite.topSnipBeforeBottom;
  reversed.recognitionSiteRange = {
    start: cutsite.recognitionSiteRange.end,
    end: cutsite.recognitionSiteRange.start
  };
  return reversed;
}

function cutSequence(
  forwardRegExpPattern: RegExp,
  restrictionEnzyme: RestrictionEnzyme,
  sequence: string,
  circular: boolean
): Cutsite[] {
  const restrictionCutSites: Cutsite[] = [];
  let restrictionCutSite: Cutsite;
  const recognitionSiteLength = restrictionEnzyme.site.length;
  const originalSequence = sequence;
  const originalSequenceLength = sequence.length;
  if (circular) {
    sequence += sequence;
  }
  const currentSequenceLength = sequence.length;

  let matchIndex = sequence.search(forwardRegExpPattern);
  let startIndex = 0;
  let subSequence = sequence;

  while (matchIndex !== -1) {
    const recognitionSiteRange: { start: number; end: number } = { start: 0, end: 0 };
    let start: number;
    let end: number;
    let upstreamTopSnip: number | null = null;
    let upstreamBottomSnip: number | null = null;
    let upstreamTopBeforeBottom = false;
    let topSnipPosition: number | null = null;
    let bottomSnipPosition: number | null = null;
    let topSnipBeforeBottom = false;

    let fitsWithinSequence = false;

    recognitionSiteRange.start = matchIndex + startIndex;
    start = recognitionSiteRange.start;

    recognitionSiteRange.end = matchIndex + recognitionSiteLength - 1 + startIndex;
    end = recognitionSiteRange.end;

    // Type 1 (double) cutters cut both upstream and downstream
    if (restrictionEnzyme.cutType === 1) {
      upstreamTopSnip = recognitionSiteRange.end - (restrictionEnzyme.usForward ?? 0);
      upstreamBottomSnip = recognitionSiteRange.end - (restrictionEnzyme.usReverse ?? 0);
      if (upstreamTopSnip >= 0 && upstreamBottomSnip >= 0) {
        fitsWithinSequence = true;
        if (upstreamTopSnip < upstreamBottomSnip) {
          if (start > upstreamTopSnip) start = upstreamTopSnip + 1;
          upstreamTopBeforeBottom = true;
        } else {
          if (start > upstreamBottomSnip) start = upstreamBottomSnip + 1;
        }
        upstreamTopSnip = normalizePositionByRangeLength(upstreamTopSnip, originalSequenceLength, true);
        upstreamBottomSnip = normalizePositionByRangeLength(upstreamBottomSnip, originalSequenceLength, true);
      } else {
        upstreamTopSnip = null;
        upstreamBottomSnip = null;
      }
    }

    topSnipPosition = recognitionSiteRange.start + restrictionEnzyme.topSnipOffset;
    bottomSnipPosition = recognitionSiteRange.start + restrictionEnzyme.bottomSnipOffset;
    if (bottomSnipPosition <= currentSequenceLength && topSnipPosition <= currentSequenceLength) {
      fitsWithinSequence = true;
      if (topSnipPosition > bottomSnipPosition) {
        if (topSnipPosition > recognitionSiteRange.end) end = topSnipPosition - 1;
      } else {
        if (bottomSnipPosition > recognitionSiteRange.end) end = bottomSnipPosition - 1;
        topSnipBeforeBottom = true;
      }
      topSnipPosition = normalizePositionByRangeLength(topSnipPosition, originalSequenceLength, true);
      bottomSnipPosition = normalizePositionByRangeLength(bottomSnipPosition, originalSequenceLength, true);
    } else {
      topSnipPosition = null;
      bottomSnipPosition = null;
    }

    if (
      fitsWithinSequence &&
      start >= 0 &&
      end >= 0 &&
      start < originalSequenceLength &&
      end < currentSequenceLength
    ) {
      start = normalizePositionByRangeLength(start, originalSequenceLength, false);
      end = normalizePositionByRangeLength(end, originalSequenceLength, false);
      recognitionSiteRange.start = normalizePositionByRangeLength(
        recognitionSiteRange.start,
        originalSequenceLength,
        false
      );
      recognitionSiteRange.end = normalizePositionByRangeLength(
        recognitionSiteRange.end,
        originalSequenceLength,
        false
      );
      let cutRange: { start: number; end: number } = { start: -1, end: -1 };

      if (topSnipPosition !== bottomSnipPosition) {
        cutRange = topSnipBeforeBottom
          ? {
              start: topSnipPosition!,
              end: normalizePositionByRangeLength(bottomSnipPosition! - 1, originalSequenceLength)
            }
          : {
              start: bottomSnipPosition!,
              end: normalizePositionByRangeLength(topSnipPosition! - 1, originalSequenceLength)
            };
      }
      const overhangBps = getSequenceWithinRange(cutRange, originalSequence);

      restrictionCutSite = {
        id: shortid(),
        start,
        end,
        topSnipPosition: topSnipPosition!,
        bottomSnipPosition: bottomSnipPosition!,
        topSnipBeforeBottom,
        overhangBps,
        overhangSize: overhangBps.length,
        upstreamTopBeforeBottom,
        upstreamTopSnip,
        annotationTypePlural: "cutsites",
        upstreamBottomSnip,
        recognitionSiteRange,
        forward: true,
        name: restrictionEnzyme.name,
        restrictionEnzyme
      };
      restrictionCutSites.push(restrictionCutSite);
    }

    startIndex = startIndex + matchIndex + 1;
    subSequence = sequence.substring(startIndex, sequence.length);
    matchIndex = subSequence.search(forwardRegExpPattern);
  }
  return restrictionCutSites;
}

/** Find cutsites for a list of enzymes, keyed by enzyme name. */
export function getCutsitesFromSequence(
  sequence: string,
  circular: boolean,
  restrictionEnzymes: RestrictionEnzyme[]
): Record<string, Cutsite[]> {
  const cutsitesByName: Record<string, Cutsite[]> = {};
  const methylatedRegions = findMethylatedRegions(sequence, circular);
  for (let i = 0; i < restrictionEnzymes.length; i++) {
    const re = restrictionEnzymes[i];
    const cutsites = cutSequenceByRestrictionEnzyme(sequence, circular, re);
    if (cutsites.length) {
      cutsites.forEach((c) => {
        c.methylationStatus = checkCutsiteMethylation(c, sequence, circular, methylatedRegions);
      });
      cutsitesByName[re.name] = cutsites;
    }
  }
  return cutsitesByName;
}

/** Get all cutsites across a list of enzymes as a flat array. */
export function getCutsitesFromSequenceFlat(
  sequence: string,
  circular: boolean,
  restrictionEnzymes: RestrictionEnzyme[]
): Cutsite[] {
  const all: Cutsite[] = [];
  const methylatedRegions = findMethylatedRegions(sequence, circular);
  for (const re of restrictionEnzymes) {
    const cutsites = cutSequenceByRestrictionEnzyme(sequence, circular, re);
    cutsites.forEach((c) => {
      c.methylationStatus = checkCutsiteMethylation(c, sequence, circular, methylatedRegions);
    });
    all.push(...cutsites);
  }
  return all;
}

/** Resolve enzyme definitions from the default enzyme database by name (case-insensitive). */
export function getEnzymeByName(name: string): RestrictionEnzyme | undefined {
  if (!name || typeof name !== "string") return undefined;
  const key = name.toLowerCase();
  return defaultDb[key];
}

/** Get a list of enzyme definitions for names present in the default DB. */
export function getEnzymesByNames(names: string[]): RestrictionEnzyme[] {
  const out: RestrictionEnzyme[] = [];
  for (const name of names) {
    const e = getEnzymeByName(name);
    if (e) out.push(e);
  }
  return out;
}

const IUPAC_TO_REGEX: Record<string, string> = {
  A: "a",
  C: "c",
  G: "g",
  T: "t",
  U: "u",
  R: "[ag]",
  Y: "[ct]",
  S: "[cg]",
  W: "[at]",
  K: "[gt]",
  M: "[ac]",
  B: "[cgt]",
  D: "[agt]",
  H: "[act]",
  V: "[acg]",
  N: "[abcdghkmnrstvwy]"
};

/** Convert an IUPAC motif (e.g. "GGWCC") into a regex string usable by the cutsite engine. */
export function motifToRegex(site: string): string {
  let out = "";
  for (const ch of site.toUpperCase()) {
    out += IUPAC_TO_REGEX[ch] || ".";
  }
  return out;
}

/**
 * Build an enzyme definition from a REBASE-style entry `{seq, cut, isBlunt}`.
 * Used when an enzyme isn't in the tg-oss default DB. `cut` is the 0-based
 * top-strand cut index within the recognition site.
 */
export function enzymeFromSite(
  name: string,
  site: string,
  cut: number,
  isBlunt = false
): RestrictionEnzyme {
  const forwardRegex = motifToRegex(site);
  const reverseRegex = motifToRegex(getReverseComplementSequenceString(site));
  const topSnipOffset = cut + 1; // in-between position after the cut base
  const bottomSnipOffset = isBlunt ? topSnipOffset : topSnipOffset - 1;
  return {
    name,
    site,
    forwardRegex,
    reverseRegex,
    topSnipOffset,
    bottomSnipOffset,
    cutType: 0
  };
}

/**
 * Resolve an enzyme definition by name: prefer the tg-oss default DB,
 * fall back to a generated definition from REBASE-style data.
 */
export function resolveEnzyme(
  name: string,
  fallback?: { seq: string; cut: number; isBlunt?: boolean }
): RestrictionEnzyme | undefined {
  const fromDb = getEnzymeByName(name);
  if (fromDb) return fromDb;
  if (fallback && fallback.seq) {
    return enzymeFromSite(name, fallback.seq, fallback.cut, fallback.isBlunt);
  }
  return undefined;
}

// ──────────────────────────────── Methylation Tracking ────────────────────────────────

export interface MethylatedRegion {
  start: number;
  end: number;
  type: "Dam" | "Dcm" | "EcoKI";
  motif: string;
}

export interface MethylationStatus {
  isBlocked: boolean;
  requiredButUnmethylated: boolean;
  type?: "Dam" | "Dcm" | "EcoKI";
  motif?: string;
}

export const ENZYME_METHYLATION_SENSITIVITY: Record<
  string,
  { dam?: "blocked" | "required" | "no"; dcm?: "blocked" | "required" | "no"; ecoki?: "blocked" | "required" | "no" }
> = {
  clai: { dam: "blocked" },   // ClaI: blocked by Dam if overlapping (e.g. GATCGAT or ATCGATC)
  mboi: { dam: "blocked" },   // MboI: completely blocked by Dam
  dpni: { dam: "required" },  // DpnI: requires Dam methylation (cuts GATC only if methylated)
  xbai: { dam: "blocked" },   // XbaI: blocked by Dam if overlapping (e.g. GATCTAGA or TCTAGATC)
  bcli: { dam: "blocked" },   // BclI: completely blocked by Dam (TGATCA contains GATC)
  taqi: { dam: "blocked" },   // TaqI: blocked by Dam if overlapping (TCGATC or GATCGA)
  hpa2: { dcm: "blocked" },   // HpaII/MspI: blocked by Dcm/CpG depending on context
  ecor2: { dcm: "blocked" },  // EcoRII: completely blocked by Dcm (CCWGG)
  stui: { dcm: "blocked" },   // StuI: blocked by Dcm if flanked (CCAGGCCTGG)
  sexai: { dcm: "blocked" },  // SexAI: completely blocked by Dcm (ACCWGGT)
  bsu36i: { dcm: "blocked" },  // Bsu36I: blocked if overlapping CCWGG
  ecoki: { ecoki: "blocked" }  // EcoKI: blocked by its own system if unmethylated
};

/**
 * Scan sequence for active Dam/Dcm methylation target sites.
 * Dam: GATC (palindromic, Adenine methylated)
 * Dcm: CCWGG (where W is A or T, palindromic, second Cytosine methylated)
 */
export function findMethylatedRegions(sequence: string, circular: boolean): MethylatedRegion[] {
  const regions: MethylatedRegion[] = [];
  const seqUpper = sequence.toUpperCase();
  const len = sequence.length;
  if (len === 0) return regions;

  const searchSeq = circular ? seqUpper + seqUpper : seqUpper;

  // 1. Scan for Dam: GATC
  const damRegex = /GATC/g;
  let match: RegExpExecArray | null;
  while ((match = damRegex.exec(searchSeq)) !== null) {
    const start = match.index;
    const end = start + 3; // GATC is 4 bp
    if (start < len) {
      regions.push({
        start: start % len,
        end: end % len,
        type: "Dam",
        motif: "GATC"
      });
    }
    // Avoid infinite loop if regex doesn't progress
    if (match.index === damRegex.lastIndex) {
      damRegex.lastIndex++;
    }
  }

  // 2. Scan for Dcm: CCWGG (CCAAGG or CCTGGG)
  const dcmRegex = /CC[AT]GG/g;
  while ((match = dcmRegex.exec(searchSeq)) !== null) {
    const start = match.index;
    const end = start + 4; // CCWGG is 5 bp
    if (start < len) {
      regions.push({
        start: start % len,
        end: end % len,
        type: "Dcm",
        motif: searchSeq.substring(start, start + 5)
      });
    }
    if (match.index === dcmRegex.lastIndex) {
      dcmRegex.lastIndex++;
    }
  }

  // 3. Scan for EcoKI: AAC(N6)GTGC / GCAC(N6)GTT
  const ecokiFwdRegex = /AAC[ATGCN].{5}GTGC/g;
  while ((match = ecokiFwdRegex.exec(searchSeq)) !== null) {
    const start = match.index;
    const end = start + 12; // AAC(N6)GTGC is 13 bp
    if (start < len) {
      regions.push({
        start: start % len,
        end: end % len,
        type: "EcoKI",
        motif: searchSeq.substring(start, start + 13)
      });
    }
    if (match.index === ecokiFwdRegex.lastIndex) {
      ecokiFwdRegex.lastIndex++;
    }
  }

  const ecokiRevRegex = /GCAC[ATGCN].{5}GTT/g;
  while ((match = ecokiRevRegex.exec(searchSeq)) !== null) {
    const start = match.index;
    const end = start + 12; // GCAC(N6)GTT is 13 bp
    if (start < len) {
      regions.push({
        start: start % len,
        end: end % len,
        type: "EcoKI",
        motif: searchSeq.substring(start, start + 13)
      });
    }
    if (match.index === ecokiRevRegex.lastIndex) {
      ecokiRevRegex.lastIndex++;
    }
  }

  return regions;
}

/**
 * Overlap-aware methylation sensitivity checker. Determines if a cutsite's biological
 * recognition sequence is blocked by overlapping Dam/Dcm methylation or if it lacks
 * required methylation (e.g. DpnI).
 */
export function checkCutsiteMethylation(
  cutsite: Cutsite,
  sequence: string,
  circular: boolean,
  methylatedRegions: MethylatedRegion[]
): MethylationStatus {
  const enzymeName = cutsite.name.toLowerCase();
  const sensitivity = ENZYME_METHYLATION_SENSITIVITY[enzymeName];
  if (!sensitivity) {
    return { isBlocked: false, requiredButUnmethylated: false };
  }

  const siteStart = cutsite.recognitionSiteRange.start;
  const siteEnd = cutsite.recognitionSiteRange.end;
  const seqLen = sequence.length;
  if (seqLen === 0) {
    return { isBlocked: false, requiredButUnmethylated: false };
  }

  // Helper to check if two ranges overlap on a circular/linear sequence
  const isOverlapping = (s1: number, e1: number, s2: number, e2: number): boolean => {
    const getBases = (s: number, e: number) => {
      const set = new Set<number>();
      let curr = s;
      const endPos = (e + 1) % seqLen;
      while (curr !== e) {
        set.add(curr);
        curr = (curr + 1) % seqLen;
      }
      set.add(e);
      return set;
    };
    const set1 = getBases(s1, e1);
    const set2 = getBases(s2, e2);
    for (const b of set1) {
      if (set2.has(b)) return true;
    }
    return false;
  };

  // Find all methylated regions that overlap with the recognition site
  for (const region of methylatedRegions) {
    if (isOverlapping(siteStart, siteEnd, region.start, region.end)) {
      if (region.type === "Dam") {
        if (sensitivity.dam === "blocked") {
          // If enzyme is MboI or BclI, any overlap blocks it.
          if (enzymeName === "mboi" || enzymeName === "bcli") {
            return { isBlocked: true, requiredButUnmethylated: false, type: "Dam", motif: "GATC" };
          }
          // ClaI: blocked if ATCGAT is preceded by G or followed by TC (GATCGAT or ATCGATC)
          if (enzymeName === "clai") {
            const prevChar = sequence.charAt((siteStart - 1 + seqLen) % seqLen).toUpperCase();
            const nextChars = (sequence.charAt((siteEnd + 1) % seqLen) + sequence.charAt((siteEnd + 2) % seqLen)).toUpperCase();
            if (prevChar === "G" || nextChars === "TC") {
              return { isBlocked: true, requiredButUnmethylated: false, type: "Dam", motif: "GATC" };
            }
          }
          // XbaI: blocked if TCTAGA is preceded by GA (making GATCTAGA) or followed by TC (making TCTAGATC)
          if (enzymeName === "xbai") {
            const prevChar2 = (sequence.charAt((siteStart - 2 + seqLen) % seqLen) + sequence.charAt((siteStart - 1 + seqLen) % seqLen)).toUpperCase();
            const nextChars = (sequence.charAt((siteEnd + 1) % seqLen) + sequence.charAt((siteEnd + 2) % seqLen)).toUpperCase();
            if (prevChar2 === "GA" || nextChars === "TC") {
              return { isBlocked: true, requiredButUnmethylated: false, type: "Dam", motif: "GATC" };
            }
          }
          // TaqI: blocked if TCGA is preceded by GA (GATCGA) or followed by TC (TCGATC)
          if (enzymeName === "taqi") {
            const prevChar2 = (sequence.charAt((siteStart - 2 + seqLen) % seqLen) + sequence.charAt((siteStart - 1 + seqLen) % seqLen)).toUpperCase();
            const nextChars = (sequence.charAt((siteEnd + 1) % seqLen) + sequence.charAt((siteEnd + 2) % seqLen)).toUpperCase();
            if (prevChar2 === "GA" || nextChars === "TC") {
              return { isBlocked: true, requiredButUnmethylated: false, type: "Dam", motif: "GATC" };
            }
          }
          // Default block for other overlapping Dam sensitivity
          return { isBlocked: true, requiredButUnmethylated: false, type: "Dam", motif: "GATC" };
        }
      } else if (region.type === "Dcm") {
        if (sensitivity.dcm === "blocked") {
          return { isBlocked: true, requiredButUnmethylated: false, type: "Dcm", motif: region.motif };
        }
      } else if (region.type === "EcoKI") {
        if (sensitivity.ecoki === "blocked") {
          return { isBlocked: true, requiredButUnmethylated: false, type: "EcoKI", motif: region.motif };
        }
      }
    }
  }

  // DpnI requires Dam methylation, so if no Dam overlap is present, it is required but unmethylated
  if (enzymeName === "dpni" && sensitivity.dam === "required") {
    let hasDamOverlap = false;
    for (const region of methylatedRegions) {
      if (region.type === "Dam" && isOverlapping(siteStart, siteEnd, region.start, region.end)) {
        hasDamOverlap = true;
        break;
      }
    }
    if (!hasDamOverlap) {
      return { isBlocked: false, requiredButUnmethylated: true, type: "Dam", motif: "GATC" };
    }
  }

  return { isBlocked: false, requiredButUnmethylated: false };
}

// ──────────────────────────────── Restriction Enzyme Buffer Compatibility (Feature 7) ────────────────────────────────

export interface BufferCompatibility {
  cutSmart: number;      // percent activity, e.g. 100
  r1_1: number;          // Buffer 1.1 percent activity
  r2_1: number;          // Buffer 2.1 percent activity
  r3_1: number;          // Buffer 3.1 percent activity
  preferredBuffer: string; // e.g. "CutSmart" or "Buffer 3.1"
}

const ENZYME_BUFFERS: Record<string, BufferCompatibility> = {
  EcoRI: { cutSmart: 100, r1_1: 25, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  BamHI: { cutSmart: 100, r1_1: 75, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  HindIII: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 50, preferredBuffer: 'CutSmart' },
  SalI: { cutSmart: 100, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'Buffer 3.1' },
  XhoI: { cutSmart: 100, r1_1: 75, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  NdeI: { cutSmart: 100, r1_1: 75, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  SacI: { cutSmart: 100, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  KpnI: { cutSmart: 100, r1_1: 25, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  BsaI: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  BbsI: { cutSmart: 100, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  BsmBI: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  NotI: { cutSmart: 100, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  XbaI: { cutSmart: 100, r1_1: 25, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  PstI: { cutSmart: 100, r1_1: 75, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  SmaI: { cutSmart: 50, r1_1: 50, r2_1: 25, r3_1: 10, preferredBuffer: 'Buffer 1.1' },
  SpeI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  ClaI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  BglII: { cutSmart: 10, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'Buffer 3.1' },
  EcoRV: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  NcoI: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  MluI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  ScaI: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  AflII: { cutSmart: 100, r1_1: 75, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  AvrII: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  ApaI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  SapI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  AarI: { cutSmart: 100, r1_1: 10, r2_1: 50, r3_1: 100, preferredBuffer: 'Buffer 3.1' },
  XmaI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  PvuI: { cutSmart: 100, r1_1: 10, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  PvuII: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  DpnI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  AluI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  HaeIII: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  SphI: { cutSmart: 100, r1_1: 50, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  HincII: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
  FokI: { cutSmart: 100, r1_1: 100, r2_1: 100, r3_1: 100, preferredBuffer: 'CutSmart' },
};

/**
 * Returns the NEB buffer compatibility percentages for any restriction enzyme name.
 */
export function getEnzymeBufferCompatibility(name: string): BufferCompatibility {
  const clean = name.trim();
  
  // 1. Try to load from dynamic persistent local storage database first
  let buffers = ENZYME_BUFFERS;
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('spice_neb_buffers');
    if (saved) {
      try {
        buffers = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse persistent NEB buffers:", e);
      }
    } else {
      // Initialize persistence with our comprehensive list so it's fully persistent and editable
      try {
        localStorage.setItem('spice_neb_buffers', JSON.stringify(ENZYME_BUFFERS));
      } catch (e) {}
    }
  }

  // 2. Resolve matching enzyme
  const foundKey = Object.keys(buffers).find(k => k.toLowerCase() === clean.toLowerCase());
  return foundKey ? buffers[foundKey] : {
    cutSmart: 100,
    r1_1: 75,
    r2_1: 100,
    r3_1: 75,
    preferredBuffer: 'CutSmart'
  };
}

