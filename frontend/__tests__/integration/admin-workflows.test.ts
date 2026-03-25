/**
 * Integration tests for admin workflows.
 *
 * Tests end-to-end admin operations:
 *   - System status dashboard data
 *   - Tenant lifecycle (create → configure → activate)
 *   - User management across tenants
 *   - Pipeline job management
 *   - Event stream querying (user/system/alerts)
 *   - Content management lifecycle
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_USERS, TEST_OPPORTUNITIES } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

// ── Admin Dashboard: System Overview ───────────────────────────

describe('Admin Dashboard — system overview', () => {
  it('aggregates tenant, user, and opportunity counts', async () => {
    const [stats] = await testSql`
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS tenant_count,
        (SELECT COUNT(*)::int FROM users) AS user_count,
        (SELECT COUNT(*)::int FROM opportunities) AS opp_count,
        (SELECT COUNT(*)::int FROM opportunities WHERE status = 'active') AS active_opps,
        (SELECT COUNT(*)::int FROM pipeline_jobs) AS job_count,
        (SELECT COUNT(*)::int FROM pipeline_jobs WHERE status = 'failed') AS failed_jobs
    `
    expect(stats.tenantCount).toBeGreaterThanOrEqual(2)
    expect(stats.userCount).toBe(4)
    expect(stats.oppCount).toBe(8)
    expect(stats.activeOpps).toBe(7)
    expect(stats.jobCount).toBeGreaterThanOrEqual(4)
    expect(stats.failedJobs).toBeGreaterThanOrEqual(1)
  })

  it('source health reports all sources with correct status', async () => {
    const sources = await testSql`
      SELECT source, status, consecutive_failures, last_success_at
      FROM source_health ORDER BY source
    `
    const sourceMap = Object.fromEntries(sources.map(s => [s.source, s]))

    expect(sourceMap.sam_gov.status).toBe('healthy')
    expect(sourceMap.sam_gov.consecutiveFailures).toBe(0)
    expect(sourceMap.sam_gov.lastSuccessAt).toBeTruthy()

    expect(sourceMap.grants_gov.status).toBe('error')
    expect(sourceMap.grants_gov.consecutiveFailures).toBe(3)
  })
})

// ── Admin: Full Tenant Lifecycle ───────────────────────────────

describe('Admin — tenant lifecycle (create → configure → activate)', () => {
  const newTenantId = 'e2e-admin-0001-0001-0001-000000000001'

  it('creates a new tenant in trial status', async () => {
    await testSql`
      INSERT INTO tenants (id, slug, name, legal_name, plan, status, primary_email, billing_email)
      VALUES (${newTenantId}, 'admin-test-co', 'Admin Test Co', 'Admin Test Co LLC',
              'starter', 'trial', 'info@admin-test.test', 'billing@admin-test.test')
    `
    const [t] = await testSql`SELECT * FROM tenants WHERE id = ${newTenantId}`
    expect(t.slug).toBe('admin-test-co')
    expect(t.status).toBe('trial')
    expect(t.plan).toBe('starter')
  })

  it('creates a tenant profile with NAICS and keywords', async () => {
    await testSql`
      INSERT INTO tenant_profiles (tenant_id, primary_naics, secondary_naics,
        keyword_domains, is_small_business, is_sdvosb, agency_priorities, updated_by)
      VALUES (
        ${newTenantId},
        ARRAY['541512', '541519'],
        ARRAY['518210'],
        '{"cloud": ["AWS", "Azure"], "security": ["NIST", "FedRAMP"]}'::jsonb,
        true, true,
        '{"097": 1, "047": 2}'::jsonb,
        'admin@govwin.test'
      )
    `
    const [p] = await testSql`SELECT * FROM tenant_profiles WHERE tenant_id = ${newTenantId}`
    expect(p.primaryNaics).toContain('541512')
    expect(p.isSdvosb).toBe(true)
    expect(p.keywordDomains).toHaveProperty('cloud')
    expect(p.agencyPriorities).toHaveProperty('097')
  })

  it('creates an admin user for the new tenant', async () => {
    await testSql`
      INSERT INTO users (id, name, email, role, tenant_id, password_hash, is_active)
      VALUES ('user-admtest-001', 'Test Admin', 'admin@admin-test.test', 'tenant_admin',
              ${newTenantId},
              '$2a$10$8KzVHxKKRqGBqJN.Xf3bLOqLQHJV2DWF8G0wVZGtqk9E3V3bZmRKy', true)
    `
    const [u] = await testSql`SELECT * FROM users WHERE id = 'user-admtest-001'`
    expect(u.email).toBe('admin@admin-test.test')
    expect(u.tenantId).toBe(newTenantId)
    expect(u.role).toBe('tenant_admin')
  })

  it('activates the tenant', async () => {
    await testSql`UPDATE tenants SET status = 'active' WHERE id = ${newTenantId}`
    const [t] = await testSql`SELECT status FROM tenants WHERE id = ${newTenantId}`
    expect(t.status).toBe('active')
  })

  it('upgrades the tenant plan', async () => {
    await testSql`UPDATE tenants SET plan = 'professional' WHERE id = ${newTenantId}`
    const [t] = await testSql`SELECT plan FROM tenants WHERE id = ${newTenantId}`
    expect(t.plan).toBe('professional')
  })

  it('deactivated tenant excluded from active queries', async () => {
    await testSql`UPDATE tenants SET status = 'suspended' WHERE id = ${newTenantId}`
    const active = await testSql`SELECT id FROM tenants WHERE status = 'active'`
    expect(active.map(t => t.id)).not.toContain(newTenantId)

    // Restore for subsequent tests
    await testSql`UPDATE tenants SET status = 'active' WHERE id = ${newTenantId}`
  })
})

// ── Admin: User Management ─────────────────────────────────────

describe('Admin — user management', () => {
  it('lists users per tenant with role breakdown', async () => {
    const users = await testSql`
      SELECT u.id, u.email, u.role, u.tenant_id, t.name as tenant_name
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      ORDER BY u.email
    `
    // admin has no tenant
    const admin = users.find(u => u.id === TEST_USERS.admin.id)
    expect(admin?.tenantId).toBeNull()
    expect(admin?.role).toBe('master_admin')

    // alice is tenant_admin for techforward
    const alice = users.find(u => u.id === TEST_USERS.alice.id)
    expect(alice?.role).toBe('tenant_admin')
    expect(alice?.tenantName).toBe('TechForward Solutions LLC')
  })

  it('can deactivate and reactivate a user', async () => {
    await testSql`UPDATE users SET is_active = false WHERE id = ${TEST_USERS.bob.id}`
    const [deactivated] = await testSql`SELECT is_active FROM users WHERE id = ${TEST_USERS.bob.id}`
    expect(deactivated.isActive).toBe(false)

    await testSql`UPDATE users SET is_active = true WHERE id = ${TEST_USERS.bob.id}`
    const [reactivated] = await testSql`SELECT is_active FROM users WHERE id = ${TEST_USERS.bob.id}`
    expect(reactivated.isActive).toBe(true)
  })

  it('enforces unique email across all tenants', async () => {
    await expect(testSql`
      INSERT INTO users (id, name, email, role, tenant_id, password_hash, is_active)
      VALUES ('user-dup-x', 'Dup', ${TEST_USERS.alice.email}, 'tenant_user',
              ${TEST_TENANTS.clearpath.id}, '$2a$10$hash', true)
    `).rejects.toThrow()
  })
})

// ── Admin: Pipeline Job Management ─────────────────────────────

describe('Admin — pipeline job lifecycle', () => {
  it('creates and runs a job through full lifecycle', async () => {
    // 1. Create pending job
    const [job] = await testSql`
      INSERT INTO pipeline_jobs (source, run_type, status, triggered_by, parameters)
      VALUES ('sam_gov', 'incremental', 'pending', 'admin@govwin.test',
              '{"days_back": 1}'::jsonb)
      RETURNING id, status
    `
    expect(job.status).toBe('pending')

    // 2. Start job
    await testSql`
      UPDATE pipeline_jobs SET status = 'running', started_at = NOW()
      WHERE id = ${job.id}
    `

    // 3. Complete with results
    await testSql`
      UPDATE pipeline_jobs SET
        status = 'completed',
        completed_at = NOW(),
        result = '{"opportunities_fetched": 25, "new": 5, "updated": 20, "tenants_scored": 3}'::jsonb
      WHERE id = ${job.id}
    `
    const [completed] = await testSql`SELECT * FROM pipeline_jobs WHERE id = ${job.id}`
    expect(completed.status).toBe('completed')
    expect(completed.result.opportunities_fetched).toBe(25)
    expect(completed.result.tenants_scored).toBe(3)
  })

  it('records pipeline run with metrics', async () => {
    await testSql`
      INSERT INTO pipeline_runs (source, run_type, status,
        opportunities_fetched, opportunities_new, opportunities_updated,
        tenants_scored, llm_calls_made, started_at, completed_at)
      VALUES ('sam_gov', 'full', 'completed', 100, 15, 85, 4, 12, NOW() - interval '5 min', NOW())
    `
    const [run] = await testSql`
      SELECT * FROM pipeline_runs WHERE opportunities_fetched = 100
    `
    expect(run.opportunitiesNew).toBe(15)
    expect(run.tenantsScored).toBe(4)
    expect(run.llmCallsMade).toBe(12)
  })
})

// ── Admin: Event Streams ───────────────────────────────────────

describe('Admin — event streams', () => {
  it('customer events have required fields', async () => {
    // Insert a test customer event
    await testSql`
      INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type,
        entity_id, description, metadata)
      VALUES (
        ${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
        'account.login', 'user', ${TEST_USERS.alice.id},
        'Alice logged in',
        '{"actor": {"type": "user", "id": "${TEST_USERS.alice.id}", "email": "alice@techforward.test"}}'::jsonb
      )
    `
    const events = await testSql`
      SELECT * FROM customer_events
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND event_type = 'account.login'
      ORDER BY created_at DESC LIMIT 1
    `
    expect(events.length).toBe(1)
    expect(events[0].metadata).toHaveProperty('actor')
    expect(events[0].entityType).toBe('user')
  })

  it('opportunity events track ingest and scoring', async () => {
    await testSql`
      INSERT INTO opportunity_events (opportunity_id, event_type, source, metadata)
      VALUES (
        ${TEST_OPPORTUNITIES.cloudMigration}, 'ingest.updated', 'sam_gov',
        '{"actor": {"type": "pipeline", "id": "sam_gov_ingester"}, "payload": {"title": "Cloud Migration"}}'::jsonb
      )
    `
    const events = await testSql`
      SELECT * FROM opportunity_events
      WHERE opportunity_id = ${TEST_OPPORTUNITIES.cloudMigration}
        AND event_type = 'ingest.updated'
      ORDER BY created_at DESC LIMIT 1
    `
    expect(events.length).toBe(1)
    expect(events[0].source).toBe('sam_gov')
    expect(events[0].metadata.payload.title).toBe('Cloud Migration')
  })

  it('event type filter works on customer events', async () => {
    // Insert multiple event types
    await testSql`
      INSERT INTO customer_events (tenant_id, event_type, entity_type, entity_id, description)
      VALUES
        (${TEST_TENANTS.techforward.id}, 'reminder.nudge_sent', 'opportunity', ${TEST_OPPORTUNITIES.cloudMigration}, 'Nudge sent'),
        (${TEST_TENANTS.techforward.id}, 'finder.opp_presented', 'opportunity', ${TEST_OPPORTUNITIES.cybersecurity}, 'Opp presented')
    `
    const nudges = await testSql`
      SELECT * FROM customer_events
      WHERE event_type = 'reminder.nudge_sent'
    `
    expect(nudges.length).toBeGreaterThan(0)
    nudges.forEach(e => expect(e.eventType).toBe('reminder.nudge_sent'))
  })

  it('content events track CMS changes', async () => {
    await testSql`
      INSERT INTO content_events (event_type, source, page_key, diff_summary, metadata)
      VALUES ('content.published', 'admin', 'home', 'Updated hero section',
              '{"actor": {"type": "user", "id": "user-admin-001"}}'::jsonb)
    `
    const [evt] = await testSql`
      SELECT * FROM content_events WHERE page_key = 'home' ORDER BY created_at DESC LIMIT 1
    `
    expect(evt.eventType).toBe('content.published')
    expect(evt.diffSummary).toBe('Updated hero section')
  })

  it('correlation_id links events across buses', async () => {
    const corrId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await testSql`
      INSERT INTO opportunity_events (opportunity_id, event_type, source, correlation_id)
      VALUES (${TEST_OPPORTUNITIES.cloudMigration}, 'scoring.scored', 'scoring_engine', ${corrId})
    `
    await testSql`
      INSERT INTO customer_events (tenant_id, event_type, entity_type, entity_id,
        description, correlation_id)
      VALUES (${TEST_TENANTS.techforward.id}, 'finder.opp_presented', 'opportunity',
              ${TEST_OPPORTUNITIES.cloudMigration}, 'Presented after scoring', ${corrId})
    `

    // Both events should be findable by correlation_id
    const [oppEvt] = await testSql`
      SELECT * FROM opportunity_events WHERE correlation_id = ${corrId}
    `
    const [custEvt] = await testSql`
      SELECT * FROM customer_events WHERE correlation_id = ${corrId}
    `
    expect(oppEvt).toBeDefined()
    expect(custEvt).toBeDefined()
    expect(oppEvt.eventType).toBe('scoring.scored')
    expect(custEvt.eventType).toBe('finder.opp_presented')
  })
})

// ── Admin: Content Management ──────────────────────────────────

describe('Admin — content management lifecycle', () => {
  it('creates a draft, then publishes', async () => {
    // Create draft
    await testSql`
      INSERT INTO site_content (page_key, draft_content, auto_publish)
      VALUES ('test-page', '{"hero": {"title": "Draft Title"}}'::jsonb, false)
      ON CONFLICT (page_key) DO UPDATE SET draft_content = EXCLUDED.draft_content
    `
    const [draft] = await testSql`SELECT * FROM site_content WHERE page_key = 'test-page'`
    expect(draft.draftContent.hero.title).toBe('Draft Title')
    expect(draft.publishedContent).toBeNull()

    // Publish
    await testSql`
      UPDATE site_content
      SET published_content = draft_content, published_at = NOW(), published_by = 'admin@govwin.test'
      WHERE page_key = 'test-page'
    `
    const [published] = await testSql`SELECT * FROM site_content WHERE page_key = 'test-page'`
    expect(published.publishedContent.hero.title).toBe('Draft Title')
    expect(published.publishedBy).toBe('admin@govwin.test')
  })

  it('rollback restores previous content', async () => {
    // Update draft with new content
    await testSql`
      UPDATE site_content
      SET draft_content = '{"hero": {"title": "New Title V2"}}'::jsonb
      WHERE page_key = 'test-page'
    `
    // Publish V2
    await testSql`
      UPDATE site_content
      SET published_content = draft_content, published_at = NOW()
      WHERE page_key = 'test-page'
    `

    // Rollback to V1 by setting draft back
    await testSql`
      UPDATE site_content
      SET draft_content = '{"hero": {"title": "Draft Title"}}'::jsonb,
          published_content = '{"hero": {"title": "Draft Title"}}'::jsonb
      WHERE page_key = 'test-page'
    `
    const [rolled] = await testSql`SELECT * FROM site_content WHERE page_key = 'test-page'`
    expect(rolled.publishedContent.hero.title).toBe('Draft Title')
  })
})

// ── Admin: Notifications Queue ─────────────────────────────────

describe('Admin — notifications queue', () => {
  it('queues and tracks notifications per tenant', async () => {
    await testSql`
      INSERT INTO notifications_queue (tenant_id, notification_type, subject, priority)
      VALUES
        (${TEST_TENANTS.techforward.id}, 'digest', 'Weekly Digest', 5),
        (${TEST_TENANTS.techforward.id}, 'alert', 'High-Score Alert', 3),
        (${TEST_TENANTS.clearpath.id}, 'onboarding', 'Welcome!', 1)
    `
    const tfNotifs = await testSql`
      SELECT * FROM notifications_queue
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY priority ASC
    `
    expect(tfNotifs.length).toBeGreaterThanOrEqual(2)
    // Higher priority (lower number) should come first
    expect(tfNotifs[0].priority).toBeLessThanOrEqual(tfNotifs[1].priority)
  })
})
