/** Re-extract solicitation documents that the old 500,000-char cap cut short.
 *
 * The cap is raised and now reports itself, but the documents already in the database are still
 * half-read — and every "not stated in the source" conclusion drawn from them is unverified. This
 * re-extracts from the original PDF and stamps the coverage record the new path writes.
 *
 * Idempotent: a document already at full length is skipped. Sources are matched by
 * original_filename against docs/, so a document whose PDF is not on disk is REPORTED, not guessed.
 *
 *   cd frontend && . ../scripts/sandbox-env.sh && npx tsx scripts/repair-truncated-source-text.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { sqlBypass } from '../lib/db';
import { loadPdfParse } from '../lib/pdf-parse-quiet';
import { capSourceText, truncationNotice } from '../lib/ingest/source-text-cap';

const DOCS = '/home/user/govwin/docs';
const OLD_CAP = 500_000;

const suspects = await sqlBypass<Array<{ id: string; originalFilename: string | null; chars: number }>>`
  SELECT id, original_filename AS "originalFilename", length(extracted_text) AS chars
  FROM solicitation_documents
  WHERE extracted_text IS NOT NULL AND length(extracted_text) >= ${OLD_CAP}
  ORDER BY 3 DESC`;

console.log(`\n${suspects.length} document(s) sitting at or above the old ${OLD_CAP.toLocaleString()} cap\n`);
const { PDFParse } = await loadPdfParse();
let repaired = 0;
let unreachable = 0;

for (const d of suspects) {
  const path = d.originalFilename ? `${DOCS}/${d.originalFilename}` : null;
  if (!path || !existsSync(path)) {
    unreachable++;
    console.log(`  ? ${d.originalFilename ?? '(no filename)'} — source PDF not on disk; left as-is and still truncated`);
    continue;
  }
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
  const t = await parser.getText();
  await parser.destroy().catch(() => {});
  const capped = capSourceText(t.text);

  if (capped.chars <= d.chars) {
    console.log(`  = ${d.originalFilename} — already complete at ${d.chars.toLocaleString()}`);
    continue;
  }
  await sqlBypass`
    UPDATE solicitation_documents
    SET extracted_text = ${capped.text}, extracted_at = now(), updated_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${sqlBypass.json({
          extraction: {
            chars: capped.chars, truncated: capped.truncated,
            originalChars: capped.originalChars, capChars: capped.capChars,
          },
          repairedFrom: { chars: d.chars, cap: OLD_CAP, at: new Date().toISOString() },
        })}
    WHERE id = ${d.id}::uuid`;
  repaired++;
  const gained = capped.chars - d.chars;
  console.log(`  ✓ ${d.originalFilename}`);
  console.log(`      ${d.chars.toLocaleString()} → ${capped.chars.toLocaleString()} chars  (+${gained.toLocaleString()}, `
    + `${Math.round((gained / capped.originalChars) * 100)}% of the document had been discarded)`);
  const notice = truncationNotice(capped);
  if (notice) console.log(`      still truncated: ${notice}`);
}

console.log(`\nrepaired ${repaired} · unreachable ${unreachable} · checked ${suspects.length}`);
if (repaired > 0) {
  console.log('\nNOTE: any compliance field on these solicitations that reads "not stated in the source"');
  console.log('was decided against half a document. Re-run Ingest Assist to re-derive them.');
}
process.exit(0);
