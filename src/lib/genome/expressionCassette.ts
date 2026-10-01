/** Pure expression-cassette and vector-assembly domain primitives. */

export type PartRole =
  | "promoter" | "enhancer" | "5_utr" | "translation_initiation_context"
  | "rbs" | "signal_peptide" | "targeting_peptide" | "linker" | "fusion_tag"
  | "cds" | "3_utr" | "terminator" | "polyadenylation_signal" | "other";
export type Topology = "linear" | "circular";
export type Orientation = "forward" | "reverse";

export interface PartFeature {
  id?: string;
  name?: string;
  type?: string;
  role?: string;
  start: number;
  end: number;
  strand?: 1 | -1;
  [key: string]: unknown;
}
export interface CassettePart {
  id: string;
  role: PartRole;
  sequence: string;
  name?: string;
  orientation?: Orientation;
  features?: PartFeature[];
  metadata?: Record<string, unknown>;
}
export interface HostSystem { expressionHostTaxId?: number; expressionHostName?: string; [key: string]: unknown }
export interface TranslationSpec {
  proteinSequenceId?: string;
  startCodon?: string;
  stopCodon?: string;
  readingFrame?: number;
}
export interface ExpressionCassette {
  id: string;
  hostSystem?: HostSystem;
  parts: CassettePart[];
  order?: string[];
  translation?: TranslationSpec;
  codonUsage?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  topology?: Topology;
}
export interface VectorFeature extends PartFeature { required?: boolean; editable?: boolean }
export interface InsertionSite {
  id: string; type?: string; afterFeatureId?: string; beforeFeatureId?: string;
  preserveFeatureIds?: string[]; allowedCassetteTypes?: string[]; orientation?: Orientation;
}
export interface VectorTemplate {
  id: string; name?: string; sequence?: string; sequenceArtifactId?: string;
  topology: Topology; features: VectorFeature[]; insertionSites?: InsertionSite[];
  validationRules?: { requiredFeatureIds?: string[]; preserveFeatureIds?: string[]; checkReadingFrame?: boolean; forbiddenRestrictionSites?: string[] };
  [key: string]: unknown;
}
export interface ProjectedFeature extends VectorFeature { sourceId: string; sourcePartId?: string; }
export interface AssemblyResult {
  sequence: string; topology: Topology; features: ProjectedFeature[];
  partRanges: Array<{ partId: string; role: PartRole; start: number; end: number }>;
  cassette: ExpressionCassette;
  vector?: VectorTemplate;
}
export interface ValidationIssue { code: string; message: string; featureId?: string; severity: "error" | "warning" }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[] }
export interface SequenceDiff { type: "equal" | "mismatch" | "insertion" | "deletion"; position: number; reference?: string; actual?: string; length: number }

function orient(seq: string, direction: Orientation = "forward"): string {
  if (direction === "forward") return seq;
  const map: Record<string, string> = { A: "T", T: "A", C: "G", G: "C", a: "t", t: "a", c: "g", g: "c" };
  return [...seq].reverse().map((c) => map[c] ?? c).join("");
}
function orderedParts(c: ExpressionCassette): CassettePart[] {
  if (!c.order) return [...c.parts];
  const byId = new Map(c.parts.map((p) => [p.id, p]));
  return c.order.map((id) => byId.get(id)).filter((p): p is CassettePart => !!p);
}
function featureLength(f: PartFeature): number { return f.end >= f.start ? f.end - f.start + 1 : 0 }

/** Assemble cassette parts in a stable order and project their annotations. */
export function assembleExpressionCassette(cassette: ExpressionCassette): AssemblyResult {
  const parts = orderedParts(cassette), features: ProjectedFeature[] = [], partRanges = [] as AssemblyResult["partRanges"];
  let sequence = "", offset = 0;
  for (const part of parts) {
    const dna = orient(part.sequence, part.orientation);
    const start = offset, end = offset + dna.length - 1;
    partRanges.push({ partId: part.id, role: part.role, start, end });
    for (const f of part.features ?? []) {
      const len = featureLength(f), localStart = Math.max(0, f.start), localEnd = Math.min(dna.length - 1, f.end);
      if (!len || localStart > localEnd) continue;
      const reverse = part.orientation === "reverse";
      features.push({ ...f, id: f.id ?? `${part.id}:${f.name ?? f.type ?? "feature"}`, sourceId: f.id ?? part.id, sourcePartId: part.id,
        start: reverse ? offset + dna.length - 1 - localEnd : offset + localStart,
        end: reverse ? offset + dna.length - 1 - localStart : offset + localEnd,
        strand: reverse ? -((f.strand as number) || 1) as 1 | -1 : (f.strand as 1 | -1 | undefined) });
    }
    sequence += dna; offset += dna.length;
  }
  return { sequence, topology: cassette.topology ?? "linear", features, partRanges, cassette };
}

/** Insert an assembled cassette into a vector, preserving vector feature coordinates. */
export function assembleVector(template: VectorTemplate, cassette: ExpressionCassette, insertionSiteId?: string): AssemblyResult {
  const site = (template.insertionSites ?? [])[0] && (insertionSiteId ? template.insertionSites?.find(s => s.id === insertionSiteId) : template.insertionSites?.[0]);
  const insert = assembleExpressionCassette(cassette), vectorSeq = template.sequence ?? "";
  if (!site) return { ...insert, vector: template };
  const after = site.afterFeatureId ? template.features.find(f => f.id === site.afterFeatureId) : undefined;
  const before = site.beforeFeatureId ? template.features.find(f => f.id === site.beforeFeatureId) : undefined;
  const at = before ? before.start : after ? after.end + 1 : vectorSeq.length;
  const cassetteSeq = orient(insert.sequence, site.orientation ?? "forward");
  const shift = cassetteSeq.length;
  const features: ProjectedFeature[] = template.features.map(f => ({ ...f, sourceId: f.id ?? f.name ?? "vector" , start: f.start >= at ? f.start + shift : f.start, end: f.end >= at ? f.end + shift : f.end }));
  for (const f of insert.features) features.push({ ...f, start: at + f.start, end: at + f.end });
  return { sequence: vectorSeq.slice(0, at) + cassetteSeq + vectorSeq.slice(at), topology: template.topology, features, partRanges: insert.partRanges.map(r => ({ ...r, start: r.start + at, end: r.end + at })), cassette, vector: template };
}

export function projectCassetteFeatures(result: AssemblyResult): ProjectedFeature[] { return result.features.map(f => ({ ...f })); }

/** Validate structural requirements and simple sequence constraints. */
export function validateVectorAssembly(result: AssemblyResult, rules = result.vector?.validationRules): ValidationResult {
  const issues: ValidationIssue[] = [], ids = new Set(result.features.map(f => f.id));
  for (const id of rules?.requiredFeatureIds ?? []) if (!ids.has(id)) issues.push({ code: "missing_required_feature", message: `Missing required feature: ${id}`, featureId: id, severity: "error" });
  for (const id of rules?.preserveFeatureIds ?? []) if (!ids.has(id)) issues.push({ code: "missing_preserved_feature", message: `Preserved feature was not retained: ${id}`, featureId: id, severity: "error" });
  for (const site of rules?.forbiddenRestrictionSites ?? []) {
    const pattern = /^[ACGTN]+$/i.test(site) ? site : "";
    if (pattern && result.sequence.toUpperCase().includes(pattern.toUpperCase())) issues.push({ code: "forbidden_restriction_site", message: `Forbidden restriction site present: ${site}`, severity: "error" });
  }
  if (rules?.checkReadingFrame) for (const p of result.cassette.parts) if (p.role === "cds" && p.sequence.length % 3 !== 0) issues.push({ code: "cds_frame", message: `CDS ${p.id} is not in frame`, severity: "error" });
  return { valid: !issues.some(i => i.severity === "error"), issues };
}

/** Deterministic base-level diff (linear; circular uses the best rotation). */
export function diffSequences(reference: string, actual: string, topology: Topology = "linear"): SequenceDiff[] {
  if (topology === "circular" && reference.length === actual.length && reference.length) {
    let best = actual, bestScore = Infinity;
    for (let i = 0; i < actual.length; i++) { const r = actual.slice(i) + actual.slice(0, i); const score = [...reference].reduce((n, c, j) => n + (c.toUpperCase() === r[j].toUpperCase() ? 0 : 1), 0); if (score < bestScore) { bestScore = score; best = r; } }
    actual = best;
  }
  const out: SequenceDiff[] = [], n = Math.max(reference.length, actual.length); let i = 0;
  while (i < n) { if (i < reference.length && i < actual.length && reference[i].toUpperCase() === actual[i].toUpperCase()) { i++; continue; } const pos = i; if (i >= reference.length) { out.push({ type: "insertion", position: pos, actual: actual.slice(i), length: actual.length - i }); break; } if (i >= actual.length) { out.push({ type: "deletion", position: pos, reference: reference.slice(i), length: reference.length - i }); break; } out.push({ type: "mismatch", position: pos, reference: reference[i], actual: actual[i], length: 1 }); i++; }
  return out;
}

export const assembleCassette = assembleExpressionCassette;
export const validateAssembly = validateVectorAssembly;
export const diffAssembly = diffSequences;
