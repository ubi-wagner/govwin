import { createRequire } from 'module';
const require = createRequire('/home/user/govwin/frontend/index.js');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType,
  ShadingType, BorderStyle, AlignmentType, LevelFormat, Footer, PageNumber, Tab,
} = require('docx');
import fs from 'node:fs';

const SP = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad';
const A = (n) => fs.readFileSync(`${SP}/assets/${n}.png`);

// palette
const CORAL = 'd44432', CORALL = 'e85d4a', INK = '1a1816', INK8 = '2d2a27', INK5 = '7a6d5e',
      GREEN = '2d8b4e', CREAM = 'f5f0e8', CREAM50 = 'faf8f4', RULE = 'dfd2bc', WHITE = 'FFFFFF';
const SANS = 'Calibri', SERIF = 'Georgia';
const PW = 12240, MARG = 1080, CW = PW - MARG * 2; // US Letter, 0.75" margins

const run = (t, o = {}) => new TextRun({ text: t, font: o.serif ? SERIF : SANS, color: o.color || INK8, size: o.size || 20, bold: !!o.bold, italics: !!o.i });
const P = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: o.after ?? 120, before: o.before ?? 0, line: o.line }, alignment: o.align });
const icon = (n, px = 15) => new ImageRun({ type: 'png', data: A(`ic-${n}`), transformation: { width: px, height: px } });

// section band: shaded ink single cell with icon + title (+ kicker)
function band(iconName, title, kicker) {
  return new Table({
    columnWidths: [CW], width: { size: CW, type: WidthType.DXA },
    borders: allBorders('none'),
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: INK }, margins: { top: 90, bottom: 90, left: 160, right: 160 },
      children: [new Paragraph({ tabStops: [{ type: 'right', position: CW - 320 }], children: [
        new ImageRun({ type: 'png', data: A(`ic-${iconName}`), transformation: { width: 17, height: 17 } }),
        new TextRun({ text: '  ' + title, font: SANS, bold: true, color: WHITE, size: 27 }),
        ...(kicker ? [new TextRun({ children: [new Tab()], font: SANS }), new TextRun({ text: kicker, font: SANS, color: '968775', size: 15, bold: true, allCaps: true })] : []),
      ] })],
    })] })],
  });
}
const allBorders = (style) => {
  const b = style === 'none' ? { style: BorderStyle.NONE } : { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
};
const h3 = (t) => P(run(t, { bold: true, color: INK, size: 24 }), { after: 40, before: 60 });
const bodyP = (t) => P(run(t, { color: INK5 }), { after: 100 });
// capability: heading + desc + how-it-works
const cap = (title, desc, how) => [h3(title), bodyP(desc), P([run('How it works: ', { bold: true, color: INK, size: 18 }), run(how, { color: INK5, size: 18 })], { after: 160 })];
function bullet(boldLabel, rest) { return new Paragraph({ numbering: { reference: 'b', level: 0 }, spacing: { after: 80 }, children: [run(boldLabel + ' ', { bold: true, color: INK }), run(rest, { color: INK5 })] }); }
function callout(title, text, green) {
  return new Table({
    columnWidths: [CW], width: { size: CW, type: WidthType.DXA },
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }, left: { style: BorderStyle.SINGLE, size: 24, color: green ? GREEN : CORAL } },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: green ? 'edf7f0' : CREAM }, margins: { top: 110, bottom: 110, left: 180, right: 160 },
      children: [new Paragraph({ children: [run(title + ' ', { bold: true, color: INK }), run(text, { color: INK5 })] })],
    })] })],
  });
}
function tbl(headers, rows, widths) {
  const hdr = new TableRow({ tableHeader: true, children: headers.map((h, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: INK }, margins: { top: 70, bottom: 70, left: 130, right: 130 }, children: [P(run(h, { bold: true, color: WHITE, size: 18 }), { after: 0 })] })) });
  const body = rows.map((r, ri) => new TableRow({ children: r.map((c, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: ri % 2 ? CREAM50 : WHITE }, margins: { top: 70, bottom: 70, left: 130, right: 130 }, children: [P(run(c, { color: i === 0 ? INK : INK5, bold: i === 0, size: 18 }), { after: 0 })] })) }));
  return new Table({ columnWidths: widths, width: { size: CW, type: WidthType.DXA }, borders: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: RULE } }, rows: [hdr, ...body] });
}
const gap = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

const kids = [];
// ── Masthead / cover ──
kids.push(new Paragraph({ spacing: { after: 60 }, children: [new ImageRun({ type: 'png', data: A('logo'), transformation: { width: 250, height: 100 } })] }));
kids.push(P(run('AI + EXPERT  ·  FROM APPLICATION TO SUBMISSION', { bold: true, color: CORAL, size: 17 }), { after: 60, before: 120 }));
kids.push(new Paragraph({ spacing: { after: 40 }, children: [run('A proposal engine, ', { bold: true, color: INK, size: 52 }), new TextRun({ text: 'not a proposal gamble.', font: SERIF, italics: true, color: CORALL, size: 52 })] }));
kids.push(P(new TextRun({ text: 'Win non-dilutive federal R&D funding — without burning a month of payroll on every submission. We pair 25 years of hands-on expertise with isolated, company-specific AI, so you pursue more opportunities and submit better proposals.', font: SERIF, italics: true, color: '45403a', size: 26 }), { after: 140, line: 300 }));
kids.push(P(run('SBIR  ·  STTR  ·  BAA  ·  OTA  ·  CSO  ·  Grants / NOFO', { bold: true, color: INK, size: 20 }), { after: 160 }));
kids.push(tbl(['Federal Sources', 'Expert-Review SLA', 'Years Fed R&D', 'Human-Gated AI'], [['4+', '72 hours', '25+', '100%']], [CW / 4, CW / 4, CW / 4, CW / 4]));
kids.push(gap(200));

// ── Why ──
kids.push(band('non-dilutive', 'Why RFP Pipeline', 'Opportunity & economics')); kids.push(gap(120));
kids.push(h3('Billions a year in non-dilutive funding — most of it left on the table'));
kids.push(bodyP('There are billions each year in non-dilutive federal R&D funding — grant-like money you keep your equity and IP on. Most qualifying small businesses never apply, because the process is opaque, deadline-driven, and expensive to chase. RFP Pipeline makes it accessible: it finds the right opportunities, pairs you with an expert, and turns your best work into compliant, winning proposals.'));
kids.push(callout('Keep your equity and your IP.', 'Non-dilutive awards fund your R&D without giving up ownership — the cheapest capital a technical small business will ever raise.', true)); kids.push(gap(120));
kids.push(h3('The old way is slow, and it’s expensive'));
kids.push(tbl(['The status quo', 'What it costs you', 'RFP Pipeline'], [
  ['Opportunity monitoring service', '~$5,000 / month for a feed you still have to triage', 'Included'],
  ['Proposal consultant', 'Commonly ~10% of the award as a success fee', 'Flat fee, no success fee'],
  ['Your team’s time', 'A month of payroll per submission, from scratch', 'Draft from your library'],
], [3100, 4260, 2000]));
kids.push(gap(80));
kids.push(callout('The math.', 'RFP Pipeline replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $499/mo and a flat per-proposal fee. No success fee, ever.'));
kids.push(gap(200));

// ── Lifecycle ──
kids.push(band('automation', 'How it works — the pursuit lifecycle', 'Apply · Curate · Draft · Win')); kids.push(gap(120));
[['1 · Apply — find the right opportunity', 'Daily, expert-curated ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals — ranked to your tech areas. Deadline alerts keep you ahead of the clock. Pin a fit to pull its documents in, then open a proposal portal.'],
 ['2 · Curate — an expert sets you up to win', 'Within a 72-hour SLA, an RFP expert curates the solicitation and provisions your build — the compliance matrix, the required volumes, and the section molds — straight from the actual solicitation.'],
 ['3 · Draft — your isolated AI + your team', 'Your company-specific, isolated AI drafts every section against your own library; your team revises in a stage-gated workspace where a live compliance matrix advances as sections lock. AI is advisory — it proposes, you approve.'],
 ['4 · Win — submit, and get sharper', 'Export a compliant, submission-ready package. Record the outcome — a win starts your contract with a kickoff task, and every result feeds your library so winning content ranks higher on the next bid.']]
 .forEach(([t, d]) => { kids.push(h3(t)); kids.push(bodyP(d)); });
kids.push(callout('A compounding advantage.', 'Because everything you draft is captured to your library with lineage, your second proposal is faster than your first — and your tenth is faster than your second.'));
kids.push(gap(200));

// ── Capabilities ──
kids.push(band('radar', 'Discover & prioritize', 'Capabilities 1 of 5')); kids.push(gap(100));
kids.push(...cap('Opportunity discovery & your ranked pipeline', 'Every federal opportunity the platform surfaces lands on your Opportunity Pipeline, ranked for you — with agency, program type, close date, and a live submission-stage badge.', 'daily ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals; AI ranks each opportunity against your profile and tech areas; deadline alerts fire before the clock runs out; pin an opportunity to copy its documents into your workspace.'));
kids.push(...cap('Scoring buckets — rank by your strategy', 'Define scoring “buckets” — your own lenses on the market — from keywords, agencies, program types, and NAICS codes. Each bucket ranks your entire pipeline by your rules.', 'transparent, per-factor scoring you can inspect; edit a bucket and the pipeline re-ranks instantly; keep multiple buckets for different pursuit strategies.'));
kids.push(...cap('Deadline & amendment awareness', 'The pipeline tracks the submission clock and flags solicitations that change — when an opportunity moves to Updated, you see it, and a resync pulls the new documents in.', 'submission-stage badges and due dates on every card; an “update available” strip when the agency revises a solicitation; alerts on your dashboard and notification bell.'));
kids.push(gap(200));

kids.push(band('expert', 'Expert curation & isolated AI', 'Capabilities 2 of 5')); kids.push(gap(100));
kids.push(...cap('Expert-curated proposal workspaces', 'An RFP Pipeline expert curates the solicitation and provisions your build — the compliance matrix, required volumes, and section molds — from the actual solicitation. You start unlocked, populated, and ready to write.', 'a real expert reads the solicitation and builds the skeleton within a 72-hour SLA; provisioning instantiates the compliance matrix + volume molds; a running Ask-the-Expert allowance covers the judgment calls AI can’t make.'));
kids.push(...cap('Your isolated, company-specific AI', 'Your AI is walled to your company. It drafts from your library and context — and nothing you write trains a shared model or leaks to another company.', 'per-company isolation enforced at the data layer; no model training on your content; structured memory grounds drafts in your prior work; untrusted external content is fenced away from the AI.'));
kids.push(...cap('Compliance built in from the first draft', 'The compliance matrix is populated the moment your build is provisioned and advances as you lock sections — so readiness is something you can see, not guess.', 'requirements extracted into a live matrix; an AI compliance pass scores your proposal and flags gaps before an evaluator would; page-fill gauges track you against the agency’s limits.'));
kids.push(gap(200));

kids.push(band('library', 'Your library & workspace', 'Capabilities 3 of 5')); kids.push(gap(100));
kids.push(...cap('A reusable content library that compounds', 'Upload a document and the platform breaks it into tagged, searchable content pieces you compose into new proposals; capture content from any screen; or turn a past winning proposal into a reusable template.', 'upload → auto-atomize → tag → reuse; capture-from-screen pulls content in one-way without connecting an account; your content is copied forward into each proposal, so retiring an item never disturbs a proposal already built from it.'));
kids.push(...cap('The proposal workspace & compliance matrix', 'The build cockpit: a volume-and-section matrix, a stage-control bar with visible gate requirements, per-section accept-and-lock, and page-fill gauges.', 'sections carry status, assignee, and a page-fill bar; accept & lock a section to freeze it; when a volume is fully locked its downloads light up; the live compliance matrix advances with every lock.'));
kids.push(...cap('Templates, versioning & a full audit trail', 'Reuse a winning structure as a template, keep a version history on every section, and see a complete, attributed record of who did what — human or AI.', 'save any proposal’s structure as a reusable skeleton; per-section version history with restore; every action posts to an audit trail.'));
kids.push(gap(200));

// ── AI workforce ──
kids.push(band('agent', 'The AI workforce', 'Capabilities 4 of 5')); kids.push(gap(100));
kids.push(bodyP('An AI workforce works your proposal alongside your team — always advisory, always landing in review for your approval. It never submits, locks, or advances a stage on its own, and it’s governed by budget, rate, and per-run cost caps you set.'));
[['Proposal Studio', 'runs your draft through three gated loops — Draft, Refine, Compliance — stopping at each gate for your review, comments, and approval, or running all three automatically.'],
 ['AI drafting & full-draft modes', 'first-draft every empty section from your library, or draft the whole proposal in one pass — guided, restyle-only, or full-auto — in the voice you choose.'],
 ['Color-team review', 'runs a red/gold-team pass and posts specific, section-level recommendations into each section’s thread.'],
 ['Compliance check', 'scores your proposal against the solicitation’s requirements, pass / fail / partial per item.'],
 ['Research scout', 'gathers market research, prior art, and the competitor landscape into a cited brief. Web results are treated as untrusted data.'],
 ['Cost model', 'assembles your cost volume with live formulas, so the numbers stay consistent and defensible.']]
 .forEach(([b, r]) => kids.push(bullet(b + ' —', r)));
kids.push(gap(60));
kids.push(callout('Advisory by design.', 'Every AI output — Studio, drafting, review, or a full draft — lands in review, redlined and reversible. Your team is the gate; the AI never advances past it on its own.'));
kids.push(gap(200));

kids.push(band('collaboration', 'Collaborate, deliver & win', 'Capabilities 5 of 5')); kids.push(gap(100));
kids.push(...cap('Team & partner collaboration', 'Invite teammates and external partners with per-section, per-permission access — view, comment, or edit — so everyone sees exactly what they should and nothing more.', 'grants are per section and per permission; segregated collaboration spaces wall off partner content; every contributor’s work is attributed; deactivating a member revokes access instantly while keeping their history.'));
kids.push(...cap('Submission-ready deliverables', 'Export your proposal as Word, PDF, Excel (cost volumes with live formulas), or a per-volume ZIP — submission-formatted, with figures and tables rendered natively and sections in true document order.', 'one engine renders every format from one canvas; a packaging review compiles a manifest — volume completeness, required forms, and page/format compliance — before you submit.'));
kids.push(...cap('Outcome & contract — the flywheel', 'Record the outcome of every pursuit. A win starts your contract with a kickoff task, and every outcome feeds your library so winning content ranks higher on your next bid.', 'record Won / Lost / Withdrawn once submitted; a win instantiates a contract entity + kickoff; outcome signals re-weight your library so the platform gets sharper the more you use it.'));
kids.push(gap(200));

// ── Trust ──
kids.push(band('shield', 'Built for trust & control', 'Security & governance')); kids.push(gap(100));
kids.push(bodyP('Federal work demands discretion. RFP Pipeline is built so your data stays yours, your AI stays walled to your company, and every action — human or machine — is on the record.'));
[['Isolated, company-specific AI —', 'your AI is walled to your company; your context and content never cross to another customer.'],
 ['No model training on your data —', 'your proposals and library serve you, never a shared model.'],
 ['Multi-tenant isolation —', 'your workspace, library, and proposals are structurally yours alone.'],
 ['Full audit trail —', 'every action, by every person and every AI, is logged and traceable end to end.'],
 ['AI is advisory & human-gated —', 'it proposes; your team approves. It never auto-writes, submits, or locks.'],
 ['Governed AI —', 'budget, rate, and per-run cost caps keep AI usage predictable and under your control.'],
 ['Your content stays yours —', 'copied forward into each proposal, never crossed between customers.'],
 ['Injection-fenced —', 'untrusted external content is treated as data, never instructions the AI will follow.']]
 .forEach(([b, r]) => kids.push(bullet(b, r)));
kids.push(gap(60));
kids.push(callout('Proven, not theoretical.', 'The end-to-end flow — discover, curate, draft, comply, export, win — has been verified on real DoD SBIR builds, including a NAVAIR/NAVSEA counter-UAS topic, from a ranked opportunity to a submission-ready, downloadable package.', true));
kids.push(gap(200));

// ── Pricing + roles ──
kids.push(band('funding', 'Plans & who does what', 'Pricing · roles · next step')); kids.push(gap(100));
kids.push(tbl(['Plan', 'Price', 'What’s included'], [
  ['Spotlight Subscription (required, monthly)', '$499 / mo', 'Daily ingestion. AI ranking against your profile. Expert-curated compliance matrix. Deadline alerts. 15 min Ask-the-Expert/mo (rolls over). Required to purchase any portal · 3-month minimum.'],
  ['Phase I — Like Effort (per proposal)', '$1,999 ea', 'SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form. 72-hour expert curation. Stage-gated workspace. Custom AI drafting.'],
  ['Phase II — Like Effort (per proposal)', '$4,999 ea', 'SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20–50+ page tech volumes. Commercialization plans. $3,999 with a linked Phase I.'],
], [3050, 1500, 4810]));
kids.push(gap(40));
kids.push(P(run('No success fee, ever. Flat, predictable pricing that replaces a $5,000/mo monitoring service and a 10%-of-award consultant.', { i: true, color: INK5, size: 18 }), { after: 160 }));
kids.push(h3('Who does what'));
kids.push(tbl(['Role', 'What they do'], [
  ['Company Admin', 'Runs the company workspace — opens pursuits, invites the team, and drives the build from opportunity to submission.'],
  ['Team Member', 'Contributes to assigned proposals and sections, within the access their admin grants.'],
  ['External Partner', 'Stage-scoped access to a specific proposal — view, comment, or edit only where invited.'],
  ['RFP Pipeline Expert', 'Curates the solicitation and provisions your build behind the scenes, so you start on-structure.'],
], [2400, 6960]));
kids.push(gap(140));
kids.push(new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 16, color: CORAL, space: 8 } }, spacing: { before: 60, after: 40 }, children: [new TextRun({ text: 'From a ranked opportunity to a submission-ready, compliant proposal — with your team in control at every gate.', font: SERIF, italics: true, color: INK, size: 26 })] }));
kids.push(P(run('Book a walkthrough on one of your own target opportunities, or apply for the Founding Cohort. Platform launches August 2026.', { color: INK5 })));

const doc = new Document({
  creator: 'RFP Pipeline', title: 'RFP Pipeline — Platform Overview & Capabilities',
  numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { run: { color: CORAL }, paragraph: { indent: { left: 340, hanging: 200 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: PW, height: 15840 }, margin: { top: MARG, bottom: 1000, left: MARG, right: MARG } } },
    footers: { default: new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } }, tabStops: [{ type: 'right', position: CW }], children: [new TextRun({ text: 'RFP Pipeline  ·  AI + Expert  ·  From Application to Submission', font: SANS, size: 15, color: '968775' }), new TextRun({ children: [new Tab(), 'Page '], font: SANS, size: 15, color: '968775' }), new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 15, color: '968775' })] })] }) },
    children: kids,
  }],
});
const buf = await Packer.toBuffer(doc);
fs.writeFileSync(`${SP}/RFP-Pipeline-Platform-Overview.docx`, buf);
console.log('wrote docx', buf.length, 'bytes,', kids.length, 'blocks');
