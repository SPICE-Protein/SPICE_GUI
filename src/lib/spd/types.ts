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

export interface SpdClientOptions { baseUrl?: string; token?: string }
