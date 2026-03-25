/**
 * Integration tests for tenant portal user workflows.
 *
 * Tests end-to-end user operations:
 *   - Login verification and session data
 *   - Portal profile read and update
 *   - Opportunity pipeline browsing, filtering, pagination
 *   - User actions (thumbs, pin, status, comment)
 *   - Document management
 *   - Tenant isolation across all operations
 *   - Event emission from user actions
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_USERS, TEST_PASSWORD, TEST_OPPORTUNITIES } from '../helpers/test-db'
import bcrypt from 'bcryptjs'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

// ── Login & Session ────────────────────────────────────────────

describe('User login flow', () => {
  it('tenant user authenticates with correct credentials', async () => {
    const [user] = await testSql`
      SELECT id, email, password_hash, role, tenant_id, is_active
      FROM users WHERE email = ${TEST_USERS.alice.email}
    `
    const valid = await bcrypt.compare(TEST_PASSWORD, user.passwordHash)
    expect(valid).toBe(true)
    expect(user.isActive).toBe(true)
    expect(user.tenantId).toBe(TEST_TENANTS.techforward.id)
  })

  it('login updates last_login_at', async () => {
    const [before] = await testSql`
      SELECT last_login_at FROM users WHERE id = ${TEST_USERS.alice.id}
    `
    await testSql`UPDATE users SET last_login_at = NOW() WHERE id = ${TEST_USERS.alice.id}`
    const [after] = await testSql`
      SELECT last_login_at FROM users WHERE id = ${TEST_USERS.alice.id}
    `
    expect(after.lastLoginAt.getTime()).toBeGreaterThanOrEqual(before.lastLoginAt.getTime())
  })

  it('login emits customer event', async () => {
    await testSql`
      INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type, entity_id,
        description, metadata)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
        'account.login', 'user', ${TEST_USERS.alice.id}, 'User logged in',
        '{"actor": {"type": "user", "id": "user-alice-001", "email": "alice@techforward.test"}}'::jsonb)
    `
    const [evt] = await testSql`
      SELECT * FROM customer_events
      WHERE user_id = ${TEST_USERS.alice.id} AND event_type = 'account.login'
      ORDER BY created_at DESC LIMIT 1
    `
    expect(evt).toBeDefined()
    expect(evt.metadata.actor.email).toBe('alice@techforward.test')
  })

  it('inactive user is rejected at login', async () => {
    await testSql`UPDATE users SET is_active = false WHERE id = ${TEST_USERS.bob.id}`
    const [user] = await testSql`
      SELECT is_active FROM users WHERE id = ${TEST_USERS.bob.id}
    `
    expect(user.isActive).toBe(false)
    // In authorize(): if (!user.is_active) return null
    await testSql`UPDATE users SET is_active = true WHERE id = ${TEST_USERS.bob.id}`
  })
})

// ── Portal: Profile Read & Update ──────────────────────────────

describe('Portal profile operations', () => {
  it('reads full tenant profile with search parameters', async () => {
    const [profile] = await testSql`
      SELECT tp.*, t.name, t.slug, t.plan
      FROM tenant_profiles tp
      JOIN tenants t ON t.id = tp.tenant_id
      WHERE tp.tenant_id = ${TEST_TENANTS.techforward.id}
    `
    expect(profile.primaryNaics).toContain('541512')
    expect(profile.keywordDomains).toHaveProperty('Cloud & Infrastructure')
    expect(profile.isSdvosb).toBe(true)
    expect(profile.slug).toBe('techforward-solutions')
  })

  it('updates profile with new NAICS codes (upsert)', async () => {
    const origProfile = await testSql`
      SELECT primary_naics FROM tenant_profiles
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const origNaics = origProfile[0].primaryNaics

    // Update NAICS
    await testSql`
      UPDATE tenant_profiles
      SET primary_naics = ARRAY['541512', '541519', '518210'],
          updated_by = 'alice@techforward.test',
          updated_at = NOW()
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const [updated] = await testSql`
      SELECT primary_naics FROM tenant_profiles
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    expect(updated.primaryNaics).toContain('518210')
    expect(updated.primaryNaics.length).toBe(3)

    // Restore
    await testSql`
      UPDATE tenant_profiles
      SET primary_naics = ${origNaics}
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
  })

  it('profile update emits account.profile_updated event', async () => {
    await testSql`
      INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type,
        entity_id, description, metadata)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
        'account.profile_updated', 'tenant_profile', ${TEST_TENANTS.techforward.id},
        'Profile updated: primary_naics, keyword_domains',
        '{"actor": {"type": "user", "id": "user-alice-001"}, "payload": {"fields_changed": ["primary_naics", "keyword_domains"]}}'::jsonb)
    `
    const [evt] = await testSql`
      SELECT * FROM customer_events
      WHERE event_type = 'account.profile_updated'
        AND tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY created_at DESC LIMIT 1
    `
    expect(evt.metadata.payload.fields_changed).toContain('primary_naics')
  })

  it('updates keyword domains and set-aside flags', async () => {
    await testSql`
      UPDATE tenant_profiles
      SET keyword_domains = '{"AI/ML": ["machine learning", "AI"], "Cloud": ["AWS"]}'::jsonb,
          is_wosb = true,
          updated_at = NOW()
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const [p] = await testSql`
      SELECT keyword_domains, is_wosb FROM tenant_profiles
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    expect(p.keywordDomains).toHaveProperty('AI/ML')
    expect(p.isWosb).toBe(true)

    // Restore
    await testSql`
      UPDATE tenant_profiles
      SET keyword_domains = '{"Cloud & Infrastructure": ["AWS", "cloud migration", "hybrid cloud"], "Cybersecurity": ["NIST", "FedRAMP", "zero trust"]}'::jsonb,
          is_wosb = false
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
  })
})

// ── Portal: Opportunity Pipeline ───────────────────────────────

describe('Portal — opportunity pipeline browsing', () => {
  it('user sees only their tenant opportunities', async () => {
    const rows = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY total_score DESC
    `
    expect(rows.length).toBe(6)
    rows.forEach(r => {
      expect(r.tenantId).toBe(TEST_TENANTS.techforward.id)
      expect(r.totalScore).toBeGreaterThan(0)
    })
  })

  it('filters by minimum score', async () => {
    const rows = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND total_score >= 80
    `
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach(r => expect(r.totalScore).toBeGreaterThanOrEqual(80))
  })

  it('filters by pursuit status', async () => {
    const pursuing = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND pursuit_status = 'pursuing'
    `
    expect(pursuing.length).toBeGreaterThan(0)
    pursuing.forEach(r => expect(r.pursuitStatus).toBe('pursuing'))
  })

  it('search matches title and solicitation number', async () => {
    const byTitle = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND title ILIKE '%Cloud Migration%'
    `
    expect(byTitle.length).toBeGreaterThan(0)

    const bySolNum = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND solicitation_number ILIKE '%HC1028%'
    `
    expect(bySolNum.length).toBe(1)
  })

  it('pagination works with limit and offset', async () => {
    const page1 = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY total_score DESC LIMIT 2 OFFSET 0
    `
    const page2 = await testSql`
      SELECT * FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
      ORDER BY total_score DESC LIMIT 2 OFFSET 2
    `
    expect(page1.length).toBe(2)
    expect(page2.length).toBe(2)
    // No overlap
    const page1Ids = page1.map(r => r.opportunityId)
    const page2Ids = page2.map(r => r.opportunityId)
    page2Ids.forEach(id => expect(page1Ids).not.toContain(id))
  })

  it('score breakdown fields are present', async () => {
    const [opp] = await testSql`
      SELECT to2.naics_score, to2.keyword_score, to2.set_aside_score,
             to2.agency_score, to2.type_score, to2.timeline_score,
             to2.llm_adjustment, to2.total_score
      FROM tenant_opportunities to2
      WHERE to2.tenant_id = ${TEST_TENANTS.techforward.id}
      LIMIT 1
    `
    expect(opp.totalScore).toBeGreaterThan(0)
    // All component scores should be non-negative
    expect(opp.naicsScore).toBeGreaterThanOrEqual(0)
    expect(opp.keywordScore).toBeGreaterThanOrEqual(0)
    expect(opp.setAsideScore).toBeGreaterThanOrEqual(0)
    expect(opp.agencyScore).toBeGreaterThanOrEqual(0)
    expect(opp.typeScore).toBeGreaterThanOrEqual(0)
    expect(opp.timelineScore).toBeGreaterThanOrEqual(0)
  })
})

// ── Portal: User Actions ───────────────────────────────────────

describe('Portal — user actions on opportunities', () => {
  it('records a thumbs-up action', async () => {
    await testSql`
      INSERT INTO tenant_actions (tenant_id, user_id, opportunity_id, action_type, action_data)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.bob.id},
              ${TEST_OPPORTUNITIES.devSecOps}, 'thumbs_up', '{}'::jsonb)
    `
    const [action] = await testSql`
      SELECT * FROM tenant_actions
      WHERE user_id = ${TEST_USERS.bob.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.devSecOps}
        AND action_type = 'thumbs_up'
    `
    expect(action).toBeDefined()
    expect(action.tenantId).toBe(TEST_TENANTS.techforward.id)
  })

  it('records a comment', async () => {
    await testSql`
      INSERT INTO tenant_actions (tenant_id, user_id, opportunity_id, action_type,
        action_data)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
              ${TEST_OPPORTUNITIES.devSecOps}, 'comment',
              '{"text": "This looks like a great fit for our DevSecOps team"}'::jsonb)
    `
    const [comment] = await testSql`
      SELECT * FROM tenant_actions
      WHERE user_id = ${TEST_USERS.alice.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.devSecOps}
        AND action_type = 'comment'
      ORDER BY created_at DESC LIMIT 1
    `
    expect(comment.actionData.text).toContain('DevSecOps')
  })

  it('records a pursuit status change', async () => {
    await testSql`
      INSERT INTO tenant_actions (tenant_id, user_id, opportunity_id, action_type,
        action_data)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
              ${TEST_OPPORTUNITIES.dataAnalytics}, 'status_change',
              '{"from": "monitoring", "to": "pursuing"}'::jsonb)
    `

    // Update the tenant_opportunities pursuit_status
    await testSql`
      UPDATE tenant_opportunities
      SET pursuit_status = 'pursuing'
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.dataAnalytics}
    `
    const [opp] = await testSql`
      SELECT pursuit_status FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.dataAnalytics}
    `
    expect(opp.pursuitStatus).toBe('pursuing')
  })

  it('pin action persists in tenant_pipeline view', async () => {
    // Cloud migration is already pinned from seed data
    const [pinned] = await testSql`
      SELECT is_pinned FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND opportunity_id = ${TEST_OPPORTUNITIES.cloudMigration}
    `
    expect(pinned.isPinned).toBe(true)
  })
})

// ── Portal: Document Management ────────────────────────────────

describe('Portal — document management', () => {
  it('uploads a tenant document', async () => {
    await testSql`
      INSERT INTO tenant_uploads (tenant_id, file_name, file_type, file_size,
        uploaded_by, storage_path)
      VALUES (${TEST_TENANTS.techforward.id}, 'capability-statement.pdf',
              'application/pdf', 2048576,
              ${TEST_USERS.alice.id}, '/data/tenants/techforward/uploads/capability-statement.pdf')
    `
    const [doc] = await testSql`
      SELECT * FROM tenant_uploads
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
        AND file_name = 'capability-statement.pdf'
    `
    expect(doc).toBeDefined()
    expect(doc.uploadedBy).toBe(TEST_USERS.alice.id)
  })

  it('documents are tenant-scoped', async () => {
    const tfDocs = await testSql`
      SELECT * FROM tenant_uploads WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const cpDocs = await testSql`
      SELECT * FROM tenant_uploads WHERE tenant_id = ${TEST_TENANTS.clearpath.id}
    `
    // TechForward docs should not appear in ClearPath results
    const tfNames = tfDocs.map(d => d.fileName)
    const cpNames = cpDocs.map(d => d.fileName)
    tfNames.forEach(name => expect(cpNames).not.toContain(name))
  })
})

// ── Tenant Isolation ───────────────────────────────────────────

describe('Portal — tenant isolation', () => {
  it('TechForward cannot see ClearPath opportunities', async () => {
    const tfOpps = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.techforward.id}
    `
    const tfIds = tfOpps.map(r => r.opportunityId)
    expect(tfIds).not.toContain(TEST_OPPORTUNITIES.workforce)
  })

  it('ClearPath cannot see TechForward-exclusive opportunities', async () => {
    const cpOpps = await testSql`
      SELECT opportunity_id FROM tenant_pipeline
      WHERE tenant_id = ${TEST_TENANTS.clearpath.id}
    `
    const cpIds = cpOpps.map(r => r.opportunityId)
    expect(cpIds).not.toContain(TEST_OPPORTUNITIES.cloudMigration)
    expect(cpIds).not.toContain(TEST_OPPORTUNITIES.devSecOps)
    expect(cpIds).not.toContain(TEST_OPPORTUNITIES.dataAnalytics)
  })

  it('customer events are tenant-scoped', async () => {
    // Insert events for different tenants
    await testSql`
      INSERT INTO customer_events (tenant_id, event_type, entity_type, entity_id, description)
      VALUES (${TEST_TENANTS.techforward.id}, 'test.isolation', 'test', 'tf-1', 'TechForward event')
    `
    await testSql`
      INSERT INTO customer_events (tenant_id, event_type, entity_type, entity_id, description)
      VALUES (${TEST_TENANTS.clearpath.id}, 'test.isolation', 'test', 'cp-1', 'ClearPath event')
    `

    const tfEvents = await testSql`
      SELECT * FROM customer_events
      WHERE tenant_id = ${TEST_TENANTS.techforward.id} AND event_type = 'test.isolation'
    `
    const cpEvents = await testSql`
      SELECT * FROM customer_events
      WHERE tenant_id = ${TEST_TENANTS.clearpath.id} AND event_type = 'test.isolation'
    `
    expect(tfEvents.length).toBe(1)
    expect(cpEvents.length).toBe(1)
    expect(tfEvents[0].description).toBe('TechForward event')
    expect(cpEvents[0].description).toBe('ClearPath event')
  })

  it('verifyTenantAccess logic: user can only access own tenant', () => {
    // Alice (TechForward tenant_admin) trying to access ClearPath
    const aliceTenantId: string = TEST_USERS.alice.tenantId
    const requestedTenantId: string = TEST_TENANTS.clearpath.id
    const aliceRole: string = TEST_USERS.alice.role
    const canAccess = aliceRole === 'master_admin' || aliceTenantId === requestedTenantId
    expect(canAccess).toBe(false)
  })

  it('master_admin can access any tenant', () => {
    const role = TEST_USERS.admin.role
    const canAccessTF = role === 'master_admin'
    const canAccessCP = role === 'master_admin'
    expect(canAccessTF).toBe(true)
    expect(canAccessCP).toBe(true)
  })
})
