# CLAUDE.md — GovWin Project Standards

This file defines mandatory engineering standards for all code written in this project.
These are not suggestions — they are requirements that apply to every file, every commit.

---

## SOP: Error Handling & Defensive Programming

**Every piece of code must handle failure gracefully. No exceptions.**

### Server Components (Next.js async pages/layouts)

- ALL database queries (`await sql\`...\``) MUST be wrapped in try-catch
- Re-throw Next.js internal errors (redirects): `if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e`
- Throw user-friendly errors that the error boundary can display
- Log the actual error with a tagged prefix: `console.error('[ComponentName] description:', e)`

### API Routes

- ALL database queries MUST be wrapped in try-catch returning `NextResponse.json({ error: '...' }, { status: 500 })`
- ALL external calls (getTenantBySlug, verifyTenantAccess, etc.) MUST be wrapped in try-catch
- Parse request body with try-catch: `try { body = await request.json() } catch { return 400 }`
- Validate all required parameters before any DB call
- Handle unique constraint violations (code `23505`) with specific 409 responses
- Log errors with route-tagged prefixes: `console.error('[GET /api/route] Error:', error)`

### Client Components

- ALL `fetch()` calls MUST:
  - Check `if (!res.ok)` before parsing response
  - Use `.catch()` on promise chains OR wrap in try-catch for async/await
  - Parse JSON safely: `await res.json().catch(() => ({}))`
  - Set error state for user display
  - Handle loading states
- Mutating actions (POST, PATCH, DELETE) MUST have try-catch with error feedback
- Include retry capability where appropriate (retry buttons in error UI)

### Database Layer (lib/db.ts)

- Validate DATABASE_URL at module load — fail fast with clear message
- All connection pools MUST have `.on('error')` handlers
- Helper functions that query the DB should either:
  - Handle errors internally and return null/false, OR
  - Let errors propagate (caller MUST catch)

### Auth (lib/auth.ts)

- `authorize()` DB queries MUST be wrapped in try-catch (return null on failure)
- Non-critical updates (last_login_at) should be wrapped separately — never block login
- JWT callback DB lookups MUST be wrapped in try-catch

### Error Boundaries

- `app/global-error.tsx` MUST exist — catches root layout errors
- `app/error.tsx` MUST exist — catches page-level errors within layout
- Both must be `'use client'` components with a `reset` function

### Null Checking

- Never use non-null assertion (`!`) on values that could actually be null
- Use optional chaining (`?.`) and nullish coalescing (`??`) for all potentially-null access
- Check array results before destructuring: handle empty query results
- Default to safe values: `data.field ?? 0`, `data.items ?? []`

---

## SOP: Code Quality Standards

### Before Every Commit

- Run `npx tsc --noEmit` — zero type errors allowed
- No unhandled promises (every async call must be awaited or caught)
- No `console.log` in production code — use `console.error` for error logging only

### API Design

- Return consistent shapes: `{ data: T }` for success, `{ error: string }` for failure
- Always include proper HTTP status codes (400, 401, 403, 404, 409, 500)
- Auth checks first, then input validation, then business logic

### Security

- Always verify tenant access before returning tenant-specific data
- Never trust client input — validate and sanitize
- Never expose internal error details to the client (log them server-side)
- Parameterize all SQL queries (postgres.js tagged templates handle this)

---

## Project Structure Reference

```
frontend/
  app/
    (auth)/login/       # Auth pages
    admin/              # Master admin dashboard (client components)
    portal/             # Tenant portal (layout = server component, pages = client)
    api/                # API routes (all server-side)
    error.tsx           # App error boundary
    global-error.tsx    # Root error boundary
  lib/
    auth.ts             # NextAuth config
    db.ts               # Database connections + helpers
  types/
    index.ts            # Shared TypeScript types
pipeline/               # Python data pipeline
db/                     # SQL migrations and schema
```
