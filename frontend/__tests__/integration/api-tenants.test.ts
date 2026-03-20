/**
 * Integration tests for tenant CRUD operations.
 *
 * Tests tenant listing, creation, updates, user management,
 * and profile operations against the test database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_USERS } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

describe('Tenant listing', () => {
  it('returns all tenants with stats', async () => {
    const tenants = await testSql`
      SELECT t.id, t.slug, t.name, t.plan, t.status,
        (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) as user_count,
        (SELECT COUNT(*)::int FROM tenant_opportunities to2 WHERE to2.tenant_id = t.id) as opp_count
      FROM tenants t
      ORDER BY t.name
    `
    expect(tenants.length).toBeGreaterThanOrEqual(2)

    const tf = tenants.find(t => t.id === TEST_TENANTS.techforward.id)
    expect(tf).toBeDefined()
    expect(tf!.userCount).toBe(2) // alice + bob
    expect(tf!.oppCount).toBe(6)

    const cp = tenants.find(t => t.id === TEST_TENANTS.clearpath.id)
    expect(cp).toBeDefined()
    expect(cp!.userCount).toBe(1) // carol
    expect(cp!.oppCount).toBe(2)
  })

  it('tenant slugs are unique', async () => {
    const slugs = await testSql`SELECT slug FROM tenants`
    const slugList = slugs.map(s => s.slug)
    expect(new Set(slugList).size).toBe(slugList.length)
  })
})

describe('Tenant detail', () => {
  it('returns tenant with profile', async () => {
    const [tenant] = await testSql`
      SELECT t.*, tp.primary_naics, tp.keyword_domains,
             tp.is_sdvosb, tp.is_8a, tp.min_surface_score, tp.high_priority_score
      FROM tenants t
      JOIN tenant_profiles tp ON tp.tenant_id = t.id
      WHERE t.id = ${TEST_TENANTS.techforward.id}
    `
    expect(tenant).toBeDefined()
    expect(tenant.slug).toBe('techforward-solutions')
    expect(tenant.plan).toBe('professional')
    expect(tenant.isSdvosb).toBe(true)
    expect(tenant.primaryNaics).toContain('541512')
    expect(tenant.keywordDomains).toHaveProperty('Cloud & Infrastructure')
  })

  it('returns tenant users', async () => {
    const users = await testSql`
      SELECT id, name, email, role, is_active
      FROM users WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY name
    `
    expect(users.length).toBe(2)
    expect(users.map(u => u.email)).toContain('alice@techforward.test')
    expect(users.map(u => u.email)).toContain('bob@techforward.test')
  })
})

describe('Tenant creation', () => {
  it('can create a new tenant', async () => {
    const newId = 'd3333333-3333-3333-3333-333333333333'
    await testSql`
      INSERT INTO tenants (id, slug, name, legal_name, plan, status, primary_email, billing_email)
      VALUES (${newId}, 'new-company', 'New Company Inc', 'New Company Inc', 'starter', 'trial',
              'info@new.test', 'billing@new.test')
    `

    const [tenant] = await testSql`SELECT * FROM tenants WHERE id = ${newId}`
    expect(tenant).toBeDefined()
    expect(tenant.slug).toBe('new-company')
    expect(tenant.status).toBe('trial')
  })

  it('rejects duplicate slug', async () => {
    await expect(testSql`
      INSERT INTO tenants (id, slug, name, plan, status, primary_email, billing_email)
      VALUES ('e4444444-4444-4444-4444-444444444444', 'techforward-solutions', 'Dupe', 'starter', 'active',
              'dupe@test.com', 'dupe@test.com')
    `).rejects.toThrow()
  })
})

describe('Tenant updates', () => {
  it('can update tenant plan', async () => {
    await testSql`
      UPDATE tenants SET plan = 'enterprise'
      WHERE id = ${TEST_TENANTS.techforward.id}
    `
    const [t] = await testSql`SELECT plan FROM tenants WHERE id = ${TEST_TENANTS.techforward.id}`
    expect(t.plan).toBe('enterprise')

    // Restore
    await testSql`
      UPDATE tenants SET plan = 'professional'
      WHERE id = ${TEST_TENANTS.techforward.id}
    `
  })

  it('can update tenant status', async () => {
    await testSql`
      UPDATE tenants SET status = 'suspended'
      WHERE id = ${TEST_TENANTS.clearpath.id}
    `
    const [t] = await testSql`SELECT status FROM tenants WHERE id = ${TEST_TENANTS.clearpath.id}`
    expect(t.status).toBe('suspended')

    // Restore
    await testSql`
      UPDATE tenants SET status = 'trial'
      WHERE id = ${TEST_TENANTS.clearpath.id}
    `
  })
})

describe('User management', () => {
  it('can create a user for a tenant', async () => {
    const newUserId = 'user-new-001'
    await testSql`
      INSERT INTO users (id, name, email, role, tenant_id, password_hash, is_active)
      VALUES (${newUserId}, 'New User', 'new@techforward.test', 'tenant_user',
              ${TEST_TENANTS.techforward.id},
              '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy',
              true)
    `
    const [user] = await testSql`SELECT * FROM users WHERE id = ${newUserId}`
    expect(user.email).toBe('new@techforward.test')
    expect(user.tenantId).toBe(TEST_TENANTS.techforward.id)
  })

  it('rejects duplicate email', async () => {
    await expect(testSql`
      INSERT INTO users (id, name, email, role, tenant_id, password_hash, is_active)
      VALUES ('user-dupe-001', 'Dupe', 'alice@techforward.test', 'tenant_user',
              ${TEST_TENANTS.techforward.id},
              '$2a$10$hash', true)
    `).rejects.toThrow()
  })

  it('user cannot belong to nonexistent tenant', async () => {
    await expect(testSql`
      INSERT INTO users (id, name, email, role, tenant_id, password_hash, is_active)
      VALUES ('user-orphan-001', 'Orphan', 'orphan@test.com', 'tenant_user',
              'nonexistent-tenant-id',
              '$2a$10$hash', true)
    `).rejects.toThrow()
  })
})

describe('Portal profile', () => {
  it('getTenantBySlug returns active tenant', async () => {
    const [tenant] = await testSql`
      SELECT id, slug, name, status, plan, features
      FROM tenants
      WHERE slug = 'techforward-solutions' AND status = 'active'
    `
    expect(tenant).toBeDefined()
    expect(tenant.id).toBe(TEST_TENANTS.techforward.id)
    expect(tenant.features).toHaveProperty('llm_analysis')
  })

  it('getTenantBySlug returns null for inactive slug', async () => {
    const result = await testSql`
      SELECT id FROM tenants
      WHERE slug = 'nonexistent-slug' AND status = 'active'
    `
    expect(result.length).toBe(0)
  })
})

describe('Download links', () => {
  it('returns download links scoped to tenant', async () => {
    const links = await testSql`
      SELECT * FROM download_links
      WHERE tenant_id = ${TEST_TENANTS.techforward.id} AND is_active = true
    `
    expect(links.length).toBe(3)

    const clearLinks = await testSql`
      SELECT * FROM download_links
      WHERE tenant_id = ${TEST_TENANTS.clearpath.id} AND is_active = true
    `
    expect(clearLinks.length).toBe(1)
  })
})
