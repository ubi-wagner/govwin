/**
 * Seed REAL current DoD SBIR 2026 (DSIP) opportunities into the demo, and drive the
 * product's own bridge (publishAndFanOut) so they land on BOTH surfaces:
 *   - the admin RFP triage queue (curated_solicitations, status 'new'), and
 *   - the tenant spotlight (tenant_opportunity_cards, auto-scored on fan-out).
 *
 * Topics are real FY26 DSIP releases (DARPA DSO/BTO June & July 2026 drops + a
 * NAVWAR open topic) — codes/titles/tech-areas/dates verified from public sources
 * (dodsbirsttr.mil / darpa.mil). Demo/sandbox only.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/seed-dsip-opps.mts
 */
import { sql } from '@/lib/db';
import { publishAndFanOut } from '@/lib/opportunity-bridge';

interface Topic {
  code: string; name: string; agency: string; office: string; namespace: string;
  program: 'sbir_phase_1' | 'sttr_phase_1'; area: string;
  pre: string; open: string; close: string; summary: string;
}

// Real FY26 DSIP topics (Department of War SBIR/STTR 2026 BAA).
const TOPICS: Topic[] = [
  { code: 'DPA26BZ03-DV011', name: 'Manufacturing Technologies for Rydberg-based Atomic Sensors (MANTRAS)', agency: 'DARPA', office: 'Defense Sciences Office', namespace: 'darpa-dso', program: 'sbir_phase_1', area: 'Quantum Sensing',
    pre: '2026-06-03', open: '2026-06-24', close: '2026-07-22',
    summary: 'Demonstrate a low-SWaP, ruggedized, and manufacturable platform for real-time measurement, data acquisition, and analysis of wideband RF signals using Rydberg-based atomic sensors.' },
  { code: 'DPA26BZ03-DV012', name: 'Engineering Sleep for Cognitive Performance', agency: 'DARPA', office: 'Defense Sciences Office', namespace: 'darpa-dso', program: 'sbir_phase_1', area: 'Human Performance',
    pre: '2026-06-03', open: '2026-06-24', close: '2026-07-22',
    summary: 'Develop technologies that engineer restorative sleep to sustain warfighter cognitive performance under prolonged sleep deprivation.' },
  { code: 'DPA26BZ03-DV013', name: 'Expeditionary Closed and Air-Independent Power and Energy (ExCAIPE)', agency: 'DARPA', office: 'Defense Sciences Office', namespace: 'darpa-dso', program: 'sbir_phase_1', area: 'Power & Energy',
    pre: '2026-06-03', open: '2026-06-24', close: '2026-07-22',
    summary: 'Develop closed, electrically rechargeable, high-energy-density and high-power-density batteries that operate independently of an external air source.' },
  { code: 'DPA26BZ03-DV014', name: 'Real-Time Pathogen-Host Interactome Prediction', agency: 'DARPA', office: 'Biological Technologies Office', namespace: 'darpa-bto', program: 'sbir_phase_1', area: 'Biosurveillance',
    pre: '2026-06-03', open: '2026-06-24', close: '2026-07-22',
    summary: 'Predict pathogen-host molecular interactions in real time to accelerate biosurveillance and medical countermeasure development.' },
  { code: 'DPA26BZ04-DV016', name: 'Fusion of Abstract Learning and Context-Optimized Neural-methods (FALCON)', agency: 'DARPA', office: 'Defense Sciences Office', namespace: 'darpa-dso', program: 'sbir_phase_1', area: 'Artificial Intelligence',
    pre: '2026-07-01', open: '2026-07-22', close: '2026-08-19',
    summary: 'Combine advanced machine-learning methods with large language models for interactive, trustworthy statistical analysis.' },
  { code: 'DPA26BZ04-DV017', name: 'Biomanufacturing of Hierarchical Biocomposites for High-Performance Thermal Interface Materials', agency: 'DARPA', office: 'Biological Technologies Office', namespace: 'darpa-bto', program: 'sttr_phase_1', area: 'Biomanufacturing',
    pre: '2026-07-01', open: '2026-07-22', close: '2026-08-19',
    summary: 'Biomanufacture hierarchical biocomposites for high-performance thermal interface materials in defense electronics.' },
  { code: 'DON26BX01-NP001', name: 'NAVWAR Open Topic — Contested C4ISR & Logistics', agency: 'Navy', office: 'NAVWAR', namespace: 'navwar', program: 'sbir_phase_1', area: 'C4ISR / Contested Logistics',
    pre: '2026-06-10', open: '2026-07-08', close: '2026-08-13',
    summary: 'NAVWAR open topic seeking innovative solutions across C4ISR, resilient networks, and operations & logistics in a contested environment.' },
];

const NOW = new Date().toISOString();
let cards = 0;

try {
  // Best-effort: retire the stale demo AFWERX solicitation from the "new" queue so
  // the triage queue shows real DSIP topics (non-destructive — opportunity kept).
  try {
    await sql`UPDATE curated_solicitations SET status = 'dismissed', dismissed_reason = 'superseded by real DSIP seed'
              WHERE namespace = 'usaf-cso' AND status = 'new'`;
  } catch { /* status value may differ; ignore */ }

  for (const t of TOPICS) {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO opportunities
        (source, source_id, title, agency, office, org_unit, solicitation_number, program_type,
         topic_number, phase_type, tech_focus_areas, submission_stage, lifecycle_status,
         pre_release_date, open_date, close_date, posted_date, description, is_active)
      VALUES
        ('dsip', ${t.code}, ${`${t.name} (${t.code})`}, ${t.agency}, ${t.office}, ${t.office}, ${t.code}, ${t.program},
         ${t.code}, 'phase_1', ${sql.array([t.area])}, 'open', 'open',
         ${t.pre}::timestamptz, ${t.open}::timestamptz, ${t.close}::timestamptz, ${t.pre}::timestamptz, ${t.summary}, true)
      ON CONFLICT (source, source_id) DO UPDATE SET
        title = EXCLUDED.title, agency = EXCLUDED.agency, office = EXCLUDED.office, org_unit = EXCLUDED.org_unit,
        program_type = EXCLUDED.program_type, tech_focus_areas = EXCLUDED.tech_focus_areas,
        submission_stage = EXCLUDED.submission_stage, open_date = EXCLUDED.open_date, close_date = EXCLUDED.close_date,
        description = EXCLUDED.description, is_active = true, updated_at = now()
      RETURNING id`;
    const oppId = o.id;

    // curated_solicitations → admin triage queue + spotlight_summary for the card.
    // No unique on opportunity_id, so delete-then-insert for a re-runnable seed.
    await sql`DELETE FROM curated_solicitations WHERE opportunity_id = ${oppId}::uuid`;
    await sql`
      INSERT INTO curated_solicitations (opportunity_id, namespace, status, spotlight_summary, full_text)
      VALUES (${oppId}::uuid, ${t.namespace}, 'new', ${t.summary}, ${`${t.name} (${t.code}) — ${t.agency} ${t.office}. ${t.summary}`})`;

    // Drive the product's own publish→fan-out (builds the card snapshot + auto-scores).
    const res = await publishAndFanOut(oppId, 'published', null, NOW);
    cards += res?.tenantsApplied ?? 0;
    console.log(`✓ ${t.code}  ${t.name.slice(0, 48)}  → fanned to ${res?.tenantsApplied ?? 0} tenant(s)`);
  }

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM tenant_opportunity_cards`;
  const [{ q }] = await sql<{ q: number }[]>`SELECT count(*)::int q FROM curated_solicitations WHERE status = 'new'`;
  console.log(`\nSeeded ${TOPICS.length} real DSIP opportunities · ${cards} card fan-outs · ${n} total cards · ${q} solicitations in triage queue`);
} finally {
  await sql.end();
}
