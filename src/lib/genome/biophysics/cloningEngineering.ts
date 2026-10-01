/**
 * SPICE Cloning & Molecular Engineering Extension Module (Features 15-18)
 * 
 * Provides:
 * 15. Recombinase Cloning simulation (Cre-loxP, FLP-FRT, phiC31)
 * 16. Simple Sequence Repeat (SSR) marker flanking primer design
 * 17. Allele-specific SNP Genotyping primer design (KASP/TaqMan)
 * 18. Restriction Fragment Length Polymorphism (RFLP) fragment simulation
 */

import { getReverseComplementSequenceString } from "../sequence";
import { calculatePrimerTm } from "./primersLims";
import { detectTandemRepeats } from "./genomics";
import * as m from "$lib/paraglide/messages.js";

// ──────────────────────────────── 15: Recombinase Cloning ────────────────────────────────

export interface RecombinaseResult {
  productSequence: string;
  reactionType: "excision" | "integration" | "inversion" | "no_reaction";
  log: string[];
}

const SITE_LOXP = "ATAACTTCGTATAATGTATGCTATACGAAGTTAT"; // 34bp
const SITE_FRT = "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC";  // 34bp

/**
 * Simulates site-specific recombinase cloning.
 * Recognizes loxP or FRT target sites, computes orientations, and resolves
 * excision, integration, or inversion reaction products.
 */
export function simulateRecombinaseCloning(
  vectorSeq: string,
  insertSeq: string,
  system: "Cre-lox" | "FLP-FRT"
): RecombinaseResult {
  const vSeq = vectorSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const insSeq = insertSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const sitePattern = system === "Cre-lox" ? SITE_LOXP : SITE_FRT;
  const siteLen = sitePattern.length;
  const log: string[] = [];

  // Find sites in vector
  const vSite1 = vSeq.indexOf(sitePattern);
  const vSite2 = vSeq.indexOf(sitePattern, vSite1 + 1);

  // If vector has two sites, check for excision or inversion
  if (vSite1 !== -1 && vSite2 !== -1) {
    // Check orientation: search for normal and reverse complement
    const siteRc = getReverseComplementSequenceString(sitePattern);
    const site2IsRc = vSeq.slice(vSite2, vSite2 + siteLen) === siteRc || vSeq.indexOf(siteRc) === vSite2;

    if (site2IsRc) {
      // Inversion: regions between sites get inverted
      const prefix = vSeq.slice(0, vSite1 + siteLen);
      const middle = vSeq.slice(vSite1 + siteLen, vSite2);
      const suffix = vSeq.slice(vSite2);
      const invertedMiddle = getReverseComplementSequenceString(middle);
      
      log.push(m.ceInversion({ v1: system }));
      
      return {
        productSequence: prefix + invertedMiddle + suffix,
        reactionType: "inversion",
        log
      };
    } else {
      // Excision: region between sites gets excised
      const prefix = vSeq.slice(0, vSite1 + siteLen);
      const suffix = vSeq.slice(vSite2 + siteLen);
      
      log.push(m.ceExcision({ v1: system, v2: vSite2 - vSite1 }));
      
      return {
        productSequence: prefix + suffix,
        reactionType: "excision",
        log
      };
    }
  }

  // Integration: Vector has 1 site and Insert has 1 site
  const insSite = insSeq.indexOf(sitePattern);
  if (vSite1 !== -1 && insSite !== -1) {
    // Integrate insert into vector site
    const prefix = vSeq.slice(0, vSite1 + siteLen);
    const suffix = vSeq.slice(vSite1 + siteLen);
    
    // Insert gets integrated
    const integrated = prefix + insSeq.slice(insSite + siteLen) + insSeq.slice(0, insSite + siteLen) + suffix;
    
    log.push(m.ceIntegration({ v1: system }));
    
    return {
      productSequence: integrated,
      reactionType: "integration",
      log
    };
  }

  log.push(m.ceNoReaction({ v1: system }));
  return {
    productSequence: vectorSeq,
    reactionType: "no_reaction",
    log
  };
}

// ──────────────────────────────── 16: SSR Marker Primer Design ────────────────────────────────

export interface SsrMarker {
  repeatPattern: string;
  repeatCount: number;
  start: number; // 1-based
  end: number;
  forwardPrimer: string;
  reversePrimer: string;
  productSize: number;
  tm: number;
}

/**
 * Automatically scans genomic sequences for SSRs (Simple Sequence Repeats / microsatellites) 
 * and designs flanking genotyping primers.
 */
export function designSsrMarkers(dnaSeq: string): SsrMarker[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const repeats = detectTandemRepeats(seq);
  const markers: SsrMarker[] = [];

  for (const rep of repeats) {
    // Left flanking region for Forward primer
    const leftRegion = seq.slice(Math.max(0, rep.start - 100), rep.start);
    // Right flanking region for Reverse primer (need to design from reverse complement)
    const rightRegion = seq.slice(rep.end + 1, Math.min(seq.length, rep.end + 101));

    if (leftRegion.length < 25 || rightRegion.length < 25) continue;

    // Design primer from left flanking region (Forward)
    // We aim for primer length 18-22bp, Tm 55-60°C
    let forwardPrimer = "";
    for (let len = 18; len <= 22; len++) {
      const candidate = leftRegion.slice(leftRegion.length - len);
      const tm = calculatePrimerTm(candidate);
      if (tm >= 54 && tm <= 62) {
        forwardPrimer = candidate;
        break;
      }
    }
    if (!forwardPrimer) forwardPrimer = leftRegion.slice(leftRegion.length - 20);

    // Design primer from right flanking region (Reverse)
    let reversePrimer = "";
    const rightRc = getReverseComplementSequenceString(rightRegion);
    for (let len = 18; len <= 22; len++) {
      const candidate = rightRc.slice(rightRc.length - len);
      const tm = calculatePrimerTm(candidate);
      if (tm >= 54 && tm <= 62) {
        reversePrimer = candidate;
        break;
      }
    }
    if (!reversePrimer) reversePrimer = rightRc.slice(rightRc.length - 20);

    // Product size = repeat length + flanking lengths inside primers
    const fIdx = seq.indexOf(forwardPrimer);
    const rIdx = seq.indexOf(getReverseComplementSequenceString(reversePrimer));
    const productSize = rIdx !== -1 && fIdx !== -1 ? (rIdx + reversePrimer.length - fIdx) : 0;

    markers.push({
      repeatPattern: rep.pattern,
      repeatCount: rep.repeatCount,
      start: rep.start + 1,
      end: rep.end + 1,
      forwardPrimer,
      reversePrimer,
      productSize,
      tm: Math.round(calculatePrimerTm(forwardPrimer))
    });
  }

  return markers;
}

// ──────────────────────────────── 17: SNP Genotyping Primer Design (KASP/TaqMan) ────────────────────────────────

export interface KaspPrimerSet {
  allele1Forward: string; // FAM tail + allele 1 base
  allele2Forward: string; // HEX tail + allele 2 base
  commonReverse: string;
  tm: number;
}

export interface TaqManPrimerProbeSet {
  forwardPrimer: string;
  reversePrimer: string;
  probeAllele1: string; // FAM reporter + quencher
  probeAllele2: string; // VIC reporter + quencher
}

/**
 * Designs specific genotyping primers for a target SNP locus.
 * Supports:
 * - KASP (Kompetitive Allele Specific PCR)
 * - TaqMan (probe-based PCR assays)
 */
export function designSnpGenotypingPrimers(
  dnaSeq: string,
  snpIndex: number, // 0-based
  allele1: string, // e.g. "C"
  allele2: string  // e.g. "T"
): {
  kasp: KaspPrimerSet;
  taqman: TaqManPrimerProbeSet;
  log: string[];
} {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const log: string[] = [];

  const FAM_TAIL = "GAAGGTGACCAAGTTCATGCT"; // Standard KASP FAM tail
  const HEX_TAIL = "GAAGGTCGGTCAAGCGACTGC"; // Standard KASP HEX tail

  // 1. KASP design: primers end exactly at the SNP base (3' end)
  // Forward primers must end with SNP base
  const upstreamFlank = seq.slice(Math.max(0, snpIndex - 25), snpIndex);
  
  // Allele 1 Forward primer
  const f1 = upstreamFlank.slice(upstreamFlank.length - 20) + allele1;
  const kaspF1 = FAM_TAIL + f1;

  // Allele 2 Forward primer
  const f2 = upstreamFlank.slice(upstreamFlank.length - 20) + allele2;
  const kaspF2 = HEX_TAIL + f2;

  // Common Reverse: designed from downstream flank (reverse complement)
  const downstreamFlank = seq.slice(snpIndex + 1, Math.min(seq.length, snpIndex + 100));
  const rcDownstream = getReverseComplementSequenceString(downstreamFlank);
  const commonRev = rcDownstream.slice(rcDownstream.length - 20);

  log.push(m.ceKaspDesign({ v1: allele1, v2: allele2 }));

  // 2. TaqMan design: Primers flank the SNP site, TaqMan probes are allele-specific and lie over the SNP
  const fPrimer = seq.slice(Math.max(0, snpIndex - 60), snpIndex - 40);
  const rPrimer = getReverseComplementSequenceString(seq.slice(snpIndex + 40, Math.min(seq.length, snpIndex + 60)));

  // Probes overlap the SNP (usually length 13-18 bp with MGB, or 18-25 bp standard)
  const probeRegionLeft = seq.slice(snpIndex - 10, snpIndex);
  const probeRegionRight = seq.slice(snpIndex + 1, snpIndex + 10);
  
  const probe1 = `5'-[FAM]-` + probeRegionLeft + allele1 + probeRegionRight + `-[BHQ1]-3'`;
  const probe2 = `5'-[VIC]-` + probeRegionLeft + allele2 + probeRegionRight + `-[BHQ1]-3'`;

  log.push(m.ceTaqManDesign({ v1: allele1, v2: allele2 }));

  return {
    kasp: {
      allele1Forward: kaspF1,
      allele2Forward: kaspF2,
      commonReverse: commonRev,
      tm: Math.round(calculatePrimerTm(f1))
    },
    taqman: {
      forwardPrimer: fPrimer,
      reversePrimer: rPrimer,
      probeAllele1: probe1,
      probeAllele2: probe2
    },
    log
  };
}

// ──────────────────────────────── 18: RFLP Analysis ────────────────────────────────

export interface RflpDigestPattern {
  genotype: string;
  fragments: number[];
}

/**
 * Predicts and simulates RFLP patterns for Wild-Type vs Mutant DNA.
 * Identifies restriction enzymes whose cleavage sites are disrupted or introduced by the mutation.
 */
export function analyzeRflp(
  wildTypeSeq: string,
  mutantSeq: string,
  enzyme: { name: string; site: string }
): {
  enzymeUsed: string;
  cleavageInWt: number[];
  cleavageInMut: number[];
  fragmentsWt: number[];
  fragmentsMut: number[];
  fragmentsHet: number[]; // Heterozygous pattern (mix of WT + Mutant fragments)
  isDiscriminative: boolean;
} {
  const wt = wildTypeSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const mut = mutantSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const site = enzyme.site.toUpperCase();

  // Find cut positions
  function getCuts(sequence: string): number[] {
    const cuts: number[] = [];
    let pos = sequence.indexOf(site);
    while (pos !== -1) {
      cuts.push(pos + Math.floor(site.length / 2)); // rough cleavage point
      pos = sequence.indexOf(site, pos + 1);
    }
    return cuts;
  }

  const cutsWt = getCuts(wt);
  const cutsMut = getCuts(mut);

  // Compute fragment sizes
  function getFragments(sequence: string, cuts: number[]): number[] {
    const sortedCuts = [0, ...cuts, sequence.length].sort((a, b) => a - b);
    const frags: number[] = [];
    for (let i = 0; i < sortedCuts.length - 1; i++) {
      const len = sortedCuts[i + 1] - sortedCuts[i];
      if (len > 0) frags.push(len);
    }
    return frags.sort((a, b) => b - a); // largest first for gel view
  }

  const fragsWt = getFragments(wt, cutsWt);
  const fragsMut = getFragments(mut, cutsMut);

  // Heterozygous pattern contains all fragments from both WT and Mutant
  const fragsHet = Array.from(new Set([...fragsWt, ...fragsMut])).sort((a, b) => b - a);

  const isDiscriminative = cutsWt.length !== cutsMut.length;

  return {
    enzymeUsed: enzyme.name,
    cleavageInWt: cutsWt,
    cleavageInMut: cutsMut,
    fragmentsWt: fragsWt,
    fragmentsMut: fragsMut,
    fragmentsHet: fragsHet,
    isDiscriminative
  };
}
