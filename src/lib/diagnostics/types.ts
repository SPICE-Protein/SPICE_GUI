// Shared shape for every finding the app can show against a document.
//
// Two providers feed it: the gene diagnostics engine (structure and scientific
// consistency) and the biosecurity screen (matches against locally synced risk
// catalogs). Keeping one shape means one panel, one severity vocabulary and
// one place where an agent or a human is told what to do.

import type { GeneIntent } from '$lib/gene/workspaceIntents';

export type FindingProvider = 'structural' | 'science' | 'biosec';

/** `blocking` means the document or plan is unsafe to accept as-is. */
export type FindingSeverity = 'blocking' | 'warning' | 'info';

export interface FindingScope {
  kind: 'sequence' | 'feature';
  /** Feature id for `kind: 'feature'`. */
  id?: number;
  /** 1-based inclusive sequence span. */
  start?: number;
  /** 1-based inclusive sequence span. */
  end?: number;
  strand?: '+' | '-';
}

export interface FindingFix {
  /** Localised label is supplied by the panel; this is the stable action name. */
  label: string;
  intents: GeneIntent[];
}

export interface DiagnosticFinding {
  /** Stable for one snapshot and one catalog version. */
  id: string;
  provider: FindingProvider;
  severity: FindingSeverity;
  /** Machine-readable code; the panel maps it to a localised sentence. */
  code: string;
  /** English fallback used by exports and logs. */
  title: string;
  /** English fallback used by exports and logs. */
  detail: string;
  scope: FindingScope;
  /** Values interpolated into the localised sentence. */
  params?: Record<string, string | number>;
  evidence?: Record<string, unknown>;
  fixes?: FindingFix[];
  /** A human must clear this before the finding stops blocking. */
  requiresReview?: boolean;
}
