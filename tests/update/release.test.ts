import { describe, expect, it, vi } from 'vitest';
import {
  RELEASES_API,
  checkForUpdate,
  compareVersions,
  fetchLatestRelease,
  parseRelease,
  parseVersion,
} from '../../src/lib/update/release';

const releasePayload = {
  tag_name: 'v0.3.0',
  name: 'SPICE GUI 0.3.0',
  html_url: 'https://github.com/SPICE-Protein/SPICE_GUI/releases/tag/v0.3.0',
  published_at: '2026-12-01T10:00:00Z',
  body: 'Notes',
};

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return vi.fn(async () => response as Response) as unknown as typeof fetch;
}

describe('version parsing', () => {
  it('accepts tags and build metadata but rejects junk', () => {
    expect(parseVersion('v1.2.3')?.core).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3+build.7')?.core).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3-rc.1')?.pre).toEqual(['rc', '1']);
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('orders releases above prereleases and compares numerically', () => {
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
  });
});

describe('release payload', () => {
  it('normalises a GitHub release', () => {
    const release = parseRelease(releasePayload);
    expect(release).toMatchObject({
      version: '0.3.0',
      tag: 'v0.3.0',
      name: 'SPICE GUI 0.3.0',
      publishedAt: '2026-12-01T10:00:00Z',
    });
  });

  it('rejects payloads without a usable tag or url', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ tag_name: 'v0.3.0' })).toBeNull();
    expect(parseRelease({ tag_name: 'latest', html_url: 'https://example.test' })).toBeNull();
  });

  it('requests the latest release endpoint and surfaces HTTP failures', async () => {
    const fetcher = fakeFetch({ ok: true, json: async () => releasePayload });
    const release = await fetchLatestRelease(fetcher);
    expect(release.version).toBe('0.3.0');
    expect(fetcher).toHaveBeenCalledWith(RELEASES_API, expect.objectContaining({
      headers: { Accept: 'application/vnd.github+json' },
    }));

    await expect(fetchLatestRelease(fakeFetch({ ok: false, status: 403 }))).rejects.toThrow('403');
  });
});

describe('update check', () => {
  it('reports an available update when the release is newer', async () => {
    const result = await checkForUpdate('0.2.0', fakeFetch({ ok: true, json: async () => releasePayload }));
    expect(result.updateAvailable).toBe(true);
    expect(result.latest.version).toBe('0.3.0');
  });

  it('reports the latest version when nothing is newer', async () => {
    const result = await checkForUpdate('0.3.0', fakeFetch({ ok: true, json: async () => releasePayload }));
    expect(result.updateAvailable).toBe(false);
  });

  it('treats a newer local build as up to date', async () => {
    const result = await checkForUpdate('0.4.0', fakeFetch({ ok: true, json: async () => releasePayload }));
    expect(result.updateAvailable).toBe(false);
  });
});
