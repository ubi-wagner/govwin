/**
 * WHAT CAN A COLLABORATOR ACTUALLY REACH — the negative space, measured.
 *
 * Phase F proved a scoped `partner_user` sees only their granted SECTION's findings and cannot
 * resolve outside it. That is one gate. It says nothing about the two the customer actually worries
 * about:
 *
 *   · THE TENANT LIBRARY. Every atom the company owns — past proposals, cost models, personnel
 *     bios, pricing. A collaborator brought in to write one narrative section has no business
 *     reading any of it.
 *   · PROPOSAL ARTIFACTS OUTSIDE THE GRANT. The cost volume is the sharp case: a subcontractor
 *     collaborating on the technical narrative must not be able to read the prime's pricing.
 *
 * This drives a REAL signed-in collaborator with a one-section grant against every surface that
 * could leak either, and records what each one answers. It is written to be run BEFORE the fix as
 * well as after — a refusal that was never observed failing proves nothing about the code, and the
 * whole point of a blast-radius harness is that its first run is expected to find something.
 *
 * Grouped by what a leak would cost:
 *
 *   A · THE LIBRARY          atoms · canvas · past proposals · foundation docs
 *   B · THE WHOLE PROPOSAL   package (json/docx/zip) · the assembled document · preview · readiness
 *   C · THE COST VOLUME      the unassigned section's content, by every route that returns content
 *   D · WRITES               can they write into a section they were never assigned?
 *   E · THE PAGES            not just APIs — the rendered portal surfaces
 *
 * Every check states the ROUTE and the STATUS, so a run is a readable inventory rather than a
 * verdict. A 403/404 is a pass. A 200 that returns another section's words is a finding, and the
 * harness prints the words it should not have seen.
 *
 *   cd frontend && node scripts/verify-collaborator-blast-radius.mjs
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3001';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

const PROBE = 'blast-probe';
let ok = true;
const findings = [];
const A = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) { ok = false; findings.push(`${label} — ${extra}`); }
};
const H = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

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

const api = (page, url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, { ...(i ?? {}), headers: { 'Content-Type': 'application/json', ...(i?.headers ?? {}) } });
  const ct = r.headers.get('content-type') ?? '';
  if (/json|text/.test(ct)) return { status: r.status, text: await r.text(), bytes: null };
  return { status: r.status, text: '', bytes: (await r.arrayBuffer()).byteLength };
}, [url, init ?? null]);

const fkChildren = (ref) => sql`
  SELECT c.conrelid::regclass::text AS child, a.attname AS col
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.contype = 'f' AND c.confrelid = ${ref}::regclass
    AND array_length(c.conkey, 1) = 1`;

async function purgeRows(table, col, ids, depth = 0) {
  if (!ids.length || depth > 4) return;
  for (const k of await fkChildren(table)) {
    if (k.child === table) continue;
    const rows = await sql.unsafe(`SELECT id FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids]).catch(() => []);
    if (rows.length) await purgeRows(k.child, 'id', rows.map((r) => r.id), depth + 1);
    await sql.unsafe(`DELETE FROM ${k.child} WHERE ${k.col} = ANY($1::uuid[])`, [ids]).catch(() => {});
  }
  await sql.unsafe(`DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`, [ids]);
}

const FRAME = {
  width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  format: 'letter', header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1, min_font_size: 10, max_pages: 10, max_slides: null,
};
/** A phrase that appears ONLY in the cost volume. If it ever comes back, the leak is provable. */
const SECRET = 'FULLY-BURDENED-RATE-SEVENTEEN-THOUSAND-NINE-HUNDRED';
const canvasOf = (title, text) => JSON.stringify({
  version: 2, document_id: `${PROBE}-${title}`, canvas: FRAME,
  nodes: [{ id: `n-${title.replace(/\W+/g, '')}`, type: 'text_block', content: { text },
    style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false }],
  metadata: { title, status: 'in_progress', version_number: 1 },
});

/** Did this response leak the cost volume's secret phrase? */
const leaked = (r) => typeof r.text === 'string' && r.text.includes(SECRET);
/** A pass is a refusal, OR a 200 that provably does not carry the secret. */
const refusedOrClean = (r) => r.status === 403 || r.status === 404 || (r.status === 200 && !leaked(r));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let proposalId = null;

try {
  const [foundation] = await sql`SELECT id, slug FROM tenants WHERE slug = 'foundation'`;
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  const [author] = await sql`SELECT id, email, password_hash FROM users WHERE email = 'kate.ulepic@foundation3dp.com'`;
  if (!foundation || !anyOpp || !author) throw new Error('missing foundation tenant, opportunity or author');

  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) { await purgeRows('proposals', 'id', stale.map((r) => r.id)); console.log(`· swept ${stale.length} stale`); }
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PROBE + '%'})`.catch(() => {});
  await sql`DELETE FROM users WHERE email LIKE ${PROBE + '%'}`.catch(() => {});

  const [libCount] = await sql`
    SELECT count(*)::int AS n FROM library_atoms
    WHERE tenant_id = ${foundation.id}::uuid AND archived_at IS NULL`;
  console.log(`· the tenant library holds ${libCount.n} atom(s) a collaborator must not read`);

  // ── The build: one narrative section (GRANTED) and one cost volume (NOT granted) ────────────
  proposalId = randomUUID();
  const granted = randomUUID();
  const costVolume = randomUUID();
  await sql`
    INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked)
    VALUES (${proposalId}::uuid, ${foundation.id}::uuid, ${anyOpp.id}::uuid, ${PROBE + ' · blast radius'}, 'draft', false)`;
  await sql`
    INSERT INTO proposal_sections
      (id, proposal_id, section_number, title, content, status, sort_index, version, is_locked, volume_name, volume_number)
    VALUES
      (${granted}::uuid,    ${proposalId}::uuid, '1', 'Technical Approach',
       ${canvasOf('Technical Approach', 'The subcontractor is here to help with this narrative section only.')},
       'in_progress', 1, 1, false, 'Volume I · Technical', 1),
      (${costVolume}::uuid, ${proposalId}::uuid, '2', 'Cost Volume',
       ${canvasOf('Cost Volume', `Direct labour and indirect burden roll up to ${SECRET} across the base period.`)},
       'in_progress', 2, 1, false, 'Volume III · Cost', 3)`;

  // ── The collaborator: granted the NARRATIVE section, comment permission, draft stage only ───
  const collabEmail = `${PROBE}-sub@example.test`;
  const collabUser = randomUUID();
  const collabId = randomUUID();
  await sql`
    INSERT INTO users (id, email, name, password_hash, role, is_active, tenant_id)
    VALUES (${collabUser}::uuid, ${collabEmail}, 'Subcontractor', ${author.password_hash},
            'partner_user', true, ${foundation.id}::uuid)`;
  await sql`
    INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
    VALUES (${collabUser}::uuid, ${foundation.id}::uuid, 'partner_user', 'active', 'collaborator')`;
  await sql`
    INSERT INTO proposal_collaborators (id, proposal_id, user_id, email, name, role, assigned_sections, accepted_at)
    VALUES (${collabId}::uuid, ${proposalId}::uuid, ${collabUser}::uuid, ${collabEmail},
            'Subcontractor', 'external', ARRAY[${granted}]::uuid[], now())`;
  await sql`
    INSERT INTO collaborator_stage_access (collaborator_id, proposal_id, stage, artifact_types, permission)
    VALUES (${collabId}::uuid, ${proposalId}::uuid, 'draft', ARRAY['narrative']::text[], 'comment')`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const sub = await login(ctx, collabEmail, 'DemoPass123!');
  const L = `${BASE}/api/portal/${foundation.slug}`;
  const P = `${L}/proposals/${proposalId}`;

  // ── A · THE TENANT LIBRARY ──────────────────────────────────────────────────────────────────
  H('A · the tenant library');
  const libraryRoutes = [
    ['atoms',              `${L}/library/atoms?limit=50`],
    ['atoms (search)',     `${L}/library/atoms?q=cost&limit=50`],
    // POST, not GET — this route has no GET at all, and probing it with the wrong verb returns 405,
    // which is not a refusal, it is a missing handler. Reporting that as an open door would have
    // been a harness bug dressed as a security finding.
    ['canvas documents',   `${L}/library/canvas`, 'POST', '{}'],
    ['past proposals',     `${L}/library/past-proposals`],
    ['system templates',   `${L}/library/system-templates`],
  ];
  for (const [name, url, method, body] of libraryRoutes) {
    const r = await api(sub, url, method ? { method, body } : undefined);
    A(`library · ${name} is refused`, r.status === 403 || r.status === 404,
      `status=${r.status} ${String(r.text).slice(0, 90)}`);
  }

  // ── B · THE WHOLE PROPOSAL ──────────────────────────────────────────────────────────────────
  H('B · whole-proposal exports and assemblies');
  const wholeRoutes = [
    ['package json',   `${P}/package?format=json`],
    ['package docx',   `${P}/package?format=docx`],
    ['package zip',    `${P}/package?format=zip`],
    ['assembled doc',  `${P}/document`],
    ['preview',        `${P}/preview`],
    ['readiness',      `${P}/readiness`],
    ['compliance',     `${P}/compliance`],
    ['strategy',       `${P}/strategy`],
    ['supporting docs',`${P}/supporting-docs`],
  ];
  for (const [name, url] of wholeRoutes) {
    const r = await api(sub, url);
    A(`whole-proposal · ${name} does not hand over the cost volume`, refusedOrClean(r),
      `status=${r.status}${leaked(r) ? ' — LEAKED THE COST FIGURE' : ''} ${String(r.text).slice(0, 80)}`);
  }

  // ── C · THE COST VOLUME, by every route that returns section content ────────────────────────
  H('C · the cost volume section itself');
  const costRoutes = [
    ['sections list',        `${P}/sections`],
    ['section versions',     `${P}/sections/${costVolume}/versions`],
    ['comments (unscoped)',  `${P}/comments`],
    ['comments (by id)',     `${P}/comments?nodeId=${costVolume}`],
    ['findings (document)',  `${P}/findings`],
    ['findings (that section)', `${P}/findings?level=section&sectionId=${costVolume}`],
    ['activity',             `${P}/activity`],
  ];
  for (const [name, url] of costRoutes) {
    const r = await api(sub, url);
    A(`cost volume · ${name} does not return its content`, refusedOrClean(r),
      `status=${r.status}${leaked(r) ? ' — LEAKED THE COST FIGURE' : ''}`);
  }

  // ── D · WRITES into a section they were never assigned ──────────────────────────────────────
  H('D · writes outside the grant');
  // The VERB matters. `save` is PUT and `assign` is PATCH; POSTing at them returns 405, which is a
  // missing handler rather than a refusal — an easy way to record a door as locked when it was
  // never knocked on.
  const writes = [
    ['assemble from library', 'POST',  `${P}/sections/${costVolume}/assemble`, '{}'],
    // The field is `content`, not `document`. With the wrong name the route rejected on SHAPE
    // (400) before it ever reached its authorization check — so the probe learned nothing about
    // whether the door is locked. A 400 is not a refusal; it is a knock on the wrong door.
    ['save',                  'PUT',   `${P}/sections/${costVolume}/save`,
      JSON.stringify({ content: JSON.parse(canvasOf('x', 'injected')), baseVersion: 1 })],
    ['lock',                  'POST',  `${P}/sections/${costVolume}/lock`, '{}'],
    ['assign',                'PATCH', `${P}/sections/${costVolume}/assign`, JSON.stringify({ assignedTo: null })],
    ['atomize a node',        'POST',  `${P}/sections/${costVolume}/atomize-node`,
      JSON.stringify({ nodeIds: ['n-CostVolume'], title: 'stolen' })],
  ];
  const beforeVersions = await sql`
    SELECT count(*)::int AS n FROM canvas_versions WHERE section_id = ${costVolume}::uuid`;
  for (const [name, method, url, body] of writes) {
    const r = await api(sub, url, { method, body });
    // 405 is NOT a pass: it means the probe used the wrong verb and the door was never tried.
    // 405 (wrong verb) and 400 (wrong body shape) are NOT passes: both mean the request was
    // rejected before the authorization check, so the door was never actually tried.
    const notTried = r.status === 405 ? 'WRONG VERB' : r.status === 400 ? 'REJECTED ON SHAPE' : '';
    A(`write · ${name} is refused`, [403, 404, 423].includes(r.status),
      `${method} → ${r.status}${notTried ? ` (${notTried} — this probe proved nothing)` : ''} ${String(r.text).slice(0, 80)}`);
  }
  const afterVersions = await sql`
    SELECT count(*)::int AS n FROM canvas_versions WHERE section_id = ${costVolume}::uuid`;
  // SENSITIVITY: a refusal proves nothing if nothing could have been written anyway.
  A('and nothing was written to the cost volume', afterVersions[0].n === beforeVersions[0].n,
    `${beforeVersions[0].n} → ${afterVersions[0].n} version row(s)`);
  const [live] = await sql`SELECT content FROM proposal_sections WHERE id = ${costVolume}::uuid`;
  A('its live content is untouched', String(live.content).includes(SECRET));

  // ── E · THE RENDERED PAGES ──────────────────────────────────────────────────────────────────
  H('E · the rendered portal pages');
  const pages = [
    ['library',   `${BASE}/portal/${foundation.slug}/library`],
    ['documents', `${BASE}/portal/${foundation.slug}/documents`],
    ['templates', `${BASE}/portal/${foundation.slug}/templates`],
    ['proposal workspace', `${BASE}/portal/${foundation.slug}/proposals/${proposalId}`],
  ];
  for (const [name, url] of pages) {
    await sub.goto(url, { waitUntil: 'domcontentloaded' });
    await sub.waitForTimeout(2500);
    const seen = await sub.evaluate((s) => ({
      leaked: (document.body.innerText || '').includes(s),
      redirected: !location.pathname.includes('/library') && !location.pathname.includes('/documents')
        && !location.pathname.includes('/templates') && !location.pathname.includes('/proposals'),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 110),
    }), SECRET);
    A(`page · ${name} shows no cost figure`, !seen.leaked,
      seen.leaked ? 'THE COST FIGURE IS ON THE PAGE' : seen.text.slice(0, 70));
  }

  // ── The positive control — they CAN do their own job ─────────────────────────────────────────
  H('the positive control · their own section still works');
  const own = await api(sub, `${P}/findings?level=section&sectionId=${granted}`);
  A('they can read findings on their granted section', own.status === 200, `status=${own.status}`);
  const ownComment = await api(sub, `${P}/comments`, {
    method: 'POST', body: JSON.stringify({ nodeId: granted, text: 'A note on the narrative.' }),
  });
  A('they can comment on it', ownComment.status === 200 || ownComment.status === 201,
    `status=${ownComment.status} ${String(ownComment.text).slice(0, 80)}`);
} catch (e) {
  ok = false;
  console.error('\nHARNESS ERROR:', e.message);
} finally {
  await browser.close().catch(() => {});
  if (proposalId) await purgeRows('proposals', 'id', [proposalId]).catch((e) => {
    ok = false; console.error('CLEANUP FAILED:', e.message);
  });
  await sql`DELETE FROM user_memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PROBE + '%'})`.catch(() => {});
  await sql`DELETE FROM users WHERE email LIKE ${PROBE + '%'}`.catch(() => {});
  const [left] = await sql`SELECT count(*)::int AS n FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  const [users] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE ${PROBE + '%'}`;
  console.log(`\n· cleanup: ${left.n} probe proposal(s), ${users.n} probe user(s) remaining (want 0/0)`);
  if (left.n !== 0 || users.n !== 0) ok = false;
  await sql.end();
  if (!ok && findings.length) {
    console.log('\nOPEN — a scoped collaborator can reach:');
    findings.forEach((f) => console.log(`  · ${f}`));
  }
  console.log(ok ? '\n✓ the blast radius is the grant and nothing more'
                 : '\n✗ the blast radius exceeds the grant — see above');
  process.exit(ok ? 0 : 1);
}
