import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    sequence: { concurrent: false },
    include: ['__tests__/**/*.test.ts'],
    // DATABASE_URL default so a pure unit test that TRANSITIVELY imports lib/db.ts doesn't die on its
    // module-load guard in CI (where DATABASE_URL is unset). postgres.js connects lazily, so a
    // never-queried dummy is inert; a real DATABASE_URL (local/integration runs) is preserved.
    env: { DATABASE_URL: process.env.DATABASE_URL || 'postgresql://vitest:vitest@127.0.0.1:5432/vitest_noop' },
  },
  // Compile TSX the way Next does. Component files here use the AUTOMATIC JSX runtime (no
  // `import React`), while esbuild defaults to the classic one — so the first test to render a
  // component died with `ReferenceError: React is not defined`, which reads like a broken component
  // rather than a transform mismatch. This aligns the two; it changes no test's scope.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
});
