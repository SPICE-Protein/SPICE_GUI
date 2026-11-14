/// <reference types="vite/client" />

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
