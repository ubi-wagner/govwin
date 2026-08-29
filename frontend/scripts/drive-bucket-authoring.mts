/**
 * drive-bucket-authoring — the tenant side of the ranking spine, as the three actors who own it.
 *
 * `canManageBuckets` admits THREE paths and the plan required all three be driven, because they
 * reach the same page through different gates and only one of them is the obvious one:
 *
 *   tenant_admin        the owner
 *   delegated member    a tenant_user carrying can_manage_buckets
 *   rfp_admin (shadow)  passes hasRoleAtLeast directly, with the derived shadow membership
 *
 * What it checks: the prefill copies the profile and does NOT discard typing; a profile with
 * nothing in it says so rather than reporting a silent success; and the composition line states a
 * percentage that matches what the SCORER computes for the same criteria.
 *
 * ⚠️ NOT read-only — it creates and deletes a bucket per actor. Sandbox only.
 *
 * Usage:  node --import tsx frontend/scripts/drive-bucket-authoring.mts
 * Exit:   0 pass · 1 fail · 2 HARNESS DEFECT (could not sign in / no fixture)
 */

import { chromium, type Page } from '@playwright/test';
import postgres from 'postgres';
import { describeComposition } from '../lib/bucket-scoring.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// The pinned build in /opt, not whatever Playwright's default resolver wants — the bundled
// chrome-headless-shell is not installed here. Same constant verify-surfaces.mjs uses.
const EXE = process.env.CHROMIUM_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const owner = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

/**
 * Which credential does this account use?
 *
 * `scripts/sandbox-reset-passwords.mjs` is the one place passwords are set, and it splits on the
 * user's GLOBAL role, not on their membership: a partner_admin holding a tenant_admin membership
 * still signs in with the admin password. Assuming TENANT_PW from the membership row is exactly
 * how a drive gets `/login?error=invalid` and reads it as a broken product flow (B146/B147).
 */
function passwordFor(globalRole: string): string {
  const ADMIN = process.env.ADMIN_PW ?? process.env.SANDBOX_PASSWORD ?? '';
  const TENANT = process.env.TENANT_PW ?? '';
  return ['master_admin', 'rfp_admin', 'partner_admin'].includes(globalRole) ? ADMIN : TENANT;
}

async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
  return !page.url().includes('/login');
}

async function main() {
  console.log('\ndrive-bucket-authoring — prefill + composition, three actor paths\n');

  // The tenant whose profile actually HAS something to copy. Selecting for what the consumer needs
  // rather than for what sorts first (B146/B147) — a prefill drive against an empty profile would
  // pass its "nothing to copy" branch and prove nothing about the copy.
  const [rich] = await owner<Array<{ slug: string; kw: number; ag: number }>>`
    SELECT t.slug,
           COALESCE(array_length(p.keywords, 1), 0) AS kw,
           COALESCE(array_length(p.agency_priorities, 1), 0) + COALESCE(array_length(p.target_agencies, 1), 0) AS ag
    FROM tenant_profiles p JOIN tenants t ON t.id = p.tenant_id
    WHERE COALESCE(array_length(p.keywords, 1), 0) > 0
    ORDER BY COALESCE(array_length(p.keywords, 1), 0) DESC LIMIT 1`;
  const [bare] = await owner<Array<{ slug: string }>>`
    SELECT t.slug FROM tenant_profiles p JOIN tenants t ON t.id = p.tenant_id
    WHERE COALESCE(array_length(p.keywords, 1), 0) = 0
      AND COALESCE(array_length(p.naics_codes, 1), 0) = 0
      AND COALESCE(array_length(p.agency_priorities, 1), 0) = 0
      AND COALESCE(array_length(p.target_agencies, 1), 0) = 0
    LIMIT 1`;
  if (!rich) {
    console.error('\nHARNESS CANNOT RUN: no tenant_profiles row carries keywords — the prefill has nothing to copy,\n' +
      'so a green would describe the empty branch only.\n');
    process.exit(2);
  }
  console.log(`  profile with content: ${rich.slug} (${rich.kw} keyword(s), ${rich.ag} agency value(s))`);
  console.log(`  profile with none:    ${bare?.slug ?? '(none on this box)'}\n`);

  const TENANT_PW = process.env.TENANT_PW ?? '';
  const ADMIN_PW = process.env.ADMIN_PW ?? process.env.MASTER_PW ?? '';
  if (!TENANT_PW) {
    console.error('\nHARNESS CANNOT RUN: TENANT_PW unset. Source scripts/sandbox-env.sh — one credential, one place.\n');
    process.exit(2);
  }

  // The three actors, resolved from the live membership table rather than hard-coded (an id or an
  // email typed into a harness rots on the next reseed).
  const actors = await owner<Array<{ userId: string; email: string; role: string; globalRole: string; canManage: boolean }>>`
    SELECT u.id AS user_id, u.email, m.role, u.role AS global_role, COALESCE(m.can_manage_buckets, false) AS can_manage
    FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
    WHERE t.slug = ${rich.slug} AND u.is_active
    ORDER BY CASE m.role WHEN 'tenant_admin' THEN 0 ELSE 1 END, u.email`;
  // GLOBAL role too: a partner_admin can hold a tenant_admin MEMBERSHIP, but it descends through
  // the partner console rather than signing straight into the portal, so it is a different actor
  // wearing the same membership row. Prefer the real one; fall back only if there is none.
  const tenantAdmin = actors.find((a) => a.role === 'tenant_admin' && a.globalRole === 'tenant_admin')
    ?? actors.find((a) => a.role === 'tenant_admin');
  let delegated = actors.find((a) => a.role !== 'tenant_admin' && a.canManage);
  // rfp_admin OR ABOVE — master_admin outranks it, and `canManageBuckets` gates on
  // hasRoleAtLeast('tenant_admin'), so either exercises the same shadow descent. A box with no
  // rfp_admin is not a reason to leave the path uncovered.
  const [platformAdmin] = await owner<Array<{ email: string; role: string }>>`
    SELECT email, role FROM users WHERE role IN ('rfp_admin', 'master_admin') AND is_active
    ORDER BY CASE role WHEN 'rfp_admin' THEN 0 ELSE 1 END, created_at LIMIT 1`;

  // ── The delegated member: find a candidate ANYWHERE, and grant for the run ────────────────
  // `can_manage_buckets` is the entire point of that column (mig 181) and no seeded account carries
  // it, so this path would report "uncovered" forever — and uncovered is not passing. The candidate
  // does NOT have to belong to the rich-profile tenant: this check only asks whether a delegated
  // member reaches the authoring form, which needs a member, not a profile. Tying it to the same
  // tenant is what left it uncovered, since that tenant has exactly one member.
  let delegateTenant = rich.slug;
  let madeDelegate: string | null = null;
  if (!delegated) {
    const [candidate] = await owner<Array<{ userId: string; email: string; role: string; globalRole: string; slug: string }>>`
      SELECT u.id AS user_id, u.email, m.role, u.role AS global_role, t.slug
      FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
      WHERE u.is_active AND u.role = 'tenant_user' AND m.role = 'tenant_user' AND t.status = 'active'
      ORDER BY t.created_at, u.email LIMIT 1`;
    if (candidate) {
      await owner`UPDATE user_memberships SET can_manage_buckets = true
                  WHERE user_id = ${candidate.userId}::uuid
                    AND tenant_id = (SELECT id FROM tenants WHERE slug = ${candidate.slug})`;
      madeDelegate = candidate.userId;
      delegateTenant = candidate.slug;
      delegated = { ...candidate, canManage: true };
      console.log(`  granted can_manage_buckets to ${candidate.email} on ${candidate.slug} for this run (reverted at the end)`);
    }
  }

  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    // ── 1 · tenant_admin: the prefill copies, and does not clobber ────────────────────────────
    console.log('1 · tenant_admin — prefill from the company profile');
    if (!tenantAdmin) { ok('a tenant_admin exists for this tenant', false, 'none found'); }
    else {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      if (!(await signIn(page, tenantAdmin.email, passwordFor(tenantAdmin.globalRole)))) {
        console.error(`\nHARNESS CANNOT RUN: could not sign in as ${tenantAdmin.email}.\n`);
        await browser.close(); await owner.end(); process.exit(2);
      }
      await page.goto(`${BASE}/portal/${rich.slug}/buckets`, { waitUntil: 'domcontentloaded' });
      const btn = page.getByRole('button', { name: /start from our company profile/i });
      const visible = await btn.isVisible().catch(() => false);
      ok('the prefill control is on the page', visible);
      if (visible) {
        const kwInput = page.locator('input[placeholder="keywords, comma-sep"]');
        // A field the customer already typed into must survive the prefill.
        await kwInput.fill('MY OWN TYPING');
        await btn.click();
        await page.waitForTimeout(800);
        ok('typing already in a field is NOT discarded', (await kwInput.inputValue()) === 'MY OWN TYPING');

        await kwInput.fill('');
        await btn.click();
        await page.waitForTimeout(800);
        const filled = await kwInput.inputValue();
        ok('an empty field IS filled from the profile', filled.trim().length > 0, filled.slice(0, 48));

        const profileKw = await owner<Array<{ keywords: string[] }>>`
          SELECT p.keywords FROM tenant_profiles p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = ${rich.slug}`;
        const expected = (profileKw[0]?.keywords ?? []).join(', ');
        ok('what it filled is what the profile HOLDS', filled === expected,
          filled === expected ? `${expected.slice(0, 40)}…` : `page="${filled.slice(0, 30)}" db="${expected.slice(0, 30)}"`);

        // ── the composition line ──────────────────────────────────────────────────────────────
        // Built from what the FORM now holds, read back off the page — not from the profile. The
        // prefill fills agencies as well as keywords, so a keywords-only expectation describes a
        // DIFFERENT bucket and manufactures a confident, wrong finding. Copy the predicate from the
        // source: the source here is the four inputs the customer is looking at.
        const readField = async (placeholder: string) =>
          (await page.locator(`input[placeholder="${placeholder}"]`).inputValue())
            .split(',').map((x) => x.trim()).filter(Boolean);
        const expectedShares = describeComposition({
          keywords: await readField('keywords, comma-sep'),
          agencies: await readField('agencies, comma-sep'),
          programTypes: await readField('program types (SBIR, STTR)'),
          naics: await readField('NAICS codes, comma-sep'),
          useTimeline: true,
        });
        const line = await page.locator('text=/Scores on \\d+ signal/').first().textContent().catch(() => null);
        ok('the composition line renders', !!line, line?.slice(0, 76) ?? 'not found');
        for (const e of expectedShares.entries) {
          ok(`  it states ${e.key} at the share the SCORER computes (${e.share}%)`,
            !!line && line.includes(`${e.share}%`));
        }
      }
      await ctx.close();
    }

    // ── 2 · the empty-profile branch says so ─────────────────────────────────────────────────
    console.log('\n2 · a profile with nothing in it — does the button admit it?');
    if (!bare) { console.log('  (skipped: every profile on this box has content)'); }
    else {
      const [bareAdmin] = await owner<Array<{ email: string; globalRole: string }>>`
        SELECT u.email, u.role AS global_role FROM user_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
        WHERE t.slug = ${bare.slug} AND m.role = 'tenant_admin' AND u.is_active
        ORDER BY CASE u.role WHEN 'tenant_admin' THEN 0 ELSE 1 END LIMIT 1`;
      if (!bareAdmin) { ok('a tenant_admin exists for the bare tenant', false); }
      else {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        if (await signIn(page, bareAdmin.email, passwordFor(bareAdmin.globalRole))) {
          await page.goto(`${BASE}/portal/${bare.slug}/buckets`, { waitUntil: 'domcontentloaded' });
          const btn = page.getByRole('button', { name: /start from our company profile/i });
          if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(800);
            const msg = await page.locator('text=/nothing to copy/i').first().isVisible().catch(() => false);
            const kw = await page.locator('input[placeholder="keywords, comma-sep"]').inputValue();
            ok('it SAYS there is nothing to copy', msg);
            ok('and it did not claim success on an empty form', kw.trim() === '');
          } else ok('the prefill control is on the page', false);
        } else ok(`sign in as ${bareAdmin.email}`, false);
        await ctx.close();
      }
    }

    // ── 3 · the delegated member ─────────────────────────────────────────────────────────────
    console.log('\n3 · a delegated member with can_manage_buckets');
    if (!delegated) {
      console.log('  (no delegated member on this box — the path is UNCOVERED, not passing)');
    } else {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      if (await signIn(page, delegated.email, passwordFor(delegated.globalRole))) {
        await page.goto(`${BASE}/portal/${delegateTenant}/buckets`, { waitUntil: 'domcontentloaded' });
        const onForm = await page.getByRole('button', { name: /start from our company profile/i }).isVisible().catch(() => false);
        ok('reaches the authoring form', onForm, `${delegated.email} → ${delegateTenant}`);
        // The other half of the gate: WITHOUT the grant the same member must be turned away, or the
        // green above would only prove the page renders for anyone who can reach the tenant.
        if (madeDelegate) {
          await owner`UPDATE user_memberships SET can_manage_buckets = false WHERE user_id = ${madeDelegate}::uuid`;
          await page.goto(`${BASE}/portal/${delegateTenant}/buckets`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(600);
          ok('and is REFUSED once the grant is removed', !page.url().includes('/buckets'), `redirected to ${page.url().split('/').slice(3).join('/')}`);
          await owner`UPDATE user_memberships SET can_manage_buckets = true WHERE user_id = ${madeDelegate}::uuid`;
        }
      } else ok(`sign in as ${delegated.email}`, false);
      await ctx.close();
    }

    // ── 4 · the rfp_admin shadow path ────────────────────────────────────────────────────────
    console.log('\n4 · rfp_admin descending into the tenant (the shadow path)');
    if (!platformAdmin || !ADMIN_PW) {
      console.log(`  (skipped: ${!platformAdmin ? 'no active rfp_admin or master_admin' : 'ADMIN_PW unset'} — UNCOVERED, not passing)`);
    } else {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      if (await signIn(page, platformAdmin.email, ADMIN_PW)) {
        await page.goto(`${BASE}/portal/${rich.slug}/buckets`, { waitUntil: 'domcontentloaded' });
        ok('reaches the authoring form through the shadow membership',
          await page.getByRole('button', { name: /start from our company profile/i }).isVisible().catch(() => false),
          `${platformAdmin.email} (${platformAdmin.role})`);
      } else ok(`sign in as ${platformAdmin.email}`, false);
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (madeDelegate) {
      await owner`UPDATE user_memberships SET can_manage_buckets = false WHERE user_id = ${madeDelegate}::uuid`;
      console.log('\n   reverted the temporary can_manage_buckets grant');
    }
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}\n`);
  await owner.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await owner.end(); process.exit(1); });
