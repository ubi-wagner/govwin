/** Live drive: box an uploaded image → image atom (the "worst-case baseline" ingest).
 *  Upload a PNG into the Capture tab → draw a box → Atomize → verify an image atom lands
 *  (storage via the local R2 emulation). cd frontend && node --import tsx scripts/drive-box-upload.mts */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
import zlib from 'zlib';

// ── minimal solid-color PNG (no deps) so we have a real image to box ──
function crc32(buf: Buffer): number { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; }
function chunk(type: string, data: Buffer): Buffer { const l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td), 0); return Buffer.concat([l, td, cr]); }
function solidPng(w: number, h: number, rgb: number[]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const px = Buffer.from(rgb); const row = Buffer.concat([Buffer.from([0]), ...Array(w).fill(px)]);
  const idat = zlib.deflateSync(Buffer.concat(Array(h).fill(row)));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = solidPng(320, 240, [28, 100, 200]);

const OUT = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/box-shots';
mkdirSync(OUT, { recursive: true });
const shot = async (p: Page, n: string) => { await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: true }); console.log(`  📸 ${n}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1.3 })).newPage();
p.setDefaultTimeout(25000);
const errors: string[] = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await p.fill('input[name="email"]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name="password"]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1200);

  await p.goto('http://localhost:3000/portal/foundation/atoms?tab=capture', { waitUntil: 'networkidle' });
  await p.getByText(/Box an uploaded image/).first().waitFor({ timeout: 25000 });
  await shot(p, 'box-00-capture-tab');

  // Upload the image → becomes the frame.
  await p.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'cost-figure.png', mimeType: 'image/png', buffer: PNG });
  const overlay = p.locator('div.cursor-crosshair');
  await overlay.waitFor({ timeout: 25000 });
  await p.waitForTimeout(500);
  await shot(p, 'box-01-frame-loaded');

  // Draw a box over part of the frame.
  const bb = await overlay.boundingBox();
  if (!bb) throw new Error('no overlay box');
  await p.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height * 0.25);
  await p.mouse.down();
  await p.waitForTimeout(200);                                                   // let setDrag re-render land
  await p.mouse.move(bb.x + bb.width * 0.45, bb.y + bb.height * 0.5, { steps: 6 });
  await p.waitForTimeout(120);
  await p.mouse.move(bb.x + bb.width * 0.7, bb.y + bb.height * 0.75, { steps: 6 });
  await p.waitForTimeout(120);
  await p.mouse.up();
  await p.getByText(/1 region\(s\)/).first().waitFor({ timeout: 10000 });
  await shot(p, 'box-02-region-drawn');

  // Atomize.
  await p.getByRole('button', { name: /Atomize 1 region\(s\)/ }).click();
  await p.getByText(/Atomized 1 region\(s\)/).waitFor({ timeout: 25000 });
  const msg = await p.getByText(/Atomized 1 region\(s\)/).innerText();
  console.log(`  result: "${msg}"`);
  await shot(p, 'box-03-atomized');

  console.log(`\nconsole errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ⚠️ ${e}`));
} catch (e) { console.error('FAILED:', e); await shot(p, 'box-99-fail').catch(() => {}); process.exitCode = 1; }
finally { await b.close(); }
