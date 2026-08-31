/** Live drive for F2 annotate — highlight a span in the fluid Document view → Annotate →
 *  note → a comment on the owning section. Usage: node --import tsx scripts/drive-f2-annotate.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/f2-shots';
mkdirSync(OUT, { recursive: true });
const PROPOSAL = 'bbd6a058-3299-4b98-96e0-1e07e43aa1c4';
const NOTE = 'Tie this cost claim to the quote in the budget volume.';

async function shot(p: Page, n: string) { await p.waitForTimeout(500); await p.screenshot({ path: join(OUT, `${n}.png`) }); console.log(`  📸 ${n}`); }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })).newPage();
p.setDefaultTimeout(25000);
// Accept the annotate prompt with our note.
p.on('dialog', async (d) => { await d.accept(NOTE); });
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1000);
  await p.goto(`${BASE}/portal/foundation/proposals/${PROPOSAL}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Document', exact: true }).click();
  await p.getByText('Document outline').waitFor({ timeout: 25000 });
  await p.waitForTimeout(1200);

  // Select a body block's text, pop the toolbar.
  await p.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-node-id]')) as HTMLElement[];
    const t = nodes.find((n) => !(n.dataset.nodeId || '').startsWith('sec:') && (n.textContent || '').trim().length > 80);
    if (!t) return;
    t.scrollIntoView({ block: 'center' });
    const r = document.createRange(); r.selectNodeContents(t);
    const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await p.waitForTimeout(500);
  await shot(p, 'f2-01-toolbar');
  const annotate = p.getByRole('button', { name: /Annotate/ });
  console.log(`annotate visible: ${await annotate.isVisible().catch(() => false)}`);
  await annotate.click();       // fires the prompt → dialog handler accepts with NOTE
  await p.waitForTimeout(1800); // toast + POST
  await shot(p, 'f2-02-annotated');
  console.log(`console errors: ${errors.length}`);
} catch (e) { console.error('FAILED:', e); await shot(p, 'f2-99-fail').catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
