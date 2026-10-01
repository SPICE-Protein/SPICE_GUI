// Molecular cloning methods: Gibson, Golden Gate, In-Fusion, NEBuilder HiFi,
// Gateway, TOPO (directional + non-directional), TA/GC cloning.
//
// All methods operate on the SequenceData model from clone.ts and produce
// a ligation product with features and lineage annotations.

import type { SequenceData } from "./clone";
import { getReverseComplementSequenceString, getComplementSequenceString } from "./sequence";
import { cutSequenceByRestrictionEnzyme, type Cutsite, type RestrictionEnzyme, getEnzymeByName, enzymeFromSite } from "./enzymes";
import { getDigestFragmentsForCutsites } from "./digest";
import { tidyUpSequenceData } from "./model";
import * as m from "$lib/paraglide/messages.js";

export type CloningMethod =
  | "restriction"
  | "gibson"
  | "golden_gate"
  | "in_fusion"
  | "nebuilder_hifi"
  | "gateway"
  | "topo"
  | "topo_directional"
  | "ta"
  | "gc";

export interface CloningInput {
  vector: SequenceData;
  insert: SequenceData;
  method: CloningMethod;
  // Restriction cloning: enzyme names for left/right
  leftEnzyme?: string;
  rightEnzyme?: string;
  // Gibson/In-Fusion/NEBuilder: overlap length (default 20-40)
  overlapLength?: number;
  // Golden Gate: enzyme name (Type IIS)
  goldenGateEnzyme?: string;
  // Gateway: att site types
  attL1?: boolean;
  // TOPO: directional or not
  directional?: boolean;
  // Biophysical phosphorylation tracking
  vectorPhosphorLeft?: boolean;
  vectorPhosphorRight?: boolean;
  insertPhosphorLeft?: boolean;
  insertPhosphorRight?: boolean;
}

export interface CloningOutput {
  product: SequenceData;
  productName: string;
  insertStart: number;
  insertEnd: number;
  historyNode: {
    method: CloningMethod;
    productName: string;
    parentVector: string;
    insertName: string;
    timestamp: string;
    details: Record<string, unknown>;
  };
  warnings: string[];
}

function resolveEnzyme(name: string): RestrictionEnzyme | undefined {
  return getEnzymeByName(name) ?? enzymeFromSite(name, "", 0);
}

// ──────────────────────────────── Restriction Cloning ────────────────────────────────

export function simulateRestrictionCloning(input: CloningInput): CloningOutput {
  const warnings: string[] = [];

  // Biophysical check: T4 DNA Ligase 5'-phosphate requirement (Gap 1)
  const isVectorPhos = input.vectorPhosphorLeft !== false && input.vectorPhosphorRight !== false;
  const isInsertPhos = input.insertPhosphorLeft !== false && input.insertPhosphorRight !== false;
  if (!isVectorPhos && !isInsertPhos) {
    warnings.push(m.cmT4LigaseDephosWarning());
  }
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();
  const leftEnz = input.leftEnzyme || "EcoRI";
  const rightEnz = input.rightEnzyme || "BamHI";

  const leftE = resolveEnzyme(leftEnz);
  const rightE = resolveEnzyme(rightEnz);
  if (!leftE || !rightE) {
    return makeError(input, `Unknown enzyme: ${!leftE ? leftEnz : rightEnz}`, warnings);
  }

  const vCutsL = cutSequenceByRestrictionEnzyme(vSeq, !!input.vector.circular, leftE);
  const vCutsR = cutSequenceByRestrictionEnzyme(vSeq, !!input.vector.circular, rightE);
  const iCutsL = cutSequenceByRestrictionEnzyme(iSeq, !!input.insert.circular, leftE);
  const iCutsR = cutSequenceByRestrictionEnzyme(iSeq, !!input.insert.circular, rightE);

  if (!vCutsL.length) warnings.push(`Left enzyme ${leftEnz} not found in vector`);
  if (!vCutsR.length) warnings.push(`Right enzyme ${rightEnz} not found in vector`);
  if (!iCutsL.length) warnings.push(`Left enzyme ${leftEnz} not found in insert`);
  if (!iCutsR.length) warnings.push(`Right enzyme ${rightEnz} not found in insert`);

  if (!vCutsL.length || !vCutsR.length || !iCutsL.length || !iCutsR.length) {
    return makeError(input, "Enzyme sites missing in vector or insert", warnings);
  }

  const vLeft = vCutsL[0];
  const vRight = vCutsR[0];
  const iLeft = iCutsL[0];
  const iRight = iCutsR[0];

  const vLeftClip = vLeft.topSnipPosition;
  const vRightClip = vRight.topSnipPosition;
  const iLeftClip = iLeft.topSnipPosition;
  const iRightClip = iRight.topSnipPosition;

  const vecLeft = vSeq.slice(0, Math.min(vLeftClip, vRightClip));
  const vecRight = vSeq.slice(Math.max(vLeftClip, vRightClip));
  const insFrag = iSeq.slice(Math.min(iLeftClip, iRightClip), Math.max(iLeftClip, iRightClip));

  const productSeq = vecLeft + insFrag + vecRight;
  const productName = `${input.vector.name || "Vector"}_cloned_${input.insert.name || "Insert"}`;
  const insertStart = vecLeft.length;
  const insertEnd = insertStart + insFrag.length - 1;

  const features = [
    ...(input.vector.features as any[] || []).filter((f: any) => {
      const s = f.start ?? 0;
      return s < Math.min(vLeftClip, vRightClip) || (f.end ?? 0) > Math.max(vLeftClip, vRightClip);
    }).map((f: any) => ({
      ...f,
      start: (f.start ?? 0) >= Math.max(vLeftClip, vRightClip)
        ? (f.start as number) - Math.max(vLeftClip, vRightClip) + vecLeft.length + insFrag.length
        : f.start,
      end: (f.end ?? 0) >= Math.max(vLeftClip, vRightClip)
        ? (f.end as number) - Math.max(vLeftClip, vRightClip) + vecLeft.length + insFrag.length
        : f.end,
    })),
    {
      id: Date.now(),
      name: input.insert.name || "Insert",
      type: "CDS",
      start: insertStart,
      end: insertEnd,
      forward: true,
    },
  ];

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features,
    name: productName,
    circular: !!input.vector.circular,
  });

  return {
    product,
    productName,
    insertStart,
    insertEnd,
    historyNode: {
      method: "restriction",
      productName,
      parentVector: input.vector.name || "Vector",
      insertName: input.insert.name || "Insert",
      timestamp: new Date().toISOString(),
      details: { leftEnzyme: leftEnz, rightEnzyme: rightEnz, insertSize: insFrag.length },
    },
    warnings,
  };
}

// ──────────────────────────────── Gibson / In-Fusion / NEBuilder HiFi ────────────────────────────────
// All three are overlap-based assembly methods. Gibson uses T5 exonuclease +
// Phusion + Taq ligase; In-Fusion and NEBuilder HiFi are commercial variants
// with the same basic logic: fragments share terminal homology overlaps.

export function simulateGibsonAssembly(input: CloningInput): CloningOutput {
  const overlapLen = input.overlapLength ?? 25;
  return simulateOverlapAssembly(input, overlapLen, "gibson");
}

export function simulateInFusionCloning(input: CloningInput): CloningOutput {
  const overlapLen = input.overlapLength ?? 15;
  return simulateOverlapAssembly(input, overlapLen, "in_fusion");
}

export function simulateNEBuilderHiFi(input: CloningInput): CloningOutput {
  const overlapLen = input.overlapLength ?? 20;
  return simulateOverlapAssembly(input, overlapLen, "nebuilder_hifi");
}

function simulateOverlapAssembly(
  input: CloningInput,
  overlapLen: number,
  method: CloningMethod
): CloningOutput {
  const warnings: string[] = [];
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();

  // For a circular vector, the "linear" form is the vector itself.
  // The insert needs overlaps with the vector at both ends.
  // Vector 3' end overlap = last N bases of vector
  // Vector 5' start overlap = first N bases of vector (for circular)

  const vEndOverlap = vSeq.slice(-overlapLen);
  const vStartOverlap = vSeq.slice(0, overlapLen);

  // Check if insert starts with the vector end overlap
  const insertStartMatch = iSeq.startsWith(vEndOverlap) || 
    iSeq.slice(0, overlapLen) === vEndOverlap;
  // Check if insert ends with the vector start overlap (or its reverse complement)
  const insertEndMatch = iSeq.slice(-overlapLen) === vStartOverlap ||
    getReverseComplementSequenceString(iSeq.slice(-overlapLen)) === vStartOverlap;

  if (!insertStartMatch) {
    warnings.push(`Insert 5' end does not share ${overlapLen}bp homology with vector 3' end`);
  }
  if (!insertEndMatch) {
    warnings.push(`Insert 3' end does not share ${overlapLen}bp homology with vector 5' start`);
  }

  // For Gibson, we join: vector_body + insert (minus overlaps) + (circular: already overlaps)
  // Simplified: vector body (minus terminal overlaps already in insert) + insert
  const vecBody = vSeq.slice(overlapLen, -overlapLen) || vSeq;
  // Remove duplicate overlap from insert ends
  let insertBody = iSeq;
  if (insertStartMatch) insertBody = insertBody.slice(overlapLen);
  if (insertEndMatch) insertBody = insertBody.slice(0, -overlapLen);

  // Circular assembly: vector_start_overlap + vecBody + insertBody + vector_end_overlap
  // = vStartOverlap + vecBody + insertBody + vEndOverlap (and it's circular)
  const productSeq = vStartOverlap + vecBody + insertBody + vEndOverlap;

  const productName = `${input.vector.name || "Vector"}_gibson_${input.insert.name || "Insert"}`;
  const insertStart = vStartOverlap.length + vecBody.length;
  const insertEnd = insertStart + insertBody.length - 1;

  const features = [
    ...(input.vector.features as any[] || []).map((f: any) => ({ ...f })),
    {
      id: Date.now(),
      name: input.insert.name || "Insert",
      type: "CDS",
      start: insertStart,
      end: insertEnd,
      forward: true,
    },
  ];

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features,
    name: productName,
    circular: true,
  });

  return {
    product,
    productName,
    insertStart,
    insertEnd,
    historyNode: {
      method,
      productName,
      parentVector: input.vector.name || "Vector",
      insertName: input.insert.name || "Insert",
      timestamp: new Date().toISOString(),
      details: { overlapLength: overlapLen, insertSize: insertBody.length },
    },
    warnings,
  };
}

// ──────────────────────────────── Golden Gate Assembly ────────────────────────────────

export function simulateGoldenGateAssembly(input: CloningInput): CloningOutput {
  const warnings: string[] = [];
  const enzymeName = input.goldenGateEnzyme || "BsaI";
  const enzyme = resolveEnzyme(enzymeName);

  if (!enzyme) {
    return makeError(input, `Unknown Type IIS enzyme: ${enzymeName}`, warnings);
  }

  // Type IIS enzymes cut outside their recognition site.
  // Golden Gate: cut vector and insert with the same Type IIS enzyme,
  // producing 4bp overhangs. Ligate fragments with compatible overhangs.
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();

  const vCuts = cutSequenceByRestrictionEnzyme(vSeq, !!input.vector.circular, enzyme);
  const iCuts = cutSequenceByRestrictionEnzyme(iSeq, !!input.insert.circular, enzyme);

  if (vCuts.length < 2) {
    warnings.push(`Vector has ${vCuts.length} ${enzymeName} sites (need >= 2)`);
  }
  if (iCuts.length < 2) {
    warnings.push(`Insert has ${iCuts.length} ${enzymeName} sites (need >= 2)`);
  }

  if (vCuts.length < 2 || iCuts.length < 2) {
    return makeError(input, `Insufficient ${enzymeName} sites`, warnings);
  }

  // Use first two cutsites for vector, first two for insert
  const vCut1 = vCuts[0];
  const vCut2 = vCuts[1];
  const iCut1 = iCuts[0];
  const iCut2 = iCuts[1];

  // Extract the fragment between the two cutsites
  const vStart = Math.min(vCut1.topSnipPosition, vCut2.topSnipPosition);
  const vEnd = Math.max(vCut1.topSnipPosition, vCut2.topSnipPosition);

  const iStart = Math.min(iCut1.topSnipPosition, iCut2.topSnipPosition);
  const iEnd = Math.max(iCut1.topSnipPosition, iCut2.topSnipPosition);

  // Vector backbone = everything except the fragment between cuts
  const vecBackbone = vSeq.slice(0, vStart) + vSeq.slice(vEnd);
  // Insert fragment = between cuts
  const insertFrag = iSeq.slice(iStart, iEnd);

  const productSeq = vecBackbone.slice(0, vStart) + insertFrag + vecBackbone.slice(vStart);
  const productName = `${input.vector.name || "Vector"}_goldengate_${input.insert.name || "Insert"}`;
  const insertStart = vStart;
  const insertEnd = insertStart + insertFrag.length - 1;

  const features = [
    ...(input.vector.features as any[] || []).map((f: any) => ({ ...f })),
    {
      id: Date.now(),
      name: input.insert.name || "Insert",
      type: "CDS",
      start: insertStart,
      end: insertEnd,
      forward: true,
    },
  ];

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features,
    name: productName,
    circular: !!input.vector.circular,
  });

  return {
    product,
    productName,
    insertStart,
    insertEnd,
    historyNode: {
      method: "golden_gate",
      productName,
      parentVector: input.vector.name || "Vector",
      insertName: input.insert.name || "Insert",
      timestamp: new Date().toISOString(),
      details: { enzyme: enzymeName, insertSize: insertFrag.length },
    },
    warnings,
  };
}

// ──────────────────────────────── Gateway Cloning ────────────────────────────────
// Uses BP/LR clonase with att sites. attP x attB -> attL + attR (BP),
// attL x attR -> attB + attP (LR).

const ATT_SITES: Record<string, { core: string; arm: string }> = {
  attB1: { core: "CAACTTGT", arm: "GCTTTTTTGTAC" },
  attB2: { core: "CAACTTGT", arm: "GTTTAATAC" },
  attL1: { core: "CAACTTGT", arm: "CAACTTCT" },
  attL2: { core: "CAACTTGT", arm: "TATAAT" },
  attP1: { core: "CAACTTGT", arm: "GCTTTTTTGTAC" },
  attP2: { core: "CAACTTGT", arm: "GTTTAATAC" },
};

export function simulateGatewayCloning(input: CloningInput): CloningOutput {
  const warnings: string[] = [];
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();

  // Find att sites in vector and insert
  const attB1 = "GCTTTTTTGTACAAAAAAGCAGGCT";
  const attB2 = "ACCCACTTTGTACAAGAAAGCTGGG";
  const attP1 = "AAAATAACGCGGCCCAGTC" ;
  const attP2 = "TACCCACTTTGTACAAGAAAGCTG";

  const vB1Idx = vSeq.indexOf(attB1) >= 0 ? vSeq.indexOf(attB1) : vSeq.indexOf(attP1);
  const vB2Idx = vSeq.indexOf(attB2) >= 0 ? vSeq.indexOf(attB2) : vSeq.indexOf(attP2);
  const iB1Idx = iSeq.indexOf(attB1) >= 0 ? iSeq.indexOf(attB1) : iSeq.indexOf(attP1);
  const iB2Idx = iSeq.indexOf(attB2) >= 0 ? iSeq.indexOf(attB2) : iSeq.indexOf(attP2);

  if (vB1Idx < 0) warnings.push("attB1/attP1 not found in vector");
  if (vB2Idx < 0) warnings.push("attB2/attP2 not found in vector");
  if (iB1Idx < 0) warnings.push("attB1/attP1 not found in insert");
  if (iB2Idx < 0) warnings.push("attB2/attP2 not found in insert");

  if (vB1Idx < 0 || vB2Idx < 0 || iB1Idx < 0 || iB2Idx < 0) {
    // Fallback: simple concat with attL linkers
    const attL1 = "CAACTTGTATATAAAGTTG";
    const attL2 = "ACCCAGCTTTCTTGTACAAAGTGG";
    const productSeq = vSeq + attL1 + iSeq + attL2;
    const productName = `${input.vector.name || "Vector"}_gateway_${input.insert.name || "Insert"}`;
    const insertStart = vSeq.length + attL1.length;
    const insertEnd = insertStart + iSeq.length - 1;
    const product = tidyUpSequenceData({
      ...input.vector,
      sequence: productSeq,
      features: [
        ...(input.vector.features as any[] || []),
        { id: Date.now(), name: input.insert.name || "Insert", type: "CDS", start: insertStart, end: insertEnd, forward: true },
      ],
      name: productName,
      circular: !!input.vector.circular,
    });
    return {
      product, productName, insertStart, insertEnd,
      historyNode: { method: "gateway", productName, parentVector: input.vector.name || "Vector", insertName: input.insert.name || "Insert", timestamp: new Date().toISOString(), details: { bpClonase: true, fallback: true } },
      warnings,
    };
  }

  // Standard recombination: insert goes between att sites in vector
  const vStart = Math.min(vB1Idx, vB2Idx);
  const vEnd = Math.max(vB1Idx, vB2Idx) + 25; // att site length
  const iStart = Math.min(iB1Idx, iB2Idx);
  const iEnd = Math.max(iB1Idx, iB2Idx);

  const vecLeft = vSeq.slice(0, vStart);
  const vecRight = vSeq.slice(vEnd);
  const insertFrag = iSeq.slice(iStart, iEnd);

  const productSeq = vecLeft + insertFrag + vecRight;
  const productName = `${input.vector.name || "Vector"}_gateway_${input.insert.name || "Insert"}`;
  const insertStart = vecLeft.length;
  const insertEnd = insertStart + insertFrag.length - 1;

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features: [
      ...(input.vector.features as any[] || []),
      { id: Date.now(), name: input.insert.name || "Insert", type: "CDS", start: insertStart, end: insertEnd, forward: true },
    ],
    name: productName,
    circular: !!input.vector.circular,
  });

  return {
    product, productName, insertStart, insertEnd,
    historyNode: { method: "gateway", productName, parentVector: input.vector.name || "Vector", insertName: input.insert.name || "Insert", timestamp: new Date().toISOString(), details: { bpClonase: true } },
    warnings,
  };
}

// ──────────────────────────────── TOPO / TA / GC Cloning ────────────────────────────────

export function simulateTOPOCloning(input: CloningInput): CloningOutput {
  // TOPO: insert has blunt ends, vector has topoisomerase-linked ends.
  // Directional TOPO uses CACC 5' overhang on the insert.
  const warnings: string[] = [];
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();
  const directional = input.directional !== false;

  if (directional && !iSeq.startsWith("CACC")) {
    warnings.push("Directional TOPO requires 5' CACC overhang on insert");
  }

  // Find TOPO cloning site in vector (GTGG or CACC)
  const topoSite = directional ? "GTGG" : "GTTT";
  let topoIdx = vSeq.indexOf(topoSite);
  if (topoIdx < 0) {
    // If no site found, just concat
    topoIdx = vSeq.length;
    warnings.push(`TOPO site (${topoSite}) not found in vector, appending insert`);
  }

  const productSeq = vSeq.slice(0, topoIdx) + iSeq + vSeq.slice(topoIdx);
  const productName = `${input.vector.name || "Vector"}_topo_${input.insert.name || "Insert"}`;
  const insertStart = topoIdx;
  const insertEnd = insertStart + iSeq.length - 1;

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features: [
      ...(input.vector.features as any[] || []),
      { id: Date.now(), name: input.insert.name || "Insert", type: "CDS", start: insertStart, end: insertEnd, forward: true },
    ],
    name: productName,
    circular: !!input.vector.circular,
  });

  return {
    product, productName, insertStart, insertEnd,
    historyNode: { method: directional ? "topo_directional" : "topo", productName, parentVector: input.vector.name || "Vector", insertName: input.insert.name || "Insert", timestamp: new Date().toISOString(), details: { directional, insertSize: iSeq.length } },
    warnings,
  };
}

export function simulateTACloning(input: CloningInput): CloningOutput {
  // TA cloning: vector has 3' T overhang, insert has 3' A overhang (from Taq polymerase)
  const warnings: string[] = [];
  const vSeq = input.vector.sequence.toUpperCase();
  const iSeq = input.insert.sequence.toUpperCase();

  // Ensure insert has A-tail (simplified: just insert between T overhangs)
  // Vector has ...T---T... (linear with T overhangs)
  // Find T overhang site or just use end of vector
  const productSeq = vSeq + iSeq;
  const productName = `${input.vector.name || "Vector"}_TA_${input.insert.name || "Insert"}`;
  const insertStart = vSeq.length;
  const insertEnd = insertStart + iSeq.length - 1;

  const product = tidyUpSequenceData({
    ...input.vector,
    sequence: productSeq,
    features: [
      ...(input.vector.features as any[] || []),
      { id: Date.now(), name: input.insert.name || "Insert", type: "CDS", start: insertStart, end: insertEnd, forward: true },
    ],
    name: productName,
    circular: !!input.vector.circular,
  });

  return {
    product, productName, insertStart, insertEnd,
    historyNode: { method: "ta", productName, parentVector: input.vector.name || "Vector", insertName: input.insert.name || "Insert", timestamp: new Date().toISOString(), details: { insertSize: iSeq.length } },
    warnings,
  };
}

export function simulateGCCloning(input: CloningInput): CloningOutput {
  // GC cloning: blunt-end ligation (no overhangs needed)
  return simulateTACloning({ ...input, method: "gc" });
}

// ──────────────────────────────── Dispatch ────────────────────────────────

export function simulateCloning(input: CloningInput): CloningOutput {
  switch (input.method) {
    case "restriction": return simulateRestrictionCloning(input);
    case "gibson": return simulateGibsonAssembly(input);
    case "golden_gate": return simulateGoldenGateAssembly(input);
    case "in_fusion": return simulateInFusionCloning(input);
    case "nebuilder_hifi": return simulateNEBuilderHiFi(input);
    case "gateway": return simulateGatewayCloning(input);
    case "topo": return simulateTOPOCloning({ ...input, directional: false });
    case "topo_directional": return simulateTOPOCloning({ ...input, directional: true });
    case "ta": return simulateTACloning(input);
    case "gc": return simulateGCCloning(input);
    default: return makeError(input, `Unknown method: ${input.method}`, []);
  }
}

function makeError(input: CloningInput, msg: string, warnings: string[]): CloningOutput {
  return {
    product: tidyUpSequenceData(input.vector),
    productName: input.vector.name || "Error",
    insertStart: 0,
    insertEnd: 0,
    historyNode: {
      method: input.method,
      productName: "Error",
      parentVector: input.vector.name || "Vector",
      insertName: input.insert.name || "Insert",
      timestamp: new Date().toISOString(),
      details: { error: msg },
    },
    warnings: [...warnings, msg],
  };
}
