import { describe, expect, it } from 'vitest';
import { normalizeSpdBaseUrl } from '$lib/spd/normalize';

const FALLBACK = 'https://d-api.spicebio.top/api/v1';

describe('normalizeSpdBaseUrl', () => {
  it('keeps a full API base and strips trailing slashes', () => {
    expect(normalizeSpdBaseUrl('https://d-api.spicebio.top/api/v1', FALLBACK))
      .toBe('https://d-api.spicebio.top/api/v1');
    expect(normalizeSpdBaseUrl('https://d-api.spicebio.top/api/v1///', FALLBACK))
      .toBe('https://d-api.spicebio.top/api/v1');
  });

  it('appends /api/v1 to a bare origin', () => {
    expect(normalizeSpdBaseUrl('https://d-api.spicebio.top', FALLBACK))
      .toBe('https://d-api.spicebio.top/api/v1');
    expect(normalizeSpdBaseUrl('https://d-api.spicebio.top/', FALLBACK))
      .toBe('https://d-api.spicebio.top/api/v1');
    expect(normalizeSpdBaseUrl('http://127.0.0.1:43117/', FALLBACK))
      .toBe('http://127.0.0.1:43117/api/v1');
  });

  it('falls back for empty values and the retired same-origin proxy', () => {
    expect(normalizeSpdBaseUrl('', FALLBACK)).toBe(FALLBACK);
    expect(normalizeSpdBaseUrl('   ', FALLBACK)).toBe(FALLBACK);
    expect(normalizeSpdBaseUrl('/api/v1', FALLBACK)).toBe(FALLBACK);
  });

  it('keeps a custom path untouched', () => {
    expect(normalizeSpdBaseUrl('https://example.test/spd/api/v2', FALLBACK))
      .toBe('https://example.test/spd/api/v2');
  });
});
