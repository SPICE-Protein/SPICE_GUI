// @ts-nocheck
// SPICE gene editor demo loader.
// Converts the ported OVE pJ5_00001 demo (0-based inclusive ranges, strand,
// type + feature color) into the SPICE page's data model (1-based inclusive).

import oveDemo from "./data/exampleSequenceData";

export interface SpiceFeature {
  id: number;
  name: string;
  start: number; // 1-based inclusive
  end: number; // 1-based inclusive
  type: string;
  color: string;
  forward?: boolean;
}

export interface DemoPlasmid {
  name: string;
  sequence: string;
  features: SpiceFeature[];
  parts: { name: string; start: number; end: number }[];
  primers: { name: string; start: number; end: number; forward: boolean }[];
  circular: boolean;
}

// GenBank-style feature type -> color (matching the ported featureTypesAndColors)
function colorForType(type: string): string {
  const t = (type || "misc_feature").toLowerCase();
  const map: Record<string, string> = {
    cds: "#ef6500",
    gene: "#684e27",
    promoter: "#31b440",
    terminator: "#f51600",
    rep_origin: "#878787",
    origin: "#878787",
    misc_marker: "#8dceb1",
    protein_bind: "#2e2e2e",
    misc_binding: "#006fef",
    rbs: "#bdffcb",
    misc_feature: "#006fef",
    primer_bind: "#53d969",
    tag: "#e419da",
    signal_peptide: "#2fff8d"
  };
  return map[t] || "#4cd6ff";
}

export function loadOveDemoPlasmid(): DemoPlasmid {
  const seq: string = oveDemo.sequence || "";
  const features: SpiceFeature[] = (oveDemo.features || []).map((f: any, i: number) => ({
    id: i + 1,
    name: f.name || `Feature ${i + 1}`,
    start: (f.start ?? 0) + 1,
    end: (f.end ?? 0) + 1,
    type: f.type || "misc_feature",
    color: colorForType(f.type),
    forward: f.strand !== -1
  }));
  const parts = (oveDemo.parts || []).map((p: any) => ({
    name: p.name || "",
    start: (p.start ?? 0) + 1,
    end: (p.end ?? 0) + 1
  }));
  const primers = (oveDemo.primers || []).map((p: any) => ({
    name: p.name || "",
    start: (p.start ?? 0) + 1,
    end: (p.end ?? 0) + 1,
    forward: p.forward !== false
  }));
  return {
    name: oveDemo.name || "pJ5_00001",
    sequence: seq,
    features,
    parts,
    primers,
    circular: oveDemo.circular !== false
  };
}
