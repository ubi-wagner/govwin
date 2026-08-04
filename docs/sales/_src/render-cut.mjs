import { chromium } from '/home/user/govwin/frontend/node_modules/playwright/index.mjs';
const SP='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:816,height:1056,deviceScaleFactor:2}});
await p.goto('file://'+SP+'/cutsheet.html',{waitUntil:'networkidle'});
await p.pdf({path:SP+'/RFP-Pipeline-Cut-Sheet.pdf',printBackground:true,preferCSSPageSize:true});
for(let i=0;i<2;i++){await p.locator('.sheet').nth(i).screenshot({path:`${SP}/cut${i+1}.png`});}
const heights=await p.evaluate(()=>[...document.querySelectorAll('.sheet')].map(s=>Math.round(s.getBoundingClientRect().height)));
console.log('sheet heights (1056=page):',heights.join(', '));
await b.close();
