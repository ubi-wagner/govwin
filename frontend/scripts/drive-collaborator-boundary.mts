/** Live COLLABORATOR-boundary negative drive (FINDING 1). A cross-company collaborator holds a
 *  partner_user membership that PASSES verifyTenantAccess (see lib/db.ts) — so the atom READ routes
 *  must floor at tenant_user, or the collaborator reads the whole tenant library beyond their section
 *  scope. This mints a throwaway partner_user in Foundation, logs in, and asserts:
 *    · the 4 library READ routes → 403 (the leak is closed)
 *    · a real tenant_user (conor) → 200 on the same routes (the floor is tenant_user, not higher)
 *    · the collaborator still PASSES the write-path role gate (contribution not over-blocked)
 *  Then it hard-removes the throwaway fixture it created. No business data is touched.
 *  cd frontend && node --import tsx scripts/drive-collaborator-boundary.mts */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { clientHeaders } from './lib/client-ip.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const sql = postgres('postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 2 });
let ok = true;
/** True when the failure was environmental — the box, not the boundary. */
let cannotRun = false;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };
const TEMP_EMAIL = 'zz.collab.boundary@foundation3dp.com';
let tempId = '';

async function loginAndProbe(email: string, password: string, routes: string[]) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    const p = await (await b.newContext({ extraHTTPHeaders: clientHeaders() })).newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', password);
    await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
    await p.waitForTimeout(1000);
    const hit = (path: string, init?: unknown) => p.evaluate(async ([u, i]) => {
      const r = await fetch(u as string, (i as RequestInit) || undefined); return { status: r.status, body: (await r.text()).slice(0, 300) };
    }, [path, init] as const);
    const out: Record<string, { status: number; body: string }> = {};
    for (const r of routes) out[r] = await hit(r);
    // write-path role probe: an empty POST to capture — role gate runs first; a role PASS yields 400
    // (bad body), a role FAIL yields 403. We only care that it is NOT 403 for the collaborator.
    out['__write'] = await hit('/api/portal/foundation/atoms/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return out;
  } finally { await b.close(); }
}

try {
  const [ten] = await sql<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug='foundation'`;
  const [conor] = await sql<Array<{ id: string; password_hash: string; temp_password: boolean; terms_accepted_at: string | null }>>`
    SELECT id, password_hash, temp_password, terms_accepted_at FROM users WHERE email='conor.atkins@foundation3dp.com'`;
  // tenant-visible so conor's by-id read is a real 200 (not a visibility 404 for the wrong reason)
  const [atom] = await sql<Array<{ id: string }>>`SELECT id FROM library_atoms WHERE tenant_id=${ten.id}::uuid AND visibility='tenant' AND vault_id IS NULL LIMIT 1`;
  if (!ten || !conor || !atom) throw new Error('missing fixtures (tenant/conor/atom)');

  // Mint a throwaway partner_user collaborator in Foundation, cloning conor's (working) credential
  // flags so the login lands clean. GLOBAL role partner_user → JWT carries partner_user.
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email=${TEMP_EMAIL})`;
  await sql`DELETE FROM users WHERE email=${TEMP_EMAIL}`;
  const [made] = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password, terms_accepted_at)
    VALUES (${TEMP_EMAIL}, 'ZZ Collab Boundary', 'partner_user', ${ten.id}::uuid, ${conor.password_hash}, true, false, now())
    RETURNING id`;
  tempId = made.id;
  await sql`INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
            VALUES (${tempId}::uuid, ${ten.id}::uuid, 'partner_user', 'active', 'collaborator')`;
  A('minted a throwaway partner_user collaborator in Foundation', !!tempId);

  const READS = [
    '/api/portal/foundation/atoms',
    '/api/portal/foundation/atoms/select?kinds=narrative,figure&limit=5',
    `/api/portal/foundation/atoms/${atom.id}`,
    '/api/portal/foundation/library/atoms',
  ];

  // 1) Collaborator: every library READ must be 403 (FINDING 1 closed).
  const collab = await loginAndProbe(TEMP_EMAIL, 'DemoPass123!', READS);
  for (const r of READS) A(`collaborator BLOCKED: GET ${r.split('?')[0]} → 403`, collab[r].status === 403, `status=${collab[r].status}`);
  A('collaborator still PASSES the write-path role gate (contribution not over-blocked)', collab['__write'].status !== 403, `capture POST status=${collab['__write'].status}`);

  // 2) Real tenant_user (conor): the SAME reads must be 200 — the floor is tenant_user, not higher.
  const staff = await loginAndProbe('conor.atkins@foundation3dp.com', 'DemoPass123!', READS);
  for (const r of READS) A(`tenant_user ALLOWED: GET ${r.split('?')[0]} → 200`, staff[r].status === 200, `status=${staff[r].status}`);
} catch (e) {
  /*
   * ⚠️ "COULD NOT RUN" IS NOT "LEAKED", AND SAYING SO IS WORSE THAN SAYING NOTHING.
   *
   * This branch used to set `ok = false`, and the verdict below then printed
   * "FAIL — the collaborator boundary leaked". On the suite run that prompted this, the actual
   * error was `ERR_CONNECTION_REFUSED at http://localhost:3000/login` — the app was not serving —
   * and the table reported a SECURITY FINDING the drive had not measured. Anyone reading it would
   * have believed tenant isolation was broken.
   *
   * A drive that cannot run is still a failure (uncovered, not passing — the suite's own rule), so
   * the exit code stays non-zero. What changes is the CLAIM: it now says what actually happened.
   */
  console.error('FAILED:', e);
  ok = false;
  cannotRun = /ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR|Timeout|timeout exceeded/i.test(String(e));
}
finally {
  if (tempId) {
    try {
      await sql`DELETE FROM user_memberships WHERE user_id = ${tempId}::uuid`;
      await sql`DELETE FROM users WHERE id = ${tempId}::uuid`;
      console.log('  🧹 removed the throwaway collaborator fixture');
    } catch (e) { console.error('cleanup failed', e); }
  }
  await sql.end({ timeout: 5 });
}
console.log(ok
  ? '\nPASS — collaborators cannot read the tenant library (403); tenant_user staff can (200); collaborators still contribute'
  : cannotRun
    ? '\nCANNOT RUN — the app was not reachable, so the boundary was never probed. Uncovered, not passing,\n'
      + 'and NOT a finding: bring the sandbox up (scripts/sandbox-up.sh) and run it again.'
    : '\nFAIL — the collaborator boundary leaked');
process.exit(ok ? 0 : 1);
