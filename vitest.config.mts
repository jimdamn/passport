import { defineConfig } from 'vitest/config';

// Plain node environment: everything under test here is pure and takes its
// dependencies as arguments, so no workerd/miniflare harness is needed.
// The Worker/D1 execution tests (Social Splash money paths) live under a
// separate pool - see vitest.workers.config.mts - because they need workerd,
// which breaks these tests' real node:fs reads.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: ['test/splash-money-paths.spec.ts'],
  },
});
