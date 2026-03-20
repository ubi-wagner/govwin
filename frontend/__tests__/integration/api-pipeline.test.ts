/**
 * Integration tests for pipeline operations.
 *
 * Tests pipeline job listing, job creation, schedule management,
 * and system status reporting.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

describe('Pipeline jobs', () => {
  it('lists jobs with all statuses', async () => {
    const jobs = await testSql`
      SELECT id, source, run_type, status, triggered_by, error_message
      FROM pipeline_jobs ORDER BY triggered_at DESC
    `
    expect(jobs.length).toBe(4)

    const statuses = jobs.map(j => j.status)
    expect(statuses).toContain('completed')
    expect(statuses).toContain('failed')
    expect(statuses).toContain('pending')
  })

  it('completed jobs have result data', async () => {
    const completed = await testSql`
      SELECT result FROM pipeline_jobs WHERE status = 'completed'
    `
    completed.forEach(j => {
      expect(j.result).toBeDefined()
      expect(j.result).toHaveProperty('opportunities_fetched')
      expect(j.result).toHaveProperty('tenants_scored')
    })
  })

  it('failed jobs have error message', async () => {
    const [failed] = await testSql`
      SELECT error_message, result FROM pipeline_jobs WHERE status = 'failed'
    `
    expect(failed.errorMessage).toBeTruthy()
    expect(failed.result.errors.length).toBeGreaterThan(0)
  })

  it('can create a new pipeline job', async () => {
    const [job] = await testSql`
      INSERT INTO pipeline_jobs (source, run_type, status, triggered_by, parameters)
      VALUES ('sam_gov', 'incremental', 'pending', 'test@govwin.test', '{"days_back": 3}'::jsonb)
      RETURNING id, status
    `
    expect(job.id).toBeDefined()
    expect(job.status).toBe('pending')
  })

  it('can update job status through lifecycle', async () => {
    const [job] = await testSql`
      INSERT INTO pipeline_jobs (source, run_type, status, triggered_by, parameters)
      VALUES ('scoring', 'score', 'pending', 'test@govwin.test', '{}'::jsonb)
      RETURNING id
    `

    // Start
    await testSql`
      UPDATE pipeline_jobs SET status = 'running', started_at = NOW()
      WHERE id = ${job.id}
    `
    const [running] = await testSql`SELECT status FROM pipeline_jobs WHERE id = ${job.id}`
    expect(running.status).toBe('running')

    // Complete
    await testSql`
      UPDATE pipeline_jobs SET status = 'completed', completed_at = NOW(),
        result = '{"tenants_scored": 2}'::jsonb
      WHERE id = ${job.id}
    `
    const [done] = await testSql`SELECT status, result FROM pipeline_jobs WHERE id = ${job.id}`
    expect(done.status).toBe('completed')
    expect(done.result.tenants_scored).toBe(2)
  })
})

describe('Pipeline runs', () => {
  it('run history tracks all pipeline executions', async () => {
    const runs = await testSql`
      SELECT source, run_type, status, opportunities_fetched, tenants_scored
      FROM pipeline_runs ORDER BY started_at DESC
    `
    expect(runs.length).toBe(3)
  })

  it('successful run has stats', async () => {
    const [run] = await testSql`
      SELECT * FROM pipeline_runs WHERE status = 'completed' AND source = 'sam_gov'
    `
    expect(run.opportunitiesFetched).toBe(47)
    expect(run.opportunitiesNew).toBe(12)
    expect(run.tenantsScored).toBe(2)
  })
})

describe('Source health', () => {
  it('reports health for all configured sources', async () => {
    const sources = await testSql`SELECT * FROM source_health ORDER BY source`
    expect(sources.length).toBeGreaterThanOrEqual(2)

    const samGov = sources.find(s => s.source === 'sam_gov')
    expect(samGov?.status).toBe('healthy')
    expect(samGov?.consecutiveFailures).toBe(0)

    const grantsGov = sources.find(s => s.source === 'grants_gov')
    expect(grantsGov?.status).toBe('error')
    expect(grantsGov?.consecutiveFailures).toBe(3)
  })
})

describe('System status (admin dashboard data)', () => {
  it('aggregates system stats correctly', async () => {
    // Pipeline summary
    const [jobStats] = await testSql`
      SELECT
        COUNT(*)::int as total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE status = 'pending' OR status = 'running')::int as active
      FROM pipeline_jobs
    `
    expect(jobStats.totalJobs).toBeGreaterThanOrEqual(4)
    expect(jobStats.completed).toBeGreaterThanOrEqual(2)

    // Tenant summary
    const [tenantStats] = await testSql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'active')::int as active,
        COUNT(*) FILTER (WHERE status = 'trial')::int as trial
      FROM tenants
    `
    expect(tenantStats.total).toBeGreaterThanOrEqual(2)

    // Opportunity summary
    const [oppStats] = await testSql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'active')::int as active,
        COUNT(*) FILTER (WHERE status = 'closed')::int as closed
      FROM opportunities
    `
    expect(oppStats.total).toBe(8)
    expect(oppStats.closed).toBe(1)
  })
})

describe('Audit log', () => {
  it('records audit events', async () => {
    const entries = await testSql`SELECT * FROM audit_log ORDER BY created_at`
    expect(entries.length).toBeGreaterThanOrEqual(3)
  })

  it('can write and read back an audit entry', async () => {
    await testSql`
      INSERT INTO audit_log (user_id, tenant_id, action, entity_type, entity_id, new_value)
      VALUES ('user-admin-001', NULL, 'test.action', 'test', 'test-id', '{"test": true}'::jsonb)
    `
    const [entry] = await testSql`
      SELECT * FROM audit_log WHERE action = 'test.action'
    `
    expect(entry).toBeDefined()
    expect(entry.entityType).toBe('test')
    expect(entry.newValue.test).toBe(true)
  })
})
