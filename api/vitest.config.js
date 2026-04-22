// Vitest configuration for the COGS API.
//
// - Node environment (no DOM)
// - Globals enabled so tests can use describe/it/expect without imports
// - Each test file runs in its own worker so PG connection pools stay clean
// - Coverage via v8; defaults are intentionally LOW thresholds (we'll raise as we add tests)
// - test/setup.js wires up env vars + global hooks for transaction-rolled tests

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    poolOptions: {
      forks: {
        // One file per fork so each test file gets a fresh module graph
        // (needed because pool.js caches a singleton pg.Pool).
        singleFork: false,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'test/**',
        'scripts/**',
        'src/index.js',           // entry point, exercised via integration
        '**/node_modules/**',
      ],
      // Soft thresholds — fail CI if we regress below current baseline.
      // Raise these every time we land a meaningful test pass.
      thresholds: {
        lines: 25,
        functions: 25,
        branches: 20,
        statements: 25,
      },
    },
  },
});
