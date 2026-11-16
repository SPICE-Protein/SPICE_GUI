// Plan-level risk assessment: screen the document before and after a proposed
// edit so only newly introduced controlled signatures stop the plan.

import type { DiagnosticFinding } from '$lib/diagnostics/types';
import type { GeneWorkspaceSnapshot } from '$lib/gene/workspaceIntents';
import { newRiskFindings, screenSequence } from './screen';
import type { RiskCatalog } from './types';

export interface PlanRiskAssessment {
  before: DiagnosticFinding[];
  after: DiagnosticFinding[];
  introduced: DiagnosticFinding[];
  /** Introduced findings that must be cleared by a person. */
  blocking: DiagnosticFinding[];
}

export function assessPlanRisk(
  before: GeneWorkspaceSnapshot,
  after: GeneWorkspaceSnapshot,
  catalogs: RiskCatalog[],
): PlanRiskAssessment {
  if (catalogs.length === 0) {
    return { before: [], after: [], introduced: [], blocking: [] };
  }
  const beforeHits = screenSequence(before.sequence, catalogs, {
    circular: before.topology === 'circular',
  });
  const afterHits = screenSequence(after.sequence, catalogs, {
    circular: after.topology === 'circular',
  });
  const introduced = newRiskFindings(beforeHits, afterHits);
  return {
    before: beforeHits,
    after: afterHits,
    introduced,
    blocking: introduced.filter((finding) => finding.severity === 'blocking'),
  };
}
