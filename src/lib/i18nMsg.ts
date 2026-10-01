// Resolver for machine-readable i18n codes produced by the Rust backend.
// Protocol: an ASCII token `i18n:<key>` or `i18n:<key>::<v1>::<v2>...`.
// Rust never embeds localized prose — every user-visible string returned
// across the Tauri boundary is such a code, resolved here against the
// Paraglide catalogs. Unknown keys fall back to the raw token (never fake a
// translation), matching the "failure must be visible" policy.
import * as messages from '$lib/paraglide/messages.js';

const PREFIX = 'i18n:';

function messageFor(key: string): ((args?: Record<string, string>) => string) | undefined {
  const fn = (messages as unknown as Record<string, unknown>)[key];
  return typeof fn === 'function' ? (fn as (args?: Record<string, string>) => string) : undefined;
}

/** Resolve a single token (key + params already split). Returns null when unknown. */
function renderToken(key: string, params: string[]): string | null {
  const fn = messageFor(key);
  if (!fn) return null;
  try {
    if (!params.length) return fn();
    // Backend codes use positional {v1}{v2}... placeholders (repo convention).
    const args: Record<string, string> = {};
    params.forEach((p, i) => {
      args['v' + (i + 1)] = p;
    });
    return fn(args);
  } catch {
    // Missing/extra placeholder mismatch — show the raw token, never fake text.
    return null;
  }
}

/** Split a full `i18n:` token into key + params. */
function splitToken(token: string): { key: string; params: string[] } {
  const body = token.slice(PREFIX.length);
  const parts = body.split('::');
  return { key: parts[0], params: parts.slice(1) };
}

/**
 * If the whole string is exactly one `i18n:` token, resolve it; otherwise
 * return the input unchanged. Used for titles/messages that Rust emits as
 * standalone codes (Err strings, struct fields).
 */
export function resolveCode(s: string): string {
  if (!s || !s.startsWith(PREFIX)) return s;
  const { key, params } = splitToken(s);
  const out = renderToken(key, params);
  return out ?? s;
}

/**
 * Replace every embedded `i18n:` token inside a longer string (log lines such
 * as `` [ENGINE] build failed: i18n:beErrNoSystemToScan ``). A token ends at
 * the next `::` boundary or at end-of-string; params may themselves contain
 * single colons.
 */
export function localizeInline(s: string): string {
  if (!s || !s.includes(PREFIX)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf(PREFIX, i);
    if (at < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, at);
    // key: [A-Za-z0-9_]+
    let j = at + PREFIX.length;
    let key = '';
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) key += s[j++];
    // params: repeated `::<segment>` where a segment is anything up to the
    // next `::` followed by a plausible continuation, or end/whitespace-safe.
    const params: string[] = [];
    while (s.startsWith('::', j)) {
      j += 2;
      let seg = '';
      while (j < s.length && !s.startsWith('::', j)) {
        seg += s[j++];
      }
      params.push(seg);
    }
    const rendered = key ? renderToken(key, params) : null;
    out += rendered ?? s.slice(at, j);
    i = j;
  }
  return out;
}

/**
 * Deep-normalize a value coming from `invoke()`: every string field that is a
 * pure `i18n:` token gets resolved, in place, across objects/arrays.
 */
export function normalizePayload<T>(value: T): T {
  if (typeof value === 'string') return resolveCode(value) as unknown as T;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizePayload(value[i]);
    return value as unknown as T;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    for (const k of Object.keys(rec)) rec[k] = normalizePayload(rec[k]);
  }
  return value;
}
