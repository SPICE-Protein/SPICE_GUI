/** SPD (SPICE Protein Database) client contract — mirrors the live API at
 *  d-api.spicebio.top (OpenAPI 3.1, schema registry GET /api/v1/schema/{type}). */

export interface SpdErrorBody { code: string; message: string; fields?: string[] | null }
export interface SpdEnvelope<T> { data: T; meta?: Record<string, unknown>; error?: SpdErrorBody | null }

export interface SpdHealth { status: string; service: string; apiVersion?: string; schemaVersion?: string }
/** GET /user/me returns a bare object: { user: {...}, roles: [{role, expiresAt}] }. */
export interface SpdUser { id?: string; orcidId?: string; displayName?: string | null; givenName?: string | null; familyName?: string | null; primaryEmail?: string | null; emailVerified?: boolean; status?: string; [key: string]: unknown }
export interface SpdRole { role: string; /** Unix seconds; null when the role has no expiry. */ expiresAt?: number | null }
export interface SpdUserMe { user: SpdUser; roles: SpdRole[] }

/** POST /environments body (EnvironmentInput). All four physical numbers required. */
export interface SpdEnvironmentInput {
  ph: number; temperatureK: number; pressureBar: number; ionicStrengthM: number;
  solvent?: unknown; protonationModel?: string; customProtonation?: unknown; normalization?: unknown;
}
/** POST /models body (ModelInput). checkpointSha256 must match `sha256:<64 hex>`. */
export interface SpdModelInput {
  modelName: string; modelVersion: string; checkpointSha256: string; inputProtocolVersion: string;
  checkpointName?: string; inferenceRuntime?: string; inferenceCodeVersion?: string;
  trainedHeads?: string[]; metadata?: unknown;
}
/** POST /proteins body. preferredName required; no server-side dedup — the GUI caches ids. */
export interface SpdProteinInput {
  preferredName: string; geneName?: string;
  organism?: { taxId?: number; scientificName?: string };
  externalReferences?: unknown[]; tags?: string[]; license?: 'CC-BY-4.0' | 'CC0-1.0';
  // Optional UniProt-style descriptive fields accepted by the current API.
  altNames?: string[]; fullName?: string | null; entryName?: string | null;
  geneSynonyms?: string[]; orfNames?: string[]; ecNumber?: string | null;
  keywords?: unknown[]; comments?: unknown[]; organismLineage?: unknown[];
}
/** POST /sequences body. Deduplicated by SHA-256 of the normalized sequence. */
export interface SpdSequenceInput {
  proteinId: string; sequence: string; sha256?: string;
  parentSequenceId?: string; tags?: string[]; license?: 'CC-BY-4.0' | 'CC0-1.0';
  /** Declared edits relative to parentSequenceId; the server records them verbatim. */
  mutations?: unknown[];
}
/** POST /folds body (FoldInput). environment/model must already exist (dedup by identity). */
export interface SpdFoldInput {
  sequenceId: string;
  environment: SpdEnvironmentInput;
  model: SpdModelInput;
  inferenceProtocolVersion: string;
  prediction: Record<string, unknown>;
  derivedMetrics?: unknown;
  runtimeMetadata?: Record<string, unknown>;
  artifactIds?: string[];
  provenance?: Record<string, unknown>;
}

/** Creation receipts come back bare: { <entity>: {...}, created, deduplicated }. */
export interface SpdReceipt<T = Record<string, unknown>> { created: boolean; deduplicated: boolean; [key: string]: unknown; entity?: T }

/** MD-environment filters for POST /folds/query (server-side parameter
 *  windows): a bare number is an exact match, {value, tolerance} is a range. */
export type SpdEnvWindowValue = number | { value: number; tolerance?: number };
export interface SpdFoldQuery { sequenceId?: string; environmentId?: string; modelIdentityId?: string; foldIdentityHash?: string; ph?: SpdEnvWindowValue; temperatureK?: SpdEnvWindowValue; ionicStrengthM?: SpdEnvWindowValue; limit?: number }
export interface SpdFoldSummary {
  id: string; foldIdentityHash?: string; sequenceId?: string; environmentId?: string; modelId?: string;
  verificationLevel?: string; validationStatus?: string; sequenceSha256?: string;
  environmentSha256?: string; modelIdentitySha256?: string; createdAt?: number; updatedAt?: number;
  [key: string]: unknown;
}
/** GET /folds/{id} returns { data: { fold: FoldRecord } }. */
export interface SpdFoldRecord extends SpdFoldSummary {
  inferenceProtocolVersion?: string; prediction?: unknown; derivedMetrics?: unknown;
  runtimeMetadata?: unknown; artifactIds?: string[]; provenance?: unknown;
}

/** ───── Gene records (POST /genes) ─────
 *  A gene self-carries its asserted DNA/transcript sequences; region rows
 *  later anchor to whichever exists. Taxonomy summary used by list rows. */
export interface SpdGeneOrganism { taxId?: number | null; scientificName?: string | null }
/** POST /genes body (GeneInput). `name` is required; the rest mirror the
 *  upstream GenBank-style record and may be null. */
export interface SpdGeneInput {
  name: string;
  symbol?: string | null; description?: string | null; geneType?: string | null;
  organism?: SpdGeneOrganism | null; dnaSequence?: string | null; rnaSequence?: string | null;
  metadata?: unknown; accession?: string | null; accessionVersion?: string | null;
  definition?: string | null; keywords?: string[] | null; comment?: string | null;
  locusTag?: string | null; ncbiGeneId?: number | null; moleculeType?: string | null;
  topology?: string | null; division?: string | null; chromosome?: string | null;
  mapLocation?: string | null; strand?: string | null;
  organismCommonName?: string | null; organismLineage?: string[] | null;
  externalReferences?: unknown[] | null; sequenceVersion?: number | null;
  sourceUpdatedAt?: number | null;
}
/** GET /genes list row (short projection). */
export interface SpdGeneListRow {
  id: string; name: string; symbol?: string | null; geneType?: string | null;
  organismScientificName?: string | null; accession?: string | null;
  locusTag?: string | null; moleculeType?: string | null;
  dnaLength?: number | null; rnaLength?: number | null;
  organism?: SpdGeneOrganism | null; createdAt?: number | string | null;
  [key: string]: unknown;
}
/** GET /genes/{id} returns { data: { gene: GeneRecord } }. */
export interface SpdGeneRecord extends SpdGeneListRow {
  description?: string | null; dnaSequence?: string | null; rnaSequence?: string | null;
  metadata?: unknown; topology?: string | null; chromosome?: string | null;
  mapLocation?: string | null; strand?: string | null;
  accessionVersion?: string | null; definition?: string | null;
  keywords?: string[] | null; comment?: string | null;
  ncbiGeneId?: number | null; division?: string | null;
  organismCommonName?: string | null; organismLineage?: string[] | null;
  externalReferences?: unknown[] | null; sequenceVersion?: number | null;
  sourceUpdatedAt?: number | null; updatedAt?: number | string | null;
}
/** POST /genes/{id}/regions row. Positions are 1-based inclusive and may stay
 *  open (null = "somewhere"); `proteinId` is legal only on an RNA CDS row. */
export interface SpdGeneRegionInput {
  molecule: string; regionType: string; description: string;
  startPosition?: number | null; endPosition?: number | null;
  proteinId?: string | null; featureKey?: string | null; location?: string | null;
  strand?: string | null; qualifiers?: { key: string; value: string }[] | null;
  externalProteinId?: string | null;
}
export interface SpdGeneRegion extends SpdGeneRegionInput {
  id: string; geneId: string; createdAt?: number | string | null;
}
/** POST /genes/{id}/regions receipt: per-row created flags + duplicate count. */
export interface SpdGeneRegionBatchReceipt {
  geneId?: string; regions?: Array<{ id?: string; created?: boolean }>; duplicates?: number;
}
/** POST /genes receipt (bare): {id, name, geneType, created}. */
export interface SpdGeneCreateReceipt { id: string; name?: string; geneType?: string; created?: boolean }

/** POST /query — graph DSL (FEATURE_LIST §41). NodeQuery grammar: select
 *  filters projected fields; expand walks registered edges (sequence edges:
 *  protein/parent/folds; fold edges: sequence/environment/model/artifacts/
 *  validations/assessment). root XOR roots; batch max 25 roots sharing one
 *  resolution budget (anonymous 20/depth 2, standard 40/depth 3,
 *  unlimited 2000/depth 10). */
export interface SpdGraphNode { select?: string[]; limit?: number; expand?: Record<string, SpdGraphNode> }
export interface SpdGraphRoot {
  type: string; id: string; select?: string[]; limit?: number;
  expand?: Record<string, SpdGraphNode>;
  /** Upstream catalog for a non-SPD id; `uniprot` is the supported source. */
  source?: string | null;
}
export interface SpdGraphQuery { root?: SpdGraphRoot; roots?: SpdGraphRoot[] }
export interface SpdGraphEnvironment { ph: number; temperatureK: number; pressureBar: number; ionicStrengthM: number }
export interface SpdGraphFold { id: string; sequenceId?: string; environmentId?: string; foldIdentityHash?: string; createdAt?: number; environment?: SpdGraphEnvironment | null; [key: string]: unknown }
export interface SpdGraphResultNode { id?: string; sha256?: string; length?: number; folds?: SpdGraphFold[]; [key: string]: unknown }
export interface SpdGraphData {
  results: SpdGraphResultNode[]; tier: string; budgetMax: number; budgetUsed: number;
  /** Upstream import allowance for roots whose id is not an SPD public id. */
  imported?: unknown[]; importsUsed?: number; importBudgetMax?: number;
}

/** ───── Graph reads (relations, lineage) ─────
 *  GET /entities/{type}/{id}/relations folds every derived edge (encodes,
 *  sequence_of, fold_of, structure_of, pathway_step, catalyzes, …) and every
 *  asserted one into a single list. `other` is the far side already resolved
 *  to a display label, so a chip can name the record without a second read. */
export interface SpdEntityRef { id: string; type: string }
export interface SpdRelation {
  id: string;
  relationType: string;
  /** Direction relative to the addressed entity: it is the from- or to-side. */
  direction: 'in' | 'out' | string;
  source?: string;
  role?: string | null;
  note?: string | null;
  from: SpdEntityRef;
  to: SpdEntityRef;
  other: SpdEntityRef & { label?: string | null; subtitle?: string | null };
}
export interface SpdRelationsResult { entity: SpdEntityRef; relations: SpdRelation[] }
/** GET /entities/{type}/{id}/lineage and /sequences/{id}/lineage: the
 *  ancestor chain, root first. Sequence records additionally return the
 *  aligned sequence text on each node. */
export interface SpdLineageNode {
  id: string; parentSequenceId?: string | null; sequenceRole?: string;
  sha256?: string; isNative?: boolean; sequence?: string;
}
export interface SpdLineageEdge { from: string; to: string }
export interface SpdLineageResult {
  rootSequenceId?: string; nodes: SpdLineageNode[]; edges: SpdLineageEdge[];
}

/** GET /sequences/{id}/tree — descendant variants with their declared
 *  mutations. `mutations` is stored as free-form JSON, so it stays unknown. */
export interface SpdMutationTreeNode {
  id: string; depth?: number; parentSequenceId?: string | null;
  sequenceRole?: string; mutations?: unknown; sha256?: string;
  sequence?: string; isNative?: boolean;
}
export interface SpdSequenceTree {
  rootSequenceId?: string; nodeCount: number; maxDepth: number;
  nodes: SpdMutationTreeNode[]; edges: SpdLineageEdge[];
}

/** One declared residue substitution on a sequence record. SPD stores the
 *  array verbatim and joins it to the mutation map by position. */
export interface SpdSequenceMutation { position: number; from: string; to: string }

/** GET /folds/{id}/history — wet-lab validations, observed structures, MD
 *  verifications, stability scans, pocket analyses and assessments in one
 *  read. Each row keeps its own shape, so the record stays loose. */
export interface SpdEvidenceRecord { id?: string; status?: string; createdAt?: number; [key: string]: unknown }
export interface SpdFoldHistory {
  foldId?: string;
  validations?: SpdEvidenceRecord[];
  observedStructures?: SpdEvidenceRecord[];
  mdVerifications?: SpdEvidenceRecord[];
  stabilityScans?: SpdEvidenceRecord[];
  pocketAnalyses?: SpdEvidenceRecord[];
  assessments?: SpdEvidenceRecord[];
  prediction?: unknown;
}

/** GET /provenance/snapshots/by-entity/{type}/{id} — raw upstream payloads
 *  filed against a record (source, fetchedAt, license). */
export interface SpdProvenanceSnapshot {
  id?: string; source?: string; sourceId?: string; fetchedAt?: number | string;
  mediaType?: string; license?: string; [key: string]: unknown;
}

/** ───── Vector templates (design objects, POST /vectors) ─────
 *  The vector body is a structured record: the server rejects unknown
 *  top-level keys, so every field below must match the §13 model verbatim. */
export interface SpdVectorFeature { id: string; type: string; start?: number; end?: number; strand?: number; note?: string; [key: string]: unknown }
export interface SpdVectorInsertionSite { id: string; position?: number; [key: string]: unknown }
export interface SpdVectorDesign {
  name: string;
  topology?: 'circular' | 'linear';
  format?: string;            // defaults server-side to SPICE_VECTOR
  schemaVersion?: string;
  coordinateSystem?: string;  // defaults to 1-based-inclusive
  sequenceArtifactId?: string;
  features?: SpdVectorFeature[];
  insertionSites?: SpdVectorInsertionSite[];
  validationRules?: Record<string, unknown>;
  provenance?: Record<string, unknown>; // license lives here: {license:'CC-BY-4.0'|'CC0-1.0'}
}
/** GET /vectors rows are the short projection; GET /vectors/{id} the detail. */
export interface SpdVectorSummary { id: string; name: string; format?: string; topology?: string; provenance?: Record<string, unknown>; [key: string]: unknown }
export interface SpdVectorDetail extends SpdVectorSummary {
  schemaVersion?: string; sequenceArtifactId?: string; coordinateSystem?: string;
  features?: SpdVectorFeature[]; insertionSites?: SpdVectorInsertionSite[];
  validationRules?: unknown; suppliers?: unknown[];
}
/** POST /vectors/{id}/validate — current API returns structured check rows
 *  ({name,status,message}); plain strings are accepted for older servers. */
export interface SpdVectorCheck { name?: string; status?: string; message?: string }
export interface SpdVectorValidation { valid: boolean; checks: (SpdVectorCheck | string)[]; warnings: string[] }
/** POST /vectors receipt is bare: {id, created, data}. */
export interface SpdVectorReceipt { id: string; created: boolean; data: SpdVectorDesign }

/** ───── Restriction enzyme catalog (SPD-synced library source) ─────
 *  GET /restriction-enzymes/export is the public GUI-sync bundle:
 *  {exportedAt, count, enzymes:[{name, recognitionSite, cutPosition}]}.
 *  cutPosition is the site with a single ^ or / marker, e.g. "G^AATTC". */
export interface SpdEnzymeExportItem { name: string; recognitionSite: string; cutPosition: string }
export interface SpdEnzymeExport { exportedAt: number | string; count: number; enzymes: SpdEnzymeExportItem[] }
/** POST /restriction-enzymes body. enzymeType enum: type_ii|type_iis|type_iii|other. */
export interface SpdEnzymeCreateInput {
  name: string; recognitionSite: string; cutPosition: string;
  enzymeType?: string; metadata?: Record<string, unknown>;
  /** §54 explicit link to the catalog protein record; never inferred. */
  proteinId?: string | null;
  /** §56 target molecule: dna (default), rna, or other. */
  targetMolecule?: 'dna' | 'rna' | 'other' | string | null;
}
export interface SpdRestrictionEnzymeRow extends SpdEnzymeExportItem {
  id: string; enzymeType?: string; targetMolecule?: string | null; proteinId?: string | null;
  /** Catalog provenance (community rows have no upstream release). */
  source?: string | null; sourceRelease?: string | null; sourceFetchedAt?: number | null;
  license?: string | null; citation?: string | null;
  [key: string]: unknown;
}
export interface SpdRestrictionEnzymeList { items: SpdRestrictionEnzymeRow[] }

/** ───── Artifact upload pipeline (vector sequence bytes) ─────
 *  preflight → PUT /uploads/{token} (raw bytes, Content-Length must match)
 *  → POST /artifacts (snake_case body) → POST /artifacts/{id}/complete.
 *  object_key MUST start with `users/<userId>/`. */
export interface SpdUploadGrant { uploadUrl: string; objectKey: string; token: string; expiresIn: number; method: string }
export interface SpdArtifactInput {
  object_key: string; kind: string; media_type: string; encoding?: string | null;
  shape?: unknown; byte_length: number; sha256: string; license?: string;
}
/** POST /artifacts receipts are bare; identical bytes owned by me return created:false. */
export interface SpdArtifactReceipt { artifactId: string; created: boolean; status?: string; completedAt?: number }
export interface SpdArtifactRecord { id: string; kind?: string; mediaType?: string; byteLength?: number; sha256?: string; status?: string; [key: string]: unknown }

/** ───── BioBrick parts (GET/POST /biobricks) ─────
 *  List rows are deliberately short; the sequence exists only on the detail
 *  record (GET /biobricks/{id} returns { biobrick, vectors }). Part types are
 *  the server's fixed vocabulary; `other` is the only lossless fallback. */
export interface SpdBiobrickSummary {
  id: string; name: string; partType: string; length?: number;
  description?: string | null; createdAt?: number | string | null;
  [key: string]: unknown;
}
export interface SpdBiobrickRecord extends SpdBiobrickSummary {
  sequence: string; sha256?: string; metadata?: unknown; categories?: string[];
  parameters?: unknown; crossReferences?: unknown;
}
export interface SpdBiobrickVectorLink {
  id: string; name?: string; role?: string | null; linkedAt?: number | string | null;
}
export interface SpdBiobrickDetail { biobrick: SpdBiobrickRecord; vectors: SpdBiobrickVectorLink[] }
/** POST /biobricks body. `origin` defaults to submission; batch-import is for
 *  the SPD portal's file importer, not the workbench. */
export interface SpdBiobrickInput {
  name: string; partType: string; sequence: string;
  description?: string; metadata?: unknown; categories?: string[];
  parameters?: unknown; crossReferences?: unknown;
  origin?: 'submission' | 'batch-import';
}
/** POST /biobricks receipt is bare: { id, name, partType, sha256, length, created }. */
export interface SpdBiobrickReceipt {
  id: string; name: string; partType: string; sha256?: string;
  length?: number; created?: boolean;
}

/** ───── Personal workspace feed (GET /user/me/activity) ─────
 *  Authored records across every catalog table, with the lifecycle status the
 *  source table carries (null when it has none). `imports` are batch-landed
 *  rows kept separate so the portal can show them in their own tab. */
export interface SpdActivitySubmission {
  id: string; entityType: string; title: string;
  createdAt?: number | string | null; status?: string | null;
}
export interface SpdActivityAction {
  id: string; entityType: string; status?: string | null; validationType?: string;
  targetFoldId?: string; revisionNumber?: number; updatedAt?: number | string | null;
}
export interface SpdActivityWikiEdit {
  id: string; entityType: string; entityId?: string; title?: string;
  revisionNumber?: number; updatedAt?: number | string | null;
}
export interface SpdActivity {
  submissions: SpdActivitySubmission[];
  imports: SpdActivitySubmission[];
  needsAction: SpdActivityAction[];
  inReview: SpdActivityAction[];
  wikiEdits: SpdActivityWikiEdit[];
}

export interface SpdClientOptions { baseUrl?: string; token?: string }
