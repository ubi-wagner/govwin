/**
 * Prove the mandated-format hard blocker: a font below the RFP's stated minimum (min_font_size set on
 * the artifact's compliance_spec) must produce a HARD `format_floor` blocker and flip ready→false; a
 * compliant font clears it. Self-contained — creates + deletes its own temp artifact/section.
 *   DATABASE_URL=<owner conn> npx tsx scripts/verify-readiness-format.mts
 */
import { sql } from '@/lib/db';
import { computeSubmissionReadiness } from '@/lib/proposal/submission-readiness';

const PROP = 'd0000000-0000-4000-8000-000000000002'; // lock-fixture proposal (lighthouse)
const VOL = 'ZZTEST Format Volume';
const SEC = 'ZZTEST Format Section';
const canvas = (size: number) => JSON.stringify({
  version: 1,
  canvas: { format: 'letter', font_default: { family: 'Times New Roman', size: 12 } },
  nodes: [{ id: 'z1', type: 'text_block', content: { text: 'Body text for the font-floor check.' }, style: { size } }],
});
const spec = { min_font_size: 11, images_allowed: true, max_pages: null, max_slides: null, required_sections: [], header_required: false, footer_required: false };

async function cleanup() {
  await sql`DELETE FROM proposal_sections  WHERE proposal_id=${PROP}::uuid AND title=${SEC}`;
  await sql`DELETE FROM proposal_artifacts WHERE proposal_id=${PROP}::uuid AND volume_name=${VOL}`;
}

async function main() {
  const [p] = await sql<{ tenantId: string }[]>`SELECT tenant_id AS "tenantId" FROM proposals WHERE id=${PROP}::uuid`;
  if (!p) { console.error('fixture proposal missing — run seed_e2e_fixtures.mjs'); process.exit(1); }
  const tid = p.tenantId;
  let pass = true;
  const check = (l: string, c: boolean) => { console.log(`${c ? '✅' : '❌'} ${l}`); pass &&= c; };
  const fmt = (r: Awaited<ReturnType<typeof computeSubmissionReadiness>>) =>
    (r?.blockers ?? []).filter((b) => b.category === 'format_floor' && b.sectionTitle === SEC);

  await cleanup();
  const [art] = await sql<{ id: string }[]>`
    INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, format_spec, compliance_spec)
    VALUES (${PROP}::uuid, 9, ${VOL}, 'narrative', '{}'::jsonb, ${sql.json(spec)}) RETURNING id`;
  await sql`
    INSERT INTO proposal_sections (proposal_id, artifact_id, section_number, title, status, version, is_locked, content, volume_name)
    VALUES (${PROP}::uuid, ${art.id}::uuid, '99', ${SEC}, 'in_progress', 1, false, ${canvas(8)}, ${VOL})`;

  const bad = await computeSubmissionReadiness(PROP, tid);
  const b = fmt(bad);
  check('sub-minimum font → a format_floor blocker appears', b.length >= 1);
  check('it is HARD severity (blocker, not advisory)', b.length >= 1 && b.every((x) => x.severity === 'blocker'));
  check('the message names the font floor', b.some((x) => /below the .*minimum/i.test(x.message)));
  check('ready = false with a mandated-format violation', bad?.ready === false);
  check('summary.formatViolations counts it', (bad?.summary.formatViolations ?? 0) >= 1);

  await sql`UPDATE proposal_sections SET content=${canvas(12)} WHERE proposal_id=${PROP}::uuid AND title=${SEC}`;
  const good = await computeSubmissionReadiness(PROP, tid);
  check('compliant font → the format blocker for it clears', fmt(good).length === 0);

  await cleanup();
  console.log(pass ? '\n✅ MANDATED-FORMAT HARD-BLOCKER PROVEN' : '\n❌ FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
