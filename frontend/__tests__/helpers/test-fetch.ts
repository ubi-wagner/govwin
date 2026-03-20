/**
 * Test HTTP helper — makes requests to the Next.js dev server during integration tests.
 *
 * For integration tests that need a running server, start it before tests:
 *   TEST_DATABASE_URL=... npm run dev -- --port 3099
 *
 * For unit/DB-only tests, use testSql directly instead.
 */

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3099'

type FetchOptions = {
  method?: string
  body?: unknown
  sessionToken?: string
  headers?: Record<string, string>
}

/**
 * Make an authenticated request to the test server.
 * Passes the session token as a cookie to simulate NextAuth sessions.
 */
export async function testFetch(path: string, opts: FetchOptions = {}) {
  const { method = 'GET', body, sessionToken, headers = {} } = opts

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  // Simulate NextAuth session via cookie
  if (sessionToken) {
    fetchHeaders['Cookie'] = `next-auth.session-token=${sessionToken}`
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual', // Don't follow redirects — we want to test them
  })

  return {
    status: res.status,
    headers: res.headers,
    json: res.headers.get('content-type')?.includes('json')
      ? await res.json()
      : null,
    text: async () => res.text(),
    ok: res.ok,
  }
}

/**
 * Shorthand helpers for authenticated requests as each test persona.
 */
export function asAdmin(path: string, opts: Omit<FetchOptions, 'sessionToken'> = {}) {
  return testFetch(path, { ...opts, sessionToken: 'test-session-admin' })
}

export function asAlice(path: string, opts: Omit<FetchOptions, 'sessionToken'> = {}) {
  return testFetch(path, { ...opts, sessionToken: 'test-session-alice' })
}

export function asBob(path: string, opts: Omit<FetchOptions, 'sessionToken'> = {}) {
  return testFetch(path, { ...opts, sessionToken: 'test-session-bob' })
}

export function asCarol(path: string, opts: Omit<FetchOptions, 'sessionToken'> = {}) {
  return testFetch(path, { ...opts, sessionToken: 'test-session-carol' })
}

export function asAnonymous(path: string, opts: Omit<FetchOptions, 'sessionToken'> = {}) {
  return testFetch(path, opts)
}
