/** Provision a real build off a real master and count what the buyer is actually shown.
 *
 * The claim under test, in one line: the master's SEVEN volumes must all be accounted for in the
 * buyer's proposal — some as sections they write, the rest as checklist rows telling them what to
 * file elsewhere and where. Before this change the buyer saw two of seven and the other five were
 * silently absent, so a build could reach "submission-ready" without a DD Form 2345, the SAM reps
 * & certs, the FWA training certificate or the foreign-affiliations disclosure.
 *
 * Runs the REAL provisionProposalForPortal against the sandbox DB — no mocks, no HTTP.
 *   cd frontend && . ../scripts/sandbox-env.sh && npx tsx scripts/probe-provision-elsewhere.mts
 */
import { sqlBypass } from '../lib/db';
import { provisionProposalForPortal } from '../lib/provision-proposal';
import { resolveTopicCompliance } from '../lib/compliance-resolver';
import { isAuthoredVolume, elsewhereRequirements, type ScopedVolume } from '../lib/provisioning/authored-scope';

const SOL = process.env.SOL_ID ?? 'bba0bd22-edd6-430c-a95b-7265742bac58';
let bad = 0;
const check = (ok: boolean, s: string, extra = '') => {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${s}${extra ? `  — ${extra}` : ''}`);
};

// ── the master ───────────────────────────────────────────────────────────────
const vols = await sqlBypass<Array<{ id: string; volumeNumber: number; volumeName: string; expertNotes: string | null; metadata: Record<string, unknown> | null; items: number }>>`
  SELECT sv.id, sv.volume_number AS "volumeNumber", sv.volume_name AS "volumeName",
         sv.expert_notes AS "expertNotes", sv.metadata,
         (SELECT count(*)::int FROM volume_required_items vri WHERE vri.volume_id = sv.id) AS items
  FROM solicitation_volumes sv WHERE sv.solicitation_id = ${SOL}::uuid ORDER BY sv.volume_number`;

console.log(`\nMASTER — ${vols.length} volumes`);
for (const v of vols) {
  console.log(`  V${v.volumeNumber}  ${String(v.items).padStart(2)} items  dsipOnly=${String(v.metadata?.dsipOnly ?? '—').padEnd(9)} ${v.volumeName.slice(0, 44)}`);
}

// ── what the rule says, before touching the DB ───────────────────────────────
const resolved = await resolveTopicCompliance(
  (await sqlBypass<Array<{ id: string }>>`SELECT id FROM opportunities WHERE solicitation_id = ${SOL}::uuid LIMIT 1`)[0].id,
);
console.log('\nTHE RULE, applied to this master');
let authoredCount = 0;
let elsewhereCount = 0;
for (const v of resolved.volumes) {
  const scoped = v as unknown as ScopedVolume;
  const authored = isAuthoredVolume(scoped);
  const rows = elsewhereRequirements(scoped);
  authoredCount += authored ? 1 : 0;
  elsewhereCount += rows.length;
  console.log(`  V${v.volumeNumber}  ${authored ? 'AUTHORED ' : 'elsewhere'}  ${String(rows.length).padStart(2)} checklist row(s)  ${v.volumeName.slice(0, 40)}`);
}
check(authoredCount + (resolved.volumes.length - authoredCount) === resolved.volumes.length, 'every volume is classified one way or the other');
check(elsewhereCount > 0, `the master yields ${elsewhereCount} completed-elsewhere requirement(s)`);

// ── provision it for real ────────────────────────────────────────────────────
const [cand] = await sqlBypass<Array<{ tenantId: string; tenantName: string; slug: string; opportunityId: string }>>`
  SELECT c.tenant_id AS "tenantId", t.name AS "tenantName", t.slug, c.opportunity_id AS "opportunityId"
  FROM tenant_opportunity_cards c
  JOIN tenants t ON t.id = c.tenant_id
  JOIN opportunities o ON o.id = c.opportunity_id
  WHERE o.solicitation_id = ${SOL}::uuid AND c.archived_at IS NULL
  ORDER BY t.slug LIMIT 1`;
if (!cand) { console.log('\n! no tenant holds this OPP — cannot provision'); process.exit(1); }

const [actor] = await sqlBypass<Array<{ id: string; email: string }>>`
  SELECT id, email FROM users WHERE email = 'eric@rfppipeline.com' LIMIT 1`;

console.log(`\nPROVISION a fresh build for ${cand.slug}`);
const res = await provisionProposalForPortal({
  tenantId: cand.tenantId, tenantName: cand.tenantName, tenantSlug: cand.slug,
  opportunityId: cand.opportunityId, label: 'portal-forms-probe',
  actorId: actor.id, actorEmail: actor.email,
});
if ('error' in res) { console.log(`  ✗ provision failed: ${res.error}`); process.exit(1); }
check(true, `provisioned ${res.sectionCount} section(s)`);

// ── what the buyer sees ──────────────────────────────────────────────────────
const pid = res.proposalId;
const [seen] = await sqlBypass<Array<{ n: number }>>`
  SELECT count(DISTINCT volume_number)::int AS n FROM proposal_sections WHERE proposal_id = ${pid}::uuid`;
const authoredRows = await sqlBypass<Array<{ text: string }>>`
  SELECT requirement_text AS text FROM proposal_compliance_matrix
  WHERE proposal_id = ${pid}::uuid AND section_id IS NOT NULL ORDER BY requirement_text`;
const elsewhereRows = await sqlBypass<Array<{ text: string; notes: string | null }>>`
  SELECT requirement_text AS text, notes FROM proposal_compliance_matrix
  WHERE proposal_id = ${pid}::uuid AND section_id IS NULL ORDER BY requirement_text`;

console.log(`\nWHAT THE BUYER SEES`);
console.log(`  volumes with sections to write : ${seen.n} of ${vols.length}`);
console.log(`  checklist rows — written here  : ${authoredRows.length}`);
console.log(`  checklist rows — filed elsewhere: ${elsewhereRows.length}`);
console.log('\n  filed elsewhere:');
for (const r of elsewhereRows) console.log(`    · ${r.text.slice(0, 50).padEnd(52)} ${String(r.notes ?? '').slice(0, 46)}`);

check(elsewhereRows.length === elsewhereCount, 'the build carries exactly the rows the rule predicted',
  `${elsewhereRows.length} vs ${elsewhereCount}`);
for (const must of ['DD Form 2345', 'Reps & Certifications', 'Fraud, Waste']) {
  check(elsewhereRows.some((r) => r.text.includes(must)), `still on the buyer's checklist: ${must}`);
}
check(elsewhereRows.every((r) => (r.notes ?? '').length > 0), 'every elsewhere row says WHERE it is completed');
check(elsewhereRows.every((r) => r.text.trim().length > 0), 'no elsewhere row has empty text');

// The item-less volume must produce a checklist row and NO blank section.
const emptyVol = vols.find((v) => v.items === 0);
if (emptyVol) {
  const blank = await sqlBypass<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM proposal_sections
    WHERE proposal_id = ${pid}::uuid AND volume_number = ${emptyVol.volumeNumber}`;
  check(blank[0].n === 0, `V${emptyVol.volumeNumber} (no items) stands up NO blank section for the drafter to fill`);
  check(elsewhereRows.some((r) => r.text === emptyVol.volumeName),
    `V${emptyVol.volumeNumber} appears on the checklist instead: "${emptyVol.volumeName.slice(0, 40)}"`);
}

// NOTHING MAY BE LOST — the whole point. Every master volume must reach the buyer somehow: as
// sections they write, or as checklist rows. Attribute per VOLUME, not by name: a volume that is
// completed elsewhere contributes rows named after its ITEMS ("DD Form 2345"), not after itself,
// so matching row text against the volume name would report a covered volume as missing.
const sectionVols = await sqlBypass<Array<{ volumeName: string | null; n: number }>>`
  SELECT volume_name AS "volumeName", count(*)::int AS n FROM proposal_sections
  WHERE proposal_id = ${pid}::uuid GROUP BY volume_name`;
const rowText = new Set(elsewhereRows.map((r) => r.text));
console.log('\n  coverage, volume by volume:');
const missing: string[] = [];
for (const v of resolved.volumes) {
  const written = sectionVols.find((s) => s.volumeName === v.volumeName)?.n ?? 0;
  const filed = elsewhereRequirements(v as unknown as ScopedVolume).filter((r) => rowText.has(r.text)).length;
  console.log(`    V${v.volumeNumber}  ${String(written).padStart(2)} section(s) + ${String(filed).padStart(2)} checklist row(s)  ${v.volumeName.slice(0, 40)}`);
  if (written === 0 && filed === 0) missing.push(`V${v.volumeNumber}`);
}
check(missing.length === 0, 'no master volume vanishes from the buyer\'s proposal', missing.join(', '));

// Clean up the probe build. agent_task_queue.proposal_id is a BLOCKING fk (unlike agent_task_log,
// which mig 199 gave ON DELETE SET NULL), so clear the queue first. The product never hard-deletes
// a proposal — archive is soft and reversible — so this ordering is a probe concern, not a gap.
await sqlBypass`DELETE FROM agent_task_results WHERE task_id IN (SELECT id FROM agent_task_queue WHERE proposal_id = ${pid}::uuid)`;
await sqlBypass`DELETE FROM agent_task_queue WHERE proposal_id = ${pid}::uuid`;
await sqlBypass`DELETE FROM proposals WHERE id = ${pid}::uuid`;
console.log(`\n  (probe build ${pid.slice(0, 8)} removed)`);

console.log(bad === 0 ? '\n✓ every required volume is accounted for — written here or filed elsewhere, with a note' : `\n✗ ${bad} check(s) failed`);
process.exit(bad === 0 ? 0 : 1);
