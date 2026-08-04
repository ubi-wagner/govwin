import fs from 'node:fs';
const SP='/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const DOC='5a1e5d0c-0000-4000-8000-000000000149';
const AUTHOR={id:'00000000-0000-4000-8000-000000000000',name:'RFP Pipeline'};
const NAVY='#1a1816',CORAL='#d44432',MUTE='#7a6d5e';
const TS='2026-08-04T00:00:00.000Z';
let seq=0; const nid=()=>`ov-${String(++seq).padStart(3,'0')}`;
const mk=(type,content,style={})=>({id:nid(),type,content,style,provenance:{source:'manual',drafted_by:AUTHOR.id,drafted_at:TS},history:[{actor_id:AUTHOR.id,actor_name:AUTHOR.name,action:'created',timestamp:TS}],library_eligible:!['divider','spacer'].includes(type)});
const H=(l,t,s={})=>mk('heading',{level:l,text:t},s);
const P=(t,s={})=>mk('text_block',{text:t},s);
const NL=i=>mk('numbered_list',{items:i.map(t=>({text:t}))});
const BL=i=>mk('bulleted_list',{items:i.map(t=>({text:t}))});
const DIV=()=>mk('divider',{color:CORAL,thickness:2,line_style:'solid'});
const CO=(v,ti,tx)=>mk('callout',{variant:v,title:ti,text:tx});
const TBL=(h,r)=>mk('table',{headers:h,rows:r,header_style:{bold:true,bg:NAVY},border_style:'single'});

const nodes=[
  H(1,'RFP Pipeline',{color:NAVY}),
  P('AI-Powered Proposal Management for Government Contractors',{color:CORAL,weight:'bold',size:15}),
  P('PLATFORM OVERVIEW · CAPABILITIES · APPLY · CURATE · DRAFT · WIN',{color:MUTE,size:9}),
  DIV(),
  P('Win non-dilutive federal R&D funding — without burning a month of payroll on every submission. RFP Pipeline pairs 25 years of hands-on expertise with isolated, company-specific AI, so you pursue more opportunities and submit better proposals. Purpose-built for SBIR, STTR, BAA, OTA, CSO, and grants — it carries you from a ranked opportunity to a submission-ready package in one connected workspace, with every step tracked and every AI action reviewed and approved by your team.'),
  TBL(['Federal Sources','Expert-Review SLA','Years Fed R&D','Human-Gated AI'],[['4+','72 hours','25+','100%']]),

  H(2,'Why RFP Pipeline — the opportunity & the economics',{color:NAVY}),
  P('There are billions each year in non-dilutive federal R&D funding — grant-like money you keep your equity and IP on. Most qualifying small businesses never apply, because the process is opaque, deadline-driven, and expensive to chase. RFP Pipeline makes it accessible.'),
  CO('success','Keep your equity and your IP.','Non-dilutive awards fund your R&D without giving up ownership — the cheapest capital a technical small business will ever raise.'),
  P('The old way is expensive and slow — usually a monitoring subscription, an outside consultant, and a month of payroll on every submission:'),
  TBL(['The status quo','What it costs you','RFP Pipeline'],[
    ['Opportunity monitoring service','~$5,000 / month for a feed you still triage','Included'],
    ['Proposal consultant','Commonly ~10% of the award as a success fee','Flat fee, no success fee'],
    ["Your team's time",'A month of payroll per submission, from scratch','Draft from your library']]),
  CO('info','The math.','RFP Pipeline replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $499/mo and a flat per-proposal fee. No success fee, ever.'),

  H(2,'How it works — the pursuit lifecycle',{color:NAVY}),
  NL([
    'Apply — daily, expert-curated ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals, ranked to your tech areas. Pin a fit, open a proposal portal.',
    'Curate — within a 72-hour SLA, an RFP expert provisions your build: the compliance matrix, required volumes, and section molds from the actual solicitation.',
    'Draft — your isolated, company-specific AI drafts every section from your library; your team revises in a stage-gated workspace with a live compliance matrix. AI is advisory.',
    'Win — export a compliant, submission-ready package. Record the outcome; a win starts your contract and feeds your library so winning content ranks higher next time.']),
  CO('note','A compounding advantage.','Because everything you draft is captured to your library with lineage, your second proposal is faster than your first — and your tenth is faster than your second.'),

  H(2,'Discover & prioritize',{color:NAVY}),
  P('Opportunity discovery & your ranked pipeline. Every federal opportunity lands on your Opportunity Pipeline, ranked for you, with agency, program type, close date, and a live submission-stage badge. Daily ingestion; AI ranks against your profile; deadline alerts fire before the clock runs out; pin to copy documents into your workspace.'),
  P('Scoring buckets — rank by your strategy. Define scoring buckets from keywords, agencies, program types, and NAICS codes. Transparent, per-factor scoring you can inspect; edit a bucket and the pipeline re-ranks instantly.'),
  P('Deadline & amendment awareness. Submission-stage badges and due dates on every card; an update-available strip when the agency revises a solicitation; alerts on your dashboard and notification bell.'),

  H(2,'Expert curation & isolated AI',{color:NAVY}),
  P('Expert-curated proposal workspaces. A real expert reads the solicitation and builds the skeleton within a 72-hour SLA; provisioning instantiates the compliance matrix + volume molds; a running Ask-the-Expert allowance covers the judgment calls AI cannot make.'),
  P('Your isolated, company-specific AI. Your AI is walled to your company: per-company isolation at the data layer, no model training on your content, structured memory grounding drafts in your prior work, and untrusted external content fenced away from the AI.'),
  P('Compliance built in from the first draft. Requirements are extracted into a live matrix; an AI compliance pass scores your proposal and flags gaps before an evaluator would; page-fill gauges track you against the agency limits.'),

  H(2,'Your library & workspace',{color:NAVY}),
  P('A reusable content library that compounds. Upload → auto-atomize → tag → reuse; capture content from any screen one-way; templify a past winning proposal. Your content is copied forward into each proposal, so retiring an item never disturbs a proposal already built from it.'),
  P('The proposal workspace & compliance matrix. A volume-and-section matrix, a stage-control bar with gate requirements, per-section accept-and-lock, and page-fill gauges. When a volume is fully locked its downloads light up; the live compliance matrix advances with every lock.'),
  P('Templates, versioning & a full audit trail. Save any proposal structure as a reusable skeleton; per-section version history with restore; every action posts to an audit trail.'),

  H(2,'The AI workforce',{color:NAVY}),
  P('An AI workforce works your proposal alongside your team — always advisory, always landing in review for your approval. It never submits, locks, or advances a stage on its own, and it is governed by budget, rate, and per-run cost caps you set.'),
  BL([
    'Proposal Studio — three gated loops (Draft, Refine, Compliance); review, comment, and approve at each gate, or run all three automatically.',
    'AI drafting & full-draft modes — first-draft empty sections, or the whole proposal in one pass (guided, restyle, or full-auto), in the voice you choose.',
    'Color-team review — a red/gold-team pass posting section-level recommendations into each thread.',
    'Compliance check — scores the proposal against the requirements, pass/fail/partial per item.',
    'Research scout — market research, prior art, and the competitor landscape into a cited brief (web results treated as untrusted data).',
    'Cost model — assembles your cost volume with live formulas.']),
  CO('info','Advisory by design.','Every AI output lands in review, redlined and reversible. Your team is the gate; the AI never advances past it on its own.'),

  H(2,'Collaborate, deliver & win',{color:NAVY}),
  P('Team & partner collaboration. Invite teammates and external partners with per-section, per-permission access (view / comment / edit). Segregated collaboration spaces wall off partner content; every contribution is attributed; deactivating a member revokes access instantly while keeping their history.'),
  P('Submission-ready deliverables. Export as Word, PDF, Excel (cost volumes with live formulas), or a per-volume ZIP — submission-formatted, figures and tables native, sections in true document order. A packaging review checks volume completeness, required forms, and format before you submit.'),
  P('Outcome & contract — the flywheel. Record Won / Lost / Withdrawn; a win instantiates a contract + kickoff; outcome signals re-weight your library so the platform gets sharper the more you use it.'),

  H(2,'Built for trust & control',{color:NAVY}),
  BL([
    'Isolated, company-specific AI — walled to your company; your context never crosses to another customer.',
    'No model training on your data — your proposals and library serve you, never a shared model.',
    'Multi-tenant isolation — your workspace, library, and proposals are structurally yours alone.',
    'Full audit trail — every action, by every person and every AI, is logged and traceable end to end.',
    'AI is advisory & human-gated — it proposes; your team approves. It never auto-writes, submits, or locks.',
    'Governed AI — budget, rate, and per-run cost caps keep AI usage predictable and under your control.',
    'Injection-fenced — untrusted external content is treated as data, never instructions the AI will follow.']),
  CO('success','Proven, not theoretical.','The end-to-end flow — discover, curate, draft, comply, export, win — has been verified on real DoD SBIR builds, including a NAVAIR/NAVSEA counter-UAS topic, from a ranked opportunity to a submission-ready, downloadable package.'),

  H(2,'Plans & who does what',{color:NAVY}),
  TBL(['Plan','Price','What is included'],[
    ['Spotlight Subscription (required, monthly)','$499 / mo','Daily ingestion; AI ranking; expert-curated compliance matrix; deadline alerts; 15 min Ask-the-Expert/mo (rolls over). Required to purchase any portal; 3-month minimum.'],
    ['Phase I — Like Effort (per proposal)','$1,999 ea','SBIR/STTR Phase I, smaller BAA, OTA/CSO short-form. 72-hour expert curation. Stage-gated workspace. Custom AI drafting.'],
    ['Phase II — Like Effort (per proposal)','$4,999 ea','SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20-50+ page tech volumes. Commercialization plans. $3,999 with a linked Phase I.']]),
  P('No success fee, ever. Flat, predictable pricing that replaces a $5,000/mo monitoring service and a 10%-of-award consultant.',{color:MUTE,size:10}),
  TBL(['Role','What they do'],[
    ['Company Admin','Runs the company workspace — opens pursuits, invites the team, and drives the build from opportunity to submission.'],
    ['Team Member','Contributes to assigned proposals and sections, within the access their admin grants.'],
    ['External Partner','Stage-scoped access to a specific proposal — view, comment, or edit only where invited.'],
    ['RFP Pipeline Expert','Curates the solicitation and provisions your build behind the scenes, so you start on-structure.']]),
  DIV(),
  CO('success','From opportunity to award','From a ranked opportunity to a submission-ready, compliant proposal — RFP Pipeline gives government contractors an AI-accelerated pursuit process, with your team in control at every gate. Book a walkthrough on one of your own target opportunities, or apply for the Founding Cohort.'),
];

const canvas={version:1,document_id:DOC,
  canvas:{format:'letter',width:612,height:792,margins:{top:72,right:72,bottom:72,left:72},header:null,footer:null,font_default:{family:'Calibri',size:11},line_spacing:1.2,max_pages:null,max_slides:null},
  nodes,
  metadata:{title:'RFP Pipeline — Platform Overview & Capabilities',volume_id:'',required_item_id:'',proposal_id:'',solicitation_id:'',created_at:TS,last_modified_at:TS,last_modified_by:AUTHOR.id,version_number:1,status:'in_progress'}};
fs.writeFileSync(`${SP}/canvas-seed.json`,JSON.stringify(canvas));
console.log('canvas nodes:',nodes.length,'| bytes:',JSON.stringify(canvas).length,'| doc',DOC);
