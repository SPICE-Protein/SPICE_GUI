// Primer secondary structure analysis: hairpin, self-dimer, cross-dimer,
// and PCR simulation (overlap extension, site-directed mutagenesis).
// Pure TypeScript, no external deps.

import { getReverseComplementSequenceString } from "./sequence";
import { calculateNebTm } from "./tm";
import { calculatePercentGC } from "./sequence";
import * as m from "$lib/paraglide/messages.js";

// ──────────────────────────────── Types ────────────────────────────────

export interface HairpinResult {
  found: boolean;
  position: number;
  stemLength: number;
  loopLength: number;
  meltingTemp: number;
  sequence: string;
  structure: string;
}

export interface DimerResult {
  found: boolean;
  position: number;
  length: number;
  meltingTemp: number;
  structure: string;
}

export interface PrimerAnalysis {
  sequence: string;
  length: number;
  gcContent: number;
  tm: number;
  hairpins: HairpinResult[];
  selfDimers: DimerResult[];
  crossDimers: DimerResult[];
  polyX: { base: string; length: number; position: number }[];
  gcClamp: boolean;
  gcClamp5: boolean;
  nBaseCount: number;
  maxHomopolymer: number;
  score: number; // overall quality 0-100
  warnings: string[];
}

// ──────────────────────────────── Helpers ────────────────────────────────

const DNA_PAIRS: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G",
};

function canPair(a: string, b: string): boolean {
  return DNA_PAIRS[a.toUpperCase()] === b.toUpperCase();
}

// ──────────────────────────────── Hairpin ────────────────────────────────

export function findHairpins(seq: string, minStem = 4, maxLoop = 30): HairpinResult[] {
  const results: HairpinResult[] = [];
  const s = seq.toUpperCase();

  for (let i = 0; i < s.length - minStem * 2 - 3; i++) {
    for (let stem = minStem; stem <= 12 && i + stem * 2 + 3 <= s.length; stem++) {
      for (let loop = 3; loop <= maxLoop && i + stem + loop + stem <= s.length; loop++) {
        const left = s.slice(i, i + stem);
        const right = s.slice(i + stem + loop, i + stem + loop + stem);
        // Check if left is reverse complement of right
        let match = true;
        for (let k = 0; k < stem; k++) {
          if (!canPair(left[k], right[stem - 1 - k])) {
            match = false;
            break;
          }
        }
        if (match) {
          const hairpinSeq = s.slice(i, i + stem + loop + stem);
          const tm = calculateNebTm(left, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
          const structure = `${left}(${s.slice(i + stem, i + stem + loop)})${right}`;
          results.push({
            found: true,
            position: i,
            stemLength: stem,
            loopLength: loop,
            meltingTemp: typeof tm === "number" ? tm : 0,
            sequence: hairpinSeq,
            structure,
          });
          // Only keep the longest stem for each position
          break;
        }
      }
    }
  }

  // Sort by stem length (longest first)
  results.sort((a, b) => b.stemLength - a.stemLength);
  return results.slice(0, 10);
}

// ──────────────────────────────── Self-Dimer ────────────────────────────────

export function findSelfDimers(seq: string, minLength = 4): DimerResult[] {
  const results: DimerResult[] = [];
  const s = seq.toUpperCase();
  const rc = getReverseComplementSequenceString(s);

  for (let offset = -s.length + minLength; offset < s.length - minLength; offset++) {
    let matchCount = 0;
    let matchStart = 0;
    let inMatch = false;
    for (let i = 0; i < s.length; i++) {
      const j = i - offset;
      if (j >= 0 && j < rc.length && canPair(s[i], rc[j])) {
        if (!inMatch) { matchStart = i; inMatch = true; }
        matchCount++;
      } else {
        if (inMatch && matchCount >= minLength) {
          const tm = calculateNebTm(s.slice(matchStart, matchStart + matchCount), { monovalentCationConc: 0.05, primerConc: 0.0000005 });
          results.push({
            found: true,
            position: offset,
            length: matchCount,
            meltingTemp: typeof tm === "number" ? tm : 0,
            structure: `offset ${offset}, ${matchCount}bp`,
          });
        }
        matchCount = 0;
        inMatch = false;
      }
    }
    if (inMatch && matchCount >= minLength) {
      const tm = calculateNebTm(s.slice(matchStart, matchStart + matchCount), { monovalentCationConc: 0.05, primerConc: 0.0000005 });
      results.push({
        found: true,
        position: offset,
        length: matchCount,
        meltingTemp: typeof tm === "number" ? tm : 0,
        structure: `offset ${offset}, ${matchCount}bp`,
      });
    }
  }

  results.sort((a, b) => b.length - a.length);
  return results.slice(0, 5);
}

// ──────────────────────────────── Cross-Dimer ────────────────────────────────

export function findCrossDimers(fwd: string, rev: string, minLength = 4): DimerResult[] {
  const results: DimerResult[] = [];
  const f = fwd.toUpperCase();
  const r = rev.toUpperCase();

  for (let offset = -f.length + minLength; offset < r.length - minLength; offset++) {
    let matchCount = 0;
    let matchStart = 0;
    let inMatch = false;
    for (let i = 0; i < f.length; i++) {
      const j = i - offset;
      if (j >= 0 && j < r.length && canPair(f[i], r[j])) {
        if (!inMatch) { matchStart = i; inMatch = true; }
        matchCount++;
      } else {
        if (inMatch && matchCount >= minLength) {
          const tm = calculateNebTm(f.slice(matchStart, matchStart + matchCount), { monovalentCationConc: 0.05, primerConc: 0.0000005 });
          results.push({
            found: true,
            position: offset,
            length: matchCount,
            meltingTemp: typeof tm === "number" ? tm : 0,
            structure: `offset ${offset}, ${matchCount}bp`,
          });
        }
        matchCount = 0;
        inMatch = false;
      }
    }
    if (inMatch && matchCount >= minLength) {
      const tm = calculateNebTm(f.slice(matchStart, matchStart + matchCount), { monovalentCationConc: 0.05, primerConc: 0.0000005 });
      results.push({
        found: true,
        position: offset,
        length: matchCount,
        meltingTemp: typeof tm === "number" ? tm : 0,
        structure: `offset ${offset}, ${matchCount}bp`,
      });
    }
  }

  results.sort((a, b) => b.length - a.length);
  return results.slice(0, 5);
}

// ──────────────────────────────── Full Analysis ────────────────────────────────

export function analyzePrimer(seq: string): PrimerAnalysis {
  const s = seq.toUpperCase().replace(/[^ATCGN]/g, "");
  const warnings: string[] = [];

  const gc = calculatePercentGC(s);
  const tm = calculateNebTm(s, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
  const tmNum = typeof tm === "number" ? tm : 0;

  const hairpins = findHairpins(s);
  const selfDimers = findSelfDimers(s);
  const crossDimers: DimerResult[] = [];

  // Poly-X runs
  const polyX: { base: string; length: number; position: number }[] = [];
  let currentBase = s[0];
  let currentLen = 1;
  let currentStart = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === currentBase) {
      currentLen++;
    } else {
      if (currentLen >= 4) {
        polyX.push({ base: currentBase, length: currentLen, position: currentStart });
      }
      currentBase = s[i];
      currentLen = 1;
      currentStart = i;
    }
  }
  if (currentLen >= 4) {
    polyX.push({ base: currentBase, length: currentLen, position: currentStart });
  }

  // GC clamp (3' end)
  const gcClamp = s.endsWith("G") || s.endsWith("C");
  const gcClamp5 = s.startsWith("G") || s.startsWith("C");

  // N base count
  const nBaseCount = (s.match(/N/g) || []).length;

  // Max homopolymer
  let maxHomo = 1;
  let homoLen = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) {
      homoLen++;
      maxHomo = Math.max(maxHomo, homoLen);
    } else {
      homoLen = 1;
    }
  }

  // Quality score
  let score = 100;
  if (gc < 30 || gc > 70) { score -= 20; warnings.push(m.paGcAbnormal({ v1: gc.toFixed(1) })); }
  if (tmNum < 50 || tmNum > 75) { score -= 15; warnings.push(m.paTmOutOfRange({ v1: tmNum.toFixed(1) })); }
  if (hairpins.length > 0) { score -= 10 * hairpins.length; warnings.push(m.paHairpinsFound({ v1: hairpins.length })); }
  if (selfDimers.length > 0) { score -= 8 * selfDimers.length; warnings.push(m.paSelfDimersFound({ v1: selfDimers.length })); }
  if (polyX.length > 0) { score -= 5 * polyX.length; warnings.push(m.paPolyXRuns({ v1: polyX.length })); }
  if (!gcClamp) { score -= 5; warnings.push(m.paNoGcClamp()); }
  if (maxHomo > 5) { score -= 5; warnings.push(m.paMaxHomopolymer({ v1: maxHomo })); }
  if (s.length < 15 || s.length > 35) { score -= 10; warnings.push(m.paLengthAbnormal({ v1: s.length })); }
  score = Math.max(0, score);

  return {
    sequence: s,
    length: s.length,
    gcContent: gc,
    tm: tmNum,
    hairpins,
    selfDimers,
    crossDimers,
    polyX,
    gcClamp,
    gcClamp5,
    nBaseCount,
    maxHomopolymer: maxHomo,
    score,
    warnings,
  };
}

// ──────────────────────────────── PCR Simulation ────────────────────────────────

export interface PcrProduct {
  product: string;
  productLength: number;
  forwardPrimer: string;
  reversePrimer: string;
  templateStart: number;
  templateEnd: number;
  meltingTemp: number;
  gcContent: number;
  warnings: string[];
}

/** Simulate standard PCR amplification. */
export function simulatePCR(
  template: string,
  fwdPrimer: string,
  revPrimer: string,
  options: { circular?: boolean; maxMismatch?: number } = {}
): PcrProduct {
  const warnings: string[] = [];
  const tmpl = template.toUpperCase();
  const fwd = fwdPrimer.toUpperCase().replace(/[^ATCG]/g, "");
  const revComp = revPrimer.toUpperCase().replace(/[^ATCG]/g, "");
  const rev = getReverseComplementSequenceString(revComp);

  // Find forward primer in template
  let fwdPos = tmpl.indexOf(fwd.slice(0, Math.min(15, fwd.length)));
  if (fwdPos === -1) {
    // Try with shorter seed
    fwdPos = tmpl.indexOf(fwd.slice(0, 10));
  }
  if (fwdPos === -1) {
    warnings.push(m.paFwdNoSite());
    return emptyProduct(fwdPrimer, revPrimer);
  }

  // Find reverse primer (reverse complement) in template
  let revPos = tmpl.indexOf(rev.slice(0, Math.min(15, rev.length)), fwdPos);
  if (revPos === -1) {
    revPos = tmpl.indexOf(rev.slice(0, 10), fwdPos);
  }
  if (revPos === -1) {
    warnings.push(m.paRevNoSite());
    return emptyProduct(fwdPrimer, revPrimer);
  }

  // Product: from forward primer start to reverse primer end
  const productEnd = revPos + rev.length;
  let productSeq = tmpl.slice(fwdPos, productEnd);

  // For circular templates, handle origin-crossing
  if (options.circular && productEnd > tmpl.length) {
    const wrap = productEnd - tmpl.length;
    productSeq = tmpl.slice(fwdPos) + tmpl.slice(0, wrap);
  }

  const gc = calculatePercentGC(productSeq);
  const tm = calculateNebTm(productSeq.slice(0, 20), { monovalentCationConc: 0.05, primerConc: 0.0000005 });

  if (productSeq.length < 50) {
    warnings.push(m.paProductTooShort());
  }
  if (productSeq.length > 5000) {
    warnings.push(m.paProductLong());
  }

  return {
    product: productSeq,
    productLength: productSeq.length,
    forwardPrimer: fwd,
    reversePrimer: revComp,
    templateStart: fwdPos,
    templateEnd: productEnd,
    meltingTemp: typeof tm === "number" ? tm : 0,
    gcContent: gc,
    warnings,
  };
}

/** Simulate overlap extension PCR for multi-fragment assembly. */
export function simulateOverlapExtensionPCR(
  fragments: { seq: string; name: string }[],
  overlapLength = 20
): PcrProduct {
  const warnings: string[] = [];
  if (fragments.length < 2) {
    warnings.push(m.paOverlapMinTwo());
    return emptyProduct("", "");
  }

  let product = fragments[0].seq.toUpperCase();
  for (let i = 1; i < fragments.length; i++) {
    const frag = fragments[i].seq.toUpperCase();
    // Check for overlap between end of product and start of next fragment
    const endOfProduct = product.slice(-overlapLength);
    const startOfFrag = frag.slice(0, overlapLength);
    if (endOfProduct === startOfFrag) {
      // Perfect overlap: skip duplicate region
      product += frag.slice(overlapLength);
    } else {
      // Check reverse complement overlap
      const rcEnd = getReverseComplementSequenceString(endOfProduct);
      if (rcEnd === startOfFrag) {
        product += frag.slice(overlapLength);
      } else {
        warnings.push(m.paFragOverlapMismatch({ v1: i }));
        product += frag; // Just concatenate
      }
    }
  }

  const gc = calculatePercentGC(product);
  const tm = calculateNebTm(product.slice(0, 20), { monovalentCationConc: 0.05, primerConc: 0.0000005 });

  return {
    product,
    productLength: product.length,
    forwardPrimer: fragments[0].seq.slice(0, 20),
    reversePrimer: getReverseComplementSequenceString(fragments[fragments.length - 1].seq.slice(-20)),
    templateStart: 0,
    templateEnd: product.length,
    meltingTemp: typeof tm === "number" ? tm : 0,
    gcContent: gc,
    warnings,
  };
}

/** Simulate site-directed mutagenesis (QuikChange-style). */
export function simulateSiteDirectedMutagenesis(
  template: string,
  mutation: { position: number; newBase: string } | { start: number; end: number; newSeq: string },
  primerLength = 25
): {
  mutatedSequence: string;
  mutationStart: number;
  mutationEnd: number;
  fwdPrimer: string;
  revPrimer: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const tmpl = template.toUpperCase();
  let mutated = tmpl;
  let mutStart: number, mutEnd: number;
  let newSeq: string;

  if ("newBase" in mutation) {
    // Point mutation
    mutStart = mutation.position;
    mutEnd = mutation.position;
    newSeq = mutation.newBase;
    mutated = tmpl.slice(0, mutStart) + mutation.newBase + tmpl.slice(mutEnd + 1);
  } else {
    // Deletion/insertion/replacement
    mutStart = mutation.start;
    mutEnd = mutation.end;
    newSeq = mutation.newSeq;
    mutated = tmpl.slice(0, mutStart) + mutation.newSeq + tmpl.slice(mutEnd + 1);
  }

  // Design primers centered on mutation
  const center = Math.floor((mutStart + mutEnd) / 2);
  const half = Math.floor(primerLength / 2);
  const primerStart = Math.max(0, center - half);
  const primerEnd = Math.min(mutated.length, center + half + (primerLength % 2));
  const fwdPrimer = mutated.slice(primerStart, primerEnd);
  const revPrimer = getReverseComplementSequenceString(fwdPrimer);

  if (mutStart < 0 || mutEnd >= tmpl.length) {
    warnings.push(m.paMutOutTemplate());
  }
  if (newSeq.length > (mutEnd - mutStart + 1) * 2) {
    warnings.push(m.paInsertTooLarge());
  }

  return {
    mutatedSequence: mutated,
    mutationStart: mutStart,
    mutationEnd: mutEnd,
    fwdPrimer,
    revPrimer,
    warnings,
  };
}

function emptyProduct(fwd: string, rev: string): PcrProduct {
  return {
    product: "",
    productLength: 0,
    forwardPrimer: fwd,
    reversePrimer: rev,
    templateStart: 0,
    templateEnd: 0,
    meltingTemp: 0,
    gcContent: 0,
    warnings: [m.paPcrSimFailed()],
  };
}

/**
 * Designs forward and reverse primers for PCR amplification of a target region on a template,
 * optionally adding homology overhangs for Gibson Assembly or Restriction Ligation into a vector.
 */
export interface DesignedPrimer {
  sequence: string;           // Full primer sequence (overhang + annealing)
  annealingSeq: string;       // Only the portion that binds to the template
  overhangSeq: string;        // The 5' overhang portion
  length: number;
  tm: number;                 // Tm of the annealing region
  gcContent: number;          // GC content of the full primer
}

export interface PrimerDesignResult {
  forward: DesignedPrimer;
  reverse: DesignedPrimer;
}

export function designPrimersForCloning(options: {
  templateSequence: string;
  targetRange: { start: number; end: number };
  vectorSequence?: string;
  vectorInsertionPoint?: number;
  targetTm?: number;
  homologyArmLength?: number;
}): PrimerDesignResult {
  const {
    templateSequence,
    targetRange,
    vectorSequence,
    vectorInsertionPoint = 0,
    targetTm = 60,
    homologyArmLength = 20
  } = options;

  const tSeq = templateSequence.toUpperCase();
  const vSeq = vectorSequence ? vectorSequence.toUpperCase() : "";

  // 1. Design Forward Primer annealing region (matching the 5' end of the target range)
  let fwdAnnealLen = 18;
  let fwdAnnealing = "";
  let fwdTm = 0;
  while (fwdAnnealLen <= 35) {
    fwdAnnealing = tSeq.slice(targetRange.start, targetRange.start + fwdAnnealLen);
    const calculated = calculateNebTm(fwdAnnealing, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
    fwdTm = typeof calculated === "number" ? calculated : 0;
    if (fwdTm >= targetTm) break;
    fwdAnnealLen++;
  }

  // 2. Design Reverse Primer annealing region (matching the reverse complement of the 3' end of the target range)
  let revAnnealLen = 18;
  let revAnnealing = "";
  let revTm = 0;
  while (revAnnealLen <= 35) {
    const endPart = tSeq.slice(targetRange.end - revAnnealLen + 1, targetRange.end + 1);
    revAnnealing = getReverseComplementSequenceString(endPart);
    const calculated = calculateNebTm(revAnnealing, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
    revTm = typeof calculated === "number" ? calculated : 0;
    if (revTm >= targetTm) break;
    revAnnealLen++;
  }

  // 3. Generate Overhangs if Vector details are provided
  let fwdOverhang = "";
  let revOverhang = "";

  if (vSeq && vectorInsertionPoint !== undefined) {
    const len = vSeq.length;
    const upstreamStart = (vectorInsertionPoint - homologyArmLength + len) % len;
    let upstream = "";
    for (let i = 0; i < homologyArmLength; i++) {
      upstream += vSeq.charAt((upstreamStart + i) % len);
    }
    fwdOverhang = upstream;

    const downstreamStart = vectorInsertionPoint % len;
    let downstream = "";
    for (let i = 0; i < homologyArmLength; i++) {
      downstream += vSeq.charAt((downstreamStart + i) % len);
    }
    revOverhang = getReverseComplementSequenceString(downstream);
  }

  const fwdFull = fwdOverhang + fwdAnnealing;
  const revFull = revOverhang + revAnnealing;

  return {
    forward: {
      sequence: fwdFull,
      annealingSeq: fwdAnnealing,
      overhangSeq: fwdOverhang,
      length: fwdFull.length,
      tm: fwdTm,
      gcContent: calculatePercentGC(fwdFull)
    },
    reverse: {
      sequence: revFull,
      annealingSeq: revAnnealing,
      overhangSeq: revOverhang,
      length: revFull.length,
      tm: revTm,
      gcContent: calculatePercentGC(revFull)
    }
  };
}
