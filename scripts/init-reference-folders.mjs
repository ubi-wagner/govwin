/**
 * Initialize the reference library folder structure in S3.
 * Run once: node scripts/init-reference-folders.mjs
 *
 * Creates empty folder markers for the reference library tree.
 * Safe to re-run (putObject on existing keys is idempotent).
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const BUCKET = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || process.env.RAILWAY_S3_BUCKET;
if (!BUCKET) {
  console.error('No bucket configured. Set AWS_S3_BUCKET_NAME, AWS_S3_BUCKET, or RAILWAY_S3_BUCKET.');
  process.exit(1);
}

const s3 = new S3Client({
  forcePathStyle: true,
  region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'auto',
});

const folders = [
  'reference/',
  'reference/solicitations/',
  'reference/solicitations/sbir/',
  'reference/solicitations/sbir/dod/',
  'reference/solicitations/sbir/nsf/',
  'reference/solicitations/sbir/doe/',
  'reference/solicitations/sbir/darpa/',
  'reference/solicitations/sttr/',
  'reference/solicitations/sttr/dod/',
  'reference/solicitations/baa/',
  'reference/solicitations/baa/darpa/',
  'reference/solicitations/baa/dod/',
  'reference/solicitations/ota/',
  'reference/proposals/',
  'reference/proposals/sbir-phase1/',
  'reference/proposals/sbir-phase1/dod/',
  'reference/proposals/sbir-phase1/nsf/',
  'reference/proposals/sbir-phase1/doe/',
  'reference/proposals/sbir-phase2/',
  'reference/proposals/sbir-phase2/dod/',
  'reference/proposals/baa/',
  'reference/proposals/ota/',
  'reference/templates/',
  'reference/templates/sbir-phase1-dod/',
  'reference/templates/sbir-phase1-nsf/',
  'reference/templates/sbir-phase2-dod/',
  'reference/templates/baa-darpa/',
  'reference/training/',
  'reference/training/sections/',
  'reference/training/formats/',
  'reference/training/compliance/',
];

async function init() {
  console.log(`Initializing ${folders.length} folders in bucket ${BUCKET}...`);
  for (const folder of folders) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: folder,
      Body: '',
      ContentType: 'application/x-directory',
    }));
    console.log(`  done: ${folder}`);
  }
  console.log('Done.');
}

init().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
