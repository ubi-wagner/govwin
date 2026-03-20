/**
 * E2E auth helpers — log in as test personas via the login page.
 */
import { type Page, expect } from '@playwright/test'

const TEST_PASSWORD = 'TestPass123!'

export const testUsers = {
  admin: { email: 'admin@govwin.test', password: TEST_PASSWORD },
  alice: { email: 'alice@techforward.test', password: TEST_PASSWORD },
  bob:   { email: 'bob@techforward.test', password: TEST_PASSWORD },
  carol: { email: 'carol@clearpath.test', password: TEST_PASSWORD },
}

/**
 * Log in via the login page. Waits for redirect to confirm success.
 */
export async function login(page: Page, user: keyof typeof testUsers) {
  const { email, password } = testUsers[user]

  await page.goto('/login')
  await page.fill('input[type="email"], input[name="email"]', email)
  await page.fill('input[type="password"], input[name="password"]', password)
  await page.click('button[type="submit"]')

  // Wait for redirect away from login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 10_000 })
}

/**
 * Log out via the UI or by clearing cookies.
 */
export async function logout(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
}
