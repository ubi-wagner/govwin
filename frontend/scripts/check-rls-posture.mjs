/**
 * PREFLIGHT: is this box actually enforcing RLS, or only appearing to?
 *
 * THE FAILURE THIS EXISTS FOR (bug log B86). Every drive, lens and sweep in one long session ran
 * against a server started as `govtech` — which is `rolsuper = t`. A superuser bypasses row-level
 * security entirely, so the database layer was never engaged, and every isolation result produced
 * that day was an APP-LAYER result reported as though it were the whole story.
 *
 * Nothing failed. That is precisely the danger: **RLS bypassed looks identical to RLS satisfied**
 * from every angle except a cross-tenant read that should return nothing and doesn't. There is no
 * error, no warning, no slow query — just a quieter guarantee than the one you believe you have.
 *
 * It happened because `govtech_app` is created NOLOGIN by migration (094/177) and prod supplies its
 * password by env, so on a fresh box the only credential to hand a script is the owner's. The wrong
 * posture is the path of least resistance, which is exactly the kind of thing that needs a check
 * rather than a paragraph in a runbook.
 *
 * WHAT IT ASSERTS, in the order that matters:
 *
 *   1. ROLE — the connection is neither a superuser nor BYPASSRLS. Superuser is the one people miss:
 *      `rolbypassrls` can read `f` on a superuser and RLS is still bypassed.
 *   2. MACHINERY — policies exist and tables actually FORCE row security. A NOBYPASSRLS role against
 *      a table with no policy is unprotected in a different way.
 *   3. BEHAVIOUR — the only assertion that cannot be faked: set one tenant's context, count another
 *      tenant's rows, and require zero. Then count the SAME tenant's own rows and require non-zero,
 *      because a connection that sees nothing at all would satisfy the first half trivially.
 *
 * Steps 1 and 2 can both pass on a box that leaks; step 3 is the proof. Steps 1 and 2 stay because
 * when 3 fails they say WHY in one line instead of sending someone into the policies.
 *
 *   DATABASE_URL=<app role> node scripts/check-rls-posture.mjs
 *   DATABASE_URL_OWNER=<owner> is optional; used only to read the fixture for step 3.
 *
 * Exit 0 posture correct · 1 posture WRONG (results would be meaningless) · 2 could not check.
 */
import postgres from 'postgres';

const APP = process.env.DATABASE_URL;
const OWNER = process.env.DATABASE_URL_OWNER || APP;
if (!APP) { console.error('DATABASE_URL required'); process.exit(2); }

const app = postgres(APP, { max: 1 });
const owner = postgres(OWNER, { max: 1 });

/**
 * Tables that are readable across tenants ON PURPOSE, each with the reason.
 *
 * This is an allowlist, which is a thing to be suspicious of: an allowlist is how a real leak gets
 * quietly permanent. Two rules keep it honest. Every entry states WHY, so the claim can be argued
 * with rather than inherited. And entries are REPORTED on every run, not skipped — an exemption you
 * can see is a decision, an exemption you cannot is a blind spot, which is the exact failure this
 * whole check exists to correct.
 *
 * Adding a name here must be a deliberate architectural call. The default for a table holding
 * tenant data is a policy, not a line in this object.
 */
const GLOBAL_BY_DESIGN = {
  users: 'identity is global — auth resolves a user before any tenant context exists',
  user_memberships: 'membership is how a tenant context is chosen; it cannot itself be tenant-scoped',
  system_events: 'the cross-service event bus (frontend · pipeline · rfp-crm bridge to cms-postgres)',
  tool_invocation_metrics: 'platform telemetry, not tenant business data',
  tenant_bridge_cursor: 'forward-only bridge watermark — engine state, written by the platform',
  volume_required_items: 'shared catalog descending from platform-scope solicitation_volumes',
};

let bad = 0;
let unmeasured = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m) => { console.error(`  WRONG ${m}`); bad++; };

/** Whether the CONNECTION is the problem, as opposed to a table missing a policy. The two failures
 *  have opposite remedies, so the closing advice must know which one it is looking at. */
let roleWrong = false;

async function main() {
  // ── 1 · the role ────────────────────────────────────────────────────────────────────────────
  const [me] = await app`
    SELECT current_user AS who, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (me.rolsuper || me.rolbypassrls) roleWrong = true;
  if (me.rolsuper) {
    no(`connected as '${me.who}', which is a SUPERUSER — RLS is bypassed entirely, whatever `
      + `rolbypassrls says. Nothing measured on this connection can distinguish isolation from `
      + `its absence.`);
  } else if (me.rolbypassrls) {
    no(`connected as '${me.who}', which has BYPASSRLS — same consequence as superuser.`);
  } else {
    ok(`connected as '${me.who}' — not superuser, not BYPASSRLS`);
  }

  // ── 2 · the machinery ───────────────────────────────────────────────────────────────────────
  const [{ policies }] = await owner`SELECT count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public'`;
  const [{ forced }] = await owner`SELECT count(*)::int AS forced FROM pg_class WHERE relforcerowsecurity`;
  if (policies === 0) no('no RLS policies exist in schema public — nothing to enforce');
  else ok(`${policies} policies across ${forced} force-RLS table(s)`);

  // ── 3 · the behaviour, which is the only part that cannot be faked ──────────────────────────
  //
  // Read the fixture through the OWNER: working out what a tenant SHOULD see is a legitimate
  // cross-tenant read, and doing it on the scoped connection would return nothing and look like
  // an empty box (that mistake is recorded in B86 too).
  // BOTH tenants must HAVE rows, and the reason is the pair of assertions below, which need
  // different things of each: A supplies rows that must be hidden, and B — the tenant whose context
  // is set — must own rows of its own, or "own === 0" is indistinguishable from a deny-all.
  //
  // This used to select the top two by card count and then guard on `pair[0].cards === 0` — the
  // count belonging to A, while the own-rows assertion is made against B. On a freshly migrated box
  // exactly one tenant has cards, so A passed the guard, B had none, and the check reported
  // "'<B>' cannot see its OWN cards either — that is a deny-all" against a database whose RLS was
  // perfectly correct. Verified by hand at the time: context=foundation saw its own 9,
  // context=immobileyes saw 0 of foundation's — both halves holding, while this said WRONG.
  //
  // It fails SAFE (a false alarm, not a false pass) and `run-branch-drives.sh` marks every isolation
  // drive CANT-RUN off it, so the cost is a suite that refuses to measure anything on a healthy box.
  const pair = await owner`
    SELECT t.id, t.slug,
           (SELECT count(*)::int FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) AS cards
    FROM tenants t
    WHERE (SELECT count(*) FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) > 0
    ORDER BY cards DESC LIMIT 2`;
  if (pair.length < 2) {
    // CANNOT-RUN, not WRONG. The distinction is the house rule: a check that did not run measured
    // nothing, and reporting that as a failure of the DATABASE sends the next reader hunting for a
    // policy bug that is not there. It still counts against the run — uncovered is not passing.
    console.error(`  CANT-RUN behaviour check needs TWO tenants that each own rows; this box has `
      + `${pair.length} (${pair.map((p) => `${p.slug}=${p.cards}`).join(', ') || 'none'})`);
    console.error('        The posture is UNMEASURED here — not wrong. Seed a second tenant to measure it.');
    bad++; unmeasured++;
  } else {
    const [A, B] = pair;
    const [seen] = await app`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${A.id}::uuid`
      .then(async (r) => { return r; }, () => [{ n: -1 }]);
    // set_config within the same session, then measure both directions
    const cross = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${B.id}, true)`;
      const [x] = await tx`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${A.id}::uuid`;
      const [own] = await tx`SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id = ${B.id}::uuid`;
      return { foreign: x.n, own: own.n };
    });
    void seen;
    if (cross.foreign !== 0) {
      no(`with app.tenant_id set to '${B.slug}', ${cross.foreign} of '${A.slug}'s cards are still `
        + `visible — the isolation this box reports is not real`);
    } else if (cross.own === 0) {
      no(`'${B.slug}' cannot see its OWN cards either (0) — that is a deny-all, not isolation, and `
        + `a run against it would pass every "no leak" check for the wrong reason`);
    } else {
      ok(`context '${B.slug}': ${cross.foreign} foreign card(s) visible, ${cross.own} own — isolation, not deny-all`);
    }
  }

  // ── 4 · COVERAGE ────────────────────────────────────────────────────────────────────────────
  //
  // Step 3 proves isolation on ONE table. That is a fact about `tenant_opportunity_cards`, and for
  // a long time this file reported it as the posture of the DATABASE. It is not, and the gap was
  // not theoretical: seven tables in the proposal spine (canvas_versions, proposal_artifacts,
  // proposal_compliance_matrix, proposal_collaborators, proposal_comments, proposal_stage_history,
  // collaborator_stage_access) carried no policy at all and leaked 100% of their rows to any
  // tenant context, while this check printed "posture correct" (mig 212).
  //
  // It was missed because every audit here — including step 2 above — looks for a `tenant_id`
  // COLUMN, and not one of those seven has one. Their tenancy is FK lineage up to
  // `proposals.tenant_id`. A tenant_id-shaped instrument cannot see a lineage-shaped table.
  //
  // So the table set below is computed as a transitive FK closure over anything that reaches a
  // tenant_id-bearing table, with `users` excluded as a hop: nearly everything FKs to `users`
  // (created_by, user_id), and admitting that edge would drag every platform-scope table —
  // curation, solicitations, scouts — into a tenant-owned set they do not belong to.
  //
  // THE ASSERTION IS A PARTITION, which is what makes it generic. Every row of a tenant-owned
  // table belongs to exactly one tenant, so summing what each tenant's context can see must equal
  // the owner's total. That single equality catches both directions at once:
  //     sum >  total → a row is visible to more than one tenant   (a LEAK)
  //     sum <  total → a row is visible to nobody                 (a DENY-ALL, or an orphan)
  // No per-table lineage join to hand-write, and no table can be quietly left out.
  const tenantOwned = await owner`
    WITH RECURSIVE seed AS (
      SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
    ),
    closure AS (
      SELECT oid, relname FROM seed
      UNION
      SELECT child.oid, child.relname
      FROM pg_constraint fk
      JOIN pg_class child  ON child.oid  = fk.conrelid
      JOIN pg_class parent ON parent.oid = fk.confrelid
      JOIN closure cl      ON cl.oid     = parent.oid
      JOIN pg_namespace n  ON n.oid      = child.relnamespace
      WHERE fk.contype = 'f' AND n.nspname = 'public'
        AND parent.relname <> 'users'   -- identity is global; not a tenancy edge
    )
    SELECT DISTINCT relname FROM closure ORDER BY relname`;

  // ── 4a · STRUCTURE, before behaviour ────────────────────────────────────────────────────────
  //
  // A tenant-owned table with no policy at all is a gap by construction, and this is the assertion
  // that actually catches the class. The behavioural check below cannot: a table where EVERY row
  // leaks to EVERY tenant is indistinguishable, by row counts alone, from a shared catalog that is
  // SUPPOSED to be visible to everyone. `canvas_versions` with no policy and `volume_required_items`
  // as designed produce the same numbers. Counting cannot separate them; the catalog can.
  //
  // It also needs no fixture data, so it holds on a freshly migrated box where every table is
  // empty — which is exactly when a missing policy is easiest to introduce and hardest to see.
  const unprotected = [];
  for (const { relname } of tenantOwned) {
    const [{ n: policyCount }] = await owner`
      SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = ${relname}`;
    const [{ on: rlsOn }] = await owner`
      SELECT c.relrowsecurity AS on FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${relname}`;
    if (!rlsOn || policyCount === 0) {
      if (!GLOBAL_BY_DESIGN[relname]) unprotected.push(`${relname} (rls ${rlsOn ? 'on' : 'OFF'}, ${policyCount} policies)`);
    }
  }
  if (unprotected.length) {
    no(`${unprotected.length} tenant-owned table(s) have NO policy protecting them — every tenant `
      + `context can read every tenant's rows:\n`
      + unprotected.map((u) => `          · ${u}`).join('\n'));
  } else {
    ok(`structure: every tenant-owned table carries a policy (or a stated GLOBAL_BY_DESIGN reason)`);
  }

  const tenants = await owner`SELECT id, slug FROM tenants ORDER BY slug`;
  if (tenants.length === 0) {
    console.error('  CANT-RUN coverage needs at least one tenant; this box has none.');
    bad++; unmeasured++;
  } else {
    const leaks = [];
    const denies = [];
    const exempt = [];
    let covered = 0;
    let empty = 0;

    for (const { relname } of tenantOwned) {
      let total;
      let owned;
      let shared;
      try {
        [{ n: total }] = await owner`SELECT count(*)::int AS n FROM ${owner(relname)}`;
        if (total === 0) { empty++; continue; }  // UNMEASURED, not passing — an empty table proves nothing

        // SHARED ROWS ARE NOT A LEAK, and getting this wrong is how a check like this becomes
        // noise nobody reads. Several tables deliberately hold rows every tenant may see: the
        // global system-template catalog (tenant_id IS NULL, mig 136/184) and the platform-scope
        // tasks and process_instances the automation engine writes during tenant requests. Such a
        // row is SUPPOSED to appear in all N contexts, so the total is the wrong yardstick.
        //
        //     expected = owned rows (seen once, by their tenant)
        //              + shared rows × N contexts (seen by everyone, correctly)
        //
        // A table with no tenant_id column has no shared concept: its rows are tenant-owned by
        // lineage, so every one must be visible exactly once.
        const [{ n: hasCol }] = await owner`
          SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${relname} AND column_name = 'tenant_id'`;
        if (hasCol) {
          [{ n: owned }] = await owner`SELECT count(*)::int AS n FROM ${owner(relname)} WHERE tenant_id IS NOT NULL`;
          [{ n: shared }] = await owner`SELECT count(*)::int AS n FROM ${owner(relname)} WHERE tenant_id IS NULL`;
        } else {
          // NO tenant_id COLUMN — so "how many rows are shared" cannot be read off this table at
          // all, and assuming zero is wrong. `process_instance_transitions` is the case that
          // proves it: its parent `process_instances` deliberately shares platform-scope rows
          // (tenant_id IS NULL) with every tenant, so 36 of its 300 rows are CORRECTLY visible
          // five times over, and a shared count of 0 reports a working policy as a leak.
          //
          // Rather than teach this check each table's lineage — which is the coupling that made
          // the original blind spot — derive it from the measurement itself. A row is shared when
          // it is visible in EVERY context; it is owned when visible in exactly one. Anything in
          // between belongs to some tenants and not others, which no correct policy produces.
          // That rule needs no column and no FK knowledge, so it holds for any table added later.
          shared = null;   // signals the visibility-count rule below
          owned = total;
        }
      } catch { continue; }              // not readable as a plain relation; nothing to assert

      let sum = 0;
      let partial = 0;      // rows visible to SOME tenants but not all — never correct
      try {
        const seen = await app.begin(async (tx) => {
          let acc = 0;
          // Count how many contexts each row id is visible in. Only needed for the no-tenant_id
          // case; capped, because this pulls ids rather than a count and a huge table would turn
          // a preflight into a scan.
          const counts = shared === null && total <= 20000 ? new Map() : null;
          for (const t of tenants) {
            await tx`SELECT set_config('app.tenant_id', ${t.id}, true)`;
            if (counts) {
              const ids = await tx`SELECT id FROM ${tx(relname)}`;
              for (const { id } of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
              acc += ids.length;
            } else {
              const [{ n }] = await tx`SELECT count(*)::int AS n FROM ${tx(relname)}`;
              acc += n;
            }
          }
          return { acc, counts };
        });
        sum = seen.acc;
        if (seen.counts) {
          for (const k of seen.counts.values()) {
            if (k > 1 && k < tenants.length) partial++;
          }
        } else if (shared === null) {
          // Too big to measure per row, and no column to read shared off — say so rather than
          // assert something this run did not establish.
          empty++; continue;
        }
      } catch { continue; }
      covered++;

      const expected = shared === null ? sum : owned + shared * tenants.length;
      const detail = shared === null
        ? `${relname} (${total} row(s), ${partial} visible to SOME tenants but not all)`
        : `${relname} (${owned} owned + ${shared} shared → expect ${expected}, saw ${sum})`;
      if (partial > 0) {
        leaks.push(detail);
      } else if (sum > expected) {
        // A table that is global BY DESIGN still shows up here; it is listed with its reason
        // rather than silently skipped, so the exemption is visible and a NEW name in this
        // position is a finding rather than another line in an allowlist nobody rereads.
        if (GLOBAL_BY_DESIGN[relname]) exempt.push(`${relname} — ${GLOBAL_BY_DESIGN[relname]}`);
        else leaks.push(detail);
      } else if (sum === 0) {
        denies.push(`${relname} (${total} row(s), visible to no tenant at all)`);
      }
    }

    if (leaks.length) {
      no(`${leaks.length} tenant-owned table(s) are visible across tenant boundaries:\n`
        + leaks.map((l) => `          · ${l}`).join('\n'));
    } else {
      ok(`coverage: ${covered} tenant-owned table(s) partition cleanly across ${tenants.length} tenant `
        + `context(s)${empty ? ` · ${empty} empty (unmeasured, not passing)` : ''}`);
    }
    if (exempt.length) {
      console.log(`  note  ${exempt.length} table(s) are cross-tenant readable BY DESIGN:`);
      for (const e of exempt) console.log(`          · ${e}`);
    }
    // A deny-all is not a leak, so it does not fail the posture — but it silently turns every
    // "no foreign rows" result on that table into a pass for the wrong reason, so it is reported.
    if (denies.length) {
      console.error(`  note  ${denies.length} table(s) hold rows no tenant context can see — `
        + `platform-scope rows, orphans, or an over-strict policy:`);
      for (const d of denies) console.error(`          · ${d}`);
    }
  }

  console.log();
  if (bad === 0) {
    console.log('✓ RLS posture correct — isolation results from this box mean what they say.');
  } else if (bad === unmeasured) {
    // Everything that RAN passed; what stopped this being a pass is an assertion that could not be
    // made. Saying "WRONG" here would send the next reader looking for a policy bug that is not
    // there — the same unearned-verdict failure the rest of this file exists to prevent.
    console.error('✗ RLS POSTURE UNMEASURED. Every check that could run PASSED — the role is right,');
    console.error('  the policies are in place — but the one assertion that cannot be faked did not');
    console.error('  run for want of fixture data. Isolation results from this box are UNCOVERED,');
    console.error('  not wrong. Seed a second tenant that owns rows, then re-run.');
  } else if (roleWrong) {
    console.error('✗ RLS POSTURE WRONG. Any isolation result measured here is meaningless — not');
    console.error('  wrong, MEANINGLESS: a bypassed database layer produces the same output as a');
    console.error('  perfectly isolated one. Serve as the NOBYPASSRLS app role and re-run.');
    console.error('    ALTER ROLE govtech_app LOGIN PASSWORD \'…\';   -- created NOLOGIN by migration');
    console.error('    DATABASE_URL=postgresql://govtech_app:…  DATABASE_URL_OWNER=postgresql://govtech:…');
  } else {
    // A COVERAGE failure, not a role failure — and the remedy is the opposite one. Printing the
    // "serve as the app role" advice here would send someone to fix a connection string that is
    // already correct, while the actual finding is a table with no policy on it.
    console.error('✗ RLS COVERAGE GAP. The role is right and the machinery is in place — the leak is');
    console.error('  that a table holding tenant data has no policy protecting it, so every tenant');
    console.error('  context can read every tenant\'s rows. Give each table listed above a');
    console.error('  tenant_isolation policy (see db/migrations/212_rls_proposal_spine.sql for the');
    console.error('  pattern: FOR ALL, EXISTS up the FK chain to the owning tenant), or — if it is');
    console.error('  genuinely global — add it to GLOBAL_BY_DESIGN at the top of this file WITH the');
    console.error('  reason, so the exemption is a decision on the record rather than a silence.');
  }
  await app.end(); await owner.end();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`could not check RLS posture: ${String(e).slice(0, 200)}`);
  await app.end().catch(() => {}); await owner.end().catch(() => {});
  process.exit(2);
});
