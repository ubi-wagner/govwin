/**
 * Ingest Assist — the PARSE CONTRACT + the default SBIR/CSO skeleton (PURE).
 *
 * Types shared by the AI parser (parse-solicitation.ts) and the DB materializer
 * (materialize.ts). This module imports nothing DB-coupled so it stays
 * unit-testable. The materializer that writes these into the live schema lives
 * in materialize.ts.
 */

// ── Types (the parse contract) ──────────────────────────────────────
export interface ParsedItem { name: string; type?: string; pageLimit?: number | null; notes?: string | null }
export interface ParsedVolume { name: string; format?: string; notes?: string | null; items: ParsedItem[] }
export interface ParsedCompliance {
  pageLimitTechnical?: number | null;
  fontFamily?: string | null; fontSize?: string | null; minFontSize?: number | null;
  margins?: string | null; submissionFormat?: string | null;
  itarRequired?: boolean; imagesTablesAllowed?: boolean;
  requiredSections?: string[]; requiredDocuments?: string[];
}
export interface ParsedTopic {
  code: string; title: string; agency?: string | null; office?: string | null;
  phaseType?: string | null; programType?: string | null;
  summary?: string | null; description?: string | null; techFocusAreas?: string[];
  openDate?: string | null; closeDate?: string | null; preReleaseDate?: string | null;
}
export interface ParsedSolicitation {
  compliance: ParsedCompliance;
  volumes: ParsedVolume[];
  topics: ParsedTopic[]; // empty ⇒ the solicitation's own umbrella opportunity is the single card
  source?: 'ai' | 'default' | 'override';
}

/**
 * The DoW SBIR/STTR CSO default skeleton — the 6-volume structure + the CSO-
 * mandated 12-section Technical Volume order. Used when the AI parse is
 * unavailable or thin, so Ingest Assist ALWAYS produces a sound, compliant
 * starting skeleton the curator can refine. (This is exactly the structure the
 * Immobileyes CUAS build was seeded from.)
 */
export const DEFAULT_SBIR_CSO_SKELETON: Pick<ParsedSolicitation, 'compliance' | 'volumes'> = {
  compliance: {
    pageLimitTechnical: 10, fontFamily: 'Times New Roman', fontSize: '10', minFontSize: 10,
    margins: '1 inch (all sides)',
    submissionFormat: 'Single PDF white paper — 8.5x11, single-column, single-spaced, 1-inch margins, 10-pt minimum font.',
    itarRequired: false, imagesTablesAllowed: true,
    requiredSections: [
      'Identification and Significance of the Problem or Opportunity', 'Phase I Technical Objectives',
      'Phase I Statement of Work', 'Related Work', 'Relationship with Future Research or R&D',
      'Commercialization Strategy', 'Key Personnel', 'Foreign Citizens', 'Facilities/Equipment',
      'Subcontractors/Consultants', 'Prior, Current, or Pending Support', 'Technical Data Rights Assertions',
    ],
    requiredDocuments: ['Foreign Nationals Disclosure', 'Letters of Support', 'DD Form 2345', 'Technical Data Rights Assertions', 'CMMC Reps & Certs'],
  },
  volumes: [
    { name: 'Proposal Cover Sheet', notes: 'Volume 1 — DSIP cover sheet + Technical Abstract + SBC certifications.', items: [
      { name: 'Proposal Cover Sheet & Technical Abstract', type: 'form_sbir_certs' } ] },
    { name: 'Technical Volume', notes: 'Volume 2 — the white paper. Single PDF, single-column, single-spaced, 1-inch margins, 10pt min.', items: [
      { name: 'Identification and Significance of the Problem or Opportunity', type: 'word_doc', pageLimit: 2 },
      { name: 'Phase I Technical Objectives', type: 'word_doc', pageLimit: 1 },
      { name: 'Phase I Statement of Work', type: 'word_doc', pageLimit: 3 },
      { name: 'Related Work', type: 'word_doc', pageLimit: 1 },
      { name: 'Relationship with Future Research or Research and Development', type: 'word_doc', pageLimit: 1 },
      { name: 'Commercialization Strategy', type: 'word_doc', pageLimit: 1 },
      { name: 'Key Personnel', type: 'word_doc', pageLimit: 1 },
      { name: 'Foreign Citizens', type: 'word_doc' },
      { name: 'Facilities/Equipment', type: 'word_doc' },
      { name: 'Subcontractors/Consultants', type: 'word_doc' },
      { name: 'Prior, Current, or Pending Support of Similar Proposals or Awards', type: 'word_doc' },
      { name: "Assertion of Restrictions on the Government's Use/Release of Technical Data or Software", type: 'word_doc' } ] },
    { name: 'Cost Volume', notes: 'Volume 3 — DSIP cost form. Base and Option costed separately.', items: [
      { name: 'Phase I Base Cost Proposal', type: 'spreadsheet', notes: 'Base period of performance.' },
      { name: 'Phase I Option Cost Proposal', type: 'spreadsheet', notes: 'Option period, costed separately from base.' } ] },
    { name: 'Company Commercialization Report', notes: 'Volume 4 — CCR from SBIR.gov Firm Forms.', items: [
      { name: 'Company Commercialization Report (CCR)', type: 'form_other' } ] },
    { name: 'Supporting Documents', notes: 'Volume 5 — supports Volumes 1/2/3.', items: [
      { name: 'Foreign Nationals Disclosure (ITAR/EAR)', type: 'pdf' },
      { name: 'Letters of Support', type: 'pdf' },
      { name: 'DD Form 2345 — Militarily Critical Technical Data Agreement', type: 'pdf' },
      { name: 'Technical Data Rights Assertions', type: 'pdf' },
      { name: 'Reps & Certifications', type: 'pdf' } ] },
    { name: 'Fraud, Waste, and Abuse Training', notes: 'Volume 6 — required FWA training certification (3-page PDF).', items: [
      { name: 'Fraud, Waste, and Abuse Training Certification', type: 'form_other' } ] },
  ],
};
