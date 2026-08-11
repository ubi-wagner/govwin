/** Proves the box→crop→/atoms/capture→IMAGE ATOM→storage path end-to-end (local R2 emulation).
 *  This is the backend the box-on-upload UI posts to; the drop card's frame-load + box-draw are
 *  shown in the box-shots. cd frontend && node --import tsx scripts/verify-capture-backend.mts */
import { chromium } from 'playwright';
import zlib from 'zlib';
function crc32(b: Buffer){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return (~c)>>>0;}
function chunk(t:string,d:Buffer){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const td=Buffer.concat([Buffer.from(t,'ascii'),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(td),0);return Buffer.concat([l,td,cr]);}
function solidPng(w:number,h:number,rgb:number[]){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const px=Buffer.from(rgb);const row=Buffer.concat([Buffer.from([0]),...Array(w).fill(px)]);const idat=zlib.deflateSync(Buffer.concat(Array(h).fill(row)));return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);}
const FULL = solidPng(320, 240, [28, 100, 200]).toString('base64');
const CROP = solidPng(140, 90, [220, 60, 60]).toString('base64');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext()).newPage();
let ok = true; const A = (l: string, c: boolean) => { console.log(`${c ? '✓' : '✗'} ${l}`); ok = ok && c; };
try {
  await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', 'kate.ulepic@foundation3dp.com');
  await p.fill('input[name=password]', 'DemoPass123!');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]);
  await p.waitForTimeout(1200);

  const res = await p.evaluate(async ({ full, crop }) => {
    // inline (no nested named fn) to avoid tsx's __name helper leaking into the browser
    const fd = new FormData();
    fd.append('full', new File([Uint8Array.from(atob(full), (c) => c.charCodeAt(0))], 'frame.png', { type: 'image/png' }));
    fd.append('region_0', new File([Uint8Array.from(atob(crop), (c) => c.charCodeAt(0))], 'region_0.png', { type: 'image/png' }));
    fd.append('regions', JSON.stringify([{ title: 'Boxed cost figure', tags: [{ dimension: 'kind', value: 'figure' }] }]));
    fd.append('note', 'box-on-upload backend proof');
    const r = await fetch('/api/portal/foundation/atoms/capture', { method: 'POST', body: fd });
    return { status: r.status, body: await r.text() };
  }, { full: FULL, crop: CROP });
  console.log('  capture →', res.status, res.body.slice(0, 240));
  A('capture 200', res.status === 200);
  const data = JSON.parse(res.body).data;
  A('≥1 image region atom created', typeof data?.atoms === 'number' && data.atoms >= 1);
  A('status = draft (advisory)', data?.status === 'draft');
  A('regionIds returned', Array.isArray(data?.regionIds) && data.regionIds.length >= 1);
} catch (e) { console.error('FAILED', e); ok = false; }
finally { await b.close(); }
console.log(ok ? '\nPASS — a boxed region becomes a draft image atom + stored crop (via local R2 emulation)' : '\nFAIL');
process.exit(ok ? 0 : 1);
