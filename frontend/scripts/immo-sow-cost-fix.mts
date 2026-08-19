/** Propagate the corrected Phase I structure (4 months / 120 days, single period, deliverables end at
 *  Day 120 with Final Report + Phase II Proposal) into the SOW (§4), the cost volume period (§14), and
 *  the option note (§15). */
import { randomUUID as uuid } from 'crypto';
import { buildCostVolume } from '@/lib/proposal/cost-forms';
import { computeBudget } from '@/lib/proposal/cost-model';
import type { LaborLine, OtherDirectCost, IndirectRates } from '@/lib/proposal/cost-model';
import { sqlBypass as sql } from '@/lib/db';
const P='d4b6de67-eb3a-482b-84eb-4b0457687f19';
const N=(type:string,content:unknown,style:Record<string,unknown>={})=>({id:uuid(),type,content,style:{space_before:6,space_after:6,...style},provenance:{source:'manual'},history:[],library_eligible:true});
const h=(text:string,level=2,numbering?:string)=>N('heading',{level,text,...(numbering?{numbering}:{})},{space_before:12,space_after:6});
const p=(text:string)=>N('text_block',{text});
const ul=(items:string[])=>N('bulleted_list',{items:items.map(text=>({text}))});
const table=(headers:string[],rows:string[][])=>N('table',{headers,rows,border_style:'single',header_style:{bold:true,bg:'#1f3a5f',fg:'#ffffff'}});
const cap=(prefix:string,number:number,text:string)=>N('caption',{prefix,number,text},{alignment:'center',space_after:10});

// ── §4 Statement of Work — 4-month / 120-day Phase I ──
const sow = { version:1, canvas:null, metadata:{title:'Phase I Statement of Work', status:'complete'}, nodes:[
  h('1.2 Phase I Statement of Work',1,'1.2'),
  p('The Phase I effort is a single 4-month (120-day) period of performance, not to exceed $250,000. All work is performed at Immobileyes’ Kent, OH facility; no foreign nationals perform on this ITAR-restricted effort. The effort culminates at Day 120 in a Final Technical Report and an Initial Phase II Proposal.'),
  table(['Task','Title and Description','Timeframe','Performer / Deliverable'],[
    ['1','System Definition & Feasibility Assessment: establish the Group 1–2 EO-guided fiber-optic threat set, catalog representative FPV/EO cameras and current Navy C-UAS gaps, and convert them into system requirements, use cases, and evaluation criteria.','Month 1','Immobileyes — Kick-Off Briefing'],
    ['2','System Architecture & Design: preliminary STORM/DEXTER architecture, the STORM↔DEXTER interface, PerceptView EO-tracking integration, MOSA interfaces, and engagement algorithms (Warn / Dazzle / Deny; single- and multi-beam).','Months 1–2','Immobileyes + AMI — Progress Report'],
    ['3','Optical Countermeasure Feasibility Evaluation: analytical modeling and laboratory characterization of representative EO cameras — saturation, blooming, false-feature generation, contrast degradation, and tracking instability — establishing the engagement envelope to misguide EO-guided fiber-optic FPV drones.','Months 2–4','Immobileyes — Test Data & Analysis Report'],
    ['4','Transition Assessment & Phase I Reporting: consolidate the analytical, software, and laboratory results; define the preliminary Phase II prototype architecture and V&V approach; document performance improvements and residual risk.','Month 4 (Day 120)','Immobileyes — Final Technical Report + Initial Phase II Proposal'],
  ]),
  cap('Table',3,'Phase I (120-day) Statement of Work.'),
  h('Task Approach',3),
  p('Task 1 (Month 1) establishes the threat set and converts it into requirements, use cases, performance metrics, and evaluation criteria presented at the Kick-Off Briefing. Task 2 (Months 1–2) develops the preliminary STORM/DEXTER architecture — the STORM↔DEXTER interface, PerceptView integration, the optical-engagement concept, and engagement algorithms that select the optical response from target range, aspect, camera orientation, closing velocity, and dwell. Task 3 (Months 2–4) performs analytical modeling and laboratory characterization of representative EO cameras to quantify laser-induced saturation, blooming, false-feature generation, and contrast degradation, determining the engagement envelope required to misguide EO-guided FPV drones while minimizing laser power. Task 4 (Month 4 / Day 120) integrates the results into the Final Technical Report, defines the preliminary Phase II prototype architecture and V&V approach, and prepares the Initial Phase II Proposal and NAVAIR/NAVSEA transition plan.'),
  h('Phase I Deliverables',3),
  ul([
    'Kick-Off Briefing (Month 1).',
    'Progress Report.',
    'Final Technical Report — due at Day 120 — documenting the STORM and DEXTER baseline, the Navy C-UAS capability gaps addressed, required modifications, the feasibility assessment, and expected performance improvements.',
    'Initial Phase II Proposal — due at Day 120 — with the initial transition and commercialization framework.',
  ]),
]};
// preserve §4's own canvas frame
const [s4]=await sql`SELECT content FROM proposal_sections WHERE proposal_id=${P} AND section_number='4' LIMIT 1`;
sow.canvas=JSON.parse((s4 as any).content).canvas;
await sql`UPDATE proposal_sections SET content=${JSON.stringify(sow)}, updated_at=now() WHERE proposal_id=${P} AND section_number='4'`;
console.log('✓ §4 SOW → 4-month / 120-day Phase I (4 tasks, deliverables end Day 120)');

// ── §14 cost — relabel the period to 4 months / 120 days ──
const rates:IndirectRates={fringePct:0.35,overheadPct:0.60,gnaPct:0.40,feePct:0.05,gnaAppliesToOverhead:false};
const labor:LaborLine[]=[
  {name:'Atossa Alavi',category:'Chief Executive / Principal Investigator',hours:500,unburdenedRate:50},
  {name:'Dr. Bahman Taheri',category:'Physicist / Chief Scientist',hours:325,unburdenedRate:63},
  {name:'Electrical Engineer',category:'Electrical Engineer',hours:250,unburdenedRate:45},
  {name:'Dr. Christopher Lukowski',category:'Engineers, All Other / Senior Optics Engineer',hours:325,unburdenedRate:50},
  {name:'Software Engineer',category:'Software Developer',hours:206,unburdenedRate:45},
];
const odcs:OtherDirectCost[]=[
  {kind:'materials',label:'Modeling, Analysis & Testing Components (AlphaMicron)',amount:8000},
  {kind:'travel',label:'Phase I Onsite Meetings — Kent, OH → NAS Patuxent River / NAVAIR (2 pax)',amount:2288},
];
const meta={title:'Phase I Cost Volume',agency:'Navy',program:'sbir',companyName:'Immobileyes, Inc.',solicitationNumber:'DON26BX03-NP002',topicNumber:'DON26BX03-NP002',ceiling:250000,proposalId:P};
const wb=buildCostVolume('burden_waterfall',meta,{labor,rates,odcs,subs:[],periods:[{name:'Phase I (4 mo / 120 days)',months:4}]});
const b=computeBudget(labor,rates,{odcs,subs:[],ceiling:250000,program:'sbir'});
console.log(`cost total $${b.grand.totalPrice.toFixed(2)} ≤ $250,000 · 4-month PoP`);
const s14={version:1,canvas:(wb as any).canvas,metadata:{...(wb as any).metadata,status:'complete'},nodes:(wb as any).nodes};
await sql`UPDATE proposal_sections SET content=${JSON.stringify(s14)}, updated_at=now() WHERE proposal_id=${P} AND section_number='14'`;
const opt={version:1,canvas:(wb as any).canvas,metadata:{title:'Phase I Option Cost Proposal',status:'complete'},nodes:[
  N('heading',{level:1,text:'Phase I Option Cost Proposal'},{}),
  N('text_block',{text:'No separately-priced Phase I Option is proposed. The full Phase I effort is a single 4-month (120-day) period of performance costed in the Base Cost Proposal (§14), not to exceed the $250,000 Phase I ceiling, culminating at Day 120 in the Final Report and Initial Phase II Proposal.'},{}),
]};
await sql`UPDATE proposal_sections SET content=${JSON.stringify(opt)}, updated_at=now() WHERE proposal_id=${P} AND section_number='15'`;
console.log('✓ §14/§15 → 4-month period, $250K ceiling');
await sql.end();
