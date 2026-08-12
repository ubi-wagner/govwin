/** Full server round-trip: upload an image → putObject(local) → getSignedGetUrl → serving route serves bytes. */
import { chromium } from 'playwright';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_LEN = Buffer.from(PNG_B64, 'base64').length;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext()).newPage();
let ok = true; const A = (l: string, c: boolean) => { console.log(`${c ? '✓' : '✗'} ${l}`); ok = ok && c; };
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name=password]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
  await p.waitForTimeout(1500);
  console.log('  post-login url:', p.url());

  const up = await p.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('file', new File([bytes], 'boxed-region.png', { type: 'image/png' }));
    const res = await fetch('/api/portal/foundation/uploads/image', { method: 'POST', body: fd });
    return { status: res.status, body: await res.text() };
  }, PNG_B64);
  console.log('  upload →', up.status, up.body.slice(0, 200));
  A('upload 200', up.status === 200);
  const data = JSON.parse(up.body).data;
  A('storageKey returned', typeof data?.storageKey === 'string' && data.storageKey.includes('customers/foundation/images/'));
  A('url is the local serving route', typeof data?.url === 'string' && data.url.startsWith('/api/storage/local/'));

  const got = await p.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, len: (await r.arrayBuffer()).byteLength, ct: r.headers.get('content-type') };
  }, data.url);
  console.log('  served →', got);
  A('served 200', got.status === 200);
  A('served bytes match uploaded PNG', got.len === PNG_LEN);
  A('served content-type image/png', got.ct === 'image/png');
} catch (e) { console.error('FAILED', e); ok = false; }
finally { await b.close(); }
console.log(ok ? '\nPASS — image round-trips through the local R2 emulation, server-side' : '\nFAIL');
process.exit(ok ? 0 : 1);
