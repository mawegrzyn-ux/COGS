// Vitest configuration for the COGS frontend (component + hook tests).
//
// Notes:
// - Uses jsdom environment so React components can render into a DOM
// - Excludes E2E tests (those run via Playwright separately)
// - Inherits the Vite project config so module resolution mirrors the build
// - Setup file installs jest-dom matchers and Auth0 mock
//
// Run with:    npm run test
// Watch mode:  npm run test:watch

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: ['test/**', '**/node_modules/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        // Start permissive — raise as suite grows.
        lines: 10,
        functions: 10,
        branches: 10,
        statements: 10,
      },
    },
  },
});
