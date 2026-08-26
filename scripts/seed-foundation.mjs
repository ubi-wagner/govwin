/**
 * Seed the FOUNDATION customer (3D-printed concrete formwork — the Entrepreneurs' Center
 * team from 3DCP_Final_Prez_1.pptx) end-to-end, idempotently:
 *   • tenant `foundation` (active, grinder)
 *   • 4 founder accounts (Kate CEO / Conor COO / Connor CFO / Will CTO) + memberships
 *   • Paul Jackson (EC) — partner_user, appointed by the company as a SHADOW ADMIN
 *     (tenant_admin membership, source='collaborator') so he sees buckets + pipeline
 *   • 5 Foundation-specific spotlight buckets (additive construction / adv-mfg / constr-tech /
 *     materials / non-dilutive) with real criteria
 *   • library_atoms from the deck (status='approved' so they surface in drafting)
 *   • backfill of every bridge opportunity into Foundation's card pipeline (TVSF + SBIRs)
 *   • tenant_bucket_scores for every (bucket × card) via a faithful port of
 *     lib/bucket-ranking.ts::scoreCard — the SBIRs ranked against Foundation's buckets
 *
 * Source of truth: docs/runbook-assets/fondation-tvs/FOUNDATION_PROFILE.md.
 * Requires DATABASE_URL (govtech_intel). Standalone (postgres driver + in-DB bcrypt), like
 * seed_dev_accounts.mjs / seed-e2e-hitl.mjs. Re-runnable (ON CONFLICT upserts).
 */
import postgres from 'postgres';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('[seed-foundation] FATAL: DATABASE_URL not set'); process.exit(1); }
const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

const TENANT = { slug: 'foundation', name: 'Foundation' };
const FOUNDERS = [
  { email: 'kate.ulepic@foundation3dp.com',  name: 'Kate Ulepic',  role: 'tenant_admin', title: 'CEO' },
  { email: 'conor.atkins@foundation3dp.com', name: 'Conor Atkins', role: 'tenant_user',  title: 'COO' },
  { email: 'connor.casey@foundation3dp.com', name: 'Connor Casey', role: 'tenant_user',  title: 'CFO' },
  { email: 'will.curley@foundation3dp.com',  name: 'Will Curley',  role: 'tenant_user',  title: 'CTO' },
];
const PARTNER = { email: 'pjackson@ecinnovates.com', name: 'Paul Jackson', org: "Entrepreneurs' Center" };

// 5 Foundation buckets. Keywords chosen against the opp card text (title+spotlightSummary+
// description+office). programTypes match the card.programType (sbir/sttr/tvsf).
const BUCKETS = [
  { name: 'Additive Construction & 3D Printing', description: 'Concrete 3D printing, additive construction, formwork automation — Foundation core.',
    criteria: { keywords: ['additive construction', '3d print', 'concrete print', 'concrete', 'printing', 'print', 'formwork'], useTimeline: true, weights: { keyword: 1, timeline: 0.5 } } },
  { name: 'Advanced Manufacturing & Automation', description: 'Advanced manufacturing, robotics and automated workflows.',
    criteria: { keywords: ['advanced manufacturing', 'automation', 'robotics', 'manufacturing', 'automated', 'robotic'], useTimeline: true, weights: { keyword: 1, timeline: 0.5 } } },
  { name: 'Construction Technology & Housing', description: 'Construction tech, the built environment, and housing affordability.',
    criteria: { keywords: ['construction', 'housing', 'built environment', 'building', 'home', 'builder'], useTimeline: true, weights: { keyword: 1, timeline: 0.5 } } },
  { name: 'Materials — Concrete & Low-Carbon Cement', description: 'Concrete/cement materials, incl. low-carbon mixes.',
    criteria: { keywords: ['concrete', 'cement', 'low-carbon', 'low carbon', 'materials', 'material'], useTimeline: true, weights: { keyword: 1, timeline: 0.5 } } },
  { name: 'Non-dilutive Capital (SBIR/STTR & State)', description: 'SBIR/STTR Phase I + state validation/commercialization grants — how Foundation funds R&D.',
    criteria: { keywords: ['sbir', 'sttr', 'grant', 'non-dilutive', 'phase i', 'startup', 'validation', 'commercialization'], programTypes: ['sbir', 'sttr', 'tvsf'], useTimeline: true, weights: { keyword: 1, program: 1.5, timeline: 0.5 } } },
];

// Library atoms distilled from the deck (structure/facts only; no proprietary prose).
const ATOMS = [
  { title: 'Foundation — company overview', vol: 'overview', kind: 'narrative',
    summary: 'Ohio pre-seed venture that 3D-prints residential foundation formwork; ~47% formwork cost + ~11 days saved on a 2,100 sq ft home.',
    content: 'Foundation is an Ohio pre-seed venture that 3D-prints the formwork for residential concrete foundations — printing the wall shape directly and eliminating the traditional build-strip-repair-clean formwork cycle. On a typical 2,100 sq ft single-family Ohio home it cuts foundation formwork labor from ~336 hours to ~25 and total formwork cost by ~47% (≈11 days saved). Stage: pre-seed, TRL 6–7.' },
  { title: 'Technology overview — print process + differentiators', vol: 'technical', kind: 'narrative',
    summary: 'Downloads plan → pumps concrete → lays layers; trolley moves lat/vert on rails; electric. Uses common local concrete (not mortar); external nozzle gate.',
    content: 'A build plan is downloaded to the printer; concrete is pumped into the machine and the nozzle lays it one layer at a time. A printing trolley moves laterally and vertically while the whole machine travels along runway rails; the system is electrically powered. Two differentiators: it uses common, locally sourced concrete (not a proprietary mortar), and an external gate controls material flow at the nozzle. Net: eliminates the build-strip-repair-clean cycle, ~311 labor hrs/home saved, ~47–50% lower production cost and ~60–65% lower material cost vs mortar-based printers.' },
  { title: 'Market — TAM/SAM/SOM + formwork wedge', vol: 'market', kind: 'narrative',
    summary: 'TAM $410B (2026 housing), SAM $23.7B (SF-newbuild formwork), SOM $27.4M; ~500k supply gap; foundation 3D printing cuts total home cost ~4%.',
    content: 'The 2026 U.S. housing market is a $410B TAM against a ~500,000-home supply/demand gap; "locked-in" 6% mortgages push builders toward new-build "buy-down" economics. Foundation targets the formwork line item of single-family new builds — a $23.7B SAM — with a near-term $27.4M SOM in its regional beachhead. Foundation 3D printing lowers total home cost ~4% while removing the most labor-intensive, waste-prone step.' },
  { title: 'Competitive analysis — vs Traditional / Vitruvian / COBOD', vol: 'competitive', kind: 'narrative',
    summary: 'Foundation is the only option combining local-material accessibility + lowest project cost with rapid, scalable, repeatable deployment.',
    content: 'Across Time, Deployment, Material Accessibility, Project Costs, Scalability, and Repeatable Workflow, Foundation wins where adoption is decided. Traditional formwork is slow and labor-heavy; Vitruvian and COBOD depend on costly proprietary mortar and lack local-material accessibility and lowest project cost. Foundation uniquely combines local-material accessibility and lowest project cost with rapid, scalable, repeatable deployment.' },
  { title: 'Development stage & timeline (TRL 6–7)', vol: 'technical', kind: 'narrative',
    summary: 'TRL 6–7; beta prototype in progress; 14-month Gantt through third-party validation + first printer build. MVP: rapid deploy, reduced labor, structural reliability, local materials.',
    content: 'The technology is at TRL 6–7: delivery, nozzle-gate, and gantry-motion subsystems are demonstrated; the team is building a beta prototype for a relevant application environment. MVP customer requirements: rapid deployment, reduced labor, structural reliability, and locally sourced materials. A 14-month plan spans Grants+Funding, Product R&D, Beta Prototype, Design Finalization, Third-Party Performance Validation, and First Printer Build.' },
  { title: 'Intellectual property — 2 issued patents', vol: 'ip', kind: 'narrative',
    summary: 'U.S. Patents 11,273,574 (Scalable 3D Printing Apparatus) and 10,307,959 B2 (Concrete Delivery System).',
    content: 'Foundation is anchored by two issued U.S. patents: 11,273,574 ("Scalable Three-Dimensional Printing Apparatus") covering the scalable gantry/print architecture, and 10,307,959 B2 ("Concrete Delivery System") covering the concrete-delivery and nozzle-control mechanism — protecting the rail-scalable printer and the externally gated, local-concrete delivery path.' },
  { title: 'Business model & financials', vol: 'business', kind: 'narrative',
    summary: 'JV per project; charge per cubic yard; ≈$20k/job; ≈37.5% contribution margin. Raise: $200k TVSF + $150k SBIR + $1.8M+ equity; pre-seed.',
    content: 'Foundation forms a joint venture per project, programs and prepares the print, and charges per cubic yard of concrete placed — ≈$20,000 per job at ≈37.5% contribution margin ("printing as a service"). The capital plan pairs $200k TVSF and $150k SBIR Phase I (non-dilutive, for R&D + the beta prototype) with a targeted $1.8M+ equity round; the grants de-risk the technology and prove the market so the equity round is priced on validated performance.' },
  { title: 'Project plan & milestones', vol: 'plan', kind: 'narrative',
    summary: 'Hire (Mo1-2 $10k) → R&D w/ Converge (Mo3-4 $190k) → beta prototype (Mo6-8) → third-party validation (Mo9-14 $30k) → first printer build (Mo11-14 $300k).',
    content: 'Milestones: (1) Hire core team, Months 1–2, $10k; (2) R&D with Converge — engineer the beta printer + delivery/gate, Months 3–4, $190k; (3) Beta prototype build, Months 6–8; (4) Third-party performance validation — independent structural + throughput test, Months 9–14, ~$30k; (5) First printer build — production-representative unit for pilots, Months 11–14, ~$300k (blended grant/VC).' },
  { title: 'Team / management', vol: 'team', kind: 'bio',
    summary: 'Kate Ulepic CEO, Conor Atkins COO, Connor Casey CFO, Will Curley CTO. Gaps: legal advisor, fundraiser, technician, homebuilder. EC-mentored (Paul Jackson).',
    content: 'Kate Ulepic (CEO) leads strategy and fundraising; Conor Atkins (COO) owns operations and print execution; Connor Casey (CFO) owns finance and the capital plan; Will Curley (CTO) owns the printer and delivery technology. Known gaps being recruited: legal advisor, fundraiser, technician, and homebuilder partner. Mentored through the Entrepreneurs’ Center (Paul Jackson, VP Strategic Programs).' },
  { title: 'Budget basis — TVSF $200k by spend type', vol: 'cost', kind: 'budget_data',
    summary: 'Personnel $40k, Equipment $120k, Supplies $10k, Purchased Services $30k = $200k. Bulk = equipment (COTS+parts) + Converge services.',
    content: 'TVSF request is $200,000 of OTF Project Funds: Personnel $40,000 (founding-team time + first technical hire), Equipment $120,000 (COTS + specialized printer/delivery parts for the beta prototype), Supplies $10,000 (concrete + consumables for prototype tests), Purchased Services $30,000 (Converge development services + a software-development partner). Total $200,000.' },
];

// ── faithful port of frontend/lib/bucket-ranking.ts::scoreCard ──────────────
function scoreCard(card, criteria, nowMs) {
  const w = criteria.weights ?? {};
  const parts = [];
  const text = [card.title, card.spotlightSummary, card.description, card.office].filter(Boolean).join(' ').toLowerCase();
  if (criteria.keywords?.length) {
    const hits = criteria.keywords.filter((k) => k && text.includes(k.toLowerCase())).length;
    parts.push({ key: 'keyword', v: hits / criteria.keywords.length, weight: w.keyword ?? 1 });
  }
  if (criteria.naics?.length) {
    const cn = new Set((card.naicsCodes ?? []).map((n) => String(n)));
    const inter = criteria.naics.filter((n) => cn.has(String(n))).length;
    parts.push({ key: 'naics', v: inter / criteria.naics.length, weight: w.naics ?? 1 });
  }
  if (criteria.agencies?.length) {
    const a = (card.agency ?? '').toLowerCase();
    parts.push({ key: 'agency', v: criteria.agencies.some((x) => a.includes(x.toLowerCase())) ? 1 : 0, weight: w.agency ?? 1 });
  }
  if (criteria.programTypes?.length) {
    const p = (card.programType ?? '').toLowerCase();
    parts.push({ key: 'program', v: criteria.programTypes.some((x) => p === x.toLowerCase()) ? 1 : 0, weight: w.program ?? 1 });
  }
  if (criteria.useAccessibility && criteria.setAsides?.length) {
    const s = (card.setAsideType ?? '').toLowerCase();
    parts.push({ key: 'accessibility', v: criteria.setAsides.some((x) => s.includes(x.toLowerCase())) ? 1 : 0, weight: w.accessibility ?? 1 });
  }
  if (criteria.useTimeline !== false && card.closeDate) {
    const days = (new Date(card.closeDate).getTime() - nowMs) / 86_400_000;
    const v = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 0.6 : days <= 90 ? 0.3 : 0.1;
    parts.push({ key: 'timeline', v, weight: w.timeline ?? 0.5 });
  }
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  const score = totalW > 0 ? Math.round((100 * parts.reduce((s, p) => s + p.v * p.weight, 0)) / totalW) : 0;
  const factors = {};
  for (const p of parts) factors[p.key] = Math.round(p.v * 100);
  return { score, factors };
}

// backfill bridge head → tenant cards (inlined; same as seed_dev_accounts.mjs)
async function backfillTenantCards(tenantId) {
  const heads = await sql`
    SELECT DISTINCT ON (opportunity_id) id, opportunity_id, version, event_type, card
    FROM opportunity_bridge ORDER BY opportunity_id, version DESC`;
  let applied = 0;
  for (const h of heads) {
    const card = h.card; if (!card) continue;
    const STAGES = ['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived'];
    const stage = STAGES.includes(card.submissionStage) ? card.submissionStage
      : h.event_type === 'closed' ? 'closed' : h.event_type === 'archived' ? 'archived'
      : h.event_type === 'reopened' ? 'open' : card.lifecycleStatus === 'archived' ? 'archived'
      : card.lifecycleStatus === 'closed' ? 'closed' : 'open';
    const lifecycle = stage === 'closed' ? 'closed' : stage === 'archived' ? 'archived' : 'open';
    await sql`
      INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage)
      VALUES (${tenantId}::uuid, ${h.opportunity_id}::uuid, ${sql.json(card)}, ${h.version}, ${lifecycle}, ${stage})
      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
        card = EXCLUDED.card, bridge_version = EXCLUDED.bridge_version,
        lifecycle_status = EXCLUDED.lifecycle_status, submission_stage = EXCLUDED.submission_stage, updated_at = now()`;
    applied++;
  }
  return applied;
}

async function upsertUser({ email, name, role, tenantId }) {
  const e = email.toLowerCase().trim();
  await sql`
    INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
    VALUES (${e}, ${name}, ${role}, ${tenantId}::uuid, crypt(${PW}, gen_salt('bf', 12)), true, false)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
      tenant_id = EXCLUDED.tenant_id, password_hash = EXCLUDED.password_hash,
      is_active = true, temp_password = false, updated_at = now()`;
  const [u] = await sql`SELECT id FROM users WHERE email = ${e} LIMIT 1`;
  return u.id;
}

async function run() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  // 1) tenant
  const [tenant] = await sql`
    INSERT INTO tenants (slug, name, status, product_tier, lifecycle_stage)
    VALUES (${TENANT.slug}, ${TENANT.name}, 'active', 'grinder', 'customer')
    ON CONFLICT (slug) DO UPDATE SET status='active', product_tier='grinder', lifecycle_stage='customer', archived_at=NULL, updated_at=now()
    RETURNING id`;
  const tid = tenant.id;
  console.log(`✓ tenant '${TENANT.slug}' (${tid})`);

  // 2) founders + memberships (home)
  let kateId = null;
  for (const f of FOUNDERS) {
    const uid = await upsertUser({ email: f.email, name: f.name, role: f.role, tenantId: tid });
    await sql`
      INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
      VALUES (${uid}::uuid, ${tid}::uuid, ${f.role}, 'active', 'home')
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role=EXCLUDED.role, status='active'`;
    if (f.title === 'CEO') kateId = uid;
    console.log(`✓ ${f.role.padEnd(12)} ${f.name} (${f.title}) ${f.email}`);
  }

  // 3) Paul Jackson — EC mentor appointed SHADOW ADMIN of Foundation.
  //
  // DO NOT DEMOTE HIM. This used to write `role: 'tenant_admin', tenantId: null`, which was right
  // when it was written (migration 141 elevated him off partner_user so buckets and download would
  // stop 403-ing) and became wrong when the partner-manager landed: migration 157 makes Paul a
  // `partner_admin` and 159 gives him the Entrepreneurs' Center as his own partner_org home. Running
  // this seed afterwards reset BOTH — role back to tenant_admin and tenant_id back to NULL — so
  // /partner failed its `canManagePartnerTenants` gate and redirected instead of rendering, and
  // hitl-cc-actors / hitl-cc-partner failed on a missing "Partner Console" heading. Nothing was
  // wrong with the console; the seed had walked his identity backwards.
  //
  // The end state the migrations define, which this now reproduces on a bare box too:
  //   users.role = partner_admin, users.tenant_id = entrepreneurs-center (his own org)
  //   membership @ entrepreneurs-center = tenant_admin/home   (he builds via the tested portal)
  //   membership @ foundation           = tenant_admin/collaborator  (the descend target)
  const [ec] = await sql`SELECT id FROM tenants WHERE slug = 'entrepreneurs-center' LIMIT 1`;
  const paulId = await upsertUser({ email: PARTNER.email, name: PARTNER.name, role: 'partner_admin', tenantId: ec?.id ?? null });
  if (ec) {
    await sql`
      INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
      VALUES (${paulId}::uuid, ${ec.id}::uuid, 'tenant_admin', 'active', 'home', ${paulId}::uuid)
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='tenant_admin', status='active', source='home'`;
  }
  await sql`
    INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
    VALUES (${paulId}::uuid, ${tid}::uuid, 'tenant_admin', 'active', 'collaborator', ${kateId}::uuid)
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role='tenant_admin', status='active', source='collaborator'`;
  // Foundation is his first owned company, so it shows in his stable (migration 157 step 4).
  await sql`UPDATE tenants SET owner_id = ${paulId}::uuid WHERE id = ${tid}::uuid AND owner_id IS NULL`;
  console.log(`✓ partner-manager  ${PARTNER.name} (${PARTNER.org}) ${PARTNER.email} → partner_admin${ec ? ' @ entrepreneurs-center' : ''}, tenant_admin in foundation`);

  // 4) buckets (deactivate any prior, then upsert the 5 Foundation buckets)
  //
  // LOOK BEFORE INSERTING. This used to read `INSERT … ON CONFLICT DO NOTHING RETURNING id` with a
  // recover-by-name fallback, which looks idempotent and is not: tenant_spotlight_buckets has no
  // unique on (tenant_id, name), so an untargeted ON CONFLICT has nothing to conflict ON — every
  // run inserted a fresh row, RETURNING found it, and the fallback never ran. Four runs left
  // Foundation with 4 copies of each of its 5 buckets, and since this seed is now part of the e2e
  // globalSetup that would grow on every suite run until it tripped the per-tenant bucket cap and
  // broke hitl-bucket-rls for a reason that has nothing to do with the product.
  await sql`UPDATE tenant_spotlight_buckets SET is_active=false WHERE tenant_id=${tid}::uuid`;
  const bucketRows = [];
  for (const b of BUCKETS) {
    const [existing] = await sql`
      SELECT id FROM tenant_spotlight_buckets
      WHERE tenant_id = ${tid}::uuid AND name = ${b.name} ORDER BY created_at LIMIT 1`;
    let bid = existing?.id;
    if (bid) {
      await sql`UPDATE tenant_spotlight_buckets
                   SET description = ${b.description}, criteria = ${sql.json(b.criteria)}, is_active = true
                 WHERE id = ${bid}::uuid`;
    } else {
      const [row] = await sql`
        INSERT INTO tenant_spotlight_buckets (tenant_id, name, description, criteria, is_active, created_by)
        VALUES (${tid}::uuid, ${b.name}, ${b.description}, ${sql.json(b.criteria)}, true, ${kateId}::uuid)
        RETURNING id`;
      bid = row.id;
    }
    bucketRows.push({ id: bid, name: b.name, criteria: b.criteria });
  }
  console.log(`✓ ${bucketRows.length} spotlight buckets`);

  // 5) library atoms (approved so they surface in drafting) + vol/kind tags
  await sql`DELETE FROM library_atoms WHERE tenant_id=${tid}::uuid AND source='upload'`;
  for (const a of ATOMS) {
    const [row] = await sql`
      INSERT INTO library_atoms (tenant_id, grain, title, content, summary, status, visibility, source, creator_kind, created_by, word_count, char_count)
      VALUES (${tid}::uuid, 'primitive', ${a.title}, ${a.content}, ${a.summary}, 'approved', 'tenant', 'upload', 'admin', ${kateId}::uuid, ${a.content.split(/\s+/).length}, ${a.content.length})
      RETURNING id`;
    for (const [dim, val] of [['vol', a.vol], ['kind', a.kind], ['program', 'tvsf']]) {
      await sql`INSERT INTO atom_tags (atom_id, dimension, value, tag_source, confirmed) VALUES (${row.id}::uuid, ${dim}, ${val}, 'admin', true) ON CONFLICT DO NOTHING`;
    }
  }
  console.log(`✓ ${ATOMS.length} library atoms (approved)`);

  // 6) backfill cards (TVSF + SBIRs) then score every (bucket × card)
  const cards = await backfillTenantCards(tid);
  console.log(`✓ ${cards} opportunity cards backfilled`);
  const nowMs = Date.now();
  const cardRows = await sql`SELECT opportunity_id, card FROM tenant_opportunity_cards WHERE tenant_id=${tid}::uuid AND lifecycle_status='open'`;
  let scored = 0;
  for (const b of bucketRows) {
    for (const c of cardRows) {
      const { score, factors } = scoreCard(c.card ?? {}, b.criteria, nowMs);
      await sql`
        INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score, factors)
        VALUES (${tid}::uuid, ${b.id}::uuid, ${c.opportunity_id}::uuid, ${score}, ${sql.json(factors)})
        ON CONFLICT (tenant_id, bucket_id, opportunity_id) DO UPDATE SET score=EXCLUDED.score, factors=EXCLUDED.factors, computed_at=now()`;
      scored++;
    }
  }
  console.log(`✓ ${scored} bucket scores (${bucketRows.length} buckets × ${cardRows.length} cards)`);

  // Report: top-3 opps by best bucket score
  const ranked = await sql`
    SELECT (c.card->>'title') AS title, (c.card->>'programType') AS program, max(s.score) AS best
    FROM tenant_opportunity_cards c JOIN tenant_bucket_scores s
      ON s.tenant_id=c.tenant_id AND s.opportunity_id=c.opportunity_id
    WHERE c.tenant_id=${tid}::uuid GROUP BY 1,2 ORDER BY best DESC`;
  console.log('\n  Ranked opportunities (best bucket score):');
  for (const r of ranked) console.log(`   ${String(r.best).padStart(3)}  [${(r.program||'').padEnd(4)}] ${r.title}`);

  console.log('\n───── Foundation seeded ─────');
  console.log(`  login password (all): ${PW}`);
  console.log(`  tenant slug: ${TENANT.slug}   id: ${tid}`);
  for (const f of FOUNDERS) console.log(`   ${f.title.padEnd(4)} ${f.email}`);
  console.log(`   PARTNER/SHADOW-ADMIN  ${PARTNER.email}`);
}

run().then(() => sql.end().then(() => process.exit(0)))
  .catch((e) => { console.error(e); sql.end().then(() => process.exit(1)); });
