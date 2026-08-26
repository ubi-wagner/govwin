/**
 * Does the outbound-mail ledger actually isolate, or only appear to?
 *
 * Migration 215 makes two claims that are easy to write and easy to get wrong, and both fail
 * SILENTLY when wrong — a leak returns rows instead of an error, and an over-strict policy returns
 * nothing instead of an error:
 *
 *   1. `email_sends` is READ-ONLY on the application role, scoped to the caller's own tenant, with
 *      platform rows (tenant_id IS NULL) invisible from every tenant context. The strict shape,
 *      following `episodic_memories` (mig 186) rather than `tasks` (mig 185) — a platform
 *      notification's recipient list is not a tenant's business.
 *   2. `email_suppressions` is denied ENTIRELY on the application role: RLS enabled with no policy.
 *      The full list is every address that has bounced anywhere on the platform, which is a
 *      contact-list leak wearing a deliverability hat.
 *
 * WHY THIS IS A SCRIPT AND NOT A VITEST FILE. `vitest.config.ts` hands every test a dummy
 * `DATABASE_URL` so unit tests survive CI without a database. A test asserting RLS behaviour under
 * that dummy would connect to nothing, skip, and report green — the precise shape of an unearned
 * pass. Behaviour against a live cluster belongs with the other `verify-*` lenses.
 *
 * THE INSTRUMENT BEFORE THE FINDING. Step 0 asserts the connection is not a superuser and not
 * BYPASSRLS. On a superuser, every assertion below passes for the wrong reason: reads succeed
 * because RLS is bypassed, and the two "denied" assertions would fail loudly rather than silently,
 * which at least surfaces — but the isolation half would report a clean pass on a database with no
 * policies at all. That check is first because nothing after it means anything without it.
 *
 * ⚠️ NOT READ-ONLY. It writes fixture rows through the OWNER connection and deletes them again;
 * the footprint is printed every run. Sandbox only.
 *
 *   source scripts/sandbox-env.sh && node frontend/scripts/verify-email-ledger-rls.mjs
 *
 * Exit 0 correct · 1 a claim does not hold · 2 could not measure.
 */
import postgres from 'postgres';

const APP = process.env.DATABASE_URL;
const OWNER = process.env.DATABASE_URL_OWNER;
if (!APP || !OWNER) {
  console.error('DATABASE_URL (app role) and DATABASE_URL_OWNER (owner) are both required.');
  console.error('  source scripts/sandbox-env.sh');
  process.exit(2);
}

const app = postgres(APP, { max: 1, onnotice: () => {} });
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });

let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { console.error(`  WRONG ${m}`); bad++; };

/** Fixture ids, tracked so the footprint can be printed and the rows removed. */
const written = { sends: [], suppressions: [] };

/** Did the statement raise? Returns the SQLSTATE, or null when it succeeded. */
async function refusedWith(fn) {
  try { await fn(); return null; } catch (e) { return e.code ?? 'THREW'; }
}

async function main() {
  // ── 0 · the instrument ──────────────────────────────────────────────────────────────────────
  const [me] = await app`
    SELECT current_user AS who, r.rolsuper AS super, r.rolbypassrls AS bypass
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (me.super || me.bypass) {
    console.error(`  ABORT connected as '${me.who}', which ${me.super ? 'is a SUPERUSER' : 'has BYPASSRLS'}.`);
    console.error('        RLS is bypassed entirely on this connection, so every clean result below');
    console.error('        would be unearned. Serve as the NOBYPASSRLS app role and re-run.');
    await app.end(); await owner.end();
    process.exit(2);
  }
  ok(`connected as '${me.who}' — not superuser, not BYPASSRLS`);

  // ── 1 · structure ───────────────────────────────────────────────────────────────────────────
  for (const [table, wantPolicies] of [['email_sends', 1], ['email_suppressions', 0]]) {
    const [t] = await owner`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table}`;
    if (!t) {
      no(`${table} does not exist — migration 215 has not been applied to this database`);
      continue;
    }
    const policies = await owner`
      SELECT policyname AS name, cmd FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ${table} ORDER BY policyname`;
    if (!t.rls || !t.forced) no(`${table}: rls ${t.rls ? 'on' : 'OFF'}, force ${t.forced ? 'on' : 'OFF'} — both must be on`);
    else if (policies.length !== wantPolicies) {
      no(`${table}: ${policies.length} policy(ies), expected ${wantPolicies}`
        + (policies.length ? ` — found ${policies.map((p) => `${p.name}/${p.cmd}`).join(', ')}` : ''));
    } else if (wantPolicies && policies[0].cmd !== 'SELECT') {
      no(`${table}: policy '${policies[0].name}' is FOR ${policies[0].cmd}; the ledger must be read-only `
        + `on the app role, so the only policy may be FOR SELECT`);
    } else {
      ok(`${table}: rls + force on, ${policies.length} policy(ies)`
        + (wantPolicies ? ` (${policies[0].name} FOR SELECT)` : ' — denied entirely, as designed'));
    }
  }
  if (bad) { await finish(); return; }

  // ── 2 · fixture ─────────────────────────────────────────────────────────────────────────────
  //
  // Two tenants, chosen by `created_at` and not by slug. A resolver must select for what its
  // consumer needs: `ORDER BY slug` picks whichever scenario tenant a fixture happened to name,
  // and an earlier drive in the same suite always wins that sort (B147).
  const tenants = await owner`SELECT id, slug FROM tenants ORDER BY created_at LIMIT 2`;
  if (tenants.length < 2) {
    console.error(`  CANT-RUN needs two tenants; this box has ${tenants.length}. The posture here is`);
    console.error('        UNMEASURED, not correct — a single-tenant box cannot demonstrate isolation.');
    await finish(); process.exit(1);
  }
  const [A, B] = tenants;
  const stamp = process.pid;

  for (const [label, tenantId] of [['a', A.id], ['b', B.id], ['platform', null]]) {
    const [row] = await owner`
      INSERT INTO email_sends (correlation_id, idempotency_key, tenant_id, provider, kind, status, to_email)
      VALUES (gen_random_uuid(), ${`rls-probe-${stamp}-${label}`}, ${tenantId}, 'probe',
              'transactional', 'pending', ${`probe-${label}@example.test`})
      RETURNING id`;
    written.sends.push(row.id);
  }
  const [sup] = await owner`
    INSERT INTO email_suppressions (email, reason, source)
    VALUES (${`rls-probe-${stamp}@example.test`}, 'hard_bounce', 'operator')
    RETURNING id`;
  written.suppressions.push(sup.id);

  // ── 3 · behaviour ───────────────────────────────────────────────────────────────────────────
  const seen = await app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
    const [own] = await tx`
      SELECT count(*)::int AS n FROM email_sends WHERE idempotency_key = ${`rls-probe-${stamp}-b`}`;
    const [foreign] = await tx`
      SELECT count(*)::int AS n FROM email_sends WHERE idempotency_key = ${`rls-probe-${stamp}-a`}`;
    const [platform] = await tx`
      SELECT count(*)::int AS n FROM email_sends WHERE idempotency_key = ${`rls-probe-${stamp}-platform`}`;
    const [suppressions] = await tx`SELECT count(*)::int AS n FROM email_suppressions`;
    return { own: own.n, foreign: foreign.n, platform: platform.n, suppressions: suppressions.n };
  });

  // Own rows FIRST. A connection that sees nothing at all satisfies every "no foreign rows"
  // assertion trivially, so the deny-all has to be excluded before the isolation result means
  // anything (the mistake recorded in B86, and in check-rls-posture's own step 3).
  if (seen.own !== 1) no(`tenant '${B.slug}' cannot see its OWN send row (saw ${seen.own}) — that is a `
    + `deny-all, not isolation, and every assertion below would pass for the wrong reason`);
  else ok(`tenant '${B.slug}' sees its own send row`);

  if (seen.foreign !== 0) no(`tenant '${B.slug}' can see ${seen.foreign} of '${A.slug}'s send row(s)`);
  else ok(`tenant '${B.slug}' sees 0 of '${A.slug}'s send rows`);

  if (seen.platform !== 0) no(`tenant '${B.slug}' can see the PLATFORM send row — the strict SELECT `
    + `policy has an OR-NULL arm it must not have (that is the tasks shape, mig 185; this table `
    + `follows episodic_memories, mig 186)`);
  else ok(`tenant '${B.slug}' sees 0 platform (tenant_id IS NULL) send rows`);

  const [{ n: allSuppressions }] = await owner`SELECT count(*)::int AS n FROM email_suppressions`;
  if (allSuppressions === 0) {
    no('the owner sees 0 suppression rows, so "the app role sees 0" proves nothing — the fixture insert failed');
  } else if (seen.suppressions !== 0) {
    no(`the app role can read ${seen.suppressions} of ${allSuppressions} suppression row(s) — the whole `
      + `platform's bounced-address list is visible from tenant space`);
  } else {
    ok(`app role reads 0 of the owner's ${allSuppressions} suppression row(s) — denied, as designed`);
  }

  // ── 4 · writes are refused ──────────────────────────────────────────────────────────────────
  //
  // 42501 is insufficient_privilege, which is what an RLS WITH CHECK failure raises. Asserting the
  // CODE rather than "it threw" matters: a typo in the table name also throws, and would otherwise
  // read as a passing security assertion.
  const insertCode = await refusedWith(() => app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
    await tx`
      INSERT INTO email_sends (correlation_id, idempotency_key, tenant_id, provider, kind, to_email)
      VALUES (gen_random_uuid(), ${`rls-probe-${stamp}-forbidden`}, ${B.id}, 'probe', 'transactional',
              'nope@example.test')`;
  }));
  if (insertCode !== '42501') {
    no(`an INSERT into email_sends from tenant context ${insertCode === null ? 'SUCCEEDED' : `raised ${insertCode}`}`
      + ' — expected 42501 (insufficient_privilege). The ledger must be read-only on the app role.');
    // It succeeded, so it left a row. Reclaim it or the next run trips the unique index.
    if (insertCode === null) await owner`DELETE FROM email_sends WHERE idempotency_key = ${`rls-probe-${stamp}-forbidden`}`;
  } else {
    ok('INSERT into email_sends from tenant context is refused (42501)');
  }

  const supInsertCode = await refusedWith(() => app.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
    await tx`INSERT INTO email_suppressions (email, reason, source)
             VALUES (${`forbidden-${stamp}@example.test`}, 'manual', 'operator')`;
  }));
  if (supInsertCode !== '42501') {
    no(`an INSERT into email_suppressions from tenant context ${supInsertCode === null ? 'SUCCEEDED' : `raised ${supInsertCode}`}`
      + ' — expected 42501.');
    if (supInsertCode === null) await owner`DELETE FROM email_suppressions WHERE email = ${`forbidden-${stamp}@example.test`}`;
  } else {
    ok('INSERT into email_suppressions from tenant context is refused (42501)');
  }

  // ── 5 · the two constraints that fail open when absent ──────────────────────────────────────
  //
  // Both of these protect against a silent wrong answer rather than an error, which is why they are
  // asserted here rather than trusted to the DDL: a missing unique index double-sends, and a
  // mixed-case suppression row never matches a normalised lookup, so the address gets mailed again.
  const dupCode = await refusedWith(() => owner`
    INSERT INTO email_sends (correlation_id, idempotency_key, tenant_id, provider, kind, to_email)
    VALUES (gen_random_uuid(), ${`rls-probe-${stamp}-b`}, ${B.id}, 'probe', 'transactional', 'dup@example.test')`);
  if (dupCode !== '23505') no(`a replayed idempotency_key ${dupCode === null ? 'INSERTED A SECOND ROW' : `raised ${dupCode}`}`
    + ' — expected 23505 (unique_violation). Without it a replayed event double-sends.');
  else ok('a replayed idempotency_key is refused (23505 unique_violation)');

  const caseCode = await refusedWith(() => owner`
    INSERT INTO email_suppressions (email, reason, source)
    VALUES (${`Mixed-Case-${stamp}@Example.test`}, 'hard_bounce', 'operator')`);
  if (caseCode !== '23514') {
    no(`a mixed-case suppression address ${caseCode === null ? 'WAS ACCEPTED' : `raised ${caseCode}`}`
      + ' — expected 23514 (check_violation). A mixed-case row never matches a normalised lookup, so'
      + ' the suppression fails open and the address is mailed again.');
    if (caseCode === null) await owner`DELETE FROM email_suppressions WHERE email = ${`Mixed-Case-${stamp}@Example.test`}`;
  } else {
    ok('a mixed-case suppression address is refused (23514 check_violation)');
  }

  await finish();
}

async function finish() {
  // The footprint, printed whether or not the run passed — a script that mutates and says nothing
  // about it is the reason the house rule exists.
  if (written.sends.length || written.suppressions.length) {
    console.log();
    console.log(`  MUTATED ${written.sends.length} email_sends row(s) + ${written.suppressions.length} `
      + 'email_suppressions row(s), all fixture-only, now removed.');
    if (written.sends.length) await owner`DELETE FROM email_sends WHERE id IN ${owner(written.sends)}`;
    if (written.suppressions.length) await owner`DELETE FROM email_suppressions WHERE id IN ${owner(written.suppressions)}`;
  }
  console.log();
  if (bad === 0) console.log('✓ Email ledger isolation holds: own rows visible, foreign and platform rows not, writes refused.');
  else console.error(`✗ ${bad} claim(s) in migration 215 do not hold on this database.`);
  await app.end(); await owner.end();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`could not measure: ${String(e?.message ?? e).slice(0, 300)}`);
  await owner.end().catch(() => {}); await app.end().catch(() => {});
  process.exit(2);
});
