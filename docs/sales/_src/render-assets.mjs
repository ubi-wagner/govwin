import { chromium } from '/home/user/govwin/frontend/node_modules/playwright/index.mjs';
const SP='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:900,height:1200,deviceScaleFactor:3}});
await p.goto('file://'+SP+'/assets.html',{waitUntil:'networkidle'});
await p.locator('#logo').screenshot({path:`${SP}/assets/logo.png`});
for(const n of ['non-dilutive','automation','radar','expert','library','agent','collaboration','shield','funding','trophy']){
  await p.locator('#ic-'+n).screenshot({path:`${SP}/assets/ic-${n}.png`,omitBackground:false});
}
await b.close();console.log('assets rendered');
