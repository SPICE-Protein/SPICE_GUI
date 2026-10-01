// Advanced molecular biology tools: oligo annealing, reverse translation,
// silent mutagenesis, sequence search, auto-annotation, GC sliding window,
// fusion reading-frame check, alignment file parsing.
// Pure TypeScript, no external deps.

import { getReverseComplementSequenceString, getAminoAcidStringFromSequenceString } from "./sequence";
import { calculatePercentGC } from "./sequence";
import { CODON_WEIGHTS, type CodonHost } from "./codon";
import * as m from "$lib/paraglide/messages.js";

// ──────────────────────────────── Anneal Oligos ────────────────────────────────

export interface AnnealResult {
  doubleStranded: string;
  topStrand: string;
  bottomStrand: string;
  leftOverhang: string;
  rightOverhang: string;
  topLength: number;
  bottomLength: number;
  duplexLength: number;
  tm: number;
  warnings: string[];
}

const DNA_PAIRS: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G",
};

function canPair(a: string, b: string): boolean {
  return DNA_PAIRS[a.toUpperCase()] === b.toUpperCase();
}

/**
 * Anneal two oligonucleotides into a double-stranded product with possible
 * sticky (cohesive) ends. The forward oligo is the top strand (5'->3'), the
 * reverse oligo is provided 5'->3' and represents the bottom strand.
 */
export function annealOligos(forwardOligo: string, reverseOligo: string): AnnealResult {
  const top = forwardOligo.toUpperCase().replace(/[^ATCGN]/g, "");
  const revOligo = reverseOligo.toUpperCase().replace(/[^ATCGN]/g, "");
  const bottomRc = getReverseComplementSequenceString(revOligo);

  const warnings: string[] = [];
  if (top.length < 4 || revOligo.length < 4) {
    warnings.push(m.advOligoTooShort());
  }

  let bestOffset = 0;
  let bestMatch = 0;

  const minOffset = -(bottomRc.length - 4);
  const maxOffset = top.length - 4;

  for (let offset = minOffset; offset <= maxOffset; offset++) {
    let matchCount = 0;
    for (let i = 0; i < bottomRc.length; i++) {
      const j = i + offset;
      if (j >= 0 && j < top.length && canPair(top[j], bottomRc[i])) {
        matchCount++;
      }
    }
    if (matchCount > bestMatch) {
      bestMatch = matchCount;
      bestOffset = offset;
    }
  }

  if (bestMatch < 4) {
    warnings.push(m.advOligosNoAnneal());
  }

  const leftOverhangTop = bestOffset > 0 ? top.slice(0, bestOffset) : "";
  const topStart = Math.max(0, bestOffset);
  const bottomEndInTop = bestOffset + bottomRc.length;
  const rightOverhangTop = bottomEndInTop < top.length ? top.slice(bottomEndInTop) : "";

  const leftOverhangBottom = bestOffset < 0 ? bottomRc.slice(0, -bestOffset) : "";
  const rightOverhangBottom = bottomEndInTop > top.length ? bottomRc.slice(top.length - bestOffset) : "";

  const duplexStart = Math.max(0, bestOffset);
  const duplexEnd = Math.min(top.length, bottomEndInTop);
  const duplexLength = Math.max(0, duplexEnd - duplexStart);

  const duplexSeq = top.slice(duplexStart, duplexEnd);
  const gc = calculatePercentGC(duplexSeq);
  const tm = duplexLength > 0 ? 64.9 + 41 * (gc - 16.4) / Math.max(duplexLength, 1) : 0;

  // Build a visual representation
  const padLen = Math.max(0, -bestOffset);
  const topAligned = '-'.repeat(padLen) + top.slice(topStart, duplexEnd) + (rightOverhangTop || '');
  const bottomAligned = '-'.repeat(Math.max(0, bestOffset)) + bottomRc.slice(Math.max(0, -bestOffset), Math.max(0, -bestOffset) + duplexLength) + (rightOverhangBottom || '');

  return {
    doubleStranded: `${topAligned}\n${[...bottomAligned].reverse().join('')}`,
    topStrand: top,
    bottomStrand: revOligo,
    leftOverhang: leftOverhangTop || getReverseComplementSequenceString(rightOverhangBottom),
    rightOverhang: rightOverhangTop || getReverseComplementSequenceString(leftOverhangBottom),
    topLength: top.length,
    bottomLength: revOligo.length,
    duplexLength,
    tm: Math.round(tm * 10) / 10,
    warnings,
  };
}

// ──────────────────────────────── Reverse Translate ────────────────────────────────

const DEFAULT_CODON_TABLE: Record<string, string> = {
  M: "ATG", W: "TGG", F: "TTC", L: "CTG", I: "ATC", V: "GTG",
  S: "AGC", P: "CCG", T: "ACC", A: "GCG", Y: "TAC", H: "CAC",
  Q: "CAG", N: "AAC", K: "AAG", D: "GAC", E: "GAA", C: "TGC",
  R: "CGT", G: "GGC", "*": "TAA",
};

export interface ReverseCodonTrace {
  index: number;
  aminoAcid: string;
  codon: string;
  dnaStart: number;
  dnaEnd: number;
  gcPercent: number;
}

export interface ReverseTranslationValidation {
  valid: boolean;
  translatedProtein: string;
  requestedProtein: string;
  mismatches: { index: number; requested: string; translated: string }[];
  invalidCodons: { index: number; codon: string }[];
}

export interface ReverseTranslateOptions {
  /** One preferred codon per amino acid (the legacy/Kazusa-compatible shape). */
  codonTable?: Record<string, string>;
  /** Optional codon usage weights, or arrays of preferred codons, keyed by AA. */
  codonUsage?: Record<string, Record<string, number> | string[]>;
  host?: CodonHost;
  optimizeGc?: boolean;
  targetGc?: number;
  includeStop?: boolean;
  startCodon?: string;
  stopCodon?: string;
  /** Recognition sites to report (the generator does not silently alter protein). */
  avoidRestrictionSites?: string[];
  output?: 'dna' | 'mrna' | 'both';
}

export interface ReverseTranslateResult {
  dnaSequence: string;
  mrnaSequence: string;
  cdnaSequence: string;
  proteinSequence: string;
  codonMap: Record<string, string>;
  codonTrace: ReverseCodonTrace[];
  validation: ReverseTranslationValidation;
  warnings: string[];
}

const SYNONYMOUS_BY_AA: Record<string, string[]> = {
  F: ['TTT', 'TTC'], L: ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG'], I: ['ATT', 'ATC', 'ATA'], M: ['ATG'],
  V: ['GTT', 'GTC', 'GTA', 'GTG'], S: ['TCT', 'TCC', 'TCA', 'TCG', 'AGT', 'AGC'], P: ['CCT', 'CCC', 'CCA', 'CCG'],
  T: ['ACT', 'ACC', 'ACA', 'ACG'], A: ['GCT', 'GCC', 'GCA', 'GCG'], Y: ['TAT', 'TAC'], H: ['CAT', 'CAC'],
  Q: ['CAA', 'CAG'], N: ['AAT', 'AAC'], K: ['AAA', 'AAG'], D: ['GAT', 'GAC'], E: ['GAA', 'GAG'], C: ['TGT', 'TGC'],
  R: ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'], G: ['GGT', 'GGC', 'GGA', 'GGG'], W: ['TGG'], '*': ['TAA', 'TAG', 'TGA']
};
const REVERSE_CODON_AA: Record<string, string> = Object.fromEntries(
  Object.entries(SYNONYMOUS_BY_AA).flatMap(([aa, codons]) => codons.map(codon => [codon, aa]))
);

/** Reverse translate a peptide with deterministic codon choice and full QC trace. */
export function reverseTranslate(
  proteinSeq: string,
  options: ReverseTranslateOptions = {}
): ReverseTranslateResult {
  const warnings: string[] = [];
  const requested = proteinSeq.toUpperCase().replace(/[^A-Z*]/g, '');
  if (requested.length !== proteinSeq.replace(/\\s/g, '').length) {
    warnings.push(m.advProteinBadChars());
  }
  const host = options.host;
  const usage = options.codonUsage || (host ? CODON_WEIGHTS[host] : undefined);
  const table: Record<string, string> = { ...DEFAULT_CODON_TABLE, ...(options.codonTable || {}) };
  const trace: ReverseCodonTrace[] = [];
  let dna = '';

  const chooseCodon = (aa: string): string => {
    const candidates = (usage?.[aa] && Array.isArray(usage[aa])
      ? usage[aa] as string[] : SYNONYMOUS_BY_AA[aa]) || [];
    const preferred = table[aa]?.toUpperCase().replace(/U/g, 'T');
    const valid = candidates.filter(c => REVERSE_CODON_AA[c.toUpperCase()] === aa);
    if (preferred && REVERSE_CODON_AA[preferred] === aa && !options.optimizeGc) return preferred;
    const pool = valid.length ? valid : (preferred && REVERSE_CODON_AA[preferred] === aa ? [preferred] : []);
    if (!pool.length) return preferred && /^[ATCG]{3}$/.test(preferred) ? preferred : 'NNN';
    const weights = usage?.[aa] && !Array.isArray(usage[aa]) ? usage[aa] as Record<string, number> : undefined;
    return pool.slice().sort((a, b) => {
      if (weights) return (weights[b] || 0) - (weights[a] || 0);
      if (options.optimizeGc) {
        const target = options.targetGc ?? 50;
        const gc = (c: string) => [...c].filter(x => x === 'G' || x === 'C').length * 100 / 3;
        return Math.abs(gc(a) - target) - Math.abs(gc(b) - target);
      }
      return a.localeCompare(b);
    })[0];
  };

  const start = options.startCodon?.toUpperCase().replace(/U/g, 'T');
  for (let i = 0; i < requested.length; i++) {
    const aa = requested[i];
    let codon = chooseCodon(aa);
    if (i === 0 && start && aa === 'M') codon = start;
    if (REVERSE_CODON_AA[codon] !== aa) warnings.push(m.advNoValidCodon({ v1: aa, v2: codon }));
    const dnaStart = dna.length;
    dna += codon;
    trace.push({ index: i, aminoAcid: aa, codon, dnaStart, dnaEnd: dna.length, gcPercent: Math.round(calculatePercentGC(codon) * 10) / 10 });
  }
  if (options.includeStop || options.stopCodon) {
    const stop = (options.stopCodon || 'TAA').toUpperCase().replace(/U/g, 'T');
    if (REVERSE_CODON_AA[stop] !== '*') warnings.push(m.advInvalidStopCodon({ v1: stop }));
    else dna += stop;
  }
  for (const rawSite of options.avoidRestrictionSites || []) {
    const site = rawSite.toUpperCase().replace(/U/g, 'T').replace(/[^ATCG]/g, '');
    if (site && dna.includes(site)) warnings.push(m.advAvoidSitePresent({ v1: site }));
  }
  const translated = [...Array(Math.floor(dna.length / 3))].map((_, i) => REVERSE_CODON_AA[dna.slice(i * 3, i * 3 + 3)] || 'X').join('');
  const mismatches = [...requested].map((aa, i) => ({ index: i, requested: aa, translated: translated[i] || 'X' })).filter(x => x.requested !== x.translated);
  const invalidCodons = [...Array(Math.floor(dna.length / 3))].map((_, i) => ({ index: i, codon: dna.slice(i * 3, i * 3 + 3) })).filter(x => !REVERSE_CODON_AA[x.codon]);
  const validation = { valid: mismatches.length === 0 && invalidCodons.length === 0, translatedProtein: translated, requestedProtein: requested, mismatches, invalidCodons };
  if (!validation.valid) warnings.push(m.advRevTranslateInvalid());
  const mrnaSequence = dna.replace(/T/g, 'U');
  return { dnaSequence: dna, mrnaSequence, cdnaSequence: dna, proteinSequence: requested, codonMap: table, codonTrace: trace, validation, warnings };
}

// ──────────────────────────────── Silent Mutagenesis ────────────────────────────────

const SYNONYMOUS_CODONS: Record<string, string[]> = {
  F: ["TTT", "TTC"], L: ["TTA", "TTG", "CTT", "CTC", "CTA", "CTG"],
  I: ["ATT", "ATC", "ATA"], M: ["ATG"], V: ["GTT", "GTC", "GTA", "GTG"],
  S: ["TCT", "TCC", "TCA", "TCG", "AGT", "AGC"], P: ["CCT", "CCC", "CCA", "CCG"],
  T: ["ACT", "ACC", "ACA", "ACG"], A: ["GCT", "GCC", "GCA", "GCG"],
  Y: ["TAT", "TAC"], H: ["CAT", "CAC"], Q: ["CAA", "CAG"],
  N: ["AAT", "AAC"], K: ["AAA", "AAG"], D: ["GAT", "GAC"], E: ["GAA", "GAG"],
  C: ["TGT", "TGC"], W: ["TGG"], R: ["CGT", "CGC", "CGA", "CGG", "AGA", "AGG"],
  G: ["GGT", "GGC", "GGA", "GGG"], "*": ["TAA", "TAG", "TGA"],
};

const CODON_TO_AA: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S", AGT: "S", AGC: "S",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R", AGA: "R", AGG: "R",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

export interface SilentMutagenesisResult {
  modifiedSequence: string;
  mutations: { position: number; originalBase: string; newBase: string; codonBefore: string; codonAfter: string }[];
  restrictionSiteAdded?: string;
  restrictionSiteRemoved?: string;
  warnings: string[];
}

/**
 * Add or remove a restriction enzyme recognition site by introducing silent
 * mutations (synonymous codon changes that do not alter the protein).
 */
export function simulateSilentMutagenesis(
  dnaSeq: string,
  options: { addSite?: string; removeSite?: string; readingFrame?: number }
): SilentMutagenesisResult {
  const warnings: string[] = [];
  let seq = dnaSeq.toUpperCase().replace(/[^ATCGN]/g, "");
  const frame = options.readingFrame || 0;
  const mutations: SilentMutagenesisResult["mutations"] = [];

  if (options.addSite) {
    const site = options.addSite.toUpperCase();
    for (let i = frame; i <= seq.length - site.length; i++) {
      let possible = true;
      const changes: { position: number; originalBase: string; newBase: string; codonBefore: string; codonAfter: string }[] = [];

      for (let j = 0; j < site.length; j++) {
        const pos = i + j;
        const codonStart = Math.floor((pos - frame) / 3) * 3 + frame;
        const codonOffset = pos - codonStart;
        const origCodon = seq.slice(codonStart, codonStart + 3);
        const origAa = REVERSE_CODON_AA[origCodon];
        if (!origAa) { possible = false; break; }

        const newCodon = origCodon.slice(0, codonOffset) + site[j] + origCodon.slice(codonOffset + 1);
        const newAa = REVERSE_CODON_AA[newCodon];

        if (newAa !== origAa) { possible = false; break; }
        if (newCodon !== origCodon) {
          changes.push({ position: pos, originalBase: seq[pos], newBase: site[j], codonBefore: origCodon, codonAfter: newCodon });
        }
      }

      if (possible && changes.length > 0) {
        const seqArr = seq.split('');
        for (const c of changes) { seqArr[c.position] = c.newBase; mutations.push(c); }
        seq = seqArr.join('');
        return { modifiedSequence: seq, mutations, restrictionSiteAdded: site, warnings };
      }
    }
    warnings.push(m.advSilentAddFail({ v1: frame, v2: site }));
  }

  if (options.removeSite) {
    const site = options.removeSite.toUpperCase();
    let pos = seq.indexOf(site);
    while (pos !== -1) {
      let possible = true;
      const changes: { position: number; originalBase: string; newBase: string; codonBefore: string; codonAfter: string }[] = [];

      for (let j = 0; j < site.length; j++) {
        const absPos = pos + j;
        const codonStart = Math.floor((absPos - frame) / 3) * 3 + frame;
        const co = absPos - codonStart;
        const origCodon = seq.slice(codonStart, codonStart + 3);
        const origAa = REVERSE_CODON_AA[origCodon];
        if (!origAa) { possible = false; break; }

        const syns = SYNONYMOUS_CODONS[origAa] || [];
        let found = false;
        for (const syn of syns) {
          if (syn[co] !== site[j]) {
            const newAa = REVERSE_CODON_AA[syn];
            if (newAa === origAa) {
              changes.push({ position: absPos, originalBase: seq[absPos], newBase: syn[co], codonBefore: origCodon, codonAfter: syn });
              found = true;
              break;
            }
          }
        }
        if (!found) { possible = false; break; }
      }

      if (possible && changes.length > 0) {
        const seqArr = seq.split('');
        for (const c of changes) { seqArr[c.position] = c.newBase; mutations.push(c); }
        seq = seqArr.join('');
        return { modifiedSequence: seq, mutations, restrictionSiteRemoved: site, warnings };
      }
      pos = seq.indexOf(site, pos + 1);
    }
    warnings.push(m.advSilentRemoveFail({ v1: site }));
  }

  return { modifiedSequence: seq, mutations, warnings };
}

// ──────────────────────────────── Sequence Search ────────────────────────────────

export interface SearchResult {
  query: string;
  matches: { position: number; strand: 'forward' | 'reverse'; context: string }[];
  count: number;
}

let lastIndexedSeq = "";
let kmerIndexMap = new Map<string, number[]>();

export function buildKmerIndex(sequence: string, k = 6) {
  if (sequence === lastIndexedSeq && kmerIndexMap.size > 0) return;
  lastIndexedSeq = sequence;
  kmerIndexMap.clear();
  
  const len = sequence.length;
  // Build 6-mer index for instant MICA search (Gap 12)
  for (let i = 0; i <= len - k; i++) {
    const kmer = sequence.substring(i, i + k).toUpperCase();
    if (!kmerIndexMap.has(kmer)) {
      kmerIndexMap.set(kmer, []);
    }
    kmerIndexMap.get(kmer)!.push(i);
  }
}

/**
 * Search for a subsequence in a DNA sequence (forward + reverse complement).
 * Supports ambiguity codes (N matches anything, R = A/G, etc.)
 * Accelerated with advanced MICA-like 6-mer index for sub-millisecond large sequence search.
 */
export function searchSequence(query: string, dnaSeq: string): SearchResult {
  const q = query.toUpperCase().replace(/[^ATGCNRWSKMYBDHVN]/g, "");
  const target = dnaSeq.toUpperCase();
  const matches: SearchResult["matches"] = [];

  if (q.length < 3) return { query, matches: [], count: 0 };

  // 1. Instant MICA search lookup for exact sub-queries of length >= 6 (sub-millisecond)
  if (q.length >= 6 && !/[NRYSWKMYBDHV]/g.test(q)) {
    buildKmerIndex(dnaSeq, 6);
    
    // Forward lookup
    const first6 = q.slice(0, 6);
    const candidates = kmerIndexMap.get(first6) || [];
    for (const pos of candidates) {
      if (target.substring(pos, pos + q.length) === q) {
        matches.push({
          position: pos,
          strand: 'forward',
          context: target.slice(Math.max(0, pos - 5), pos + q.length + 5)
        });
      }
    }
    
    // Reverse complement lookup
    const revComp = getReverseComplementSequenceString(q);
    const first6Rev = revComp.slice(0, 6);
    const revCandidates = kmerIndexMap.get(first6Rev) || [];
    for (const pos of revCandidates) {
      if (target.substring(pos, pos + q.length) === revComp) {
        matches.push({
          position: pos,
          strand: 'reverse',
          context: target.slice(Math.max(0, pos - 5), pos + revComp.length + 5)
        });
      }
    }
    
    return { query, matches, count: matches.length };
  }

  // 2. Fallback to regex with degeneracy support
  const ambigMap: Record<string, string> = {
    A: "A", T: "T", G: "G", C: "C",
    N: "[ATGC]", R: "[AG]", Y: "[CT]", S: "[GC]", W: "[AT]",
    K: "[GT]", M: "[AC]", B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]",
  };
  const fwdPattern = q.split('').map(c => ambigMap[c] || c).join('');
  const fwdRegex = new RegExp(fwdPattern, 'gi');
  const revComp = getReverseComplementSequenceString(q);
  const revPattern = revComp.split('').map(c => ambigMap[c] || c).join('');
  const revRegex = new RegExp(revPattern, 'gi');

  let m: RegExpExecArray | null;
  fwdRegex.lastIndex = 0;
  while ((m = fwdRegex.exec(target)) !== null) {
    matches.push({
      position: m.index,
      strand: 'forward',
      context: target.slice(Math.max(0, m.index - 5), m.index + q.length + 5),
    });
    if (m.index === fwdRegex.lastIndex) fwdRegex.lastIndex++;
  }
  revRegex.lastIndex = 0;
  while ((m = revRegex.exec(target)) !== null) {
    matches.push({
      position: m.index,
      strand: 'reverse',
      context: target.slice(Math.max(0, m.index - 5), m.index + revComp.length + 5),
    });
    if (m.index === revRegex.lastIndex) revRegex.lastIndex++;
  }

  return { query, matches, count: matches.length };
}

// ──────────────────────────────── Auto-Annotation ────────────────────────────────

const COMMON_FEATURES_DB: { name: string; type: string; seq: string; color: string }[] = [
  { name: "T7 promoter", type: "promoter", seq: "TAATACGACTCACTATAGGG", color: "#ff5d5d" },
  { name: "SP6 promoter", type: "promoter", seq: "ATTTAGGTGACACTATAG", color: "#ff5d5d" },
  { name: "lac promoter", type: "promoter", seq: "AATTGTGAGCGGATAACAAT", color: "#ff9f1c" },
  { name: "T7 terminator", type: "terminator", seq: "TGCTCGACGGAGTACTGCTAATACGACTCACTATAGGG", color: "#53d769" },
  { name: "pMB1 ori", type: "ori", seq: "CTAAGAAACCGAAAA", color: "#4cd6ff" },
  { name: "AmpR", type: "cds", seq: "ATGAGTATTCAACATTTCCGTGTCG", color: "#b48cff" },
  { name: "KanR", type: "cds", seq: "ATGAGCCATATTCAACGGGAAAC", color: "#b48cff" },
  { name: "CmR", type: "cds", seq: "ATGGAGAAAAAAATCACTGGAT", color: "#b48cff" },
  { name: "His-tag", type: "cds", seq: "CATCACCATCACCATCACCAT", color: "#ffd23f" },
  { name: "FLAG-tag", type: "cds", seq: "GACTACAAGGACGACGATGACAAG", color: "#ffd23f" },
  { name: "HA-tag", type: "cds", seq: "TACCCATACGATGTTCCAGATTACGCT", color: "#ffd23f" },
  { name: "Myc-tag", type: "cds", seq: "GAGCAGAAACTCATCTCTGAAGAGG", color: "#ffd23f" },
  { name: "GST-tag", type: "cds", seq: "ATGTCCCCTATACTAGGTTATTGG", color: "#ffd23f" },
  { name: "MCS", type: "misc", seq: "GAATTCGAGCTCCGTCGACAAGCTTCTGCAGGGTACCGGATCCTCTAGA", color: "#ff5df6" },
];

export interface AutoAnnotationResult {
  features: { name: string; type: string; start: number; end: number; strand: 'forward' | 'reverse'; color: string }[];
  count: number;
}

/**
 * Automatically detect and annotate common plasmid features.
 */
export function autoAnnotate(dnaSeq: string): AutoAnnotationResult {
  const target = dnaSeq.toUpperCase();
  const features: AutoAnnotationResult["features"] = [];

  for (const feat of COMMON_FEATURES_DB) {
    const seq = feat.seq.toUpperCase().replace(/\s/g, '');
    if (seq.length < 6) continue;

    let pos = target.indexOf(seq);
    while (pos !== -1) {
      features.push({ name: feat.name, type: feat.type, start: pos, end: pos + seq.length - 1, strand: 'forward', color: feat.color });
      pos = target.indexOf(seq, pos + 1);
    }

    const rcSeq = getReverseComplementSequenceString(seq);
    pos = target.indexOf(rcSeq);
    while (pos !== -1) {
      features.push({ name: feat.name, type: feat.type, start: pos, end: pos + rcSeq.length - 1, strand: 'reverse', color: feat.color });
      pos = target.indexOf(rcSeq, pos + 1);
    }
  }

  return { features, count: features.length };
}

// ──────────────────────────────── Synced-DB Feature Annotation ────────────────────────────────

export type AnnotationAlgorithm = 'exact' | 'kmer';

export interface FeatureLibraryEntry {
  name: string;
  seq: string;
  type?: string;
  color?: string;
}

export const FEATURE_COLORS: Record<string, string> = {
  promoter: '#ff5d5d',
  terminator: '#53d769',
  ori: '#4cd6ff',
  cds: '#b48cff',
  tag: '#ffd23f',
  mrna: '#53d7a9',
  repeat: '#ff9f1c',
  misc: '#5df6ff'
};

/** Derive a feature type from an element description (used for synced UniVec/Addgene names). */
export function inferFeatureType(name: string): string {
  const n = (name || '').toLowerCase();
  if (/promoter|enhancer|operator|rna pol|t7 rnap|sp6 promoter|cmv|sv40|35s promoter|nos promoter|u6 promoter|gata|hsp/.test(n)) return 'promoter';
  if (/terminator|polya|poly-a|poly a|trna term|rrnb/.test(n)) return 'terminator';
  if (/origin|replication|rep ?ori|\bori\b|resist origin|2 ?micr|col ?e ?1|pmb1|p15a|plasmid replication|ara ?cba|replicon|scaffold|attachment site|integration/.test(n)) return 'ori';
  if (/tag|flag|his[- ]?tag|myc|ha[- ]?tag|v5|strep|s[- ]?tag|myc tag/.test(n)) return 'tag';
  if (/mRNA|transcript|5' utr|3' utr|intron|exon/.test(n)) return 'mrna';
  if (/resistance|kanr|ampr|tet|cat|gent|hyg|bleo|aph|aac|str.*r|chloramphen|antibiotic|bla|erm|van/.test(n)) return 'cds';
  if (/linker|adapte|primer|cloning site|polylinker|\bmcs\b|multiple cloning|vector|backbone|cloning vector|spacer/.test(n)) return 'repeat';
  return 'misc';
}

function normalizeDna(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, '');
}

function mergeIntervals(ints: [number, number][], gap: number): [number, number][] {
  if (!ints.length) return [];
  const sorted = [...ints].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const [s, e] = sorted[i];
    if (s <= last[1] + gap) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Builtin curated feature library (exposed so it can be merged with synced DBs). */
export function getCommonFeatureLibrary(): FeatureLibraryEntry[] {
  return COMMON_FEATURES_DB.map(f => ({ name: f.name, seq: f.seq, type: f.type, color: f.color }));
}

/**
 * Scan a sequence against a feature library (builtin and/or synced UniVec/Antibiotic parts).
 * - 'exact': whole-element forward + reverse-complement substring match (fast; identical parts only).
 * - 'kmer' : seed (first seedLen bases) → tolerate mismatches while extending over the element,
 *            then merge same-name intervals. Reconstructs full elements from UniVec's ≤50 bp
 *            segments and survives SNPs/small indels that break exact matching.
 * Coordinates are 0-based inclusive, matching autoAnnotate.
 */
export function annotateFeatures(
  query: string,
  library: FeatureLibraryEntry[],
  algorithm: AnnotationAlgorithm = 'kmer',
  opts?: { seedLen?: number; minMatch?: number; mergeGap?: number }
): AutoAnnotationResult {
  const q = normalizeDna(query);
  const seedLen = opts?.seedLen ?? 22;
  const minMatch = opts?.minMatch ?? 24;
  const mergeGap = opts?.mergeGap ?? 6;

  interface Rec { type: string; color: string; ints: [number, number][] }
  const groups = new Map<string, Rec>();
  const add = (name: string, type: string, color: string, strand: 'forward' | 'reverse', start: number, end: number) => {
    const key = `${name}|${strand}`;
    let r = groups.get(key);
    if (!r) { r = { type, color, ints: [] }; groups.set(key, r); }
    r.ints.push([start, end]);
  };
  const findSeed = (seed: string): number[] => {
    const res: number[] = [];
    let p = q.indexOf(seed);
    while (p !== -1) { res.push(p); p = q.indexOf(seed, p + 1); }
    return res;
  };

  for (const e of library) {
    const s = normalizeDna(e.seq);
    if (s.length < 8) continue;
    const type = e.type || inferFeatureType(e.name);
    const color = e.color || FEATURE_COLORS[type] || FEATURE_COLORS.misc;

    if (algorithm === 'exact') {
      const pats: [string, 'forward' | 'reverse'][] = [[s, 'forward'], [getReverseComplementSequenceString(s), 'reverse']];
      for (const [pat, strand] of pats) {
        if (pat.length < 8) continue;
        let p = q.indexOf(pat);
        while (p !== -1) { add(e.name, type, color, strand, p, p + pat.length - 1); p = q.indexOf(pat, p + 1); }
      }
      continue;
    }

    // k-mer seed + tolerant extension
    const k = Math.min(seedLen, s.length);
    const tol = Math.max(1, Math.floor(k / 10));
    const doOrient = (pat: string, strand: 'forward' | 'reverse') => {
      const seed = pat.slice(0, k);
      for (const p of findSeed(seed)) {
        let end = p;
        let mism = 0;
        for (let j = 0; j < pat.length; j++) {
          const qc = q[p + j];
          if (qc === undefined) break;
          if (qc === pat[j]) end = p + j;
          else { mism++; if (mism > tol) break; end = p + j; }
        }
        const span = end - p + 1;
        if (span >= minMatch && span >= pat.length * 0.6) add(e.name, type, color, strand, p, end);
      }
    };
    doOrient(s, 'forward');
    doOrient(getReverseComplementSequenceString(s), 'reverse');
  }

  const features: AutoAnnotationResult['features'] = [];
  for (const [key, rec] of groups) {
    const sep = key.lastIndexOf('|');
    const name = key.slice(0, sep);
    const strand = key.slice(sep + 1) as 'forward' | 'reverse';
    for (const [st, en] of mergeIntervals(rec.ints, mergeGap)) {
      features.push({ name, type: rec.type, start: st, end: en, strand, color: rec.color });
    }
  }
  features.sort((a, b) => a.start - b.start);
  return { features, count: features.length };
}

/** Smith-Waterman hit returned by the Rust backend (0-based inclusive coords). */
export interface SwHitDto {
  name: string;
  start: number;
  end: number;
  strand: string;
  score: number;
}

/** Convert backend SW hits into an AutoAnnotationResult (type/color inferred from name). */
export function swHitsToFeatures(hits: SwHitDto[]): AutoAnnotationResult {
  const features = hits.map(h => {
    const type = inferFeatureType(h.name);
    const color = FEATURE_COLORS[type] || FEATURE_COLORS.misc;
    return {
      name: h.name,
      type,
      start: h.start,
      end: h.end,
      strand: (h.strand === 'reverse' ? 'reverse' : 'forward') as 'forward' | 'reverse',
      color
    };
  });
  features.sort((a, b) => a.start - b.start);
  return { features, count: features.length };
}

// ──────────────────────────────── GC Sliding Window ────────────────────────────────

export interface GcWindowPoint {
  position: number;
  gc: number;
}

/**
 * Calculate GC content in a sliding window across the sequence.
 */
export function gcSlidingWindow(dnaSeq: string, windowSize = 50, stepSize = 10): GcWindowPoint[] {
  const seq = dnaSeq.toUpperCase();
  const points: GcWindowPoint[] = [];

  for (let i = 0; i < seq.length; i += stepSize) {
    const end = Math.min(i + windowSize, seq.length);
    const window = seq.slice(i, end);
    const gc = calculatePercentGC(window);
    points.push({ position: i, gc });
  }

  return points;
}

// ──────────────────────────────── Fusion Reading Frame Check ────────────────────────────────

export interface FusionFrameResult {
  inFrame: boolean;
  frameOffset: number;
  junctionSequence: string;
  junctionTranslation: string;
  warnings: string[];
}

/**
 * Check whether two features are in the same reading frame across a junction,
 * which is critical for fusion protein design.
 */
export function checkFusionReadingFrame(
  dnaSeq: string,
  feat1Start: number,
  feat1End: number,
  feat2Start: number,
  feat2End: number,
  frame = 0
): FusionFrameResult {
  const warnings: string[] = [];
  const seq = dnaSeq.toUpperCase();

  const feat1EndFrame = (feat1End - frame + 1) % 3;
  const feat2StartFrame = (feat2Start - frame) % 3;
  const inFrame = feat1EndFrame === 2;
  const frameOffset = ((feat2Start - feat1End - 1) % 3 + 3) % 3;

  const junctionStart = Math.max(0, feat1End - 6);
  const junctionEnd = Math.min(seq.length, feat2Start + 6);
  const junctionSeq = seq.slice(junctionStart, junctionEnd);
  const junctionTranslation = getAminoAcidStringFromSequenceString(junctionSeq, { forward: true });

  if (!inFrame) {
    warnings.push(m.advFusionFrameMismatch({ v1: feat1EndFrame, v2: feat2StartFrame }));
  }
  if (frameOffset !== 0) {
    warnings.push(m.advFusionFrameGap({ v1: frameOffset }));
  }

  return { inFrame, frameOffset, junctionSequence: junctionSeq, junctionTranslation, warnings };
}

// ──────────────────────────────── Alignment File Import ────────────────────────────────

export interface ImportedAlignment {
  rows: { id: string; name: string; seq: string }[];
  format: string;
}

/**
 * Parse alignment files in various formats (Clustal, FASTA, NEXUS, PHYLIP, MSF, Stockholm).
 */
export function parseAlignmentFile(text: string, format?: string): ImportedAlignment {
  const detected = format || detectAlignmentFormat(text);
  switch (detected) {
    case 'clustal': return parseClustal(text);
    case 'fasta': return parseFastaAlignment(text);
    case 'nexus': return parseNexus(text);
    case 'phylip': return parsePhylip(text);
    case 'msf': return parseMsf(text);
    case 'stockholm': return parseStockholm(text);
    default: return parseFastaAlignment(text);
  }
}

function detectAlignmentFormat(text: string): string {
  const header = text.slice(0, 200).toUpperCase();
  if (header.includes('CLUSTAL')) return 'clustal';
  if (header.includes('#NEXUS') || header.includes('#NEX')) return 'nexus';
  if (header.includes('#STOCKHOLM')) return 'stockholm';
  if (header.includes('MSF:')) return 'msf';
  if (header.startsWith('>') || header.includes('>')) return 'fasta';
  if (/^\s*\d+\s+\d+\s*$/.test(text.slice(0, 20))) return 'phylip';
  return 'fasta';
}

function parseFastaAlignment(text: string): ImportedAlignment {
  const rows: { id: string; name: string; seq: string }[] = [];
  let currentName = '';
  let currentSeq = '';
  let idx = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('>')) {
      if (currentName) rows.push({ id: `seq${idx++}`, name: currentName, seq: currentSeq });
      currentName = line.slice(1).trim().split(/\s+/)[0];
      currentSeq = '';
    } else {
      currentSeq += line.trim();
    }
  }
  if (currentName) rows.push({ id: `seq${idx++}`, name: currentName, seq: currentSeq });
  return { rows, format: 'fasta' };
}

function parseClustal(text: string): ImportedAlignment {
  const rows: Map<string, { id: string; name: string; seq: string }> = new Map();
  const lines = text.split('\n').filter(l => l.trim() && !l.toUpperCase().startsWith('CLUSTAL') && !l.startsWith(' '));
  let idx = 0;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const seq = parts[1];
      if (!rows.has(name)) rows.set(name, { id: `seq${idx++}`, name, seq: '' });
      rows.get(name)!.seq += seq;
    }
  }
  return { rows: [...rows.values()], format: 'clustal' };
}

function parseNexus(text: string): ImportedAlignment {
  const rows: Map<string, { id: string; name: string; seq: string }> = new Map();
  const matrixMatch = text.match(/MATRIX\s*([\s\S]*?)\s*;/i);
  if (!matrixMatch) return { rows: [], format: 'nexus' };
  let idx = 0;
  for (const line of matrixMatch[1].split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0].replace(/['"]/g, '');
      const seq = parts[1];
      if (!rows.has(name)) rows.set(name, { id: `seq${idx++}`, name, seq: '' });
      rows.get(name)!.seq += seq;
    }
  }
  return { rows: [...rows.values()], format: 'nexus' };
}

function parsePhylip(text: string): ImportedAlignment {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { rows: [], format: 'phylip' };
  const rows: { id: string; name: string; seq: string }[] = [];
  let idx = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0].slice(0, 10);
      const seq = parts.slice(1).join('');
      rows.push({ id: `seq${idx++}`, name, seq });
    }
  }
  return { rows, format: 'phylip' };
}

function parseMsf(text: string): ImportedAlignment {
  const rows: Map<string, { id: string; name: string; seq: string }> = new Map();
  const lines = text.split('\n');
  let idx = 0;
  let inSeq = false;
  for (const line of lines) {
    if (line.includes('//')) { inSeq = true; continue; }
    if (!inSeq) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const seq = parts.slice(1).join('');
      if (!rows.has(name)) rows.set(name, { id: `seq${idx++}`, name, seq: '' });
      rows.get(name)!.seq += seq;
    }
  }
  return { rows: [...rows.values()], format: 'msf' };
}

function parseStockholm(text: string): ImportedAlignment {
  const rows: Map<string, { id: string; name: string; seq: string }> = new Map();
  const lines = text.split('\n');
  let idx = 0;
  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const seq = parts[1];
      if (!rows.has(name)) rows.set(name, { id: `seq${idx++}`, name, seq: '' });
      rows.get(name)!.seq += seq;
    }
  }
  return { rows: [...rows.values()], format: 'stockholm' };
}

// ──────────────────────────────── Ribosomal Slippage (PRF) Translation ────────────────────────────────

const STANDARD_CODON_TABLE: Record<string, string> = {
  ATA: 'I', ATC: 'I', ATT: 'I', ATG: 'M',
  ACA: 'T', ACC: 'T', ACG: 'T', ACT: 'T',
  AAC: 'N', AAT: 'N', AAA: 'K', AAG: 'K',
  AGC: 'S', AGT: 'S', AGA: 'R', AGG: 'R',
  CTA: 'L', CTC: 'L', CTG: 'L', CTT: 'L',
  CCA: 'P', CCC: 'P', CCG: 'P', CCT: 'P',
  CAC: 'H', CAT: 'H', CAA: 'Q', CAG: 'Q',
  CGA: 'R', CGC: 'R', CGG: 'R', CGT: 'R',
  GTA: 'V', GTC: 'V', GTG: 'V', GTT: 'V',
  GCA: 'A', GCC: 'A', GCG: 'A', GCT: 'A',
  GAC: 'D', GAT: 'D', GAA: 'E', GAG: 'E',
  GGA: 'G', GGC: 'G', GGG: 'G', GGT: 'G',
  TCA: 'S', TCC: 'S', TCG: 'S', TCT: 'S',
  TTC: 'F', TTT: 'F', TTA: 'L', TTG: 'L',
  TAC: 'Y', TAT: 'Y', TAA: '*', TAG: '*',
  TGC: 'C', TGT: 'C', TGA: '*', TGG: 'W'
};

export function translateCodon(codon: string): string {
  const clean = codon.toUpperCase().replace(/U/g, 'T');
  return STANDARD_CODON_TABLE[clean] || 'X';
}

export interface SlippageTranslationResult {
  fullProtein: string;
  preSlippageProtein: string;
  postSlippageProtein: string;
  slipperySitePosition: number;
  slipperySiteSequence: string;
  shiftApplied: number;
  stopsEncountered: number;
  visualAlignment: string;
}

export function simulateRibosomalSlippage(
  sequence: string,
  options: {
    startPosition: number;          // 1-based start codon index
    slipperySite: string;           // slippery site pattern (e.g., "TTTAAAC")
    shift: number;                  // -1, +1, etc.
    slipperySitePosition?: number;  // optional 1-based slippery site position override
  }
): SlippageTranslationResult {
  const seq = sequence.toUpperCase();
  const startIdx = options.startPosition - 1;
  const shift = options.shift;
  const slipPattern = options.slipperySite.toUpperCase().replace(/U/g, 'T');

  // 1. Locate the slippery site
  let slipIdx = -1;
  if (options.slipperySitePosition) {
    slipIdx = options.slipperySitePosition - 1;
  } else {
    // Automatically find first occurrence after startPosition
    slipIdx = seq.indexOf(slipPattern, startIdx);
    if (slipIdx === -1) {
      slipIdx = seq.indexOf(slipPattern);
    }
  }

  if (slipIdx === -1) {
    throw new Error(m.advSlipperySiteNotFound({ v1: options.slipperySite }));
  }

  // 2. Translate pre-slippage (in-frame translation up to slippery site)
  let preProtein = "";
  let currIdx = startIdx;
  
  while (currIdx + 3 <= slipIdx) {
    const codon = seq.substring(currIdx, currIdx + 3);
    const aa = translateCodon(codon);
    if (aa === '*') break;
    preProtein += aa;
    currIdx += 3;
  }

  // Translate slippery site in frame
  let preSlipAtSite = "";
  const slipCodonsCount = Math.floor(slipPattern.length / 3);
  let preSlipSiteEndIdx = currIdx;

  for (let i = 0; i < slipCodonsCount; i++) {
    const codon = seq.substring(currIdx, currIdx + 3);
    const aa = translateCodon(codon);
    preSlipAtSite += aa;
    currIdx += 3;
    preSlipSiteEndIdx = currIdx;
  }

  preProtein += preSlipAtSite;

  // 3. Apply the frameshift!
  const postSlippageStartIdx = preSlipSiteEndIdx + shift;
  let postProtein = "";
  let postIdx = postSlippageStartIdx;
  let stopsEncountered = 0;

  while (postIdx + 3 <= seq.length) {
    const codon = seq.substring(postIdx, postIdx + 3);
    const aa = translateCodon(codon);
    if (aa === '*') {
      stopsEncountered++;
      break;
    }
    postProtein += aa;
    postIdx += 3;
  }

  const fullProtein = preProtein + postProtein;

  // 4. Build a gorgeous visual alignment showing the shift junction
  const juncBeforeSeq = seq.substring(Math.max(0, preSlipSiteEndIdx - 15), preSlipSiteEndIdx);
  const juncAfterSeq = seq.substring(preSlipSiteEndIdx, Math.min(seq.length, preSlipSiteEndIdx + 15));
  
  const shiftedBeforeSeq = seq.substring(Math.max(0, postSlippageStartIdx - 15), postSlippageStartIdx);
  const shiftedAfterSeq = seq.substring(postSlippageStartIdx, Math.min(seq.length, postSlippageStartIdx + 15));

  const visualAlignment = [
    m.advSlipFrameOriginal({ v1: juncBeforeSeq, v2: juncAfterSeq }),
    `                    ` + ' '.repeat(juncBeforeSeq.length) + m.advSlipCutMark({ v1: preSlipSiteEndIdx }),
    m.advSlipFrameShifted({ v1: (shift > 0 ? '+' : '') + shift, v2: shiftedBeforeSeq, v3: shiftedAfterSeq }),
    `                    ` + ' '.repeat(shiftedBeforeSeq.length) + m.advSlipNewStartMark({ v1: postSlippageStartIdx }),
    m.advSlipJunctionAa({ v1: preSlipAtSite, v2: postProtein.substring(0, 5) })
  ].join('\n');

  return {
    fullProtein,
    preSlippageProtein: preProtein,
    postSlippageProtein: postProtein,
    slipperySitePosition: slipIdx + 1,
    slipperySiteSequence: seq.substring(slipIdx, slipIdx + slipPattern.length),
    shiftApplied: shift,
    stopsEncountered,
    visualAlignment
  };
}
