// Tool-local message catalog accessor.
//
// The catalog ships beside the gel tool so the new batch and reproducible
// bundle UI is self-contained. If a key is also present in the generated
// Paraglide catalogs (for example after the messages are merged into
// project.inlang), that translation wins. Otherwise the local catalog is used,
// which keeps the tool working without touching shared message files.
//
// Calls read currentLocale.value so Svelte templates re-render when the app
// language changes.

import catalogs from './messages.json';
import * as paraglide from '$lib/paraglide/messages.js';
import { currentLocale } from '$lib/i18n.svelte.ts';

export type MessageParams = Record<string, string | number>;
export type MessageFunction = (params?: MessageParams) => string;

const english = catalogs.en;
export type GelMessageKey = keyof typeof english;
type MessageTable = { [K in GelMessageKey]: MessageFunction };

const catalogsByLocale = catalogs as unknown as Record<string, Record<string, string>>;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function resolve(key: string, params?: MessageParams): string {
  const generated = paraglide as unknown as Record<string, unknown>;
  const fn = generated[key];
  if (typeof fn === 'function') {
    try {
      return (fn as MessageFunction)(params);
    } catch {
      /* fall back to the local catalog */
    }
  }
  const locale = currentLocale.value;
  const table = catalogsByLocale[locale] ?? catalogsByLocale.en;
  const template = table?.[key] ?? english[key as GelMessageKey] ?? key;
  return interpolate(template, params);
}

const table = {} as MessageTable;
for (const key of Object.keys(english) as GelMessageKey[]) {
  table[key] = (params?: MessageParams) => resolve(key, params);
}

export const g = table;
