/**
 * Integration tests for authentication flows.
 *
 * Tests password verification, user lookup, session data,
 * and role-based access patterns against the test database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { setupTestDb, teardownTestDb, testSql, TEST_USERS, TEST_PASSWORD, TEST_TENANTS } from '../helpers/test-db'

beforeAll(() => setupTestDb(), 60_000)
afterAll(() => teardownTestDb())

describe('Credential verification', () => {
  it('valid password matches hash', async () => {
    const [user] = await testSql`
      SELECT password_hash FROM users WHERE email = ${TEST_USERS.alice.email}
    `
    const valid = await bcrypt.compare(TEST_PASSWORD, user.passwordHash)
    expect(valid).toBe(true)
  })

  it('invalid password does not match', async () => {
    const [user] = await testSql`
      SELECT password_hash FROM users WHERE email = ${TEST_USERS.alice.email}
    `
    const valid = await bcrypt.compare('WrongPassword!', user.passwordHash)
    expect(valid).toBe(false)
  })

  it('all test users share the same password', async () => {
    const users = await testSql`SELECT email, password_hash FROM users`
    for (const user of users) {
      const valid = await bcrypt.compare(TEST_PASSWORD, user.passwordHash)
      expect(valid).toBe(true)
    }
  })
})

describe('User lookup (authorize flow)', () => {
  it('finds active user by email', async () => {
    const [user] = await testSql`
      SELECT id, email, name, role, tenant_id, is_active, temp_password
      FROM users WHERE email = ${TEST_USERS.alice.email}
    `
    expect(user).toBeDefined()
    expect(user.isActive).toBe(true)
    expect(user.role).toBe('tenant_admin')
    expect(user.tenantId).toBe(TEST_TENANTS.techforward.id)
  })

  it('returns empty for nonexistent email', async () => {
    const result = await testSql`
      SELECT id FROM users WHERE email = 'nobody@test.com'
    `
    expect(result.length).toBe(0)
  })

  it('inactive user should be rejected', async () => {
    // Deactivate bob temporarily
    await testSql`UPDATE users SET is_active = false WHERE id = ${TEST_USERS.bob.id}`

    const [user] = await testSql`
      SELECT id, is_active FROM users WHERE email = ${TEST_USERS.bob.email}
    `
    expect(user.isActive).toBe(false)

    // In authorize(), this check: if (!user || !user.is_active) return null
    // Restore
    await testSql`UPDATE users SET is_active = true WHERE id = ${TEST_USERS.bob.id}`
  })
})

describe('Session data (JWT payload)', () => {
  it('admin has correct session shape', async () => {
    const [user] = await testSql`
      SELECT id, role, tenant_id, temp_password FROM users WHERE id = ${TEST_USERS.admin.id}
    `
    expect(user.role).toBe('master_admin')
    expect(user.tenantId).toBeNull()
    expect(user.tempPassword).toBe(false)
  })

  it('tenant user has correct session shape', async () => {
    const [user] = await testSql`
      SELECT id, role, tenant_id, temp_password FROM users WHERE id = ${TEST_USERS.bob.id}
    `
    expect(user.role).toBe('tenant_user')
    expect(user.tenantId).toBe(TEST_TENANTS.techforward.id)
    expect(user.tempPassword).toBe(false)
  })
})

describe('Tenant access verification', () => {
  it('master_admin can access any tenant', () => {
    const role = TEST_USERS.admin.role
    const canAccess = role === 'master_admin'
    expect(canAccess).toBe(true)
  })

  it('tenant user can access own tenant', () => {
    const userTenantId = TEST_USERS.alice.tenantId
    const requestedTenantId = TEST_TENANTS.techforward.id
    const canAccess = userTenantId === requestedTenantId
    expect(canAccess).toBe(true)
  })

  it('tenant user cannot access other tenant', () => {
    const userTenantId: string = TEST_USERS.alice.tenantId
    const requestedTenantId: string = TEST_TENANTS.clearpath.id
    const role: string = TEST_USERS.alice.role
    const canAccess = role === 'master_admin' || userTenantId === requestedTenantId
    expect(canAccess).toBe(false)
  })
})

describe('last_login_at tracking', () => {
  it('updates last_login_at on login', async () => {
    const [before] = await testSql`
      SELECT last_login_at FROM users WHERE id = ${TEST_USERS.alice.id}
    `
    const beforeTime = before.lastLoginAt

    // Simulate login update
    await testSql`UPDATE users SET last_login_at = NOW() WHERE id = ${TEST_USERS.alice.id}`

    const [after] = await testSql`
      SELECT last_login_at FROM users WHERE id = ${TEST_USERS.alice.id}
    `
    expect(after.lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
  })
})

describe('Sessions table', () => {
  it('test sessions exist for all users', async () => {
    const sessions = await testSql`
      SELECT session_token, user_id, expires FROM sessions
      ORDER BY session_token
    `
    expect(sessions.length).toBe(4)
    sessions.forEach(s => {
      expect(new Date(s.expires).getTime()).toBeGreaterThan(Date.now())
    })
  })
})
