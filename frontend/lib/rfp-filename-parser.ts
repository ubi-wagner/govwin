/**
 * Best-effort parser for solicitation filename / first-line text.
 *
 * Recognizes common DoD / DoW / SBIR / STTR / CSO / BAA / Grants naming
 * patterns and returns any fields it can confidently extract. All fields
 * are optional — the admin still reviews + edits before submitting.
 *
 * Examples handled:
 *   "DoD 25.1 SBIR BAA FULL_02032025.pdf"
 *   "DoD 25.A STTR BAA FULL_12202024.pdf"
 *   "AFX25.5 Release 8 Amendment 1_05222025.pdf"
 *   "AF_X24.5_CSO.pdf"
 *   "Air Force_X25.6_v3.pdf"
 *   "DoW 2026 SBIR BAA FULL_R1_04132026.pdf"
 */

export interface ParsedMeta {
  title?: string;
  agency?: string;
  programType?: string;
  solicitationNumber?: string;
  cycle?: string;
}

const AGENCY_PATTERNS: Array<[RegExp, string]> = [
  [/\bdo[dw]\b/i, 'Department of Defense'],
  [/\b(af|air\s*force)\b/i, 'Department of the Air Force'],
  [/\b(army|devcom)\b/i, 'Department of the Army'],
  [/\b(navy|onr)\b/i, 'Department of the Navy'],
  [/\bdarpa\b/i, 'Defense Advanced Research Projects Agency'],
  [/\bsocom\b/i, 'United States Special Operations Command'],
  [/\bnsf\b/i, 'National Science Foundation'],
  [/\bnih\b/i, 'National Institutes of Health'],
  [/\bdoe\b/i, 'Department of Energy'],
  [/\bnasa\b/i, 'National Aeronautics and Space Administration'],
  [/\busda\b/i, 'United States Department of Agriculture'],
];

const PROGRAM_PATTERNS: Array<[RegExp, string]> = [
  // STTR checked before SBIR because "STTR" contains "TR" not "BIR"
  [/\bsttr[\s_-]*phase[\s_-]*ii\b/i, 'sttr_phase_2'],
  [/\bsttr[\s_-]*phase[\s_-]*i\b/i, 'sttr_phase_1'],
  [/\bsttr\b/i, 'sttr_phase_1'],
  [/\bsbir[\s_-]*phase[\s_-]*ii\b/i, 'sbir_phase_2'],
  [/\bsbir[\s_-]*phase[\s_-]*i\b/i, 'sbir_phase_1'],
  [/\bsbir\b/i, 'sbir_phase_1'],
  [/\bcso\b/i, 'cso'],
  [/\bbaa\b/i, 'baa'],
  [/\bota\b/i, 'ota'],
  [/\brif\b/i, 'rif'],
  [/\bnofo\b/i, 'nofo'],
];

/**
 * Pull a cycle identifier like "25.1", "25.A", "X24.5", "2026" from the
 * filename. Used for both the solicitation_number fallback and the
 * title composition.
 */
function extractCycle(name: string): string | undefined {
  // Match patterns: X25.5, 25.1, 25.A, 2026, 26.1
  const patterns = [
    /\b(x\d{2}\.\w+)\b/i,
    /\b(\d{2}\.\w+)\b/,
    /\b(20\d{2})\b/,
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m) return m[1].toUpperCase();
  }
  return undefined;
}

export function parseFilenameMetadata(filename: string): ParsedMeta {
  // Strip extension for parsing
  const base = filename.replace(/\.[^.]+$/, '');
  const clean = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  const result: ParsedMeta = {};

  // Agency
  for (const [re, value] of AGENCY_PATTERNS) {
    if (re.test(clean)) {
      result.agency = value;
      break;
    }
  }
  // Special case: "DoW" → Department of War (explicit)
  if (/\bdow\b/i.test(clean)) {
    result.agency = 'Department of War';
  }

  // Program type
  for (const [re, value] of PROGRAM_PATTERNS) {
    if (re.test(clean)) {
      result.programType = value;
      break;
    }
  }

  // Cycle (e.g. "25.1", "X24.5")
  result.cycle = extractCycle(clean);

  // Solicitation number — compose from agency abbrev + cycle
  if (result.cycle) {
    const agencyAbbr = /\bdod\b/i.test(clean) ? 'DoD'
                     : /\bdow\b/i.test(clean) ? 'DoW'
                     : /\baf\b/i.test(clean) || /air\s*force/i.test(clean) ? 'AF'
                     : null;
    if (agencyAbbr) {
      const programAbbr = result.programType?.includes('sbir') ? 'SBIR'
                        : result.programType?.includes('sttr') ? 'STTR'
                        : result.programType?.includes('cso') ? 'CSO'
                        : result.programType?.includes('baa') ? 'BAA'
                        : '';
      result.solicitationNumber = [agencyAbbr, result.cycle, programAbbr]
        .filter(Boolean)
        .join(' ')
        .trim();
    }
  }

  // Title — compose from what we found
  const titleParts: string[] = [];
  if (/\bdo[dw]\b/i.test(clean)) titleParts.push(/dow/i.test(clean) ? 'DoW' : 'DoD');
  else if (/\baf\b/i.test(clean) || /air\s*force/i.test(clean)) titleParts.push('Air Force');
  if (result.cycle) titleParts.push(result.cycle);
  if (result.programType?.includes('sbir')) titleParts.push('SBIR');
  else if (result.programType?.includes('sttr')) titleParts.push('STTR');
  if (/\bbaa\b/i.test(clean)) titleParts.push('BAA');
  else if (/\bcso\b/i.test(clean)) titleParts.push('CSO');
  if (titleParts.length >= 2) {
    result.title = titleParts.join(' ');
  }

  return result;
}
