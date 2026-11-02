// Project document helpers for the qPCR workspace: payload sanitizer, hub
// summary and a preview rasterised from the existing results chart SVG.
import { svgPreview } from '$lib/tools/shared/preview';
import type { SvgDoc } from './chart';
import { normalizeProject, type QpcrProject } from './types';
import { tm } from './messages';

export function sanitizeQpcrProject(input: unknown): QpcrProject | null {
  return normalizeProject(input);
}

/** One-line status shown in the project hub document list. */
export function qpcrDocSummary(project: QpcrProject, flagged = 0): string {
  return tm.qpcrDocSummary({
    wells: project.wells.length,
    flagged,
    mode:
      project.mode === 'standard'
        ? tm.qpcrSummaryStandard()
        : tm.qpcrSummaryDdct(),
  });
}

/** Compact JPEG preview of the chart currently shown in the workspace. */
export async function qpcrDocPreview(chart: SvgDoc | null): Promise<string | null> {
  if (!chart) return null;
  return (await svgPreview(chart.svg, chart.width, chart.height)) || null;
}
