/** Proves the local storage driver round-trips through the SAME s3-client calls prod uses.
 *  STORAGE_DRIVER=local LOCAL_STORAGE_DIR=… AWS_S3_BUCKET_NAME=rfp-pipeline-local \
 *    node --import tsx scripts/verify-local-storage.mts */
import { putObject, getObjectBuffer, objectExists, getSignedGetUrl, copyObject, deleteObject, LOCAL, BUCKET } from '@/lib/storage/s3-client';

let ok = true;
const assert = (label: string, cond: boolean) => { console.log(`${cond ? '✓' : '✗'} ${label}`); ok = ok && cond; };

const key = 'customers/foundation/images/_verify-local.txt';
assert('driver = local', LOCAL === true);
console.log(`  bucket=${BUCKET}`);

await putObject({ key, body: Buffer.from('hello-local-storage'), contentType: 'text/plain' });
assert('objectExists after put', await objectExists(key));
const buf = await getObjectBuffer(key);
assert('getObjectBuffer round-trips bytes', buf?.toString() === 'hello-local-storage');
const url = await getSignedGetUrl(key);
assert('signed URL points at the local route', url === `/api/storage/local/${key.split('/').map(encodeURIComponent).join('/')}`);
console.log(`  url=${url}`);

await copyObject({ sourceKey: key, destKey: `${key}.copy` });
assert('copyObject copies bytes', (await getObjectBuffer(`${key}.copy`))?.toString() === 'hello-local-storage');

await deleteObject(key); await deleteObject(`${key}.copy`);
assert('deleteObject removes it', !(await objectExists(key)));

console.log(ok ? '\nPASS — local storage emulates R2 through the real call path' : '\nFAIL');
process.exit(ok ? 0 : 1);
