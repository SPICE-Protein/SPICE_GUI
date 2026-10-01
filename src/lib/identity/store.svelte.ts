import type { OrcidProfile } from './orcid';
import { fetchOrcidProfile, normalizeOrcid } from './orcid';

export interface IdentityState {
  orcid: string;
  profile: OrcidProfile | null;
  loading: boolean;
  error: string | null;
}

const initial: IdentityState = { orcid: '', profile: null, loading: false, error: null };

/** Lightweight client-side identity store. Only public ORCID profile data is retained. */
export function createIdentityStore() {
  let state = $state<IdentityState>({ ...initial });

  return {
    get value() { return state; },
    /** Canonical signer display name — ONLY ever derived from a loaded ORCID
     *  profile (credit name preferred). Empty until verified identity exists. */
    get displayName(): string {
      const p = state.profile;
      if (!p) return '';
      return p.creditName || [p.givenNames, p.familyName].filter(Boolean).join(' ').trim() || p.orcid;
    },
    setOrcid(value: string) {
      state.orcid = normalizeOrcid(value);
      state.profile = null;
      state.error = null;
    },
    clear() { state = { ...initial }; },
    async load(orcid = state.orcid) {
      state.orcid = normalizeOrcid(orcid);
      state.loading = true;
      state.error = null;
      try {
        state.profile = await fetchOrcidProfile(state.orcid);
        // ELN default author is bound to the verified ORCID name — keep the
        // legacy key in sync so every reader (gene page, project PI prefill)
        // sees the same canonical name.
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('spice_author_name', this.displayName);
        } catch { /* ignore */ }
        return state.profile;
      } catch (error) {
        state.profile = null;
        state.error = error instanceof Error ? error.message : 'Unable to load ORCID profile';
        throw error;
      } finally {
        state.loading = false;
      }
    }
  };
}

export const identityStore = createIdentityStore();
