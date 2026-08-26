/**
 * A requirement the product ASSUMED must not block submission the way one it READ does.
 *
 * "A value the product did not read from the solicitation must never look like one it did"
 * (docs/INGEST_PROVENANCE.md). A hard submission blocker is the strongest way of looking like one.
 *
 * The case that forced this: the SBIR/CSO program skeleton's default required-documents list
 * carries "CMMC Reps & Certs". The T3CP BAA does not require that as an attachment — CMMC is a
 * representation made inside DSIP, so there is no file to upload. Provisioned as a hard blocker, it
 * made a finished, fully drafted build unsubmittable for a document that does not exist, and the
 * only way past it was an admin waiving a requirement nobody could verify.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(process.cwd(), 'lib/proposal/submission-readiness.ts'), 'utf8');
const PROVISION = readFileSync(join(process.cwd(), 'lib/provision-proposal.ts'), 'utf8');

describe('provenance reaches the supporting-doc row', () => {
  it('provisioning reads field_provenance alongside required_documents', () => {
    expect(PROVISION).toContain('field_provenance AS "fieldProvenance"');
    expect(PROVISION).toContain('prov?.required_documents?.source');
  });

  it('stamps the list provenance onto requirement_source when the item has no citation of its own', () => {
    // The item's OWN citation wins — a document the ingest actually read, with a page reference,
    // is better evidence than how the list was obtained.
    expect(PROVISION).toContain('const source = perDoc ?? (listProvenance ? `provenance:${listProvenance}` : null)');
  });
});

describe('readiness splits blocker from warning on provenance', () => {
  it('selects requirement_source so the split is possible at all', () => {
    expect(SRC).toContain('requirement_source AS "requirementSource"');
  });

  it('a defaulted requirement is a warning, a read one is a blocker', () => {
    expect(SRC).toContain("const defaulted = d.requirementSource === 'provenance:default'");
    expect(SRC).toContain("severity: defaulted ? 'warning' : 'blocker'");
  });

  it('the defaulted message says where the requirement came from', () => {
    // A warning the reader cannot act on is noise; it has to name the reason.
    expect(SRC).toContain('came from the program default list, not from this solicitation');
  });

  it('both cases still appear on the checklist', () => {
    // The severity changes; the entry does not disappear. A requirement the product assumed is
    // still worth showing — it just must not stake a hard refusal on the assumption.
    //
    // The window is the requiredDocs LOOP, not everything up to `blockers.sort`. The wider window
    // was a proxy that happened to work while nothing else sat between them; the open-findings
    // roll-up (Phase E) then landed there and failed this guard for a reason it does not care
    // about. Measuring the loop measures the claim.
    const from = SRC.indexOf('for (const d of requiredDocs)');
    expect(from).toBeGreaterThan(-1);
    const loop = SRC.slice(from, SRC.indexOf('\n  }', from));
    const pushes = loop.match(/blockers\.push\(/g) ?? [];
    expect(pushes).toHaveLength(1);
  });

  it('only the exact default marker downgrades — a real citation still blocks', () => {
    // `requirement_source` also carries real citations ("BAA §5.2", a page reference). Those must
    // keep blocking, so the comparison is an equality against the one marker, not a substring test.
    expect(SRC).not.toMatch(/requirementSource\??\.\s*includes\(/);
    expect(SRC).not.toMatch(/requirementSource\??\.\s*startsWith\(/);
  });
});
