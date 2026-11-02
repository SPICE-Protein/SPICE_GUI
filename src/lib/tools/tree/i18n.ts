// Message resolver for the tree tool.
//
// The generated Paraglide catalog only reads project.inlang messages. This
// module keeps the tree tool self-contained: call sites still use the familiar
// `m.treeXxx()` shape, shared keys resolve through Paraglide, and tool-local
// keys come from ./messages.json in the active locale.
import * as paraglide from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import catalog from './messages.json';

type MessageParams = Record<string, string | number>;
type MessageFn = (params?: MessageParams) => string;

const tables = catalog as unknown as Record<string, Record<string, string>>;
const fallbackTable = tables.en ?? tables.zh ?? {};

function currentTable(): Record<string, string> {
  let locale = 'en';
  try {
    locale = getLocale();
  } catch {
    // Server-side rendering or an unavailable runtime: use English.
  }
  return tables[locale] ?? fallbackTable;
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function localMessage(key: string, params?: MessageParams): string {
  const table = currentTable();
  const template = table[key] ?? fallbackTable[key] ?? key;
  return interpolate(template, params);
}

export const m = new Proxy({} as Record<string, MessageFn>, {
  get(_target, property) {
    if (typeof property !== 'string') return undefined;
    const shared = (paraglide as unknown as Record<string, unknown>)[property];
    if (typeof shared === 'function') return shared as MessageFn;
    return (params?: MessageParams) => localMessage(property, params);
  },
  has(_target, property) {
    if (typeof property !== 'string') return false;
    return property in paraglide || property in fallbackTable;
  }
}) as unknown as Record<string, MessageFn>;
