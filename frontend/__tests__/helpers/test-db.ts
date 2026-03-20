/**
 * Test database helper — spins up a clean test database with seed data
 * for integration tests. Uses the same migrations as production.
 *
 * Usage:
 *   import { setupTestDb, teardownTestDb, testSql } from './helpers/test-db'
 *   beforeAll(() => setupTestDb())
 *   afterAll(() => teardownTestDb())
 *   // use testSql for queries in tests
 *
 * Environment:
 *   TEST_DATABASE_URL — Postgres connection string (defaults to local dev DB with _test suffix)
 */
import postgres from 'postgres'
import { execSync } from 'child_process'
import path from 'path'

const TEST_DB_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel_test'

// Parse the DB name from the URL for create/drop
const dbName = new URL(TEST_DB_URL).pathname.slice(1)
const adminUrl = TEST_DB_URL.replace(`/${dbName}`, '/postgres')

export let testSql: ReturnType<typeof postgres>

/**
 * Create a fresh test DB, run all migrations, seed test data.
 * Call in beforeAll().
 */
export async function setupTestDb() {
  // Create database (drop if exists)
  const admin = postgres(adminUrl, { max: 1 })
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
    await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }

  // Run migrations via psql (uses the same migration runner as production)
  const migrationsDir = path.resolve(__dirname, '../../db/migrations')
  execSync(`bash "${migrationsDir}/run.sh"`, {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  })

  // Connect the test client
  testSql = postgres(TEST_DB_URL, {
    max: 5,
    idle_timeout: 10,
    transform: { column: postgres.toCamel },
  })

  // Verify connectivity
  const [{ now }] = await testSql`SELECT NOW() as now`
  if (!now) throw new Error('Test DB connection failed')
}

/**
 * Drop the test DB and close connections.
 * Call in afterAll().
 */
export async function teardownTestDb() {
  if (testSql) await testSql.end()

  const admin = postgres(adminUrl, { max: 1 })
  try {
    // Terminate other connections first
    await admin.unsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${dbName}' AND pid <> pg_backend_pid()
    `)
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
  } finally {
    await admin.end()
  }
}

// ── Test data constants (match 005_seed_test_data.sql) ──────────────

export const TEST_TENANTS = {
  techforward: {
    id: 'a1111111-1111-1111-1111-111111111111',
    slug: 'techforward-solutions',
    name: 'TechForward Solutions LLC',
    plan: 'professional',
  },
  clearpath: {
    id: 'b2222222-2222-2222-2222-222222222222',
    slug: 'clearpath-consulting',
    name: 'ClearPath Consulting Group',
    plan: 'starter',
  },
} as const

export const TEST_USERS = {
  admin: {
    id: 'user-admin-001',
    email: 'admin@govwin.test',
    role: 'master_admin' as const,
    tenantId: null,
    sessionToken: 'test-session-admin',
  },
  alice: {
    id: 'user-alice-001',
    email: 'alice@techforward.test',
    role: 'tenant_admin' as const,
    tenantId: TEST_TENANTS.techforward.id,
    sessionToken: 'test-session-alice',
  },
  bob: {
    id: 'user-bob-001',
    email: 'bob@techforward.test',
    role: 'tenant_user' as const,
    tenantId: TEST_TENANTS.techforward.id,
    sessionToken: 'test-session-bob',
  },
  carol: {
    id: 'user-carol-001',
    email: 'carol@clearpath.test',
    role: 'tenant_admin' as const,
    tenantId: TEST_TENANTS.clearpath.id,
    sessionToken: 'test-session-carol',
  },
} as const

export const TEST_PASSWORD = 'TestPass123!'

export const TEST_OPPORTUNITIES = {
  cloudMigration: 'c0000001-0001-0001-0001-000000000001',
  cybersecurity:  'c0000002-0002-0002-0002-000000000002',
  pmo:            'c0000003-0003-0003-0003-000000000003',
  devSecOps:      'c0000004-0004-0004-0004-000000000004',
  workforce:      'c0000005-0005-0005-0005-000000000005',
  dataAnalytics:  'c0000006-0006-0006-0006-000000000006',
  itModernize:    'c0000007-0007-0007-0007-000000000007',
  closed:         'c0000008-0008-0008-0008-000000000008',
} as const
