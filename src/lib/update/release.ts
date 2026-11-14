// Update check against the public GitHub releases feed. Deliberately check-only:
// the app never downloads or replaces itself, because an auto-updater would need
// signed and notarised installers plus a maintained signing key. The UI links to
// the release page and lets the user install the build for their platform.

export const RELEASES_API = 'https://api.github.com/repos/SPICE-Protein/SPICE_GUI/releases/latest';
export const RELEASES_PAGE = 'https://github.com/SPICE-Protein/SPICE_GUI/releases/latest';

export interface LatestRelease {
  /** Version without the leading `v`, for example `0.2.0`. */
  version: string;
  /** Raw tag as published, for example `v0.2.0`. */
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
  notes: string;
}

export interface UpdateCheckResult {
  current: string;
  latest: LatestRelease;
  updateAvailable: boolean;
}

/** Numeric parts plus the prerelease suffix. Returns null for junk. */
export function parseVersion(input: string): { core: number[]; pre: string[] } | null {
  const trimmed = input.trim().replace(/^v/i, '').split('+')[0];
  if (!trimmed) return null;
  const [corePart, prePart = ''] = trimmed.split('-', 2);
  const core = corePart.split('.').map((part) => {
    const value = Number(part);
    return Number.isFinite(value) && part !== '' ? value : Number.NaN;
  });
  if (core.some((value) => Number.isNaN(value))) return null;
  const pre = prePart ? prePart.split('.') : [];
  return { core, pre };
}

/** Semver ordering without build metadata: negative, zero, or positive. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  const length = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.core[index] ?? 0;
    const y = right.core[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // A release outranks any prerelease of the same core version.
  if (left.pre.length === 0 && right.pre.length > 0) return 1;
  if (left.pre.length > 0 && right.pre.length === 0) return -1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const bothNumeric = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '';
    if (bothNumeric) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Tolerant reader for one GitHub release object. */
export function parseRelease(raw: unknown): LatestRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.tag_name !== 'string' || typeof source.html_url !== 'string') return null;
  const tag = source.tag_name.trim();
  const version = tag.replace(/^v/i, '');
  if (!parseVersion(version)) return null;
  return {
    version,
    tag,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : tag,
    url: source.html_url,
    publishedAt: typeof source.published_at === 'string' ? source.published_at : '',
    notes: typeof source.body === 'string' ? source.body : '',
  };
}

export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<LatestRelease> {
  const response = await fetcher(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const release = parseRelease(await response.json());
  if (!release) throw new Error('Unexpected release payload');
  return release;
}

export async function checkForUpdate(
  current: string,
  fetcher: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const latest = await fetchLatestRelease(fetcher);
  return {
    current,
    latest,
    updateAvailable: compareVersions(current, latest.version) < 0,
  };
}
