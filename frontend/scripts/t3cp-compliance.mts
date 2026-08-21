/** Author the OSW26BZ04-DP013 compliance matrix one variable at a time through
 *  `compliance.save_variable_value`, each value CITED to the exact sentence it was read from in the
 *  source documents. Nothing here is a default: every entry carries its sourceExcerpt so the UI can
 *  badge it "Read from source" rather than "Default — unverified" (docs/INGEST_PROVENANCE.md).
 *
 *  cd frontend && node --import tsx scripts/t3cp-compliance.mts <solicitationId> */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SOL = process.argv[2] ?? '11263a74-ab09-48bb-ada5-565aa2ee986e';
const R4 = 'OSWT3CP_SBIR_26BZ_R4_v2.pdf';
const TOPIC = 'topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

/** [variableName, value, sourceExcerpt (verbatim), sourceDoc] */
const VALUES: Array<[string, unknown, string, string]> = [
  ['page_limit_technical', 10,
    'The Technical Volume is not to exceed 10 pages and must follow the formatting requirements provided in the DoW SBIR Program BAA titled "Format of Technical Volume (Volume 2)." T3CP will only evaluate the first ten (10) pages of the Technical Volume. Additional pages will not be evaluated.', R4],
  ['submission_format',
    'DSIP electronic submission in seven volumes (1 Cover Sheet · 2 Technical NTE 10 pages · 3 Cost · 4 CCR · 5 Supporting Documents · 6 Fraud, Waste and Abuse Training · 7 Disclosures of Foreign Affiliations webform). Technical Volume format per the DoW SBIR Program BAA "Format of Technical Volume (Volume 2)".',
    'Proposal Coversheet (Volume 1) … Technical Volume (Volume 2) … Cost Volume (Volume 3) … Company Commercialization Report (CCR) (Volume 4) … Supporting Documents (Volume 5) … Fraud, Waste and Abuse Training (Volume 6) … Disclosures of Foreign Affiliations or Relationships to Foreign Countries (Volume 7)', R4],
  ['cost_volume_format',
    'DSIP online cost volume. Phase I Base must not exceed $250,000.00; costs identified on the Proposal Cover Sheet (Volume 1) and in Volume 3.',
    'The Phase I Base amount must not exceed $250,000.00. Costs must be identified on the Proposal Cover Sheet (Volume 1) and in Volume 3. Offerors shall use the online cost volume in DSIP.', R4],
  ['taba_allowed', true,
    'Phase I awardees may request up to $6,500 in TABA funding … TABA funding is in addition to the Phase I and Phase II cost ceilings and is not subject to profit/fee. … The completed form must be included in Volume 5 of the proposal submission in DSIP.', R4],
  ['clearance_required', 'CMMC Level 1 (projected)',
    'PROJECTED CMMC LEVEL REQUIREMENT: Level 1', TOPIC],
  // Freeform variables (accepted verbatim) that carry the topic's decisive rules.
  ['phase_i_base_ceiling', 250000,
    'The Phase I Base amount must not exceed $250,000.00.', R4],
  ['phase_i_period_of_performance', '120 days (Final Report and Initial Phase II Proposal both due at 120 days from start of Base award)',
    'Phase I deliverables include: Kick-Off Briefing, due 15 days from start of Base award; Final Report, due 120 days from start of Base award; Initial Phase II Proposal, due 120 days from start of Base award', TOPIC],
  ['phase_i_deliverables', 'Kick-Off Briefing (Day 15); Final Report (Day 120); Initial Phase II Proposal (Day 120)',
    'Kick-Off Briefing, due 15 days from start of Base award • Final Report, due 120 days from start of Base award • Initial Phase II Proposal, due 120 days from start of Base award', TOPIC],
  ['taba_phase_i_max', 6500,
    'Phase I awardees may request up to $6,500 in TABA funding; Phase II awardees may request up to $50,000 per Phase II project.', R4],
  ['phase_ii_ceiling', 2153927,
    'Phase II awards under this topic are expected not to exceed $2,153,927.00 with a period of performance not to exceed 24 months. Firm-Fixed-Price contracts are expected.', R4],
  ['patent_identification_required', true,
    'Proposals must identify the patent number(s) and the name of the associated DoW laboratory for the patent(s) on which the proposed effort is based.', R4],
  ['cel_required', true,
    'The identified patent(s) must be associated with a Commercial Evaluation License (CEL) issued to the Offeror under the Patent Holiday Initiative, included within a CEL application submitted by the Offeror under the Patent Holiday Initiative, or otherwise…', R4],
  ['d2p2_eligible', true,
    'T3CP will accept Direct to Phase II (D2P2) proposals under this topic. … To be eligible, the proposer must demonstrate, in Volume 5, Phase I-equivalent feasibility work completed prior to submission… A summary of Phase I-equivalent work performed (not to exceed 3 pages)…', R4],
  ['sector_areas', 'Microelectronics; Advanced Materials; Energetics; Munitions; Critical Minerals and Supply-Chain-Enabling Technologies; Biomanufacturing',
    'This topic is structured as a broad open topic with five sector areas. Offerors should propose within the sector most aligned to the patent or patents they seek to commercialize…', TOPIC],
  ['phase_i_required_content',
    'Selected DoW patent(s) + associated laboratory; relevant sector area; proposed product/prototype concept; intended commercial and/or defense end use; technical modifications required to adapt the patented invention; anticipated performance improvements or commercial value; CEL status or plan to obtain; logistics/safety/regulatory impacts; transition approach.',
    'Phase I proposals will describe the selected DoW patent or patents being leveraged, the relevant sector area, the proposed product or prototype concept, the intended commercial and/or defense end use, the technical modifications required to adapt the patented invention for the target application, anticipated performance improvements or commercial value, the status of or plan to obtain a commercial evaluation license (CEL), impacts to logistics, safety, or regulatory considerations as applicable, and the proposed transition approach.', TOPIC],
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'eric@rfppipeline.com');
await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
console.log('✓ logged in as eric@rfppipeline.com (rfp_admin)');
const api = page.request;

for (const [variableName, value, sourceExcerpt, doc] of VALUES) {
  const r = await api.post(`${BASE}/api/admin/rfp-curation/${SOL}/compliance`, {
    data: { variableName, value, sourceExcerpt, notes: `Read from ${doc}`, action: 'manual_entry' },
  });
  const body = await r.json().catch(() => ({}));
  ok(`${variableName} = ${JSON.stringify(value).slice(0, 60)}`, r.status() === 200,
    r.status() === 200 ? '' : `HTTP ${r.status()} ${JSON.stringify(body).slice(0, 140)}`);
}

await b.close();
console.log(failures === 0 ? `\nT3CP COMPLIANCE: ALL ${VALUES.length} VALUES SAVED WITH SOURCE CITATIONS` : `\nT3CP COMPLIANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
