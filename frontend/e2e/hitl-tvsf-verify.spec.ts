/**
 * Verify the rebuilt canonical TVSF: the full-document preview assembles its sections in NUMERIC
 * order.
 *
 * WHAT IS ACTUALLY UNDER TEST is migration 143's rule, stated in CLAUDE.md as: never string-sort
 * `section_number`. String order puts "10" between "1" and "2", so a fourteen-section proposal
 * assembles as 1, 10, 11, …, 2, 3 — a scrambled document that still looks plausible section by
 * section. `sort_index` exists to prevent exactly that, and this spec is its live proof.
 *
 * IT USED TO PIN THAT WITH HARD-CODED TITLES on a hard-coded section id:
 *
 *     const S = 'c3db6000-0000-4000-8000-000000000002'; // Q2 Overview (stable id)
 *     expect(idx('10. ESP Engagement')).toBeGreaterThan(idx('9. Management Team'));
 *
 * Neither survives a rebuild. Nothing in the repository creates a `c3db6000-…` section — that id
 * existed only as a row on a long-lived box — so the navigation landed on a section that is not
 * there, the Preview button never rendered, and the spec died on a 60s `locator.click` timeout that
 * read like a broken preview. The titles were stale too: this proposal's second section is really
 * "#1 Market Opportunity (TAM)" at section_number 2, so the preview renders "2. #1 Market
 * Opportunity" and the old string assertions could not have matched either.
 *
 * So resolve the subject from the data and assert the PROPERTY instead of the strings: read the
 * leading number off every heading the preview emits, in document order, and require that sequence
 * to ascend numerically. That is a strictly stronger check — it catches the string-sort bug on any
 * proposal, of any length, whatever its sections are called — and it cannot rot when someone
 * retitles a section.
 */
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const PW = process.env.FOUNDATION_PW || 'DemoPass123!';
const SLUG = 'foundation';

let PROPOSAL = '';
let SECTION = '';
let SECTION_COUNT = 0;

test.beforeAll(async () => {
  const dsn = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  expect(dsn, 'DATABASE_URL_OWNER must be set to resolve the proposal').toBeTruthy();
  const sql = postgres(dsn!, { max: 1 });
  try {
    // The richest Foundation proposal — the one whose assembly order is worth checking. Pinning by
    // id is what broke; pinning by "most sections" finds the same document after any rebuild.
    const [p] = await sql<{ id: string; n: number }[]>`
      SELECT p.id, count(s.id)::int AS n
      FROM proposals p
      JOIN tenants t ON t.id = p.tenant_id AND t.slug = ${SLUG}
      JOIN proposal_sections s ON s.proposal_id = p.id
      WHERE p.archived_at IS NULL
      GROUP BY p.id ORDER BY count(s.id) DESC, p.created_at DESC LIMIT 1`;
    expect(p?.n ?? 0, 'no Foundation proposal with sections to preview').toBeGreaterThan(2);
    PROPOSAL = p.id;
    SECTION_COUNT = p.n;

    // Any section opens the editor that hosts the preview button; take the first in document order.
    const [s] = await sql<{ id: string }[]>`
      SELECT id FROM proposal_sections WHERE proposal_id = ${PROPOSAL}
      ORDER BY sort_index ASC NULLS LAST LIMIT 1`;
    SECTION = s.id;
    console.log(`[tvsf] proposal ${PROPOSAL} — ${SECTION_COUNT} sections, entering at ${SECTION}`);
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string, pinSlug?: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  // Paul is multi-membership (no home tenant) — pin Foundation onto the session or a tenant URL
  // bounces to /select-company. Matches hitl-foundation-verify's pinSlug pattern.
  if (pinSlug) {
    await page.goto(`/api/enter?slug=${pinSlug}&next=/portal/${pinSlug}/dashboard`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}

/** Leading "N." of every heading the assembled document emits, in document order. */
function headingNumbers(html: string): number[] {
  const out: number[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>\s*(\d{1,3})\.\s/gi)) out.push(Number(m[1]));
  return out;
}

test('rebuilt TVSF — the full-document preview assembles in numeric order', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'pjackson@ecinnovates.com', SLUG);
  await page.goto(`/portal/${SLUG}/proposals/${PROPOSAL}/sections/${SECTION}`, { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /Preview/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /document preview/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Full document' }).click();

  const iframe = dialog.locator('iframe[title="document-preview"]');
  await expect
    .poll(async () => headingNumbers((await iframe.getAttribute('srcdoc')) ?? '').length,
      { timeout: 20_000, message: 'the assembled document never rendered a numbered heading' })
    .toBeGreaterThan(1);

  const doc = (await iframe.getAttribute('srcdoc')) ?? '';
  const nums = headingNumbers(doc);
  console.log(`[tvsf] assembled heading order: ${nums.join(', ')}`);

  // THE ASSERTION. Ascending numerically, in document order. Under the string-sort bug this reads
  // 1, 10, 11, 12, 13, 14, 2, 3, … and the very first comparison fails.
  for (let i = 1; i < nums.length; i++) {
    expect(nums[i], `heading ${nums[i]} must come after ${nums[i - 1]}, not before — `
      + `assembled order was [${nums.join(', ')}]`).toBeGreaterThan(nums[i - 1]);
  }

  // A section numbered N must not ALSO carry its own "#N" in the title — that is the double-number
  // the renderer strips ("2. #1 Market Opportunity"). Checked on the rendered headings only, since
  // a body paragraph may legitimately contain "#".
  for (const m of doc.matchAll(/<h[1-3][^>]*>([^<]*)<\/h[1-3]>/gi)) {
    expect(m[1], `heading double-numbered: "${m[1].trim()}"`).not.toMatch(/^\s*\d{1,3}\.\s*#/);
  }

  await page.screenshot({ path: 'e2e/screenshots/23-tvsf-fulldoc.png' });
});
