import { chromium } from '/home/user/govwin/frontend/node_modules/playwright/index.mjs';
const SP = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 816, height: 1056, deviceScaleFactor: 2 } });
await p.goto('file://' + SP + '/sales.html', { waitUntil: 'networkidle' });
await p.pdf({ path: SP + '/RFP-Pipeline-Platform-Overview.pdf', printBackground: true, preferCSSPageSize: true });
await p.screenshot({ path: SP + '/sales-full.png', fullPage: true });
await b.close(); console.log('rendered');
