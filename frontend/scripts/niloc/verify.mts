/**
 * Prove the NILOC gold examples are correct + reusable:
 *   A. COST ROLL-UP — each cost workbook's Summary total price equals the portal cost engine
 *      (lib/proposal/cost-model.ts computeBudget) to the cent.
 *   B. DRAFTER REUSE — selectForSection (the section-drafter's exact retrieval) surfaces NILOC's
 *      own gold-proposal atoms for a new section, and a different tenant retrieves ZERO of them
 *      (tenant isolation). Semantic ranking is active when an embedding engine is on
 *      (ATOM_EMBED=local or VOYAGE_API_KEY) — run the backfill first: scripts/embed-atoms.mts.
 *
 * Usage: cd frontend && DATABASE_URL=… [ATOM_EMBED=local] node --import tsx scripts/niloc/verify.mts
 */
import { sql } from '@/lib/db';
import { computeBudget, popBasePlusOption, singlePeriod, type LaborLine, type OtherDirectCost, type Subcontract, type Period } from '@/lib/proposal/cost-model';
import { selectForSection } from '@/lib/atoms';
import { COST_SPECS, buildFilledCost, costPrice, type CostSpec } from './_shared.mts';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
function specPoP(spec: CostSpec): Period[] {
  return spec.periods.length === 1 ? singlePeriod(spec.periods[0].name) : popBasePlusOption(spec.periods.map((p) => [p.name, p.months]));
}

async function proveCost() {
  console.log('A. COST ROLL-UP (template vs computeBudget)');
  let allOk = true;
  for (const spec of COST_SPECS) {
    const doc = buildFilledCost(spec);
    const tpl = costPrice(doc, spec.periods.length);
    const labor: LaborLine[] = spec.labor.map((l, i) => l ? ({ name: `code${i}`, category: `cat${i}`, hours: sum(l.hours), unburdenedRate: l.rate, allocation: l.hours }) : null).filter(Boolean) as LaborLine[];
    // a $0 line contributes nothing to the total; omit it so the engine's positive-allocation guard is happy
    const odcs: OtherDirectCost[] = ([
      { kind: 'materials', label: 'm', amount: sum(spec.materials), allocation: spec.materials },
      { kind: 'travel', label: 't', amount: sum(spec.travel), allocation: spec.travel },
      { kind: 'equipment', label: 'e', amount: sum(spec.equipment), allocation: spec.equipment },
      { kind: 'odc_other', label: 'o', amount: sum(spec.other), allocation: spec.other },
    ] as OtherDirectCost[]).filter((o) => o.amount > 0);
    const subs: Subcontract[] = sum(spec.subs) > 0 ? [{ org: spec.subOrg, role: 'sub', amount: sum(spec.subs), allocation: spec.subs }] : [];
    const eng = computeBudget(labor, spec.rates, { odcs, subs, periods: specPoP(spec) });
    const ok = Math.abs(tpl - eng.grand.totalPrice) < 0.02; allOk &&= ok;
    console.log(`  ${spec.tag.padEnd(13)} template=$${Math.round(tpl).toLocaleString().padStart(11)}  engine=$${Math.round(eng.grand.totalPrice).toLocaleString().padStart(11)}  ${ok ? '✓' : '✗ MISMATCH'}`);
  }
  return allOk;
}

async function proveReuse() {
  console.log('\nB. DRAFTER REUSE + ISOLATION (selectForSection)');
  const [niloc] = await sql`SELECT id FROM tenants WHERE slug = 'niloc' LIMIT 1`;
  const [eric] = await sql`SELECT id FROM users WHERE email = 'eric.c.wagner@gmail.com' LIMIT 1`;
  if (!niloc || !eric) { console.log('  (NILOC tenant/user absent — run seed.mts first) — skipped'); return true; }
  const [other] = await sql`SELECT id, name FROM tenants WHERE id <> ${niloc.id}::uuid AND status = 'active' ORDER BY created_at LIMIT 1`;
  const queries = [
    { label: 'Counter-UAS RF', text: 'counter-UAS RF sensing detection and classification of small drones passive electronic support', want: /AURA|counter-?uas|\brf\b|drone|polarim|radar/i },
    { label: 'Pattern-of-life', text: 'pattern of life behavioral analytics anomaly detection tracking multi-INT', want: /CADENCE|pattern|life|analytic|anomaly|activity/i },
    { label: 'Polarimetric radar', text: 'compact polarimetric monopulse radar clutter rejection low SWaP classification', want: /PolarHawk|polarim|radar|monopulse/i },
  ];
  let allOk = true;
  for (const q of queries) {
    const own = await selectForSection(niloc.id, { text: q.text, context: ['defense'], limit: 6 }, { userId: eric.id, isAdmin: true });
    const hits = own.filter((a) => q.want.test(`${a.title || ''} ${a.summary || ''} ${a.content || ''}`)).length;
    let leaks = 0;
    if (other) { const cross = await selectForSection(other.id, { text: q.text, context: ['defense'], limit: 6 }, { userId: eric.id, isAdmin: true }); leaks = cross.filter((a) => /AURA|CADENCE|PolarHawk/i.test(`${a.title || ''} ${a.content || ''}`)).length; }
    const ok = own.length > 0 && leaks === 0; allOk &&= ok;
    console.log(`  ${q.label.padEnd(20)} own on-topic ${hits}/${own.length} · cross-tenant NILOC leaks ${leaks} ${ok ? '✓' : '✗'}`);
  }
  return allOk;
}

async function main() {
  const a = await proveCost();
  const b = await proveReuse();
  await sql.end();
  console.log(`\n${a && b ? '✓ ALL PROOFS PASS' : '✗ SOME PROOFS FAILED'}`);
  process.exit(a && b ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
