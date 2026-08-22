/**
 * T3CP Volume 1 — the two character-capped narrative documents, added as a real rfp_admin.
 *
 * The DoW 2026 SBIR BAA governs Volume 1:
 *
 *   "The cover sheet must include a brief technical abstract that describes the proposed R&D
 *    project and an anticipated benefits and potential commercial applications discussion.
 *    Each section should be no more than 3,000 characters."
 *
 * So Volume 1 is NOT DSIP-only. It is a MIXED volume: the cover sheet itself is a DSIP webform
 * the company never authors here, and beside it sit two authored narrative documents, each hard-
 * capped at 3,000 characters by the agency's form field. This drive builds that structure through
 * the product's own rfp_admin path (volume.add_required_item over /api/tools), never SQL, and
 * asserts the result is what provision will actually read.
 *
 * Run: npx playwright test --project=drive t3cp-v1-items
 */
import { test, expect, type Page } from '@playwright/test';
import { resolveShreddedSolicitation } from './resolve-solicitation';

/* Resolved from the DB in beforeAll — `process.env.DRIVE_SOL_ID!` was unset, so every request
 * went to /…/undefined/… and this file failed on a bare false. See e2e/resolve-solicitation.ts. */
let SOL = '';

/** Read off DoW_2026_SBIR_BAA_Preface_07152026.pdf — the sentence the cap comes from. */
const CITATION =
  'The cover sheet must include a brief technical abstract that describes the proposed R&D project ' +
  'and an anticipated benefits and potential commercial applications discussion. Each section ' +
  'should be no more than 3,000 characters.';
const CHAR_CAP = 3000;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'eric@rfppipeline.com');
  await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function tool(page: Page, name: string, input: unknown) {
  const res = await page.request.post(`/api/tools/${name}`, { data: { input }, timeout: 60_000 });
  const body = await res.json();
  return { ok: res.ok(), status: res.status(), body };
}

test.beforeAll(async () => {
  SOL = (await resolveShreddedSolicitation('DRIVE_SOL_ID')).id;
});

test('Volume 1 carries the DSIP webform plus two 3,000-character narrative documents', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await signIn(page);

  // ── Find Volume 1 through the admin read path ──
  const solRes = await page.request.get(`/api/admin/rfp-curation/${SOL}`);
  expect(solRes.ok()).toBeTruthy();
  const sol = (await solRes.json()).data;
  const v1 = (sol.volumes as Array<{ id: string; volumeNumber: number; volumeName: string }>)
    .find((v) => v.volumeNumber === 1);
  expect(v1, 'Volume 1 must exist on the landed skeleton').toBeTruthy();
  console.log('[v1]', v1!.id, v1!.volumeName);

  // The landed default skeleton left one CONFLATED item — "Proposal Cover Sheet & Technical
  // Abstract" — which is two different obligations wearing one name: a webform completed in DSIP
  // and a narrative document the company writes. Correct it in place through the update tool
  // rather than deleting it, so its id, its matrix row and any curator notes survive.
  const existing = (sol.volumes as Array<Record<string, unknown>>).find((v) => v.volumeNumber === 1)!;
  const legacy = ((existing.requiredItems ?? []) as Array<Record<string, unknown>>)
    .find((i) => String(i.itemName).includes('&'));
  if (legacy) {
    const r = await tool(page, 'volume.update_required_item', {
      itemId: legacy.id,
      itemName: 'Proposal Cover Sheet (DSIP webform)',
      dsipOnly: true,
      characterLimit: null,
    });
    expect(r.ok, `split the conflated cover-sheet item: ${JSON.stringify(r.body)}`).toBeTruthy();
    console.log(`[v1] corrected conflated item → "${legacy.itemName}" is now the webform only`);
  }

  // ── The three items, in DSIP's own order ──
  const ITEMS = [
    {
      itemNumber: 1,
      itemName: 'Proposal Cover Sheet (DSIP webform)',
      itemType: 'form_sbir_certs' as const,
      dsipOnly: true,
      expertNotes:
        'Completed inside the DSIP submission portal — firm data, proposed base duration (4 months) and '
        + 'the Phase I Base cost, which must match Volume 3. No document is authored here.',
    },
    {
      itemNumber: 2,
      itemName: 'Project Summary / Technical Abstract',
      itemType: 'word_doc' as const,
      characterLimit: CHAR_CAP,
      expertNotes:
        'Pasted into the DSIP cover-sheet Technical Abstract field, which truncates at the cap. '
        + `Source: "${CITATION}" No classified or proprietary information.`,
    },
    {
      itemNumber: 3,
      itemName: 'Anticipated Benefits and Potential Commercial Applications',
      itemType: 'word_doc' as const,
      characterLimit: CHAR_CAP,
      expertNotes:
        'Pasted into the DSIP cover-sheet Anticipated Benefits field, which truncates at the cap. '
        + `Source: "${CITATION}" No classified or proprietary information.`,
    },
  ];

  for (const item of ITEMS) {
    const r = await tool(page, 'volume.add_required_item', { volumeId: v1!.id, ...item });
    // A re-run of this drive hits the (volume_id, item_number) unique constraint — that is the
    // tool refusing a duplicate, which is correct behaviour, not a failure of the drive.
    if (!r.ok && r.body?.code === 'CONFLICT') {
      console.log(`[v1] item ${item.itemNumber} already present — ${r.body.error}`);
      continue;
    }
    expect(r.ok, `add ${item.itemName}: ${JSON.stringify(r.body)}`).toBeTruthy();
    console.log(`[v1] + item ${item.itemNumber} ${item.itemName}`);
  }

  // ── Assert what PROVISION will read, through the same admin read path ──
  const after = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data;
  const v1After = (after.volumes as Array<Record<string, unknown>>).find((v) => v.volumeNumber === 1)!;
  const items = (v1After.requiredItems ?? []) as Array<Record<string, unknown>>;

  const webform = items.find((i) => String(i.itemName).includes('DSIP webform'));
  const summary = items.find((i) => String(i.itemName).includes('Project Summary'));
  const benefits = items.find((i) => String(i.itemName).includes('Anticipated Benefits'));

  expect(webform, 'the cover-sheet webform item').toBeTruthy();
  expect(summary, 'the Project Summary item').toBeTruthy();
  expect(benefits, 'the Anticipated Benefits item').toBeTruthy();

  // The webform is tracked but never authored here.
  expect(webform!.dsipOnly).toBe(true);
  expect(webform!.characterLimit ?? null).toBeNull();

  // The two narratives are authored, and each carries its own cap — not a shared one.
  expect(summary!.characterLimit).toBe(CHAR_CAP);
  expect(benefits!.characterLimit).toBe(CHAR_CAP);
  expect(summary!.dsipOnly).toBe(false);
  expect(benefits!.dsipOnly).toBe(false);

  // Volume 1 itself stays authored — flagging the whole volume would drop both narratives.
  expect(v1After.dsipOnly).toBe(false);

  console.log('[v1] ✓ webform tracked-not-authored; 2 narratives @ 3,000 characters each');
});
