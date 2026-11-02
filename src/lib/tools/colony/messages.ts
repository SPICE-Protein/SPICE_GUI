// Tool-local message catalog accessor.
//
// The catalog ships beside the tool so the colony counter is self-contained.
// If the same keys are present in the generated Paraglide catalogs (for example
// after the tool messages are merged into project.inlang), those translations
// win. Otherwise the bundled per-locale JSON is used, which keeps the tool
// working without touching shared message files.
//
// Reading currentLocale.value makes templates re-render when the app language
// changes.
import catalog from './messages.json';
import * as paraglide from '$lib/paraglide/messages.js';
import { currentLocale } from '$lib/i18n.svelte.ts';

type Catalog = typeof catalog;
export type ColonyLocale = keyof Catalog;
export type ColonyMessageKey = keyof Catalog['en'];
export type MessageParams = Record<string, string | number>;
export type MessageFunction = (params?: MessageParams) => string;

const fallback = catalog.en as Record<string, string>;
const tables = catalog as unknown as Record<string, Record<string, string>>;

export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function resolve(key: ColonyMessageKey, params?: MessageParams): string {
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
  return formatMessage(table[key] ?? fallback[key] ?? key, params);
}

type MessageTable = { [K in ColonyMessageKey]: MessageFunction };

export const m = {} as MessageTable;
for (const key of Object.keys(fallback) as ColonyMessageKey[]) {
  m[key] = (params?: MessageParams) => resolve(key, params);
}

export function t(key: ColonyMessageKey, params?: MessageParams): string {
  return m[key](params);
}
