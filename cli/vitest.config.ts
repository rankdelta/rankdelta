import { defineConfig } from 'vitest/config';

// Self-contained config so vitest does NOT climb to the parent app's vite.config.ts
// (which loads the TanStack router plugin and scans src/routes).
export default defineConfig({
  root: __dirname,
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
