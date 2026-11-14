// Pluggable structure-prediction layer. A provider adapts an external folding
// service to the internal `FoldOutput` shape so downstream viewers stay unaware
// of where the coordinates came from.

import type { Env, FoldOutput } from '$lib/backend/types';

/** Features a provider can genuinely produce. The UI uses these flags to hide
 *  controls that would otherwise promise data the provider cannot supply. */
export interface FoldCapabilities {
  /** Accepts pH / temperature / ionic strength as folding conditions. */
  environment: boolean;
  /** Uses hydrostatic pressure as a folding condition. */
  pressure: boolean;
  /** Produces a second (mutant) Cα trace. */
  mutantHead: boolean;
  /** Produces a predicted distance matrix. */
  distogram: boolean;
  /** Produces a contact-probability matrix. */
  contactMap: boolean;
  /** Produces per-position mutation probabilities. */
  mutationProbabilities: boolean;
  /** Produces a confidence estimate. */
  confidence: boolean;
  /** Folding runs as a remote job that must be polled. */
  asyncJob: boolean;
  /** Requires a user-supplied API token. */
  requiresToken: boolean;
  /** Maximum accepted sequence length, when the provider documents one. */
  maxSequenceLength?: number;
}

export type FoldProviderId = 'spice' | 'swissmodel' | 'demo';

export interface FoldProviderDescriptor {
  id: FoldProviderId;
  name: string;
  description: string;
  capabilities: FoldCapabilities;
}

export interface FoldRequest {
  /** One-letter amino-acid sequence. */
  sequence: string;
  env: Env;
  /** Provider API token, when `capabilities.requiresToken` is true. */
  token?: string;
  /** Contact address requested by some remote services. */
  email?: string;
  signal?: AbortSignal;
  /** Delay between remote job status polls. */
  pollIntervalMs?: number;
  /** Overall deadline for a remote job. */
  maxWaitMs?: number;
}

export interface FoldProgress {
  phase: 'submitting' | 'waiting' | 'fetching';
  jobId?: string;
  elapsedMs?: number;
}

export interface FoldProviderResult {
  output: FoldOutput;
  providerId: FoldProviderId;
  providerName: string;
  /** Provider-specific model identifier (file path, job model id, ...). */
  modelId?: string;
  /** Template PDB id reported by the provider, when available. */
  template?: string;
  /** Global quality score on the provider's own scale (e.g. QMEAN). */
  qmean?: number;
  /** Direct link to the downloaded coordinates. */
  coordinateUrl?: string;
  /** Human-readable caveats about the returned structure. */
  note?: string;
}

export interface FoldProvider {
  descriptor: FoldProviderDescriptor;
  fold(request: FoldRequest, onProgress?: (progress: FoldProgress) => void): Promise<FoldProviderResult>;
}
