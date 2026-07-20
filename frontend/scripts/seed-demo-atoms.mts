/** Seed demo library atoms for Acme so the library curation surface populates (#105). */
import { sql } from '@/lib/db';
import { createAtom } from '@/lib/atoms';

const TENANT = '2f648f93-8b49-405c-a6c3-8c4ddda517df'; // acme-navy-systems
const ADMIN = '273e4a03-9019-4057-8102-98c7e7cd6097'; // admin@acme-navy.test

interface Seed { title: string; summary: string; content: string; status: 'draft' | 'approved'; source: 'upload' | 'harvest'; tags: Array<{ dimension: string; value: string }>; }

const ATOMS: Seed[] = [
  { title: 'Past Performance — NAVSEA C-UAS Integration', status: 'approved', source: 'upload',
    summary: 'Prime on a $2.4M NAVSEA counter-UAS sensor-fusion effort; delivered on schedule.',
    content: 'Acme served as prime integrator on a NAVSEA counter-UAS effort, fusing radar, RF, and EO/IR tracks into a single operator picture. Delivered TRL-6 prototype in 11 months, on schedule and under budget.',
    tags: [{ dimension: 'agency', value: 'Navy' }, { dimension: 'tech', value: 'C-UAS' }] },
  { title: 'Team Bio — Dr. Ada Chen, Chief Engineer', status: 'approved', source: 'upload',
    summary: 'PhD EE (Stanford); 15 yrs RF/EW; PI on three SBIR Phase II awards.',
    content: 'Dr. Ada Chen leads Acme engineering. PhD in Electrical Engineering (Stanford), 15 years in RF and electronic warfare, principal investigator on three SBIR Phase II awards.',
    tags: [{ dimension: 'kind', value: 'bio' }] },
  { title: 'Capability — Real-time Sensor Fusion Pipeline', status: 'approved', source: 'harvest',
    summary: 'Sub-100ms multi-sensor track fusion with an operator-in-the-loop override.',
    content: 'Our sensor-fusion pipeline correlates heterogeneous tracks (radar, RF, EO/IR) at sub-100ms latency, with a human-on-the-loop override for engagement decisions.',
    tags: [{ dimension: 'tech', value: 'sensor-fusion' }, { dimension: 'program', value: 'SBIR' }] },
  { title: 'Commercialization Approach — Dual-use RF Sensing', status: 'draft', source: 'upload',
    summary: 'Transition path from DoD C-UAS to airport + critical-infrastructure markets.',
    content: 'The RF-sensing core transitions from DoD C-UAS into commercial airport perimeter security and critical-infrastructure protection, a $1.2B addressable market by 2030.',
    tags: [{ dimension: 'kind', value: 'commercialization' }] },
  { title: 'Technical Approach — Phase I Objectives', status: 'draft', source: 'upload',
    summary: 'Three measurable Phase I objectives with go/no-go criteria.',
    content: 'Phase I will (1) characterize the detection envelope against Group 1–3 UAS, (2) demonstrate track fusion at sub-100ms latency, and (3) define the Phase II prototype architecture, each with explicit go/no-go criteria.',
    tags: [{ dimension: 'phase', value: 'Phase I' }] },
  { title: 'Facilities & Equipment — Anechoic Chamber', status: 'draft', source: 'upload',
    summary: 'In-house 6m anechoic chamber + fielded UAS test range access.',
    content: 'Acme operates a 6-meter anechoic chamber for RF characterization and holds a standing agreement for fielded UAS test-range access, de-risking Phase I measurement objectives.',
    tags: [{ dimension: 'kind', value: 'facilities' }] },
  { title: 'Past Performance — Army SBIR Phase II (EW)', status: 'draft', source: 'harvest',
    summary: 'Completed Army SBIR Phase II in electronic warfare; transitioned to PoR.',
    content: 'Acme completed an Army SBIR Phase II in electronic warfare, transitioning the capability into a program of record — evidence of our Phase I → II → transition track record.',
    tags: [{ dimension: 'agency', value: 'Army' }, { dimension: 'phase', value: 'Phase II' }] },
  { title: 'Boilerplate — Small-business Status & Certs', status: 'draft', source: 'upload',
    summary: 'SBA small-business, SAM-registered, CAGE code active, no I/O conflicts.',
    content: 'Acme is an SBA-certified small business, SAM-registered with an active CAGE code, and certifies no organizational conflicts of interest for this effort.',
    tags: [{ dimension: 'kind', value: 'certs' }] },
];

try {
  // Idempotent-ish: clear prior demo atoms by title prefix would be ideal, but titles
  // vary — instead skip if the tenant already has a healthy library.
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM library_atoms WHERE tenant_id = ${TENANT}::uuid`;
  if (n >= ATOMS.length) {
    console.log(`Tenant already has ${n} atoms — skipping seed.`);
  } else {
    for (const a of ATOMS) {
      const { atomId } = await createAtom(
        TENANT,
        { grain: 'primitive', title: a.title, summary: a.summary, content: a.content, status: a.status, source: a.source, creatorKind: 'admin', visibility: 'tenant',
          tags: a.tags.map((t) => ({ dimension: t.dimension, value: t.value, source: 'admin' as const, confirmed: true })) },
        { id: ADMIN, kind: 'admin' },
      );
      console.log(`✓ ${a.status.padEnd(8)} ${a.title}  (${atomId.slice(0, 8)})`);
    }
  }
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int total FROM library_atoms WHERE tenant_id = ${TENANT}::uuid`;
  console.log(`\n${total} atoms in Acme library now`);
} finally {
  await sql.end();
}
