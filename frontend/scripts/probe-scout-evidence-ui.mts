/**
 * DOES A CURATOR ACTUALLY SEE WHAT THE DOCUMENTS SAID?
 *
 * The evidence is written by `lib/harvest/judge.ts` and rendered by `components/scout/
 * candidate-queue.tsx`. Neither fact means a person can read it: this repo's own rule is that a
 * page can answer 200, return a textbook envelope, and be visibly broken (B131, B78).
 *
 * So this seeds ALL FOUR states on one queue, signs in as the admin who reviews it, opens
 * `/admin/scouts`, and reads the rendered DOM back:
 *
 *     null          never checked          — must NOT read as "no match"
 *     none          checked, nothing found
 *     flag          close name and size    — must say it changed nothing
 *     certain       identical bytes
 *     boilerplate   shared attachment      — must say it decided nothing
 *
 * The pair that matters is `null` vs `none`. They are opposite facts — work still to do versus a
 * result — and they render identically if both are silence. A curator told "no document match"
 * when nothing was ever fetched has been misled by omission.
 *
 * ⚠️ NOT READ-ONLY. Seeds five throwaway findings, removes them in a `finally`.
 *
 * Run: source scripts/sandbox-env.sh && cd frontend && node --import tsx scripts/probe-scout-evidence-ui.mts
 */
import { chromium } from 'playwright';
import { sqlBypass } from '@/lib/db';

const BASE = process.env.BASE || 'http://localhost:3000';
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ADMIN = process.env.DRIVE_ADMIN_EMAIL || 'eric@rfppipeline.com';
const PW = process.env.SANDBOX_PASSWORD;

let ok = true;
const A = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok = ok && cond;
};

const made: string[] = [];

/** One finding per evidence state, titled so the rendered row can be found by eye and by matcher. */
async function seed(title: string, evidence: unknown): Promise<string> {
  const [src] = await sqlBypass<Array<{ id: string }>>`
    SELECT id FROM scout_sources ORDER BY created_at LIMIT 1`;
  const [row] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO scout_findings (source_id, purpose, kind, title, url, status, classification, dedup_hash)
    VALUES (${src?.id ?? null}, 'opportunity', 'lead', ${title},
            'https://www.example.gov/opportunities/AF251-D001', 'new', 'new',
            ${`zz-ui-${Math.random().toString(36).slice(2)}`})
    RETURNING id`;
  made.push(row.id);
  if (evidence !== null) {
    await sqlBypass`
      UPDATE scout_findings
         SET document_evidence = ${sqlBypass.json(evidence as Parameters<typeof sqlBypass.json>[0])}
       WHERE id = ${row.id}::uuid`;
  }
  return row.id;
}

const ev = (verdict: string, reason: string, filename = 'topics.pdf', ownerKind = 'solicitation') => ({
  checkedAt: new Date().toISOString(),
  documents: 3,
  verdict,
  matches: verdict === 'none' ? [] : [{ verdict, ownerKind, ownerId: null, filename, score: 1, reason }],
});

if (!PW) { console.error('✗ HARNESS DEFECT — SANDBOX_PASSWORD not set'); process.exit(2); }

const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  console.log('\n══ seeding one finding per evidence state ════════════════════════════════');
  await seed('ZZUI never checked — AF251-D001', null);
  await seed('ZZUI checked and nothing found — AF251-D002', ev('none', ''));
  await seed('ZZUI close name and size — AF251-D003',
    ev('flag', 'different bytes, but the name is 100% the same and the size differs by 2% — worth a look before this is released as new'));
  /**
   * ── THE TWO CERTAIN CASES, SEEDED AS THE PRODUCT WOULD LEAVE THEM ────────────────────────
   *
   * A certain match against a CURATED solicitation moves the call to `update` — so the badge must
   * read UPDATE beside it. A certain match against another CANDIDATE cannot move anything, and
   * correctly leaves the badge on NEW.
   *
   * The first version of this probe seeded both as `new`, which produced a screenshot where a
   * green NEW badge sat beside "the strongest evidence that this is the same opportunity". That
   * contradiction was the FIXTURE's, not the product's — and an inconsistent fixture teaches a
   * reader the wrong thing about the page just as effectively as a real defect would.
   */
  const curatedCertain = await seed('ZZUI identical bytes, curated match — AF251-D004',
    ev('certain', 'identical bytes (sha256 5a6f71b32f4f…), and this file is attached to exactly one opportunity'));
  await sqlBypass`UPDATE scout_findings SET classification = 'update' WHERE id = ${curatedCertain}::uuid`;

  await seed('ZZUI identical bytes, another candidate — AF251-D006',
    ev('certain', 'identical bytes (sha256 9c21be0447aa…), and this file is attached to exactly one opportunity',
       'topics.pdf', 'finding'));
  await seed('ZZUI shared attachment — AF251-D005',
    ev('boilerplate', 'identical bytes, but this file is attached to 8 opportunities — it is a shared attachment and cannot say which one this is',
       'DoW 2026 SBIR BAA FULL_R1_04132026.pdf'));
  console.log(`  seeded ${made.length}`);

  const page = await (await br.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
  const throws: string[] = [];
  page.on('pageerror', (e) => throws.push(String(e.message).slice(0, 90)));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', ADMIN);
  await page.fill('#password', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 }).catch(() => {});
  if (page.url().includes('/login')) {
    console.error(`✗ CANNOT RUN — could not sign in as ${ADMIN}. Every check below would read as absent.`);
    process.exit(2);
  }

  console.log('\n══ /admin/scouts, as the admin who reviews it ════════════════════════════');
  await page.goto(`${BASE}/admin/scouts`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  /** The text of the card containing a given title — what a person actually reads. */
  const cardFor = (title: string) => page.evaluate((t) => {
    const nodes = [...document.querySelectorAll('div')];
    const hit = nodes.find((n) => (n.textContent ?? '').includes(t)
      && (n.className ?? '').includes('border') && (n.className ?? '').includes('rounded-lg'));
    return hit ? (hit.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
  }, title);

  const queueText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  A('the candidate queue rendered at all', /ZZUI/.test(queueText),
    `${(queueText.match(/ZZUI/g) ?? []).length} seeded row(s) visible`);

  const never = await cardFor('ZZUI never checked');
  A('NEVER CHECKED says so, and does not claim there was no match',
    !!never && /not checked/i.test(never) && !/no match/i.test(never),
    never ? never.slice(never.indexOf('Documents:'), never.indexOf('Documents:') + 80) : 'card not found');

  const none = await cardFor('ZZUI checked and nothing found');
  A('CHECKED-AND-NOTHING says no match, and says how many it compared',
    !!none && /no match/i.test(none) && /3 documents/i.test(none),
    none ? none.slice(none.indexOf('Documents:'), none.indexOf('Documents:') + 90) : 'card not found');

  const flag = await cardFor('ZZUI close name and size');
  A('FLAG says it is worth a look AND that it changed nothing',
    !!flag && /worth a look/i.test(flag) && /did not change the call/i.test(flag),
    flag ? flag.slice(flag.indexOf('Documents:'), flag.indexOf('Documents:') + 90) : 'card not found');

  const certainCurated = await cardFor('ZZUI identical bytes, curated match');
  A('CERTAIN against a curated solicitation says so, beside an UPDATE badge',
    !!certainCurated && /identical file found/i.test(certainCurated)
    && /a solicitation we already carry/i.test(certainCurated) && /UPDATE/.test(certainCurated),
    certainCurated ? certainCurated.slice(certainCurated.indexOf('Documents:'), certainCurated.indexOf('Documents:') + 100) : 'card not found');

  const certainPeer = await cardFor('ZZUI identical bytes, another candidate');
  A('CERTAIN against another CANDIDATE says THAT, and explains why the call is unchanged',
    !!certainPeer && /ANOTHER CANDIDATE/i.test(certainPeer) && /duplicates/i.test(certainPeer),
    certainPeer ? certainPeer.slice(certainPeer.indexOf('Documents:'), certainPeer.indexOf('Documents:') + 100) : 'card not found');

  const boiler = await cardFor('ZZUI shared attachment');
  A('BOILERPLATE says it decided nothing, and why',
    !!boiler && /shared attachment/i.test(boiler) && /cannot say which one/i.test(boiler),
    boiler ? boiler.slice(boiler.indexOf('Documents:'), boiler.indexOf('Documents:') + 90) : 'card not found');

  A('no client throw on the page', throws.length === 0, throws[0] ?? 'none');

  // The picture, because a matcher can pass over a page that looks wrong (B131).
  await page.screenshot({ path: 'docs/ui-states/scout-document-evidence.png', fullPage: false });
  console.log('\n  screenshot → docs/ui-states/scout-document-evidence.png');
} catch (err) {
  console.error('\n✗ the probe threw:', err);
  ok = false;
} finally {
  await br.close().catch(() => {});
  for (const id of made) await sqlBypass`DELETE FROM scout_findings WHERE id = ${id}::uuid`.catch(() => {});
  await sqlBypass.end().catch(() => {});
}

console.log(ok
  ? '\n✅ all four evidence states read correctly on the page a curator uses.'
  : '\n✗ the evidence does not read correctly — see the ✗ rows above.');
process.exit(ok ? 0 : 1);
