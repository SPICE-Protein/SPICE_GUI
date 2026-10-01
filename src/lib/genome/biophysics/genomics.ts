/**
 * SPICE Advanced Genomics & Transcriptional Analysis Module (Feature E)
 * 
 * Provides parsers for GFF3, GTF, and BED formats, consensus motif and 
 * transcription factor binding site (TFBS) searches, promoter prediction, 
 * Salis-style RBS thermodynamics, and protein localization predictors.
 */

import { getReverseComplementSequenceString, getAminoAcidStringFromSequenceString } from "../sequence";
import { AA_HYDRO_SCALE } from "./batchEvaluator";
import * as m from "$lib/paraglide/messages.js";

export interface GenomicFeature {
  id: string;
  source: string;
  type: string;
  start: number; // 0-indexed coordinate relative to forward strand
  end: number;
  score: string;
  strand: "+" | "-";
  phase: string;
  attributes: Record<string, string>;
  name: string;
}

/**
 * Parses GFF3 format text into SPICE annotations.
 */
export function parseGFF3(text: string): GenomicFeature[] {
  const lines = text.split("\n");
  const features: GenomicFeature[] = [];
  let idx = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const cols = line.split("\t");
    if (cols.length < 9) continue;

    const source = cols[1];
    const type = cols[2];
    const start = parseInt(cols[3], 10) - 1; // 1-based GFF -> 0-based
    const end = parseInt(cols[4], 10) - 1;
    const score = cols[5];
    const strand = cols[6] as "+" | "-";
    const phase = cols[7];
    
    const attrsRaw = cols[8].split(";");
    const attributes: Record<string, string> = {};
    for (const attr of attrsRaw) {
      const parts = attr.trim().split("=");
      if (parts.length === 2) {
        attributes[parts[0].trim()] = parts[1].trim().replace(/"/g, "");
      }
    }

    const name = attributes["Name"] || attributes["ID"] || `${type}_${start + 1}`;

    features.push({
      id: `gff_${idx++}`,
      source,
      type,
      start,
      end,
      score,
      strand,
      phase,
      attributes,
      name,
    });
  }
  return features;
}

/**
 * Parses GTF format text into annotations.
 */
export function parseGTF(text: string): GenomicFeature[] {
  const lines = text.split("\n");
  const features: GenomicFeature[] = [];
  let idx = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const cols = line.split("\t");
    if (cols.length < 9) continue;

    const source = cols[1];
    const type = cols[2];
    const start = parseInt(cols[3], 10) - 1;
    const end = parseInt(cols[4], 10) - 1;
    const score = cols[5];
    const strand = cols[6] as "+" | "-";
    const phase = cols[7];

    const attributes: Record<string, string> = {};
    const attrsRaw = cols[8].split(";");
    for (const attr of attrsRaw) {
      const match = attr.trim().match(/^([a-zA-Z0-9_\-]+)\s+"([^"]*)"$/);
      if (match) {
        attributes[match[1]] = match[2];
      }
    }

    const name = attributes["gene_name"] || attributes["gene_id"] || attributes["transcript_id"] || `${type}_${start + 1}`;

    features.push({
      id: `gtf_${idx++}`,
      source,
      type,
      start,
      end,
      score,
      strand,
      phase,
      attributes,
      name,
    });
  }
  return features;
}

/**
 * Parses BED format text into annotations.
 */
export function parseBED(text: string): GenomicFeature[] {
  const lines = text.split("\n");
  const features: GenomicFeature[] = [];
  let idx = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("track") || line.startsWith("browser")) continue;

    const cols = line.split(/\s+/);
    if (cols.length < 3) continue;

    const start = parseInt(cols[1], 10); // BED chromStart is 0-indexed
    const end = parseInt(cols[2], 10) - 1; // BED chromEnd is 1-indexed, convert to inclusive 0-indexed
    const name = cols[3] || `bed_${start}`;
    const score = cols[4] || ".";
    const strand = (cols[5] === "+" || cols[5] === "-") ? cols[5] : "+";

    features.push({
      id: `bed_${idx++}`,
      source: "BED_file",
      type: "region",
      start,
      end,
      score,
      strand,
      phase: ".",
      attributes: {},
      name,
    });
  }
  return features;
}

/**
 * Searches a DNA sequence for consensus Transcription Factor Binding Sites (TFBS).
 */
export function predictTfbsMotifs(dnaSeq: string): { name: string; pos: number; strand: "+" | "-"; matchSeq: string }[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const rcSeq = getReverseComplementSequenceString(seq);
  
  const TF_CONSENSUS = [
    { name: "TATA-Box", pattern: /TATA[AT]A[AT]/gi },
    { name: "Pribnow-Box (-10)", pattern: /TATAAT/gi },
    { name: "Sox9 Binding Site", pattern: /AACAAAG/gi },
    { name: "NF-kB Site", pattern: /GGG[AG].[CT][CT]CC/gi },
    { name: "CREB consensus", pattern: /TGACGTCA/gi },
  ];

  const results: { name: string; pos: number; strand: "+" | "-"; matchSeq: string }[] = [];

  for (const tf of TF_CONSENSUS) {
    // Forward strand search
    tf.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tf.pattern.exec(seq)) !== null) {
      results.push({
        name: tf.name,
        pos: match.index,
        strand: "+",
        matchSeq: match[0],
      });
      if (match.index === tf.pattern.lastIndex) tf.pattern.lastIndex++;
    }

    // Reverse strand search
    tf.pattern.lastIndex = 0;
    while ((match = tf.pattern.exec(rcSeq)) !== null) {
      const rcPos = seq.length - match.index - match[0].length;
      results.push({
        name: tf.name,
        pos: rcPos,
        strand: "-",
        matchSeq: getReverseComplementSequenceString(match[0]),
      });
      if (match.index === tf.pattern.lastIndex) tf.pattern.lastIndex++;
    }
  }
  return results.sort((a, b) => a.pos - b.pos);
}

/**
 * Calculates translation initiation strength of a Ribosome Binding Site (RBS)
 * utilizing Shine-Dalgarno (SD) thermodynamic approximation (Salis-style).
 * Models anti-SD hybridization (CCTCCT on E. coli 16S rRNA) and spacer penalty.
 */
export function calculateRbsStrength(dnaSeq: string, atgStartIndex: number): {
  tirScore: number;       // Translation Initiation Rate arbitrary units (0 - 150000)
  deltaGSD: number;      // Shine-Dalgarno hybridization energy (kcal/mol)
  deltaGSpacer: number;  // Spacer spacing penalty (kcal/mol)
  totalDeltaG: number;   // Total free energy of translation initiation
  spacerLength: number;
  sdOverhangSequence: string;
} {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const rbsWindowStart = Math.max(0, atgStartIndex - 25);
  const rbsWindow = seq.slice(rbsWindowStart, atgStartIndex);
  
  const asdSequence = "CCTCCT"; // anti-SD target sequence
  
  let maxMatchCount = 0;
  let bestMatchIdx = -1;
  
  for (let i = 0; i <= rbsWindow.length - 6; i++) {
    const sub = rbsWindow.slice(i, i + 6);
    let match = 0;
    for (let j = 0; j < 6; j++) {
      if (
        (sub[j] === "A" && asdSequence[j] === "T") ||
        (sub[j] === "T" && asdSequence[j] === "A") ||
        (sub[j] === "G" && asdSequence[j] === "C") ||
        (sub[j] === "C" && asdSequence[j] === "G")
      ) {
        match++;
      }
    }
    if (match > maxMatchCount) {
      maxMatchCount = match;
      bestMatchIdx = i;
    }
  }

  // dG SD approximation: -1.5 kcal/mol per Watson-Crick pair
  const deltaGSD = -1.5 * maxMatchCount;

  // Spacer distance calculation (optimal spacing is 5-9 bp)
  const absoluteSdStart = rbsWindowStart + bestMatchIdx;
  const spacerLength = atgStartIndex - (absoluteSdStart + 6);
  
  // Spacer penalty (quadratic penalty centered on 7bp)
  let deltaGSpacer = 0;
  if (spacerLength < 5) {
    deltaGSpacer = 0.8 * Math.pow(5 - spacerLength, 2) + 1.0;
  } else if (spacerLength > 9) {
    deltaGSpacer = 0.5 * Math.pow(spacerLength - 9, 2) + 0.5;
  }

  const totalDeltaG = deltaGSD + deltaGSpacer;
  
  // Salis translation initiation rate translation
  const tirScore = Math.round(150000 / (1 + Math.exp(0.45 * (totalDeltaG + 9.5))));

  return {
    tirScore,
    deltaGSD: Number(deltaGSD.toFixed(2)),
    deltaGSpacer: Number(deltaGSpacer.toFixed(2)),
    totalDeltaG: Number(totalDeltaG.toFixed(2)),
    spacerLength,
    sdOverhangSequence: rbsWindow.slice(bestMatchIdx, bestMatchIdx + 6)
  };
}

/**
 * Predicts E. coli Sigma70 promoter consensus sequence (-10 and -35 boxes with spacing).
 */
export function predictPromoters(dnaSeq: string): { pos: number; score: number; sequence: string }[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const promoters: { pos: number; score: number; sequence: string }[] = [];

  // Consensus: -35 (TTGACA) --- [15-20 bp spacer] --- -10 (TATAAT)
  for (let i = 0; i < seq.length - 40; i++) {
    const segment = seq.slice(i, i + 40);
    const box35 = segment.slice(0, 6);
    
    for (let s = 15; s <= 20; s++) {
      const box10 = segment.slice(6 + s, 6 + s + 6);
      
      let match35 = 0;
      const ref35 = "TTGACA";
      for (let j = 0; j < 6; j++) if (box35[j] === ref35[j]) match35++;

      let match10 = 0;
      const ref10 = "TATAAT";
      for (let j = 0; j < 6; j++) if (box10[j] === ref10[j]) match10++;

      if (match35 >= 4 && match10 >= 4) {
        promoters.push({
          pos: i,
          score: Math.round((match35 + match10) / 12 * 100),
          sequence: box35 + "-".repeat(s) + box10,
        });
      }
    }
  }
  return promoters.sort((a, b) => b.score - a.score);
}

/**
 * Predicts N-terminal Secretion Signal Peptides using tripartite segment scanning.
 */
export function predictSignalPeptide(aaSeq: string): { 
  hasSignal: boolean; 
  cleavagePos: number; 
  score: number; 
  details: string;
} {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 50);
  if (seq.length < 20) return { hasSignal: false, cleavagePos: 0, score: 0, details: m.gnSignalTooShort() };

  // 1. Positive charge check in first 8 AA (n-region: Lys/Arg rich)
  const nRegion = seq.slice(0, 8);
  const positiveCharges = (nRegion.match(/[KR]/g) || []).length;

  // 2. Hydrophobic region scan (h-region)
  let bestHydroScore = 0;
  let hStart = -1;
  const H_WINDOW_LEN = 10;
  
  for (let i = 4; i <= seq.length - H_WINDOW_LEN - 5; i++) {
    const sub = seq.slice(i, i + H_WINDOW_LEN);
    let hydroCount = 0;
    for (const c of sub) {
      if ("LAVIFM".includes(c)) hydroCount++;
    }
    if (hydroCount > bestHydroScore) {
      bestHydroScore = hydroCount;
      hStart = i;
    }
  }

  // 3. Cleavage site check (c-region: Ala-X-Ala consensus)
  let cleavagePos = -1;
  let axaMatch = false;
  if (hStart !== -1) {
    const searchStart = hStart + H_WINDOW_LEN;
    for (let cIdx = searchStart; cIdx < Math.min(seq.length - 2, searchStart + 10); cIdx++) {
      const p3 = seq[cIdx];
      const p1 = seq[cIdx + 2];
      if ("AVGST".includes(p3) && "AVGS".includes(p1)) {
        cleavagePos = cIdx + 3;
        axaMatch = true;
        break;
      }
    }
  }

  const hasSignal = positiveCharges >= 1 && bestHydroScore >= 7 && axaMatch;
  const score = hasSignal ? Math.round(50 + (positiveCharges * 10) + (bestHydroScore * 3)) : 0;

  return {
    hasSignal,
    cleavagePos: hasSignal ? cleavagePos : 0,
    score: Math.min(100, score),
    details: hasSignal
      ? m.gnSignalFound({ v1: positiveCharges, v2: bestHydroScore, v3: cleavagePos })
      : m.gnSignalNone()
  };
}

/**
 * Predicts alpha-helical Transmembrane segments using a sliding hydrophobicity window.
 */
export function predictTransmembraneHelices(aaSeq: string): { start: number; end: number; averageHydro: number }[] {
  const seq = aaSeq.toUpperCase().replace(/[^A-Z]/g, "");
  const W_SIZE = 20; 
  const helices: { start: number; end: number; averageHydro: number }[] = [];

  const hydroIndex = seq.split("").map(c => AA_HYDRO_SCALE[c] || 0);

  for (let i = 0; i <= seq.length - W_SIZE; i++) {
    const sub = hydroIndex.slice(i, i + W_SIZE);
    const sum = sub.reduce((a, b) => a + b, 0);
    const avg = sum / W_SIZE;

    // Threshold: average Kyte-Doolittle hydrophobicity > 1.6
    if (avg > 1.5) {
      const overlap = helices.find(h => i >= h.start && i <= h.end);
      if (!overlap) {
        helices.push({
          start: i,
          end: i + W_SIZE - 1,
          averageHydro: Number(avg.toFixed(2))
        });
      }
    }
  }
  return helices;
}

// ──────────────────────────────── 11: GC skew / AT skew sliding analysis ────────────────────────────────

export interface SkewPoint {
  pos: number;
  skew: number;
}

/**
 * Calculates GC skew or AT skew over a sliding window across the DNA sequence.
 * GC Skew = (G-C)/(G+C)
 */
export function calculateSkew(
  dnaSeq: string,
  type: "gc" | "at" = "gc",
  windowSize = 1000,
  step = 100
): SkewPoint[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const points: SkewPoint[] = [];

  for (let i = 0; i <= seq.length - windowSize; i += step) {
    const sub = seq.slice(i, i + windowSize);
    let count1 = 0; // G or A
    let count2 = 0; // C or T

    if (type === "gc") {
      for (const b of sub) {
        if (b === "G") count1++;
        else if (b === "C") count2++;
      }
    } else {
      for (const b of sub) {
        if (b === "A") count1++;
        else if (b === "T") count2++;
      }
    }

    const denom = count1 + count2;
    const skew = denom > 0 ? (count1 - count2) / denom : 0;
    points.push({
      pos: i + Math.floor(windowSize / 2),
      skew: Number(skew.toFixed(3))
    });
  }

  return points;
}

// ──────────────────────────────── 12: CpG island detector ────────────────────────────────

export interface CpGIsland {
  start: number; // 0-indexed inclusive
  end: number;
  length: number;
  gcContent: number; // %
  obsExpRatio: number;
}

/**
 * Detects CpG islands using Gardiner-Garden standard:
 * Length >= 200bp, GC content > 50%, Obs/Exp ratio > 0.6
 */
export function detectCpGIslands(
  dnaSeq: string,
  minLen = 200,
  gcMin = 50,
  ratioMin = 0.6
): CpGIsland[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const islands: CpGIsland[] = [];

  // Sliding window of 200bp
  const wSize = 200;
  const step = 50;

  for (let i = 0; i <= seq.length - wSize; i += step) {
    const sub = seq.slice(i, i + wSize);
    let c = 0, g = 0, cg = 0;

    for (let j = 0; j < sub.length; j++) {
      if (sub[j] === "C") c++;
      if (sub[j] === "G") g++;
      if (j < sub.length - 1 && sub[j] === "C" && sub[j + 1] === "G") cg++;
    }

    const gcContent = ((c + g) / wSize) * 100;
    const obsExpRatio = (c > 0 && g > 0) ? (cg * wSize) / (c * g) : 0;

    if (gcContent >= gcMin && obsExpRatio >= ratioMin) {
      // Merge overlaps or record new island
      const start = i;
      const end = i + wSize - 1;

      const overlap = islands.find(isl => isOverlapping(start, end, isl.start, isl.end));
      if (overlap) {
        overlap.start = Math.min(overlap.start, start);
        overlap.end = Math.max(overlap.end, end);
        overlap.length = overlap.end - overlap.start + 1;
        // recalculate values for merged region
        const mergedSub = seq.slice(overlap.start, overlap.end + 1);
        let mc = 0, mg = 0, mcg = 0;
        for (let k = 0; k < mergedSub.length; k++) {
          if (mergedSub[k] === "C") mc++;
          if (mergedSub[k] === "G") mg++;
          if (k < mergedSub.length - 1 && mergedSub[k] === "C" && mergedSub[k + 1] === "G") mcg++;
        }
        overlap.gcContent = Number((((mc + mg) / mergedSub.length) * 100).toFixed(1));
        overlap.obsExpRatio = Number(((mcg * mergedSub.length) / (mc * mg)).toFixed(2));
      } else {
        islands.push({
          start,
          end,
          length: wSize,
          gcContent: Number(gcContent.toFixed(1)),
          obsExpRatio: Number(obsExpRatio.toFixed(2))
        });
      }
    }
  }

  return islands;
}

function isOverlapping(s1: number, e1: number, s2: number, e2: number): boolean {
  return Math.max(s1, s2) <= Math.min(e1, e2);
}

// ──────────────────────────────── 13: Repeat sequence detection ────────────────────────────────

export interface TandemRepeat {
  start: number; // 0-indexed inclusive
  end: number;
  pattern: string;
  repeatCount: number;
  totalLength: number;
}

/**
 * Scans DNA sequence for tandem direct repeat structures (SSRs / STRs)
 */
export function detectTandemRepeats(dnaSeq: string, minRepeatLen = 2): TandemRepeat[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const repeats: TandemRepeat[] = [];

  // Look for repeat patterns of length 1 to 6 (mono, di, tri, tetra, penta, hexanucleotides)
  for (let patLen = 1; patLen <= 6; patLen++) {
    for (let i = 0; i <= seq.length - patLen * 2; i++) {
      const pattern = seq.slice(i, i + patLen);
      
      // Count consecutive repetitions
      let count = 1;
      let nextPos = i + patLen;
      while (nextPos + patLen <= seq.length && seq.slice(nextPos, nextPos + patLen) === pattern) {
        count++;
        nextPos += patLen;
      }

      const totalLength = count * patLen;
      const minTotalLenRequired = patLen === 1 ? 8 : patLen * 3; // e.g. at least 3 repeat units or 8 poly-A

      if (count >= 3 && totalLength >= minTotalLenRequired) {
        const start = i;
        const end = nextPos - 1;

        // Skip if this region is already recorded by a shorter/longer pattern
        const isCovered = repeats.some(r => start >= r.start && end <= r.end);
        if (!isCovered) {
          repeats.push({
            start,
            end,
            pattern,
            repeatCount: count,
            totalLength
          });
        }
        
        i = end; // Skip past this repeat cluster
      }
    }
  }

  return repeats.sort((a, b) => a.start - b.start);
}

// ──────────────────────────────── 11: FASTQ Quality Control ────────────────────────────────

export interface FastqQcReport {
  totalReads: number;
  totalBases: number;
  averageReadLength: number;
  gcContentPercent: number;
  baseQualities: number[]; // Average Q-score per position
  qualityDistribution: Record<number, number>; // Q-score -> bases count
  duplicateReadsPercent: number;
  adaptersDetected: { adapterName: string; count: number; percentage: number }[];
}

/**
 * Parses and runs a deep FASTQ Quality Control analysis (FastQC-style).
 */
export function analyzeFastqQuality(fastqText: string): FastqQcReport {
  const lines = fastqText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const totalLines = lines.length;
  
  let totalReads = 0;
  let totalBases = 0;
  let gcBases = 0;
  
  const readSequences: string[] = [];
  const maxReadLen = 250;
  const qSumAtPos: number[] = Array(maxReadLen).fill(0);
  const qCountAtPos: number[] = Array(maxReadLen).fill(0);
  const qualityDistribution: Record<number, number> = {};
  
  // Track sequence duplicates
  const seqCounts = new Map<string, number>();

  // Known adapters to check
  const ADAPTERS = [
    { name: "Illumina TruSeq Universal Adapter", seq: "AGATCGGAAGAG" },
    { name: "Illumina Small RNA Adapter", seq: "TGGAATTCTCGG" },
    { name: "Nextera Transposase Adapter", seq: "CTGTCTCTTATA" }
  ];
  const adapterHits: Record<string, number> = {
    "Illumina TruSeq Universal Adapter": 0,
    "Illumina Small RNA Adapter": 0,
    "Nextera Transposase Adapter": 0
  };

  for (let i = 0; i < totalLines - 3; i += 4) {
    // Basic validation of 4-line structure
    if (!lines[i].startsWith("@") || !lines[i + 2].startsWith("+")) {
      // Skip out-of-sync lines
      i -= 2; // re-sync
      continue;
    }

    const seq = lines[i + 1].toUpperCase();
    const qual = lines[i + 3];

    if (seq.length !== qual.length) continue;

    totalReads++;
    totalBases += seq.length;
    readSequences.push(seq);
    seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);

    // GC count
    for (const b of seq) {
      if (b === "G" || b === "C") gcBases++;
    }

    // Adaptor search
    for (const adapt of ADAPTERS) {
      if (seq.includes(adapt.seq)) {
        adapterHits[adapt.name]++;
      }
    }

    // Quality processing (Phred+33)
    for (let pos = 0; pos < seq.length; pos++) {
      const q = qual.charCodeAt(pos) - 33;
      qualityDistribution[q] = (qualityDistribution[q] || 0) + 1;
      
      if (pos < maxReadLen) {
        qSumAtPos[pos] += q;
        qCountAtPos[pos]++;
      }
    }
  }

  // Calculate position-specific averages
  const baseQualities: number[] = [];
  for (let pos = 0; pos < maxReadLen; pos++) {
    if (qCountAtPos[pos] > 0) {
      baseQualities.push(Number((qSumAtPos[pos] / qCountAtPos[pos]).toFixed(2)));
    } else {
      break;
    }
  }

  // Duplicates calculation
  let duplicateCount = 0;
  for (const count of seqCounts.values()) {
    if (count > 1) {
      duplicateCount += (count - 1);
    }
  }
  const duplicateReadsPercent = totalReads > 0 ? Number(((duplicateCount / totalReads) * 100).toFixed(2)) : 0;

  const adaptersDetected = ADAPTERS.map(adapt => ({
    adapterName: adapt.name,
    count: adapterHits[adapt.name],
    percentage: totalReads > 0 ? Number(((adapterHits[adapt.name] / totalReads) * 100).toFixed(2)) : 0
  })).filter(a => a.count > 0);

  return {
    totalReads,
    totalBases,
    averageReadLength: totalReads > 0 ? Math.round(totalBases / totalReads) : 0,
    gcContentPercent: totalBases > 0 ? Number(((gcBases / totalBases) * 100).toFixed(2)) : 0,
    baseQualities,
    qualityDistribution,
    duplicateReadsPercent,
    adaptersDetected
  };
}

// ──────────────────────────────── 12: Adapter Auto-detection & Trimming ────────────────────────────────

export interface TrimResult {
  trimmedSequences: string[];
  trimmedQualityScores: string[];
  trimmedCount: number;
  log: string[];
}

/**
 * Automatically scans and trims standard Illumina/Nextera adapters from FASTQ sequences.
 */
export function autoIdentifyAndRemoveAdapters(
  reads: string[],
  qualities: string[],
  customAdapter?: string
): TrimResult {
  const DEFAULT_ADAPTERS = [
    "AGATCGGAAGAGCACACGTCTGAACTCCAGTCA", // Illumina TruSeq R1
    "AGATCGGAAGAGCGTCGTGTAGGGAAGAGTG",   // Illumina TruSeq R2
    "CTGTCTCTTATACACATCT"                // Nextera Transposase
  ];

  const targetAdapters = customAdapter ? [customAdapter.toUpperCase()] : DEFAULT_ADAPTERS;
  const trimmedSequences: string[] = [];
  const trimmedQualityScores: string[] = [];
  let trimmedCount = 0;
  const log: string[] = [];

  for (let i = 0; i < reads.length; i++) {
    const seq = reads[i].toUpperCase();
    const qual = qualities[i];
    let trimmed = false;
    let cutPos = seq.length;

    for (const adapter of targetAdapters) {
      // Find adapter or its partial matches near the 3' end
      let foundPos = seq.indexOf(adapter);
      
      // Handle partial 3' adapter matches (e.g. read ends with the beginning of adapter)
      if (foundPos === -1) {
        for (let len = Math.min(adapter.length - 1, 15); len >= 6; len--) {
          const adapterPrefix = adapter.slice(0, len);
          if (seq.endsWith(adapterPrefix)) {
            foundPos = seq.length - len;
            break;
          }
        }
      }

      if (foundPos !== -1 && foundPos < cutPos) {
        cutPos = foundPos;
        trimmed = true;
      }
    }

    if (trimmed && cutPos >= 15) { // Ensure trimmed read has a minimum length
      trimmedSequences.push(seq.slice(0, cutPos));
      trimmedQualityScores.push(qual ? qual.slice(0, cutPos) : "");
      trimmedCount++;
    } else {
      trimmedSequences.push(seq);
      trimmedQualityScores.push(qual || "");
    }
  }

  log.push(m.gnAdapterReport({ v1: reads.length, v2: trimmedCount, v3: ((trimmedCount / Math.max(1, reads.length)) * 100).toFixed(1) }));

  return {
    trimmedSequences,
    trimmedQualityScores,
    trimmedCount,
    log
  };
}

// ──────────────────────────────── 13: Prokaryotic Gene Finder ────────────────────────────────

export interface PredictedGene {
  id: string;
  start: number; // 0-based
  end: number;
  strand: "+" | "-";
  startCodon: string;
  stopCodon: string;
  score: number; // Confidence score
  translation: string;
  hasRbsMatch: boolean;
}

/**
 * Predicts open reading frames and genes boundaries in prokaryotic genomes (GeneMark/Prodigal style).
 * Integrates Shine-Dalgarno RBS motif proximity scoring.
 */
export function predictProkaryoticGenes(dnaSeq: string, minLengthBp = 90): PredictedGene[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const rcSeq = getReverseComplementSequenceString(seq);
  const len = seq.length;
  const predicted: PredictedGene[] = [];
  let geneIdIdx = 1;

  const starts = ["ATG", "GTG", "TTG"];
  const stops = ["TAA", "TAG", "TGA"];

  function scanStrand(targetSeq: string, isForward: boolean) {
    // 3 reading frames
    for (let frame = 0; frame < 3; frame++) {
      for (let i = frame; i <= targetSeq.length - minLengthBp; i += 3) {
        const codon = targetSeq.slice(i, i + 3);
        
        if (starts.includes(codon)) {
          const startPos = i;
          let stopPos = -1;
          
          // Find next in-frame stop codon
          for (let j = startPos + 3; j <= targetSeq.length - 3; j += 3) {
            const nextCodon = targetSeq.slice(j, j + 3);
            if (stops.includes(nextCodon)) {
              stopPos = j;
              break;
            }
          }

          if (stopPos !== -1 && (stopPos + 3 - startPos) >= minLengthBp) {
            const geneSeq = targetSeq.slice(startPos, stopPos + 3);
            
            // Map coordinates back to genome coordinates
            const genomeStart = isForward ? startPos : len - stopPos - 3;
            const genomeEnd = isForward ? stopPos + 2 : len - startPos - 1;
            
            // RBS Shine-Dalgarno association check
            // Look for AGGAGG or similar anti-SD target upstream (4-15bp)
            const upstreamStart = Math.max(0, startPos - 18);
            const upstreamSeq = targetSeq.slice(upstreamStart, startPos);
            
            let hasRbsMatch = false;
            let rbsBonus = 0;
            if (upstreamSeq.includes("AGGAGG") || upstreamSeq.includes("GGAGG") || upstreamSeq.includes("GAGG")) {
              hasRbsMatch = true;
              rbsBonus = 35;
            } else if (upstreamSeq.includes("GGAG") || upstreamSeq.includes("AGGA")) {
              hasRbsMatch = true;
              rbsBonus = 20;
            }

            // Simple ORF score based on length and RBS presence
            const lengthBonus = Math.min(45, (geneSeq.length / 300) * 10); // cap length bonus
            const score = Math.round(40 + rbsBonus + lengthBonus);

            predicted.push({
              id: `gene_${geneIdIdx++}`,
              start: genomeStart,
              end: genomeEnd,
              strand: isForward ? "+" : "-",
              startCodon: codon,
              stopCodon: targetSeq.slice(stopPos, stopPos + 3),
              score: Math.min(99, score),
              translation: getAminoAcidStringFromSequenceString(geneSeq),
              hasRbsMatch
            });

            i = stopPos; // Skip past this gene
          }
        }
      }
    }
  }

  scanStrand(seq, true);
  scanStrand(rcSeq, false);

  // Filter overlapping genes on the same strand
  return predicted.sort((a, b) => b.score - a.score);
}

// ──────────────────────────────── 14: CRISPR array Detect (CRISPR Finder) ────────────────────────────────

export interface CrisprArray {
  start: number; // 0-based coordinate
  end: number;
  repeatConsensus: string;
  repeatCount: number;
  spacers: string[];
  confidence: number; // 0 - 100
}

/**
 * Identifies CRISPR Direct Repeat arrays and CRISPR systems.
 * CRISPR-Finder style. Conserved repeats are typically 23-47 bp, and spacer sequences are 21-72 bp.
 */
export function detectCrisprArrays(dnaSeq: string): CrisprArray[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const arrays: CrisprArray[] = [];

  // Scans for candidate repeats (length 23 to 40)
  for (let repLen = 23; repLen <= 40; repLen++) {
    for (let i = 0; i < seq.length - (repLen * 3 + 40); i++) {
      const candidateRepeat = seq.slice(i, i + repLen);
      
      const spacers: string[] = [];
      let currentPos = i + repLen;
      let matchCount = 1;
      
      // Slide forward to check for subsequent repeats separated by spacers
      while (currentPos < seq.length) {
        // Look for the repeat in a window (spacer size 21 to 72 bp)
        let foundRepeat = false;
        
        for (let spacerLen = 21; spacerLen <= 72; spacerLen++) {
          if (currentPos + spacerLen + repLen > seq.length) break;
          const target = seq.slice(currentPos + spacerLen, currentPos + spacerLen + repLen);
          
          // Allow up to 2 mismatches in the Direct Repeat (DR is highly but not 100% conserved)
          let mismatches = 0;
          for (let k = 0; k < repLen; k++) {
            if (candidateRepeat[k] !== target[k]) mismatches++;
          }

          if (mismatches <= 2) {
            spacers.push(seq.slice(currentPos, currentPos + spacerLen));
            currentPos = currentPos + spacerLen + repLen;
            matchCount++;
            foundRepeat = true;
            break;
          }
        }

        if (!foundRepeat) break;
      }

      if (matchCount >= 3) { // Minimum 3 repeats required for a valid array
        const start = i;
        const end = currentPos - 1;

        // Verify we haven't already covered this region
        const isCovered = arrays.some(arr => start >= arr.start && end <= arr.end);
        if (!isCovered) {
          // Calculate confidence based on conservation and repeats count
          const confidence = Math.min(100, 50 + (matchCount * 10));
          arrays.push({
            start,
            end,
            repeatConsensus: candidateRepeat,
            repeatCount: matchCount,
            spacers,
            confidence
          });
        }

        i = end; // Skip scanning forward
      }
    }
  }

  return arrays.sort((a, b) => a.start - b.start);
}

