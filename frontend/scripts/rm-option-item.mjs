/**
 * Remove the "Phase I Option Cost Proposal" item from the T3CP master.
 *
 * WHY: the DoW BAA offers a Phase I option only "if applicable", and explicitly defers the
 * question to the Component-specific instructions. The T3CP R4 — those instructions — offers
 * none: it states only "The Phase I Base amount must not exceed $250,000.00" and lists
 * deliverables ending at 120 days from Base award. So the item came from our DEFAULT skeleton,
 * not from this solicitation, and it would have the buyer cost an option period that does not
 * exist and that DSIP has no field for.
 */
import { chromium } from '@playwright/test';
const SOL = '11263a74-ab09-48bb-ada5-565aa2ee986e';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', 'eric@rfppipeline.com');
await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const sol = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data;
const v3 = sol.volumes.find((v) => v.volumeNumber === 3);
const item = (v3.requiredItems ?? []).find((i) => /option/i.test(i.itemName));
if (!item) { console.log('no Option item found — already removed'); }
else {
  const r = await page.request.post('/api/tools/volume.delete_required_item', { data: { input: { itemId: item.id } } });
  console.log('delete', r.status(), JSON.stringify(await r.json()).slice(0, 200));
}
const after = (await (await page.request.get(`/api/admin/rfp-curation/${SOL}`)).json()).data;
for (const v of after.volumes) {
  console.log(`V${v.volumeNumber} ${v.volumeName} — ${(v.requiredItems ?? []).length} item(s)${v.dsipOnly ? ' [DSIP-only]' : ''}`);
}
await browser.close();
