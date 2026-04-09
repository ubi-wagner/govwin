# TESTING_STRATEGY.md — Binding Test Strategy

**Status: BINDING.** Every new feature must have tests at the appropriate level. "No tests" is not an acceptable state for a PR to land.

See also: [CLAUDE.md](../CLAUDE.md), [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md).

---

## Test pyramid

Three levels, in order of speed and cost:

1. **Unit tests** — pure functions in `frontend/lib/`. No DB. No HTTP. No filesystem. Fast (<50ms per test). Run on every save. Live under `frontend/__tests__/unit/`.
2. **Integration tests** — API routes + tools exercised against a throwaway PostgreSQL. Medium speed (~100ms-1s per test). Run in CI and before every PR. Live under `frontend/__tests__/integration/`.
3. **E2E smoke tests** — Playwright against a running `next dev`. Slow (seconds per test). Run on PR and merge-to-main. Live under `frontend/__tests__/e2e/` (or `frontend/e2e/` if Playwright's default).

Most tests should be unit or integration. E2E is for the critical paths only — "can a user log in, change their password, and see their dashboard" — not for exhaustive coverage.

---

## What goes at each level

| Subject | Level | Why |
|---|---|---|
| Pure function in `lib/` (rbac, validation, formatters) | Unit | Fast, deterministic, no side effects |
| New API route | Integration | Routes pull in auth, DB, validation, error handling — must be tested end-to-end within the process |
| New tool | Integration (via `registry.invoke`) | Tools must be tested through the registry, not called directly — that's how they are invoked in production |
| User flow (login → dashboard → logout) | E2E smoke | Only way to catch middleware + client JS interactions |
| Schema change | Integration | Add a test that exercises the new column/table via an API route or tool |
| `lib/db.ts` connection logic | Integration | Touches real PG |
| `lib/logger.ts` format | Unit | Pure |
| `lib/errors.ts` class hierarchy | Unit | Pure |
| `middleware.ts` path gating | Unit (path logic) + Integration (full cookie round-trip) | Both — the decision table is unit-testable, the cookie parsing is not |

Rule of thumb: if it touches the network, the filesystem, or Postgres, it's an integration test. Everything else is a unit test.

---

## Vitest setup

`frontend/vitest.config.ts` skeleton:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['__tests__/setup/pg.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    exclude: ['__tests__/e2e/**', 'node_modules/**'],
    testTimeout: 10_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serialize DB access
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

`pool: 'forks'` with `singleFork: true` serializes test suites so they share one PG instance without cross-talk. If we grow past ~5s total runtime, revisit by spawning one PG per worker.

---

## Throwaway PG setup

`frontend/__tests__/setup/pg.ts` algorithm:

1. **If `TEST_DATABASE_URL` is set in env**, use it. This is the CI path — the workflow spins up a service container and hands us the URL. Run migrations against it once on first import (guarded by a module-level promise).
2. **Otherwise, spawn a local PG16** via `pg_ctl`:
   - Allocate a temp data directory under `os.tmpdir()`.
   - `initdb -D <tmp>` with trust authentication.
   - Pick a random free port (bind a throwaway socket, read its port, release).
   - `pg_ctl start -D <tmp> -o "-p <port>"`.
   - `createdb -p <port> govtech_intel_test`.
   - Set `process.env.DATABASE_URL = 'postgresql://localhost:<port>/govtech_intel_test'`.
   - Run all migrations via `bash db/migrations/run.sh` (with the temp `DATABASE_URL`).
3. **`beforeEach` in each suite**: `TRUNCATE` all tenant-scoped tables, cascade. Keep seed data in `system_config`, `compliance_variables`, `agent_archetypes`, and the `master_admin` user row.
4. **`afterAll`**: stop PG via `pg_ctl stop`, remove the temp data directory.

The helper exports:

```ts
export async function getTestDb(): Promise<Sql>;
export async function resetTestDb(): Promise<void>;
```

Tests import `getTestDb` when they need direct SQL access (rare — prefer using actor request helpers). `resetTestDb` is called from `beforeEach` in tests that need isolation from neighbors.

---

## Fixture pattern

Fixtures are factory functions under `frontend/__tests__/fixtures/`. They INSERT real rows into the test DB — they are not mocks.

```
__tests__/fixtures/
  users.ts         # createUser, createMasterAdmin, createTenantAdmin, createTenantUser, createPartnerUser
  tenants.ts       # createTenant
  opportunities.ts # createOpportunity, createOpportunityWithDocuments
  memories.ts      # createMemory
```

Example factory signature:

```ts
export async function createUser(opts: {
  role?: Role;
  tenantSlug?: string;
  email?: string;
  tempPassword?: boolean;
  name?: string;
} = {}): Promise<UserRow> {
  const sql = await getTestDb();
  const email = opts.email ?? `test-${randomUUID()}@example.com`;
  const role = opts.role ?? 'tenant_user';
  const tenantId = opts.tenantSlug ? await resolveTenantId(opts.tenantSlug) : null;
  const [row] = await sql<UserRow[]>`
    INSERT INTO users (email, role, tenant_id, password_hash, temp_password, name)
    VALUES (${email}, ${role}, ${tenantId}, ${await hashPassword('test-password')},
            ${opts.tempPassword ?? false}, ${opts.name ?? null})
    RETURNING *
  `;
  return row;
}
```

Rules:

- Factories return the full row with all generated fields (UUID, timestamps).
- Sensible defaults — tests should be one-liners: `await createUser({ role: 'tenant_admin' })`.
- Factories never mock. If the real INSERT fails, the test fails.
- Factories are composable: `createTenant` calls nothing; `createTenantAdmin` calls `createTenant` + `createUser`.

---

## Actor pattern

Actors are per-role request helpers under `frontend/__tests__/actors/`. Each actor knows how to make authenticated requests as a specific role.

```
__tests__/actors/
  anonymous.ts   # no cookie
  master.ts      # master_admin
  rfp_admin.ts   # rfp_admin
  tenant_admin.ts
  tenant_user.ts
  partner_user.ts
```

Each actor exports a `request` helper:

```ts
export async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { body?: unknown; query?: Record<string, string> } = {}
): Promise<{ status: number; data?: unknown; error?: string }>;
```

Example usage in a test:

```ts
const res = await masterAdmin.request('POST', '/api/admin/tenants', {
  body: { slug: 'acme', name: 'Acme Corp' },
});
expect(res.status).toBe(201);
expect(res.data).toMatchObject({ slug: 'acme' });
```

Under the hood, the helper:

1. On first call, creates a user via the appropriate fixture (e.g., `createMasterAdmin`).
2. Mints a NextAuth JWT directly using `AUTH_SECRET` and the same claims shape the real `authorize()` produces.
3. Stores the signed cookie on the actor instance.
4. Invokes the Next.js route handler directly (importing `route.ts` and calling the method export), passing a `NextRequest` that includes the cookie.
5. Returns `{ status, data }` on success or `{ status, error }` on failure.

This simulates the full auth chain: middleware runs, session parses, role check fires. No HTTP server is involved — we import route handlers and call them. This is fast, deterministic, and exercises 100% of the production auth path.

---

## Scenario pattern

Scenarios live under `frontend/__tests__/scenarios/` and compose multiple actors across a workflow.

```
__tests__/scenarios/
  login-and-change-password.test.ts
  invite-colleague-full-flow.test.ts
  curate-and-push-rfp.test.ts
```

Example skeleton:

```ts
describe('invite-colleague-full-flow', () => {
  it('lets a tenant_admin invite a user who then accepts and sets a password', async () => {
    const admin = await tenantAdmin.instance({ tenantSlug: 'acme' });
    const inviteRes = await admin.request('POST', '/api/portal/acme/team', {
      body: { email: 'newbie@example.com', role: 'tenant_user' },
    });
    expect(inviteRes.status).toBe(201);
    const token = (inviteRes.data as any).inviteToken;

    const acceptRes = await anonymous.request('POST', `/api/invite/${token}`, {
      body: { password: 'newpass-123' },
    });
    expect(acceptRes.status).toBe(200);

    const loginRes = await anonymous.request('POST', '/api/auth/callback/credentials', {
      body: { email: 'newbie@example.com', password: 'newpass-123' },
    });
    expect(loginRes.status).toBe(302); // redirect to dashboard
  });
});
```

Scenarios are the closest thing we have to production-like tests without full E2E overhead. Prefer them over bespoke integration tests when a feature spans multiple actors.

---

## Running tests

Commands (defined in `frontend/package.json`):

| Command | What it does | Expected exit |
|---|---|---|
| `npm test` | Vitest — unit only, no DB | 0 |
| `npm run test:unit` | Vitest — explicit unit file list | 0 |
| `npm run test:integration` | Vitest — integration suite with throwaway PG | 0 |
| `npm run test:e2e` | Playwright full smoke | 0 |
| `npm run test:all` | Type check + unit + integration + e2e | 0 |
| `npm run test:ci` | What CI runs — `test:all` + coverage + junit XML output | 0 |

Developer loop: run `npm test` on save via vitest watch; run `npm run test:integration` before pushing; let CI run `test:ci`.

`scripts/test-all.sh` at the repo root is the cross-service runner (frontend + pipeline). Use it when making a change that touches both.

---

## Coverage targets

We do not chase 100% coverage. We chase **meaningful coverage**:

- Every function in `lib/` — at least a happy path + one error path.
- Every API route — happy path + unauthenticated rejection + validation failure + (if tenant-scoped) cross-tenant rejection.
- Every tool — happy path + tenant isolation check + invalid input rejection.
- Every user flow in `CLAUDE_CLIFFNOTES.md`'s "Known-good local dev stack" — E2E smoke.

If coverage on a file is below 70% lines, the PR reviewer should ask why.

---

## Test naming

Use Vitest's `describe` and `it`. Do **not** use `test()`. Do **not** use "should" phrasing.

Prefer:

- `it('returns 401 when unauthenticated', ...)`
- `it('throws ValidationError when email is missing', ...)`
- `it('isolates memories by tenant', ...)`

Avoid:

- `it('should return 401', ...)`
- `test('auth works', ...)`
- `it('does the thing', ...)`

`describe` blocks name the feature or subject under test: `describe('POST /api/auth/change-password', ...)`, `describe('hasRoleAtLeast', ...)`, `describe('memory.search tool', ...)`.

---

## Mocking rules

**Mock external services only.** Anthropic, Stripe, Resend, SAM.gov API — use `vi.mock()` to stub these out. Provide a test double that returns canned responses.

**Do NOT mock our own code.** Use the real `lib/db` (against the throwaway PG), the real `lib/logger`, the real `lib/tools/registry`. Mocking internal code hides integration bugs and makes refactors painful.

If a test is hard to write because of deep dependencies, the solution is usually to add a fixture or an actor, not to mock.

---

## Worked examples

### 1. Unit test — `lib/rbac.ts` `hasRoleAtLeast`

```ts
// __tests__/unit/rbac.test.ts
import { describe, it, expect } from 'vitest';
import { hasRoleAtLeast } from '@/lib/rbac';

describe('hasRoleAtLeast', () => {
  it('returns true when actual role outranks required', () => {
    expect(hasRoleAtLeast('master_admin', 'tenant_user')).toBe(true);
  });

  it('returns true when actual role equals required', () => {
    expect(hasRoleAtLeast('tenant_admin', 'tenant_admin')).toBe(true);
  });

  it('returns false when actual role is below required', () => {
    expect(hasRoleAtLeast('tenant_user', 'rfp_admin')).toBe(false);
  });

  it('returns false for unknown role strings', () => {
    expect(hasRoleAtLeast('guest' as any, 'tenant_user')).toBe(false);
  });
});
```

### 2. Integration test — `POST /api/auth/change-password`

```ts
// __tests__/integration/change-password.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb } from '../setup/pg';
import { anonymous, tenantUser } from '../actors';
import { createUser } from '../fixtures/users';

describe('POST /api/auth/change-password', () => {
  beforeEach(async () => { await resetTestDb(); });

  it('returns 401 when unauthenticated', async () => {
    const res = await anonymous.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'x', newPassword: 'y' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when new password is too short', async () => {
    const user = await createUser({ role: 'tenant_user', tempPassword: true });
    const actor = await tenantUser.instance({ userId: user.id });
    const res = await actor.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'test-password', newPassword: 'abc' },
    });
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/password/i);
  });

  it('updates password and clears temp_password flag on success', async () => {
    const user = await createUser({ role: 'tenant_user', tempPassword: true });
    const actor = await tenantUser.instance({ userId: user.id });
    const res = await actor.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'test-password', newPassword: 'a-real-password-42' },
    });
    expect(res.status).toBe(200);
    // Verify DB state directly
    const sql = await getTestDb();
    const [row] = await sql`SELECT temp_password FROM users WHERE id = ${user.id}`;
    expect(row.tempPassword).toBe(false);
  });
});
```

### 3. Integration test — `memory.search` tool via registry

```ts
// __tests__/integration/memory-search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, getTestDb } from '../setup/pg';
import { registry } from '@/lib/tools';
import { createTenant } from '../fixtures/tenants';
import { createMemory } from '../fixtures/memories';

describe('memory.search tool', () => {
  beforeEach(async () => { await resetTestDb(); });

  it('returns memories matching the query for the caller tenant', async () => {
    const tenant = await createTenant({ slug: 'acme' });
    await createMemory({ tenantId: tenant.id, content: 'acme wins on price' });
    await createMemory({ tenantId: tenant.id, content: 'nothing relevant here' });

    const res = await registry.invoke('memory.search', {
      args: { query: 'price', limit: 10 },
      ctx: { tenantId: tenant.id, userId: 'test-user', role: 'tenant_admin' },
    });

    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0].content).toContain('price');
  });

  it('isolates memories across tenants', async () => {
    const tenantA = await createTenant({ slug: 'acme' });
    const tenantB = await createTenant({ slug: 'beta' });
    await createMemory({ tenantId: tenantA.id, content: 'secret to acme only' });

    const res = await registry.invoke('memory.search', {
      args: { query: 'secret', limit: 10 },
      ctx: { tenantId: tenantB.id, userId: 'test-user', role: 'tenant_admin' },
    });

    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(0); // tenantB cannot see tenantA's memories
  });

  it('rejects invalid input shapes', async () => {
    const tenant = await createTenant({ slug: 'acme' });
    const res = await registry.invoke('memory.search', {
      args: { query: '' }, // empty query
      ctx: { tenantId: tenant.id, userId: 'test-user', role: 'tenant_admin' },
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION_ERROR');
  });
});
```

---

## Deviations

If you cannot follow this strategy for a specific test, call it out in the PR description and propose an amendment. "I couldn't figure out how to test it" is not a valid excuse — ask for help before skipping.
