// RNA secondary structure prediction: Nussinov max-pairs folding + dot-bracket.
// Supports ssRNA and ssDNA structure search.

import { DNAComplementMap } from "./sequence";

// ──────────────────────────────── Types ────────────────────────────────

export interface RnaStructureResult {
  sequence: string;
  dotBracket: string;
  pairs: [number, number][];
  mfe: number; // approximate minimum free energy (kcal/mol)
  gcContent: number;
  stemCount: number;
  loopCount: number;
  bulgeCount: number;
  hairpinCount: number;
  stemLoops: { start: number; end: number; type: string }[];
}

export interface RnaSecondaryStructure {
  sequence: string;
  isRna: boolean;
  structures: RnaStructureResult[];
  longestHairpin: RnaStructureResult | null;
  overallMfe: number;
}

// ──────────────────────────────── Pairing ────────────────────────────────

const RNA_PAIRS: Record<string, string> = {
  A: "U", U: "A", G: "C", C: "G",
};

const DNA_PAIRS: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G",
};

function getPairMap(isRna: boolean): Record<string, string> {
  return isRna ? RNA_PAIRS : DNA_PAIRS;
}

export function canPair(a: string, b: string, isRna = true, allowWobble = true): boolean {
  const pairMap = getPairMap(isRna);
  if (!allowWobble) {
    return pairMap[a] === b;
  }
  return pairMap[a] === b || (isRna && a === "G" && b === "U");
}

// ──────────────────────────────── Nussinov ────────────────────────────────

export function nussinovFold(seq: string, isRna = true, minLoop = 3): RnaStructureResult {
  const n = seq.length;
  if (n < 4) {
    return {
      sequence: seq, dotBracket: ".".repeat(n),
      pairs: [], mfe: 0, gcContent: 0,
      stemCount: 0, loopCount: 0, bulgeCount: 0, hairpinCount: 0,
      stemLoops: [],
    };
  }

  const pairMap = getPairMap(isRna);
  const dp: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const trace: number[][][] = Array.from({ length: n }, () => Array.from({ length: n }, () => [] as number[]));

  // Fill DP
  for (let len = minLoop + 2; len < n; len++) {
    for (let i = 0; i + len < n; i++) {
      const j = i + len;
      // Skip: dp[i][j] = dp[i+1][j]
      let best = dp[i + 1][j];
      let bestK = -1;
      // Pair: find k where seq[i] pairs with seq[k]
      for (let k = i + minLoop + 1; k <= j; k++) {
        if (pairMap[seq[i]] === seq[k] || (isRna && seq[i] === "G" && seq[k] === "U")) {
          const score = (i + 1 <= k - 1 ? dp[i + 1][k - 1] : 0) + 1 + (k + 1 <= j ? dp[k + 1][j] : 0);
          if (score > best) {
            best = score;
            bestK = k;
          }
        }
      }
      dp[i][j] = best;
      if (bestK >= 0) trace[i][j].push(bestK);
    }
  }

  // Traceback to get pairs
  const pairs: [number, number][] = [];
  function backtrack(i: number, j: number) {
    if (i >= j) return;
    if (dp[i][j] === (dp[i + 1] ? dp[i + 1][j] : 0)) {
      backtrack(i + 1, j);
      return;
    }
    for (let k = i + minLoop + 1; k <= j; k++) {
      if (pairMap[seq[i]] === seq[k] || (isRna && seq[i] === "G" && seq[k] === "U")) {
        const score = (i + 1 <= k - 1 ? dp[i + 1][k - 1] : 0) + 1 + (k + 1 <= j ? dp[k + 1][j] : 0);
        if (score === dp[i][j]) {
          pairs.push([i, k]);
          backtrack(i + 1, k - 1);
          backtrack(k + 1, j);
          return;
        }
      }
    }
  }
  backtrack(0, n - 1);

  // Build dot-bracket
  const db: string[] = new Array(n).fill(".");
  for (const [i, j] of pairs) {
    db[i] = "(";
    db[j] = ")";
  }

  // GC content
  let gc = 0;
  for (const c of seq) if (c === "G" || c === "C") gc++;
  const gcContent = (gc / n) * 100;

  // Approximate MFE (very rough: -1 kcal/mol per pair, -1 per loop of 3+)
  const pairEnergy = pairs.length * -1.0;
  const loopEnergy = -0.5 * Math.max(0, n - pairs.length * 2 - 1);
  const mfe = Math.round((pairEnergy + loopEnergy) * 10) / 10;

  // Find structural elements
  const stemLoops: { start: number; end: number; type: string }[] = [];
  let hairpinCount = 0;
  let stemCount = 0;
  let loopCount = 0;
  let bulgeCount = 0;
  for (const [i, j] of pairs) {
    // Hairpin: check if this is a closing pair of a hairpin
    let isHairpin = true;
    for (let k = i + 1; k < j; k++) {
      if (db[k] === "(" || db[k] === ")") { isHairpin = false; break; }
    }
    if (isHairpin && j - i > 2) {
      hairpinCount++;
      stemLoops.push({ start: i, end: j, type: "hairpin" });
    }
  }
  stemCount = pairs.length;
  loopCount = hairpinCount;

  return {
    sequence: seq,
    dotBracket: db.join(""),
    pairs,
    mfe,
    gcContent: Math.round(gcContent * 10) / 10,
    stemCount,
    loopCount,
    bulgeCount,
    hairpinCount,
    stemLoops,
  };
}

// ──────────────────────────────── Sliding Window ────────────────────────────────

export function findRnaStructures(
  seq: string,
  isRna = true,
  windowSize = 120,
  stepSize = 60,
  minMfe = -15
): RnaSecondaryStructure {
  const structures: RnaStructureResult[] = [];
  const cleanSeq = (isRna ? seq.replace(/t/gi, "u") : seq).toUpperCase().replace(/[^AUGC T]/g, "").replace(/T/g, "U");

  for (let i = 0; i < cleanSeq.length; i += stepSize) {
    const end = Math.min(i + windowSize, cleanSeq.length);
    const window = cleanSeq.slice(i, end);
    if (window.length < 20) continue;
    const result = nussinovFold(window, isRna);
    if (result.mfe <= minMfe || result.pairs.length > 0) {
      structures.push(result);
    }
    if (end >= cleanSeq.length) break;
  }

  const longestHairpin = structures.length > 0
    ? structures.reduce((best, s) => (s.pairs.length > best.pairs.length ? s : best))
    : null;

  const overallMfe = structures.length > 0
    ? Math.min(...structures.map(s => s.mfe))
    : 0;

  return {
    sequence: cleanSeq,
    isRna,
    structures,
    longestHairpin,
    overallMfe,
  };
}

// ──────────────────────────────── Visualization ────────────────────────────────

export function dotBracketToSvgPaths(db: string, width = 400, height = 100): string {
  // Simple linear representation: backbone + arcs for pairs
  const n = db.length;
  if (n === 0) return "";
  const dx = width / (n + 1);
  let paths = `<line x1="${dx}" y1="${height / 2}" x2="${dx * n}" y2="${height / 2}" stroke="#4cd6ff" stroke-width="1" />`;
  for (let i = 0; i < n; i++) {
    if (db[i] === "(") {
      // Find matching )
      let depth = 1;
      for (let j = i + 1; j < n; j++) {
        if (db[j] === "(") depth++;
        if (db[j] === ")") {
          depth--;
          if (depth === 0) {
            const x1 = dx * (i + 1);
            const x2 = dx * (j + 1);
            const r = Math.max(2, Math.abs(x2 - x1) / 2);
            const cx = (x1 + x2) / 2;
            paths += `<path d="M ${x1} ${height / 2} A ${r} ${r} 0 0 1 ${x2} ${height / 2}" fill="none" stroke="#53d769" stroke-width="1" />`;
            break;
          }
        }
      }
    }
  }
  return paths;
}

export function isRnaSequence(seq: string): boolean {
  return /u/i.test(seq) && !/t/i.test(seq.replace(/u/gi, ""));
}
