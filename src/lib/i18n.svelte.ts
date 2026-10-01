// Reactive i18n wrapper around Paraglide-JS (Svelte 5 runes).
// Module-level reactive locale. Components read `currentLocale.value` so they
// re-render on language change. (Exporting a reassigned/derived $state directly
// is disallowed; mutating a property of an exported $state object is allowed.)
import { setLocale, getLocale, isLocale } from '$lib/paraglide/runtime.js';

export const currentLocale = $state<{ value: string }>({ value: getLocale() });

export function setLang(tag: string) {
  const t = isLocale(tag) ? tag : 'zh';
  setLocale(t);
  currentLocale.value = t;
}

export function toggleLang() {
  setLang(currentLocale.value === 'zh' ? 'en' : 'zh');
}
