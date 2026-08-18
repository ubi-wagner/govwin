import { defineConfig } from '@playwright/test';

/**
 * E2E config. Drives a running, seeded instance at TEST_BASE_URL (default
 * :3000). The `setup` project authenticates each persona once (auth.setup.ts)
 * and saves storageState under e2e/.auth; persona projects reuse it. The `hitl`
 * project is self-authenticating (each spec logs in fresh) and drives the E2E
 * HITL cohort seeded by scripts/seed-e2e-hitl.mjs. Boot + seed are external
 * (see docs/E2E_HITL_RUNBOOK.md §1) so one instance serves many specs.
 */
export default defineConfig({
  testDir: './e2e',
  // Re-seed the stateful fixtures before every run (reset-then-run) so the gate is
  // reproducible — scripts/e2e_fixtures.sql via e2e/global-setup.ts (non-fatal).
  globalSetup: './e2e/global-setup.ts',
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
    {
      // Self-authenticating E2E-HITL specs (one login per role). No storageState /
      // setup dependency — each spec signs in fresh as an e2e-* account
      // (scripts/seed-e2e-hitl.mjs). Run: `npx playwright test --project=hitl`.
      name: 'hitl',
      testMatch: /hitl.*\.spec\.ts/,
    },
    {
      // Self-authenticating GUIDED DRIVES — specs that walk a full operator SOP end to end
      // as a real actor and screenshot each step into public/guides/<topic>/ for the
      // in-app guidebooks. No storageState / setup dependency: a drive signs in itself so
      // the login screen is part of the captured walkthrough.
      // Run: `npx playwright test --project=drive`.
      name: 'drive',
      testMatch: /.*-drive\.spec\.ts/,
    },
  ],
});
