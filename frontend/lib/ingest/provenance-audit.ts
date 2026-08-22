/**
 * Ingest QA — the PROVENANCE AUDIT (pure, DB-free).
 *
 * Answers the question a curator actually has in front of a compliance matrix:
 * **which of these numbers did we read out of the solicitation, and which are we guessing?**
 * — and, for the ones we did not read, whether the answer is reachable.
 *
 * This is the cross-document reconciliation step. A federal solicitation is rarely one file:
 * the DoW SBIR BAA states the format rules but explicitly DEFERS the technical-volume page
 * limit to the Component-specific instructions, which arrive as a separate PDF. So a matrix can
 * be "complete" (every column filled) and still be wrong, and it can be "incomplete" (a NULL
 * page limit) and be exactly right. Counting filled cells cannot tell those apart. Reading
 * `field_provenance` can:
 *
 *   • a field read from the text        → trustworthy, and it carries its citation
 *   • a field sitting on a DEFAULT      → a fallback wearing the costume of a rule
 *   • a field the document DEFERS       → correctly empty *if* the document it points at is
 *                                         attached and was read; otherwise the real rule is
 *                                         still missing and nobody can see that it is
 *
 * That last line is the finding this module exists to produce: an unresolved deferral is a
 * RELEASE BLOCKER, and it is invisible in every other view of the matrix.
 *
 * Consumed by `tool.ingest.assess` — the deterministic half the admin sees immediately, and the
 * evidence the platform-scope `rfp_ingest_manager` reasons over when it plans which specialist
 * agents to run next (docs/ADMIN_AGENT_DESIGN.md, docs/INGEST_PROVENANCE.md). Advisory only:
 * it reports, it never writes a business table.
 */

/** Compliance columns that are real submission constraints — a wrong value here sinks a bid. */
const CONSTRAINT_FIELDS: Array<[string, string]> = [
  ['page_limit_technical', 'Page limit (Technical Volume)'],
  ['min_font_size', 'Minimum font size'],
  ['font_family', 'Typeface'],
  ['font_size', 'Font size'],
  ['margins', 'Margins'],
  ['submission_format', 'Submission format'],
  ['required_sections', 'Required sections'],
  ['required_documents', 'Required documents'],
];

/** Sources that mean "this came off THIS solicitation" (see migration 188 for the full order). */
const READ_SOURCES = new Set(['hitl', 'verified', 'override', 'pattern_match', 'ai']);

/** Document types that can carry rules the umbrella solicitation defers elsewhere. */
const RULE_BEARING_TYPES = new Set(['instructions', 'topic', 'amendment', 'attachment', 'supporting']);

export interface ProvenanceFinding {
  severity: 'blocker' | 'warning' | 'info';
  /** Compliance column, or null for a whole-matrix finding. */
  field: string | null;
  issue: string;
  fix: string;
}

export interface ProvenanceFieldState {
  field: string;
  label: string;
  source: string | null;
  hasValue: boolean;
  deferred: boolean;
  /** Where the rule lives, in the document's words (deferrals only). */
  reason: string | null;
  page: number | null;
  excerpt: string | null;
  /** Which document of a multi-document ingest the citation points into. */
  docSegment: number | null;
}

export interface ProvenanceAudit {
  fieldsTotal: number;
  read: number;
  defaulted: number;
  deferred: number;
  /** Fields with no provenance entry at all — pre-migration-187 rows. Treated as unverified. */
  unknown: number;
  /** read / fieldsTotal, 0..1. */
  coverage: number;
  byField: ProvenanceFieldState[];
  /** Deferrals whose target document is missing or was not read — the release blockers. */
  unresolvedDeferrals: ProvenanceFieldState[];
  /** Constraint fields presented from a system default. */
  unverified: ProvenanceFieldState[];
  findings: ProvenanceFinding[];
  /** True when nothing at all was read from the document — the "empty parse" signature. */
  nothingRead: boolean;
}

interface ProvenanceEntry {
  source?: string;
  deferred?: boolean;
  reason?: string;
  page?: number | null;
  excerpt?: string;
  docSegment?: number | null;
}

export interface ProvenanceAuditInput {
  /** `solicitation_compliance.field_provenance`, keyed by column. */
  fieldProvenance: Record<string, unknown> | null | undefined;
  /** The compliance row itself (camelCase, as postgres.js returns it) — to see which are set. */
  values: Record<string, unknown> | null | undefined;
  /**
   * Attached documents, so a deferral can be checked against what is actually on file — and so a
   * document we did not finish reading can say so. `extraction` is the stamp written at upload
   * (`lib/ingest/source-text-cap.ts`); absent on rows ingested before it existed, which reads as
   * "unknown", not as "complete".
   */
  documents: Array<{
    documentType?: string | null;
    fileName?: string | null;
    extraction?: { chars: number; originalChars: number; truncated: boolean } | null;
  }>;
}

const camel = (col: string) => col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const isSet = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/**
 * Audit one solicitation's compliance provenance. Pure: same inputs, same findings, no DB, no
 * model — so it can run in the route, in a worker, or as the evidence an agent reasons over.
 */
export function auditProvenance(input: ProvenanceAuditInput): ProvenanceAudit {
  const prov = (input.fieldProvenance ?? {}) as Record<string, ProvenanceEntry>;
  const values = input.values ?? {};
  const docs = input.documents ?? [];

  const byField: ProvenanceFieldState[] = CONSTRAINT_FIELDS.map(([field, label]) => {
    const e = (prov[field] ?? {}) as ProvenanceEntry;
    return {
      field, label,
      source: typeof e.source === 'string' ? e.source : null,
      hasValue: isSet(values[camel(field)]),
      deferred: e.deferred === true,
      reason: typeof e.reason === 'string' ? e.reason : null,
      page: typeof e.page === 'number' ? e.page : null,
      excerpt: typeof e.excerpt === 'string' ? e.excerpt : null,
      docSegment: typeof e.docSegment === 'number' ? e.docSegment : null,
    };
  });

  let read = 0, defaulted = 0, deferred = 0, unknown = 0;
  for (const f of byField) {
    if (f.deferred) deferred++;
    else if (f.source && READ_SOURCES.has(f.source)) read++;
    else if (f.source === 'default') defaulted++;
    else unknown++;
  }

  // A deferral is RESOLVED only if some document that could carry the rule is attached. We
  // cannot prove the extractor read the right file, but we can prove whether the file is even
  // here — and "the rule is elsewhere and elsewhere is nowhere" is the blocker worth shouting.
  const ruleBearing = docs.filter((d) => RULE_BEARING_TYPES.has((d.documentType ?? '').toLowerCase()));
  const unresolvedDeferrals = byField.filter((f) => f.deferred && !f.hasValue);
  const unverified = byField.filter((f) => f.source === 'default' || (!f.source && f.hasValue));

  const findings: ProvenanceFinding[] = [];

  for (const f of unresolvedDeferrals) {
    if (ruleBearing.length === 0) {
      findings.push({
        severity: 'blocker',
        field: f.field,
        issue: `${f.label} is not set by this solicitation — it defers the rule elsewhere${f.page ? ` (p.${f.page})` : ''}: "${f.reason ?? 'stated elsewhere'}" — and no instructions/topic document is attached, so the real value is nowhere on file.`,
        fix: 'Upload the Component-specific instructions (document type "instructions") and re-run Ingest Assist. Until then this constraint is unknown and the master must not be released.',
      });
    } else {
      findings.push({
        severity: 'warning',
        field: f.field,
        issue: `${f.label} is deferred by the umbrella solicitation and ${ruleBearing.length} rule-bearing document(s) are attached (${ruleBearing.map((d) => d.fileName ?? d.documentType).join(', ')}), but no value was read from them.`,
        fix: 'Open the source viewer, find the rule in the attached instructions, and tag it as a compliance variable — that records it as "Highlighted" with a page anchor.',
      });
    }
  }

  for (const f of unverified) {
    findings.push({
      severity: f.field === 'page_limit_technical' || f.field === 'min_font_size' ? 'warning' : 'info',
      field: f.field,
      issue: `${f.label} shows a value that was NOT read from this solicitation — it is a system default.`,
      fix: 'Verify it against the source document and correct or confirm it, so it stops being presented as a rule.',
    });
  }

  // A DOCUMENT WE STOPPED READING CANNOT SUPPORT "not stated in the source" (bug log B40).
  // Extraction caps source text, and two of five real BAAs landed on the cap to the character —
  // the last 50.7% of the DoW 2026 SBIR BAA and 62.7% of the DoD 25.1 BAA were never examined.
  // Every `default` above is reported as "the solicitation does not state this", and past the cut
  // that claim is unfounded: the rule may be stated on a page nobody read. The truncation was
  // being recorded on the document and read by nothing, which made it a fact filed where no one
  // looks — so it is surfaced HERE, at the audit a curator actually reads before landing a matrix.
  //
  // Warning, not blocker, and deliberately so: the values that WERE read still stand, and the
  // existing model already lands defaults wearing a red "unverified" badge. What was missing is
  // the reason they are more than usually suspect. The blocker case is already covered — if
  // nothing at all was read, `nothingRead` fires below regardless of why.
  const truncatedDocs = docs.filter((d) => d.extraction?.truncated === true);
  if (truncatedDocs.length > 0) {
    const worst = truncatedDocs.reduce((a, b) => {
      const lost = (x: typeof a) => (x.extraction!.originalChars - x.extraction!.chars);
      return lost(b) > lost(a) ? b : a;
    });
    const e = worst.extraction!;
    const pct = e.originalChars > 0 ? Math.round(((e.originalChars - e.chars) / e.originalChars) * 100) : 0;
    findings.push({
      severity: 'warning',
      field: null,
      issue: `${truncatedDocs.length} source document(s) were only partly read — worst: `
        + `${worst.fileName ?? worst.documentType ?? 'document'} at ${e.chars.toLocaleString()} of `
        + `${e.originalChars.toLocaleString()} characters (${pct}% not examined). Any field showing a `
        + `system default may be stated on a page that was never read, so "not stated in this `
        + `solicitation" is unverified for this matrix.`,
      fix: 'Check the constraints against the tail of the source document before releasing this master. '
        + 'If the document is routinely this long, raise the extraction cap rather than curating around it.',
    });
  }

  const nothingRead = read === 0;
  if (nothingRead) {
    findings.push({
      severity: 'blocker',
      field: null,
      issue: 'No compliance field was read from this solicitation — the entire matrix is system defaults.',
      fix: 'Confirm the shred produced text (the readiness check on Ingest Assist), then re-run Ingest Assist. If the document is a scan, it needs OCR before anything can be read from it.',
    });
  }

  return {
    fieldsTotal: byField.length,
    read, defaulted, deferred, unknown,
    coverage: byField.length ? read / byField.length : 0,
    byField,
    unresolvedDeferrals,
    unverified,
    findings,
    nothingRead,
  };
}

/** One-line rollup for a log, an event payload, or an agent's prompt. */
export function summarizeAudit(a: ProvenanceAudit): string {
  return `${a.read}/${a.fieldsTotal} compliance fields read from the document · ${a.defaulted} default · `
    + `${a.deferred} deferred (${a.unresolvedDeferrals.length} unresolved) · `
    + `${a.findings.filter((f) => f.severity === 'blocker').length} blocker(s)`;
}
