// Publication-check dialog for Figure Studio. The editor owns the document and
// the async image-size probe; this component only renders the issue list.
<script lang="ts">
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-svelte';
import { fm } from './messages';
import type { ComplianceIssue } from './compliance';

interface FigureCheckDialogProps {
  open: boolean;
  issues: ComplianceIssue[];
  counts: { errors: number; warns: number; infos: number; total: number };
  busy: boolean;
  onRun: () => void;
  onClose: () => void;
  onExportTiff: () => void;
}

let { open, issues, counts, busy, onRun, onClose, onExportTiff }: FigureCheckDialogProps = $props();

function issueText(issue: ComplianceIssue): string {
  const params = issue.params;
  switch (issue.code) {
    case 'fontTiny':
      return fm.figCheckFontTiny({ name: issue.name, size: params.size ?? '' });
    case 'fontSmall':
      return fm.figCheckFontSmall({ name: issue.name, size: params.size ?? '' });
    case 'strokeThin':
      return fm.figCheckStrokeThin({ name: issue.name, size: params.size ?? '' });
    case 'imageLowDpi':
      return fm.figCheckImageLowDpi({ name: issue.name, dpi: params.dpi ?? '' });
    case 'imageVeryLowDpi':
      return fm.figCheckImageVeryLowDpi({ name: issue.name, dpi: params.dpi ?? '' });
    case 'seriesColorsClose':
      return fm.figCheckSeriesColors({ a: params.a ?? '', b: params.b ?? '' });
    case 'textOverflow':
      return fm.figCheckTextOverflow({ name: issue.name });
    default:
      return issue.name;
  }
}

</script>

{#if open}
  <div class="overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={fm.figCheckTitle()} data-testid="figure-check-dialog">
      <header>
        <span class="title"><ShieldCheck size={14} /> {fm.figCheckTitle()}</span>
        <button class="icon-btn" type="button" aria-label={fm.figCheckClose()} title={fm.figCheckClose()} data-testid="figure-check-x" onclick={onClose}>
          <X size={13} />
        </button>
      </header>

      <div class="summary">
        {#if busy}
          <span class="state"><Loader2 size={13} class="spin" /> {fm.figCheckRun()}…</span>
        {:else if counts.total === 0}
          <span class="state ok" data-testid="figure-check-pass"><CheckCircle2 size={13} /> {fm.figCheckPass()}</span>
        {:else}
          <span class="state warn"><AlertTriangle size={13} /> {fm.figCheckIssues({ n: counts.total })}</span>
          <span class="pix-dim">
            {counts.errors} error · {counts.warns} warn · {counts.infos} info
          </span>
        {/if}
      </div>

      <div class="issues">
        {#each issues as issue (issue.id)}
          <div class="issue severity-{issue.severity}" data-testid="figure-check-issue" data-severity={issue.severity}>
            <span class="dot"></span>
            <span>{issueText(issue)}</span>
          </div>
        {/each}
      </div>

      <footer>
        <button type="button" class="btn" onclick={onRun} disabled={busy} data-testid="figure-check-run">
          {fm.figCheckRun()}
        </button>
        <button type="button" class="btn primary" onclick={onExportTiff} disabled={busy}>
          {fm.figCheckExportTiff()}
        </button>
        <button type="button" class="btn" onclick={onClose} data-testid="figure-check-close">
          {fm.figCheckClose()}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(2, 6, 12, 0.72);
    font-family: var(--pix-font);
    font-size: 10px;
    color: var(--pix-fg);
  }
  .dialog {
    width: min(560px, 100%);
    max-height: min(640px, 88vh);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg-2);
    box-shadow: 6px 6px 0 rgba(0, 0, 0, 0.4);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px dashed var(--pix-border);
    padding-bottom: 6px;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--pix-border-hi);
    background: var(--pix-bg);
    color: var(--pix-fg);
    cursor: pointer;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: bold;
  }
  .state.ok {
    color: var(--pix-green);
  }
  .state.warn {
    color: #f2b84b;
  }
  .issues {
    flex: 1;
    min-height: 48px;
    max-height: 420px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px;
  }
  .issue {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 4px 6px;
    border-left: 3px solid var(--pix-border-hi);
    background: rgba(255, 255, 255, 0.03);
    line-height: 1.35;
  }
  .issue.severity-error {
    border-left-color: #ff5d5d;
  }
  .issue.severity-warn {
    border-left-color: #f2b84b;
  }
  .issue.severity-info {
    border-left-color: #4cd6ff;
  }
  .dot {
    width: 5px;
    height: 5px;
    margin-top: 3px;
    border-radius: 50%;
    background: currentColor;
    flex: 0 0 auto;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    border-top: 1px dashed var(--pix-border);
    padding-top: 6px;
  }
  .btn {
    padding: 4px 9px;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 9px;
    cursor: pointer;
  }
  .btn.primary {
    border-color: var(--pix-cyan);
    color: var(--pix-cyan);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .spin {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
