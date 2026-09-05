/**
 * MIGRATIONS RUN INSIDE THE DEPLOYMENT, and these are the properties that make that true.
 *
 * Both services already migrate at boot — the frontend's `entrypoint.sh` before `node server.js`,
 * the CRM's `CMD` before `uvicorn` — and both fail closed. That is the right design and it is easy
 * to break silently, because a broken version still deploys: the container starts, the app answers,
 * and the schema is simply behind.
 *
 * ── THE DEFECT THIS FILE WAS WRITTEN AFTER ───────────────────────────────────────────────────
 * `migrate.mjs` reads `DATABASE_URL`. On the frontend service that is `govtech_app` — the
 * NOBYPASSRLS application role, correct for serving and wrong for migrating. Reproduced against
 * the live sandbox:
 *
 *     psql "$DATABASE_URL" -c "CREATE TABLE probe (id uuid REFERENCES tenants(id))"
 *     ERROR:  permission denied for table tenants
 *
 * Migrations 215, 216 and 217 all carry `REFERENCES tenants(id)`. With `set -e` in the entrypoint,
 * the next deploy would not have come up — and the error names `tenants`, so the hunt would start
 * in the wrong place.
 *
 * The fix is one line (`DATABASE_URL_OWNER` for the migration step only). The reason this file
 * exists is that nothing would have caught it: no test runs the entrypoint, and the failure only
 * appears on a deploy that includes an owner-privileged migration.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(process.cwd(), '..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');

const ENTRYPOINT = read('frontend/entrypoint.sh');
const CMS_DOCKERFILE = read('services/cms/Dockerfile');
const FRONTEND_DOCKERFILE = read('frontend/Dockerfile');

describe('the frontend migrates at boot, as the owner', () => {
  it('runs the migration runner before it starts the server', () => {
    const migrateAt = ENTRYPOINT.indexOf('migrate.mjs');
    const serverAt = ENTRYPOINT.indexOf('exec node server.js');
    expect(migrateAt, 'the entrypoint no longer runs migrations').toBeGreaterThan(-1);
    expect(serverAt).toBeGreaterThan(-1);
    expect(migrateAt, 'migrations must run BEFORE the server, or the app serves a schema it does '
      + 'not match').toBeLessThan(serverAt);
  });

  it('fails the boot when a migration fails', () => {
    // `set -e` is the whole mechanism. A server answering requests against a schema it does not
    // match is worse than a server that will not start.
    expect(ENTRYPOINT.split('\n').slice(0, 3).join('\n')).toMatch(/^\s*set -e\s*$/m);
  });

  it('migrates as DATABASE_URL_OWNER, not as the application role', () => {
    // THE DEFECT. Without this the next deploy carrying an owner-privileged migration crash-loops
    // with "permission denied for table tenants".
    expect(ENTRYPOINT).toMatch(/DATABASE_URL_OWNER/);
    expect(
      ENTRYPOINT,
      'the migration invocation must override DATABASE_URL with the owner connection',
    ).toMatch(/DATABASE_URL="\$MIGRATE_URL"\s+node .*migrate\.mjs/);
  });

  it('says so loudly when the owner connection is missing', () => {
    expect(ENTRYPOINT).toMatch(/DATABASE_URL_OWNER is NOT SET/);
  });

  /**
   * THE CONSEQUENCE NO SINGLE FILE STATES.
   *
   * This used to be a soft failure, and the comment here used to say so: "it still runs — older
   * migrations work fine as the app role". That stopped being true when `migrate.mjs` learned to
   * refuse a role that cannot bypass RLS (migration 245 was applied by such a role, matched zero
   * rows, and was recorded as done forever). Three files now compose into a hard boot prerequisite:
   *
   *   migrate.mjs   exits 1 as any role that is neither rolsuper nor rolbypassrls
   *   entrypoint.sh falls back to DATABASE_URL when DATABASE_URL_OWNER is unset
   *   entrypoint.sh runs `set -e`, so that exit 1 never reaches `exec node server.js`
   *
   * On the frontend service DATABASE_URL *is* the scoped role, so unset ⇒ the container does not
   * start. Each file is individually reasonable and none of them says that. Verified against a live
   * database both ways: as the owner the runner applied 245–253; as `govtech_app` it refused and a
   * faithful copy of this block exited 1 without reaching the server.
   *
   * If the refusal is ever relaxed, this test should fail — the deploy docs describe the strict
   * behaviour and an operator plans around it.
   */
  it('composes into a hard boot prerequisite: no owner connection, no server', () => {
    const migrate = read('db/migrations/migrate.mjs');

    // 1 · the runner refuses a scoped role, and does it on capability rather than on an error code
    expect(migrate, 'the runner must ask whether the role can bypass RLS').toMatch(
      /rolsuper[\s\S]{0,200}rolbypassrls/,
    );
    expect(migrate, 'and refuse rather than warn').toMatch(/REFUSING TO RUN/);

    // 2 · the entrypoint hands it the scoped role when the owner variable is absent
    expect(ENTRYPOINT).toMatch(/MIGRATE_URL="\$\{DATABASE_URL_OWNER:-\$DATABASE_URL\}"/);

    // 3 · and `set -e` turns that refusal into a stopped boot rather than a skipped step
    expect(ENTRYPOINT.split('\n').slice(0, 3).join('\n')).toMatch(/^\s*set -e\s*$/m);

    // 4 · so the ECHOED warning must say the container will not start. An operator who reads
    //     "warning" and deploys anyway gets a crash-loop whose cause scrolled past in the log.
    //
    //     Scoped to the `echo` lines on purpose. Matching the whole file passed against the
    //     UNFIXED entrypoint, because a comment near the top already contained the words "a server
    //     that will not start" — the assertion was green for a sentence no operator ever sees. A
    //     check that cannot fail on the code it was written for is worse than no check.
    const echoed = ENTRYPOINT.split('\n')
      .filter((l) => /^\s*echo /.test(l))
      .join('\n');
    expect(
      echoed,
      'the unset-owner warning must state the boot consequence, not just the risk',
    ).toMatch(/WILL NOT START/i);
  });

  it('the deploy docs mark the owner connection as required, not recommended', () => {
    // The prose deep in RAILWAY_ENV_VARS already called this a hard requirement. The TABLE ROW is
    // what an operator actually scans, and it said "➕ recommended to add" — which is exactly the
    // marking someone defers. The row and the prose must not disagree about whether a deploy boots.
    const env = read('docs/RAILWAY_ENV_VARS.md');
    const row = env.split('\n').find((l) => l.includes('`DATABASE_URL_OWNER`') && l.startsWith('|'));
    expect(row, 'DATABASE_URL_OWNER must have a row in the frontend table').toBeTruthy();
    expect(row, 'the row must not read as optional').not.toMatch(/➕/);
    expect(row).toMatch(/REQUIRED/i);
  });

  it('the image actually contains what the entrypoint runs', () => {
    // An entrypoint referencing a file the image does not carry fails at boot with a bare "not
    // found", which reads like a corrupt build rather than a missing COPY.
    expect(FRONTEND_DOCKERFILE).toMatch(/COPY .*db\/migrations\/\*\.sql/);
    expect(FRONTEND_DOCKERFILE).toMatch(/COPY .*db\/migrations\/migrate\.mjs/);
    expect(FRONTEND_DOCKERFILE).toMatch(/entrypoint\.sh/);
  });
});

describe('the CRM migrates at boot too, and refuses to serve without it', () => {
  it('runs its migration runner before uvicorn', () => {
    const cmd = CMS_DOCKERFILE.split('\n').find((l) => l.startsWith('CMD')) ?? '';
    expect(cmd, 'the CRM Dockerfile has no CMD').toBeTruthy();
    expect(cmd.indexOf('db/run.sh')).toBeGreaterThan(-1);
    expect(cmd.indexOf('db/run.sh')).toBeLessThan(cmd.indexOf('uvicorn'));
  });

  it('refuses to boot on a failed migration rather than serving a stale schema', () => {
    const cmd = CMS_DOCKERFILE.split('\n').find((l) => l.startsWith('CMD')) ?? '';
    expect(cmd).toMatch(/exit 1/);
  });

  it('the image carries psql, which its runner needs', () => {
    // `db/run.sh` shells out to psql. A slim Python base does not have it, and the failure would
    // be "psql: not found" at boot — after the image built cleanly.
    expect(CMS_DOCKERFILE).toMatch(/postgresql-client/);
    expect(CMS_DOCKERFILE).toMatch(/COPY db\/ \.\/db\//);
  });
});

describe('the GitHub migration workflow is the break-glass path, not the main one', () => {
  const WF = read('.github/workflows/migrate.yml');

  it('is manual only — it must never race a deploy that is already migrating', () => {
    // Two migration runners against one database at the same moment is the failure this prevents.
    expect(WF).toMatch(/workflow_dispatch/);
    expect(WF, 'a push trigger would race the in-deployment migration').not.toMatch(/^\s*push:/m);
  });

  it('says it cannot reach a database that is internal to the deployment', () => {
    // The CRM database has no public endpoint by design. A workflow that silently could not reach
    // it — which is what a warning-and-skip produced — is worse than one that says so.
    expect(WF).toMatch(/INTERNAL|internal/);
  });
});
