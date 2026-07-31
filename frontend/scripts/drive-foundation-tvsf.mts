/**
 * Drive the Foundation TVSF build: draft the 13 provisioned sections (Proposal 7pp:
 * Abstract + #1–#11, and Budget: #12) with real canvas content grounded in the deck,
 * lock them (compliance matrix → satisfied), advance to submitted, and export BOTH
 * volumes via the system's own canvas exporter (renderCanvas → docx / xlsx, in-memory,
 * no S3). Appoints Paul (EC) as an external proposal collaborator with per-stage edit access.
 *
 * Idempotent: finds the proposal provisioned by hitl-foundation-build.spec.ts (or provisions
 * one if absent). Content is written the same way publish_section_draft does (content TEXT =
 * stringified CanvasDocument).
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-foundation-tvsf.mts
 */
import { sql, getTenantBySlug } from '@/lib/db';
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import { assembleArtifactCanvas, renderCanvas } from '@/lib/export/artifact-export';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUTDIR = '/home/user/govwin/docs/proposals/foundation-tvsf';
let fail = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };

// ── canvas node helpers (same shapes as the exporter consumes) ──
let nid = 0;
const NID = () => `n${++nid}`;
const wrap = (type: string, content: any, style: any = {}) => ({ id: NID(), type, style, history: [], library_eligible: true, provenance: { source: 'manual' }, content });
const H = (level: number, text: string) => wrap('heading', { level, text });
const P = (text: string, inline?: any[]) => wrap('text_block', { text, ...(inline ? { inline_formats: inline } : {}) });
const UL = (items: any[]) => wrap('bulleted_list', { items: items.map((t) => (typeof t === 'string' ? { text: t } : t)) });
const TBL = (headers: any[], rows: any[][], sheet?: string) => wrap('table', { headers, rows, header_style: { bold: true, bg: '#D9E1F2', alignment: 'center' }, ...(sheet ? { sheet_name: sheet } : {}) });
const CANVAS = {
  format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: 'Foundation   ·   Ohio Third Frontier TVSF (Round 45)', height: 28, font: { family: 'Times New Roman', size: 9 } },
  footer: { template: 'Foundation — TVSF Application (confidential)        Page {n} of {N}', height: 28, font: { family: 'Times New Roman', size: 8 } },
  font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.15, max_pages: 7, max_slides: null,
};
const doc = (nodes: any[], title: string, proposalId: string) => ({
  version: 1, document_id: '00000000-0000-0000-0000-000000000000', canvas: CANVAS, nodes,
  metadata: { title, volume_id: '', required_item_id: '', proposal_id: proposalId, solicitation_id: '', created_at: '2026-07-31T00:00:00Z', last_modified_at: '2026-07-31T00:00:00Z', last_modified_by: '', version_number: 1, status: 'complete' },
});

// ── section content keyed by 'abstract' | '1'..'12' ──
function contentFor(pid: string): Record<string, any[]> {
  const cur = (t: string) => t; // budget numbers pre-formatted
  return {
    abstract: [
      H(1, 'Abstract'),
      P('(Public, non-confidential — excluded from the 7-page limit.)', [{ start: 0, length: 42, format: 'italic' }]),
      P('Foundation is an Ohio pre-seed venture that 3D-prints the formwork for residential concrete foundations. By printing the foundation wall shape directly — with common, locally sourced concrete rather than proprietary mortar — Foundation eliminates the traditional build-strip-repair-clean formwork cycle, cutting foundation formwork labor from ~336 hours to ~25 and total formwork cost by roughly 47% on a typical 2,100 sq ft Ohio home. TVSF funds a beta prototype and third-party performance validation, de-risking a $23.7B U.S. formwork market and advancing Ohio\'s housing-affordability and advanced-manufacturing agenda.'),
    ],
    '1': [
      H(1, '#1  Market Opportunity (TAM)'),
      P('The 2026 U.S. housing market represents a $410B TAM against a structural ~500,000-home supply/demand gap; "locked-in" 6% mortgages push builders toward new-build "buy-down" economics where every point of cost removed matters. Foundation targets the formwork line item of single-family new builds — a $23.7B SAM — with an initial serviceable-obtainable $27.4M SOM in its regional beachhead.'),
      P('Because foundation 3D printing lowers total home cost ~4% while removing the industry\'s most labor-intensive, waste-prone step, it converts a cost center into a competitive advantage for builders operating on thin margins.'),
      TBL(['Market layer', 'Size', 'Definition'], [
        ['TAM', '$410B', '2026 U.S. housing market'],
        ['SAM', '$23.7B', 'Formwork in single-family new builds'],
        ['SOM', '$27.4M', 'Near-term regional beachhead'],
      ], 'Market'),
    ],
    '2': [
      H(1, '#2  Overview of the Technology'),
      P('Foundation\'s system prints a foundation\'s wall geometry directly: a build plan is downloaded to the printer, concrete is pumped into the machine, and the nozzle lays concrete one layer at a time. A printing trolley moves laterally and vertically while the whole machine travels along runway rails; the system is electrically powered.'),
      P('Two differentiators define it:'),
      UL([
        'It uses common, locally sourced concrete — not an expensive proprietary mortar.',
        'An external gate controls material flow at the nozzle, enabling clean starts/stops and consistent layers.',
      ]),
      P('The net effect eliminates the build-strip-repair-clean cycle, saving ~311 labor hours per home and cutting formwork production cost ~47–50% and material cost ~60–65% versus mortar-based concrete printers.'),
    ],
    '3': [
      H(1, '#3  Development Stage'),
      P('The technology is at TRL 6–7: core subsystems (concrete delivery, nozzle gate, gantry motion) are demonstrated and the team is building a beta prototype for a relevant application environment. MVP customer requirements are explicit — rapid deployment, reduced labor, structural reliability, and use of locally sourced materials.'),
      P('TVSF\'s role is to fund the beta prototype build and an independent third-party performance validation, moving the system from demonstrated subsystems (TRL 6–7) toward a field-validated first printer (TRL 7–8).'),
    ],
    '4': [
      H(1, '#4  Commercialization Strategy (SAM)'),
      P('Entry is proof-based: local, fragmented buyers whose barriers are trust, portability, and cost, and whose workflow already relies on subcontractors. Foundation sells into that workflow as "printing as a service" to general contractors and developers, priced per cubic yard of concrete, and partners with local schools and builders for demos and workforce pipeline.'),
      P('The motion is demos/tours → paid pilot → repeat jobs, using non-dilutive TVSF + SBIR Phase I to reach a validated pilot before scaling into the $23.7B formwork SAM.'),
    ],
    '5': [
      H(1, '#5  Intellectual Property'),
      P('Foundation\'s approach is anchored by two issued U.S. patents:'),
      UL([
        'U.S. Patent 11,273,574 — "Scalable Three-Dimensional Printing Apparatus" (the scalable gantry/print architecture).',
        'U.S. Patent 10,307,959 B2 — "Concrete Delivery System" (the concrete-delivery and nozzle-control mechanism).',
      ]),
      P('Together they protect the two core differentiators — the rail-scalable printer and the externally gated, local-concrete delivery path. Freedom-to-operate and a continuation strategy around the nozzle-gate control are part of the funded work.'),
    ],
    '6': [
      H(1, '#6  Business Model & Pro-forma P&L'),
      P('Foundation forms a joint venture per project, programs and prepares the print, and charges per cubic yard of concrete placed, at ≈$20,000 total price per job with a contribution margin of ≈37.5%. Printing-as-a-service keeps capital with Foundation and lowers the builder\'s barrier to adoption.'),
      TBL(['Pro-forma (per job, illustrative)', 'Value'], [
        ['Price per job', cur('$20,000')],
        ['Contribution margin', '≈37.5%'],
        ['Contribution per job', cur('$7,500')],
      ], 'Proforma'),
      P('Against a $27.4M near-term SOM, a modest fleet of printers running repeat jobs reaches sustainable unit economics quickly; gross margin expands as printer utilization rises.'),
    ],
    '7': [
      H(1, '#7  Current Financial Stage & Fundraising'),
      P('Foundation is pre-seed. The capital plan pairs $200k TVSF and $150k SBIR Phase I (non-dilutive, directed at R&D and the beta prototype) with a targeted $1.8M+ equity round.'),
      P('Equity investment is critical to scaling beyond the first printer; the non-dilutive grants exist to prove the market and de-risk the technology first, so the equity raise is priced on validated performance rather than on a concept. TVSF is the near-term unlock for the validated beta prototype that makes the round investable.'),
    ],
    '8': [
      H(1, '#8  Team / Management'),
      TBL(['Name', 'Role', 'Owns'], [
        ['Kate Ulepic', 'Chief Executive Officer', 'Strategy & fundraising'],
        ['Conor Atkins', 'Chief Operations Officer', 'Operations & print execution'],
        ['Connor Casey', 'Chief Financial Officer', 'Finance & capital plan'],
        ['Will Curley', 'Chief Technology Officer', 'Printer & delivery technology'],
      ], 'Team'),
      P('The team has identified and is actively recruiting for its known gaps — legal advisor, fundraiser, technician, and homebuilder partner — and is mentored through the Entrepreneurs\' Center (Paul Jackson, VP Strategic Programs).'),
    ],
    '9': [
      H(1, '#9  Competitive Landscape'),
      P('Against Traditional Formwork, Vitruvian, and COBOD International, Foundation wins on the dimensions that decide adoption:'),
      TBL(['Dimension', 'Foundation', 'Traditional', 'Vitruvian', 'COBOD'], [
        ['Time (days)', '✓', '✗', '✓', '✓'],
        ['Deployment', '✓', '✗', '✓', '✗'],
        ['Material accessibility', '✓', '✓', '✗', '✗'],
        ['Project costs', '✓', '✗', '✗', '✗'],
        ['Scalability', '✓', '✗', '✓', '✓'],
        ['Repeatable workflow', '✓', '✗', '✓', '✓'],
      ], 'Competitive'),
      P('Foundation is the only option that combines local-material accessibility and lowest project cost with rapid, scalable, repeatable deployment — traditional formwork is slow and labor-heavy, while other printers depend on costly proprietary mortar.'),
    ],
    '10': [
      H(1, '#10  Economic Impact (Ohio)'),
      P('Foundation is Ohio-based and Ohio-building. It lowers the cost of new single-family homes in a state facing a supply gap, supports builder margins, and creates skilled advanced-manufacturing and print-operator jobs.'),
      P('By partnering with local schools and builders for demos and training, it seeds a regional workforce pipeline and keeps concrete spend with local suppliers rather than proprietary-mortar vendors — compounding the in-state economic return of each job.'),
    ],
    '11': [
      H(1, '#11  Project Plan'),
      P('Milestones (name · description · success criteria · timeframe · approximate funds):'),
      TBL(['#', 'Milestone', 'Success criteria', 'Timeframe', 'Funds'], [
        ['1', 'Hire core team', 'Technician/operator roles filled', 'Months 1–2', cur('$10,000')],
        ['2', 'R&D with Converge', 'Validated printer + delivery/gate specs', 'Months 3–4', cur('$190,000')],
        ['3', 'Beta prototype build', 'Prints a test wall to spec', 'Months 6–8', '(in R&D)'],
        ['4', 'Third-party validation', 'Passing structural + throughput report', 'Months 9–14', cur('$30,000')],
        ['5', 'First printer build', 'Pilot-ready production unit', 'Months 11–14', cur('$300,000')],
      ], 'ProjectPlan'),
    ],
    '12': [
      H(1, '#12  Budget by Spend Type'),
      P('TVSF request: $200,000 of OTF Project Funds.'),
      TBL(['Spend type', 'OTF Project Funds', 'Notes'], [
        ['Personnel', cur('$40,000'), 'Founding-team time + first technical hire'],
        ['Equipment', cur('$120,000'), 'COTS + specialized printer/delivery parts (beta prototype)'],
        ['Supplies', cur('$10,000'), 'Concrete + consumables for prototype tests'],
        ['Purchased Services', cur('$30,000'), 'Converge development services + software partner'],
        ['TOTAL', cur('$200,000'), ''],
      ], 'Budget'),
      P('Narrative: the bulk of the grant funds Equipment (COTS + specialized parts to build the beta prototype with Converge) and Purchased Services (Converge engineering + software partner); Supplies cover concrete for prototype testing; Personnel covers founding-team time and the first technical hire.'),
    ],
  };
}

const keyOf = (title: string): string => {
  const t = title.trim();
  if (/^abstract/i.test(t)) return 'abstract';
  const m = t.match(/^#(\d+)/);
  return m ? m[1] : t;
};

try {
  const tenant = await getTenantBySlug('foundation');
  ok('tenant foundation', !!tenant, tenant?.id);
  const [opp] = await sql<{ id: string }[]>`SELECT id FROM opportunities WHERE program_type='tvsf' ORDER BY created_at DESC LIMIT 1`;
  ok('TVSF opportunity', !!opp, opp?.id);
  const [kate] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email='kate.ulepic@foundation3dp.com' LIMIT 1`;
  const [paul] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email='pjackson@ecinnovates.com' LIMIT 1`;

  // find (or provision) the proposal
  let [prop] = await sql<{ id: string; gateConfig: any }[]>`SELECT id, gate_config FROM proposals WHERE tenant_id=${tenant!.id}::uuid AND opportunity_id=${opp.id}::uuid ORDER BY created_at DESC LIMIT 1`;
  if (!prop) {
    const prov = await provisionProposalForPortal({ tenantId: tenant!.id, tenantName: tenant!.name, tenantSlug: 'foundation', opportunityId: opp.id, label: 'primary', actorId: kate.id, actorEmail: kate.email });
    if ('error' in prov) { ok('provision', false, prov.error); throw new Error(prov.error); }
    [prop] = await sql<{ id: string; gateConfig: any }[]>`SELECT id, gate_config FROM proposals WHERE id=${prov.proposalId}::uuid`;
  }
  const proposalId = prop.id;
  ok('proposal provisioned', !!proposalId, proposalId);

  // appoint Paul as an external proposal collaborator with per-stage edit access
  const stages: string[] = Array.isArray(prop.gateConfig) ? prop.gateConfig : ['draft', 'final'];
  const [collab] = await sql<{ id: string }[]>`
    INSERT INTO proposal_collaborators (proposal_id, user_id, email, name, role, invited_by, accepted_at)
    VALUES (${proposalId}::uuid, ${paul.id}::uuid, ${'pjackson@ecinnovates.com'}, ${'Paul Jackson'}, 'external', ${kate.id}::uuid, now())
    ON CONFLICT (proposal_id, email) DO UPDATE SET user_id=EXCLUDED.user_id, name=EXCLUDED.name, role='external', accepted_at=now()
    RETURNING id`;
  await sql`DELETE FROM collaborator_stage_access WHERE collaborator_id=${collab.id}::uuid`; // idempotent re-run
  for (const st of stages) {
    await sql`
      INSERT INTO collaborator_stage_access (collaborator_id, proposal_id, stage, permission, granted_by)
      VALUES (${collab.id}::uuid, ${proposalId}::uuid, ${st}, 'edit', ${kate.id}::uuid)`;
  }
  ok('Paul appointed proposal collaborator (external, per-stage edit)', true, `${stages.length} stage grants`);

  // draft all 13 sections
  const C = contentFor(proposalId);
  const secs = await sql<{ id: string; title: string; artifact_id: string; version: number }[]>`
    SELECT id, title, artifact_id, version FROM proposal_sections WHERE proposal_id=${proposalId}::uuid ORDER BY volume_number, section_number::int`;
  let drafted = 0;
  for (const s of secs) {
    const nodes = C[keyOf(s.title)];
    if (!nodes) { ok(`content for "${s.title}"`, false); continue; }
    const cdoc = doc(nodes, s.title, proposalId);
    await sql`UPDATE proposal_sections SET content=${JSON.stringify(cdoc)}, status='complete', version=version+1, last_modified_by=${kate.id}::uuid, updated_at=now() WHERE id=${s.id}::uuid`;
    drafted++;
  }
  ok('drafted 13 sections', drafted === secs.length, `${drafted}/${secs.length}`);

  // lock every section → matrix satisfied; roll up artifacts; set lock_count
  for (const s of secs) {
    await sql`UPDATE proposal_sections SET status='approved', accepted_by=${kate.id}::uuid, accepted_at=now(), completed_stage='draft', completed_at=now(), is_locked=true, locked_at=now(), locked_by=${kate.id}::uuid, editing_by=NULL, editing_since=NULL WHERE id=${s.id}::uuid AND is_locked=false`;
    await sql`UPDATE proposal_compliance_matrix SET status='satisfied', updated_at=now() WHERE section_id=${s.id}::uuid AND status<>'not_applicable'`;
  }
  await sql`UPDATE proposal_artifacts SET is_locked=true, status='locked', locked_at=now() WHERE proposal_id=${proposalId}::uuid`;

  // advance draft → submitted (auto-lock at final; mirrors advanceProposalStage)
  await sql`UPDATE proposals SET stage='submitted', is_locked=true, lock_count=${secs.length}, last_locked_at=now(), updated_at=now() WHERE id=${proposalId}::uuid`;
  try {
    await sql`INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by) VALUES (${proposalId}::uuid,'draft','final',${kate.id}::uuid),(${proposalId}::uuid,'final','submitted',${kate.id}::uuid)`;
  } catch { /* stage-history is best-effort */ }
  const [{ satn }] = await sql<{ satn: number }[]>`SELECT count(*)::int satn FROM proposal_compliance_matrix WHERE proposal_id=${proposalId}::uuid AND status='satisfied'`;
  ok('locked + advanced → submitted; matrix satisfied', satn === secs.length, `${satn}/${secs.length} satisfied`);

  // export each artifact via the system exporter (docx for narrative, xlsx for cost)
  mkdirSync(OUTDIR, { recursive: true });
  const arts = await sql<{ id: string; volumeName: string; artifactType: string }[]>`
    SELECT id, volume_name, artifact_type FROM proposal_artifacts WHERE proposal_id=${proposalId}::uuid ORDER BY volume_number`;
  const vars = { company_name: 'Foundation', topic_number: 'Ohio Third Frontier TVSF — Round 45' };
  const outFiles: string[] = [];
  for (const a of arts) {
    const eSecs = await sql<{ title: string | null; content: string | null }[]>`SELECT title, content FROM proposal_sections WHERE proposal_id=${proposalId}::uuid AND artifact_id=${a.id}::uuid ORDER BY section_number::int`;
    const canvas = assembleArtifactCanvas(eSecs as any, a.artifactType as any, a.volumeName);
    const fmt = a.artifactType === 'cost' ? 'xlsx' : 'docx';
    const buf = await renderCanvas(fmt, canvas as any, vars);
    const fname = `Foundation_TVSF_${a.volumeName.replace(/\W+/g, '_')}.${fmt}`;
    const outPath = path.join(OUTDIR, fname);
    writeFileSync(outPath, buf as any);
    outFiles.push(outPath);
    ok(`exported ${a.volumeName} (.${fmt}, system exporter)`, (buf as any).length > 3000, `${(buf as any).length} bytes → ${fname}`);
  }

  console.log(`\nPROPOSAL_ID=${proposalId}`);
  console.log('FILES=' + JSON.stringify(outFiles));
} finally {
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ FOUNDATION TVSF BUILD GREEN' : `❌ ${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
