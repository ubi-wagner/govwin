/**
 * Playwright E2E test configuration.
 *
 * Runs user journey tests against a real Next.js server with test DB.
 * Start server: TEST_DATABASE_URL=... npm run dev -- --port 3099
 *
 * Usage:
 *   npx playwright test                    # run all
 *   npx playwright test --ui               # interactive mode
 *   npx playwright test --grep "admin"     # filter by name
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Sequential — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3099',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Optionally start the dev server before tests
  // Uncomment when ready for CI:
  // webServer: {
  //   command: 'npm run dev -- --port 3099',
  //   port: 3099,
  //   reuseExistingServer: !process.env.CI,
  //   env: {
  //     DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel_test',
  //   },
  // },
})
