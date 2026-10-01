/**
 * SPICE Synthetic Biology CAD Module (Feature G)
 * 
 * Provides genetic circuit logic topology extraction, BioBrick compliance, 
 * MoClo Level-dependent assembly checks, cell transformation estimators, 
 * and standard SBOL 2.0 RDF/XML exports.
 */

import * as m from "$lib/paraglide/messages.js";
export interface GeneticCircuitGate {
  id: string;
  gateType: "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "INPUT";
  promoters: string[];
  outputCdsName: string;
  inputs: string[];
  status: string;
}

/**
 * Evaluates promoter-CDS combinations to identify logic circuit gate topologies.
 */
export function analyzeGeneticCircuits(features: { name: string; type: string; start: number; end: number }[]): GeneticCircuitGate[] {
  const sorted = [...features].sort((a, b) => a.start - b.start);
  const gates: GeneticCircuitGate[] = [];
  let gateIdx = 1;

  for (let i = 0; i < sorted.length - 1; i++) {
    const feat = sorted[i];
    
    // LacI repressor -> TetR logic
    if (feat.type === "promoter" && feat.name.toLowerCase().includes("lac")) {
      const nextCds = sorted.find(f => f.type === "cds" && f.start > feat.end);
      if (nextCds && nextCds.name.toLowerCase().includes("tetr")) {
        gates.push({
          id: `gate_${gateIdx++}`,
          gateType: "NOT",
          promoters: [feat.name],
          outputCdsName: nextCds.name,
          inputs: ["IPTG"],
          status: m.sbGateLacActive()
        });
      }
    }
    
    // General Inducible systems
    if (feat.type === "promoter") {
      const nextCds = sorted.find(f => f.type === "cds" && f.start > feat.end && f.start - feat.end < 200);
      if (nextCds) {
        gates.push({
          id: `gate_${gateIdx++}`,
          gateType: "INPUT",
          promoters: [feat.name],
          outputCdsName: nextCds.name,
          inputs: ["RNAPol"],
          status: m.sbGateCascade({ v1: feat.name, v2: nextCds.name })
        });
      }
    }
  }

  return gates;
}

/**
 * Checks compliance with BioBrick RFC 10 cloning constraints.
 * DNA sequences must not contain internal EcoRI, XbaI, SpeI, or PstI sites.
 */
export function checkBioBrickCompatibility(dnaSeq: string): {
  compatible: boolean;
  matchingSites: { enzyme: string; pos: number; sequence: string }[];
} {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const BIOBRICKS = [
    { enzyme: "EcoRI", seq: "GAATTC" },
    { enzyme: "XbaI", seq: "TCTAGA" },
    { enzyme: "SpeI", seq: "ACTAGA" },
    { enzyme: "PstI", seq: "CTGCAG" }
  ];

  const matchingSites: { enzyme: string; pos: number; sequence: string }[] = [];

  for (const b of BIOBRICKS) {
    let pos = seq.indexOf(b.seq);
    while (pos !== -1) {
      matchingSites.push({
        enzyme: b.enzyme,
        pos,
        sequence: b.seq
      });
      pos = seq.indexOf(b.seq, pos + 1);
    }
  }

  return {
    compatible: matchingSites.length === 0,
    matchingSites
  };
}

/**
 * Verifies Golden Gate MoClo standard assembly overhang standards.
 */
export function verifyMoCloAssembly(options: {
  vectorLeftOverhang: string;  // 4bp
  vectorRightOverhang: string; // 4bp
  insertLeftOverhang: string;  // 4bp
  insertRightOverhang: string; // 4bp
}): { compatible: boolean; level: string; errors: string[] } {
  const vl = options.vectorLeftOverhang.toUpperCase();
  const vr = options.vectorRightOverhang.toUpperCase();
  const il = options.insertLeftOverhang.toUpperCase();
  const ir = options.insertRightOverhang.toUpperCase();

  const errors: string[] = [];

  if (vl !== il) {
    errors.push(m.sbMocloLeftFail({ v1: vl, v2: il }));
  }
  if (vr !== ir) {
    errors.push(m.sbMocloRightFail({ v1: vr, v2: ir }));
  }

  let level = m.sbMocloCustomLevel();
  if (vl === "GGAG" && vr === "CGCT") {
    level = m.sbMocloLevelAlpha();
  } else if (vl === "GGAG" && vr === "AATG") {
    level = m.sbMocloLevelPromoter();
  } else if (vl === "AATG" && vr === "GCTT") {
    level = m.sbMocloLevelCds();
  } else if (vl === "GCTT" && vr === "CGCT") {
    level = m.sbMocloLevelTerminator();
  } else if (vl === "TGCC" && vr === "GCAA") {
    level = m.sbMocloLevelBeta();
  }

  return {
    compatible: errors.length === 0,
    level,
    errors
  };
}

/**
 * Estimates cell transformation efficiency based on plasmid biophysical constraints.
 */
export function estimateTransformationEfficiency(options: {
  method: "chemical" | "electroporation";
  dnaSizeBp: number;
  quality: "supercoiled" | "ligation_product";
}): { efficiency: number; colonyEstimate: number } {
  let baseEff = options.method === "electroporation" ? 1e9 : 1e7;
  
  if (options.quality === "ligation_product") {
    baseEff *= 0.01;
  }

  const sizeKb = options.dnaSizeBp / 1000;
  const sizeFactor = Math.exp(-0.25 * Math.max(0, sizeKb - 3)); 
  
  const finalEfficiency = Math.round(baseEff * sizeFactor);
  const colonyEstimate = Math.round(finalEfficiency * 0.01); // 10ng load

  return {
    efficiency: finalEfficiency,
    colonyEstimate
  };
}

/**
 * Exports plasmid sequences and annotated elements into Synthetic Biology Open Language (SBOL 2.0).
 */
export function exportToSBOL(
  plasmidName: string, 
  seq: string, 
  features: { name: string; type: string; start: number; end: number }[]
): string {
  const cleanName = plasmidName.replace(/\s+/g, "_");
  const sbolArr = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v2#" xmlns:dcterms="http://purl.org/dc/terms/">`,
    `  <sbol:ComponentDefinition rdf:about="https://spice.sbol/ComponentDefinition/${cleanName}/1">`,
    `    <dcterms:title>${plasmidName}</dcterms:title>`,
    `    <sbol:type rdf:resource="http://www.biopax.org/release/biopax-level3.owl#DnaRegion"/>`,
    `    <sbol:role rdf:resource="http://identifiers.org/so/SO:0000988"/> <!-- circular plasmid -->`,
    `    <sbol:sequence rdf:resource="https://spice.sbol/Sequence/${cleanName}_seq/1"/>`
  ];

  features.forEach((feat, idx) => {
    const fName = feat.name.replace(/\s+/g, "_");
    const fTypeUri = getSbolRoleUri(feat.type);
    
    sbolArr.push(
      `    <sbol:sequenceAnnotation>`,
      `      <sbol:SequenceAnnotation rdf:about="https://spice.sbol/ComponentDefinition/${cleanName}/annotation_${idx}/1">`,
      `        <dcterms:title>${feat.name}</dcterms:title>`,
      `        <sbol:location>`,
      `          <sbol:Range rdf:about="https://spice.sbol/ComponentDefinition/${cleanName}/annotation_${idx}/range/1">`,
      `            <sbol:start>${feat.start + 1}</sbol:start>`,
      `            <sbol:end>${feat.end + 1}</sbol:end>`,
      `            <sbol:orientation rdf:resource="http://sbols.org/v2#inline"/>`,
      `          </sbol:Range>`,
      `        </sbol:location>`,
      `        <sbol:component>`,
      `          <sbol:Component rdf:about="https://spice.sbol/ComponentDefinition/${cleanName}/sub_component_${idx}/1">`,
      `            <sbol:definition>`,
      `              <sbol:ComponentDefinition rdf:about="https://spice.sbol/ComponentDefinition/${fName}/1">`,
      `                <dcterms:title>${feat.name}</dcterms:title>`,
      `                <sbol:type rdf:resource="http://www.biopax.org/release/biopax-level3.owl#DnaRegion"/>`,
      `                <sbol:role rdf:resource="${fTypeUri}"/>`,
      `              </sbol:ComponentDefinition>`,
      `            </sbol:definition>`,
      `          </sbol:Component>`,
      `        </sbol:component>`,
      `      </sbol:SequenceAnnotation>`,
      `    </sbol:sequenceAnnotation>`
    );
  });

  sbolArr.push(
    `  </sbol:ComponentDefinition>`,
    `  <sbol:Sequence rdf:about="https://spice.sbol/Sequence/${cleanName}_seq/1">`,
    `    <sbol:elements>${seq.toLowerCase()}</sbol:elements>`,
    `    <sbol:encoding rdf:resource="http://www.chem.qmul.ac.uk/iupac/AminoAcid/"/>`,
    `  </sbol:Sequence>`,
    `</rdf:RDF>`
  );

  return sbolArr.join("\n");
}

function getSbolRoleUri(type: string): string {
  const t = type.toLowerCase();
  if (t === "promoter") return "http://identifiers.org/so/SO:0000167";
  if (t === "cds") return "http://identifiers.org/so/SO:0000316";
  if (t === "terminator") return "http://identifiers.org/so/SO:0000141";
  if (t === "ori") return "http://identifiers.org/so/SO:0000296";
  return "http://identifiers.org/so/SO:0000110";
}

// ──────────────────────────────── 18: Plasmid replicon copy number & incompatibility group ────────────────────────────────

export interface CopyNumberEstimate {
  oriName: string;
  copyNumberRange: string;
  expressionProfile: string;
  incompatibilityGroup: string;
}

/**
 * Scans features list for common replication origins (ori) and estimates 
 * expected plasmid copy numbers per cell and incompatibility group.
 */
export function estimateCopyNumberAndIncompatibility(
  features: { name: string; type: string }[]
): CopyNumberEstimate {
  for (const f of features) {
    const fName = f.name.toLowerCase();
    const fType = f.type.toLowerCase();
    
    if (fType === "ori" || fName.includes("ori") || fName.includes("origin")) {
      if (fName.includes("puc")) {
        return {
          oriName: "pUC Origin (Mutation in RNA II)",
          copyNumberRange: m.sbPucCopy(),
          expressionProfile: m.sbPucExpr(),
          incompatibilityGroup: m.sbPucInc()
        };
      } else if (fName.includes("pmb1") || fName.includes("cole1")) {
        return {
          oriName: "ColE1 / pMB1 Origin",
          copyNumberRange: m.sbCole1Copy(),
          expressionProfile: m.sbCole1Expr(),
          incompatibilityGroup: m.sbCole1Inc()
        };
      } else if (fName.includes("pbr322")) {
        return {
          oriName: "pBR322 Origin (Rop-regulated ColE1)",
          copyNumberRange: m.sbPbr322Copy(),
          expressionProfile: m.sbPbr322Expr(),
          incompatibilityGroup: m.sbPbr322Inc()
        };
      } else if (fName.includes("psc101")) {
        return {
          oriName: "pSC101 Origin (RepA-mediated partition)",
          copyNumberRange: m.sbPsc101Copy(),
          expressionProfile: m.sbPsc101Expr(),
          incompatibilityGroup: m.sbPsc101Inc()
        };
      } else if (fName.includes("p15a")) {
        return {
          oriName: "p15A Origin",
          copyNumberRange: m.sbP15aCopy(),
          expressionProfile: m.sbP15aExpr(),
          incompatibilityGroup: m.sbP15aInc()
        };
      }
    }
  }

  // Default fallback if no recognized ori
  return {
    oriName: m.sbDefaultOriName(),
    copyNumberRange: m.sbCole1Copy(),
    expressionProfile: m.sbDefaultExpr(),
    incompatibilityGroup: m.sbDefaultInc()
  };
}

// ──────────────────────────────── 19: Offline biosecurity screening ────────────────────────────────

export interface BiosecurityAgent {
  agent: string;
  pattern: string;
  description: string;
}

export interface BiosecurityAuditResult {
  passed: boolean;
  securityLevel: "LOW" | "HIGH_RISK";
  flags: { agent: string; matches: string; description: string }[];
}

/**
 * Scans DNA sequence against a compiled database of Select Agent Toxins, 
 * dangerous viral elements, and regulated pathogens.
 */
export function auditBiosecurityScreening(
  dnaSeq: string,
  database?: BiosecurityAgent[]
): BiosecurityAuditResult {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const flags: BiosecurityAuditResult["flags"] = [];

  // Offline high-risk regulated pathogen sequence signatures
  const SAFETY_BLACK_LIST: BiosecurityAgent[] = [
    {
      agent: m.sbAgentRicin(),
      pattern: "TCTGGAGCGCATGATT",
      description: m.sbAgentRicinDesc()
    },
    {
      agent: m.sbAgentBotulinum(),
      pattern: "TTTGGATCCGGATAC",
      description: m.sbAgentBotulinumDesc()
    },
    {
      agent: m.sbAgentAnthrax(),
      pattern: "ATGAAACACGAAAA",
      description: m.sbAgentAnthraxDesc()
    },
    {
      agent: m.sbAgentVariola(),
      pattern: "TATAATGAGTCACA",
      description: m.sbAgentVariolaDesc()
    }
  ];

  const activeList = database && database.length > 0 ? database : SAFETY_BLACK_LIST;

  for (const b of activeList) {
    if (seq.includes(b.pattern)) {
      flags.push({
        agent: b.agent,
        matches: b.pattern,
        description: b.description
      });
    }
  }

  const passed = flags.length === 0;

  return {
    passed,
    securityLevel: passed ? "LOW" : "HIGH_RISK",
    flags
  };
}

// ──────────────────────────────── 19b: CARD resistance gene screening ────────────────────────────────

export interface CardAmrAgent {
  gene: string;
  resistanceTo: string;
  pattern: string;
}

export interface CardAmrAuditResult {
  passed: boolean;
  flags: { gene: string; resistanceTo: string; matches: string }[];
}

/**
 * Scans DNA sequence against McMaster University CARD antimicrobial resistance signatures.
 */
export function auditCardAmrScreening(
  dnaSeq: string,
  database?: CardAmrAgent[]
): CardAmrAuditResult {
  const seq = dnaSeq.toUpperCase().replace(/[^ATCG]/g, "");
  const flags: CardAmrAuditResult["flags"] = [];

  const DEFAULT_AMR_LIST: CardAmrAgent[] = [
    { gene: "blaTEM-1", resistanceTo: "Beta-lactam (Penicillins)", pattern: "ATCAGTCAACC" },
    { gene: "kanR (aph(3')-Ia)", resistanceTo: "Aminoglycoside (Kanamycin)", pattern: "ATGAGCCATATTCAACGGG" },
    { gene: "tet(A)", resistanceTo: "Tetracycline", pattern: "GTGATCCTGGG" },
    { gene: "catA1 (CmR)", resistanceTo: "Phenicol (Chloramphenicol)", pattern: "ATGGAGAAAAAAATCACT" },
    { gene: "aac(6')-Ib-cr", resistanceTo: "Aminoglycoside, Fluoroquinolone", pattern: "CCGCTCGTGT" }
  ];

  const activeList = database && database.length > 0 ? database : DEFAULT_AMR_LIST;

  for (const b of activeList) {
    if (seq.includes(b.pattern.toUpperCase())) {
      flags.push({
        gene: b.gene,
        resistanceTo: b.resistanceTo,
        matches: b.pattern
      });
    }
  }

  return {
    passed: flags.length === 0,
    flags
  };
}

