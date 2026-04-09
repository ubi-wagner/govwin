# Definition of Done

Binding pre-commit / pre-PR / pre-phase checklist. Every item is actionable — if you can't tick a box, the change isn't ready.

See also: [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [ERROR_HANDLING.md](./ERROR_HANDLING.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [TESTING_STRATEGY.md](./TESTING_STRATEGY.md), [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md), [NAMESPACES.md](./NAMESPACES.md).

---

## Per-commit checklist

Every single commit must pass all of these. No exceptions for "fix later" commits — if the gate fails, the commit doesn't land.

### Build gates

- [ ] `cd frontend && npx tsc --noEmit` → exit 0
- [ ] `cd frontend && npx next build` → exit 0 (catches ESLint rules + page data collection + edge-runtime errors that `tsc` misses)
- [ ] `python3 -m py_compile <changed pipeline files>` → exit 0 for any pipeline change
- [ ] `bash -n <changed shell scripts>` → exit 0 for any shell change
- [ ] If the commit touches a SQL migration: apply against a throwaway PostgreSQL 16 instance and verify with a test query. Re-apply the migration to confirm idempotency.

### Code hygiene

- [ ] No `console.log` anywhere under `frontend/app` or `frontend/lib`. Enforce via:
  ```
  grep -rn 'console\.log' frontend/app frontend/lib  # must return 0
  ```
- [ ] No `console.error` outside `frontend/lib/logger.ts` (the fallback when pino init fails is the only allowed call site).
- [ ] No new `any` types in changed files. `grep` for `: any` and `as any` in the diff.
- [ ] No `// TODO` or `// FIXME` without an accompanying issue/PR reference.
- [ ] Every new public function has a JSDoc block or Python docstring with at least one sentence of intent.
- [ ] Every new file has a header comment explaining its purpose and listing its `docs/*.md` reference.

### Convention conformance

- [ ] API routes use `withHandler` from `lib/api-helpers.ts` (or document the opt-out, e.g. `/api/health`).
- [ ] Response shapes match [API_CONVENTIONS.md §"Response shape"](./API_CONVENTIONS.md) — `{ data: T }` on success, `{ error, code, details? }` on failure.
- [ ] Scoped logging via `lib/logger.ts` `createLogger(scope)` with a scope from [NAMESPACES.md §"Log scope names"](./NAMESPACES.md).
- [ ] Significant actions emit start + end events (or a single event) per [EVENT_CONTRACT.md](./EVENT_CONTRACT.md).
- [ ] Input validation uses zod, never `typeof` checks. Shared primitives from `lib/validation.ts`.
- [ ] Errors thrown are `AppError` subclasses from `lib/errors.ts` or `ToolError` subclasses from `lib/tools/errors.ts`. No `throw new Error('...')`.
- [ ] Tenant-scoped queries include `WHERE tenant_id = ${ctx.actor.tenantId}` (or `ctx.tenantId` inside tools).

---

## Per-PR checklist

In addition to every commit in the PR passing the per-commit checks:

### Tests

- [ ] At least one unit test exists for every new pure function in `frontend/lib/`.
- [ ] At least one integration test exists for every new API route (Phase 1+ — Phase 0.5b uses mocked integrations).
- [ ] At least one test exists for every new tool, invoked through the registry (not via direct handler call).
- [ ] Every error path has a corresponding `expect(...).rejects.toBeInstanceOf(SomeError)` assertion.
- [ ] The full test suite passes: `cd frontend && npm test` → all green.

### Docs

- [ ] If the PR adds a new namespace (event, tool, or log scope), [NAMESPACES.md](./NAMESPACES.md) is updated in the same PR.
- [ ] If the PR introduces a new architectural decision, `docs/DECISIONS.md` has a new entry.
- [ ] If the PR changes a binding convention doc, the change includes a link to the motivating discussion or ticket.

### Schema

- [ ] New tables include an `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` column and a trigger updating it (see `001_baseline.sql` for the pattern).
- [ ] Migrations are idempotent. Verified by applying twice against a throwaway PG16 — second run must succeed with no duplicate-key errors.
- [ ] Destructive migrations (anything that DROPs or TRUNCATEs) are gated by `ALLOW_SCHEMA_RESET` checks in both `db/migrations/run.sh` and `pipeline/src/main.py`.
- [ ] New tenant-scoped tables include `tenant_id UUID NOT NULL REFERENCES tenants(id)` and an index on `tenant_id`.

### Security

- [ ] No secrets (passwords, API keys, tokens) in the diff — run `git diff --cached | grep -E 'password|secret|api_key|bearer' -i` and check.
- [ ] No new sensitive fields logged. If you add one, update the redact list in `lib/logger.ts`.
- [ ] Tenant isolation: any new SQL that touches tenant-scoped tables has been visually verified to include the tenant filter.

---

## Per-phase gate

Before declaring a phase (0.5b, 1, 2, …) complete and cutting the git tag:

- [ ] Full test suite passes: `cd frontend && npm test`
- [ ] Full local dev stack boots: `docker compose up -d` → migrations apply → seed data loads → login works end-to-end with the seed credentials
- [ ] The phase tag exists: `git tag v<phase>-foundation-complete` pushed to origin
- [ ] `docs/CLAUDE_CLIFFNOTES.md` updated to reflect the new state — the next Claude session should be able to pick up without re-reading this session's transcripts
- [ ] `CHANGELOG.md` has a new entry summarizing the phase deliverables
- [ ] At least one reference implementation per major category is wired (for 0.5b: one API route using `withHandler`, one tool using the registry, one admin page, one unit-tested lib module)

---

## Code review prompts

Questions a reviewer should ask for every PR. If the answer to any is unclear, request changes or clarification:

1. **Does every query include `WHERE tenant_id` for tenant-scoped tables?** (Check each SQL block in the diff.)
2. **Does every API route throw typed errors**, not `return NextResponse.json({ error })`?
3. **Does every handler emit start + end events** (or document why a single event is sufficient)?
4. **Is there a test for the error path**, not just the happy path?
5. **Does the PR body cross-reference `docs/NAMESPACES.md`** for any new namespace?
6. **Does the PR body link to the issue, plan section, or ticket** it's closing? ("Closes #42", "Implements Phase 1 item 1.4", etc.)
7. **Does the PR add any `console.*`, `any`, or raw `NextResponse.json({ error })`?** If yes, reject.
8. **Can the reviewer explain what happens when `ctx.actor` is null**, or when the input fails validation, or when the DB is unreachable? If not, the tests aren't covering enough.

---

## Automation matrix

| Check | Automated | Manual in review |
|---|---|---|
| `tsc --noEmit` | CI | — |
| `next build` | CI | — |
| `vitest run` | CI | — |
| `py_compile` | CI | — |
| Migration idempotency | CI (apply twice against throwaway PG) | — |
| `console.log` ban | CI (grep step) | — |
| Secret leak check | CI (trufflehog or similar, Phase 5) | Current (Phase 0.5b): manual grep |
| Semantic convention conformance | — | Review |
| Test coverage quality | — | Review |
| Doc cross-references | — | Review |

**Phase 0.5b does not yet have CI wired** to run every item in the automation column — that's Phase 1 work (`.github/workflows/ci.yml` updates). Until then, the developer is responsible for running every check locally before pushing. Every commit in Phase 0.5b was manually verified against this checklist.

---

## Escape hatches

Some checks have documented escape hatches for exceptional cases. Using an escape hatch requires a justification comment in the code.

- **ESLint rule disable**: `// eslint-disable-next-line <rule> — <justification>` — the justification is required
- **`console.error`**: allowed only inside `lib/logger.ts` as a fallback. Any other call site fails review.
- **`any`**: allowed only at boundaries with untyped external libraries. Must be narrowed to a specific type or `unknown` before the value flows anywhere.
- **`// @ts-ignore`**: banned. Use `// @ts-expect-error <why>` instead so the expectation becomes stale when the underlying issue is fixed.
- **Test skip**: `test.skip(...)` requires a comment `// test:skip: <reason>` AND an issue/PR link. Unconditional skips fail review.

---

## The "is this really done?" self-check

Before you push:

1. Can you explain to the next person what you shipped, in one sentence?
2. Can you explain what happens when the thing you added breaks?
3. Can you point at the test that proves it works?
4. Can you point at the doc that tells the next developer how to use it?
5. Does the commit message explain **why**, not just **what**?

If all five are yes → push. Otherwise, not done.
