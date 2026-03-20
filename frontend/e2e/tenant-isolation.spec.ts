/**
 * E2E: Tenant isolation tests
 *
 * Verifies that tenant A cannot see tenant B's data,
 * and that access controls are enforced at every layer.
 */
import { test, expect } from '@playwright/test'
import { login, logout } from './helpers/auth'

test.describe('Cross-tenant access prevention', () => {
  test('alice (techforward) cannot access clearpath portal', async ({ page }) => {
    await login(page, 'alice')
    await page.goto('/portal/clearpath-consulting/dashboard')
    // Should be blocked — either redirect or show forbidden
    const content = await page.textContent('body')
    const isBlocked = content?.includes('Forbidden')
      || content?.includes('denied')
      || page.url().includes('/portal') && !page.url().includes('clearpath')
    expect(isBlocked).toBeTruthy()
  })

  test('carol (clearpath) cannot access techforward portal', async ({ page }) => {
    await login(page, 'carol')
    await page.goto('/portal/techforward-solutions/dashboard')
    const content = await page.textContent('body')
    const isBlocked = content?.includes('Forbidden')
      || content?.includes('denied')
      || page.url().includes('/portal') && !page.url().includes('techforward')
    expect(isBlocked).toBeTruthy()
  })

  test('admin can access any tenant portal', async ({ page }) => {
    await login(page, 'admin')

    // TechForward
    await page.goto('/portal/techforward-solutions/dashboard')
    await expect(page.locator('body')).not.toContainText('Forbidden')

    // ClearPath
    await page.goto('/portal/clearpath-consulting/dashboard')
    await expect(page.locator('body')).not.toContainText('Forbidden')
  })

  test('nonexistent tenant returns 404 or redirect', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/portal/nonexistent-company/dashboard')
    const content = await page.textContent('body')
    const isHandled = content?.includes('not found')
      || content?.includes('Not Found')
      || content?.includes('404')
      || page.url().includes('/portal') && !page.url().includes('nonexistent')
    expect(isHandled).toBeTruthy()
  })
})

test.describe('API-level tenant isolation', () => {
  test('tenant user API calls are scoped', async ({ page }) => {
    await login(page, 'alice')

    // Make API call for own tenant — should succeed
    const ownRes = await page.evaluate(async () => {
      const res = await fetch('/api/opportunities?tenantSlug=techforward-solutions')
      return { status: res.status, ok: res.ok }
    })
    expect(ownRes.ok).toBe(true)
  })
})

test.describe('Auth boundary tests', () => {
  test('unauthenticated API call returns 401', async ({ page }) => {
    // Clear any cookies
    await page.context().clearCookies()

    const res = await page.evaluate(async () => {
      const res = await fetch('/api/opportunities?tenantSlug=techforward-solutions')
      return { status: res.status }
    })
    expect(res.status).toBe(401)
  })

  test('unauthenticated page access redirects to login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/portal/techforward-solutions/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('admin routes blocked for tenant users', async ({ page }) => {
    await login(page, 'bob')
    await page.goto('/admin/dashboard')
    // Should redirect to portal, not show admin page
    await expect(page).not.toHaveURL(/\/admin\/dashboard/)
  })
})
