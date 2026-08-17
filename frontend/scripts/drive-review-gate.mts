// Live proof of the P0a review-gate: materializeSkeleton must NOT make anything customer-visible
// when publish=false (a build for review), only when publish=true (the reviewed push path), and a
// re-ingest (publish=false) must never downgrade an already-live opp. Owner conn; cleans up.
import { sqlBypass } from '@/lib/db';
import { materializeSkeleton } from '@/lib/ingest/materialize';
import type { ParsedSolicitation } from '@/lib/ingest/skeleton';

const ok = (b: boolean) => (b ? '✅' : '❌');
const tag = `gate-test-${Math.abs(Date.now() % 1_000_000)}`;

// Throwaway umbrella opportunity (staged: not live) + its curated solicitation.
const [umb] = await sqlBypass<Array<{ id: string }>>`
  insert into opportunities (source, source_id, title, submission_stage, lifecycle_status, is_active)
  values ('test', ${tag + '-umb'}, 'GATE-TEST umbrella', 'pre_release', 'open', false)
  returning id`;
const [csol] = await sqlBypass<Array<{ id: string }>>`
  insert into curated_solicitations (opportunity_id, namespace, status)
  values (${umb.id}::uuid, ${tag}, 'new') returning id`;

const parsed: ParsedSolicitation = {
  source: 'test', compliance: {},
  volumes: [{ name: 'Technical Volume', format: 'dsip_standard', items: [{ name: 'Narrative', type: 'word_doc' }] }],
  topics: [{ code: tag + '-T1', title: 'GATE-TEST topic', closeDate: '2027-01-01' }],
} as ParsedSolicitation;

// materializeSkeleton inserts each topic as source='ingest', source_id=<topic code>. With topics
// present the umbrella is NOT the card — the TOPIC opp is what publishes — so we assert on the topic.
const state = async () => {
  const [t] = await sqlBypass<Array<{ id: string; isActive: boolean }>>`select id, is_active as "isActive" from opportunities where source='ingest' and source_id=${tag + '-T1'}`;
  const [{ cards }] = await sqlBypass<Array<{ cards: number }>>`
    select count(*)::int as cards from tenant_opportunity_cards where opportunity_id = ${t?.id ?? umb.id}::uuid`;
  return { topicActive: t?.isActive, cards };
};

try {
  // 1) BUILD (publish=false) — nothing goes live
  await materializeSkeleton(csol.id, parsed, { publish: false, nowIso: new Date().toISOString() });
  let s = await state();
  console.log(`build  (publish=false): topicActive=${s.topicActive} cards=${s.cards}`);
  console.log(`${ok(s.topicActive === false && s.cards === 0)} review-gate holds — the built opportunity is NOT active and NO customer cards exist\n`);

  // 2) PUBLISH (publish=true) — the reviewed release path activates
  await materializeSkeleton(csol.id, parsed, { publish: true, nowIso: new Date().toISOString() });
  s = await state();
  console.log(`push   (publish=true):  topicActive=${s.topicActive} cards=${s.cards}`);
  console.log(`${ok(s.topicActive === true)} release activates the opportunity (cards fan out to any matching tenants)\n`);

  // 3) RE-INGEST (publish=false) — must NOT downgrade an already-live opp
  await materializeSkeleton(csol.id, parsed, { publish: false, nowIso: new Date().toISOString() });
  s = await state();
  console.log(`re-build(publish=false): topicActive=${s.topicActive}`);
  console.log(`${ok(s.topicActive === true)} OR-preserve — a re-ingest never pulls a live opportunity\n`);
} finally {
  const [t] = await sqlBypass<Array<{ id: string }>>`select id from opportunities where source='ingest' and source_id=${tag + '-T1'}`;
  const ids = [umb.id, ...(t ? [t.id] : [])];
  await sqlBypass`delete from tenant_opportunity_cards where opportunity_id = any(${ids}::uuid[])`;
  await sqlBypass`delete from opportunity_bridge where opportunity_id = any(${ids}::uuid[])`;
  await sqlBypass`delete from tenant_bucket_scores where opportunity_id = any(${ids}::uuid[])`;
  await sqlBypass`delete from solicitation_compliance where solicitation_id=${csol.id}::uuid`;
  await sqlBypass`delete from volume_required_items where volume_id in (select id from solicitation_volumes where solicitation_id=${csol.id}::uuid)`;
  await sqlBypass`delete from solicitation_volumes where solicitation_id=${csol.id}::uuid`;
  await sqlBypass`delete from curated_solicitations where id=${csol.id}::uuid`;
  await sqlBypass`delete from opportunities where id = any(${ids}::uuid[])`;
  console.log('cleanup: removed throwaway solicitation + opportunities + cards');
}
process.exit(0);
