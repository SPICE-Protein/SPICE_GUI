// Tool-local message catalog accessor.
//
// The catalog ships beside the blot tool so project integration, batch export
// and reproducibility strings work without editing shared message files. If a
// key is later merged into the generated Paraglide catalogs, that translation
// wins; otherwise the bundled seven-locale JSON is used.
//
// Reading currentLocale.value makes templates re-render when the app language
// changes.
import catalog from './messages.json';
import * as paraglide from '$lib/paraglide/messages.js';
import { currentLocale } from '$lib/i18n.svelte.ts';

export type BlotMessageKey = keyof typeof catalog.en;
export type MessageParams = Record<string, string | number>;
export type MessageFunction = (params?: MessageParams) => string;

const fallback = catalog.en as Record<string, string>;
const tables = catalog as unknown as Record<string, Record<string, string>>;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function resolve(key: BlotMessageKey, params?: MessageParams): string {
  const compiled = (paraglide as unknown as Record<string, unknown>)[key];
  if (typeof compiled === 'function') {
    try {
      return (compiled as MessageFunction)(params);
    } catch {
      /* fall back to the local catalog */
    }
  }
  const locale = currentLocale.value;
  const table = tables[locale] ?? fallback;
  return interpolate(table[key] ?? fallback[key] ?? key, params);
}

type MessageTable = { [K in BlotMessageKey]: MessageFunction };

export const tm = {} as MessageTable;
for (const key of Object.keys(fallback) as BlotMessageKey[]) {
  tm[key] = (params?: MessageParams) => resolve(key, params);
}
