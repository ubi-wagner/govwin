/** One-off harness: prove the DSIP plan detects the fixture's five volumes (pre-drive). */
import { readFileSync } from 'fs';
import { planDocumentAtomization } from '../lib/atomize-package';
const buf = readFileSync('e2e/fixtures/dsip-sample.pdf');
const plan = await planDocumentAtomization({ buffer: buf, filename: 'dsip-sample.pdf', ctxTags: [], docType: 'past_proposal' });
console.log('format:', plan.format, 'blocks:', plan.parsedCount, 'planned:', plan.planned.length);
console.log('dsip:', plan.dsip ? plan.dsip.volumes.map((v) => `${v.volumeNumber} ${v.volumeName} [${v.wordCount}w b${v.blockCount}] marker="${v.markerExcerpt}"`).join(' | ') : 'NOT DETECTED');
console.log('per-block vol:', plan.planned.map((p) => `${p.volumeNumber ?? 0}:${p.title.slice(0, 30)}`).join(' · '));
process.exit(0);
