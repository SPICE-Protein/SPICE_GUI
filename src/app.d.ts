/// <reference types="vite/client" />

/** package.json version, injected by vite.config.js. */
declare const __APP_VERSION__: string;

declare module '*.lua?raw' {
  const source: string;
  export default source;
}

// See https://svelte.dev/docs/kit/types#app
declare namespace App {
  // interface Error {}
  // interface Locals {}
  // interface PageData {}
  // interface PageState {}
  // interface Platform {}
}
