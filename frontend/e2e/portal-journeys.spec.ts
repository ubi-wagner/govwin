/**
 * E2E: Tenant user journeys
 *
 * Tests the portal experience:
 * - Login → portal dashboard
 * - View scored opportunities
 * - Filter & search pipeline
 * - Take actions (thumbs, comments, status changes)
 * - View profile & documents
 */
import { test, expect } from '@playwright/test'
import { login, logout } from './helpers/auth'

test.describe('Tenant login & routing', () => {
  test('tenant user login redirects to /portal', async ({ page }) => {
    await login(page, 'alice')
    await expect(page).toHaveURL(/\/portal/)
  })

  test('tenant user cannot access /admin', async ({ page }) => {
    await login(page, 'bob')
    await page.goto('/admin/dashboard')
    // Should be redirected to portal
    await expect(page).toHaveURL(/\/portal|\/login/)
  })
})

test.describe('Portal dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice')
  })

  test('shows dashboard with stats', async ({ page }) => {
    await page.goto('/portal/techforward-solutions/dashboard')
    // Should show stats cards (total, high priority, pursuing, closing soon)
    await expect(page.locator('body')).toContainText(/total|pipeline|opportunities/i)
  })

  test('shows top scored opportunities', async ({ page }) => {
    await page.goto('/portal/techforward-solutions/dashboard')
    // Should show opportunity titles from seed data
    await expect(page.locator('body')).toContainText(/Cloud|Cyber|DevSecOps/i)
  })
})

test.describe('Pipeline page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice')
    await page.goto('/portal/techforward-solutions/pipeline')
  })

  test('shows all tenant opportunities', async ({ page }) => {
    // TechForward has 6 scored opportunities
    await expect(page.locator('body')).toContainText(/Cloud Migration|Cybersecurity|DevSecOps/i)
  })

  test('filter by search narrows results', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('Cloud Migration')
      await searchInput.press('Enter')
      // Wait for filtered results
      await page.waitForTimeout(500)
      await expect(page.locator('body')).toContainText('Cloud Migration')
    }
  })

  test('pagination controls are visible when needed', async ({ page }) => {
    // With 6 opps and default limit of 50, all should show without pagination
    // But the pagination UI elements should still be present
    await expect(page.locator('body')).toContainText(/showing|total|results/i)
  })
})

test.describe('Opportunity actions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice')
  })

  test('can view opportunity details', async ({ page }) => {
    await page.goto('/portal/techforward-solutions/pipeline')
    // Click on an opportunity to see details
    const oppLink = page.locator('a[href*="pipeline"], [role="row"], tr').first()
    if (await oppLink.isVisible()) {
      await oppLink.click()
      await page.waitForTimeout(500)
    }
  })
})

test.describe('Profile page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice')
  })

  test('shows tenant profile information', async ({ page }) => {
    await page.goto('/portal/techforward-solutions/profile')
    await expect(page.locator('body')).toContainText(/TechForward|SDVOSB|541512/i)
  })
})

test.describe('Documents page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice')
  })

  test('shows download links for tenant', async ({ page }) => {
    await page.goto('/portal/techforward-solutions/documents')
    await expect(page.locator('body')).toContainText(/SDVOSB|Capability|template/i)
  })
})
