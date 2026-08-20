/** Name the element that makes the portal shell scroll sideways at 390px, with its ancestry.
 *
 * The audit reports leaves (`<a class="flex items-center gap-2 …"> w=466 right=474`) but a leaf
 * that pokes out is usually innocent — something ABOVE it is wider than the viewport and the leaf
 * just fills it. The three reported hits sit at x≈364–474, i.e. a column of nav links parked past
 * the right edge, which does not match the drawer's own geometry (fixed left-0, w-64,
 * -translate-x-full when closed → it should span [-256, 0]).
 *
 * So walk up from each offender and print every ancestor's width, position, overflow and transform.
 * Whichever ancestor first exceeds the viewport is the thing to fix; the transform column says
 * whether the drawer's closed-state translate actually applied.
 *
 * Deliberately drives LIGHTHOUSE, not Foundation: the CC watermark specs assert on "new since you
 * looked" state in Foundation, and a probe that reads those pages would mark them seen.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'eric@lighthouse.com');
await page.fill('input[name="password"]', process.env.LIGHTHOUSE_PW || 'LighthouseAdmin');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type="submit"]')]);

for (const path of ['/portal/lighthouse/dashboard', '/portal/lighthouse/proposals']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const desc = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '(none)').slice(0, 46)}`.padEnd(56) +
why(r, cs);
      function why(r, cs) {
        return ` x=${Math.round(r.left)}..${Math.round(r.right)} w=${Math.round(r.width)}` +
               ` pos=${cs.position} ox=${cs.overflowX} tf=${cs.transform === 'none' ? 'none' : 'yes'}`;
      }
    };
    const out = [`viewport=${vw} scrollWidth=${document.documentElement.scrollWidth}`];
    const offenders = Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.getBoundingClientRect().right > vw + 2 && el.getBoundingClientRect().width > 0);
    // The OUTERMOST offender is the cause; the rest are its children filling it.
    const outermost = offenders.filter((el) => !offenders.includes(el.parentElement));
    for (const el of outermost.slice(0, 3)) {
      out.push('OUTERMOST OFFENDER + ancestry (nearest first):');
      let p = el;
      while (p && p !== document.documentElement) { out.push('  ' + desc(p)); p = p.parentElement; }
    }
    return out.join('\n');
  });
  console.log(`\n════ ${path} ════\n${report}`);
}

await browser.close();
