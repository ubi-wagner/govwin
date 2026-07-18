/**
 * Seed the Immobileyes CUAS OPP end-to-end from the uploaded solicitation.
 *
 * Source docs (read, not scraped-live): DON26BX03-NP002 NAVAIR/NAVSEA Open Topic
 * for Counter-UAS + the DoW 2026 SBIR CSO Preface. Builds the REAL 6-volume CSO
 * structure and the full compliance matrix:
 *   V1 Proposal Cover Sheet · V2 Technical Volume (10-pg white paper, 12 sections
 *   in the CSO-mandated order) · V3 Cost Volume (Base + Option) · V4 Company
 *   Commercialization Report · V5 Supporting Documents · V6 Fraud/Waste/Abuse.
 *
 * Phase I (from the topic): Base 6 mo NTE $200,000 · Option 6 mo NTE $115,000.
 * CMMC Level 2 (Self) · ITAR-restricted · deliverables: Kick-Off, Progress, Final
 * Report, Initial Phase II Proposal.
 *
 * Creates the Immobileyes tenant + admin, publishes the card, and DRESS-REHEARSES
 * a full provision (asserts the section-canvas count) then cleans it up.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/seed-cuas-immobileyes.mts
 */
import { sql } from '@/lib/db';
import { publishAndFanOut } from '@/lib/opportunity-bridge';
import { resolveTopicCompliance } from '@/lib/compliance-resolver';
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import { createRequire } from 'module';
const require = createRequire('/home/user/govwin/frontend/');
const bcrypt = require('bcryptjs');

type Item = { name: string; type: string; pages?: number; notes?: string };
type Vol = { name: string; items: Item[]; notes?: string };

// The DoW 2026 SBIR CSO 6-volume structure, per the preface + topic.
const VOLUMES: Vol[] = [
  { name: 'Proposal Cover Sheet', notes: 'Volume 1 — DSIP cover sheet. Technical Abstract must indicate the C-UAS technology area of interest. SBC certifications (SBIR eligibility, size, etc.).', items: [
    { name: 'Proposal Cover Sheet & Technical Abstract', type: 'form_sbir_certs', notes: 'Indicate C-UAS tech area of interest; SBC certifications.' },
  ]},
  { name: 'Technical Volume', notes: 'Volume 2 — the 10-page white paper. Single PDF, single-column, single-spaced, 8.5x11, 1-inch margins, no font < 10pt. Header on each page: SBC name, topic number, DSIP proposal number. Resumes count toward the page limit.', items: [
    { name: 'Identification and Significance of the Problem or Opportunity', type: 'word_doc', pages: 2 },
    { name: 'Phase I Technical Objectives', type: 'word_doc', pages: 1 },
    { name: 'Phase I Statement of Work', type: 'word_doc', pages: 3 },
    { name: 'Related Work', type: 'word_doc', pages: 1 },
    { name: 'Relationship with Future Research or Research and Development', type: 'word_doc', pages: 1 },
    { name: 'Commercialization Strategy', type: 'word_doc', pages: 1 },
    { name: 'Key Personnel', type: 'word_doc', pages: 1 },
    { name: 'Foreign Citizens', type: 'word_doc', notes: 'Disclose FNs, country of origin, visa/work permit, SOW tasks (ITAR §3.5).' },
    { name: 'Facilities/Equipment', type: 'word_doc' },
    { name: 'Subcontractors/Consultants', type: 'word_doc' },
    { name: 'Prior, Current, or Pending Support of Similar Proposals or Awards', type: 'word_doc' },
    { name: "Assertion of Restrictions on the Government's Use/Release of Technical Data or Software", type: 'word_doc' },
  ]},
  { name: 'Cost Volume', notes: 'Volume 3 — DSIP cost volume form. Base and Option fully costed SEPARATELY. Key personnel hours as direct labor; equipment/materials/travel justified; subcontractor/consultant costs detailed. TABA costs (if any) included here.', items: [
    { name: 'Phase I Base Cost Proposal', type: 'spreadsheet', notes: '6-month base period of performance, NOT TO EXCEED $200,000.' },
    { name: 'Phase I Option Cost Proposal', type: 'spreadsheet', notes: '6-month option period, NOT TO EXCEED $115,000 (per topic). Cost separately from base.' },
  ]},
  { name: 'Company Commercialization Report', notes: 'Volume 4 — CCR from SBIR.gov Firm Forms. If no prior DoW/non-DoW SBIR/STTR awards, select NO (marked complete).', items: [
    { name: 'Company Commercialization Report (CCR)', type: 'form_other', notes: 'From SBIR.gov firm account → My Documents → CCR PDF.' },
  ]},
  { name: 'Supporting Documents', notes: 'Volume 5 — supports Volumes 1/2/3. Include only if applicable; verify Service/Component-specific requirements.', items: [
    { name: 'Foreign Nationals Disclosure (ITAR/EAR)', type: 'pdf', notes: 'FN country of origin, visa/work permit, SOW tasks (topic ITAR clause).' },
    { name: 'Letters of Support', type: 'pdf' },
    { name: 'DD Form 2345 — Militarily Critical Technical Data Agreement', type: 'pdf', notes: 'If applicable (§3.2).' },
    { name: 'Technical Data Rights Assertions', type: 'pdf' },
    { name: 'CMMC Level 2 (Self) Reps & Certifications', type: 'pdf', notes: 'Projected CMMC Level 2 (Self) per topic.' },
  ]},
  { name: 'Fraud, Waste, and Abuse Training', notes: 'Volume 6 — required FWA training certification (3-page PDF, reviewed annually).', items: [
    { name: 'Fraud, Waste, and Abuse Training Certification', type: 'form_other', notes: '3-page SBA/DoW FWA tutorial acknowledgement.' },
  ]},
];

const OBJECTIVE = 'The DON seeks innovative solutions to detect, track, identify, and neutralize single and swarm UAS threats in complex operational environments — providing the warfighter decisive C-UAS overmatch. Areas of interest include AI-powered target recognition, AI/ML swarm detection & anomaly analysis, non-/low-kinetic defeat of Group 1–2 UAS, and AI/ML for countering advanced signature management.';
const SUMMARY = 'NAVAIR/NAVSEA Counter-UAS Open Topic (CSO). Phase I: 6-mo base ≤ $200K + 6-mo option ≤ $115K. 10-page white paper, CMMC L2, ITAR. Fits AI sensor-fusion / C-UAS detect-track-defeat.';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

try {
  // ── Immobileyes tenant + admin (demo login: admin@immobileyes.test / DemoPass123!) ──
  const [tenant] = await sql<{ id: string; name: string; slug: string }[]>`
    INSERT INTO tenants (name, slug, status) VALUES ('Immobileyes', 'immobileyes', 'active')
    ON CONFLICT (slug) DO UPDATE SET status = 'active' RETURNING id, name, slug`;
  const hash = await bcrypt.hash('DemoPass123!', 10);
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
    VALUES ('admin@immobileyes.test', 'Immo Admin', 'tenant_admin', ${tenant.id}::uuid, ${hash}, true, false)
    ON CONFLICT (email) DO UPDATE SET role = 'tenant_admin', tenant_id = ${tenant.id}::uuid, password_hash = ${hash}, is_active = true, temp_password = false
    RETURNING id, email`;
  ok('Immobileyes tenant + admin ready', !!tenant && !!user, `${tenant.slug} / ${user.email}`);

  // ── Opportunity ──
  const [opp] = await sql<{ id: string }[]>`
    INSERT INTO opportunities
      (source, source_id, title, agency, office, org_unit, solicitation_number, program_type,
       topic_number, phase_type, tech_focus_areas, submission_stage, lifecycle_status,
       pre_release_date, open_date, close_date, posted_date, description, is_active)
    VALUES
      ('dsip', 'DON26BX03-NP002',
       'DON26BX03-NP002: NAVAIR & NAVSEA Open Topic for Counter Unmanned Air Systems (C-UAS)',
       'Navy', 'NAVAIR / NAVSEA', 'NAVAIR', 'DON26BX03', 'sbir_phase_1',
       'DON26BX03-NP002', 'phase_1', ${sql.array(['Counter-UAS (C-UAS)', 'Trusted AI and Autonomy', 'AI Sensor Fusion'])},
       'open', 'open',
       '2026-06-10'::timestamptz, '2026-07-08'::timestamptz, '2026-08-13'::timestamptz, '2026-06-10'::timestamptz,
       ${OBJECTIVE}, true)
    ON CONFLICT (source, source_id) DO UPDATE SET
      title = EXCLUDED.title, description = EXCLUDED.description, tech_focus_areas = EXCLUDED.tech_focus_areas,
      submission_stage = 'open', is_active = true, updated_at = now()
    RETURNING id`;
  const oppId = opp.id;

  // ── Solicitation + link ──
  await sql`DELETE FROM curated_solicitations WHERE opportunity_id = ${oppId}::uuid`;
  const [cs] = await sql<{ id: string }[]>`
    INSERT INTO curated_solicitations (opportunity_id, namespace, status, spotlight_summary, full_text)
    VALUES (${oppId}::uuid, 'navair-cuas', 'new', ${SUMMARY}, ${`DON26BX03-NP002 Counter-UAS (C-UAS) — NAVAIR/NAVSEA CSO Open Topic. ${OBJECTIVE}`})
    RETURNING id`;
  await sql`UPDATE opportunities SET solicitation_id = ${cs.id}::uuid WHERE id = ${oppId}::uuid`;

  // ── Compliance (the format contract) ──
  await sql`DELETE FROM solicitation_compliance WHERE solicitation_id = ${cs.id}::uuid`;
  await sql`INSERT INTO solicitation_compliance
    (solicitation_id, page_limit_technical, font_family, font_size, min_font_size, margins,
     submission_format, itar_required, images_tables_allowed, required_sections, required_documents)
    VALUES (${cs.id}::uuid, 10, 'Times New Roman', '10', 10, '1 inch (all sides)',
      'Single PDF white paper — 8.5x11, single-column, single-spaced, 1-inch margins, 10-pt minimum font. Page header: SBC name, topic number, DSIP proposal number.',
      true, true,
      ${sql.json(VOLUMES[1].items.map((i) => i.name))},
      ${sql.json(VOLUMES[4].items.map((i) => i.name))})`;

  // ── Skeleton (6 volumes → section molds) ──
  await sql`DELETE FROM volume_required_items WHERE volume_id IN (SELECT id FROM solicitation_volumes WHERE solicitation_id = ${cs.id}::uuid)`;
  await sql`DELETE FROM solicitation_volumes WHERE solicitation_id = ${cs.id}::uuid`;
  let totalItems = 0;
  for (let v = 0; v < VOLUMES.length; v++) {
    const vol = VOLUMES[v];
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO solicitation_volumes (solicitation_id, volume_number, volume_name, volume_format, expert_notes)
      VALUES (${cs.id}::uuid, ${v + 1}, ${vol.name}, 'dsip_standard', ${vol.notes ?? null}) RETURNING id`;
    let n = 0;
    for (const item of vol.items) {
      n++; totalItems++;
      await sql`INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required, page_limit, expert_notes)
                VALUES (${row.id}::uuid, ${String(n)}, ${item.name}, ${item.type}, true, ${item.pages ?? null}, ${item.notes ?? null})`;
    }
  }
  ok('CUAS opportunity + solicitation + compliance', !!oppId && !!cs.id);

  // Verify the skeleton resolves the way provision reads it.
  const resolved = await resolveTopicCompliance(oppId);
  const items = resolved.volumes.reduce((s, vv) => s + (vv.items?.length ?? 0), 0);
  ok('full skeleton resolves', resolved.volumes.length === 6 && items === totalItems, `${resolved.volumes.length} volumes, ${items} section molds, page cap ${(resolved.compliance as { pageLimitTechnical?: number }).pageLimitTechnical}`);

  // ── Publish the card (fans to all active tenants incl. Immobileyes) ──
  const res = await publishAndFanOut(oppId, 'published', null, new Date().toISOString());
  ok('CUAS card published', (res?.tenantsApplied ?? 0) >= 1, `fanned to ${res?.tenantsApplied ?? 0} tenant(s)`);

  // ── Dress-rehearse a full provision for Immobileyes → assert canvases → clean up ──
  const prov = await provisionProposalForPortal({
    tenantId: tenant.id, tenantName: tenant.name, tenantSlug: tenant.slug,
    opportunityId: oppId, label: 'cuas-rehearsal', actorId: user.id, actorEmail: user.email,
  });
  if ('error' in prov) {
    ok('dress-rehearsal provision', false, prov.error);
  } else {
    ok('dress-rehearsal provision → full build', prov.sectionCount === totalItems, `${prov.sectionCount} section canvases`);
    const [{ arts }] = await sql<{ arts: number }[]>`SELECT count(*)::int arts FROM proposal_artifacts WHERE proposal_id = ${prov.proposalId}::uuid`;
    const [{ mx }] = await sql<{ mx: number }[]>`SELECT count(*)::int mx FROM proposal_compliance_matrix WHERE proposal_id = ${prov.proposalId}::uuid`;
    ok('6 volume artifacts + full matrix', arts === 6 && mx === totalItems, `${arts} artifacts, ${mx} matrix rows`);
    await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id = ${prov.proposalId}::uuid`;
    await sql`DELETE FROM proposal_sections WHERE proposal_id = ${prov.proposalId}::uuid`;
    await sql`DELETE FROM proposal_artifacts WHERE proposal_id = ${prov.proposalId}::uuid`;
    await sql`DELETE FROM proposals WHERE id = ${prov.proposalId}::uuid`;
    console.log('  ↳ rehearsal proposal cleaned up (OPP left fresh for the HITL run)');
  }
  console.log(`\nCUAS skeleton: ${VOLUMES.length} volumes, ${totalItems} required items (12 white-paper sections + cost base/option + cover sheet + CCR + 5 supporting docs + FWA).`);
} finally {
  await sql.end();
}

console.log(`\n${failures === 0 ? '✅ IMMOBILEYES CUAS OPP READY — full 6-volume matrix + skeleton; release provisions the whole build' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
