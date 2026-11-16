// Locally held risk data. The GUI pulls both databases directly; SPD is not in
// this path. AMR is an exact DNA catalogue (NCBI AMRFinderPlus); biorisk is a
// profile-HMM screen (IBBIS Commec) whose hits are produced by the Rust side.

import type { RiskCatalogOrigin } from '$lib/backend/types';

export type RiskSource = 'amrfinder' | 'commec';

export type RiskCategory = 'amr' | 'biorisk' | 'virulence' | 'stress' | 'unknown';

export interface RiskRecord {
  source: RiskSource;
  /** Stable across syncs: `amrfinder:<accession>`. */
  id: string;
  name: string;
  description: string;
  category: RiskCategory;
  /** Normalised DNA signatures, uppercase A/C/G/T only. */
  patterns: string[];
  /** AMRFinderPlus class / subclass, when the catalogue names them. */
  class?: string;
  subclass?: string;
}

export interface RiskCatalog {
  source: RiskSource;
  origin: RiskCatalogOrigin;
  version: string;
  /** Hash of the normalised records, so a verdict can name its catalog exactly. */
  contentHash: string;
  fetchedAt: number;
  licence: string;
  endpoint: string | null;
  error: string | null;
  records: RiskRecord[];
  patternCount: number;
  /** Signatures rejected because they were empty, non-ACGT or too short. */
  droppedPatterns: number;
}
