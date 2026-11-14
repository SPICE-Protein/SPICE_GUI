<script lang="ts">
  // External BLAST panel for the gene workbench. NCBI jobs return nucleotide
  // or protein hits; UniProt jobs go through EBI and return protein hits.
  // Results stay in this panel — loading a hit is an explicit action.
  import { onDestroy, onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getAminoAcidStringFromSequenceString } from '$lib/genome';
  import { fetchNcbiProteinFasta, fetchUniprotFasta, runBlast } from './client';
  import type { BlastHit, BlastHsp, BlastProgram, BlastProgress, BlastResult } from './types';

  let {
    getCurrentSequence,
    onLoadNucleotide,
    onSendProtein,
    pushToast,
    pushLog,
  } = $props<{
    getCurrentSequence: () => string;
    onLoadNucleotide?: (accession: string) => void;
    onSendProtein?: (sequence: string, name: string) => void;
    pushToast?: (type: 'success' | 'error' | 'info', title: string, text?: string) => void;
    pushLog?: (msg: string) => void;
  }>();

  type Tab = 'ncbi' | 'uniprot';
  let tab = $state<Tab>('ncbi');
  let ncbiProgram = $state<BlastProgram>('blastn');
  let ncbiDatabase = $state('refseq_rna');
  let ebiDatabase = $state('uniprotkb_swissprot');

  let query = $state('');
  let expectText = $state('1e-5');
  let maxHits = $state(50);
  let email = $state(
    (typeof localStorage !== 'undefined' && localStorage.getItem('spice_blast_email')) || '',
  );

  $effect(() => {
    try {
      localStorage.setItem('spice_blast_email', email);
    } catch {
      /* ignore quota */
    }
  });

  let running = $state(false);
  let progress = $state<BlastProgress | null>(null);
  let elapsedSec = $state(0);
  let error = $state('');
  let result = $state<BlastResult | null>(null);
  let openHit = $state(-1);
  let acting = $state('');
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const NUCLEOTIDE_DBS = [
    { v: 'refseq_rna', label: 'RefSeq RNA' },
    { v: 'refseq_genomic', label: 'RefSeq Genomic' },
    { v: 'core_nt', label: 'Core Nucleotide' },
    { v: 'nt', label: 'Nucleotide (nt)' },
  ];
  const PROTEIN_DBS = [
    { v: 'nr', label: 'Non-redundant (nr)' },
    { v: 'refseq_protein', label: 'RefSeq Protein' },
    { v: 'swissprot', label: 'Swiss-Prot' },
    { v: 'pdb', label: 'PDB' },
  ];
  const EBI_DBS = [
    { v: 'uniprotkb_swissprot', label: 'UniProtKB/Swiss-Prot' },
    { v: 'uniprotkb', label: 'UniProtKB' },
    { v: 'uniprotkb_trembl', label: 'UniProtKB/TrEMBL' },
  ];

  const databaseOptions = $derived(
    tab === 'uniprot' ? EBI_DBS : ncbiProgram === 'blastn' ? NUCLEOTIDE_DBS : PROTEIN_DBS,
  );
  const activeDatabase = $derived(tab === 'uniprot' ? ebiDatabase : ncbiDatabase);
  const program = $derived<BlastProgram>(tab === 'uniprot' ? 'blastp' : ncbiProgram);
  const needsEmail = $derived(tab === 'uniprot');

  function useCurrent() {
    const seq = getCurrentSequence().trim();
    if (seq) {
      query = seq;
      error = '';
    }
  }

  function translateCurrent() {
    const seq = getCurrentSequence().replace(/[^A-Za-z]/g, '').toUpperCase();
    if (!seq) return;
    const protein = getAminoAcidStringFromSequenceString(seq).replace(/\*/g, '');
    if (protein) {
      query = protein;
      error = '';
    }
  }

  function setTab(next: Tab) {
    if (running) return;
    tab = next;
    error = '';
    result = null;
    openHit = -1;
  }

  function setProgram(next: string) {
    ncbiProgram = next as BlastProgram;
    ncbiDatabase = next === 'blastn' ? 'refseq_rna' : 'swissprot';
  }

  function setDatabase(next: string) {
    if (tab === 'uniprot') ebiDatabase = next;
    else ncbiDatabase = next;
  }

  function stop() {
    controller?.abort();
  }

  function isAbort(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
  }

  async function run() {
    const sequence = query.trim();
    if (!sequence) {
      error = m.blastNoSequence();
      return;
    }
    if (needsEmail && !email.trim()) {
      error = m.blastEmailRequired();
      return;
    }
    const expect = Number.parseFloat(expectText);
    if (!Number.isFinite(expect) || expect <= 0) {
      error = m.blastExpectInvalid();
      return;
    }

    controller = new AbortController();
    running = true;
    progress = null;
    elapsedSec = 0;
    error = '';
    result = null;
    openHit = -1;
    const started = Date.now();
    timer = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - started) / 1000);
    }, 500);
    pushLog?.(`[BLAST] ${tab} ${program} db=${activeDatabase} len=${sequence.length}`);

    try {
      result = await runBlast(
        {
          provider: tab === 'ncbi' ? 'ncbi' : 'ebi',
          program,
          database: activeDatabase,
          sequence,
          expect,
          maxHits,
          email: email.trim() || undefined,
        },
        {
          signal: controller.signal,
          onProgress: (next) => {
            progress = next;
          },
        },
      );
      pushLog?.(`[BLAST] ${result.hits.length} hits in ${Math.round((Date.now() - started) / 1000)}s`);
      if (!result.hits.length) pushToast?.('info', m.blastTitle(), m.blastNoHits());
    } catch (err) {
      if (isAbort(err)) {
        error = m.blastCanceled();
        pushLog?.('[BLAST] canceled');
      } else {
        error = err instanceof Error ? err.message : String(err);
        pushLog?.(`[BLAST] failed: ${error}`);
        pushToast?.('error', m.blastTitle(), error);
      }
    } finally {
      running = false;
      progress = null;
      controller = null;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  }

  async function actOnHit(hit: BlastHit) {
    const accession = hit.accession || hit.id;
    if (!accession || acting) return;
    acting = accession;
    error = '';
    try {
      if (tab === 'ncbi' && program === 'blastn') {
        if (!onLoadNucleotide) throw new Error(m.blastActionUnavailable());
        onLoadNucleotide(accession);
      } else {
        if (!onSendProtein) throw new Error(m.blastActionUnavailable());
        const seq =
          tab === 'uniprot'
            ? await fetchUniprotFasta(accession)
            : await fetchNcbiProteinFasta(accession);
        onSendProtein(seq, hit.title || accession);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      pushToast?.('error', m.blastTitle(), error);
    } finally {
      acting = '';
    }
  }

  function statusText(): string {
    if (!running) return '';
    if (progress?.phase === 'fetching') return m.blastStatusFetching();
    if (progress?.phase === 'waiting') {
      return m.blastStatusWaiting({
        job: progress.jobId ?? '…',
        sec: String(elapsedSec),
      });
    }
    return m.blastStatusSubmitting();
  }

  function evalueText(value: number): string {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0';
    if (value < 1e-4) return value.toExponential(1);
    return value.toPrecision(2);
  }

  function coverage(hit: BlastHit): string {
    const best = hit.hsps[0];
    if (!best || !result?.queryLength) return '—';
    const pct = Math.min(100, (best.alignLen / result.queryLength) * 100);
    return `${pct.toFixed(0)}%`;
  }

  function alignment(hsp: BlastHsp): string {
    const width = 60;
    const out: string[] = [];
    for (let i = 0; i < hsp.alignLen; i += width) {
      const q = hsp.qseq.slice(i, i + width);
      const mid = hsp.midline.slice(i, i + width);
      const h = hsp.hseq.slice(i, i + width);
      out.push(`Q ${hsp.queryFrom + i}  ${q}`);
      out.push(`          ${mid}`);
      out.push(`S ${hsp.hitFrom + i}  ${h}`);
      out.push('');
    }
    return out.join('\n').trimEnd();
  }

  function hitRange(hit: BlastHit): string {
    const best = hit.hsps[0];
    if (!best) return '';
    return `${best.hitFrom}–${best.hitTo}`;
  }

  onMount(() => {
    query = getCurrentSequence().trim();
  });

  onDestroy(() => {
    controller?.abort();
    if (timer) clearInterval(timer);
  });
</script>

<div class="blast-panel" data-testid="blast-panel">
  <div class="blast-tabs" role="tablist">
    <button
      class="pix-btn {tab === 'ncbi' ? 'ok' : ''}"
      type="button"
      role="tab"
      aria-selected={tab === 'ncbi'}
      data-testid="blast-tab-ncbi"
      onclick={() => setTab('ncbi')}>{m.blastTabNcbi()}</button>
    <button
      class="pix-btn {tab === 'uniprot' ? 'ok' : ''}"
      type="button"
      role="tab"
      aria-selected={tab === 'uniprot'}
      data-testid="blast-tab-uniprot"
      onclick={() => setTab('uniprot')}>{m.blastTabUniprot()}</button>
  </div>

  <div class="hint pix-dim">{tab === 'uniprot' ? m.blastHintUniprot() : m.blastHintNcbi()}</div>

  <div class="query-box">
    <div class="query-head">
      <span>{m.blastQueryLabel()}</span>
      <div class="query-actions">
        <button class="pix-btn" type="button" data-testid="blast-use-current" onclick={useCurrent}>{m.blastUseCurrentBtn()}</button>
        {#if program === 'blastp'}
          <button class="pix-btn" type="button" data-testid="blast-translate" onclick={translateCurrent}>{m.blastTranslateBtn()}</button>
        {/if}
      </div>
    </div>
    <textarea class="pix-input" data-testid="blast-query" rows="4" bind:value={query}
      placeholder={m.blastQueryPlaceholder()}></textarea>
    <div class="query-meta pix-dim">
      {m.blastQueryLength({ length: String(query.replace(/[^A-Za-z]/g, '').length) })}
    </div>
  </div>

  <div class="form-row">
    <label>{m.blastProgramLabel()}
      <select class="pix-select" data-testid="blast-program" value={program}
        onchange={(event) => setProgram((event.currentTarget as HTMLSelectElement).value)}>
        {#if tab === 'ncbi'}
          <option value="blastn">{m.blastProgramBlastn()}</option>
        {/if}
        <option value="blastp">{m.blastProgramBlastp()}</option>
      </select>
    </label>
    <label>{m.blastDatabaseLabel()}
      <select class="pix-select" data-testid="blast-database" value={activeDatabase}
        onchange={(event) => setDatabase((event.currentTarget as HTMLSelectElement).value)}>
        {#each databaseOptions as db (db.v)}
          <option value={db.v}>{db.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="form-row">
    <label>{m.blastExpectLabel()}
      <input class="pix-input" data-testid="blast-expect" type="text" bind:value={expectText} />
    </label>
    <label>{m.blastMaxHitsLabel()}
      <select class="pix-select" bind:value={maxHits}>
        {#each [10, 25, 50, 100] as n (n)}
          <option value={n}>{n}</option>
        {/each}
      </select>
    </label>
    <label class="email-label" class:required={needsEmail}>{m.blastEmailLabel()}
      <input class="pix-input" data-testid="blast-email" type="email" bind:value={email}
        placeholder={m.blastEmailPlaceholder()} />
    </label>
  </div>

  <div class="run-row">
    <button class="pix-btn ok" data-testid="blast-run" type="button" disabled={running} onclick={run}>
      {running ? m.blastRunning() : m.blastRunBtn()}
    </button>
    {#if running}
      <button class="pix-btn" data-testid="blast-stop" type="button" onclick={stop}>{m.blastStopBtn()}</button>
    {/if}
    {#if running}<span class="status pix-dim" data-testid="blast-status">{statusText()}</span>{/if}
  </div>

  {#if needsEmail && !email.trim()}
    <div class="message warning">{m.blastEmailRequired()}</div>
  {/if}
  {#if error}
    <div class="message error" data-testid="blast-error">{error}</div>
  {/if}

  {#if result}
    <div class="results" data-testid="blast-results">
      <div class="results-head">
        <strong>{m.blastResultsTitle({ count: String(result.hits.length) })}</strong>
        <span class="pix-dim">{result.program} · {result.database} · {result.queryLength}</span>
      </div>
      {#if !result.hits.length}
        <div class="empty pix-dim">{m.blastNoHits()}</div>
      {:else}
        <div class="hit-header pix-dim">
          <span>{m.blastColHit()}</span>
          <span>{m.blastColOrganism()}</span>
          <span>{m.blastColLength()}</span>
          <span>{m.blastColEvalue()}</span>
          <span>{m.blastColIdentity()}</span>
          <span>{m.blastColCoverage()}</span>
        </div>
        <ul class="hit-list">
          {#each result.hits as hit, index (hit.accession + index)}
            <li class:open={openHit === index}>
              <button class="hit-row" type="button"
                aria-expanded={openHit === index}
                data-testid="blast-hit-{index}"
                onclick={() => (openHit = openHit === index ? -1 : index)}>
                <span class="hit-main">
                  <span class="acc">{hit.accession || hit.id}</span>
                  <span class="title" title={hit.title}>{hit.title}</span>
                </span>
                <span class="org" title={hit.organism}>{hit.organism || '—'}</span>
                <span>{hit.length || '—'}</span>
                <span>{evalueText(hit.hsps[0]?.evalue ?? Number.NaN)}</span>
                <span>{hit.hsps[0] ? `${hit.hsps[0].identity.toFixed(1)}%` : '—'}</span>
                <span>{coverage(hit)}</span>
              </button>
              {#if openHit === index}
                <div class="hit-detail">
                  <div class="detail-meta pix-dim">
                    <span>{m.blastColBitScore()}: {hit.hsps[0]?.bitScore.toFixed(1) ?? '—'}</span>
                    <span>{m.blastHitRange()}: {hitRange(hit)}</span>
                    <span>{m.blastColCoverage()}: {coverage(hit)}</span>
                    {#if hit.organism}<span>{hit.organism}</span>{/if}
                  </div>
                  {#if hit.hsps[0]}
                    <div class="align-label pix-dim">{m.blastAlignmentLabel()}</div>
                    <pre class="alignment">{alignment(hit.hsps[0])}</pre>
                  {/if}
                  <div class="detail-actions">
                    <button class="pix-btn ok" type="button" disabled={acting === (hit.accession || hit.id)}
                      data-testid="blast-hit-action"
                      onclick={() => actOnHit(hit)}>
                      {acting === (hit.accession || hit.id)
                        ? m.blastFetchingSequence()
                        : tab === 'ncbi' && program === 'blastn'
                          ? m.blastLoadGeneBtn()
                          : m.blastSendProteinBtn()}
                    </button>
                    {#if hit.accession}
                      <span class="pix-dim">{m.blastAccessionLabel()}: {hit.accession}</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .blast-panel {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px;
    font-family: var(--pix-font);
    font-size: 10px;
  }
  .blast-tabs {
    display: flex;
    gap: 4px;
  }
  .blast-tabs button {
    flex: 1;
    height: 22px;
    padding: 3px 6px;
    font-size: 9.5px;
  }
  .hint {
    font-size: 9px;
    line-height: 1.4;
  }
  .query-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--pix-border);
    padding: 6px;
  }
  .query-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    color: var(--pix-fg-dim);
  }
  .query-actions {
    display: flex;
    gap: 4px;
  }
  .query-actions button {
    height: 20px;
    padding: 1px 6px;
    font-size: 9px;
  }
  textarea.pix-input {
    min-height: 66px;
    resize: vertical;
    font-family: var(--pix-mono, monospace);
    font-size: 9.5px;
    line-height: 1.35;
    word-break: break-all;
  }
  .query-meta {
    font-size: 9px;
  }
  .form-row {
    display: flex;
    gap: 6px;
    align-items: flex-end;
  }
  .form-row label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: var(--pix-fg-dim);
  }
  .form-row select,
  .form-row input {
    min-width: 0;
    height: 22px;
    padding: 2px 4px;
    font-size: 9.5px;
  }
  .form-row .email-label {
    flex: 1.15;
  }
  .email-label.required input {
    border-color: var(--pix-accent);
  }
  .run-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .run-row .pix-btn {
    height: 24px;
    padding: 2px 12px;
    font-size: 10px;
  }
  .status {
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message {
    padding: 4px 6px;
    border: 1px solid var(--pix-border);
    color: var(--pix-fg-dim);
    word-break: break-word;
  }
  .message.error {
    color: var(--pix-red);
    border-color: var(--pix-red);
  }
  .message.warning {
    color: var(--pix-accent);
    border-color: var(--pix-accent);
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--pix-border);
    padding: 6px;
  }
  .results-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .results-head .pix-dim {
    font-size: 9px;
  }
  .hit-header,
  .hit-row {
    display: grid;
    grid-template-columns: minmax(0, 2.6fr) minmax(0, 1.1fr) 46px 62px 52px 52px;
    gap: 5px;
    align-items: center;
  }
  .hit-header {
    padding: 0 4px;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hit-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 300px;
    overflow: auto;
  }
  .hit-list li {
    border: 1px solid var(--pix-border);
    background: rgba(0, 0, 0, 0.25);
  }
  .hit-list li.open {
    border-color: var(--pix-cyan);
  }
  .hit-row {
    width: 100%;
    padding: 3px 5px;
    border: 0;
    background: transparent;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 9.5px;
    text-align: left;
    cursor: pointer;
  }
  .hit-row:hover {
    background: rgba(76, 214, 255, 0.08);
  }
  .hit-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .acc {
    color: var(--pix-cyan);
    font-weight: bold;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .org {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--pix-fg-dim);
  }
  .hit-row > span:not(.hit-main) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hit-detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border-top: 1px solid var(--pix-border);
  }
  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 9px;
  }
  .align-label {
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .alignment {
    margin: 0;
    padding: 5px 7px;
    max-height: 190px;
    overflow: auto;
    background: var(--pix-bg, #0b0e14);
    border: 1px solid var(--pix-border);
    color: var(--pix-fg-dim);
    font-family: var(--pix-mono, monospace);
    font-size: 9px;
    line-height: 1.35;
    white-space: pre;
  }
  .detail-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .detail-actions .pix-btn {
    height: 22px;
    padding: 2px 8px;
    font-size: 9.5px;
  }
  .detail-actions .pix-dim {
    font-size: 9px;
  }
  .empty {
    padding: 4px 1px;
  }
</style>
