/**
 * Section-standards taxonomy helpers (Phase 3, C1).
 *
 * `section_standards` (migration 075) is the discrete, hierarchical list of
 * standard section / sub-section headers across common DOD / NSF / SBIR / STTR
 * proposals (RFP-admin editable). New proposal sections are tagged against it
 * (`proposal_sections.section_type`), and library atoms inherit the
 * classification — the foundation for matrix-driven canvas selection (C2) and
 * the spotlight/library shred buckets.
 */

export interface SectionStandard {
  key: string;
  label: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Best-effort map a section title to a `section_standards.key`. Exact label
 * match wins; otherwise the longest containment match; null if nothing fits
 * (the section simply stays untagged — never a hard failure).
 */
export function inferSectionType(title: string, standards: SectionStandard[]): string | null {
  if (!title || standards.length === 0) return null;
  const t = norm(title);
  if (!t) return null;

  for (const s of standards) {
    if (norm(s.label) === t) return s.key;
  }

  let best: { key: string; len: number } | null = null;
  for (const s of standards) {
    const l = norm(s.label);
    if (l.length >= 4 && (t.includes(l) || l.includes(t))) {
      if (!best || l.length > best.len) best = { key: s.key, len: l.length };
    }
  }
  return best?.key ?? null;
}
