// Tool-local message catalog accessor for Figure Studio.
//
// Figure Studio strings ship in ./messages.json so this tool can carry its own
// translations without editing project.inlang. If the generated Paraglide
// catalog later defines the same key, that translation wins.
//
// Calls read currentLocale.value so Svelte templates re-render when the app
// language changes.

import catalogs from './messages.json';
import * as paraglide from '$lib/paraglide/messages.js';
import { currentLocale } from '$lib/i18n.svelte.ts';

export type MessageParams = Record<string, string | number>;
export type MessageFunction = (params?: MessageParams) => string;

const english = catalogs.en;
export type FigureMessageKey = keyof typeof english;
type MessageTable = { [K in FigureMessageKey]: MessageFunction };

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
  const template = table?.[key] ?? english[key as FigureMessageKey] ?? key;
  return interpolate(template, params);
}

const table = {} as MessageTable;
for (const key of Object.keys(english) as FigureMessageKey[]) {
  table[key] = (params?: MessageParams) => resolve(key, params);
}

export const fm = table;
