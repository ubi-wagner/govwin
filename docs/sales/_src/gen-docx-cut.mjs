import { createRequire } from 'module';
const require = createRequire('/home/user/govwin/frontend/index.js');
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, LevelFormat, Footer, Tab, PageNumber } = require('docx');
import fs from 'node:fs';
const SP='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const A=n=>fs.readFileSync(`${SP}/assets/${n}.png`);
const CORAL='d44432',CORALL='e85d4a',INK='1a1816',INK8='2d2a27',INK5='7a6d5e',GREEN='2d8b4e',CREAM='f5f0e8',CREAM50='faf8f4',RULE='dfd2bc',WHITE='FFFFFF';
const SANS='Calibri',SERIF='Georgia';
const PW=12240,MARG=1000,CW=PW-MARG*2;
const run=(t,o={})=>new TextRun({text:t,font:o.serif?SERIF:SANS,color:o.color||INK8,size:o.size||19,bold:!!o.bold,italics:!!o.i});
const P=(c,o={})=>new Paragraph({children:Array.isArray(c)?c:[c],spacing:{after:o.after??100,before:o.before??0},alignment:o.align});
const band=(iconName,title)=>new Table({columnWidths:[CW],width:{size:CW,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},rows:[new TableRow({children:[new TableCell({shading:{type:ShadingType.CLEAR,color:'auto',fill:INK},margins:{top:80,bottom:80,left:150,right:150},children:[new Paragraph({children:[new ImageRun({type:'png',data:A(`ic-${iconName}`),transformation:{width:16,height:16}}),new TextRun({text:'  '+title,font:SANS,bold:true,color:WHITE,size:24})]})]})]})]});
const callout=(title,text,green)=>new Table({columnWidths:[CW],width:{size:CW,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE},insideHorizontal:{style:BorderStyle.NONE},insideVertical:{style:BorderStyle.NONE},left:{style:BorderStyle.SINGLE,size:22,color:green?GREEN:CORAL}},rows:[new TableRow({children:[new TableCell({shading:{type:ShadingType.CLEAR,color:'auto',fill:green?'edf7f0':CREAM},margins:{top:100,bottom:100,left:170,right:150},children:[new Paragraph({children:[run(title+' ',{bold:true,color:INK}),run(text,{color:INK5})]})]})]})]});
const tbl=(headers,rows,widths)=>{const hdr=new TableRow({tableHeader:true,children:headers.map((h,i)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},shading:{type:ShadingType.CLEAR,color:'auto',fill:INK},margins:{top:60,bottom:60,left:120,right:120},children:[P(run(h,{bold:true,color:WHITE,size:17}),{after:0})]}))});const body=rows.map((r,ri)=>new TableRow({children:r.map((c,i)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},shading:{type:ShadingType.CLEAR,color:'auto',fill:ri%2?CREAM50:WHITE},margins:{top:60,bottom:60,left:120,right:120},children:[P(run(c,{color:i===0?INK:INK5,bold:i===0,size:17}),{after:0})]}))}));return new Table({columnWidths:widths,width:{size:CW,type:WidthType.DXA},borders:{top:{style:BorderStyle.SINGLE,size:4,color:RULE},bottom:{style:BorderStyle.SINGLE,size:4,color:RULE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE},insideHorizontal:{style:BorderStyle.SINGLE,size:4,color:RULE},insideVertical:{style:BorderStyle.SINGLE,size:4,color:RULE}},rows:[hdr,...body]});};
const bullet=(b,r)=>new Paragraph({numbering:{reference:'b',level:0},spacing:{after:70},children:[run(b+' ',{bold:true,color:INK}),run(r,{color:INK5})]});
const gap=(h=100)=>new Paragraph({spacing:{after:h},children:[]});
const k=[];
k.push(new Paragraph({spacing:{after:40},children:[new ImageRun({type:'png',data:A('logo'),transformation:{width:220,height:88}})]}));
k.push(P(run('AI + EXPERT · FROM APPLICATION TO SUBMISSION',{bold:true,color:CORAL,size:16}),{after:50,before:100}));
k.push(new Paragraph({spacing:{after:60},children:[run('A proposal engine, ',{bold:true,color:INK,size:40}),new TextRun({text:'not a proposal gamble.',font:SERIF,italics:true,color:CORALL,size:40})]}));
k.push(P([run('Win non-dilutive federal R&D funding — ',{color:INK5,size:20}),run('without burning a month of payroll on every submission.',{bold:true,color:INK,size:20}),run(' 25 years of hands-on expertise + isolated, company-specific AI. Built for SBIR · STTR · BAA · OTA · CSO · Grants.',{color:INK5,size:20})],{after:140}));
k.push(tbl(['Federal Sources','Expert-Review SLA','Years Fed R&D','Human-Gated AI'],[['4+','72 hours','25+','100%']],[CW/4,CW/4,CW/4,CW/4]));
k.push(gap(140));
k.push(P(run('Billions a year in non-dilutive funding — kept off most companies’ radar',{bold:true,color:INK,size:22}),{after:50}));
k.push(P(run('Grant-like money you keep your equity and IP on. Most qualifying small businesses never apply — the process is opaque, deadline-driven, and expensive to chase. RFP Pipeline makes it accessible.',{color:INK5}),{after:100}));
k.push(tbl(['The status quo','What it costs you','RFP Pipeline'],[['Opportunity monitoring','~$5,000 / month for a feed you still triage','Included'],['Proposal consultant','Commonly ~10% of the award as a success fee','Flat fee, no success fee'],["Your team’s time",'A month of payroll per submission, from scratch','Draft from your library']],[2600,4360,2400]));
k.push(gap(40));
k.push(callout('The math.','Replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $499/mo and a flat per-proposal fee. No success fee, ever.'));
k.push(gap(160));
k.push(band('library','What you get — the platform at a glance'));
k.push(gap(80));
[['Discovery & ranked pipeline —','daily ingestion across SAM.gov, SBIR.gov, Grants.gov & agency portals, ranked to your tech areas.'],
 ['Scoring buckets —','rank the whole pipeline by your own keywords, agencies, program types & NAICS — transparent, per-factor.'],
 ['Expert curation (72h SLA) —','a real expert provisions your compliance matrix, volumes & section molds from the solicitation.'],
 ['Isolated, company-specific AI —','walled to your company. No model training on your data. Injection-fenced.'],
 ['Reusable content library —','upload → atomize → reuse; copied forward into every proposal.'],
 ['Workspace & compliance matrix —','stage-gated build, per-section accept-and-lock, live requirement coverage & page-fill gauges.'],
 ['Proposal Studio (AI workforce) —','Draft → Refine → Compliance, gated; you approve at each step, or run all three automatically.'],
 ['AI review & compliance check —','color-team recommendations per section + pass/fail/partial requirement scoring.'],
 ['Submission-ready exports —','Word, PDF, Excel (live formulas) & per-volume ZIP + a packaging-completeness review.'],
 ['Outcome → contract —','a win starts your contract + kickoff; every result sharpens your library for the next bid.']]
 .forEach(([b,r])=>k.push(bullet(b,r)));
k.push(gap(40));
k.push(P(run('Trust & control: multi-tenant isolation · no model training on your data · full audit trail · AI advisory & human-gated · injection-fenced · governed AI (budget/rate caps).',{i:true,color:INK5,size:18}),{after:150}));
k.push(P(run('Simple, flat pricing — no success fee, ever',{bold:true,color:INK,size:22}),{after:50}));
k.push(tbl(['Plan','Price','Included'],[['Spotlight Subscription (required, monthly)','$499 / mo','Daily ingestion, AI ranking, expert-curated compliance matrix, deadline alerts, 15 min Ask-the-Expert/mo. Required to buy any portal; 3-mo min.'],['Phase I — Like Effort (per proposal)','$1,999 ea','SBIR/STTR Phase I, smaller BAA, OTA/CSO short-form. 72-hour expert curation, stage-gated workspace, custom AI drafting.'],['Phase II — Like Effort (per proposal)','$4,999 ea','SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20–50+ pp volumes. $3,999 with a linked Phase I.']],[3050,1400,4910]));
k.push(new Paragraph({border:{top:{style:BorderStyle.SINGLE,size:14,color:CORAL,space:8}},spacing:{before:120,after:30},children:[new TextRun({text:'From a ranked opportunity to a submission-ready, compliant proposal — your team in control at every gate.',font:SERIF,italics:true,color:INK,size:22})]}));
k.push(P(run('Book a walkthrough on one of your own target opportunities, or apply for the Founding Cohort. Platform launches August 2026.',{color:INK5,size:18})));
const doc=new Document({creator:'RFP Pipeline',title:'RFP Pipeline — Platform Cut Sheet',
  numbering:{config:[{reference:'b',levels:[{level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.START,style:{run:{color:CORAL},paragraph:{indent:{left:320,hanging:190}}}}]}]},
  sections:[{properties:{page:{size:{width:PW,height:15840},margin:{top:MARG,bottom:900,left:MARG,right:MARG}}},
    footers:{default:new Footer({children:[new Paragraph({border:{top:{style:BorderStyle.SINGLE,size:4,color:RULE,space:6}},tabStops:[{type:'right',position:CW}],children:[new TextRun({text:'RFP Pipeline · Platform Cut Sheet',font:SANS,size:14,color:'968775'}),new TextRun({children:[new Tab(),'Page '],font:SANS,size:14,color:'968775'}),new TextRun({children:[PageNumber.CURRENT],font:SANS,size:14,color:'968775'})]})]})},
    children:k}]});
fs.writeFileSync(`${SP}/RFP-Pipeline-Cut-Sheet.docx`,await Packer.toBuffer(doc));
console.log('wrote cut-sheet docx,',k.length,'blocks');
