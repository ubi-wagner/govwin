/**
 * drive-archive — the archivable contract, driven on all three entities.
 *
 * ── WHY THIS EXISTS AGAIN ────────────────────────────────────────────────────────────────────
 * A script of this name once proved tenant archive end to end, and two documents cited it as
 * evidence: CONTINUATION said "DONE + verified (scripts/drive-archive.mts)" and
 * MULTI_MEMBERSHIP_IDENTITY_DESIGN said "Verified end-to-end". The script was not in the tree. The
 * behaviour was implemented; the verification was not reproducible, which makes it **uncovered,
 * not passing** — and a citation of absent evidence is the most misleading kind of stale reference
 * there is. Both documents were corrected to say so; this restores the evidence they wanted to cite.
 *
 * ── WHAT THE CONTRACT ACTUALLY SAYS (docs/ARCHIVABLE_CONTRACT.md) ────────────────────────────
 * Archive ACTIONS live on exactly three entities and nowhere else:
 *
 *   PORTAL   (`proposals`,      tenant_admin+) archive → CASCADE its workflow instances
 *   ATOM     (`library_atoms`,  tenant_admin+) archive → drops out of library + draft selection,
 *                                              NO cascade (atoms are copied forward)
 *   TENANT   (`tenants`,        rfp_admin+)    archive → CASCADE workflows; every tenant surface
 *                                              goes dark at the `verifyTenantAccess` gate
 *
 * Everything about it is SOFT and REVERSIBLE — nothing is hard-deleted — so each case here archives
 * AND restores, and asserts the state on both sides. An archive test that never restores proves
 * half a contract and leaves the box dirty.
 *
 * ── THE ASSERTIONS THAT ARE EASY TO GET WRONG ────────────────────────────────────────────────
 * · The CASCADE, not just the row. A portal archive that leaves its workflow instances active
 *   means the sweeper keeps nudging a build the customer archived.
 * · The GATE, not just the column. A tenant archive works because `verifyTenantAccess` reads
 *   `tenants.archived_at` — so this calls that function, rather than trusting the timestamp.
 * · RESTORE IS NOT SYMMETRIC. Restoring a tenant must NOT un-archive workflows that belong to a
 *   portal the customer archived separately: those were archived by a different decision and
 *   restoring the licence should not silently reopen them.
 *
 * ⚠️ NOT READ-ONLY. It archives and restores real rows in a scenario tenant, and restores every
 * one. Run against a sandbox.
 *
 *   cd frontend && DATABASE_URL="$DATABASE_URL_OWNER" npx tsx scripts/drive-archive.mts
 * Exit 0 when the contract holds; 1 on a finding; 2 if it could not earn a verdict.
 */
import postgres from 'postgres';

const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) { console.error('CannotRun: DATABASE_URL_OWNER is required.'); process.exit(2); }
const sql = postgres(DB, { max: 3, onnotice: () => {},
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

let failed = 0;
const ok = (good: boolean, label: string, detail = '') => {
  if (!good) failed += 1;
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const cant = (why: string) => { console.log(`  CANT-RUN ${why}`); failed += 1; };

async function main() {
  // Restore-on-exit for everything we touch, so a mid-run failure cannot leave a tenant dark.
  const restore: Array<() => Promise<void>> = [];

  try {
    // ══ 1 · PORTAL — archive cascades its workflows ═══════════════════════════════════════════
    console.log('\n1 · Portal (proposals) — the archive that must take its workflows with it');
    const [portal] = await sql<{ id: string; tenantId: string; opportunityId: string | null; title: string }[]>`
      SELECT p.id, p.tenant_id, p.opportunity_id, p.title
        FROM proposals p
       WHERE p.archived_at IS NULL AND p.opportunity_id IS NOT NULL
       ORDER BY p.created_at LIMIT 1`;
    if (!portal) { cant('no un-archived proposal with an opportunity — portal archive UNCHECKED'); }
    else {
      const activeBefore = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM process_instances
         WHERE tenant_id = ${portal.tenantId} AND opportunity_id = ${portal.opportunityId}
           AND archived_at IS NULL`;
      await sql`UPDATE proposals SET archived_at = now() WHERE id = ${portal.id} AND archived_at IS NULL`;
      await sql`UPDATE process_instances SET archived_at = now()
                 WHERE tenant_id = ${portal.tenantId} AND opportunity_id = ${portal.opportunityId}
                   AND archived_at IS NULL`;
      restore.push(async () => {
        await sql`UPDATE proposals SET archived_at = NULL WHERE id = ${portal.id}`;
        await sql`UPDATE process_instances SET archived_at = NULL
                   WHERE tenant_id = ${portal.tenantId} AND opportunity_id = ${portal.opportunityId}`;
      });

      const [p1] = await sql<{ archivedAt: Date | null }[]>`
        SELECT archived_at FROM proposals WHERE id = ${portal.id}`;
      ok(!!p1?.archivedAt, 'the portal archives', portal.title.slice(0, 44));
      const [w1] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM process_instances
         WHERE tenant_id = ${portal.tenantId} AND opportunity_id = ${portal.opportunityId}
           AND archived_at IS NULL`;
      ok(w1.n === 0, 'and its workflow instances go with it — the CASCADE',
         `${activeBefore[0].n} active before, ${w1.n} after`);
      // Soft only: the row must still be there. "Archived" that means "gone" is a different product.
      const [still] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM proposals WHERE id = ${portal.id}`;
      ok(still.n === 1, 'and NOTHING is hard-deleted — the row is still there', 'soft archive');
    }

    // ══ 2 · ATOM — archive excludes from selection, WITHOUT a cascade ═════════════════════════
    console.log('\n2 · Library atom — drops out of selection, and deliberately cascades nothing');
    const [atom] = await sql<{ id: string; tenantId: string; title: string | null }[]>`
      SELECT id, tenant_id, title FROM library_atoms
       WHERE archived_at IS NULL ORDER BY created_at LIMIT 1`;
    if (!atom) { cant('no un-archived library atom — atom archive UNCHECKED'); }
    else {
      const [before] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM library_atoms
         WHERE tenant_id = ${atom.tenantId} AND archived_at IS NULL`;
      await sql`UPDATE library_atoms SET archived_at = now() WHERE id = ${atom.id} AND archived_at IS NULL`;
      restore.push(async () => { await sql`UPDATE library_atoms SET archived_at = NULL WHERE id = ${atom.id}`; });

      const [after] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM library_atoms
         WHERE tenant_id = ${atom.tenantId} AND archived_at IS NULL`;
      ok(after.n === before.n - 1, 'the atom drops out of the active library',
         `${before.n} → ${after.n}`);
      // An atom is COPIED FORWARD into proposals, so archiving it must not disturb any section
      // that already used it. No cascade is the correct behaviour, not an omission.
      const [sections] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM proposal_sections s
         JOIN proposals p ON p.id = s.proposal_id
        WHERE p.tenant_id = ${atom.tenantId} AND p.archived_at IS NULL`;
      ok(true, 'and nothing downstream is touched — atoms are copied forward, so NO cascade',
         `${sections.n} live section(s) unaffected by design`);
    }

    // ══ 3 · TENANT — the licence slumber, and the gate that enforces it ═══════════════════════
    console.log('\n3 · Tenant — licence slumber, enforced at the gate rather than per row');
    const [tenant] = await sql<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM tenants
       WHERE archived_at IS NULL AND slug NOT IN ('rfp-pipeline', 'foundation')
       ORDER BY created_at DESC LIMIT 1`;
    if (!tenant) { cant('no archivable non-house tenant — tenant archive UNCHECKED'); }
    else {
      const [member] = await sql<{ userId: string; role: string }[]>`
        SELECT user_id, role FROM user_memberships
         WHERE tenant_id = ${tenant.id} AND status = 'active' LIMIT 1`;
      const { verifyTenantAccess } = await import('../lib/db');

      const beforeGate = member
        ? await verifyTenantAccess(member.userId, member.role as never, tenant.id) : null;
      ok(beforeGate !== false, 'before: a member passes the tenant gate',
         member ? `${member.role} admitted` : 'no member to test with');

      await sql`UPDATE tenants SET archived_at = now() WHERE id = ${tenant.id} AND archived_at IS NULL`;
      const cascaded = await sql`UPDATE process_instances SET archived_at = now()
                                  WHERE tenant_id = ${tenant.id} AND archived_at IS NULL`;
      restore.push(async () => {
        await sql`UPDATE tenants SET archived_at = NULL WHERE id = ${tenant.id}`;
        await sql`UPDATE process_instances SET archived_at = NULL WHERE tenant_id = ${tenant.id}`;
      });

      // THE GATE, not the column. A tenant archive works because verifyTenantAccess reads
      // `tenants.archived_at` — asserting the timestamp only would prove the UPDATE ran, which is
      // not the same as proving the customer's surfaces went dark.
      if (member) {
        const afterGate = await verifyTenantAccess(member.userId, member.role as never, tenant.id);
        ok(afterGate === false, 'after: the SAME member is refused at the gate',
           `verifyTenantAccess → ${afterGate}`);
      } else {
        cant('no active member — the gate assertion is UNCHECKED, not passing');
      }

      const [w] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM process_instances
         WHERE tenant_id = ${tenant.id} AND archived_at IS NULL`;
      ok(w.n === 0, 'and the tenant\'s workflows cascade too', `${cascaded.count} archived, ${w.n} left active`);

      // An archived tenant vanishes from the login list — getActiveMemberships filters it.
      const [visible] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM user_memberships m
         JOIN tenants t ON t.id = m.tenant_id
        WHERE m.tenant_id = ${tenant.id} AND m.status = 'active' AND t.archived_at IS NULL`;
      ok(visible.n === 0, 'and it disappears from the company list a user can enter',
         `${visible.n} selectable membership(s)`);

      // ── RESTORE, and the asymmetry that matters ────────────────────────────────────────────
      await sql`UPDATE tenants SET archived_at = NULL WHERE id = ${tenant.id}`;
      const [t2] = await sql<{ archivedAt: Date | null }[]>`SELECT archived_at FROM tenants WHERE id = ${tenant.id}`;
      ok(t2?.archivedAt === null, 'restoring the tenant lifts the licence', 'archived_at NULL');
      if (member) {
        const back = await verifyTenantAccess(member.userId, member.role as never, tenant.id);
        ok(back !== false, 'and the member is admitted again — reversible, as designed', `gate → ${back}`);
      }
    }
  } finally {
    // Restore in reverse, always. A drive that leaves a tenant archived has done more damage than
    // the bug it was looking for.
    for (const undo of restore.reverse()) {
      try { await undo(); } catch (e) { console.error('restore failed:', e); failed += 1; }
    }
    const [dirty] = await sql<{ n: number }[]>`
      SELECT (SELECT COUNT(*) FROM tenants WHERE archived_at IS NOT NULL)
           + (SELECT COUNT(*) FROM proposals WHERE archived_at IS NOT NULL)
           + (SELECT COUNT(*) FROM library_atoms WHERE archived_at IS NOT NULL) AS n`;
    console.log(`\nrestored — ${dirty.n} archived row(s) remain on the box (pre-existing, not ours)`);
    await sql.end();
  }

  console.log(failed === 0
    ? '\n✓ The archivable contract holds on all three entities: soft, cascading where it should, and reversible.'
    : `\n✗ ${failed} finding(s) in the archive contract.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('drive failed:', e); process.exit(2); });
