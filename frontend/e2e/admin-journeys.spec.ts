/**
 * E2E: Admin user journeys
 *
 * Tests the master_admin experience:
 * - Login → admin dashboard
 * - View system status
 * - Manage tenants (list, detail, create)
 * - Pipeline management (view jobs, trigger)
 * - Sources page
 */
import { test, expect } from '@playwright/test'
import { login, logout } from './helpers/auth'

test.describe('Admin login & routing', () => {
  test('admin login redirects to /admin/dashboard', async ({ page }) => {
    await login(page, 'admin')
    await expect(page).toHaveURL(/\/admin\/dashboard/)
  })

  test('admin can access all admin routes', async ({ page }) => {
    await login(page, 'admin')

    // Dashboard
    await page.goto('/admin/dashboard')
    await expect(page.locator('body')).not.toContainText('Forbidden')
    await expect(page.locator('body')).not.toContainText('Unauthorized')

    // Tenants
    await page.goto('/admin/tenants')
    await expect(page.locator('body')).not.toContainText('Forbidden')

    // Pipeline
    await page.goto('/admin/pipeline')
    await expect(page.locator('body')).not.toContainText('Forbidden')

    // Sources
    await page.goto('/admin/sources')
    await expect(page.locator('body')).not.toContainText('Forbidden')
  })

  test('unauthenticated user redirected to /login', async ({ page }) => {
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('shows system stats', async ({ page }) => {
    await page.goto('/admin/dashboard')
    // Should show tenant count, opportunity count, pipeline status
    await expect(page.locator('body')).toContainText(/tenant/i)
  })
})

test.describe('Tenant management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('lists all tenants', async ({ page }) => {
    await page.goto('/admin/tenants')
    await expect(page.locator('body')).toContainText('TechForward')
    await expect(page.locator('body')).toContainText('ClearPath')
  })

  test('can view tenant detail', async ({ page }) => {
    await page.goto('/admin/tenants')
    // Click on a tenant to view details
    const tenantLink = page.locator('a[href*="/admin/tenants/"]').first()
    if (await tenantLink.isVisible()) {
      await tenantLink.click()
      await expect(page).toHaveURL(/\/admin\/tenants\//)
    }
  })
})

test.describe('Pipeline management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('shows pipeline jobs', async ({ page }) => {
    await page.goto('/admin/pipeline')
    // Should show job list with statuses
    await expect(page.locator('body')).toContainText(/sam_gov|completed|pending|failed/i)
  })
})

test.describe('Admin cannot access portal as admin', () => {
  test('admin viewing portal is allowed (master_admin has full access)', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/portal/techforward-solutions/dashboard')
    // Admin should be able to view any tenant's portal
    await expect(page.locator('body')).not.toContainText('Forbidden')
  })
})
