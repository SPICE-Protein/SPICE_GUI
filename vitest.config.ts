import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pure algorithm tests only: no DOM, no Tauri, no generated Paraglide runtime.
// Keeping the suite headless makes it safe to run on every CI runner.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
