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

const BASE = 'http://localhost:3000';
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
await page.fill('input[type="password"]', 'RFPAdmin2026!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
console.log('✓ logged in as eric@rfppipeline.com (rfp_admin)');
const api = page.request;

// ── 1 · Stage the intake (the product's canonical front door) ──
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
const oppId: string | null = ib?.data?.opportunityId ?? null;
const solId: string | null = ib?.data?.solicitationId ?? null;
ok('intake staged (opportunity + solicitation created)', intake.status() === 200 && !!oppId && !!solId,
  `HTTP ${intake.status()} ${JSON.stringify(ib).slice(0, 200)}`);
if (!oppId || !solId) { await b.close(); process.exit(1); }
console.log(`  opportunityId=${oppId}\n  solicitationId=${solId}`);

// ── 2 · Author the compliance matrix from the READ requirements ──
const compliance = await api.post(`${BASE}/api/admin/rfp-curation/${solId}/compliance`, {
  data: {
    pageLimitTechnical: 10,
    fontFamily: 'Times New Roman',
    fontSize: '10',
    margins: '1 inch (all sides)',
    submissionFormat:
      'DSIP electronic submission, seven volumes. Technical Volume (Vol 2) not to exceed 10 pages — T3CP evaluates only '
      + 'the first ten pages; additional pages are not considered. Format per the DoW SBIR Program BAA "Format of Technical '
      + 'Volume (Volume 2)". Cost Volume (Vol 3) uses the DSIP online cost volume; Phase I Base must not exceed $250,000.00.',
    requiredDocuments: [
      'Proposal Cover Sheet (Volume 1, DSIP)',
      'Technical Volume (Volume 2) — NTE 10 pages',
      'Cost Volume (Volume 3) — DSIP online cost volume, Phase I Base NTE $250,000',
      'Company Commercialization Report (Volume 4, DSIP)',
      'Supporting Documents (Volume 5) — incl. TABA Request Form if requested; D2P2 Phase I-equivalent summary NTE 3 pages',
      'Fraud, Waste and Abuse Training (Volume 6)',
      'Disclosures of Foreign Affiliations or Relationships to Foreign Countries (Volume 7 webform)',
    ],
    evaluationCriteria: [
      'Evaluated per the DoW SBIR Program BAA criteria, with the T3CP additions below.',
      'MUST identify the patent number(s) and the name of the associated DoW laboratory for the patent(s) on which the effort is based.',
      'Identified patent(s) must be covered by a CEL issued to the offeror, or included in a CEL application submitted by the offeror, under the Patent Holiday Initiative.',
      'Credible prototype and commercialization pathway — evolutionary-only improvements to the existing state of practice are excluded.',
    ],
  },
});
ok('compliance matrix authored (10-page V2, $250K base, 7 volumes)', compliance.status() === 200,
  `HTTP ${compliance.status()} ${(await compliance.text()).slice(0, 200)}`);

await b.close();
console.log(failures === 0 ? `\nT3CP INGEST: ALL GREEN\n  opp=${oppId}\n  sol=${solId}` : `\nT3CP INGEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
