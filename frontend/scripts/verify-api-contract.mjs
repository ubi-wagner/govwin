/**
 * Lens 2 of 3 — the API CONTRACT. Does every GET route return the envelope the SOP promises?
 *
 * `verify-surfaces.mjs` asks whether a PAGE renders. This asks the question underneath it: when the
 * page calls its API, does the API answer in the shape the rest of the codebase is written to
 * expect. CLAUDE.md states the contract in two lines, and they are checkable:
 *
 *     Return consistent shapes: `{ data: T }` success, `{ error: string, code: string }` failure
 *     EVERY error response MUST include both `error` and `code` fields
 *
 * A route that 200s with a bare array, or 500s with `{error}` and no `code`, satisfies every test in
 * the suite and still breaks the caller that destructures `.data` or switches on `.code`. Nothing in
 * the repo checked it until now.
 *
 * Method, and the reason for it: every route is called THROUGH A REAL SESSION (a logged-in browser
 * context, `page.evaluate(fetch)`), not with a forged header. Auth and tenant scoping are part of
 * the contract — a route that answers differently to an anonymous caller is answering a different
 * question, and a 401 harness would grade the wrong thing.
 *
 * Dynamic segments are bound from real rows, and a route that cannot be addressed is REPORTED, not
 * skipped — the same rule the surface sweep learned the hard way.
 *
 *   cd frontend && node scripts/verify-api-contract.mjs
 * Exit 0 if every reachable GET honours the envelope; 1 otherwise.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const APP = '/home/user/govwin/frontend/app/api';
const ADMIN_PW = process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/** Every route.ts that actually exports a GET, as an API path. */
function getRoutes(root, prefix) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, rel + '/' + e.name);
      else if (e.name === 'route.ts' && /export\s+(async\s+)?function\s+GET/.test(fs.readFileSync(p, 'utf8'))) {
        out.push((prefix + rel).replace(/\/\(.*?\)/g, ''));
      }
    }
  };
  walk(root, '');
  return out.sort();
}

async function bindings() {
  const [prop] = await sql`
    SELECT p.id, p.opportunity_id, p.solicitation_id, t.slug
    FROM proposals p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.archived_at IS NULL AND t.slug = 'foundation'
    ORDER BY (SELECT count(*) FROM proposal_sections s WHERE s.proposal_id = p.id) DESC LIMIT 1`;
  const [sect] = prop ? await sql`
    SELECT id FROM proposal_sections WHERE proposal_id = ${prop.id}
    ORDER BY sort_index ASC NULLS LAST LIMIT 1` : [];
  const [art] = prop ? await sql`SELECT id FROM proposal_artifacts WHERE proposal_id = ${prop.id} LIMIT 1` : [];
  const [atom] = await sql`
    SELECT la.id FROM library_atoms la JOIN tenants t ON t.id = la.tenant_id
    WHERE t.slug = 'foundation' AND la.archived_at IS NULL LIMIT 1`;
  const [bucket] = await sql`
    SELECT b.id FROM tenant_spotlight_buckets b JOIN tenants t ON t.id = b.tenant_id
    WHERE t.slug = 'foundation' LIMIT 1`;
  const [card] = await sql`
    SELECT c.id FROM tenant_opportunity_cards c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = 'foundation' AND c.archived_at IS NULL LIMIT 1`;
  const [task] = await sql`SELECT id FROM tasks LIMIT 1`;
  const [inst] = await sql`SELECT id FROM process_instances LIMIT 1`;
  const [sol] = await sql`SELECT id FROM curated_solicitations ORDER BY created_at DESC LIMIT 1`;
  const [opp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  const [tenant] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  const [portal] = await sql`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`;
  const [tmpl] = await sql`SELECT id FROM document_templates LIMIT 1`.catch(() => [undefined]);
  const [src] = await sql`SELECT id FROM source_profiles LIMIT 1`.catch(() => [undefined]);
  const [usr] = await sql`
    SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE t.slug = 'foundation' LIMIT 1`;
  return {
    tenantSlug: 'foundation', proposalId: prop?.id, sectionId: sect?.id, artifactId: art?.id,
    atomId: atom?.id, bucketId: bucket?.id, cardId: card?.id, taskId: task?.id,
    instanceId: inst?.id, solId: sol?.id, opportunityId: opp?.id, tenantId: tenant?.id,
    portalId: portal?.id, templateId: tmpl?.id, profileId: src?.id, userId: usr?.id,
  };
}

const rows = [];

/**
 * Grade one response against the SOP envelope.
 *
 * Deliberately NOT graded as a failure: a 401/403/404 with a correct `{error, code}` body. Those are
 * the contract working — a route refusing an actor it should refuse. Only the SHAPE is on trial.
 */
function grade(status, text, ctype = '') {
  if (status === 204 || text.trim() === '') return { ok: true, note: 'empty body' };
  // A FILE download is not an envelope violation — an export route returning docx/xlsx/pdf/zip
  // bytes is behaving correctly, and grading it against `{data}` would invent a defect.
  if (!/json/i.test(ctype)) return { ok: true, note: `binary/${(ctype.split(';')[0] || 'unknown').split('/').pop()}` };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, note: `content-type says JSON but body does not parse (${text.slice(0, 60)})` }; }
  if (status >= 400) {
    const hasErr = typeof body?.error === 'string';
    const hasCode = typeof body?.code === 'string';
    if (hasErr && hasCode) return { ok: true, note: `${status} ${body.code}` };
    return { ok: false, note: `${status} error body missing ${!hasErr ? 'error' : ''}${!hasErr && !hasCode ? '+' : ''}${!hasCode ? 'code' : ''}` };
  }
  if (body && typeof body === 'object' && 'data' in body) return { ok: true, note: 'data' };
  // A success that is not `{data}` — the caller destructuring `.data` gets undefined.
  const shape = Array.isArray(body) ? 'bare array' : body === null ? 'null' : `keys: ${Object.keys(body ?? {}).slice(0, 4).join(',')}`;
  return { ok: false, note: `200 without {data} — ${shape}` };
}

async function call(page, url) {
  const r = { url, status: null, ok: false, note: '' };
  try {
    // Return the FULL body and the content-type. The first version sliced to 2000 chars BEFORE
    // parsing, so every response longer than that failed JSON.parse and was reported as "not JSON"
    // — 38 of them, every one a well-formed `{data:…}`. Truncation is for DISPLAY only; the grader
    // must see what the caller sees. (Same class as everything else this session: the instrument
    // lying, and the lie looking exactly like a product defect.)
    const res = await page.evaluate(async (u) => {
      const resp = await fetch(u, { headers: { accept: 'application/json' } });
      return { status: resp.status, ctype: resp.headers.get('content-type') ?? '', text: await resp.text() };
    }, url);
    r.status = res.status;
    const g = grade(res.status, res.text, res.ctype);
    r.ok = g.ok; r.note = g.note;
  } catch (e) {
    r.note = String(e.message).slice(0, 60);
  }
  rows.push(r);
  if (!r.ok) console.log(`  ✗ ${url.padEnd(62)} ${String(r.status ?? '—').padStart(3)}  ${r.note}`);
  return r.ok;
}

async function login(ctx, email, pw) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#email', { timeout: 20000 });
  await p.fill('#email', email); await p.fill('#password', pw);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2500);
  if (p.url().includes('/login')) throw new Error(`login failed for ${email}`);
  return p;
}

console.log(`· serving ${BASE} · binding ids from ${DB.replace(/:[^:@/]*@/, ':***@')}`);
const B = await bindings();
const bind = (r) => r.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, k) => B[k] ?? `[${k}]`);
const addressable = (r) => !/\[/.test(bind(r));
const unbound = [];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  for (const [label, email, pw, root, prefix] of [
    ['tenant · tenant_admin', 'kate.ulepic@foundation3dp.com', 'DemoPass123!', path.join(APP, 'portal'), '/api/portal'],
    ['admin · master_admin', 'eric@rfppipeline.com', ADMIN_PW, path.join(APP, 'admin'), '/api/admin'],
  ]) {
    console.log(`\n── ${label} ──`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await login(ctx, email, pw);
    let n = 0;
    for (const route of getRoutes(root, prefix)) {
      if (!addressable(route)) { unbound.push(route); continue; }
      await call(p, bind(route)); n += 1;
    }
    console.log(`  (${n} route(s) called)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await sql.end();
}

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length} GET route(s) called · ${rows.length - bad.length} honour the envelope · ${bad.length} do not`);
if (unbound.length) {
  console.log(`\n${unbound.length} route(s) NOT called — no row to bind their parameters:`);
  for (const r of unbound) console.log(`  · ${r}`);
}
if (bad.length) {
  console.log('\n✗ envelope violations (the SOP: {data} on success · {error,code} on failure):');
  for (const r of bad) console.log(`  · ${r.url} — ${r.note}`);
  process.exit(1);
}
console.log('\n✓ every reachable GET honours the response contract.');
