// The kit's own suites, as Cyber runs them (its vitest.config.ts): plain Node, and jsdom for the UI
// library's and the dev host page's logic. Written by Cyber's scripts/sdk-export.mjs.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const EXCLUDE = ['**/node_modules/**', '**/dist/**'];
const at = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': at('./src'), '@game': at('./shared/game') } },
  test: {
    globals: true,
    // A guard against a hang, not a speed check: the meter and render tests take seconds on a slow runner.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    exclude: EXCLUDE,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['scripts/**/*.test.mjs', 'sdk/packages/{tools,cli}/**/*.test.{ts,mjs}', 'sdk/fixtures/**/*.test.{ts,mjs}', 'sdk/tests/**/*.test.ts', 'sdk/packages/ui/*.test.mjs', 'sdk/devhost/*.test.mjs'],
          exclude: EXCLUDE,
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.mjs'],
          include: ['sdk/packages/ui/src/**/*.test.ts', 'sdk/devhost/src/**/*.test.ts'],
          exclude: EXCLUDE,
        },
      },
    ],
  },
});
