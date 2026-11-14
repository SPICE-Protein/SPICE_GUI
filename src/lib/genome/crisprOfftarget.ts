/**
 * Genome-wide CRISPR off-target search.
 *
 * This module is pure TypeScript: it does not depend on Tauri, Svelte, or the
 * generated Paraglide runtime, so it can run in tests and in any JS host.
 *
 * It scans one or more genome sequences on both strands for protospacers that
 * carry a valid (IUPAC-aware) PAM and differ from the supplied guide by no more
 * than a configurable number of mismatches.
 *
 * Scoring note: the `cfd` field produced here is a position-weighted mismatch
 * heuristic. It is NOT the MIT CFD model and must not be presented as such.
 */

import { getReverseComplementSequenceString } from "./sequence";

// ──────────────────────────────── Types ────────────────────────────────

export interface OfftargetConfig {
  /** IUPAC PAM pattern, e.g. "NGG" for SpCas9 or "TTTV" for Cas12a. */
  pam: string;
  /** Protospacer length to compare. Defaults to the guide length. */
  guideLength?: number;
  /** Maximum mismatches allowed in the protospacer (default 4). */
  maxMismatches?: number;
  /** Maximum number of hits returned across all genomes (default 100). */
  maxHits?: number;
  /** Whether the PAM sits 3' or 5' of the protospacer (default "3prime"). */
  pamDirection?: "3prime" | "5prime";
}

export interface GenomeSequence {
  id: string;
  sequence: string;
}

export interface OfftargetHit {
  genomeId: string;
  /**
   * 0-based index on the forward genome of the leftmost protospacer base.
   * For a hit on the minus strand this is the lower genomic coordinate of the
   * protospacer footprint; the guide itself is read 5' -> 3' on that strand.
   */
  position: number;
  strand: "+" | "-";
  /** Protospacer sequence as read 5' -> 3' on the hit strand. */
  guide: string;
  /** PAM sequence as read 5' -> 3' on the hit strand. */
  pam: string;
  mismatches: number;
  /** Position-weighted heuristic in [0, 1]; NOT MIT CFD (see module header). */
  cfd: number;
  /** True when the protospacer matches the guide exactly (zero mismatches). */
  onTarget: boolean;
}

// ──────────────────────────────── IUPAC PAM matching ────────────────────────────────

/**
 * IUPAC nucleotide code to a regular-expression character class.
 * U is accepted as a synonym for T so RNA-flavoured input still works.
 */
const IUPAC_TO_REGEX: Record<string, string> = {
  A: "A",
  C: "C",
  G: "G",
  T: "T",
  U: "T",
  R: "[AG]",
  Y: "[CT]",
  S: "[CG]",
  W: "[AT]",
  K: "[GT]",
  M: "[AC]",
  B: "[CGT]",
  D: "[AGT]",
  H: "[ACT]",
  V: "[ACG]",
  N: "[ACGT]"
};

/**
 * Compile an IUPAC PAM string into an anchored, case-insensitive RegExp.
 * Unknown characters throw instead of silently producing a wrong search.
 */
function compilePamPattern(pam: string): RegExp {
  const normalized = pam.trim().toUpperCase();
  if (normalized.length === 0) {
    throw new Error("PAM pattern must not be empty");
  }

  let source = "^";
  for (const base of normalized) {
    const token = IUPAC_TO_REGEX[base];
    if (!token) {
      throw new Error(`Unsupported IUPAC base "${base}" in PAM pattern "${pam}"`);
    }
    source += token;
  }
  source += "$";

  return new RegExp(source, "i");
}

// ──────────────────────────────── Heuristic scoring ────────────────────────────────

/**
 * Position-weighted mismatch score (heuristic, NOT MIT CFD).
 *
 * Each mismatch multiplies the score by a weight below 1. Mismatches in the
 * seed region (the 10 protospacer positions closest to the PAM) are penalized
 * far more heavily than mismatches at the distal 5' end. This yields sensible
 * relative ordering without pretending to reproduce the experimentally derived
 * MIT CFD weights.
 *
 * @param guideLength protospacer length
 * @param mismatchPositions 0-based positions within the protospacer
 */
function heuristicCfd(guideLength: number, mismatchPositions: number[]): number {
  let score = 1;

  for (const position of mismatchPositions) {
    // 0 for the base immediately next to the PAM.
    const distanceFromPam = guideLength - 1 - position;

    let weight: number;
    if (distanceFromPam < 10) {
      // Seed region: 0.10 at the PAM-proximal base rising to 0.505 at distance 9.
      weight = 0.1 + 0.045 * distanceFromPam;
    } else {
      // Distal region: milder penalties, saturating at 0.80.
      weight = 0.6 + 0.02 * Math.min(distanceFromPam - 10, 10);
    }

    score *= weight;
  }

  return Number(score.toFixed(4));
}

// ──────────────────────────────── Core search ────────────────────────────────

/** Normalize DNA input: trim, uppercase, and convert U to T. */
function normalizeDna(sequence: string): string {
  return sequence.trim().toUpperCase().replace(/U/g, "T");
}

/**
 * Count mismatches between two equal-length protospacers, giving up as soon as
 * the count exceeds `limit`. Returns null when the limit is exceeded.
 */
function countMismatches(
  candidate: string,
  guide: string,
  limit: number
): number[] | null {
  const positions: number[] = [];

  for (let i = 0; i < guide.length; i++) {
    if (candidate[i] !== guide[i]) {
      positions.push(i);
      if (positions.length > limit) return null;
    }
  }

  return positions;
}

/**
 * Scan a single strand for PAM-adjacent protospacers within the mismatch limit.
 *
 * `sequence` is always read 5' -> 3' on the strand being scanned. For the minus
 * strand the caller passes the reverse complement, and `forwardGenomeLength`
 * is used to map each hit back to forward-strand coordinates.
 */
function scanStrand(
  sequence: string,
  genomeId: string,
  strand: "+" | "-",
  guide: string,
  pamLength: number,
  pamDirection: "3prime" | "5prime",
  pamRegex: RegExp,
  maxMismatches: number,
  forwardGenomeLength: number
): OfftargetHit[] {
  const guideLength = guide.length;
  const siteLength = guideLength + pamLength;
  const hits: OfftargetHit[] = [];

  for (let i = 0; i + siteLength <= sequence.length; i++) {
    let guideStart: number;
    let pamStart: number;

    if (pamDirection === "3prime") {
      // [protospacer][PAM]
      guideStart = i;
      pamStart = i + guideLength;
    } else {
      // [PAM][protospacer]
      pamStart = i;
      guideStart = i + pamLength;
    }

    const pam = sequence.slice(pamStart, pamStart + pamLength);
    if (!pamRegex.test(pam)) continue;

    const candidate = sequence.slice(guideStart, guideStart + guideLength);
    const mismatchPositions = countMismatches(candidate, guide, maxMismatches);
    if (mismatchPositions === null) continue;

    const position =
      strand === "+"
        ? guideStart
        : forwardGenomeLength - (guideStart + guideLength);

    hits.push({
      genomeId,
      position,
      strand,
      guide: candidate,
      pam,
      mismatches: mismatchPositions.length,
      cfd: heuristicCfd(guideLength, mismatchPositions),
      onTarget: mismatchPositions.length === 0
    });
  }

  return hits;
}

/**
 * Find all genome-wide protospacer hits for `guide` across `genomes`.
 *
 * Both strands are scanned. A hit must have a PAM matching `config.pam`
 * (IUPAC codes such as N, R, Y, V are supported) and at most
 * `config.maxMismatches` protospacer mismatches (default 4).
 *
 * Results are sorted by heuristic CFD descending, then by mismatch count
 * ascending, then by genome id and position for determinism, and finally capped
 * at `config.maxHits` (default 100).
 */
export function findGenomeWideOfftargets(
  guide: string,
  genomes: GenomeSequence[],
  config: OfftargetConfig
): OfftargetHit[] {
  const normalizedGuide = normalizeDna(guide);

  if (normalizedGuide.length === 0) {
    throw new Error("Guide sequence must not be empty");
  }
  if (!/^[ACGT]+$/.test(normalizedGuide)) {
    throw new Error("Guide sequence must contain only A, C, G, or T (U is accepted as T)");
  }

  const guideLength = Math.min(
    config.guideLength ?? normalizedGuide.length,
    normalizedGuide.length
  );
  if (guideLength <= 0) {
    throw new Error("guideLength must be a positive integer");
  }

  const guideSlice = normalizedGuide.slice(0, guideLength);
  const pamPattern = compilePamPattern(config.pam);
  const pamLength = config.pam.trim().length;
  const pamDirection = config.pamDirection ?? "3prime";
  const maxMismatches = Math.max(0, Math.floor(config.maxMismatches ?? 4));
  const maxHits =
    config.maxHits === undefined
      ? 100
      : Number.isFinite(config.maxHits)
        ? Math.max(0, Math.floor(config.maxHits))
        : Infinity;

  const hits: OfftargetHit[] = [];

  for (const genome of genomes) {
    const forward = normalizeDna(genome.sequence);
    if (forward.length < guideLength + pamLength) continue;

    hits.push(
      ...scanStrand(
        forward,
        genome.id,
        "+",
        guideSlice,
        pamLength,
        pamDirection,
        pamPattern,
        maxMismatches,
        forward.length
      )
    );

    const reverse = getReverseComplementSequenceString(forward);
    hits.push(
      ...scanStrand(
        reverse,
        genome.id,
        "-",
        guideSlice,
        pamLength,
        pamDirection,
        pamPattern,
        maxMismatches,
        forward.length
      )
    );
  }

  hits.sort(
    (a, b) =>
      b.cfd - a.cfd ||
      a.mismatches - b.mismatches ||
      a.genomeId.localeCompare(b.genomeId) ||
      a.position - b.position ||
      (a.strand === b.strand ? 0 : a.strand === "+" ? -1 : 1)
  );

  return hits.slice(0, maxHits);
}

// ──────────────────────────────── Specificity summary ────────────────────────────────

/**
 * Summarize a hit list.
 *
 * `onTarget` counts hits whose protospacer is an exact guide match; if a guide
 * occurs at multiple exact sites, each exact site is counted. `offTargets`
 * counts every remaining hit. `specificity` is the percentage of hits that are
 * exact matches, in the range 0-100 (0 when no hits were supplied).
 */
export function scoreGuideSpecificity(hits: OfftargetHit[]): {
  onTarget: number;
  offTargets: number;
  specificity: number;
} {
  let onTarget = 0;
  for (const hit of hits) {
    if (hit.onTarget) onTarget++;
  }

  const total = hits.length;
  const offTargets = total - onTarget;
  const specificity = total === 0 ? 0 : Number(((onTarget / total) * 100).toFixed(2));

  return { onTarget, offTargets, specificity };
}
