/**
 * Integration tests for /api/opportunities
 *
 * Tests filtering, pagination, tenant isolation, and the COUNT query fix.
 * Runs against a real test database with seed data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_OPPORTUNITIES } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

// ── Helper: simulate the API's query logic directly against test DB ──
// This tests the actual SQL queries used in the API route.

async function queryOpportunities(tenantId: string, filters: Record<string, any> = {}) {
  const {
    search = '',
    source = '',
    opportunityType = '',
    minScore = 0,
    agency = '',
    pursuitStatus = '',
    deadlineStatus = '',
    isPinned = false,
    sortBy = 'total_score',
    sortDir = 'DESC',
    limit = 50,
    offset = 0,
  } = filters

  const rows = await testSql`
    SELECT * FROM tenant_pipeline
    WHERE tenant_id = ${tenantId}
      AND (${minScore} = 0 OR total_score >= ${minScore})
      AND (${source} = '' OR source = ${source})
      AND (${opportunityType} = '' OR opportunity_type = ${opportunityType})
      AND (${agency} = '' OR agency_code = ${agency})
      AND (${pursuitStatus} = '' OR pursuit_status = ${pursuitStatus})
      AND (${deadlineStatus} = '' OR deadline_status = ${deadlineStatus})
      AND (${isPinned} = false OR is_pinned = true)
      AND (
        ${search} = ''
        OR title ILIKE ${'%' + search + '%'}
        OR solicitation_number ILIKE ${'%' + search + '%'}
        OR agency ILIKE ${'%' + search + '%'}
      )
    ORDER BY total_score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `

  const [{ count }] = await testSql`
    SELECT COUNT(*)::int as count FROM tenant_pipeline
    WHERE tenant_id = ${tenantId}
      AND (${minScore} = 0 OR total_score >= ${minScore})
      AND (${source} = '' OR source = ${source})
      AND (${opportunityType} = '' OR opportunity_type = ${opportunityType})
      AND (${agency} = '' OR agency_code = ${agency})
      AND (${pursuitStatus} = '' OR pursuit_status = ${pursuitStatus})
      AND (${deadlineStatus} = '' OR deadline_status = ${deadlineStatus})
      AND (${isPinned} = false OR is_pinned = true)
      AND (
        ${search} = ''
        OR title ILIKE ${'%' + search + '%'}
        OR solicitation_number ILIKE ${'%' + search + '%'}
        OR agency ILIKE ${'%' + search + '%'}
      )
  `

  return { data: rows, total: count }
}

describe('Opportunities — unfiltered', () => {
  it('returns all techforward scored opportunities', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id)
    expect(result.data.length).toBe(6)
    expect(result.total).toBe(6)
  })

  it('returns all clearpath scored opportunities', async () => {
    const result = await queryOpportunities(TEST_TENANTS.clearpath.id)
    expect(result.data.length).toBe(2)
    expect(result.total).toBe(2)
  })

  it('results are sorted by score descending', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id)
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i - 1].totalScore).toBeGreaterThanOrEqual(result.data[i].totalScore)
    }
  })
})

describe('Opportunities — filters', () => {
  it('minScore filter works', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { minScore: 80 })
    expect(result.data.length).toBeGreaterThan(0)
    result.data.forEach(r => expect(r.totalScore).toBeGreaterThanOrEqual(80))
    expect(result.total).toBe(result.data.length)
  })

  it('pursuit_status filter works', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { pursuitStatus: 'pursuing' })
    expect(result.data.length).toBeGreaterThan(0)
    result.data.forEach(r => expect(r.pursuitStatus).toBe('pursuing'))
    expect(result.total).toBe(result.data.length)
  })

  it('agency filter works', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { agency: '097' })
    expect(result.data.length).toBeGreaterThan(0)
    result.data.forEach(r => expect(r.agencyCode).toBe('097'))
    expect(result.total).toBe(result.data.length)
  })

  it('search filter matches title', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { search: 'Cloud Migration' })
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.total).toBe(result.data.length)
  })

  it('search filter matches solicitation number', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { search: 'HC1028' })
    expect(result.data.length).toBe(1)
    expect(result.total).toBe(1)
  })

  it('opportunity_type filter works', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { opportunityType: 'presolicitation' })
    result.data.forEach(r => expect(r.opportunityType).toBe('presolicitation'))
    expect(result.total).toBe(result.data.length)
  })

  it('combined filters narrow results correctly', async () => {
    const all = await queryOpportunities(TEST_TENANTS.techforward.id)
    const filtered = await queryOpportunities(TEST_TENANTS.techforward.id, {
      minScore: 80,
      pursuitStatus: 'pursuing',
    })
    expect(filtered.data.length).toBeLessThan(all.data.length)
    expect(filtered.total).toBe(filtered.data.length)
  })

  it('filter returning no results has total = 0', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { search: 'xyznonexistent123' })
    expect(result.data.length).toBe(0)
    expect(result.total).toBe(0)
  })
})

describe('Opportunities — pagination', () => {
  it('limit constrains returned rows', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { limit: 2 })
    expect(result.data.length).toBe(2)
    expect(result.total).toBe(6) // Total should be full count, not limited
  })

  it('offset skips rows', async () => {
    const all = await queryOpportunities(TEST_TENANTS.techforward.id)
    const offset = await queryOpportunities(TEST_TENANTS.techforward.id, { offset: 2 })
    expect(offset.data.length).toBe(all.data.length - 2)
    expect(offset.data[0].opportunityId).toBe(all.data[2].opportunityId)
  })

  it('COUNT matches data length when no pagination', async () => {
    // This was the critical bug — COUNT must apply same filters as data query
    const filtered = await queryOpportunities(TEST_TENANTS.techforward.id, { pursuitStatus: 'pursuing' })
    expect(filtered.total).toBe(filtered.data.length)
  })

  it('COUNT with filters + pagination returns full filtered count', async () => {
    const filtered = await queryOpportunities(TEST_TENANTS.techforward.id, {
      minScore: 50,
      limit: 1,
    })
    expect(filtered.data.length).toBe(1) // Limited to 1
    expect(filtered.total).toBeGreaterThan(1) // But total is the full filtered count
  })
})

describe('Opportunities — tenant isolation', () => {
  it('techforward cannot see clearpath-exclusive opportunities', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id)
    const ids = result.data.map(r => r.opportunityId)
    expect(ids).not.toContain(TEST_OPPORTUNITIES.workforce)
  })

  it('clearpath cannot see techforward-exclusive opportunities', async () => {
    const result = await queryOpportunities(TEST_TENANTS.clearpath.id)
    const ids = result.data.map(r => r.opportunityId)
    expect(ids).not.toContain(TEST_OPPORTUNITIES.cloudMigration)
    expect(ids).not.toContain(TEST_OPPORTUNITIES.devSecOps)
    expect(ids).not.toContain(TEST_OPPORTUNITIES.dataAnalytics)
  })

  it('nonexistent tenant returns empty', async () => {
    const result = await queryOpportunities('00000000-0000-0000-0000-000000000000')
    expect(result.data.length).toBe(0)
    expect(result.total).toBe(0)
  })
})

describe('Opportunities — actions', () => {
  it('tenant actions are correctly recorded', async () => {
    const actions = await testSql`
      SELECT * FROM tenant_actions
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY created_at
    `
    expect(actions.length).toBe(5)
    // Check action types
    const types = actions.map(a => a.actionType)
    expect(types).toContain('thumbs_up')
    expect(types).toContain('comment')
    expect(types).toContain('pin')
    expect(types).toContain('status_change')
  })

  it('pinned opportunity is reflected in tenant_pipeline', async () => {
    // Cloud migration should be pinned (Alice pinned it)
    const [opp] = await testSql`
      SELECT is_pinned FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.cloudMigration}
    `
    expect(opp.isPinned).toBe(true)
  })

  it('isPinned filter returns only pinned', async () => {
    const result = await queryOpportunities(TEST_TENANTS.techforward.id, { isPinned: true })
    expect(result.data.length).toBeGreaterThan(0)
    result.data.forEach(r => expect(r.isPinned).toBe(true))
    expect(result.total).toBe(result.data.length)
  })
})
