import { defineConfig } from 'vitest/config';

// Plain node environment: everything under test here is pure and takes its
// dependencies as arguments, so no workerd/miniflare harness is needed.
export default defineConfig({
  test: { include: ['test/**/*.spec.ts'] },
});
