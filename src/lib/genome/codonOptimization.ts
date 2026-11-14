// Multi-objective synonymous codon optimization.
//
// The optimizer starts from the most adaptive codon for every residue and then
// performs a deterministic, seeded local search over synonymous alternatives.
// Each candidate is scored on a combination of CAI, global GC content, local
// GC windows, homopolymer runs, and forbidden DNA motifs.

import {
  BEST_CODONS,
  CODON_WEIGHTS,
  calculateCai,
  type CodonHost
} from "./codon";

export interface CodonOptimizationOptions {
  host: "ecoli" | "yeast" | "human";
  targetGc?: number;
  gcWindow?: number;
  maxHomopolymer?: number;
  forbiddenMotifs?: string[];
  seed?: number;
  iterations?: number;
}

export interface CodonOptimizationResult {
  sequence: string;
  cai: number;
  gc: number;
  iterations: number;
  violations: string[];
  improvements: number;
}

const DEFAULT_TARGET_GC = 50;
const DEFAULT_GC_WINDOW = 30;
const DEFAULT_MAX_HOMOPOLYMER = 5;
const DEFAULT_SEED = 0x9e3779b9;

// Objective weights are expressed on a common scale (lower score is better).
// CAI is rewarded, while every other term is a penalty.
const CAI_WEIGHT = 2;
const GC_WEIGHT = 12;
const GC_WINDOW_WEIGHT = 4;
const HOMOPOLYMER_WEIGHT = 1;
const FORBIDDEN_MOTIF_WEIGHT = 100;

const EPSILON = 1e-12;

interface ResolvedOptions {
  host: CodonHost;
  targetGc: number;
  gcWindow: number;
  maxHomopolymer: number;
  forbiddenMotifs: string[];
  seed: number;
  iterations: number;
}

interface Evaluation {
  score: number;
  motifCount: number;
}

/** GC content as a percentage (0..100). Non-DNA characters are ignored. */
export function calculateGc(sequence: string): number {
  const clean = sequence.toUpperCase().replace(/[^ACGT]/g, "");
  if (clean.length === 0) return 0;
  let gcCount = 0;
  for (const base of clean) {
    if (base === "G" || base === "C") gcCount++;
  }
  return (gcCount / clean.length) * 100;
}

/** Length of the longest run of a single nucleotide. */
export function longestHomopolymer(sequence: string): number {
  const clean = sequence.toUpperCase();
  if (clean.length === 0) return 0;
  let longest = 1;
  let currentRun = 1;
  for (let i = 1; i < clean.length; i++) {
    if (clean[i] === clean[i - 1]) {
      currentRun++;
      if (currentRun > longest) longest = currentRun;
    } else {
      currentRun = 1;
    }
  }
  return longest;
}

/**
 * Return the distinct forbidden motifs that occur at least once in `sequence`.
 * Matching is case-insensitive and motifs are reported in input order.
 */
export function findForbiddenMotifs(
  sequence: string,
  motifs: readonly string[]
): string[] {
  const upperSequence = sequence.toUpperCase();
  const seen = new Set<string>();
  const found: string[] = [];
  for (const rawMotif of motifs) {
    const motif = rawMotif.toUpperCase();
    if (motif.length === 0 || seen.has(motif)) continue;
    if (upperSequence.includes(motif)) {
      seen.add(motif);
      found.push(motif);
    }
  }
  return found;
}

function isGc(base: string): boolean {
  return base === "G" || base === "C";
}

function createPrng(seed: number): () => number {
  // Mulberry32: tiny, deterministic, and dependency-free.
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length);
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
}

function resolveOptions(
  options: CodonOptimizationOptions,
  proteinLength: number
): ResolvedOptions {
  if (!options || !Object.prototype.hasOwnProperty.call(CODON_WEIGHTS, options.host)) {
    throw new Error(
      `Unknown host "${options?.host ?? ""}". Use "ecoli", "yeast", or "human".`
    );
  }

  const targetGc = options.targetGc ?? DEFAULT_TARGET_GC;
  assertFiniteNumber(targetGc, "targetGc");
  if (targetGc < 0 || targetGc > 100) {
    throw new Error("targetGc must be between 0 and 100.");
  }

  const gcWindow = options.gcWindow ?? DEFAULT_GC_WINDOW;
  assertFiniteNumber(gcWindow, "gcWindow");
  if (!Number.isInteger(gcWindow) || gcWindow < 1) {
    throw new Error("gcWindow must be a positive integer.");
  }

  const maxHomopolymer = options.maxHomopolymer ?? DEFAULT_MAX_HOMOPOLYMER;
  assertFiniteNumber(maxHomopolymer, "maxHomopolymer");
  if (!Number.isInteger(maxHomopolymer) || maxHomopolymer < 1) {
    throw new Error("maxHomopolymer must be a positive integer.");
  }

  const forbiddenMotifs: string[] = [];
  for (const rawMotif of options.forbiddenMotifs ?? []) {
    const motif = rawMotif.toUpperCase();
    if (!/^[ACGT]+$/.test(motif)) {
      throw new Error(
        `Invalid forbidden motif "${rawMotif}". Use a non-empty DNA motif containing only A, C, G, and T.`
      );
    }
    if (!forbiddenMotifs.includes(motif)) forbiddenMotifs.push(motif);
  }

  const seed = options.seed ?? DEFAULT_SEED;
  assertFiniteNumber(seed, "seed");

  const defaultIterations = Math.max(500, proteinLength * 20);
  const iterations = options.iterations ?? defaultIterations;
  assertFiniteNumber(iterations, "iterations");
  if (!Number.isInteger(iterations) || iterations < 0) {
    throw new Error("iterations must be a non-negative integer.");
  }

  return {
    host: options.host as CodonHost,
    targetGc,
    gcWindow,
    maxHomopolymer,
    forbiddenMotifs,
    seed: Math.trunc(seed),
    iterations
  };
}

function normalizeProtein(protein: string, host: CodonHost): string {
  const cleaned = protein.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length === 0) {
    throw new Error("Protein sequence is empty.");
  }
  const knownResidues = CODON_WEIGHTS[host];
  for (let i = 0; i < cleaned.length; i++) {
    const residue = cleaned[i];
    if (!Object.prototype.hasOwnProperty.call(knownResidues, residue)) {
      throw new Error(
        `Unsupported amino acid "${residue}" at position ${i + 1}. ` +
          `Only standard residues and "*" are allowed.`
      );
    }
  }
  return cleaned;
}

function gcWindowMaxDeviation(
  sequence: string,
  targetGc: number,
  requestedWindow: number
): number {
  if (sequence.length === 0) return 0;
  const windowSize = Math.max(1, Math.min(requestedWindow, sequence.length));
  let gcCount = 0;
  for (let i = 0; i < windowSize; i++) {
    if (isGc(sequence[i])) gcCount++;
  }
  let maxDeviation = Math.abs((gcCount / windowSize) * 100 - targetGc);
  for (let i = windowSize; i < sequence.length; i++) {
    if (isGc(sequence[i - windowSize])) gcCount--;
    if (isGc(sequence[i])) gcCount++;
    const deviation = Math.abs((gcCount / windowSize) * 100 - targetGc);
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  return maxDeviation;
}

function homopolymerExcess(sequence: string, maxRun: number): number {
  if (sequence.length === 0) return 0;
  let excess = 0;
  let run = 1;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] === sequence[i - 1]) {
      run++;
      if (run > maxRun) excess++;
    } else {
      run = 1;
    }
  }
  return excess;
}

function countMotifOccurrences(
  sequence: string,
  motifs: readonly string[]
): number {
  let count = 0;
  for (const motif of motifs) {
    let from = 0;
    while (from <= sequence.length - motif.length) {
      const index = sequence.indexOf(motif, from);
      if (index === -1) break;
      count++;
      from = index + 1;
    }
  }
  return count;
}

function evaluateSequence(sequence: string, options: ResolvedOptions): Evaluation {
  const { cai, gc } = calculateCai(sequence, options.host);
  const windowDeviation = gcWindowMaxDeviation(
    sequence,
    options.targetGc,
    options.gcWindow
  );
  const excess = homopolymerExcess(sequence, options.maxHomopolymer);
  const motifCount = countMotifOccurrences(sequence, options.forbiddenMotifs);

  const score =
    -CAI_WEIGHT * cai +
    GC_WEIGHT * (Math.abs(gc - options.targetGc) / 100) +
    GC_WINDOW_WEIGHT * (windowDeviation / 100) +
    HOMOPOLYMER_WEIGHT * excess +
    FORBIDDEN_MOTIF_WEIGHT * motifCount;

  return { score, motifCount };
}

interface HomopolymerRun {
  base: string;
  start: number;
  length: number;
}

function homopolymerRunsAbove(
  sequence: string,
  maxRun: number
): HomopolymerRun[] {
  const runs: HomopolymerRun[] = [];
  let start = 0;
  for (let i = 1; i <= sequence.length; i++) {
    if (i === sequence.length || sequence[i] !== sequence[start]) {
      const length = i - start;
      if (length > maxRun) {
        runs.push({ base: sequence[start], start, length });
      }
      start = i;
    }
  }
  return runs;
}

function buildViolations(
  sequence: string,
  options: ResolvedOptions
): string[] {
  const violations: string[] = [];

  for (const motif of options.forbiddenMotifs) {
    let from = 0;
    while (from <= sequence.length - motif.length) {
      const index = sequence.indexOf(motif, from);
      if (index === -1) break;
      violations.push(`Forbidden motif ${motif} at position ${index + 1}.`);
      from = index + 1;
    }
  }

  for (const run of homopolymerRunsAbove(sequence, options.maxHomopolymer)) {
    violations.push(
      `Homopolymer ${run.base} x ${run.length} at position ${run.start + 1} ` +
        `exceeds maximum ${options.maxHomopolymer}.`
    );
  }

  return violations;
}

/**
 * Optimize a protein sequence using synonymous codons for the requested host.
 *
 * The search is deterministic for a given seed and needs no external state.
 * Stop codons in the input are preserved as stop codons in the output. Unknown
 * residues and empty inputs throw an Error so callers can surface a clear
 * validation message.
 */
export function optimizeCodonsMultiObjective(
  protein: string,
  options: CodonOptimizationOptions
): CodonOptimizationResult {
  const resolved = resolveOptions(options, protein.replace(/\s+/g, "").length);
  const residues = normalizeProtein(protein, resolved.host);

  const alternatives: string[][] = [];
  const codons: string[] = [];
  const mutablePositions: number[] = [];

  for (let i = 0; i < residues.length; i++) {
    const residue = residues[i];
    const usage = CODON_WEIGHTS[resolved.host][residue];
    const synonymousCodons = Object.keys(usage);
    alternatives.push(synonymousCodons);

    const bestCodon = BEST_CODONS[resolved.host][residue] ?? synonymousCodons[0];
    codons.push(bestCodon);

    if (synonymousCodons.length > 1) mutablePositions.push(i);
  }

  let sequence = codons.join("");
  let current = evaluateSequence(sequence, resolved);
  let improvements = 0;
  let performedIterations = 0;

  if (mutablePositions.length > 0) {
    const rng = createPrng(resolved.seed);

    for (let iteration = 0; iteration < resolved.iterations; iteration++) {
      performedIterations++;

      const position =
        mutablePositions[randomIndex(rng, mutablePositions.length)];
      const synonymousCodons = alternatives[position];
      const currentCodon = codons[position];

      let candidateCodon =
        synonymousCodons[randomIndex(rng, synonymousCodons.length)];
      if (candidateCodon === currentCodon) {
        const currentIndex = synonymousCodons.indexOf(currentCodon);
        candidateCodon =
          synonymousCodons[(currentIndex + 1) % synonymousCodons.length];
      }

      codons[position] = candidateCodon;
      const candidateSequence = codons.join("");
      const candidate = evaluateSequence(candidateSequence, resolved);

      // A candidate may keep existing forbidden motifs but may never increase
      // their occurrence count, so unavoidable motifs are the only residuals.
      const motifSafe = candidate.motifCount <= current.motifCount;
      const isImprovement = candidate.score < current.score - EPSILON;

      if (motifSafe && isImprovement) {
        sequence = candidateSequence;
        current = candidate;
        improvements++;
      } else {
        codons[position] = currentCodon;
      }
    }
  }

  const stats = calculateCai(sequence, resolved.host);

  return {
    sequence,
    cai: stats.cai,
    gc: stats.gc,
    iterations: performedIterations,
    violations: buildViolations(sequence, resolved),
    improvements
  };
}
