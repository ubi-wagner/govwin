/**
 * THE INVARIANT: nothing reads or writes cross-tenant. Ever.
 *
 * Stated by the owner, and it is absolute. Tenants never touch each other's data. Bridges carry
 * MESSAGES; data moves by INWARD COPY only — opportunities copied into tenants, templates copied
 * into tenants. A stored reference from one tenant's row to another tenant's row is not a copy. It
 * is a shared object, and a shared object is the thing the rule forbids.
 *
 * This sweeps the whole schema for such references, from the catalog rather than from a list
 * someone maintains by hand — a hand-maintained list is correct only until the next migration adds
 * a table, which is exactly how the one real violation stayed invisible for months.
 *
 * TWO SHAPES, AND THE SECOND IS THE ONE THAT HIDES.
 *
 *   direct — a table with `tenant_id` whose FK points at another row that also has `tenant_id`.
 *            Easy to spot, and all 46 of these were clean.
 *
 *   joined — a link table carrying NO `tenant_id` of its own, joining two tenant-scoped rows.
 *            `atom_lineage(parent_atom_id, child_atom_id)` is this shape. It is invisible to any
 *            check that looks for a tenant column, because it has none — its tenancy is implied
 *            through both endpoints. 303 of its 303 rows spanned tenants and nothing noticed.
 *
 * PLATFORM SCOPE IS NOT A VIOLATION, and conflating the two produces false findings. `tenant_id IS
 * NULL` means the platform plane — the house shelf, system templates, curation state owned by no
 * tenant — the same distinction `tenant_isolation_select` draws with its `OR (tenant_id IS NULL)`
 * arm. A tenant document pointing at a system template is the documented bridge, not a leak. The
 * predicate fires only when BOTH sides are owned and the owners differ. (My first pass used
 * `IS DISTINCT FROM` and reported that bridge as a violation — a phantom, corrected here.)
 *
 *   DATABASE_URL=<owner or app> node scripts/check-tenant-isolation-invariant.mjs
 *
 * Reads need to see across tenants to do this arithmetic, which is the owner role's legitimate
 * purpose; under the scoped app role the sweep would see nothing and report a clean box.
 *
 * Exit 0 clean · 1 at least one cross-tenant reference · 2 could not run.
 */
import postgres from 'postgres';

const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL (or DATABASE_URL_OWNER) required'); process.exit(2); }
// toCamel ON PURPOSE, to match how the rest of the codebase reads rows. The first version of this
// file created a raw client and then read `r.childScoped` off a `child_scoped` column — undefined,
// falsy, so all 46 direct paths silently took the join-table branch and the sweep reported
// "checked 0 direct FK path(s)". That is the exact camelCase trap CLAUDE.md documents, inverted.
const sql = postgres(DB, { max: 2, transform: { column: { from: postgres.toCamel } } });

const hasTenantCol = (oid) => sql`
  SELECT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = ${oid} AND attname = 'tenant_id' AND NOT attisdropped) AS yes`;

async function main() {
  // Every single-column FK whose TARGET is tenant-scoped, with whether the source is too.
  const fks = await sql`
    SELECT src.oid AS src_oid, src.relname AS child, a.attname AS col, tgt.relname AS parent,
           EXISTS (SELECT 1 FROM pg_attribute x
                   WHERE x.attrelid = src.oid AND x.attname = 'tenant_id' AND NOT x.attisdropped) AS child_scoped
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN unnest(c.conkey) k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND src.relkind = 'r' AND tgt.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute y
                  WHERE y.attrelid = tgt.oid AND y.attname = 'tenant_id' AND NOT y.attisdropped)
      -- A PERSON IS NOT TENANT DATA. The users table carries a tenant_id for someone's HOME tenant,
      -- but a human legitimately spans tenants: multi-membership identity, an rfp_admin acting
      -- inside a tenant, an external collaborator on someone else's proposal (which is exactly what
      -- proposal_collaborators.user_id is). Counting an actor reference as a cross-tenant data leak
      -- produces three guaranteed false findings every run, and that is how a report gets skimmed.
      -- Membership and authority are enforced by verifyTenantAccess / resolveUserAccess elsewhere,
      -- not by this sweep. (NB: no backticks in this comment -- it lives inside a JS template
      -- literal, and a stray backtick silently ends the query string.)
      AND tgt.relname <> 'users'
    ORDER BY src.relname, a.attname`;
  void hasTenantCol;

  const violations = [];
  let direct = 0, joined = 0, skipped = 0;

  // ── direct: child carries tenant_id ──────────────────────────────────────────────────────────
  for (const f of fks.filter((r) => r.childScoped)) {
    direct++;
    try {
      const [r] = await sql.unsafe(
        `SELECT count(*)::int AS n FROM "${f.child}" ch JOIN "${f.parent}" pa ON pa.id = ch."${f.col}"
         WHERE ch.tenant_id IS NOT NULL AND pa.tenant_id IS NOT NULL AND ch.tenant_id <> pa.tenant_id`);
      if (r.n > 0) violations.push({ kind: 'direct', link: `${f.child}.${f.col} → ${f.parent}`, n: r.n });
    } catch { skipped++; }
  }

  // ── joined: link tables with NO tenant_id, two FKs into tenant-scoped tables ──────────────────
  const linkTables = new Map();
  for (const f of fks.filter((r) => !r.childScoped)) {
    if (!linkTables.has(f.child)) linkTables.set(f.child, []);
    linkTables.get(f.child).push(f);
  }
  for (const [table, cols] of linkTables) {
    if (cols.length < 2) continue;
    // Every unordered pair of endpoints — a 3-FK table can span on any of its pairs.
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const a = cols[i], b = cols[j];
        joined++;
        try {
          const [r] = await sql.unsafe(
            `SELECT count(*)::int AS n FROM "${table}" l
             JOIN "${a.parent}" pa ON pa.id = l."${a.col}"
             JOIN "${b.parent}" pb ON pb.id = l."${b.col}"
             WHERE pa.tenant_id IS NOT NULL AND pb.tenant_id IS NOT NULL AND pa.tenant_id <> pb.tenant_id`);
          if (r.n > 0) {
            violations.push({ kind: 'joined', link: `${table}(${a.col} ↔ ${b.col})`, n: r.n });
          }
        } catch { skipped++; }
      }
    }
  }

  console.log('actor references (→ users) are excluded by design — see the query comment');
  console.log(`checked ${direct} direct FK path(s) and ${joined} join-table pair(s)`
    + (skipped ? ` · ${skipped} could not be measured (non-uuid or non-'id' key)` : ''));
  console.log();

  if (!violations.length) {
    console.log('✓ no cross-tenant references anywhere in the schema.');
    console.log('  (platform scope — tenant_id IS NULL — is not a violation and is excluded by design)');
    await sql.end();
    process.exit(0);
  }

  console.error('✗ CROSS-TENANT REFERENCES FOUND — the rule is that data moves by inward COPY only:');
  for (const v of violations) console.error(`    ${v.kind.padEnd(6)} ${v.link.padEnd(52)} ${v.n} row(s)`);
  console.error();
  console.error('  Each is a stored reference from one tenant\'s row to another tenant\'s row. Fix by');
  console.error('  copying the referenced row INTO the owning tenant and pointing at the copy, then');
  console.error('  add a trigger on that link so it cannot come back (see mig 208 for the pattern).');
  await sql.end();
  process.exit(1);
}

main().catch(async (e) => {
  console.error(`could not run the invariant sweep: ${String(e).slice(0, 300)}`);
  await sql.end().catch(() => {});
  process.exit(2);
});
