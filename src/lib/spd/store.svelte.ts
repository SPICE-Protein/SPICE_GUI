// SPD store: shared client factory + local id caches.
//
// The desktop app never re-creates proteins on repeat publishes: sequence and
// fold creation dedup server-side (by SHA-256 / identity hash), but protein
// rows do not. We cache the resolved public ids per sequence hash.
import { SpdClient, spdBaseUrl, spdToken } from './client';
import type { SpdHealth } from './types';

export { SpdClient };

export interface SpdClientOverrides { baseUrl?: string; token?: string }
export function configureSpdClient(options: SpdClientOverrides = {}) { return makeClient(options); }
export function makeClient(overrides: SpdClientOverrides = {}): SpdClient {
  return new SpdClient({ baseUrl: overrides.baseUrl ?? spdBaseUrl(), token: overrides.token ?? spdToken() });
}

const NS = 'spice_spd';
function local(): Storage | undefined { return typeof localStorage === 'undefined' ? undefined : localStorage; }
export function cachedProteinId(seqKey: string): string { return local()?.getItem(`${NS}_protein_${seqKey}`) || ''; }
export function cachedSequenceId(seqKey: string): string { return local()?.getItem(`${NS}_sequence_${seqKey}`) || ''; }
export function rememberProteinId(seqKey: string, id: string) { local()?.setItem(`${NS}_protein_${seqKey}`, id); }
export function rememberSequenceId(seqKey: string, id: string) { local()?.setItem(`${NS}_sequence_${seqKey}`, id); }
/** Every locally known sequence id (for graph-DSL batch queries: one POST
 *  /query with roots walks them all in a shared resolution budget). */
export function cachedSequenceEntries(): Array<{ seqKey: string; id: string }> {
  const store = local();
  if (!store) return [];
  const prefix = `${NS}_sequence_`;
  const out: Array<{ seqKey: string; id: string }> = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const id = store.getItem(key) || '';
    if (id) out.push({ seqKey: key.slice(prefix.length), id });
  }
  return out;
}
/** First publish prefills the name field from the last used protein name. */
export function lastProteinName(): string { return local()?.getItem(`${NS}_protein_name`) || ''; }
export function rememberProteinName(name: string) { local()?.setItem(`${NS}_protein_name`, name); }

export interface SpdStoreState { loading: boolean; error: string | null; health: SpdHealth | null }
export const spdState = $state<SpdStoreState>({ loading: false, error: null, health: null });

export const spdStore = {
  async loadHealth(client: SpdClient = makeClient()) {
    spdState.loading = true; spdState.error = null;
    try { spdState.health = await client.health(); return spdState.health; }
    catch (e) { spdState.error = e instanceof Error ? e.message : String(e); return null; }
    finally { spdState.loading = false; }
  },
  clear() { spdState.error = null; spdState.health = null; }
};
