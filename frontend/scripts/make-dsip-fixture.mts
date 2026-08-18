/** Build the DSIP-style single-PDF fixture for the deconstruct drive.
 *
 *  Renders a realistic merged proposal download — the five DSIP volumes, each opening
 *  with its own "Volume N — <name>" separator heading and carrying substantive body
 *  paragraphs — through the app's own Chromium PDF exporter, so the drive uploads a REAL
 *  text-layer PDF (what pdf-parse actually sees in production), not a synthetic string.
 *
 *  cd frontend && node --import tsx scripts/make-dsip-fixture.mts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { exportToPdf } from '../lib/export/pdf-exporter';
import type { CanvasDocument, CanvasNode } from '../lib/types/canvas-document';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'dsip-sample.pdf');

const h1 = (text: string): CanvasNode => ({
  id: randomUUID(), type: 'heading', content: { level: 1 as const, text },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);
const h2 = (text: string): CanvasNode => ({
  id: randomUUID(), type: 'heading', content: { level: 2 as const, text },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);
const p = (text: string): CanvasNode => ({
  id: randomUUID(), type: 'text_block', content: { text },
  style: {}, provenance: { source: 'manual' }, history: [], library_eligible: true,
} as unknown as CanvasNode);

const nodes: CanvasNode[] = [
  p('Aerivio Incorporated — SBIR Phase I Proposal Package, downloaded from the Defense SBIR/STTR Innovation Portal for topic N251-042 counter-UAS payload integration.'),

  h1('Volume 1 — Proposal Cover Sheet'),
  p('Firm name Aerivio Incorporated, UEI ZZAERIV123XX, CAGE 9Z9Z9, principal investigator Dana Reyes, corporate official Kate Ulepic, address 400 Innovation Way, Dayton Ohio 45402.'),
  p('Proposed title: Modular counter-UAS mission payload for Group 2 unmanned aircraft with GPS-denied navigation and open-architecture autonomy hosting for contested environments.'),

  h1('Volume 2 — Technical Volume'),
  h2('Identification of the Problem or Opportunity'),
  p('Small unmanned aerial systems pose an accelerating threat to expeditionary forces because interceptor payloads remain platform-locked, sensor pipelines saturate in cluttered RF environments, and refit cycles run months behind adversary drone iterations in every fielded configuration today.'),
  h2('Phase I Technical Objectives'),
  p('Objective one demonstrates a modular payload interface that hot-swaps effectors in under ten minutes. Objective two validates GPS-denied navigation to five meter accuracy across a thirty minute sortie. Objective three hosts third-party autonomy behind a government-owned message schema.'),
  p('The work plan spans six months with laboratory integration in months one through three, captive-carry characterization in month four, and a full field demonstration culminating in month six with government witnesses invited to score every objective against quantitative exit criteria.'),

  h1('Volume 3 — Cost Volume'),
  p('Total proposed cost is one hundred thirty nine thousand nine hundred eighty two dollars across the six month base period, comprising direct labor of ninety one thousand five hundred dollars, overhead applied at forty percent, materials of twelve thousand dollars, and a seven percent fee.'),
  p('Direct labor rates derive from current payroll actuals: principal investigator at ninety five dollars per hour for four hundred twenty hours, senior integration engineer at seventy eight dollars per hour for five hundred sixty hours, and flight test technician at fifty two dollars per hour.'),

  h1('Volume 4 — Company Commercialization Report'),
  p('Aerivio reports no prior SBIR or STTR Phase III revenue as a first-time DSIP proposer. The commercialization strategy targets prime integrators fielding Group 2 platforms, with two signed letters of intent and a dual-use path into critical-infrastructure perimeter security markets.'),

  h1('Volume 5 — Supporting Documents'),
  p('Attached herein are letters of support from PMA-263 and the AFWERX program office, a university teaming letter covering navigation research, and facility documentation for the Dayton integration laboratory including its anechoic chamber and outdoor flight corridor authorization.'),
];

const doc = {
  version: 1,
  document_id: randomUUID(),
  canvas: {
    format: 'letter', width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: null, footer: null,
    font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.15,
    max_pages: null, max_slides: null,
  },
  nodes,
  metadata: {
    title: 'Aerivio DSIP Proposal Package', volume_id: '', required_item_id: '',
    proposal_id: '', solicitation_id: '', created_at: new Date().toISOString(),
    last_modified_at: new Date().toISOString(), last_modified_by: 'fixture',
    version_number: 1, status: 'accepted',
  },
} as unknown as CanvasDocument;

const buf = await exportToPdf(doc, {});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buf);
console.log(`wrote ${OUT} (${buf.length} bytes)`);
