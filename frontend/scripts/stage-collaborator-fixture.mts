/**
 * A real collaborator, with real assigned work — staged through the product.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────────────────────
 * The collaborator guide illustrated three different screens — the landing, the dashboard and the
 * activity view — with ONE image, and that image showed an empty collaborator:
 *
 *     Proposals · 0 active proposals
 *     No proposals yet — You haven't been added to any proposals yet.
 *
 * Identical md5 across all three files. So a reader following the guide was shown a picture of
 * somebody who has nothing, three times, captioned as three populated screens. That is worse than
 * an out-of-date screenshot: an old shot at least once described the product, and this never did.
 *
 * Nothing captured those files — no script writes `img/collab/` — which is why re-running a capture
 * would not have fixed it either. The fixture had to exist first.
 *
 * ── WHAT IT MAKES, AND WHY THROUGH THE ROUTE ─────────────────────────────────────────────────
 * A `partner_user` invited to a real proposal with REAL assigned sections, by the tenant_admin who
 * would invite them, through `POST …/proposals/[id]/collaborators`. Inviting by INSERT can produce a
 * collaborator the product would never make — no invite record, no audit, a section list that does
 * not match the proposal — and the guide would then illustrate a state a reader cannot reach.
 *
 * ⚠️ LEAVES the collaborator behind, deliberately: the capture runs next, and a tenant with one
 * outside contributor is an ordinary tenant. Idempotent — re-inviting the same address re-uses the
 * existing row rather than stacking duplicates.
 *
 *   BASE_URL=http://localhost:3109 node --import tsx frontend/scripts/stage-collaborator-fixture.mts
 */
import postgres from 'postgres';
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? process.env.GUIDE_BASE ?? 'http://localhost:3000';
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });
const SLUG = process.env.TENANT_SLUG ?? 'foundation';

/** The guide's collaborator. A stable address so re-running re-uses one row. */
export const COLLAB_EMAIL = 'dana.reyes@partner-optics.example';
const COLLAB_NAME = 'Dana Reyes';

const say = (s: string) => console.log(`  ${s}`);

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  console.log('\nstage-collaborator-fixture — a contributor with work, made by the product\n');
  const TENANT_PW = process.env.TENANT_PW ?? '';
  const COLLAB_PW = process.env.COLLAB_PW ?? 'DemoPass123!';

  const [tAdmin] = await owner<Array<{ email: string }>>`
    SELECT u.email FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
    WHERE t.slug = ${SLUG} AND m.role = 'tenant_admin' AND u.role = 'tenant_admin' AND u.is_active
      AND COALESCE(u.temp_password, false) = false ORDER BY u.created_at LIMIT 1`;
  if (!tAdmin || !TENANT_PW) { console.error('CANNOT RUN: no tenant_admin / TENANT_PW unset'); process.exit(2); }

  // A proposal with SECTIONS — a collaborator scoped to nothing photographs the same empty screen
  // the old picture showed, which is the failure this fixture exists to end.
  const [prop] = await owner<Array<{ id: string; title: string; n: number }>>`
    SELECT p.id, p.title, (SELECT count(*)::int FROM proposal_sections s WHERE s.proposal_id = p.id) AS n
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE t.slug = ${SLUG} AND p.archived_at IS NULL
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC, p.created_at
    LIMIT 1`;
  if (!prop || prop.n === 0) { console.error(`CANNOT RUN: ${SLUG} has no proposal with sections`); process.exit(2); }
  const sections = await owner<Array<{ id: string; title: string }>>`
    SELECT id, title FROM proposal_sections
    WHERE proposal_id = ${prop.id}::uuid ORDER BY sort_index LIMIT 3`;
  say(`proposal : ${prop.title?.slice(0, 52)} (${prop.n} sections)`);
  say(`assigning: ${sections.map((s) => s.title).join(' · ').slice(0, 70)}`);

  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const p = await browser.newPage();
    if (!(await signIn(p, tAdmin.email, TENANT_PW))) { console.error('CANNOT RUN: tenant sign-in failed'); process.exit(2); }
    const res = await p.evaluate(async ([slug, pid, email, name, secs]) => {
      const r = await fetch(`/api/portal/${slug}/proposals/${pid}/collaborators`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role: 'contributor', assignedSections: secs, dropboxEnabled: true }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, [SLUG, prop.id, COLLAB_EMAIL, COLLAB_NAME, sections.map((s) => s.id)] as const);
    say(`invite   ${res.status}  ${JSON.stringify(res.body).slice(0, 84)}`);
    await p.close();
  } finally {
    await browser.close().catch(() => {});
  }

  /*
   * ACCEPTANCE, THE PASSWORD, AND THE ROLE — the three the route cannot do for us.
   *
   * A real invite is accepted by the person from an emailed link, and their password is theirs;
   * neither is reachable from a harness.
   *
   * ⚠️ AND THE ROLE IS THE ONE THAT NEARLY PRODUCED A WRONG GUIDE. The proposal collaborator invite
   * creates the account as a **tenant_user** — an internal team member. Signing in as that account
   * lands on the FULL tenant dashboard ("Welcome back, Dana · 4 active builds") with Proposals,
   * Contracts, Projects, Library, Team, Documents and Templates in the nav, and all four of the
   * tenant's builds listed. Entirely correct for a tenant_user, and the first capture photographed
   * exactly that and would have shipped it as "Your landing — only your assigned work".
   *
   * The guide's subject is the SCOPED OUTSIDE contributor — global role `partner_user`, whose
   * membership passes verifyTenantAccess but whose reads floor at tenant_user (see
   * drive-collaborator-boundary.mts). That is a different account shape, and the invite route does
   * not make it. So the role is set here, deliberately and visibly, rather than letting a
   * plausible-looking screenshot assert something about isolation that is not true.
   */
  const [u] = await owner<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${COLLAB_EMAIL} LIMIT 1`;
  if (!u) { console.error('CANNOT RUN: the invite created no user'); process.exit(2); }
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.default.hash(process.env.COLLAB_PW ?? 'DemoPass123!', 10);
  await owner`UPDATE users SET password_hash = ${hash}, temp_password = false, is_active = true,
                               role = 'partner_user'
              WHERE id = ${u.id}::uuid`;
  await owner`UPDATE user_memberships SET role = 'partner_user' WHERE user_id = ${u.id}::uuid`;
  await owner`UPDATE proposal_collaborators SET accepted_at = COALESCE(accepted_at, now()), revoked_at = NULL
              WHERE user_id = ${u.id}::uuid`;
  say(`account  ${COLLAB_EMAIL} · password set · invite accepted`);

  const [check] = await owner<Array<{ n: number; secs: number; role: string }>>`
    SELECT count(*)::int AS n, COALESCE(max(array_length(pc.assigned_sections, 1)), 0) AS secs,
           max(u.role) AS role
    FROM proposal_collaborators pc JOIN users u ON u.id = pc.user_id
    WHERE pc.user_id = ${u.id}::uuid AND pc.revoked_at IS NULL`;
  say(`verified ${check.n} collaboration(s) · ${check.secs} assigned section(s) · global role ${check.role}`);
  if (check.role !== 'partner_user') {
    console.error('\n  ✗ the account is not a partner_user — the guide would illustrate an internal '
      + 'team member as a scoped outside collaborator\n');
    await owner.end();
    process.exit(1);
  }
  if (check.n === 0 || check.secs === 0) {
    console.error('\n  ✗ the fixture is not what the guide needs — a scoped collaborator with sections\n');
    await owner.end();
    process.exit(1);
  }
  console.log(`\n  (left in place — sign in as ${COLLAB_EMAIL} / ${COLLAB_PW})\n`);
  await owner.end();
}
main().catch((e) => { console.error('\nSTAGE ERROR:', e); process.exit(2); });
