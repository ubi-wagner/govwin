/** T3CP-B — master OPP build-out: author the required items inside the seven DSIP volumes
 *  of OSW26BZ04-DP013 through the product's own `volume.add_required_item` tool (the same
 *  call the curation workspace's volume manager makes).
 *
 *  Required items are what provision-proposal.ts turns into proposal_artifacts +
 *  proposal_sections + proposal_compliance_matrix rows — with zero of them the provisioned
 *  build is an empty shell, and getBuildReadiness() reports ready=false.
 *
 *  Content is grounded in the curated compliance record for this solicitation
 *  (custom_variables: phase_i_required_content, evaluation_criteria, required_documents,
 *  cost_volume_format, taba_*, d2p2_eligible, page_limit_technical=10).
 *
 *  cd frontend && node --import tsx scripts/t3cp-buildout.mts <solicitationId> */
import { chromium, type Browser, type APIRequestContext } from 'playwright';

const BASE = 'http://localhost:3000';
// Take the solicitation from argv like every sibling t3cp-* script — the intake mints a fresh id
// per run, so a baked-in constant is stale the moment the master is re-ingested.
const SOL = process.argv[2] ?? '4e340a58-90ce-47d8-92cd-2bb239119141';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => {
  console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`);
  if (!c) failures++;
};

async function login(b: Browser, email: string, password: string): Promise<APIRequestContext> {
  const page = await (await b.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(`✓ logged in as ${email}`);
  return page.request;
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const admin = await login(b, 'eric@rfppipeline.com', (process.env.RFP_ADMIN_PW || 'RFPAdmin2026!'));

async function tool(name: string, input: unknown): Promise<{ status: number; body: any }> {
  const r = await admin.post(`${BASE}/api/tools/${name}`, { data: { input } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}

// Volume ids come from the detail route the workspace itself reads.
const det = await admin.get(`${BASE}/api/admin/rfp-curation/${SOL}`);
const detBody = await det.json().catch(() => ({}));
const volumes: Array<{ id: string; volumeNumber: number; volumeName: string }> =
  detBody?.data?.volumes ?? [];
ok('detail route returned the 7 DSIP volumes', volumes.length === 7, `got ${volumes.length}`);
if (volumes.length === 0) { await b.close(); process.exit(1); }
const byNum = new Map(volumes.map((v) => [v.volumeNumber, v]));

// The R4 announcement caps the WHOLE Technical Volume at 10 pages. `volume_required_items.page_limit`
// is the ITEM's SHARE of that cap, not the cap repeated per item: lib/artifact-spec.ts:135 SUMS the
// item limits into the artifact's `compliance_spec.max_pages`, so ten items each carrying 10 declares
// a 100-page envelope against a 10-page announcement (and submission readiness now blocks that
// over-subscription outright). Shares are assigned below, after the plan is known.
const TECH_VOLUME_PAGES = 10;

type Item = {
  itemName: string; itemType: string; pageLimit?: number; dsipOnly?: boolean; expertNotes?: string;
};

const PLAN: Record<number, Item[]> = {
  // V1 — DSIP webform; the company authors nothing.
  1: [
    { itemName: 'Proposal Cover Sheet (DSIP webform)', itemType: 'form_sf424', dsipOnly: true,
      expertNotes: 'Completed in DSIP. Phase I Base cost identified here must match Volume 3 (NTE $250,000.00).' },
  ],
  // V2 — the authored Technical Volume, NTE 10 pages, per the DoW SBIR Program BAA
  // "Format of Technical Volume (Volume 2)" plus the T3CP-specific patent content.
  2: [
    { itemName: 'Identification and Significance of the Problem or Opportunity (with T3CP sector area)', itemType: 'text',
      expertNotes: 'Name the sector area proposed under: Microelectronics; Advanced Materials; Energetics; Munitions; Critical Minerals and Supply-Chain-Enabling Technologies; Biomanufacturing.' },
    { itemName: 'Patent Identification — DoW Patent Number(s) and Associated Laboratory', itemType: 'text',
      expertNotes: 'MANDATORY: proposals must identify the patent number(s) AND the name of the associated DoW laboratory for the patent(s) the effort is based on.' },
    { itemName: 'Commercial Evaluation License (CEL) Status or Plan to Obtain', itemType: 'text',
      expertNotes: 'The identified patent(s) must be covered by a CEL issued to the offeror, or included in a CEL application submitted under the Patent Holiday Initiative.' },
    { itemName: 'Proposed Product or Prototype Concept and Intended Commercial and/or Defense End Use', itemType: 'text' },
    { itemName: 'Technical Modifications Required to Adapt the Patented Invention', itemType: 'text',
      expertNotes: 'Evolutionary-only improvements to the existing state of practice are excluded from award.' },
    { itemName: 'Phase I Technical Objectives', itemType: 'text' },
    { itemName: 'Phase I Statement of Work', itemType: 'text',
      expertNotes: 'Period of performance 120 days. Deliverables: Kick-Off Briefing (Day 15), Final Report (Day 120), Initial Phase II Proposal (Day 120).' },
    { itemName: 'Anticipated Performance Improvements, Commercial Value, and Transition Approach', itemType: 'text' },
    { itemName: 'Logistics, Safety, and Regulatory Considerations', itemType: 'text' },
    { itemName: 'Related Work, Key Personnel, Facilities/Equipment, and Subcontractors/Consultants', itemType: 'text' },
  ],
  // V3 — DSIP online cost volume; the data-bearing item receives the computed workbook.
  3: [
    { itemName: 'Cost Volume (DSIP online cost volume)', itemType: 'spreadsheet',
      expertNotes: 'Phase I Base must not exceed $250,000.00. Costs must be identified on the Proposal Cover Sheet (Volume 1) and in Volume 3.' },
  ],
  // V4 — CCR is pulled from SBIR.gov inside DSIP.
  4: [
    { itemName: 'Company Commercialization Report (CCR webform)', itemType: 'form_other', dsipOnly: true },
  ],
  // V5 — authored attachments.
  5: [
    { itemName: 'TABA Request Form (Phase I up to $6,500)', itemType: 'pdf',
      expertNotes: 'TABA is in addition to the Phase I/II cost ceilings and is not subject to profit/fee. The completed form must be included in Volume 5.' },
    { itemName: 'Direct-to-Phase-II (D2P2) Phase I-Equivalent Feasibility Summary', itemType: 'text', pageLimit: 3,
      expertNotes: 'D2P2 proposals only — summary of Phase I-equivalent work performed prior to submission, not to exceed 3 pages.' },
    { itemName: 'Supporting Documents (letters of support, CEL documentation, optional attachments)', itemType: 'pdf' },
  ],
  // V6 / V7 — completed inside DSIP.
  6: [
    { itemName: 'Fraud, Waste and Abuse (FWA) Training completion', itemType: 'form_other', dsipOnly: true },
  ],
  7: [
    { itemName: 'Disclosures of Foreign Affiliations or Relationships to Foreign Countries (DSIP webform)', itemType: 'form_other', dsipOnly: true },
  ],
};

// Split the Technical Volume's 10-page envelope across its items — ten sections sharing ten pages
// is one page each. Derived rather than typed per item so the arithmetic can never drift from the
// announced cap, and hard-refused if the shares ever over-subscribe it.
{
  const items = PLAN[2];
  const base = Math.floor(TECH_VOLUME_PAGES / items.length);
  let remainder = TECH_VOLUME_PAGES - base * items.length;
  for (const it of items) it.pageLimit = Math.max(1, base + (remainder-- > 0 ? 1 : 0));
  const sum = items.reduce((t, it) => t + (it.pageLimit ?? 0), 0);
  console.log(`  V2 Technical: ${items.length} items sharing ${TECH_VOLUME_PAGES} pages → `
    + `${items.map((i) => i.pageLimit).join('/')} (sum ${sum})`);
  if (sum > TECH_VOLUME_PAGES) {
    ok(`V2 per-item allowances fit the ${TECH_VOLUME_PAGES}-page volume`, false, `sum=${sum}`);
    await b.close();
    process.exit(1);
  }
}

let added = 0, existed = 0;
for (const [numStr, items] of Object.entries(PLAN)) {
  const vol = byNum.get(Number(numStr));
  if (!vol) { ok(`volume ${numStr} present`, false); continue; }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = await tool('volume.add_required_item', {
      volumeId: vol.id, itemNumber: i + 1, itemName: it.itemName, itemType: it.itemType,
      required: true,
      ...(it.pageLimit ? { pageLimit: it.pageLimit } : {}),
      ...(it.dsipOnly ? { dsipOnly: true } : {}),
      ...(it.expertNotes ? { expertNotes: it.expertNotes } : {}),
    });
    if (r.status === 200) { added++; }
    else if (r.body?.code === 'CONFLICT') { existed++; }
    else ok(`V${numStr} item ${i + 1} "${it.itemName.slice(0, 50)}"`, false,
      `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  }
}
ok(`required items authored (added=${added} already-present=${existed})`, added + existed > 0);

// Readiness, straight off the cockpit route the rfp_admin actually looks at.
const rd = await admin.get(`${BASE}/api/admin/provisioning/readiness?solicitationId=${SOL}`);
if (rd.status() === 200) {
  console.log('  readiness:', JSON.stringify(await rd.json().catch(() => ({}))).slice(0, 300));
}

await b.close();
console.log(failures === 0 ? '\nT3CP-B: ALL GREEN' : `\nT3CP-B: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
