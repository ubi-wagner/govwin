/** Seed a few PENDING (unresolved) scout candidates + classify them, so the /admin/scouts
 *  candidate review→release queue renders real rows for a screenshot. Idempotent.
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/seed-scout-candidates.mts */
import postgres from 'postgres';
import { randomUUID, createHash } from 'crypto';
import { classifyFinding } from '@/lib/scout/candidates';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
const ACTOR = { actorId: '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d', actorEmail: 'eric@rfppipeline.com' };

const SEEDS: Array<{ title: string; raw: Record<string, unknown> }> = [
  { title: 'Cislunar Autonomous Refueling — Broad Agency Announcement',
    raw: { agency: 'Space Force', solicitation_number: 'USSF-CLAR-26', source: 'sam_gov', source_id: 'USSF-CLAR-26',
      description: 'USSF BAA for autonomous in-space cryogenic refueling of cislunar assets.', url: 'https://sam.gov/opp/clar26' } },
  { title: 'TVSF Round 45 — Amendment: budget cap increased, deadline extended',
    raw: { agency: 'Ohio Third Frontier', solicitation_number: 'TVSF-R45-818079',
      description: 'Round 45 update: award ceiling raised to $150k; submissions accepted 30 additional days.', url: 'https://ohiotvsf.org/r45-amend' } },
  { title: 'Advanced Thermal Protection Materials — refreshed topic',
    raw: { agency: 'Department of the Air Force',
      description: 'AF topic re-posted with revised TRL entry requirements for hypersonic TPS.', url: 'https://dodsbirsttr.mil/af-tps' } },
];

let n = 0;
for (const s of SEEDS) {
  const dedup = createHash('sha256').update(`seed176:${s.title}`).digest('hex');
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO scout_findings (id, source_id, purpose, kind, title, url, snippet, status, dedup_hash, raw)
    VALUES (${randomUUID()}::uuid, NULL, 'opportunity', 'update', ${s.title}, ${s.raw.url as string},
            ${(s.raw.description as string).slice(0, 500)}, 'new', ${dedup}, ${sql.json(s.raw)})
    ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO UPDATE
      SET status='new', released_kind=NULL, released_ref=NULL, reviewed_at=NULL
    RETURNING id`;
  const r = await classifyFinding(row.id, ACTOR);
  console.log(`  seeded+classified: ${s.title.slice(0, 46)}… → ${'error' in r ? r.error : r.classification}`);
  n++;
}
console.log(`✓ ${n} pending candidates ready in the queue`);
await sql.end();
