/**
 * TS half of the scorer parity check. Reads scripts/fixtures/scorer-parity.json, runs the SHIPPING
 * `scoreCard` over every case, and writes the results to stdout as JSON.
 *
 * Deliberately dumb: it imports the real function and prints. Any cleverness here would be a second
 * implementation, and a parity check between two things this file wrote proves nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The LEAF, deliberately — lib/bucket-ranking.ts imports @/lib/db, which throws at module scope
// without a DATABASE_URL, and a pure function should not need a database to be tested.
import { scoreCard, buildAffinityProfile, type BucketCriteria, type CardFields, type ScoreInputs } from '../lib/bucket-scoring.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'scorer-parity.json'), 'utf8')) as {
  nowMs: number;
  cases: Array<{
    name: string; card: CardFields; criteria: BucketCriteria;
    /** Judged cards the affinity profile is folded from — built HERE by the shipping builder, so a
     *  fixture cannot smuggle in a hand-made profile the product would never produce. */
    voted?: Array<{ card: CardFields; verdict: string }>;
  }>;
};

const out = fx.cases.map((c) => {
  const inputs: ScoreInputs = c.voted ? { affinity: buildAffinityProfile(c.voted) } : {};
  const r = scoreCard(c.card, c.criteria, fx.nowMs, inputs);
  return { name: c.name, score: r.score, factors: r.factors };
});

process.stdout.write(JSON.stringify(out, null, 0));
