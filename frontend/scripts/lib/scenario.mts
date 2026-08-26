/**
 * THE SCENARIO FACTORY — build the situation a drive needs, then take it away again.
 *
 * WHY THIS EXISTS. Half the branch-drive estate pins a fixture: a tenant slug, an account email, a
 * proposal uuid. That is correct exactly until the database is rebuilt, and then the drive fails on
 * a missing row and reports the FLOW broken. `docs/E2E_SWEEP_2026-08-23.md` §3 has the full account
 * of how bad that gets — a drive that could not authenticate printed "a DENY-ALL surfaced", which
 * is a security finding shaped exactly like a real one, produced by a script that never knocked.
 *
 * Re-seeding the missing fixture would go green faster and rot again on the next rebuild. So
 * instead: **a drive constructs what it needs and disposes of it.** Nothing to go stale.
 *
 * FOUR RULES, each of which has a failure behind it.
 *
 *   1. PRODUCT PATHS, NOT ROW INSERTS. A tenant is made by `createTenantWithAdmin`, a portal by
 *      `createPortal`, a build by `provisionProposalForPortal` — the same code the product runs.
 *      A hand-written INSERT proves the drive can write a row, not that the product can. Where no
 *      product path exists the insert is still used, and the comment says so out loud.
 *
 *   2. RUN-TAGGED NAMES. Every scenario gets a short random tag, and every name it creates carries
 *      it. Two runs never collide, a run never adopts a row it did not make, and residue is
 *      traceable to the run that left it. (The `scout-intake` drive failed forever after its first
 *      success precisely because its fixture name was fixed — bug log B-scout.)
 *
 *   3. DISPOSE BY ID, IN REVERSE, ALWAYS. Only ids this run recorded, newest first so foreign keys
 *      unwind cleanly, and in the caller's `finally` so a failed assertion cleans up too — a drive
 *      that only tidies on success leaves its worst mess exactly when something went wrong. Deleting
 *      by predicate ("all tenants named test-%") eventually deletes something a person seeded.
 *
 *   4. CANNOT-BUILD IS NOT A FINDING. If the box genuinely lacks what a scenario needs — no curated
 *      solicitation to provision against, no admin to act as — the factory throws `CannotRun`, the
 *      drive exits 2, and the suite reports it as uncovered. Uncovered is not passing, but it is
 *      also not a product defect, and a table that conflates them is worse than no table.
 *
 * USAGE
 *
 *   const s = await scenario('p3-lifecycle');
 *   try {
 *     const client = await s.tenant({ label: 'client' });
 *     const home   = await s.tenant({ label: 'home' });
 *     const build  = await s.build({ tenant: client, label: 'A' });
 *     ...
 *   } finally {
 *     await s.dispose();
 *   }
 */
import { randomUUID } from 'crypto';
import { sqlBypass as sql, sql as scopedSql } from '@/lib/db';
import { createTenantWithAdmin } from '@/lib/tenants/create-tenant';
import { createPartnerOrg } from '@/lib/partner/create-partner-org';
import { createPortal } from '@/lib/portal-launch';
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import bcrypt from 'bcryptjs';

/** The password every account this factory creates is given, so a drive can sign in as any of them. */
export const SCENARIO_PW = 'ScenarioDrive2026!';

/** Thrown when the box cannot supply what a scenario needs. Caught by `runScenario` → exit 2. */
export class CannotRun extends Error {
  readonly exitCode = 2;
  constructor(message: string) { super(message); this.name = 'CannotRun'; }
}

export interface ScenarioTenant {
  tenantId: string;
  slug: string;
  /** The DISPLAY name. The company selector and most UI show this, not the slug — matching a
   *  picker form on the slug finds nothing, silently picks the wrong company, and every downstream
   *  assertion then fails for a reason that has nothing to do with what is being tested. */
  name: string;
  adminUserId: string;
  adminEmail: string;
  password: string;
}

export interface ScenarioUser {
  userId: string;
  email: string;
  password: string;
  /** The tenant this person's account is HOMED in — null for a platform-scope actor. */
  homeTenantId: string | null;
}

export interface ScenarioBuild {
  portalId: string;
  proposalId: string;
  sectionCount: number;
  tenant: ScenarioTenant;
  opportunityId: string;
}

/** One recorded creation, as a set of DELETEs. Order between them does not matter — see `dispose`. */
interface Trace { what: string; steps: Array<() => Promise<number>> }

/**
 * Run every delete, retrying the ones that fail, until a pass makes no progress.
 *
 * WHY NOT JUST ORDER THEM. The first version of this factory hand-ordered its deletes and got it
 * wrong twice in one run: `proposal_compliance_matrix` references `proposal_sections`, so the
 * matrix has to go first; and a new tenant gets the starter library COPIED IN, so ~600
 * `library_atoms` rows reference its users and must go before them. Both were invisible until the
 * self-test counted the world and found 606 leaked atoms.
 *
 * A hand-ordered list is correct until the next migration adds a foreign key — the same reason the
 * cross-tenant sweep reads the catalog instead of a maintained list. Retrying until stable is
 * order-independent by construction, converges in two or three passes, and cannot be broken by a
 * schema change. What it cannot do is hide a genuine failure: anything still failing after the
 * passes run out is REPORTED, with the error.
 */
export async function deleteUntilStable(steps: Array<() => Promise<number>>): Promise<{ removed: number; stuck: string[] }> {
  let remaining = steps;
  let removed = 0;
  const lastError = new Map<() => Promise<number>, string>();
  for (let pass = 0; pass < 12 && remaining.length > 0; pass++) {
    const failed: typeof remaining = [];
    for (const step of remaining) {
      try { removed += await step(); }
      catch (e) { failed.push(step); lastError.set(step, String(e).slice(0, 160)); }
    }
    if (failed.length === remaining.length) { remaining = failed; break; } // no progress — stop
    remaining = failed;
  }
  return { removed, stuck: remaining.map((s) => lastError.get(s) ?? 'unknown error') };
}

/**
 * Every table carrying a `tenant_id`, read from the catalog once per process.
 *
 * Hand-listing them is how a teardown quietly stops being complete: a tenant touches 39 tables
 * today, and the next migration makes it 40.
 */
let tenantScopedTables: string[] | null = null;
async function tenantTables(): Promise<string[]> {
  if (tenantScopedTables) return tenantScopedTables;
  const rows = await sql<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relkind = 'r' AND a.attname = 'tenant_id' AND NOT a.attisdropped
      AND c.relnamespace = 'public'::regnamespace
    ORDER BY c.relname`;
  tenantScopedTables = rows.map((r) => r.relname);
  return tenantScopedTables;
}

/**
 * THE FOREIGN-KEY GRAPH, read once from the catalog: parent table → its children and the column.
 *
 * WHY A GRAPH AND NOT A LIST. Removing a tenant means removing everything that hangs off it, and
 * "everything" is transitive in a way that is genuinely easy to underestimate. Three levels deep,
 * discovered one failure at a time on a single leaked tenant:
 *
 *   tenants → proposals → proposal_sections → canvas_versions
 *   tenants → agent_task_queue → agent_task_results
 *
 * Half of those carry no `tenant_id` at all, so a purge that filters on `tenant_id` leaves them
 * standing — and then the parent cannot be deleted, and then neither can the tenant. My first two
 * attempts hand-listed one level, then two; each time the next level appeared as a fresh foreign-key
 * error. Hand-listing loses to the next migration anyway. Walking the graph does not.
 */
let fkGraph: Map<string, Array<{ table: string; col: string }>> | null = null;
async function foreignKeyGraph(): Promise<Map<string, Array<{ table: string; col: string }>>> {
  if (fkGraph) return fkGraph;
  const rows = await sql<{ parent: string; child: string; col: string }[]>`
    SELECT DISTINCT tgt.relname AS parent, src.relname AS child, a.attname AS col
    FROM pg_constraint k
    JOIN pg_class src ON src.oid = k.conrelid
    JOIN pg_class tgt ON tgt.oid = k.confrelid
    JOIN unnest(k.conkey) c(n) ON true
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = c.n
    WHERE k.contype = 'f' AND src.relkind = 'r' AND tgt.relkind = 'r'
      AND array_length(k.conkey, 1) = 1
      AND src.relnamespace = 'public'::regnamespace`;
  const g = new Map<string, Array<{ table: string; col: string }>>();
  for (const r of rows) {
    // Self-references would recurse forever and are handled by the retry loop anyway.
    if (r.child === r.parent) continue;
    // `users` and `tenants` are pointed at by almost everything as ACTORS. Descending through them
    // would try to delete half the database on behalf of one tenant. Actor references are not
    // ownership — the same distinction the cross-tenant sweep draws when it excludes `users`.
    if (r.parent === 'users' || r.parent === 'tenants') continue;
    if (!g.has(r.parent)) g.set(r.parent, []);
    g.get(r.parent)!.push({ table: r.child, col: r.col });
  }
  fkGraph = g;
  return g;
}

/** Every DELETE needed to remove one tenant's entire footprint, by walking the FK graph. */
/**
 * EXPORTED so a drive that CREATES a tenant can remove it with the same graph-descent the scenario
 * factory uses. The full-journey drive accepts a customer application, which provisions a real
 * tenant — leaving it behind would grow the box by one company per run, and hand-writing a second
 * cascade would be a second opinion about the schema that drifts from this one.
 */
export async function purgeTenantSteps(tenantId: string): Promise<Array<() => Promise<number>>> {
  const tables = await tenantTables();
  const graph = await foreignKeyGraph();
  const steps: Array<() => Promise<number>> = [];
  const seen = new Set<string>();

  /**
   * Depth-first from each tenant-scoped table, emitting a DELETE per edge with a nested selector.
   * DEEPEST FIRST, so the list is already close to a working order and `deleteUntilStable`
   * converges in one or two passes instead of grinding.
   */
  const descend = (table: string, selector: string, depth: number) => {
    if (depth > 3) return;                                   // three levels covers the whole schema today
    for (const child of graph.get(table) ?? []) {
      const key = `${child.table}.${child.col}<-${table}@${depth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const childSelector = `SELECT id FROM "${child.table}" WHERE "${child.col}" IN (${selector})`;
      descend(child.table, childSelector, depth + 1);        // grandchildren before children
      steps.push(async () => (await sql.unsafe(
        `DELETE FROM "${child.table}" WHERE "${child.col}" IN (${selector})`, [tenantId])).count);
    }
  };

  for (const t of tables) {
    descend(t, `SELECT id FROM "${t}" WHERE tenant_id = $1`, 1);
  }
  // The atom link tables join two atoms, so the graph reaches them only through one endpoint.
  // The other endpoint has to be named — the same blind spot that hid 303 cross-tenant lineage
  // edges from every tenant-column sweep until mig 208/209.
  steps.push(async () => (await sql`DELETE FROM atom_lineage WHERE child_atom_id IN (
    SELECT id FROM library_atoms WHERE tenant_id = ${tenantId}::uuid)`).count);
  steps.push(async () => (await sql`DELETE FROM atom_members WHERE member_atom_id IN (
    SELECT id FROM library_atoms WHERE tenant_id = ${tenantId}::uuid)`).count);

  for (const t of tables) {
    steps.push(async () => (await sql.unsafe(
      `DELETE FROM "${t}" WHERE tenant_id = $1`, [tenantId])).count);
  }
  // `tenants` itself has no tenant_id column.
  steps.push(async () => (await sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`).count);
  return steps;
}

export interface Scenario {
  /** Short run tag, present in every name this scenario creates. */
  readonly tag: string;
  tenant(opts?: { label?: string; name?: string }): Promise<ScenarioTenant>;
  user(opts: { label?: string; role?: string; homeTenant?: ScenarioTenant | null }): Promise<ScenarioUser>;
  partnerOrg(opts: { label?: string; actor: { id: string; email: string | null } }): Promise<ScenarioTenant>;
  build(opts: { tenant: ScenarioTenant; label?: string; opportunityId?: string }): Promise<ScenarioBuild>;
  /** An admin to act as. Resolved, never pinned; throws CannotRun if the box has none. */
  admin(): Promise<{ id: string; email: string; role: string }>;
  /** A curated opportunity a build can be provisioned from. Throws CannotRun if none. */
  provisionableOpportunity(): Promise<string>;
  /** Record something the CALLER created, so dispose takes it away too. */
  track(what: string, steps: Array<() => Promise<number>>): void;
  /** Adopt an EXISTING tenant for teardown — for cleaning up what a broken earlier run leaked.
   *  Deliberately explicit: nothing is ever adopted implicitly. */
  trackTenantPurge(label: string, tenantId: string): void;
  dispose(): Promise<void>;
}

/**
 * BUILDING A SCENARIO IS A PLATFORM-PLANE ACT, so the process doing it needs the owner connection.
 *
 * The factory calls the product's own helpers — `createTenantWithAdmin`, `createPortal`,
 * `provisionProposalForPortal` — and those use the CONTEXT-AWARE `sql`, bound to `DATABASE_URL`.
 * Point that at the NOBYPASSRLS app role with no tenant context and the writes are half-applied:
 * the tenant appears, the membership does not, and the drive above then fails on assertions about
 * sessions and roles that look for all the world like product bugs. Two session drives did exactly
 * that — green under the owner, seven and nine failures under the app role.
 *
 * This is B86's lesson pointed the other way. The PRODUCT under test stays on the scoped role (the
 * server has its own connection, and that is what the drives exercise over HTTP). The HARNESS
 * building the fixture needs the owner, which is precisely the documented bootstrap case.
 *
 * Checked once, up front, so the failure is one clear line instead of a scatter of confusing
 * assertion failures further down.
 */
async function requireOwnerConnection(): Promise<void> {
  const [me] = await scopedSql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user AS who, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (!me || (!me.rolsuper && !me.rolbypassrls)) {
    throw new CannotRun(
      `DATABASE_URL points at '${me?.who ?? 'an unknown role'}', which cannot bypass RLS. The `
      + 'scenario factory CREATES tenants, which is a platform-plane act — under a scoped role its '
      + 'setup writes are half-applied (tenant yes, membership no) and every assertion above it '
      + 'fails for a reason that has nothing to do with the product. Run scenario drives with '
      + 'DATABASE_URL=<owner>; the product under test still runs on the scoped role, because that '
      + 'is the server\'s own connection.');
  }
}

export async function scenario(name: string): Promise<Scenario> {
  await requireOwnerConnection();
  const tag = randomUUID().slice(0, 8);
  const traces: Trace[] = [];
  let cachedAdmin: { id: string; email: string; role: string } | null = null;

  const track = (what: string, steps: Array<() => Promise<number>>) => { traces.push({ what, steps }); };

  const self: Scenario = {
    tag,

    async admin() {
      if (cachedAdmin) return cachedAdmin;
      const [u] = await sql<{ id: string; email: string; role: string }[]>`
        SELECT id, email, role FROM users
        WHERE role IN ('master_admin', 'rfp_admin') AND is_active
        ORDER BY (role = 'master_admin') DESC, created_at ASC LIMIT 1`;
      if (!u) {
        throw new CannotRun('no active master_admin/rfp_admin exists — every scenario needs one to '
          + 'act as (tenant creation, provisioning, release are all admin acts). Seed one and re-run.');
      }
      cachedAdmin = u;
      return u;
    },

    async tenant(opts = {}) {
      const label = opts.label ?? 'co';
      const name = opts.name ?? `Scenario ${label} ${tag}`;
      const adminEmail = `${label}.${tag}@scenario.test`;
      const actor = await self.admin();
      const r = await createTenantWithAdmin(
        { name, adminEmail, adminName: `${label} admin ${tag}`, password: SCENARIO_PW },
        { id: actor.id, email: actor.email, role: actor.role as never },
      );
      // Undo in dependency order INSIDE one trace: a tenant's rows must go before the tenant.
      track(`tenant ${r.slug}`, await purgeTenantSteps(r.tenantId));
      return {
        tenantId: r.tenantId, slug: r.slug, name, adminUserId: r.adminUserId,
        adminEmail, password: SCENARIO_PW,
      };
    },

    async user(opts) {
      const label = opts.label ?? 'user';
      const email = `${label}.${tag}@scenario.test`;
      const role = opts.role ?? 'tenant_user';
      const homeTenantId = opts.homeTenant?.tenantId ?? null;
      // NO PRODUCT PATH for "a bare user in an existing tenant": the product creates users through
      // application acceptance (which needs an application) or tenant creation (which makes a
      // tenant too). Stated rather than hidden — this is the one insert in the factory.
      const hash = await bcrypt.hash(SCENARIO_PW, 12);
      const [u] = await sql<{ id: string }[]>`
        INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password, is_active)
        VALUES (${email}, ${`${label} ${tag}`}, ${role}, ${homeTenantId}, ${hash}, false, true)
        RETURNING id`;
      track(`user ${email}`, [
        async () => (await sql`DELETE FROM user_memberships WHERE user_id = ${u.id}::uuid`).count,
        async () => (await sql`DELETE FROM library_atoms WHERE owner_user_id = ${u.id}::uuid`).count,
        async () => (await sql`DELETE FROM users WHERE id = ${u.id}::uuid`).count,
      ]);
      return { userId: u.id, email, password: SCENARIO_PW, homeTenantId };
    },

    async partnerOrg(opts) {
      const label = opts.label ?? 'partner';
      const r = await createPartnerOrg({
        orgName: `Scenario ${label} ${tag}`,
        adminName: `${label} admin ${tag}`,
        adminEmail: `${label}.${tag}@scenario.test`,
        createdBy: opts.actor,
      });
      if (!r.ok) throw new CannotRun(`could not create a partner org: ${r.error} (${r.code})`);
      track(`partner org ${r.slug}`, await purgeTenantSteps(r.tenantId));
      // The temp password differs from SCENARIO_PW here — createPartnerOrg generates its own and
      // there is no way to pass one in. Reset it so a drive can sign in as this admin like any other.
      const hash = await bcrypt.hash(SCENARIO_PW, 12);
      await sql`UPDATE users SET password_hash = ${hash}, temp_password = false WHERE id = ${r.userId}::uuid`;
      return {
        tenantId: r.tenantId, slug: r.slug, name: `Scenario ${label} ${tag}`, adminUserId: r.userId,
        adminEmail: `${label}.${tag}@scenario.test`, password: SCENARIO_PW,
      };
    },

    async provisionableOpportunity() {
      // The page's own requirement: a proposal is provisioned from an opportunity whose curated
      // master carries at least one volume with at least one required item. Anything less produces
      // a build with no sections, which is not a build.
      const [o] = await sql<{ id: string }[]>`
        SELECT o.id FROM opportunities o
        JOIN curated_solicitations cs ON cs.id = o.solicitation_id
        WHERE EXISTS (
          SELECT 1 FROM solicitation_volumes v
          JOIN volume_required_items ri ON ri.volume_id = v.id
          WHERE v.solicitation_id = cs.id)
        ORDER BY o.created_at DESC LIMIT 1`;
      if (!o) {
        throw new CannotRun('no opportunity has a curated master with volumes AND required items — '
          + 'a build provisioned from one would have no sections. Curate a solicitation and re-run.');
      }
      return o.id;
    },

    async build(opts) {
      const label = opts.label ?? 'build';
      const oppId = opts.opportunityId ?? (await self.provisionableOpportunity());
      const actor = await self.admin();
      const portal = await createPortal(
        opts.tenant.tenantId, oppId, null, `Scenario ${label} ${tag}`, actor.id);
      if (!portal) throw new CannotRun(`createPortal returned nothing for ${opts.tenant.slug}/${label}`);
      const prov = await provisionProposalForPortal({
        tenantId: opts.tenant.tenantId,
        tenantName: `Scenario ${label} ${tag}`,
        tenantSlug: opts.tenant.slug,
        opportunityId: oppId,
        label: `Scenario ${label} ${tag}`,
        actorId: actor.id,
        actorEmail: actor.email,
      });
      if ('error' in prov) throw new CannotRun(`provision failed: ${prov.error}`);
      await sql`UPDATE proposal_portals SET proposal_id = ${prov.proposalId}::uuid WHERE id = ${portal.portalId}::uuid`;
      track(`build ${opts.tenant.slug}/${label}`, [
        async () => (await sql`DELETE FROM collaborator_stage_access WHERE collaborator_id IN (
          SELECT id FROM proposal_collaborators WHERE proposal_id = ${prov.proposalId}::uuid)`).count,
        async () => (await sql`DELETE FROM proposal_collaborators WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM canvas_versions WHERE section_id IN (
          SELECT id FROM proposal_sections WHERE proposal_id = ${prov.proposalId}::uuid)`).count,
        async () => (await sql`DELETE FROM proposal_comments WHERE section_id IN (
          SELECT id FROM proposal_sections WHERE proposal_id = ${prov.proposalId}::uuid)`).count,
        async () => (await sql`DELETE FROM proposal_sections WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposal_artifacts WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposal_activity_log WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposal_stage_history WHERE proposal_id = ${prov.proposalId}::uuid`).count,
        // `tasks` and `process_instances` DO NOT carry proposal_id — the workflow engine addresses a
        // build through `tasks.entity_id` and scopes instances by tenant. Writing `proposal_id` here
        // produced four "column does not exist" errors that dispose reported as ROWS LEFT BEHIND,
        // when nothing had leaked. A harness that cries residue is as corrosive as one that hides it.
        async () => (await sql`DELETE FROM tasks WHERE entity_id = ${prov.proposalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposal_portals WHERE id = ${portal.portalId}::uuid`).count,
        async () => (await sql`DELETE FROM proposals WHERE id = ${prov.proposalId}::uuid`).count,
      ]);
      return {
        portalId: portal.portalId, proposalId: prov.proposalId,
        sectionCount: prov.sectionCount, tenant: opts.tenant, opportunityId: oppId,
      };
    },

    track,

    trackTenantPurge(label, tenantId) {
      // Deferred: purgeTenantSteps is async, and a trace holds thunks. One thunk that builds and
      // runs the whole purge is equivalent and keeps `track` synchronous.
      track(`adopted tenant ${label}`, [async () => {
        const steps = await purgeTenantSteps(tenantId);
        const r = await deleteUntilStable(steps);
        if (r.stuck.length) throw new Error(r.stuck[0]);
        return r.removed;
      }]);
    },

    async dispose() {
      // FLATTENED, then retried until stable. Ordering between traces matters as much as within
      // one — a tenant's atoms reference its users, and a build's matrix references its sections —
      // so the whole scenario is disposed as one order-independent set rather than trace by trace.
      const all = traces.flatMap((t) => t.steps);
      let { removed, stuck } = await deleteUntilStable(all);

      // ONE DELAYED SWEEP, for writes that land AFTER teardown starts.
      //
      // Provisioning kicks off agent work, and an agent writes its episodic memory when it finishes
      // — which can be after dispose has already deleted that tenant's memories and moved on to the
      // tenant row. The symptom is a lone `episodic_memories_tenant_id_fkey` violation on a purge
      // that was otherwise complete, and it is intermittent, because it is a race.
      //
      // Retrying immediately does not help: the write has not happened yet. Waiting once and
      // re-running only the failing deletes does. If it is still stuck after that, it is reported —
      // a race that keeps losing is a fact, not something to paper over with a longer sleep.
      if (stuck.length) {
        await new Promise((r) => setTimeout(r, 2500));
        const again = await deleteUntilStable(all);
        removed += again.removed;
        stuck = again.stuck;
      }
      // TWO KINDS OF FAILING DELETE, and calling them the same thing is its own defect.
      //
      // A statement naming a column or table that does not exist is a BUG IN THIS FILE — it deleted
      // nothing, but it also never could have, so no rows leaked because of it. Anything else (a
      // foreign key that still holds after eight passes, a permission error) means rows really are
      // left behind. The first version reported both as "LEFT ROWS BEHIND" and cried residue on a
      // run whose census proved the world was untouched.
      const harnessBugs = stuck.filter((e) => /does not exist/i.test(e));
      const residue = stuck.filter((e) => !/does not exist/i.test(e));
      if (harnessBugs.length) {
        console.error(`scenario ${name}[${tag}] — ${harnessBugs.length} teardown statement(s) are WRONG `
          + `(they deleted nothing and never could; this is a bug in scenario.mts, not leaked data):`);
        for (const e of [...new Set(harnessBugs)].slice(0, 6)) console.error(`    ${e}`);
      }
      if (residue.length) {
        // Reported, never swallowed. Residue is a fact the next run needs.
        console.error(`scenario ${name}[${tag}] dispose LEFT ROWS BEHIND — ${residue.length} delete(s) still failing:`);
        for (const e of [...new Set(residue)].slice(0, 6)) console.error(`    ${e}`);
      }
      if (!stuck.length) {
        console.log(`scenario ${name}[${tag}] disposed — ${removed} row(s) removed, fixture restored`);
      }
    },
  };

  return self;
}

/**
 * Run a drive body against a fresh scenario, disposing it whatever happens, and mapping a
 * `CannotRun` to exit 2 so the suite reports uncovered rather than a finding.
 */
export async function runScenario(
  name: string,
  body: (s: Scenario) => Promise<boolean>,
): Promise<never> {
  let s: Scenario | null = null;
  let ok = false;
  try {
    s = await scenario(name);
    ok = await body(s);
  } catch (e) {
    if (e instanceof CannotRun) {
      console.error(`CANNOT RUN\n  ${e.message}`);
      if (s) await s.dispose().catch(() => {});
      process.exit(2);
    }
    console.error(`DRIVE ERROR ${String(e)}`);
    if (e instanceof Error && e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  } finally {
    if (s) await s.dispose().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
}
