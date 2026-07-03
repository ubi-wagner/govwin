import { defineConfig } from '@playwright/test';

/**
 * E2E config. Drives a running, seeded instance at TEST_BASE_URL (default
 * :3000). The `setup` project authenticates each persona once (auth.setup.ts)
 * and saves storageState under e2e/.auth; persona projects reuse it. Boot + seed
 * are external (see docs/HITL_WIRING_AUDIT_RUNBOOK.md Step 0) so one instance
 * serves many specs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    // Use the pre-installed Chromium (the bundled build for this Playwright
    // version isn't downloaded in this environment); stable symlink.
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'admin',
      testMatch: /.*\.admin\.spec\.ts/,
      use: { storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
    {
      name: 'tenant',
      testMatch: /.*\.tenant\.spec\.ts/,
      use: { storageState: 'e2e/.auth/lighthouse.json' },
      dependencies: ['setup'],
    },
  ],
});
