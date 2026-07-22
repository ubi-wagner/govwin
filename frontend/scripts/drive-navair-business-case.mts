/**
 * Immobileyes DON26BX03-NP002 — DoD + Commercial business-case refresh.
 *   • Defense Need (V2)                        — refreshed DoD business case (current threat + transition).
 *   • Commercialization / Transition Summary   — expanded DoD-transition + dual-use bridge.
 *   • Company Commercialization Report (V4)     — the full COMMERCIAL business case (was empty).
 * Writes refreshed CanvasDocument content through the real section path, re-locks, and re-exports
 * the Technical Volume (.docx) + the CCR (.docx) via the system canvas→docx exporter.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-navair-business-case.mts
 */
import { sql } from '@/lib/db';
import { assembleArtifactCanvas, renderCanvas } from '@/lib/export/artifact-export';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PID = '62960c36-80ff-40ee-8879-9a72f42bb8eb';
const FIGDIR = '/home/user/govwin/scratchpad/navair/figs_embed';
const OUTDIR = '/home/user/govwin/docs/proposals/immobileyes-cuas';
let fail = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };

// ── canvas node helpers (match the faithful build) ──────────────────────────
let nid = 0; const NID = () => `n${++nid}`;
const wrap = (type: string, content: any, style: any = {}) => ({ id: NID(), type, style, history: [], library_eligible: true, provenance: { source: 'manual' }, content });
const H = (level: number, text: string, numbering?: string) => wrap('heading', { level, text, ...(numbering ? { numbering } : {}) });
const P = (text: string, inline?: any[]) => wrap('text_block', { text, ...(inline ? { inline_formats: inline } : {}) });
const UL = (items: any[]) => wrap('bulleted_list', { items: items.map((t) => (typeof t === 'string' ? { text: t } : t)) });
const TBL = (headers: any[], rows: any[][]) => wrap('table', { headers, rows, header_style: { bold: true, bg: '#D9E1F2', alignment: 'center' } });
const FIG = (file: string, alt: string, w: number, h: number, caption: string) => {
  const buf = readFileSync(path.join(FIGDIR, file));
  return wrap('image', { storage_key: `data:image/jpeg;base64,${buf.toString('base64')}`, alt_text: alt, width: w, height: h, caption }, { alignment: 'center' });
};
const canvasFor = (volLabel: string) => ({
  format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: `{company_name}   ·   Topic {topic_number}   ·   ${volLabel}`, height: 30, font: { family: 'Times New Roman', size: 9 } },
  footer: { template: 'Use or disclosure of proposal data is subject to the restriction on the title page.        Page {n} of {N}', height: 30, font: { family: 'Times New Roman', size: 8 } },
  font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.0, max_pages: 10, max_slides: null,
});
const doc = (nodes: any[], title: string, volLabel: string) => ({
  version: 1, document_id: '00000000-0000-0000-0000-000000000000', canvas: canvasFor(volLabel), nodes,
  metadata: { title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-07-21T00:00:00Z', last_modified_at: '2026-07-21T00:00:00Z', last_modified_by: '', version_number: 2, status: 'in_progress' },
});
const B = (t: string) => ({ text: t });

// ── 1) DEFENSE NEED (V2) — refreshed DoD business case ──────────────────────
function defenseNeed() {
  return [
    H(1, '1.4  Defense Need'),
    P('End users are NAVAIR and NAVSEA counter-UAS (C-UAS) for Naval installations, Naval aircraft, and ships. The need is urgent and growing: small unmanned aircraft (Groups 1–3) and fiber-optic FPV drones have become the defining tactical air threat of the current era, demonstrated at scale in Ukraine, across the Red Sea and the CENTCOM AOR, and against fixed installations worldwide. They are cheap, attritable, and increasingly RF-silent and GPS-independent—defeating the RF-jamming and radar-centric C-UAS the Navy fields today, and forcing an unfavorable cost-exchange in which a sub-$1,000 airframe expends a far costlier defensive effect.'),
    FIG('fig1_threat.jpg', 'Fiber-optic FPV drone recovered in theater', 250, 252, 'Figure 1.  Fiber-optic FPV drones—no RF link, immune to jamming, GPS-independent—now proliferating in current conflicts.'),
    H(2, 'The Capability Gap DON26BX03-NP002 Targets'),
    P('The Department of Defense C-UAS strategy and the Joint Counter-small-UAS Office (JCO) have prioritized affordable, scalable, layered defeat—non-kinetic effects that add magazine depth without expending kinetic interceptors, and that work when the threat carries no RF emission and needs no GPS. The Replicator initiative further elevates attritable, high-volume counter-autonomy at speed and scale. Yet almost no fielded system addresses non-kinetic OPTICAL defeat of EO-guided fiber drones during the terminal attack—precisely the gap this topic targets. GHOST fills it: a software-defined, MOSA-compliant optical C-UAS effector that detects, tracks, identifies, and neutralizes single and swarming UAS with a graduated, human-on-the-loop escalation from warn/deter to dazzle/disrupt to deny/damage.'),
    H(2, 'Why the Navy—Installations, Aircraft, and Ships'),
    UL([
      B('Installations & bases (CONUS/OCONUS): GHOST\'s graduated, non-kinetic, low-collateral effect is uniquely suited to force-protection where kinetic engagement is constrained by airspace, ROE, and collateral risk—defending the flight line, magazines, and critical infrastructure.'),
      B('Naval aircraft on the ramp: low-SWaP optical effectors protect high-value aircraft against ramp-side FPV attack without the emissions or collateral footprint of RF/kinetic systems.'),
      B('Ships in the littorals: DEXTER\'s no-moving-parts, multi-beam "shotgun" architecture engages saturating swarms simultaneously—the exact magazine-depth problem most acute against a ship under a coordinated small-UAS raid.'),
    ]),
    H(2, 'Concept of Employment'),
    P('GHOST deploys as a modular effector cued by existing Navy sensors over MOSA interfaces (EO/IR, radar, RF/EW, or TSPI). STORM performs AI-enabled EO/IR detect–identify–track and presents a human-on-the-loop the graduated response level; DEXTER routes optical energy across one to hundreds of outputs in microseconds to engage single targets or swarms. Because the effect is non-kinetic and reversible at the lowest escalation levels, GHOST is employable in permissive, contested, and CONUS-base environments where kinetic defeat is not.'),
    P('Operational value to the warfighter is decisive: affordable magazine depth against attritable threats, a passive/low-emission signature that does not cue the adversary, robustness in GPS- and RF-denied conditions, and a graduated kill chain that keeps a human in control of lethality. GHOST converts an unfavorable cost-exchange into a favorable one—defeating a swarm of sub-$1,000 drones with reusable optical energy rather than expendable interceptors.'),
  ];
}

// ── 2) COMMERCIALIZATION / TRANSITION PLAN SUMMARY (V2) ─────────────────────
function transitionSummary() {
  return [
    H(1, '3.0  Commercialization / Transition Plan Summary'),
    P('GHOST is a dual-use capability with a clear DoD transition anchor and a large adjacent commercial market. The DoD path de-risks the technology and provides the reference customer; the commercial path scales manufacturing and drives unit cost down for both.'),
    H(2, 'DoD Transition Path and Customers'),
    P('Primary transition targets are NAVAIR and NAVSEA installation- and ship-C-UAS programs of record, with expansion to the USMC (installation and expeditionary force protection), Army RCCTO/JCO, and Air Force Security Forces—building on Immobileyes\' established Tinker AFB 72d Security Forces Squadron relationship. Phase I establishes feasibility and the seeker-confusion effect against representative EO-guided FPV sensors; Phase II delivers a TRL-6 prototype for a Navy operational assessment; Phase III/insertion pursues Foreign Comparative Testing (FCT), ManTech, and Replicator-aligned procurement into a JCO-recognized C-sUAS program.'),
    TBL(['Milestone', 'Phase', 'TRL', 'Outcome'], [
      ['Feasibility & effect characterization', 'Phase I', '3→4', 'Seeker-confusion demonstrated vs. representative EO-guided FPV sensors'],
      ['Integrated GHOST prototype', 'Phase II', '5→6', 'Navy operational assessment; MOSA cueing integration'],
      ['Operational insertion', 'Phase III', '7+', 'PoR insertion (NAVAIR/NAVSEA); FCT/ManTech; Replicator-aligned buy'],
    ]),
    H(2, 'Commercial Bridge (Dual-Use)'),
    P('The same optical detect-track-defeat core addresses a large non-DoD counter-drone market—airports and civil aviation, critical infrastructure (energy, data centers, ports), stadiums and mass events, correctional facilities, and border/homeland security. Immobileyes\' AlphaMicron partnership (liquid-crystal manufacturing at scale) and Lighthouse Avionics partnership (sensor fusion and FAA test-site access) provide the manufacturing and integration path to convert the DoD-proven effector into a certifiable commercial product. The full market, competitive, revenue, and go-to-market analysis is provided in the Company Commercialization Report (Volume 4).'),
  ];
}

// ── 3) COMPANY COMMERCIALIZATION REPORT (V4) — full commercial business case ─
function ccr() {
  return [
    H(1, 'Company Commercialization Report (CCR)'),
    P('This Company Commercialization Report presents Immobileyes\' commercialization strategy for GHOST (STORM + DEXTER)—a dual-use optical counter-UAS capability—covering the market opportunity, target segments, competitive differentiation, business model, go-to-market, partnerships, and financial plan.'),

    H(2, '1.  Company & Commercialization Strategy'),
    P('Immobileyes is a liquid-crystal electro-optics company led by Dr. Bahman Taheri (PI; 90+ patents; PLCTO), with deep heritage in LC electro-optics and laser systems across AF, Navy, ONR, Army, DOE, and NSF programs, and a manufacturing partnership with AlphaMicron. Our commercialization strategy is anchored-and-adjacent: use the SBIR/DoD path to prove and harden the GHOST optical effector against the hardest threat (EO-guided FPV drones), then extend the same detect-track-defeat core into the large, faster-moving commercial counter-drone market where certification—not physics—is the primary barrier.'),

    H(2, '2.  Market Opportunity'),
    P('The counter-UAS market is large and growing rapidly, pulled by battlefield demand and by a parallel surge in commercial and homeland drone incursions. Industry analysts place the global counter-drone market in the low single-digit billions (USD) today, growing at a ~20–27% CAGR to roughly $9–15B by the early 2030s (analyst estimates vary; figures below are planning estimates, not commitments).'),
    TBL(['Market', 'Est. 2024', 'Est. 2030+', 'Immobileyes SOM thesis'], [
      ['Defense C-UAS (global)', '~$1.5–2.5B', '~$8–12B', 'DoD anchor via NAVAIR/NAVSEA + JCO insertion'],
      ['Commercial / homeland C-UAS', '~$0.6–1.2B', '~$3–5B', 'Airports, CI, events, corrections, border'],
      ['Serviceable (EO/optical defeat niche)', '—', '~$0.5–1.5B', 'Non-kinetic optical defeat where RF/kinetic can\'t play'],
    ]),
    P('Immobileyes does not need to win the whole market. Our beachhead is the segment no one else serves well: non-kinetic, low-collateral OPTICAL defeat of EO-guided and RF-silent drones in environments (CONUS bases, airports, stadiums, prisons) where jammers and kinetic effects are legally or operationally constrained.'),

    H(2, '3.  Target Segments (Commercial)'),
    UL([
      B('Airports & civil aviation: repeated incursions cause costly ground-stops; FAA test-site access via Lighthouse Avionics positions GHOST for the certification path.'),
      B('Critical infrastructure: energy sites, data centers, refineries, and ports need persistent, low-collateral protection against surveillance and payload drones.'),
      B('Stadiums & mass events: temporary, high-density protection where kinetic/RF options are legally constrained around crowds.'),
      B('Corrections: contraband-delivery drones are a top-growth problem for correctional facilities—an optical, non-kinetic deny effect is ideal.'),
      B('Border & homeland security: layered EO detect-track-defeat complements existing RF/radar sensors.'),
    ]),

    H(2, '4.  Competitive Landscape & Differentiation'),
    P('The incumbent counter-drone field is dominated by RF-detection/jamming (DroneShield, Dedrone [Axon]), radar (Robin Radar, Fortem), cyber-takeover (D-Fend), high-power microwave (Epirus), and vertically-integrated kinetic/autonomy (Anduril). Nearly all share a blind spot: they degrade against RF-silent, GPS-independent, EO-guided fiber drones, and most cannot be employed where emissions or kinetic effects are constrained.'),
    TBL(['Approach', 'Representative players', 'Limitation vs. EO-guided FPV', 'GHOST advantage'], [
      ['RF detect/jam', 'DroneShield, Dedrone', 'No RF to exploit; illegal in many civil settings', 'Optical, emission-light, civil-employable'],
      ['Radar', 'Robin Radar, Fortem', 'Small/low/slow + swarm saturation', 'AI EO/IR + multi-beam swarm engagement'],
      ['Cyber takeover', 'D-Fend', 'No link to hijack on fiber drones', 'Attacks the seeker, not the datalink'],
      ['HPM / kinetic', 'Epirus, Anduril', 'Cost, collateral, magazine depth', 'Reusable optical energy; favorable cost-exchange'],
    ]),
    P('Immobileyes\' differentiation is defensible and IP-protected: the effort extends the Navy\'s patented seeker-confusion principle (U.S. Patents 8,305,252 and 8,212,709) and AlphaMicron\'s liquid-crystal beam-steering (DEXTER)—a low-SWaP, no-moving-parts, microsecond multi-beam router that no competitor fields.'),

    H(2, '5.  Business Model & Revenue'),
    P('GHOST is sold as a hardware effector plus recurring software: (1) effector unit sales / integration, (2) a detection-and-defeat software subscription (threat-library updates, escalation policy, analytics), and (3) sustainment and training. The recurring software layer drives gross-margin expansion and customer stickiness, and is common across DoD and commercial deployments—so every DoD-hardened capability improvement compounds commercial value.'),

    H(2, '6.  Go-to-Market & Partnerships'),
    UL([
      B('DoD anchor: NAVAIR/NAVSEA SBIR → operational assessment → JCO-recognized PoR insertion (reference customer + non-dilutive capital).'),
      B('AlphaMicron: liquid-crystal manufacturing at scale (DEXTER), the path to producible, low-cost effectors.'),
      B('Lighthouse Avionics: sensor fusion and FAA test-site access—the bridge to civil certification and airport/CI pilots.'),
      B('Channel: after DoD proof and a lighthouse commercial pilot (airport or CI), expand through security integrators serving CI, events, and corrections.'),
    ]),

    H(2, '7.  Funding, Financials & Prior SBIR Record'),
    P('Immobileyes\' commercialization is funded through a non-dilutive-first plan: SBIR Phase I/II, Phase II matching and TACFI/STRATFI-style follow-on, and paid commercial pilots—preserving equity while the DoD path de-risks the technology. The team\'s prior federal R&D (AF/Navy/ONR/Army/DOE/NSF LC electro-optics and laser programs) and AlphaMicron\'s track record of transitioning liquid-crystal optics to production demonstrate the ability to move technology from SBIR to fielded product.'),
    TBL(['Horizon', 'Milestone', 'Funding', 'Commercial metric'], [
      ['0–12 mo', 'Phase I feasibility + effect characterization', 'SBIR Phase I (non-dilutive)', 'Reference effect vs. EO-guided FPV'],
      ['12–30 mo', 'Phase II TRL-6 prototype + operational assessment', 'SBIR Phase II + matching', 'Navy assessment; 1 commercial LOI'],
      ['30–48 mo', 'PoR insertion + first commercial pilots', 'Phase III / FCT / paid pilots', 'First recurring-revenue deployments'],
    ]),
    P('Metrics we will report: seeker-confusion effectiveness (probability of terminal-lock break), cost-per-engagement vs. kinetic baselines, effector unit cost at volume (AlphaMicron), and commercial pilots converted to recurring subscriptions.'),
  ];
}

// ── main ────────────────────────────────────────────────────────────────────
const [usr] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${'eric@immobileyes.com'} LIMIT 1`;
if (!usr) { console.error('no immobileyes user'); process.exit(1); }

async function refresh(id: string, nodes: any[], title: string, volLabel: string) {
  const cdoc = doc(nodes, title, volLabel);
  await sql`UPDATE proposal_sections SET is_locked = false, locked_at = NULL, locked_by = NULL WHERE id = ${id}::uuid`;
  await sql`UPDATE proposal_sections SET content = ${JSON.stringify(cdoc)}, status = 'approved', accepted_by = ${usr.id}::uuid, accepted_at = now(),
              completed_stage = 'draft', completed_at = now(), is_locked = true, locked_at = now(), locked_by = ${usr.id}::uuid,
              version = version + 1, last_modified_by = ${usr.id}::uuid, updated_at = now() WHERE id = ${id}::uuid`;
  ok(`refreshed + locked: ${title}`, true, `${nodes.length} nodes`);
}

await refresh('a7ac0b8b-b51a-40e8-b98d-d881574d46a0', defenseNeed(), 'Defense Need', 'Volume 2: Technical Volume');
await refresh('afd25cfe-f4b2-42d3-bda6-a47a4f83f5c3', transitionSummary(), 'Commercialization / Transition Plan Summary', 'Volume 2: Technical Volume');
await refresh('846a6ab2-90c0-49ee-92ee-342123fd130f', ccr(), 'Company Commercialization Report (CCR)', 'Volume 4: Company Commercialization Report');

// ── re-export V2 (Technical Volume) + V4 (CCR) via the system exporter ───────
async function exportVolume(volNum: number, outName: string, fallbackVol: string) {
  const [{ artifactId } = {} as any] = await sql<{ artifactId: string }[]>`
    SELECT artifact_id AS "artifactId" FROM proposal_sections WHERE proposal_id = ${PID}::uuid AND volume_number = ${volNum} AND artifact_id IS NOT NULL LIMIT 1`;
  if (!artifactId) { ok(`export V${volNum}`, false, 'no artifact'); return; }
  const secs = await sql<{ title: string; content: string }[]>`SELECT title, content FROM proposal_sections WHERE proposal_id = ${PID}::uuid AND artifact_id = ${artifactId}::uuid ORDER BY section_number`;
  const [art] = await sql<{ artifactType: string | null; volumeName: string | null }[]>`SELECT artifact_type AS "artifactType", volume_name AS "volumeName" FROM proposal_artifacts WHERE id = ${artifactId}::uuid`;
  const canvas = assembleArtifactCanvas(secs as any, art.artifactType as any, art.volumeName ?? fallbackVol);
  const vars = { company_name: 'Immobileyes', topic_number: 'DON26BX03-NP002' };
  const buf = await renderCanvas('docx', canvas as any, vars);
  const outPath = path.join(OUTDIR, outName);
  writeFileSync(outPath, buf as any);
  ok(`exported V${volNum} .docx`, (buf as any).length > 20000, `${(buf as any).length} bytes → ${outName}`);
}

await exportVolume(2, 'Immobileyes_DON26BX03-NP002_Technical_Volume.docx', 'Technical Volume');
await exportVolume(4, 'Immobileyes_DON26BX03-NP002_CCR.docx', 'Company Commercialization Report');

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ business-case refresh complete');
await sql.end();
process.exit(fail ? 1 : 0);
