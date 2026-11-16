// Loaded risk data, shared by diagnostics, the synbio panel and the agent gate.
// Loading is read-only; refreshing a source or installing the biorisk database
// is an explicit user action.

import { backend } from '$lib/backend/api';
import type { AmrFinderRow, BiosecEnvelope, CommecStatus, RiskCatalogEnvelope } from '$lib/backend/types';
import type { DiagnosticFinding } from '$lib/diagnostics/types';
import { amrCatalogFromEnvelope, catalogCoverage } from './catalog';
import { bioriskHitsToFindings } from './biorisk';
import type { RiskCatalog } from './types';

const BIORISK_CACHE_LIMIT = 8;

export class RiskCatalogStore {
  amr = $state<RiskCatalog | null>(null);
  commec = $state<CommecStatus | null>(null);
  loading = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);
  bioriskLoading = $state(false);
  bioriskError = $state<string | null>(null);

  private bioriskCache = new Map<string, DiagnosticFinding[]>();
  private bioriskInflight = new Map<string, Promise<DiagnosticFinding[]>>();

  get catalogs(): RiskCatalog[] {
    return this.amr ? [this.amr] : [];
  }

  get coverage(): 'network' | 'cache' | 'sample' | 'none' {
    return catalogCoverage(this.catalogs);
  }

  get hasBiorisk(): boolean {
    return this.commec?.installed === true;
  }

  get totalRecords(): number {
    return (this.amr?.records.length ?? 0) + (this.commec?.models ?? 0);
  }

  /** Read the on-disk copies once per session; never touches the network. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded || this.loading) return;
    this.loading = true;
    try {
      const result = await backend.loadBiosec();
      this.applyEnvelope(result.data);
      this.error = result.error ?? null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.loaded = true;
    }
  }

  applyEnvelope(envelope: BiosecEnvelope) {
    this.amr = amrCatalogFromEnvelope(envelope.amr);
    this.commec = envelope.commec ?? null;
  }

  async refreshAmr(endpoint?: string): Promise<RiskCatalog> {
    this.loading = true;
    try {
      const result = await backend.syncAmrCatalog(endpoint);
      const envelope = result.data as RiskCatalogEnvelope<AmrFinderRow>;
      this.amr = amrCatalogFromEnvelope(envelope);
      this.loaded = true;
      this.error = result.error ?? envelope.error ?? null;
      return this.amr;
    } finally {
      this.loading = false;
    }
  }

  async installCommec(): Promise<CommecStatus> {
    this.loading = true;
    this.bioriskError = null;
    try {
      const result = await backend.installCommec();
      this.commec = result.data;
      this.error = result.error ?? null;
      this.bioriskCache.clear();
      return this.commec;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Screen one sequence through the profile-HMM database. Results are cached by
   * sequence and topology, so diagnostics and a later export reuse one scan.
   */
  async screenBiorisk(sequence: string, circular: boolean): Promise<DiagnosticFinding[]> {
    if (!this.commec?.installed || sequence.length < 50) return [];
    const key = `${circular ? 'c' : 'l'}:${sequence.length}:${fnv1a(sequence)}`;
    const cached = this.bioriskCache.get(key);
    if (cached) return cached;
    const running = this.bioriskInflight.get(key);
    if (running) return running;

    this.bioriskLoading = true;
    const promise = backend
      .screenBiorisk(sequence, circular)
      .then((result) => {
        if (result.error && result.data.length === 0) {
          this.bioriskError = result.error;
          return [];
        }
        const findings = bioriskHitsToFindings(result.data, this.commec);
        this.bioriskCache.set(key, findings);
        while (this.bioriskCache.size > BIORISK_CACHE_LIMIT) {
          const oldest = this.bioriskCache.keys().next().value;
          if (oldest === undefined) break;
          this.bioriskCache.delete(oldest);
        }
        return findings;
      })
      .catch((error) => {
        this.bioriskError = error instanceof Error ? error.message : String(error);
        return [];
      })
      .finally(() => {
        this.bioriskInflight.delete(key);
        this.bioriskLoading = false;
      });
    this.bioriskInflight.set(key, promise);
    return promise;
  }

  clearBioriskCache() {
    this.bioriskCache.clear();
  }
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const riskCatalogStore = new RiskCatalogStore();
