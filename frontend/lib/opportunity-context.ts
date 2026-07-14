/**
 * Opportunity context slugs — normalize an opportunity's human-readable
 * agency / program strings into the unified-taxonomy context values (mig 101)
 * that the atom selector ranks against (atom_tags dimension in
 * agency/program/phase/tech/dept). The selector boosts atoms whose tags
 * overlap these slugs, so a Navy-SBIR bio outranks an Army-OTA one for a
 * Navy SBIR section.
 *
 * Deliberately conservative substring matching: an input that doesn't clearly
 * name a known agency/program contributes nothing rather than a wrong slug
 * (a false context match would mis-rank the library).
 */

// Each entry: [matcher, taxonomy slug]. Order-independent — all matches count.
const AGENCY_SLUGS: Array<[RegExp, string]> = [
  [/air\s*force|\busaf\b/i, 'air_force'],
  [/space\s*force|\bussf\b/i, 'space_force'],
  [/\barmy\b/i, 'army'],
  [/\bnavy\b|\bonr\b|naval\b/i, 'navy'],
  [/marine/i, 'marines'],
  [/\bsocom\b|special operations/i, 'socom'],
  [/\bdarpa\b/i, 'darpa'],
  [/\bmda\b|missile defense/i, 'mda'],
  [/\bdiu\b|defense innovation unit/i, 'diu'],
  [/\bdla\b|logistics agency/i, 'dla'],
  [/\bdha\b|defense health/i, 'dha'],
  [/\bcdmrp\b/i, 'cdmrp'],
  [/arpa-?e\b/i, 'arpa_e'],
  [/arpa-?h\b/i, 'arpa_h'],
  [/\bnih\b|national institutes of health/i, 'nih'],
  [/\bnsf\b|national science foundation/i, 'nsf'],
  [/\bosd\b|secretary of defense/i, 'osd'],
];

const PROGRAM_SLUGS: Array<[RegExp, string]> = [
  [/\bsttr\b/i, 'sttr'],
  [/\bsbir\b/i, 'sbir'],
  [/\bota\b|other transaction/i, 'ota'],
  [/\bcso\b|commercial solutions/i, 'cso'],
  [/\bbaa\b|broad agency/i, 'baa'],
  [/\brif\b|rapid innovation/i, 'rif'],
];

export function opportunityContextSlugs(input: { agency?: string | null; program?: string | null }): string[] {
  const out = new Set<string>();
  const agency = input.agency ?? '';
  for (const [re, slug] of AGENCY_SLUGS) if (re.test(agency)) out.add(slug);
  const program = input.program ?? '';
  for (const [re, slug] of PROGRAM_SLUGS) if (re.test(program)) out.add(slug);
  return [...out];
}
