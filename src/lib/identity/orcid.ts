/** Public ORCID record client. No credentials or private/authenticated endpoints are used. */

export const ORCID_PUBLIC_API = 'https://pub.orcid.org/v3.0';

export interface OrcidProfile {
  orcid: string;
  uri?: string;
  givenNames?: string;
  familyName?: string;
  creditName?: string;
  biography?: string;
  country?: string;
  institution?: string;
  lastModified?: string;
  retrievedAt: string;
}

export interface OrcidClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface OrcidRecordResponse {
  'orcid-identifier'?: { path?: string; uri?: string };
  person?: {
    name?: { 'given-names'?: { value?: string }; 'family-name'?: { value?: string }; 'credit-name'?: { value?: string } };
    biography?: { content?: string };
    addresses?: { address?: Array<{ country?: { value?: string } }> };
  };
  activities?: { affiliations?: { 'employments'?: { 'employment-summary'?: Array<{ organization?: { name?: string } }> } } };
  'last-modified-date'?: { value?: number };
}

export function normalizeOrcid(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\/(?:orcid\.org|pub\.orcid\.org)\//i, '');
  return trimmed.replace(/[^0-9X-]/gi, '').toUpperCase();
}

export function isValidOrcid(value: string): boolean {
  const id = normalizeOrcid(value).replace(/-/g, '');
  if (!/^\d{15}[\dX]$/.test(id)) return false;
  let total = 0;
  for (const digit of id.slice(0, 15)) total = (total + Number(digit)) * 2;
  const remainder = total % 11;
  const check = (12 - remainder) % 11;
  return (check === 10 ? 'X' : String(check)) === id[15];
}

export async function fetchOrcidProfile(orcid: string, options: OrcidClientOptions = {}): Promise<OrcidProfile> {
  const id = normalizeOrcid(orcid);
  if (!isValidOrcid(id)) throw new Error('Invalid ORCID iD');
  const requestFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? ORCID_PUBLIC_API).replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = options.timeoutMs === undefined ? 10_000 : options.timeoutMs;
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let response: Response;
  try {
    response = await requestFetch(`${baseUrl}/${encodeURIComponent(id)}/record`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`ORCID request failed (${response.status})`);
  const record = await response.json() as OrcidRecordResponse;
  const name = record.person?.name;
  const employment = record.activities?.affiliations?.employments?.['employment-summary']?.[0];
  return {
    orcid: normalizeOrcid(record['orcid-identifier']?.path ?? id),
    uri: record['orcid-identifier']?.uri ?? `https://orcid.org/${id}`,
    givenNames: name?.['given-names']?.value,
    familyName: name?.['family-name']?.value,
    creditName: name?.['credit-name']?.value,
    biography: record.person?.biography?.content,
    country: record.person?.addresses?.address?.[0]?.country?.value,
    institution: employment?.organization?.name,
    lastModified: record['last-modified-date']?.value ? new Date(record['last-modified-date'].value).toISOString() : undefined,
    retrievedAt: new Date().toISOString()
  };
}
