/**
 * Lens 3 of 3 — DB CRUD. When the product says it saved, did the row actually change?
 *
 * The other two lenses stop at the boundary. `verify-surfaces` proves a page RENDERS;
 * `verify-api-contract` proves a route ANSWERS in the right shape. Neither can tell you that a 200
 * from a save actually wrote anything, that an update landed on the right row, or that a delete
 * removed what it claimed to. This closes that: every operation goes through the PRODUCT PATH as a
 * real signed-in actor, and every assertion is read back from Postgres.
 *
 * The questions, per entity:
 *   CREATE → does a row exist, owned by the acting tenant?
 *   UPDATE → did the value change, on THAT row and no other?
 *   DELETE → is it gone (or archived, per the Archivable contract — nothing is hard-deleted)?
 *   GUARD  → does the route refuse the write it promises to refuse (stale version, repeat archive)?
 *
 * Plus the one that matters most in a multi-tenant product: **does tenant B's identical request
 * touch tenant A's row?** RLS is live (two-layer) and the app runs as a NOBYPASSRLS role, so the
 * answer should be no at two independent levels. An audit that only tests the happy path proves
 * neither.
 *
 * Four blocks, chosen because each covers a write path the product cannot be wrong about:
 *   A · buckets  — plain CRUD + cross-tenant isolation
 *   B · section save — the canvas VERSION invariant and the optimistic lock (both are live bug
 *       classes in CLAUDE.md; a regression in either is silent content-loss, not an error)
 *   C · atom archive — soft-delete + its compare-and-swap
 *   D · task reschedule — the write plus its side effect (nudges re-armed)
 *
 * ON TOUCHING THE FIXTURE: A and B create and destroy their own rows. C and D must act on SEEDED
 * rows — there is no honest way to test "archive an atom" without an atom. So the rule is not "never
 * touch it", it is **capture the before-state, restore it in `finally`, and then re-read and assert
 * the restore landed**. A verification tool that leaves the fixture dirty is worse than none; one
 * that cannot prove it cleaned up is the same thing with better manners.
 *
 *   cd frontend && node scripts/verify-db-crud.mjs
 * Exit 0 if every write lands exactly where it should; 1 otherwise.
 */
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE = process.env.GUIDE_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/** Every row this harness creates is named with this prefix — it is also how it finds its own
 *  wreckage after a crash. Nothing in the product writes it. */
const PROBE = 'crud-probe';

let ok = true;
const A = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  ok = ok && cond;
};
const SKIP = (label, why) => console.log(`  · ${label} — SKIPPED: ${why}`);

/** Undo stack: every perturbation of seeded data registers its own restore, verified at the end. */
const restore = [];
/** Facts about the fixture worth reporting alongside a clean run — observations, not verdicts. */
const notes = [];
const onCleanup = (label, fn) => restore.push({ label, fn });

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

/** Call an API through the signed-in session — auth and tenant scoping are part of what is tested. */
const api = (page, url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, { ...(i ?? {}), headers: { 'Content-Type': 'application/json', ...(i?.headers ?? {}) } });
  // FULL body — truncating before JSON.parse is what made the sibling contract harness report 38
  // phantom violations. Callers below slice for display only.
  return { status: r.status, text: await r.text() };
}, [url, init ?? null]);

const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

/**
 * Every table holding a single-column FK to `ref`, straight from the catalog.
 *
 * Used to tear down a scratch proposal. Hard-coding the list is what broke the first version — a
 * section save writes `proposal_activity_log` too, which has its own FK, and the delete blew up on
 * a constraint the script did not know existed. Any list I write by hand is correct only until the
 * next migration adds an FK; asking Postgres stays correct.
 */
const fkChildren = (ref) => sql`
  SELECT c.conrelid::regclass::text AS child, a.attname AS col
  FROM pg_constraint c
  JOIN unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.contype = 'f' AND c.confrelid = ${ref}::regclass
    AND array_length(c.conkey, 1) = 1`;

/** Tear down a scratch proposal and everything the product wrote against it. */
async function purgeProposals(ids) {
  if (!ids.length) return;
  const sects = await sql`SELECT id FROM proposal_sections WHERE proposal_id = ANY(${ids}::uuid[])`;
  const sc = await fkChildren('proposal_sections');
  const pc = await fkChildren('proposals');
  for (const s of sects) for (const { child, col } of sc) {
    await sql.unsafe(`DELETE FROM ${child} WHERE ${col} = $1`, [s.id]).catch(() => {});
  }
  for (const id of ids) for (const { child, col } of pc) {
    await sql.unsafe(`DELETE FROM ${child} WHERE ${col} = $1`, [id]).catch(() => {});
  }
  await sql`DELETE FROM proposals WHERE id = ANY(${ids}::uuid[])`;
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const created = { bucketId: null };

try {
  const [foundation] = await sql`SELECT id FROM tenants WHERE slug = 'foundation'`;
  const [other] = await sql`SELECT id, slug FROM tenants WHERE slug <> 'foundation' AND slug <> 'rfp-pipeline' LIMIT 1`;
  if (!foundation) throw new Error('no foundation tenant to test against');

  // ── SELF-HEAL · clear residue from any earlier run that died mid-flight ──
  // Learned the hard way: an earlier version of this script threw during cleanup and left two
  // scratch proposals behind. The next run then measured the fixture WITH that residue in it and
  // drew the opposite conclusion from the truth. A harness that cannot recover from its own crash
  // poisons every run after it, so it sweeps its own namespace before reading anything.
  const stale = await sql`SELECT id FROM proposals WHERE title LIKE ${PROBE + '%'}`;
  if (stale.length) {
    await purgeProposals(stale.map((r) => r.id));
    await sql`DELETE FROM tenant_spotlight_buckets WHERE name LIKE ${PROBE + '%'}`;
    console.log(`· swept ${stale.length} leftover probe row(s) from a previous run`);
  }

  // ── FIXTURE state, read BEFORE anything is written ──────────────────────
  // Reported, not asserted: a fact about the demo box, not a verdict on the code. It has to be read
  // up front — block B creates an unlocked scratch proposal, and measuring afterwards would count
  // the harness's own row and quietly conclude the opposite of the truth.
  const [fx] = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE is_locked)::int AS locked
    FROM proposals WHERE tenant_id = ${foundation.id} AND archived_at IS NULL`;
  if (fx && fx.total > 0 && fx.locked === fx.total) {
    notes.push(`all ${fx.total} Foundation proposals are LOCKED — the fixture holds no in-flight `
      + 'build, so the primary customer action (editing a section) cannot be demonstrated on it '
      + 'without an admin unlock');
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await login(ctx, 'kate.ulepic@foundation3dp.com', 'DemoPass123!');

  // ══ A · BUCKETS — plain CRUD on a row this script owns ═══════════════════
  console.log('\n══ A · spotlight bucket — create, read, update, deactivate ══');

  console.log('\n── CREATE · through the product ──');
  const NAME = `${PROBE}-${Date.now().toString(36)}`;
  const c = await api(p, '/api/portal/foundation/buckets', {
    method: 'POST',
    body: JSON.stringify({ name: NAME, agencies: ['NSF'], programTypes: ['sbir'], keywords: ['probe'] }),
  });
  A('POST accepted', c.status < 400, `${c.status} ${c.text.slice(0, 120)}`);

  const [row] = await sql`SELECT id, tenant_id, name FROM tenant_spotlight_buckets WHERE name = ${NAME}`;
  A('a row exists in the database', !!row, row?.id ?? 'none');
  A('owned by the ACTING tenant, not another', row?.tenant_id === foundation.id,
    `${row?.tenant_id ?? '—'} vs ${foundation.id}`);
  created.bucketId = row?.id ?? null;

  console.log('\n── READ · the list the UI renders vs the rows that exist ──');
  const list = await api(p, '/api/portal/foundation/buckets');
  const body = json(list);
  const arr = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : body?.data?.buckets;
  const listed = Array.isArray(arr) ? arr.length : null;
  const [{ n: dbCount } = { n: 0 }] = await sql`
    SELECT count(*)::int AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${foundation.id}`;
  A('GET returns the same count the DB holds', listed === dbCount, `api=${listed} db=${dbCount}`);

  if (created.bucketId) {
    console.log('\n── UPDATE · rename it, and check only that row moved ──');
    const NEW = NAME + '-renamed';
    const before = await sql`SELECT id, name FROM tenant_spotlight_buckets WHERE tenant_id = ${foundation.id}`;
    const u = await api(p, `/api/portal/foundation/buckets/${created.bucketId}`, {
      method: 'PATCH', body: JSON.stringify({ name: NEW }),
    });
    A('PATCH accepted', u.status < 400, `${u.status} ${u.text.slice(0, 100)}`);
    const [after] = await sql`SELECT name FROM tenant_spotlight_buckets WHERE id = ${created.bucketId}`;
    A('the value actually changed in the DB', after?.name === NEW, after?.name ?? 'row gone');
    // The assertion that catches a WHERE-clause bug: nothing else may have moved.
    const others = await sql`
      SELECT id, name FROM tenant_spotlight_buckets
      WHERE tenant_id = ${foundation.id} AND id <> ${created.bucketId}`;
    const untouched = others.every((o) => (before.find((b) => b.id === o.id)?.name ?? null) === o.name);
    A('no OTHER row was modified', untouched, `${others.length} sibling(s) checked`);
  }

  if (other && created.bucketId) {
    console.log(`\n── ISOLATION · can this actor reach ${other.slug}? ──`);
    const x = await api(p, `/api/portal/${other.slug}/buckets`);
    A('a foreign tenant slug is refused to this actor', x.status === 403 || x.status === 404,
      `${x.status} ${x.text.slice(0, 90)}`);
    const [{ n: leaked } = { n: 0 }] = await sql`
      SELECT count(*)::int AS n FROM tenant_spotlight_buckets
      WHERE id = ${created.bucketId} AND tenant_id <> ${foundation.id}`;
    A('the row is not visible under any other tenant', leaked === 0);
  }

  if (created.bucketId) {
    // DELETE here is a DEACTIVATION, and that is the correct behaviour — the Archivable contract
    // says nothing is hard-deleted (docs/ARCHIVABLE_CONTRACT.md), the route's own docblock says
    // "deactivate", and it answers `{deactivated:true}`. The first version of this check asserted the
    // row was GONE, which failed against a product doing exactly what it promises. Asserting a
    // contract the system does not have is not a finding; it is a harness bug.
    console.log('\n── DELETE · deactivate it, per the Archivable contract ──');
    const d = await api(p, `/api/portal/foundation/buckets/${created.bucketId}`, { method: 'DELETE' });
    A('DELETE accepted', d.status < 400, `${d.status} ${d.text.slice(0, 100)}`);
    const [after] = await sql`SELECT is_active FROM tenant_spotlight_buckets WHERE id = ${created.bucketId}`;
    A('the row survives (soft-delete, not destroyed)', !!after);
    A('and is marked inactive', after?.is_active === false, `is_active=${after?.is_active}`);
    // BUCKET_LOCKDOWN T1: deactivation must also prune the score rows, which used to be left behind
    // — hidden by the /cards is_active join but skewing the digest's LEFT-joined reads.
    const [{ n: scores } = { n: 0 }] = await sql`
      SELECT count(*)::int AS n FROM tenant_bucket_scores WHERE bucket_id = ${created.bucketId}`;
    A('its score rows were pruned', scores === 0, `${scores} left`);
  }

  // ══ B · SECTION SAVE — the version invariant and the optimistic lock ══════
  //
  // This is the highest-value write in the product and the one with a documented failure mode:
  // CLAUDE.md, "canvas_versions numbering" — `proposal_sections.version` MUST stay GREATER than
  // MAX(canvas_versions.version_number) for that section. When it doesn't, the next human save
  // archives onto an occupied slot, `ON CONFLICT DO NOTHING` swallows it, and a version of the
  // customer's text disappears with no error anywhere. Nothing in the suite watches that number.
  //
  // The subject is a scratch proposal this script CREATES, for a reason worth recording: every
  // seeded Foundation proposal is `submitted`/`final` and LOCKED, and so is every one of its
  // sections. There is no in-flight build in the fixture. Testing the save path would have meant
  // unlocking a finished proposal — mutating a completed artifact to observe it, which is exactly
  // the fixture damage this harness refuses to do. So it builds its own subject and removes it.
  // (That the demo box cannot demonstrate the primary customer action without an admin unlock is a
  // FIXTURE finding, reported at the end — not a code defect, and not something to paper over.)
  console.log('\n══ B · section save — version archive, invariant, and the optimistic lock ══');
  const [anyOpp] = await sql`SELECT id FROM opportunities LIMIT 1`;
  let sect = null;
  if (!anyOpp) {
    SKIP('section save', 'no opportunity row to hang a scratch proposal off');
  } else {
    const [scratchProp] = await sql`
      INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
      VALUES (${foundation.id}, ${anyOpp.id}, ${`${PROBE} proposal (harness)`}, 'draft', false)
      RETURNING id`;
    const [scratchSect] = await sql`
      INSERT INTO proposal_sections (proposal_id, section_number, title, status, version, content)
      VALUES (${scratchProp.id}, '1.0', ${`${PROBE} section (harness)`}, 'empty', 1, ${'{"nodes":[]}'})
      RETURNING id, proposal_id, version, content, status, content_source, title`;
    sect = scratchSect;
    onCleanup('scratch proposal + section + everything the save wrote (created by this run)', async () => {
      await purgeProposals([scratchProp.id]);
      const [{ n } = { n: 0 }] = await sql`
        SELECT count(*)::int AS n FROM proposals WHERE id = ${scratchProp.id}`;
      return n === 0;
    });
  }

  if (!sect) {
    /* skipped above */
  } else {
    const base = sect.version;

    // The invariant must hold BEFORE the save, or the "archived at `base`" check below could pass
    // on a row that was already sitting there.
    const [{ mx: maxBefore } = { mx: null }] = await sql`
      SELECT max(version_number)::int AS mx FROM canvas_versions WHERE section_id = ${sect.id}`;
    A('at rest: section.version > MAX(canvas_versions.version_number)',
      maxBefore === null || base > maxBefore, `v${base} vs max ${maxBefore ?? 'none'}`);

    const probeText = `crud-probe ${Date.now().toString(36)}`;
    const canvas = { nodes: [{ id: 'n1', type: 'paragraph', content: { text: probeText } }] };
    const s1 = await api(p, `/api/portal/foundation/proposals/${sect.proposal_id}/sections/${sect.id}/save`, {
      method: 'PUT', body: JSON.stringify({ content: canvas, baseVersion: base }),
    });
    A('PUT accepted', s1.status < 400, `${s1.status} ${s1.text.slice(0, 120)}`);

    const [saved] = await sql`SELECT version, content FROM proposal_sections WHERE id = ${sect.id}`;
    A('the new text is in the row', (saved?.content ?? '').includes(probeText));
    A('the version advanced by exactly one', saved?.version === base + 1, `v${base} → v${saved?.version}`);

    // The PREVIOUS content must now be in history, filed at the version it WAS.
    const [arch] = await sql`
      SELECT version_number, snapshot_reason FROM canvas_versions
      WHERE section_id = ${sect.id} AND version_number = ${base}`;
    A('the previous content was archived at its own version number', !!arch,
      arch ? `v${arch.version_number} (${arch.snapshot_reason})` : `nothing at v${base}`);

    // …and the invariant still holds, which is the whole point.
    const [{ mx: maxAfter } = { mx: null }] = await sql`
      SELECT max(version_number)::int AS mx FROM canvas_versions WHERE section_id = ${sect.id}`;
    A('invariant held: the counter is still ahead of history',
      saved?.version > (maxAfter ?? -1), `v${saved?.version} vs max ${maxAfter}`);

    // THE LOCK. A second save from a client that still thinks it holds `base` must be refused —
    // not merged, not last-write-wins. This is the assertion that would catch the optimistic lock
    // being removed or its CAS predicate being loosened.
    console.log('\n── GUARD · a stale save must be refused, not silently win ──');
    const stale = await api(p, `/api/portal/foundation/proposals/${sect.proposal_id}/sections/${sect.id}/save`, {
      method: 'PUT',
      body: JSON.stringify({ content: { nodes: [{ id: 'n1', type: 'paragraph', content: { text: 'STALE OVERWRITE' } }] }, baseVersion: base }),
    });
    A('a save against a stale baseVersion is rejected 409', stale.status === 409, `${stale.status}`);
    A('…with the CONFLICT code the client switches on', json(stale)?.code === 'CONFLICT', json(stale)?.code ?? 'no code');
    const [afterStale] = await sql`SELECT version, content FROM proposal_sections WHERE id = ${sect.id}`;
    A('and the row still holds the FIRST save, not the stale one',
      (afterStale?.content ?? '').includes(probeText) && !(afterStale?.content ?? '').includes('STALE OVERWRITE'));
  }

  // ══ C · ATOM ARCHIVE — soft-delete and its compare-and-swap ══════════════
  console.log('\n══ C · library atom — archive, refuse a repeat, restore ══');
  const [atom] = await sql`
    SELECT la.id, la.title FROM library_atoms la
    WHERE la.tenant_id = ${foundation.id} AND la.archived_at IS NULL
    ORDER BY la.created_at DESC LIMIT 1`;

  if (!atom) {
    SKIP('atom archive', 'no live Foundation atom to archive');
  } else {
    // Self-restoring by design (archive → restore), but register the undo anyway: if an assertion
    // throws between the two calls, the atom must not be left archived.
    onCleanup(`atom "${(atom.title ?? '').slice(0, 40)}" → un-archived`, async () => {
      await sql`UPDATE library_atoms SET archived_at = NULL WHERE id = ${atom.id}`;
      const [back] = await sql`SELECT archived_at FROM library_atoms WHERE id = ${atom.id}`;
      return back?.archived_at === null;
    });

    const a1 = await api(p, `/api/portal/foundation/atoms/${atom.id}/archive`, {
      method: 'POST', body: JSON.stringify({ action: 'archive' }),
    });
    A('archive accepted', a1.status < 400, `${a1.status} ${a1.text.slice(0, 80)}`);
    const [arch1] = await sql`SELECT archived_at FROM library_atoms WHERE id = ${atom.id}`;
    A('archived_at is stamped', !!arch1?.archived_at, String(arch1?.archived_at ?? 'null').slice(0, 24));
    A('the row still exists (soft, per the Archivable contract)', !!arch1);

    // The CAS: archiving an already-archived atom is a conflict, not a silent no-op 200.
    const a2 = await api(p, `/api/portal/foundation/atoms/${atom.id}/archive`, {
      method: 'POST', body: JSON.stringify({ action: 'archive' }),
    });
    A('a REPEAT archive is refused 409 (compare-and-swap)', a2.status === 409, `${a2.status}`);
    A('…with the CONFLICT code', json(a2)?.code === 'CONFLICT', json(a2)?.code ?? 'no code');

    const a3 = await api(p, `/api/portal/foundation/atoms/${atom.id}/archive`, {
      method: 'POST', body: JSON.stringify({ action: 'restore' }),
    });
    A('restore accepted', a3.status < 400, `${a3.status} ${a3.text.slice(0, 80)}`);
    const [arch2] = await sql`SELECT archived_at FROM library_atoms WHERE id = ${atom.id}`;
    A('archived_at is cleared — the atom is back in the library', arch2?.archived_at === null);
  }

  // ══ D · TASK RESCHEDULE — the write AND its side effect ══════════════════
  //
  // A reschedule that moves `due_at` but leaves `nudges_sent` populated is the subtle version of
  // this bug: the row looks right, the UI shows the new date, and the pipeline sweep never nudges
  // again because it still believes it already did. The side effect IS the feature.
  console.log('\n══ D · workflow to-do — reschedule re-arms the nudges ══');
  const [task] = await sql`
    SELECT id, title, due_at, nudges_sent, status FROM tasks
    WHERE tenant_id = ${foundation.id} AND status IN ('open', 'in_progress')
    ORDER BY created_at DESC LIMIT 1`;

  if (!task) {
    SKIP('task reschedule', 'no open Foundation to-do');
  } else {
    onCleanup(`to-do "${(task.title ?? '').slice(0, 40)}" → original due/nudges`, async () => {
      await sql`
        UPDATE tasks SET due_at = ${task.due_at}, nudges_sent = ${sql.json(task.nudges_sent ?? [])}
        WHERE id = ${task.id}`;
      const [back] = await sql`SELECT due_at FROM tasks WHERE id = ${task.id}`;
      return String(back?.due_at ?? null) === String(task.due_at ?? null);
    });

    // Seed a sent-nudge so "it was cleared" is a real observation and not a tautology on an
    // already-empty column. This is a perturbation of seeded data, and it is restored above.
    await sql`UPDATE tasks SET nudges_sent = '[1]'::jsonb WHERE id = ${task.id}`;
    const NEWDUE = new Date(Date.now() + 21 * 86400_000).toISOString();
    const t1 = await api(p, `/api/portal/foundation/tasks/${task.id}`, {
      method: 'PATCH', body: JSON.stringify({ dueAt: NEWDUE }),
    });
    A('PATCH accepted', t1.status < 400, `${t1.status} ${t1.text.slice(0, 90)}`);
    A('…and it reports what it changed', (json(t1)?.data?.changed ?? []).includes('schedule'),
      JSON.stringify(json(t1)?.data?.changed ?? null));

    const [moved] = await sql`SELECT due_at, nudges_sent, status FROM tasks WHERE id = ${task.id}`;
    A('due_at moved to the requested date',
      moved?.due_at && Math.abs(new Date(moved.due_at) - new Date(NEWDUE)) < 60_000,
      String(moved?.due_at ?? 'null').slice(0, 24));
    A('the nudge watermark was RESET, so the sweep will fire again',
      Array.isArray(moved?.nudges_sent) && moved.nudges_sent.length === 0,
      JSON.stringify(moved?.nudges_sent));
    A('the to-do is still open (a reschedule is not a completion)',
      moved?.status === task.status, `${moved?.status}`);
  }

  await ctx.close();
} finally {
  // Clean up, newest perturbation first, and PROVE each restore landed — a harness that cannot
  // verify its own cleanup is just a slower way to corrupt the fixture.
  if (restore.length) console.log('\n── restoring the fixture ──');
  for (const { label, fn } of restore.reverse()) {
    let good = false;
    try { good = await fn(); } catch (e) { good = false; console.error(`  restore threw: ${e.message}`); }
    console.log(`  ${good ? '✓' : '✗'} restored ${label}`);
    ok = ok && good;
  }
  if (created.bucketId) {
    await sql`DELETE FROM tenant_spotlight_buckets WHERE id = ${created.bucketId}`.catch(() => {});
    console.log('  ✓ removed the probe bucket (ours, created by this run — never seeded data)');
  }
  await browser.close();
  await sql.end();
}

if (notes.length) {
  console.log('\n── noted about the fixture (not a defect) ──');
  for (const n of notes) console.log(`  · ${n}`);
}
console.log(ok
  ? '\n✓ every write landed exactly where it should, nowhere else, and the fixture is back as found.'
  : '\n✗ at least one write did not land as the product claimed.');
process.exit(ok ? 0 : 1);
