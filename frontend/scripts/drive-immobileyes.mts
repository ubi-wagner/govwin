import { chromium } from 'playwright';
const BASE='http://localhost:3000', PW='DemoPass123!';
function ok(c:boolean,l:string){console.log(`${c?'✅':'❌ FAIL'}  ${l}`);if(!c)process.exitCode=1;}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1680,height:1000},deviceScaleFactor:2}); const p=await ctx.newPage();
try{
  await ctx.clearCookies();
  await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});
  await p.fill('input[name="email"]','eric@rfppipeline.com'); await p.fill('input[name="password"]',PW);
  await Promise.all([p.waitForLoadState('networkidle'),p.click('button[type="submit"]')]); await p.waitForTimeout(1200);
  ok(p.url().includes('/admin'),`RFP admin on platform (${p.url()})`);
  // Descend into Immobileyes
  await p.goto(`${BASE}/portal/immobileyes/dashboard`,{waitUntil:'networkidle'}); await p.waitForTimeout(1500);
  ok(p.url().includes('/portal/immobileyes'),`descended into Immobileyes (${p.url()})`);
  const sess=await (await p.request.get(`${BASE}/api/auth/session`)).json();
  ok(sess?.user?.role==='master_admin',`still master_admin in shadow (got ${sess?.user?.role})`);
  const banner=await p.locator('text=Shadow admin').count();
  ok(banner>0,`shadow banner visible (${banner})`);
  await p.screenshot({path:'/home/user/govwin/docs/user-guides/img/immobileyes-shadow.png'});
  console.log('   📸 immobileyes-shadow.png');
}catch(e){console.error('ERR',e);process.exitCode=1;}finally{await b.close();}
