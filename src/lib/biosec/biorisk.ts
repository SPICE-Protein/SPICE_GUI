// Turns Commec profile-HMM hits into the same finding shape as structural
// diagnostics and exact-catalogue matches. The Rust side does the matching; this
// module only labels and scopes the result.

import type { BioriskHit, CommecStatus } from '$lib/backend/types';
import type { DiagnosticFinding } from '$lib/diagnostics/types';
import type { RiskCategory } from './types';

function asCategory(value: string): RiskCategory {
  switch (value) {
    case 'biorisk':
    case 'virulence':
    case 'stress':
    case 'amr':
      return value;
    default:
      return 'unknown';
  }
}

export function bioriskHitsToFindings(
  hits: BioriskHit[],
  status: CommecStatus | null,
): DiagnosticFinding[] {
  if (!status) return [];
  return hits.map((hit) => {
    const blocking = hit.mustFlag === true;
    const category = asCategory(hit.category);
    const start = hit.start;
    const end = hit.end;
    const frame = `frame ${hit.frame}`;
    const eValue = Number.isFinite(hit.evalue) ? hit.evalue.toExponential(2) : 'n/a';
    return {
      id: `risk:commec:${hit.model}:${hit.frame}:${hit.strand}:${start}-${end}`,
      provider: 'biosec',
      severity: blocking ? 'blocking' : 'warning',
      code: blocking ? 'risk_match' : 'risk_virulence_match',
      title: `${hit.description || hit.model} (${category})`,
      detail: `Profile match at ${start}..${end} on the ${hit.strand} strand (${frame}, E=${eValue}, coverage ${Math.round(hit.coverage * 100)}%); Commec ${status.version || 'unknown'}.`,
      scope: {
        kind: 'sequence',
        start,
        end,
        strand: hit.strand === '-' ? '-' : '+',
      },
      params: {
        name: hit.description || hit.model,
        model: hit.model,
        description: hit.description,
        category,
        source: 'commec',
        strand: hit.strand,
        start,
        end,
        length: end - start + 1,
        coverage: hit.coverage,
        evalue: hit.evalue,
      },
      evidence: {
        source: 'commec',
        recordId: hit.model,
        category,
        licence: status.licence,
        catalogVersion: status.version,
        catalogHash: status.sha256,
        origin: 'installed',
        quality: 'profile-hmm',
        wrapped: false,
      },
      requiresReview: blocking,
    };
  });
}
