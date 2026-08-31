#!/usr/bin/env node
/**
 * audit-wipe-impact — what would a wipe-and-rebuild actually destroy?
 *
 * ── WHY A DIFF AND NOT A CHECKLIST ─────────────────────────────────────────────────────────────
 * "Is there anything in production we'd miss?" answered from memory is answered wrong: somebody
 * forgets the table nobody thinks about — the curated solicitations an admin uploaded, the content
 * pages edited in the CMS, the purchases. The question has an exact answer, and it is a subtraction.
 *
 * A freshly-migrated database is NOT empty. This repo's migrations seed a working estate: at head
 * 237 a from-zero rebuild comes up with 5 tenants, 15 curated solicitations, 19 opportunities, 560
 * library atoms, 64 content pages and 9 document templates. So the honest question is not "what is
 * in production" but **"what does production have that a rebuild would not put back"** — and that is
 * LIVE minus FROM-ZERO, per table.
 *
 * Everything the migrations seed cancels out. What is left is what you would actually lose.
 *
 * ── HOW TO GET THE REFERENCE DATABASE ──────────────────────────────────────────────────────────
 *     psql "$DATABASE_URL_OWNER" -c "CREATE DATABASE fromzero_ref"
 *     DATABASE_URL="<...fromzero_ref>" ALLOW_SCHEMA_RESET=true node db/migrations/migrate.mjs
 *
 * Build it from the SAME COMMIT the live database is running, or the diff measures your uncommitted
 * migrations as well as your data.
 *
 *     node scripts/audit-wipe-impact.mjs --live <url> --fromzero <url>
 *     node scripts/audit-wipe-impact.mjs --check          # self-test only
 *
 * Read-only on both databases: `SELECT count(*)` and nothing else. Exit 0 always — this reports,
 * it does not judge. Only you know whether the rows it names are worth keeping.
 */
import postgres from 'postgres';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CHECK_ONLY = argv.includes('--check');

/**
 * Tables whose rows represent WORK A PERSON DID, grouped by what losing them would mean. Ordered
 * so the report reads worst-first. A table absent from a database is reported as absent, never as
 * zero — the two are different and only one of them is a finding about your data.
 */
const GROUPS = [
  ['Customer identity and money', [
    'tenants', 'users', 'user_memberships', 'purchases', 'proposal_portals', 'contracts',
  ]],
  ['Curation an admin performed', [
    'curated_solicitations', 'opportunities', 'solicitation_compliance', 'solicitation_volumes',
    'volume_required_items', 'solicitation_documents', 'solicitation_amendments', 'scout_findings',
  ]],
  ['Work a customer produced', [
    'proposals', 'proposal_sections', 'canvas_versions', 'proposal_artifacts', 'library_atoms',
    'tenant_documents', 'projects', 'project_milestones', 'project_deliverables',
  ]],
  ['Front-facing content', [
    'content_pages', 'document_templates', 'compliance_presets',
  ]],
  ['History that cannot be recomputed', [
    'system_events', 'agent_task_log', 'email_send_ledger', 'tasks', 'process_instances',
    'notifications', 'proposal_comments',
  ]],
];

async function counts(sql, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const [r] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${t}`);
      out[t] = r.n;
    } catch {
      out[t] = null;              // table does not exist here
    }
  }
  return out;
}

/** Pure, so the self-test can drive it without a database. */
export function diff(live, zero, groups) {
  const rows = [];
  for (const [group, tables] of groups) {
    for (const t of tables) {
      const l = live[t], z = zero[t];
      if (l == null && z == null) continue;                   // absent from both — not our business
      if (l == null) { rows.push({ group, table: t, state: 'absent-live', lost: 0 }); continue; }
      if (z == null) { rows.push({ group, table: t, state: 'absent-ref', lost: l }); continue; }
      const lost = l - z;
      if (lost > 0) rows.push({ group, table: t, state: 'lost', lost, live: l, seeded: z });
    }
  }
  return rows;
}

function selfTest() {
  const g = [['G', ['a', 'b', 'c', 'd', 'e']]];
  const cases = [
    ['seeded rows cancel out', { a: 5 }, { a: 5 }, (r) => !r.some((x) => x.table === 'a')],
    ['extra rows are reported as lost', { b: 9 }, { b: 5 }, (r) => r.some((x) => x.table === 'b' && x.lost === 4)],
    ['FEWER rows than seed is not a loss', { c: 2 }, { c: 5 }, (r) => !r.some((x) => x.table === 'c')],
    ['a table absent from the REFERENCE counts every row as at risk',
      { d: 7 }, {}, (r) => r.some((x) => x.table === 'd' && x.state === 'absent-ref' && x.lost === 7)],
    ['a table absent from LIVE is flagged, not silently zeroed',
      {}, { e: 3 }, (r) => r.some((x) => x.table === 'e' && x.state === 'absent-live')],
    ['absent from both is not reported at all', {}, {}, (r) => r.length === 0],
  ];
  let bad = 0;
  for (const [label, live, zero, expect] of cases) {
    const ok = expect(diff(live, zero, label === 'absent from both is not reported at all' ? [['G', ['zz']]] : g));
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) bad++;
  }
  return bad;
}

console.log('\nSELF-TEST\n');
if (selfTest()) { console.error('\n⛔ HARNESS DEFECT — the subtraction is wrong. Nothing below would mean anything.\n'); process.exit(2); }
console.log('');
if (CHECK_ONLY) process.exit(0);

const LIVE = arg('--live'), ZERO = arg('--fromzero');
if (!LIVE || !ZERO) {
  console.error('Usage: node scripts/audit-wipe-impact.mjs --live <url> --fromzero <url>\n' +
                '  See this file\'s header for how to build the from-zero reference.\n');
  process.exit(2);
}

const opts = { max: 2, transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } };
const a = postgres(LIVE, opts), b = postgres(ZERO, opts);
try {
  const tables = GROUPS.flatMap(([, t]) => t);
  const [live, zero] = await Promise.all([counts(a, tables), counts(b, tables)]);

  const [{ head: liveHead }] = await a`SELECT max(filename) AS head FROM _migration_history`;
  const [{ head: zeroHead }] = await b`SELECT max(filename) AS head FROM _migration_history`;
  console.log(`live      ${liveHead}`);
  console.log(`from-zero ${zeroHead}`);
  if (liveHead !== zeroHead) {
    console.log(`\n⚠ THE TWO DATABASES ARE AT DIFFERENT HEADS. The diff below mixes your DATA with the`);
    console.log(`  migrations one side is missing. Rebuild the reference from the live commit first.\n`);
  } else {
    console.log('');
  }

  const rows = diff(live, zero, GROUPS);
  if (!rows.length) {
    console.log('✓ NOTHING WOULD BE LOST — every row present live is one the migrations put there.\n');
  } else {
    let lastGroup = null, total = 0;
    for (const r of rows) {
      if (r.group !== lastGroup) { console.log(`\n${r.group}`); lastGroup = r.group; }
      if (r.state === 'absent-live') { console.log(`  ${'—'.padStart(8)}  ${r.table}  (not in the live DB)`); continue; }
      if (r.state === 'absent-ref') {
        console.log(`  ${String(r.lost).padStart(8)}  ${r.table}  ALL rows at risk — table absent from the reference`);
      } else {
        console.log(`  ${String(r.lost).padStart(8)}  ${r.table}  (live ${r.live}, seeded ${r.seeded})`);
      }
      total += r.lost;
    }
    console.log(`\n${String(total).padStart(10)}  rows a rebuild would NOT put back.`);
    console.log(`\nThis is a report, not a verdict. Some of it is history you can afford to lose`);
    console.log(`(an event log); some of it is work somebody did. Only you can tell them apart.`);
    console.log(`\n⚠ OBJECT STORAGE IS NOT COUNTED HERE. Rows in library_atoms / proposal_artifacts /`);
    console.log(`  tenant_documents reference files in the bucket; wiping the bucket loses those`);
    console.log(`  regardless of what the tables say.\n`);
  }
} finally {
  await a.end({ timeout: 5 }); await b.end({ timeout: 5 });
}
