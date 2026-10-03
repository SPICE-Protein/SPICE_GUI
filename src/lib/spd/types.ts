/** SPD (SPICE Protein Database) client contract — mirrors the live API at
 *  d-api.spicebio.top (OpenAPI 3.1, schema registry GET /api/v1/schema/{type}). */

export interface SpdErrorBody { code: string; message: string; fields?: string[] | null }
export interface SpdEnvelope<T> { data: T; meta?: Record<string, unknown>; error?: SpdErrorBody | null }

export interface SpdHealth { status: string; service: string; apiVersion?: string; schemaVersion?: string }
/** GET /user/me returns a bare object: { user: {...}, roles: [{role, expiresAt}] }. */
export interface SpdUser { id?: string; orcidId?: string; displayName?: string; givenName?: string; familyName?: string; primaryEmail?: string; emailVerified?: boolean; status?: string; [key: string]: unknown }
export interface SpdRole { role: string; expiresAt?: string | null }
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
}
/** POST /sequences body. Deduplicated by SHA-256 of the normalized sequence. */
export interface SpdSequenceInput {
  proteinId: string; sequence: string; sha256?: string;
  parentSequenceId?: string; tags?: string[]; license?: 'CC-BY-4.0' | 'CC0-1.0';
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
export interface SpdFoldSummary { id: string; foldIdentityHash?: string; sequenceId?: string; environmentId?: string; modelId?: string; verificationLevel?: string; [key: string]: unknown }

/** POST /query — graph DSL (FEATURE_LIST §41). NodeQuery grammar: select
 *  filters projected fields; expand walks registered edges (sequence edges:
 *  protein/parent/folds; fold edges: sequence/environment/model/artifacts/
 *  validations/assessment). root XOR roots; batch max 25 roots sharing one
 *  resolution budget (anonymous 20/depth 2, standard 40/depth 3,
 *  unlimited 2000/depth 10). */
export interface SpdGraphNode { select?: string[]; limit?: number; expand?: Record<string, SpdGraphNode> }
export interface SpdGraphRoot { type: string; id: string; select?: string[]; limit?: number; expand?: Record<string, SpdGraphNode> }
export interface SpdGraphQuery { root?: SpdGraphRoot; roots?: SpdGraphRoot[] }
export interface SpdGraphEnvironment { ph: number; temperatureK: number; pressureBar: number; ionicStrengthM: number }
export interface SpdGraphFold { id: string; sequenceId?: string; environmentId?: string; foldIdentityHash?: string; createdAt?: string; environment?: SpdGraphEnvironment | null; [key: string]: unknown }
export interface SpdGraphResultNode { id?: string; sha256?: string; length?: number; folds?: SpdGraphFold[]; [key: string]: unknown }
export interface SpdGraphData { results: SpdGraphResultNode[]; tier: string; budgetMax: number; budgetUsed: number }

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
/** POST /vectors/{id}/validate — checks are human-readable strings. */
export interface SpdVectorValidation { valid: boolean; checks: string[]; warnings: string[] }
/** POST /vectors receipt is bare: {id, created, data}. */
export interface SpdVectorReceipt { id: string; created: boolean; data: SpdVectorDesign }

/** ───── Restriction enzyme catalog (SPD-synced library source) ─────
 *  GET /restriction-enzymes/export is the public GUI-sync bundle:
 *  {exportedAt, count, enzymes:[{name, recognitionSite, cutPosition}]}.
 *  cutPosition is the site with a single ^ or / marker, e.g. "G^AATTC". */
export interface SpdEnzymeExportItem { name: string; recognitionSite: string; cutPosition: string }
export interface SpdEnzymeExport { exportedAt: number; count: number; enzymes: SpdEnzymeExportItem[] }
/** POST /restriction-enzymes body. enzymeType enum: type_ii|type_iis|type_iii|other. */
export interface SpdEnzymeCreateInput { name: string; recognitionSite: string; cutPosition: string; enzymeType?: string; metadata?: Record<string, unknown> }

/** ───── Artifact upload pipeline (vector sequence bytes) ─────
 *  preflight → PUT grant.uploadUrl (raw bytes, Content-Length must match)
 *  → POST /artifacts (snake_case body) → POST /artifacts/{id}/complete.
 *  object_key MUST start with `users/<userId>/`. */
export interface SpdUploadGrant { uploadUrl: string; objectKey: string; token: string; expiresIn: number; method: string }
export interface SpdArtifactInput {
  object_key: string; kind: string; media_type: string; encoding?: string | null;
  shape?: unknown; byte_length: number; sha256: string; license?: string;
}
/** POST /artifacts receipts are bare; identical bytes owned by me return created:false. */
export interface SpdArtifactReceipt { artifactId: string; created: boolean; status?: string; completedAt?: number }

export interface SpdClientOptions { baseUrl?: string; token?: string }
