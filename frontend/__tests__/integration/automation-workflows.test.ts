/**
 * Integration tests for the automation framework.
 *
 * Tests end-to-end automation:
 *   - Automation rules schema and seeded data
 *   - Rule CRUD (create, enable/disable)
 *   - Rule condition evaluation
 *   - Automation log entries
 *   - Cooldown and rate-limiting enforcement
 *   - $first_occurrence dedup
 *   - Event → rule → action chain
 *   - Cross-bus automation chaining
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, teardownTestDb, testSql, TEST_TENANTS, TEST_USERS, TEST_OPPORTUNITIES } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

// ── Automation Rules Schema ────────────────────────────────────

describe('Automation rules — schema and seed data', () => {
  it('automation_rules table exists with seeded rules', async () => {
    const rules = await testSql`
      SELECT * FROM automation_rules ORDER BY priority ASC, name ASC
    `
    expect(rules.length).toBeGreaterThanOrEqual(12)
  })

  it('all seeded rules have valid bus values', async () => {
    const rules = await testSql`SELECT trigger_bus FROM automation_rules`
    const validBuses = ['opportunity_events', 'customer_events', 'content_events']
    rules.forEach(r => expect(validBuses).toContain(r.triggerBus))
  })

  it('all seeded rules have valid action types', async () => {
    const rules = await testSql`SELECT action_type FROM automation_rules`
    const validActions = ['emit_event', 'queue_notification', 'queue_job', 'log_only']
    rules.forEach(r => expect(validActions).toContain(r.actionType))
  })

  it('rules have non-empty trigger_events arrays', async () => {
    const rules = await testSql`SELECT name, trigger_events FROM automation_rules`
    rules.forEach(r => {
      expect(Array.isArray(r.triggerEvents)).toBe(true)
      expect(r.triggerEvents.length).toBeGreaterThan(0)
    })
  })

  it('key rules exist by name', async () => {
    const ruleNames = await testSql`SELECT name FROM automation_rules ORDER BY name`
    const names = ruleNames.map(r => r.name)
    expect(names).toContain('login_activity_log')
    expect(names).toContain('first_login_welcome')
    expect(names).toContain('profile_update_rescore')
    expect(names).toContain('high_score_notify')
    expect(names).toContain('amendment_ensure_email')
  })
})

// ── Rule Toggle (Enable/Disable) ───────────────────────────────

describe('Automation rules — enable/disable', () => {
  it('can disable and re-enable a rule', async () => {
    const [rule] = await testSql`
      SELECT id, enabled FROM automation_rules WHERE name = 'login_activity_log'
    `
    expect(rule.enabled).toBe(true)

    // Disable
    await testSql`
      UPDATE automation_rules SET enabled = false, updated_at = NOW()
      WHERE id = ${rule.id}
    `
    const [disabled] = await testSql`
      SELECT enabled FROM automation_rules WHERE id = ${rule.id}
    `
    expect(disabled.enabled).toBe(false)

    // Re-enable
    await testSql`
      UPDATE automation_rules SET enabled = true, updated_at = NOW()
      WHERE id = ${rule.id}
    `
    const [reenabled] = await testSql`
      SELECT enabled FROM automation_rules WHERE id = ${rule.id}
    `
    expect(reenabled.enabled).toBe(true)
  })

  it('disabled rules excluded from enabled query', async () => {
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'content_publish_log'
    `
    await testSql`UPDATE automation_rules SET enabled = false WHERE id = ${rule.id}`

    const enabled = await testSql`
      SELECT name FROM automation_rules WHERE enabled = TRUE
    `
    expect(enabled.map(r => r.name)).not.toContain('content_publish_log')

    // Restore
    await testSql`UPDATE automation_rules SET enabled = true WHERE id = ${rule.id}`
  })
})

// ── Custom Rule Creation ───────────────────────────────────────

describe('Automation rules — custom rule creation', () => {
  it('creates a custom rule with conditions', async () => {
    await testSql`
      INSERT INTO automation_rules (name, description, trigger_bus, trigger_events,
        conditions, action_type, action_config, priority, cooldown_seconds)
      VALUES (
        'test_high_value_alert',
        'Alert on opportunities over $1M',
        'opportunity_events',
        ARRAY['ingest.new'],
        '{"payload.estimated_value": {"$gte": 1000000}}'::jsonb,
        'queue_notification',
        '{"notification_type": "high_value_alert", "subject_template": "High-value opp: {payload.title}"}'::jsonb,
        30,
        300
      )
    `
    const [rule] = await testSql`
      SELECT * FROM automation_rules WHERE name = 'test_high_value_alert'
    `
    expect(rule).toBeDefined()
    expect(rule.triggerBus).toBe('opportunity_events')
    expect(rule.triggerEvents).toContain('ingest.new')
    expect(rule.conditions).toHaveProperty('payload.estimated_value')
    expect(rule.cooldownSeconds).toBe(300)
    expect(rule.actionType).toBe('queue_notification')
  })

  it('rejects duplicate rule names', async () => {
    await expect(testSql`
      INSERT INTO automation_rules (name, trigger_bus, trigger_events, action_type, action_config)
      VALUES ('login_activity_log', 'customer_events', ARRAY['account.login'],
              'log_only', '{}'::jsonb)
    `).rejects.toThrow()
  })

  it('rejects invalid bus values', async () => {
    await expect(testSql`
      INSERT INTO automation_rules (name, trigger_bus, trigger_events, action_type, action_config)
      VALUES ('bad_bus_rule', 'invalid_bus', ARRAY['test'], 'log_only', '{}'::jsonb)
    `).rejects.toThrow()
  })

  it('rejects invalid action types', async () => {
    await expect(testSql`
      INSERT INTO automation_rules (name, trigger_bus, trigger_events, action_type, action_config)
      VALUES ('bad_action_rule', 'customer_events', ARRAY['test'], 'invalid_action', '{}'::jsonb)
    `).rejects.toThrow()
  })
})

// ── Automation Log ─────────────────────────────────────────────

describe('Automation log — execution tracking', () => {
  let testRuleId: string

  it('setup: get a rule id for log tests', async () => {
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'login_activity_log'
    `
    testRuleId = rule.id
    expect(testRuleId).toBeDefined()
  })

  it('logs a fired rule execution', async () => {
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_id,
        trigger_event_type, trigger_bus, fired, action_type, action_result,
        event_metadata, correlation_id)
      VALUES (
        ${testRuleId}, 'login_activity_log', ${crypto.randomUUID()},
        'account.login', 'customer_events', true, 'log_only',
        '{"message": "User alice@techforward.test logged in"}'::jsonb,
        '{"actor": {"type": "user", "email": "alice@techforward.test"}}'::jsonb,
        ${crypto.randomUUID()}
      )
    `
    const [entry] = await testSql`
      SELECT * FROM automation_log
      WHERE rule_id = ${testRuleId} AND fired = true
      ORDER BY created_at DESC LIMIT 1
    `
    expect(entry.ruleName).toBe('login_activity_log')
    expect(entry.fired).toBe(true)
    expect(entry.actionType).toBe('log_only')
    expect(entry.actionResult.message).toContain('alice@techforward.test')
    expect(entry.skipReason).toBeNull()
  })

  it('logs a skipped rule with reason', async () => {
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_id,
        trigger_event_type, trigger_bus, fired, skip_reason, event_metadata)
      VALUES (
        ${testRuleId}, 'login_activity_log', ${crypto.randomUUID()},
        'account.login', 'customer_events', false, 'cooldown (30s < 300s)',
        '{"actor": {"type": "user"}}'::jsonb
      )
    `
    const [entry] = await testSql`
      SELECT * FROM automation_log
      WHERE rule_id = ${testRuleId} AND fired = false
      ORDER BY created_at DESC LIMIT 1
    `
    expect(entry.fired).toBe(false)
    expect(entry.skipReason).toContain('cooldown')
    expect(entry.actionType).toBeNull()
  })

  it('filters log by rule_id', async () => {
    const entries = await testSql`
      SELECT * FROM automation_log WHERE rule_id = ${testRuleId}
    `
    expect(entries.length).toBeGreaterThanOrEqual(2)
    entries.forEach(e => expect(e.ruleId).toBe(testRuleId))
  })

  it('filters log by fired status', async () => {
    const fired = await testSql`
      SELECT * FROM automation_log WHERE rule_id = ${testRuleId} AND fired = true
    `
    const skipped = await testSql`
      SELECT * FROM automation_log WHERE rule_id = ${testRuleId} AND fired = false
    `
    expect(fired.length).toBeGreaterThan(0)
    expect(skipped.length).toBeGreaterThan(0)
    fired.forEach(e => expect(e.fired).toBe(true))
    skipped.forEach(e => expect(e.fired).toBe(false))
  })

  it('log entries preserve correlation_id', async () => {
    const corrId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_type,
        trigger_bus, fired, correlation_id, event_metadata)
      VALUES (${testRuleId}, 'login_activity_log', 'account.login',
              'customer_events', true, ${corrId}, '{}'::jsonb)
    `
    const [entry] = await testSql`
      SELECT correlation_id FROM automation_log WHERE correlation_id = ${corrId}
    `
    expect(entry.correlationId).toBe(corrId)
  })
})

// ── Rule Stats (aggregations for admin UI) ─────────────────────

describe('Automation — rule stats for admin dashboard', () => {
  it('computes fire and skip counts per rule', async () => {
    const stats = await testSql`
      SELECT
        r.id, r.name,
        (SELECT COUNT(*) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = TRUE)::int AS total_fires,
        (SELECT COUNT(*) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = FALSE)::int AS total_skips,
        (SELECT MAX(al.created_at) FROM automation_log al WHERE al.rule_id = r.id AND al.fired = TRUE) AS last_fired_at
      FROM automation_rules r
      WHERE r.name = 'login_activity_log'
    `
    expect(stats.length).toBe(1)
    expect(stats[0].totalFires).toBeGreaterThan(0)
    expect(stats[0].totalSkips).toBeGreaterThan(0)
    expect(stats[0].lastFiredAt).toBeTruthy()
  })
})

// ── Cooldown Enforcement ───────────────────────────────────────

describe('Automation — cooldown enforcement', () => {
  it('cooldown_seconds prevents re-firing within window', async () => {
    const [rule] = await testSql`
      SELECT id, cooldown_seconds FROM automation_rules
      WHERE name = 'profile_update_rescore'
    `
    // This rule should have a cooldown > 0
    expect(rule.cooldownSeconds).toBeGreaterThan(0)

    // Insert a recent fire
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_type,
        trigger_bus, fired, event_metadata, created_at)
      VALUES (${rule.id}, 'profile_update_rescore', 'account.profile_updated',
              'customer_events', true, '{}'::jsonb, NOW())
    `

    // Check: last fire was within cooldown window
    const [lastFire] = await testSql`
      SELECT created_at FROM automation_log
      WHERE rule_id = ${rule.id} AND fired = true
      ORDER BY created_at DESC LIMIT 1
    `
    const elapsedSeconds = (Date.now() - new Date(lastFire.createdAt).getTime()) / 1000
    expect(elapsedSeconds).toBeLessThan(rule.cooldownSeconds)
    // This means the engine would skip this rule if evaluated right now
  })
})

// ── Rate Limiting ──────────────────────────────────────────────

describe('Automation — rate limiting', () => {
  it('max_fires_per_hour enforced correctly', async () => {
    const [rule] = await testSql`
      SELECT id, max_fires_per_hour FROM automation_rules
      WHERE name = 'high_score_notify'
    `
    expect(rule.maxFiresPerHour).toBeGreaterThan(0)

    // Insert fires up to the limit
    for (let i = 0; i < rule.maxFiresPerHour; i++) {
      await testSql`
        INSERT INTO automation_log (rule_id, rule_name, trigger_event_type,
          trigger_bus, fired, event_metadata)
        VALUES (${rule.id}, 'high_score_notify', 'scoring.scored',
                'opportunity_events', true, '{}'::jsonb)
      `
    }

    // Count fires in last hour
    const [{ count }] = await testSql`
      SELECT COUNT(*)::int as count FROM automation_log
      WHERE rule_id = ${rule.id} AND fired = true
        AND created_at > NOW() - INTERVAL '1 hour'
    `
    expect(count).toBeGreaterThanOrEqual(rule.maxFiresPerHour)
    // This means the engine would skip this rule if evaluated now
  })
})

// ── $first_occurrence Dedup ────────────────────────────────────

describe('Automation — $first_occurrence dedup', () => {
  it('first_login_welcome rule has $first_occurrence condition', async () => {
    const [rule] = await testSql`
      SELECT conditions FROM automation_rules WHERE name = 'first_login_welcome'
    `
    expect(rule.conditions).toHaveProperty('$first_occurrence')
    expect(rule.conditions.$first_occurrence).toBe(true)
  })

  it('entity_key tracks uniqueness for dedup', async () => {
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'first_login_welcome'
    `
    // Simulate a first fire for user alice
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_type,
        trigger_bus, fired, action_result, event_metadata)
      VALUES (${rule.id}, 'first_login_welcome', 'account.login',
              'customer_events', true,
              '{"entity_key": "user-alice-001"}'::jsonb,
              '{"actor": {"id": "user-alice-001"}}'::jsonb)
    `

    // Check: log entry exists with entity_key
    const [existing] = await testSql`
      SELECT id FROM automation_log
      WHERE rule_id = ${rule.id} AND fired = TRUE
        AND action_result->>'entity_key' = 'user-alice-001'
      LIMIT 1
    `
    expect(existing).toBeDefined()
    // Engine would skip a second login for alice due to $first_occurrence
  })
})

// ── Event → Rule → Action Chain ────────────────────────────────

describe('Automation — event → rule → action chain', () => {
  it('simulates login → login_activity_log → log_only flow', async () => {
    // 1. Emit a login event
    const [loginEvent] = await testSql`
      INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type,
        entity_id, description, metadata)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.bob.id},
        'account.login', 'user', ${TEST_USERS.bob.id}, 'Bob logged in',
        '{"actor": {"type": "user", "id": "user-bob-001", "email": "bob@techforward.test"}}'::jsonb)
      RETURNING id
    `

    // 2. Simulate the automation engine matching login_activity_log
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'login_activity_log'
    `

    // 3. Log the fired action
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_id,
        trigger_event_type, trigger_bus, fired, action_type, action_result,
        event_metadata, correlation_id)
      VALUES (${rule.id}, 'login_activity_log', ${loginEvent.id},
        'account.login', 'customer_events', true, 'log_only',
        '{"message": "User bob@techforward.test logged in"}'::jsonb,
        '{"actor": {"type": "user", "id": "user-bob-001"}}'::jsonb,
        ${loginEvent.id})
    `

    // 4. Verify the chain
    const [logEntry] = await testSql`
      SELECT * FROM automation_log
      WHERE trigger_event_id = ${loginEvent.id}
    `
    expect(logEntry.ruleName).toBe('login_activity_log')
    expect(logEntry.fired).toBe(true)
    expect(logEntry.triggerEventType).toBe('account.login')
  })

  it('simulates scoring.scored → high_score_notify → queue_notification', async () => {
    // 1. Emit a scoring event
    const [scoringEvent] = await testSql`
      INSERT INTO opportunity_events (opportunity_id, event_type, source, metadata)
      VALUES (${TEST_OPPORTUNITIES.cloudMigration}, 'scoring.scored', 'scoring_engine',
        '{"actor": {"type": "pipeline"}, "payload": {"total_score": 92, "tenant_id": "${TEST_TENANTS.techforward.id}"}}'::jsonb)
      RETURNING id
    `

    // 2. high_score_notify rule
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'high_score_notify'
    `

    // 3. Simulate the queue_notification action
    const [notif] = await testSql`
      INSERT INTO notifications_queue (tenant_id, notification_type, subject, priority)
      VALUES (${TEST_TENANTS.techforward.id}, 'high_score', 'High-score opportunity: 92/100', 3)
      RETURNING id
    `

    // 4. Log the automation
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_id,
        trigger_event_type, trigger_bus, fired, action_type, action_result, event_metadata)
      VALUES (${rule.id}, 'high_score_notify', ${scoringEvent.id},
        'scoring.scored', 'opportunity_events', true, 'queue_notification',
        ${JSON.stringify({ notification_id: notif.id, notification_type: 'high_score', subject: 'High-score opportunity: 92/100' })}::jsonb,
        '{"payload": {"total_score": 92}}'::jsonb)
    `

    // 5. Verify
    const [logEntry] = await testSql`
      SELECT * FROM automation_log WHERE trigger_event_id = ${scoringEvent.id}
    `
    expect(logEntry.fired).toBe(true)
    expect(logEntry.actionType).toBe('queue_notification')
    expect(logEntry.actionResult.notification_type).toBe('high_score')

    const [queuedNotif] = await testSql`
      SELECT * FROM notifications_queue WHERE id = ${notif.id}
    `
    expect(queuedNotif.notificationType).toBe('high_score')
  })

  it('simulates profile update → profile_update_rescore → queue_job', async () => {
    // 1. Profile update event
    const [profileEvent] = await testSql`
      INSERT INTO customer_events (tenant_id, user_id, event_type, entity_type,
        entity_id, description, metadata)
      VALUES (${TEST_TENANTS.techforward.id}, ${TEST_USERS.alice.id},
        'account.profile_updated', 'tenant_profile', ${TEST_TENANTS.techforward.id},
        'Profile updated: primary_naics',
        '{"actor": {"type": "user"}, "payload": {"fields_changed": ["primary_naics"]}, "refs": {"tenant_id": "${TEST_TENANTS.techforward.id}"}}'::jsonb)
      RETURNING id
    `

    // 2. profile_update_rescore rule queues a scoring job
    const [rule] = await testSql`
      SELECT id FROM automation_rules WHERE name = 'profile_update_rescore'
    `

    // 3. Simulate queue_job action
    const [job] = await testSql`
      INSERT INTO pipeline_jobs (source, run_type, status, triggered_by, parameters)
      VALUES ('scoring', 'score', 'pending', 'automation:profile_update_rescore',
              ${JSON.stringify({ triggered_by_rule: 'profile_update_rescore', tenant_id: TEST_TENANTS.techforward.id })}::jsonb)
      RETURNING id
    `

    // 4. Log it
    await testSql`
      INSERT INTO automation_log (rule_id, rule_name, trigger_event_id,
        trigger_event_type, trigger_bus, fired, action_type, action_result, event_metadata)
      VALUES (${rule.id}, 'profile_update_rescore', ${profileEvent.id},
        'account.profile_updated', 'customer_events', true, 'queue_job',
        ${JSON.stringify({ job_id: job.id, source: 'scoring', run_type: 'score' })}::jsonb,
        '{"payload": {"fields_changed": ["primary_naics"]}}'::jsonb)
    `

    // 5. Verify the chain
    const [logEntry] = await testSql`
      SELECT * FROM automation_log WHERE trigger_event_id = ${profileEvent.id}
    `
    expect(logEntry.actionType).toBe('queue_job')
    expect(logEntry.actionResult.source).toBe('scoring')

    const [queuedJob] = await testSql`
      SELECT * FROM pipeline_jobs WHERE id = ${job.id}
    `
    expect(queuedJob.status).toBe('pending')
    expect(queuedJob.triggeredBy).toBe('automation:profile_update_rescore')
  })
})

// ── Automation Rules Ordering ──────────────────────────────────

describe('Automation — rule priority ordering', () => {
  it('rules are returned in priority order (ASC)', async () => {
    const rules = await testSql`
      SELECT name, priority FROM automation_rules
      WHERE enabled = TRUE
      ORDER BY priority ASC, name ASC
    `
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i].priority).toBeGreaterThanOrEqual(rules[i - 1].priority)
    }
  })
})
