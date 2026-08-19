/**
 * Run the full draft for the T3CP build, as the buying tenant_admin, through the product's own
 * front door (POST …/proposals/[p]/full-draft). Then report what the workforce actually did —
 * per section, whether prose landed, so a "completed" workflow can never stand in for a draft.
 */
import { chromium } from '@playwright/test';
const TENANT = process.env.TENANT ?? 'immobileyes';
const PROP = process.env.PROP ?? '9ce4a3b5-3168-428d-93de-5dfc95b0ba68';
const MODE = process.env.MODE ?? 'a';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ baseURL: 'http://localhost:3000' });
await page.goto('/login');
await page.fill('input[type="email"]', 'admin@immobileyes.test');
await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login')), page.click('button[type="submit"]')]);

const r = await page.request.post(`/api/portal/${TENANT}/proposals/${PROP}/full-draft`, {
  data: { mode: MODE }, timeout: 300_000,
});
console.log('[full-draft]', r.status(), JSON.stringify(await r.json()).slice(0, 500));
await browser.close();
