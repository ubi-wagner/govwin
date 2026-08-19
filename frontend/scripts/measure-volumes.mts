/**
 * Measure every volume of a proposal against the quality bar.
 *
 * Compliance answers "is this ALLOWED"; this answers "is it FINISHED". Both matter and only the
 * first one was checked anywhere. Run it against a real proposal to see, per volume: how much of
 * the page/character envelope is used, which canvas node types appear at all, and how much
 * document apparatus (figures, captions, tables, emphasis, page furniture) is present.
 *
 *   cd frontend && node --import tsx scripts/measure-volumes.mts <proposalId>
 *
 * Read-only. It assembles each volume exactly the way the export gate does
 * (`assembleArtifactCanvas`) and measures it with the same rulers the editor gauge uses, so the
 * numbers here are the numbers the product would report — not a second opinion.
 */
import { sqlBypass as sql } from '@/lib/db';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { measureDocument } from '@/lib/proposal/document-furniture';

const proposalId = process.argv[2];
if (!proposalId) {
  console.error('usage: measure-volumes.mts <proposalId>');
  process.exit(2);
}

type Row = {
  id: string;
  title: string | null;
  content: unknown;
  sortIndex: number | null;
  artifactId: string | null;
  volumeName: string | null;
  artifactType: string | null;
};

// NOTE the camelCase field names: lib/db.ts applies postgres.toCamel to BOTH clients, so a
// snake_case declaration here would compile and then read `undefined` at runtime (the bug class
// CLAUDE.md records as having shipped twice).
const rows = await sql<Row[]>`
  SELECT s.id, s.title, s.content, s.sort_index, s.artifact_id,
         a.volume_name, a.artifact_type
  FROM proposal_sections s
  LEFT JOIN proposal_artifacts a ON a.id = s.artifact_id
  WHERE s.proposal_id = ${proposalId}::uuid
  ORDER BY s.sort_index NULLS LAST, s.created_at
`;

if (rows.length === 0) {
  console.error(`no sections for proposal ${proposalId}`);
  await sql.end();
  process.exit(1);
}

const byArtifact = new Map<string, Row[]>();
for (const r of rows) {
  const key = r.artifactId ?? 'unassigned';
  if (!byArtifact.has(key)) byArtifact.set(key, []);
  byArtifact.get(key)!.push(r);
}

console.log(`\nProposal ${proposalId} — ${rows.length} sections across ${byArtifact.size} volume(s)\n`);

let totalWarnings = 0;
for (const [artifactId, secs] of byArtifact) {
  const name = secs[0]?.volumeName ?? 'Unassigned';
  const type = secs[0]?.artifactType ?? 'narrative';
  let m;
  try {
    m = measureDocument(assembleArtifactCanvas(secs as never, type, name), 0.85, type);
  } catch (e) {
    console.log(`── ${name} [${artifactId}] — could not assemble: ${(e as Error).message}\n`);
    continue;
  }

  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  console.log(`── ${name}  (${type}, ${secs.length} sections)`);
  console.log(`   pages       ${m.pages}${m.maxPages ? ` / ${m.maxPages}` : ''}   fill ${pct(m.pageFill)}`);
  console.log(`   characters  ${m.characters.toLocaleString()}${m.maxCharacters ? ` / ${m.maxCharacters.toLocaleString()}` : ''}   fill ${pct(m.characterFill)}`);
  console.log(`   figures ${m.figures} · captions ${m.captions} · tables ${m.tables} · charts ${m.charts} · emphasised blocks ${m.emphasisedBlocks}`);
  console.log(`   header ${m.hasHeader ? 'yes' : 'NO'} · footer ${m.hasFooter ? 'yes' : 'NO'}`);
  console.log(`   node types (${m.distinctNodeTypes}): ${Object.entries(m.nodeTypes).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  for (const w of m.warnings) console.log(`   ⚠ ${w}`);
  totalWarnings += m.warnings.length;
  console.log('');
}

console.log(`${totalWarnings} quality warning(s) across all volumes.`);
await sql.end();
