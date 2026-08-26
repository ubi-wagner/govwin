/**
 * NO MIGRATION MAY LEAVE AN ACCOUNT SIGN-IN-ABLE WITH A PASSWORD THAT IS IN THIS REPOSITORY.
 *
 * Migration 124 — "launch_security_rotate_seed_credentials" — was written to remove exactly that.
 * It names three accounts in a `WHERE email IN (...)` list. Sixty-seven migrations later,
 * `191_seed_immobileyes_proposals.sql` inserted `admin@immobileyes.test` as a **tenant_admin** with
 * `is_active = true`, `temp_password = false`, and a literal bcrypt hash whose plaintext,
 * `DemoPass123!`, is committed in five driver scripts. Anyone who could read the repo could sign in
 * to that tenant on any environment the migrations had been applied to.
 *
 * A fixed allowlist cannot cover what has not been written yet, which is why 124 could not have
 * caught it and why this guard asserts the PROPERTY instead. Migrations 157 and 162 both seed
 * credentials and both pass, because both follow the pattern 124 established and say so in a
 * comment: "plaintext delivered out-of-band; temp_password=true forces a reset on first login."
 *
 * The check is a small state machine over the migrations in the order the migrator applies them,
 * because the answer is not visible in any single file: 191 creates the bad state and 214 closes
 * it, and only the final state is the truth. Reading files independently would either miss the
 * defect or report a permanent false failure on 191 forever.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'db', 'migrations');

/** A bcrypt hash literal — the thing that makes a row sign-in-able. */
const BCRYPT = /\$2[aby]?\$\d\d\$[./A-Za-z0-9]{53}/;

interface AccountState {
  hasRealHash: boolean;
  tempPassword: boolean | null;
  isActive: boolean | null;
  lastTouchedBy: string;
}

/**
 * Replay every migration's effect on the `users` table, in filename order.
 *
 * Deliberately coarse: it looks at statements that mention `users` and pulls out the email(s) they
 * name plus the literal values they set. That over-matches rather than under-matches — a statement
 * this cannot parse is reported, never silently dropped — because the failure mode to avoid is a
 * guard that quietly stops looking.
 */
function replayMigrations(): { accounts: Map<string, AccountState>; unparsed: string[] } {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const accounts = new Map<string, AccountState>();
  const unparsed: string[] = [];

  for (const file of files) {
    // STRIP `--` COMMENTS BEFORE SPLITTING. Found by this guard reporting three statements it
    // could not attribute: `198_rotate_remaining_committed_admin.sql` documents the BAD version it
    // replaces, comment-quoted, semicolon and all — so a naive split on `;` cut a comment in half
    // and treated the fragments as statements. Noise here, but the same bug would split a real
    // credential statement away from its `WHERE email = '…'` and lose it silently. A guard that
    // mis-parses toward "nothing to see" is worse than no guard.
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of sql.split(';')) {
      if (!/\b(INSERT\s+INTO\s+users|UPDATE\s+users)\b/i.test(stmt)) continue;

      const emails = [...stmt.matchAll(/'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'/g)]
        .map((m) => m[1]);
      if (!emails.length) {
        // A statement that touches users but names no literal email — e.g. a sweep keyed on
        // `email LIKE '%.test'`. Applied to every account already known to match that shape.
        const sweepsTestDomain = /email\s+LIKE\s+'%\.test'/i.test(stmt);
        if (sweepsTestDomain) {
          for (const [email, st] of accounts) {
            if (!email.endsWith('.test')) continue;
            // Only the rows the sweep's own WHERE would select.
            if (/is_active\s*=\s*true/i.test(stmt) && st.isActive === false) continue;
            if (/temp_password\s*=\s*false/i.test(stmt) && st.tempPassword === true) continue;
            if (/password_hash\s+LIKE\s+'\$2%'/i.test(stmt) && !st.hasRealHash) continue;
            applyTo(st, stmt, file);
          }
          continue;
        }
        // Only CREDENTIAL statements matter here. `006` lowercases every email and `049` nulls
        // every tenant_id — both touch `users`, neither can make anything sign-in-able. Reporting
        // them would train a reader to ignore this list, which is how a real one gets missed.
        // …and only if it could make something SIGN-IN-ABLE. `198`'s second statement is a
        // hash-keyed sweep that invalidates whatever it matches; an unattributable statement that
        // can only ever make accounts safer is not a blind spot worth reporting, and reporting it
        // would train a reader to skim this list — which is how a real one gets missed.
        // SET clause only. A bcrypt literal in a WHERE is a SELECTOR, not an assignment — 198's
        // sweep matches `WHERE password_hash IN ('$2a$12$ssn…')` to invalidate exactly that
        // credential, and reading the whole statement made the safest migration in the tree look
        // like the riskiest.
        const setClause = stmt.split(/\bWHERE\b/i)[0];
        const couldExpose = BCRYPT.test(setClause)
          || /temp_password\s*=\s*false/i.test(setClause)
          || /is_active\s*=\s*true/i.test(setClause);
        if (/password_hash/i.test(stmt) && couldExpose) {
          unparsed.push(`${file}: credential statement with no literal email`);
        }
        continue;
      }

      for (const email of emails) {
        const prev = accounts.get(email) ?? {
          hasRealHash: false, tempPassword: null, isActive: null, lastTouchedBy: file,
        };
        applyTo(prev, stmt, file);
        accounts.set(email, prev);
      }
    }
  }
  return { accounts, unparsed };

  function applyTo(state: AccountState, stmtFull: string, file: string) {
    // Assignments live before WHERE; everything after it selects rows. An UPDATE that matches on a
    // bcrypt hash in order to REVOKE it must not be read as setting one.
    const stmt = /\bUPDATE\s+users\b/i.test(stmtFull) ? stmtFull.split(/\bWHERE\b/i)[0] : stmtFull;
    if (/password_hash/i.test(stmt)) state.hasRealHash = BCRYPT.test(stmt);
    const temp = /temp_password\s*(?:=|,)\s*(true|false)/i.exec(stmt)
      ?? /,\s*(true|false)\s*,\s*(?:true|false)\s*\)/i.exec(stmt); // positional INSERT (…, temp, active)
    if (temp) state.tempPassword = temp[1].toLowerCase() === 'true';
    const active = /is_active\s*=\s*(true|false)/i.exec(stmt);
    if (active) state.isActive = active[1].toLowerCase() === 'true';
    state.lastTouchedBy = file;
  }
}

describe('seeded credentials', () => {
  const { accounts, unparsed } = replayMigrations();

  it('the replay actually read the migrations', () => {
    // The instrument before the finding: a parser that found nothing would pass every assertion
    // below while proving nothing at all.
    expect(accounts.size).toBeGreaterThan(3);
    expect([...accounts.keys()]).toContain('admin@immobileyes.test');
    expect([...accounts.keys()]).toContain('eric.c.wagner@gmail.com');
  });

  it('reports any users statement it could not attribute', () => {
    // Loud about its own blind spots rather than silently narrowing what it checks.
    expect(unparsed, `unparsed users statements:\n  ${unparsed.join('\n  ')}`).toEqual([]);
  });

  it('leaves no account active with a committed hash and no forced reset', () => {
    const exposed = [...accounts.entries()]
      .filter(([, s]) => s.hasRealHash && s.tempPassword === false && s.isActive !== false)
      .map(([email, s]) => `${email} (last touched by ${s.lastTouchedBy})`);

    expect(exposed, [
      'These accounts end up sign-in-able with a password hash committed to this repository:',
      ...exposed.map((e) => `  · ${e}`),
      '',
      'Follow the mig-124 pattern: deliver the plaintext out-of-band and set temp_password = true',
      'so first login forces a reset — see 157_econdev_partner_admin.sql for the shape.',
    ].join('\n')).toEqual([]);
  });

  it('the mig-124 pattern accounts are recognised as safe', () => {
    // Guards the guard: if these three ever read as exposed, the parser has drifted and the clean
    // result above would be meaningless.
    for (const email of ['eric.c.wagner@gmail.com', 'pjackson@ecinnovates.com', 'sgaffney@ybi.org']) {
      const st = accounts.get(email);
      expect(st, `${email} not found by the replay`).toBeDefined();
      expect(st!.tempPassword, `${email} should force a reset`).toBe(true);
    }
  });
});
