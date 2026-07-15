/**
 * Build-time snapshot: serialize the code-owned marketing page seeds
 * (lib/page-content/PAGE_SEEDS) to JSON so the deploy-time seed script
 * (scripts/seed_page_content.mjs, a plain .mjs that can't import TS) can push
 * them into content_pages. Run by `npm run seed:gen` and by `prebuild`, so the
 * JSON is always current in the build image. Also committed for visibility.
 *
 *   npx tsx scripts/gen-page-seeds.ts
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PAGE_SEEDS } from '../lib/page-content';

const here = dirname(fileURLToPath(import.meta.url));
// Emit inside frontend/lib so the Docker builder can COPY it into the runner.
const out = join(here, '..', 'lib', 'page-content', 'page-seeds.generated.json');

const payload = {
  generatedNote: 'AUTO-GENERATED from lib/page-content/PAGE_SEEDS by scripts/gen-page-seeds.ts — do not edit by hand.',
  pages: PAGE_SEEDS,
};
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log(`[gen-page-seeds] wrote ${Object.keys(PAGE_SEEDS).length} page seeds → ${out}`);
