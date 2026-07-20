/**
 * HITL setup — make a couple of the seeded DSIP OPPs RELEASE-READY so a
 * human-in-the-loop run goes card → purchase → release → a real multi-volume
 * build with editable canvases (the canvas work is the point).
 *
 * Curates the MANTRAS + ExCAIPE solicitations with a real DARPA SBIR Phase I
 * skeleton (Technical Volume with 7 section molds + a Cost Volume) and links the
 * opportunity to its solicitation so provisionProposalForPortal materializes the
 * full build. Then DRESS-REHEARSES one provision end-to-end (assert the canvas
 * count) and cleans it up, so the OPP is left fresh for the human run.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/hitl-setup.mts
 */
import { sql } from '@/lib/db';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { provisionProposalForPortal } from '@/lib/provision-proposal';

// DARPA SBIR Phase I skeleton — Technical Volume section molds (page budgets sum to 18 of a 20pp cap).
const TECH_ITEMS: Array<[string, number]> = [
  ['Identification and Significance of the Problem or Opportunity', 3],
  ['Phase I Technical Objectives', 2],
  ['Phase I Statement of Work / Work Plan', 6],
  ['Related Work', 2],
  ['Key Personnel', 2],
  ['Facilities and Equipment', 1],
  ['Commercialization Strategy', 2],
];

const TARGETS = ['DPA26BZ03-DV011', 'DPA26BZ03-DV013']; // MANTRAS, ExCAIPE

let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

try {
  const [tenant] = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug FROM tenants WHERE slug = 'acme-navy-systems' LIMIT 1`;
  const [user] = await sql<{ id: string; email: string }[]>`
    SELECT id, email FROM users WHERE email = 'admin@acme-navy.test' LIMIT 1`;
  ok('found demo tenant + admin', !!tenant && !!user);

  for (const code of TARGETS) {
    const [opp] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM opportunities WHERE source = 'dsip' AND source_id = ${code} LIMIT 1`;
    if (!opp) { ok(`opportunity ${code} present`, false); continue; }
    const [cs] = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE opportunity_id = ${opp.id}::uuid LIMIT 1`;
    if (!cs) { ok(`solicitation for ${code} present`, false); continue; }

    // Link the opportunity to its solicitation (resolveTopicCompliance reads this).
    await sql`UPDATE opportunities SET solicitation_id = ${cs.id}::uuid WHERE id = ${opp.id}::uuid`;

    // Idempotent re-seed of the skeleton.
    await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id = ${cs.id}::uuid)`;
    await sql`DELETE FROM solicitation_volumes WHERE solicitation_id = ${cs.id}::uuid`;
    await sql`DELETE FROM solicitation_compliance WHERE solicitation_id = ${cs.id}::uuid`;

    await sql`INSERT INTO solicitation_compliance
      (solicitation_id, page_limit_technical, submission_format, font_family, font_size, images_tables_allowed, taba_allowed)
      VALUES (${cs.id}::uuid, 20, 'PDF — Times New Roman 10pt, 1-inch margins, single-spaced', 'Times New Roman', 10, true, true)`;

    const [tv] = await sql<{ id: string }[]>`INSERT INTO solicitation_volumes
      (solicitation_id, volume_number, volume_name, volume_format) VALUES (${cs.id}::uuid, 1, 'Technical Volume', 'dsip_standard') RETURNING id`;
    const [cv] = await sql<{ id: string }[]>`INSERT INTO solicitation_volumes
      (solicitation_id, volume_number, volume_name, volume_format) VALUES (${cs.id}::uuid, 2, 'Cost Volume', 'dsip_standard') RETURNING id`;

    let n = 0;
    for (const [name, pages] of TECH_ITEMS) {
      n++;
      await sql`INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required, page_limit)
                VALUES (${tv.id}::uuid, ${String(n)}, ${name}, 'word_doc', true, ${pages})`;
    }
    await sql`INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required)
              VALUES (${cv.id}::uuid, '1', 'Cost Proposal', 'spreadsheet', true)`;

    // Verify the skeleton resolves the way provision will read it.
    const resolved = await resolveTopicCompliance(opp.id);
    const items = resolved.volumes.reduce((s, v) => s + (v.items?.length ?? 0), 0);
    ok(`${code} release-ready`, resolved.volumes.length === 2 && items === 8, `${resolved.volumes.length} volumes, ${items} section molds`);
  }

  // ── Dress-rehearse ONE full provision (MANTRAS) → assert canvases → clean up ──
  const [mantras] = await sql<{ id: string }[]>`SELECT id FROM opportunities WHERE source='dsip' AND source_id='DPA26BZ03-DV011' LIMIT 1`;
  const res = await provisionProposalForPortal({
    tenantId: tenant.id, tenantName: tenant.name, tenantSlug: tenant.slug,
    opportunityId: mantras.id, label: 'hitl-rehearsal', actorId: user.id, actorEmail: user.email,
  });
  if ('error' in res) {
    ok('dress-rehearsal provision', false, res.error);
  } else {
    ok('dress-rehearsal provision → editable canvases', res.sectionCount === 8, `${res.sectionCount} section canvases across 2 volumes`);
    const [{ arts }] = await sql<{ arts: number }[]>`SELECT count(*)::int arts FROM proposal_artifacts WHERE proposal_id = ${res.proposalId}::uuid`;
    ok('build has 2 volume artifacts', arts === 2, `${arts} artifacts`);
    // clean up the rehearsal proposal so the OPP is fresh for the human run
    await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id = ${res.proposalId}::uuid`;
    await sql`DELETE FROM proposal_sections WHERE proposal_id = ${res.proposalId}::uuid`;
    await sql`DELETE FROM proposal_artifacts WHERE proposal_id = ${res.proposalId}::uuid`;
    await sql`DELETE FROM proposals WHERE id = ${res.proposalId}::uuid`;
    console.log('  ↳ rehearsal proposal cleaned up (OPP left fresh for the human run)');
  }
} finally {
  await sql.end();
}

console.log(`\n${failures === 0 ? '✅ HITL SETUP READY — MANTRAS + ExCAIPE will provision a full multi-volume canvas build on release' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
