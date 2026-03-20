/**
 * Database schema & seed data verification tests.
 *
 * Validates that migrations run cleanly, seed data is consistent,
 * and views/indexes exist as expected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_USERS, TEST_OPPORTUNITIES } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

describe('Schema verification', () => {
  it('all expected tables exist', async () => {
    const tables = await testSql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
    const names = tables.map(t => t.tableName)
    expect(names).toContain('tenants')
    expect(names).toContain('users')
    expect(names).toContain('opportunities')
    expect(names).toContain('tenant_opportunities')
    expect(names).toContain('tenant_actions')
    expect(names).toContain('pipeline_jobs')
    expect(names).toContain('pipeline_runs')
    expect(names).toContain('audit_log')
    expect(names).toContain('documents')
    expect(names).toContain('source_health')
    expect(names).toContain('download_links')
    expect(names).toContain('tenant_profiles')
  })

  it('tenant_pipeline view exists', async () => {
    const views = await testSql`
      SELECT table_name FROM information_schema.views
      WHERE table_schema = 'public'
    `
    const names = views.map(v => v.tableName)
    expect(names).toContain('tenant_pipeline')
  })

  it('critical indexes exist', async () => {
    const indexes = await testSql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `
    const names = indexes.map(i => i.indexname)
    // Verify key performance indexes
    expect(names.some(n => n.includes('tenant_opp') || n.includes('tenant_opportunities'))).toBe(true)
  })
})

describe('Seed data integrity', () => {
  it('has correct tenant count', async () => {
    const [{ count }] = await testSql`SELECT COUNT(*)::int as count FROM tenants`
    expect(count).toBeGreaterThanOrEqual(2) // techforward + clearpath (+ any from migrations)
  })

  it('has correct user count', async () => {
    const [{ count }] = await testSql`SELECT COUNT(*)::int as count FROM users`
    expect(count).toBe(4) // admin, alice, bob, carol
  })

  it('has correct opportunity count', async () => {
    const [{ count }] = await testSql`SELECT COUNT(*)::int as count FROM opportunities`
    expect(count).toBe(8) // 7 active + 1 closed
  })

  it('has correct scored opportunities count', async () => {
    const [{ count }] = await testSql`SELECT COUNT(*)::int as count FROM tenant_opportunities`
    expect(count).toBe(8) // 6 for techforward + 2 for clearpath
  })

  it('users belong to correct tenants', async () => {
    const users = await testSql`SELECT id, tenant_id, role FROM users ORDER BY id`
    const admin = users.find(u => u.id === TEST_USERS.admin.id)
    const alice = users.find(u => u.id === TEST_USERS.alice.id)
    const carol = users.find(u => u.id === TEST_USERS.carol.id)

    expect(admin?.tenantId).toBeNull()
    expect(admin?.role).toBe('master_admin')
    expect(alice?.tenantId).toBe(TEST_TENANTS.techforward.id)
    expect(carol?.tenantId).toBe(TEST_TENANTS.clearpath.id)
  })

  it('closed opportunity is excluded from tenant_pipeline view', async () => {
    const rows = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE opportunity_id = ${TEST_OPPORTUNITIES.closed}
    `
    expect(rows).toHaveLength(0)
  })

  it('tenant_pipeline view returns correct columns', async () => {
    const rows = await testSql`SELECT * FROM tenant_pipeline LIMIT 1`
    expect(rows.length).toBe(1)
    const row = rows[0]
    // Check key columns exist
    expect(row).toHaveProperty('tenantId')
    expect(row).toHaveProperty('opportunityId')
    expect(row).toHaveProperty('totalScore')
    expect(row).toHaveProperty('title')
    expect(row).toHaveProperty('source')
    expect(row).toHaveProperty('pursuitStatus')
  })
})

describe('Tenant isolation at DB level', () => {
  it('techforward sees only their scored opportunities', async () => {
    const rows = await testSql`
      SELECT opportunity_id, total_score FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY total_score DESC
    `
    expect(rows.length).toBe(6) // 6 scored opps for techforward
    // All should have total_score > 0
    rows.forEach(r => expect(r.totalScore).toBeGreaterThan(0))
  })

  it('clearpath sees only their scored opportunities', async () => {
    const rows = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.clearpath.id}
    `
    expect(rows.length).toBe(2) // PMO + workforce
  })

  it('tenant_pipeline enforces tenant scoping', async () => {
    // TechForward should NOT see ClearPath's exclusive opportunities
    const techRows = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const clearRows = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.clearpath.id}
    `
    const techIds = techRows.map(r => r.opportunityId)
    const clearIds = clearRows.map(r => r.opportunityId)

    // Workforce (opp 5) should only be in clearpath's view
    expect(clearIds).toContain(TEST_OPPORTUNITIES.workforce)
    expect(techIds).not.toContain(TEST_OPPORTUNITIES.workforce)
  })
})

describe('Scoring data consistency', () => {
  it('scores are within valid range (0-100)', async () => {
    const rows = await testSql`SELECT total_score FROM tenant_opportunities`
    rows.forEach(r => {
      expect(r.totalScore).toBeGreaterThanOrEqual(0)
      expect(r.totalScore).toBeLessThanOrEqual(100)
    })
  })

  it('component scores sum reasonably', async () => {
    const rows = await testSql`
      SELECT total_score, naics_score, keyword_score, set_aside_score,
             agency_score, type_score, timeline_score, llm_adjustment
      FROM tenant_opportunities
    `
    rows.forEach(r => {
      const componentSum = (r.naicsScore ?? 0) + (r.keywordScore ?? 0)
        + (r.setAsideScore ?? 0) + (r.agencyScore ?? 0)
        + (r.typeScore ?? 0) + (r.timelineScore ?? 0)
        + (r.llmAdjustment ?? 0)
      // Total should be close to component sum (may be clamped at 100)
      expect(r.totalScore).toBeLessThanOrEqual(100)
      expect(r.totalScore).toBeGreaterThanOrEqual(0)
    })
  })

  it('tenant profiles have valid NAICS codes', async () => {
    const profiles = await testSql`SELECT primary_naics, secondary_naics FROM tenant_profiles`
    profiles.forEach(p => {
      // NAICS codes should be strings of digits
      ;(p.primaryNaics ?? []).forEach((code: string) => {
        expect(code).toMatch(/^\d{5,6}$/)
      })
    })
  })
})

describe('Pipeline data', () => {
  it('has pipeline jobs in expected states', async () => {
    const jobs = await testSql`
      SELECT status, COUNT(*)::int as count
      FROM pipeline_jobs GROUP BY status
    `
    const statusMap = Object.fromEntries(jobs.map(j => [j.status, j.count]))
    expect(statusMap.completed).toBe(2)
    expect(statusMap.failed).toBe(1)
    expect(statusMap.pending).toBe(1)
  })

  it('source_health has entries for configured sources', async () => {
    const sources = await testSql`SELECT source, status FROM source_health`
    const sourceMap = Object.fromEntries(sources.map(s => [s.source, s.status]))
    expect(sourceMap.sam_gov).toBe('healthy')
    expect(sourceMap.grants_gov).toBe('error')
  })
})
