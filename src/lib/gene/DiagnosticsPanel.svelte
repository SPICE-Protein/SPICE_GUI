<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { DiagnosticFinding } from '$lib/diagnostics/types';

  let {
    findings = [],
    coverage = 'none',
    riskRecords = 0,
    bioriskInstalled = false,
    bioriskModels = 0,
    bioriskVersion = '',
    bioriskLoading = false,
    bioriskError = null,
    drag,
    onclose,
    onlocate,
    onfix,
  } = $props<{
    findings: DiagnosticFinding[];
    coverage: 'network' | 'cache' | 'sample' | 'none';
    riskRecords: number;
    bioriskInstalled?: boolean;
    bioriskModels?: number;
    bioriskVersion?: string;
    bioriskLoading?: boolean;
    bioriskError?: string | null;
    drag: any;
    onclose: () => void;
    onlocate: (finding: DiagnosticFinding) => void;
    onfix: (finding: DiagnosticFinding, fixIndex: number) => void;
  }>();

  const severityLabel: Record<string, () => string> = {
    blocking: () => m.diagSeverityBlocking(),
    warning: () => m.diagSeverityWarning(),
    info: () => m.diagSeverityInfo(),
  };

  const originLabel: Record<string, () => string> = {
    network: () => m.riskOriginNetwork(),
    cache: () => m.riskOriginCache(),
    sample: () => m.riskOriginBuiltin(),
    none: () => m.riskOriginBuiltin(),
  };

  function text(finding: DiagnosticFinding): { title: string; detail: string } {
    const p = (key: string) => String(finding.params?.[key] ?? '');
    switch (finding.code) {
      case 'seq_empty':
        return { title: m.diagSeqEmptyTitle(), detail: m.diagSeqEmptyDetail() };
      case 'seq_non_iupac':
        return {
          title: m.diagSeqNonIupacTitle(),
          detail: m.diagSeqNonIupacDetail({ v1: p('base'), v2: p('position') }),
        };
      case 'topology_invalid':
        return { title: m.diagTopologyTitle(), detail: m.diagTopologyDetail({ v1: p('topology') }) };
      case 'feature_duplicate_id':
        return { title: m.diagFeatureDupIdTitle(), detail: m.diagFeatureDupIdDetail({ v1: p('id') }) };
      case 'feature_empty_name':
        return { title: m.diagFeatureEmptyNameTitle(), detail: m.diagFeatureEmptyNameDetail({ v1: p('id') }) };
      case 'feature_range':
        return {
          title: m.diagFeatureRangeTitle(),
          detail: m.diagFeatureRangeDetail({ v1: p('id'), v2: p('start'), v3: p('end'), v4: p('length') }),
        };
      case 'feature_duplicate_name':
        return {
          title: m.diagFeatureDupNameTitle(),
          detail: m.diagFeatureDupNameDetail({ v1: p('count'), v2: p('name') }),
        };
      case 'cds_frame':
        return {
          title: m.diagCdsFrameTitle(),
          detail: m.diagCdsFrameDetail({ v1: p('name'), v2: p('length'), v3: p('remainder') }),
        };
      case 'cds_start':
        return { title: m.diagCdsStartTitle(), detail: m.diagCdsStartDetail({ v1: p('name'), v2: p('codon') }) };
      case 'cds_internal_stop':
        return {
          title: m.diagCdsStopTitle(),
          detail: m.diagCdsStopDetail({ v1: p('name'), v2: p('codon'), v3: p('position') }),
        };
      case 'cds_enzyme_site':
        return {
          title: m.diagCdsEnzymeTitle(),
          detail: m.diagCdsEnzymeDetail({ v1: p('name'), v2: p('enzyme'), v3: p('position') }),
        };
      case 'sequence_gc_extreme':
        return { title: m.diagGcTitle(), detail: m.diagGcDetail({ v1: p('percent') }) };
      case 'sequence_homopolymer':
        return {
          title: m.diagHomoTitle(),
          detail: m.diagHomoDetail({ v1: p('base'), v2: p('length'), v3: p('start'), v4: p('end') }),
        };
      case 'feature_overlap_opposite':
        return {
          title: m.diagOverlapTitle(),
          detail: m.diagOverlapDetail({ v1: p('first'), v2: p('second'), v3: p('start'), v4: p('end') }),
        };
      case 'risk_match':
      case 'risk_amr_match':
      case 'risk_virulence_match':
      case 'risk_stress_match': {
        const short = finding.evidence?.quality === 'short-signature' ? ` ${m.diagRiskShortNote()}` : '';
        if (finding.code === 'risk_amr_match') {
          return {
            title: m.diagRiskAmrTitle({ v1: p('name') }),
            detail:
              m.diagRiskAmrDetail({ v1: p('start'), v2: p('end'), v3: p('strand'), v4: p('length') }) + short,
          };
        }
        if (finding.code === 'risk_virulence_match') {
          return {
            title: m.diagRiskVirulenceTitle({ v1: p('name') }),
            detail: m.diagRiskVirulenceDetail({ v1: p('start'), v2: p('end'), v3: p('strand') }),
          };
        }
        if (finding.code === 'risk_stress_match') {
          return {
            title: m.diagRiskStressTitle({ v1: p('name') }),
            detail: m.diagRiskStressDetail({ v1: p('start'), v2: p('end'), v3: p('strand') }),
          };
        }
        return {
          title: m.diagRiskTitle({ v1: p('name') }),
          detail:
            m.diagRiskDetail({
              v1: p('start'),
              v2: p('end'),
              v3: p('strand'),
              v4: p('source'),
              v5: p('length'),
            }) + short,
        };
      }
      default:
        return { title: finding.title, detail: finding.detail };
    }
  }

  function fixLabel(label: string): string {
    if (label === 'rename-duplicates') return m.diagFixRenameDuplicates();
    return label;
  }
</script>

<div
  use:drag={'.panel-header'}
  class="floating-panel pix-panel"
  data-testid="gene-diagnostics-panel"
  style="position: absolute; right: 10px; top: 60px; width: 390px; max-height: 540px; z-index: 62; display: flex; flex-direction: column;"
>
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;">{m.diagPanelTitle()}</span>
    <button class="pix-btn-reset" aria-label={m.diagPanelClose()} onclick={onclose} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <div class="pix-dim" style="font-size: 8.5px; line-height: 1.35; margin-bottom: 5px;">
    {#if coverage === 'none' && !bioriskInstalled}
      {m.diagPanelScreeningUnavailable()}
    {:else}
      {m.diagPanelCoverage({ v1: originLabel[coverage](), v2: String(riskRecords) })}
      {#if bioriskInstalled}
        · {m.diagPanelBioriskCoverage({ v1: bioriskVersion || 'unknown', v2: String(bioriskModels) })}
        {#if bioriskLoading}
          · {m.diagPanelBioriskScanning()}
        {/if}
      {:else}
        · {m.diagPanelBioriskMissing()}
      {/if}
    {/if}
    {#if bioriskError}
      <div class="pix-num bad" style="font-size: 8px; word-break: break-word; color: var(--pix-red);">{bioriskError}</div>
    {/if}
  </div>

  <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; padding-right: 2px;">
    {#if findings.length === 0}
      <div class="pix-dim" style="font-size: 9px; text-align: center; padding: 8px;">{m.diagPanelEmpty()}</div>
    {:else}
      {#each findings as finding (finding.id)}
        <div class="finding {finding.severity}">
          <div class="finding-head">
            <span class="sev {finding.severity}">{severityLabel[finding.severity]()}</span>
            <span class="title">{text(finding).title}</span>
          </div>
          <div class="detail">{text(finding).detail}</div>
          <div class="finding-actions">
            <button class="mini-btn" onclick={() => onlocate(finding)}>{m.diagPanelLocate()}</button>
            {#if finding.fixes?.length}
              <button class="mini-btn good" onclick={() => onfix(finding, 0)}>
                {fixLabel(finding.fixes[0].label)}
              </button>
            {/if}
            {#if finding.requiresReview}
              <span class="review">{m.diagPanelReview()}</span>
            {/if}
            {#if finding.scope.start}
              <span class="pix-dim loc">{finding.scope.start}{finding.scope.end ? `..${finding.scope.end}` : ''}</span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .finding {
    border: 1px solid var(--pix-border);
    border-left-width: 3px;
    padding: 5px 6px;
    background: rgba(0, 0, 0, 0.12);
    font-size: 9px;
    line-height: 1.35;
  }
  .finding.blocking { border-left-color: var(--pix-red); }
  .finding.warning { border-left-color: var(--pix-accent); }
  .finding.info { border-left-color: var(--pix-cyan); }
  .finding-head { display: flex; align-items: center; gap: 5px; }
  .sev {
    font-size: 7.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: 1px solid currentColor;
    padding: 0 3px;
    flex: none;
  }
  .sev.blocking { color: var(--pix-red); }
  .sev.warning { color: var(--pix-accent); }
  .sev.info { color: var(--pix-cyan); }
  .title { color: var(--pix-fg); font-weight: bold; }
  .detail { color: var(--pix-fg-dim); margin-top: 2px; user-select: text; }
  .finding-actions { display: flex; align-items: center; gap: 5px; margin-top: 4px; flex-wrap: wrap; }
  .mini-btn {
    font-family: var(--pix-font);
    font-size: 8.5px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    padding: 1px 6px;
    cursor: pointer;
  }
  .mini-btn:hover { color: var(--pix-fg); border-color: var(--pix-border-hi); }
  .mini-btn.good { color: var(--pix-green); border-color: var(--pix-green); }
  .review { color: var(--pix-red); font-size: 8px; }
  .loc { font-size: 8px; margin-left: auto; }
</style>
