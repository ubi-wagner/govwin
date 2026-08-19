import { sqlBypass as sql } from '@/lib/db';
const OPP='e84c5bd2-0a7e-487a-a1fd-c7dc76027f4c';
const SUMMARY='NAVAIR/NAVSEA Counter-UAS Open Topic (CSO). Phase I: single 4-month (120-day) period of performance, not to exceed $250,000. Deliverables: Kick-Off Briefing, Progress Report, Final Report and Initial Phase II Proposal — both due at 120 days. 10-page technical white paper, CMMC Level 2 (Self), ITAR-restricted.';
const cards=await sql`SELECT tenant_id AS "tenantId", card FROM tenant_opportunity_cards WHERE opportunity_id=${OPP}::uuid`;
for (const c of cards as any[]) {
  const cs = { ...(c.card.complianceSummary||{}),
    periodOfPerformance: '4 months (120 days)',
    phase: 'Phase I',
    ceiling: 250000,
    deliverables: ['Kick-Off Briefing','Progress Report','Final Report (Day 120)','Initial Phase II Proposal (Day 120)'] };
  const card = { ...c.card, spotlightSummary: SUMMARY, complianceSummary: cs };
  await sql`UPDATE tenant_opportunity_cards SET card=${sql.json(card)}, updated_at=now() WHERE opportunity_id=${OPP}::uuid AND tenant_id=${c.tenantId}::uuid`;
}
console.log('✓ updated', cards.length, 'cards → 120-day / 4-month / $250K Phase I');
await sql.end();
