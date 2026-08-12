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
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
});
