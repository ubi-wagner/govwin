/** REAL ingest of OSW26BZ04-DP013 (T3CP Patent Holiday SBIR Open Topic Call) as an rfp_admin,
 *  through the product's own intake path — replacing the coverage-test fixture the source PDFs
 *  were previously consumed under. Every value below is READ FROM the uploaded solicitation
 *  documents (topic call + OSW T3CP R4 v2 announcement), not defaulted:
 *
 *    Phase I Base ..... NTE $250,000.00                        (R4 "Cost Volume (Volume 3)")
 *    Technical Volume . NTE 10 pages; only first 10 evaluated  (R4 "Technical Volume (Volume 2)")
 *    Volumes .......... SEVEN (1 Cover · 2 Technical · 3 Cost · 4 CCR · 5 Supporting ·
 *                       6 FWA · 7 Foreign Affiliations webform)
 *    CMMC ............. Level 1                                (topic header)
 *    Deliverables ..... Kick-Off @ 15 days · Final Report @ 120 days · Initial Phase II @ 120 days
 *    TABA ............. Phase I up to $6,500, above the ceiling, submitted in Volume 5
 *    Phase II ......... NTE $2,153,927.00 / 24 months
 *    Eval add-on ...... MUST identify patent number(s) + associated DoW laboratory, with CEL
 *                       issued/applied-for under the Patent Holiday Initiative
 *
 *  cd frontend && node --import tsx scripts/t3cp-ingest.mts */
import { chromium } from 'playwright';

// One base URL, three historic spellings — and this file used the worst of them: a LITERAL, which
// ignores both env names silently. A drive pinned to :3000 runs against whatever build happens to
// be serving there, so it can report a stale product as broken, or a fixed one as still broken.
// (That is exactly how the release-gate change looked like a product failure for two runs.)
const BASE = process.env.GUIDE_BASE || process.env.BASE_URL || 'http://localhost:3000';
let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

const DESCRIPTION =
  'Develop innovative, transition-ready prototype solutions that leverage Department of War inventions made available '
  + 'through the T3CP Patent Holiday Initiative in the areas of Microelectronics, Advanced Materials, Energetics, '
  + 'Munitions, and Critical Minerals and supply-chain-enabling technologies. The Office of Technology, Transition and '
  + 'Commercial Partnerships (T3CP) seeks approaches that accelerate commercialization and dual-use transition of '
  + 'government-funded IP offered under no-cost Commercial Evaluation Licenses (CELs). Proposals are made within the '
  + 'sector area most aligned to the patent(s) being commercialized, identifying the target product concept, end users, '
  + 'integration pathway, technical approach, and measurable milestones. Sector areas: Microelectronics; Advanced '
  + 'Materials; Energetics; Munitions; Critical Minerals & Supply-Chain-Enabling Technologies; Biomanufacturing. '
  + 'Excluded: work that yields only evolutionary improvements without a credible prototype and commercialization pathway.';

const EXPERT_NOTES =
  'PHASE I CONTENT (topic-mandated): identify the selected DoW patent(s) and the associated DoW laboratory; the relevant '
  + 'sector area; the proposed product/prototype concept; intended commercial and/or defense end use; the technical '
  + 'modifications required to adapt the patented invention; anticipated performance improvements or commercial value; '
  + 'CEL status or the plan to obtain one; logistics/safety/regulatory impacts; and the transition approach. '
  + 'EVALUATION ADD-ON (R4): proposals MUST identify patent number(s) + the associated DoW laboratory, and the patent(s) '
  + 'must be covered by a CEL issued to the offeror, or included in a submitted CEL application, under the Patent Holiday '
  + 'Initiative. D2P2 is eligible — Volume 5 must carry a Phase I-equivalent work summary NTE 3 pages. '
  + 'TABA: Phase I up to $6,500, in addition to the ceiling, on the SBIR/STTR TABA Request Form in Volume 5. '
  + 'Phase II: NTE $2,153,927.00 / 24 months, FFP expected; selection notification within 90 days of window close.';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'eric@rfppipeline.com');
await page.fill('input[type="password"]', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
console.log('✓ logged in as eric@rfppipeline.com (rfp_admin)');
const api = page.request;

// ── 1 · Stage the intake (the product's canonical front door) ──
// `stageIntake` mints a fresh opportunity id per call — it does NOT dedup on solicitation number,
// so a blind re-run orphans a duplicate umbrella. Pass an already-staged solicitation id as argv[2]
// to skip straight to the compliance pass (same convention as the sibling t3cp-* scripts).
const RESUME = process.argv[2] ?? null;
let oppId: string | null = null;
let solId: string | null = RESUME;

if (RESUME) {
  console.log(`↻ resuming against already-staged solicitation ${RESUME} (intake skipped)`);
} else {
const intake = await api.post(`${BASE}/api/admin/intake`, {
  data: {
    title: 'OSW26BZ04-DP013: T3CP Patent Holiday SBIR Open Topic Call',
    agency: 'Department of War',
    office: 'OUSD(R&E) — Office of Technology, Transition and Commercial Partnerships (T3CP)',
    orgUnit: 'OSW',
    solicitationNumber: 'OSW26BZ04-DP013',
    programType: 'sbir_phase_1',
    description: DESCRIPTION,
    expertNotes: EXPERT_NOTES,
    namespace: 't3cp-patent-holiday',
    intakeMeta: {
      foundBy: 'admin',
      sourceUrl: 'https://www.cto.mil/no-fee-cel/',
      noticeType: 'SBIR Open Topic Call (Patent Holiday)',
      docsDownloadable: true,
      raw: {
        cmmcLevel: 'Level 1',
        technologyAreas: ['Bio Medical', 'Electronics', 'Materials', 'Weapons'],
        modernizationPriorities: ['Advanced Materials', 'Biotechnology', 'Directed Energy (DE)', 'Microelectronics'],
        sectorAreas: ['Microelectronics', 'Advanced Materials', 'Energetics', 'Munitions', 'Critical Minerals & Supply-Chain-Enabling Technologies', 'Biomanufacturing'],
        phaseIBaseCeiling: 250000,
        phaseIICeiling: 2153927,
        phaseIIMonths: 24,
        tabaPhaseI: 6500,
        d2p2Eligible: true,
        deliverables: [
          { name: 'Kick-Off Briefing', dueDays: 15 },
          { name: 'Final Report', dueDays: 120 },
          { name: 'Initial Phase II Proposal', dueDays: 120 },
        ],
        sourceDocuments: [
          'topic_OSW26BZ04DP013_T3CP_Patent_Holiday_SBIR_Open_Topic_Call.PDF',
          'OSWT3CP_SBIR_26BZ_R4_v2.pdf',
          'DoW_2026_SBIR_BAA_Preface_07152026.pdf',
        ],
      },
    },
  },
});
const ib = await intake.json().catch(() => ({}));
oppId = ib?.data?.opportunityId ?? null;
solId = ib?.data?.solicitationId ?? null;
ok('intake staged (opportunity + solicitation created)', intake.status() === 200 && !!oppId && !!solId,
  `HTTP ${intake.status()} ${JSON.stringify(ib).slice(0, 200)}`);
if (!oppId || !solId) { await b.close(); process.exit(1); }
console.log(`  opportunityId=${oppId}\n  solicitationId=${solId}`);
}

// ── 2 · Author the compliance matrix from the READ requirements ──
// The compliance route is ONE VARIABLE PER CALL (`compliance.save_variable_value`) — it has
// required `variableName` since this script was written, so the old single bulk POST here
// (pageLimitTechnical / fontFamily / requiredDocuments / …) was always a 422. Each value below is
// posted on the real contract. Values quoted in the topic call / R4 announcement carry their
// verbatim `sourceExcerpt`; the BAA formatting conventions (font · size · margins) are NOT quoted
// in either T3CP document, so they are saved WITHOUT an excerpt — an unquoted value must never be
// dressed up as one read from the source (docs/INGEST_PROVENANCE.md).
const R4_DOC = 'OSWT3CP_SBIR_26BZ_R4_v2.pdf';
const VOLUME_LIST =
  'Proposal Coversheet (Volume 1) … Technical Volume (Volume 2) … Cost Volume (Volume 3) … Company '
  + 'Commercialization Report (CCR) (Volume 4) … Supporting Documents (Volume 5) … Fraud, Waste and Abuse '
  + 'Training (Volume 6) … Disclosures of Foreign Affiliations or Relationships to Foreign Countries (Volume 7)';

/** [variableName, value, sourceExcerpt | null, notes] */
const MATRIX: Array<[string, unknown, string | null, string]> = [
  ['page_limit_technical', 10,
    'The Technical Volume is not to exceed 10 pages and must follow the formatting requirements provided in the DoW SBIR '
    + 'Program BAA titled "Format of Technical Volume (Volume 2)." T3CP will only evaluate the first ten (10) pages of the '
    + 'Technical Volume. Additional pages will not be evaluated.',
    `Read from ${R4_DOC}`],
  ['submission_format',
    'DSIP electronic submission, seven volumes. Technical Volume (Vol 2) not to exceed 10 pages — T3CP evaluates only '
    + 'the first ten pages; additional pages are not considered. Format per the DoW SBIR Program BAA "Format of Technical '
    + 'Volume (Volume 2)". Cost Volume (Vol 3) uses the DSIP online cost volume; Phase I Base must not exceed $250,000.00.',
    VOLUME_LIST, `Read from ${R4_DOC}`],
  ['required_documents', [
    'Proposal Cover Sheet (Volume 1, DSIP)',
    'Technical Volume (Volume 2) — NTE 10 pages',
    'Cost Volume (Volume 3) — DSIP online cost volume, Phase I Base NTE $250,000',
    'Company Commercialization Report (Volume 4, DSIP)',
    'Supporting Documents (Volume 5) — incl. TABA Request Form if requested; D2P2 Phase I-equivalent summary NTE 3 pages',
    'Fraud, Waste and Abuse Training (Volume 6)',
    'Disclosures of Foreign Affiliations or Relationships to Foreign Countries (Volume 7 webform)',
  ], VOLUME_LIST, `Read from ${R4_DOC}`],
  ['evaluation_criteria', [
    'Evaluated per the DoW SBIR Program BAA criteria, with the T3CP additions below.',
    'MUST identify the patent number(s) and the name of the associated DoW laboratory for the patent(s) on which the effort is based.',
    'Identified patent(s) must be covered by a CEL issued to the offeror, or included in a CEL application submitted by the offeror, under the Patent Holiday Initiative.',
    'Credible prototype and commercialization pathway — evolutionary-only improvements to the existing state of practice are excluded.',
  ],
    'Proposals must identify the patent number(s) and the name of the associated DoW laboratory for the patent(s) on which '
    + 'the proposed effort is based.', `Read from ${R4_DOC}`],
  // Not quoted in the topic call or R4 — the DoW SBIR BAA Volume-2 format section governs. No excerpt.
  ['font_family', 'Times New Roman', null, 'DoW SBIR Program BAA "Format of Technical Volume (Volume 2)" convention — NOT quoted in the T3CP topic call or R4 announcement.'],
  ['font_size', '10', null, 'DoW SBIR Program BAA "Format of Technical Volume (Volume 2)" convention — NOT quoted in the T3CP topic call or R4 announcement.'],
  ['margins', '1 inch (all sides)', null, 'DoW SBIR Program BAA "Format of Technical Volume (Volume 2)" convention — NOT quoted in the T3CP topic call or R4 announcement.'],
];

for (const [variableName, value, sourceExcerpt, notes] of MATRIX) {
  const r = await api.post(`${BASE}/api/admin/rfp-curation/${solId}/compliance`, {
    data: { variableName, value, ...(sourceExcerpt ? { sourceExcerpt } : {}), notes, action: 'manual_entry' },
  });
  ok(`compliance ${variableName}`, r.status() === 200, r.status() === 200 ? '' : `HTTP ${r.status()} ${(await r.text()).slice(0, 200)}`);
}

await b.close();
console.log(failures === 0 ? `\nT3CP INGEST: ALL GREEN\n  opp=${oppId}\n  sol=${solId}` : `\nT3CP INGEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
