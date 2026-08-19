/** One-off harness: prove the DSIP plan detects the fixture's five volumes (pre-drive). */
import { readFileSync } from 'fs';
import { planDocumentAtomization } from '../lib/atomize-package';
const file = process.argv[2] ?? 'e2e/fixtures/dsip-sample.pdf';
const buf = readFileSync(file);
const plan = await planDocumentAtomization({ buffer: buf, filename: file.split('/').pop()!, ctxTags: [], docType: 'past_proposal' });
console.log('format:', plan.format, 'blocks:', plan.parsedCount, 'planned:', plan.planned.length);
console.log('dsip:', plan.dsip ? plan.dsip.volumes.map((v) => `${v.volumeNumber} ${v.volumeName} [${v.wordCount}w b${v.blockCount}] marker="${v.markerExcerpt}"`).join(' | ') : 'NOT DETECTED');
console.log('per-block vol:', plan.planned.map((p) => `${p.volumeNumber ?? 0}:${p.title.slice(0, 30)}`).join(' · '));
console.log('--- page heads ---');
const parts = plan.fullText.split(/--\s*(\d+)\s*of\s*(\d+)\s*--/);
for (let i = 1; i + 2 < parts.length + 1; i += 3) {
  const page = parts[i];
  const body = (parts[i + 2] ?? '').trim().replace(/\s+/g, ' ');
  console.log(`p${page}: ${body.slice(0, 110)}`);
}
console.log('--- lines containing volume-ish words ---');
for (const line of plan.fullText.split('\n')) {
  if (/volume|cover sheet|commercialization|supporting doc|fraud/i.test(line)) console.log(JSON.stringify(line.slice(0, 140)));
}
process.exit(0);
