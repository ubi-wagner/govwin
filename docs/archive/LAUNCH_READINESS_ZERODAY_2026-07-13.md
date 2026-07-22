# Zero-Day Launch Readiness — RFP Pipeline (2026-07-13)

> **Update since this 2026-07-13 snapshot:** the purchase model shipped as the **comp-code purchase → curation_pending → admin release → provision** flow (migs 105–108), superseding the "admin-provisioned / self-serve-Stripe-backlog" framing below; see **`docs/MASTER_MIRROR_OPP_DESIGN.md`**.

**Verdict: the founding-cohort core loop is GREEN end-to-end and Alpha-ready to test Monday,
gated on two operator/infra prerequisites (real S3 creds + the Python pipeline worker).**
Everything below is what a sandbox dress rehearsal actually exercised — not aspiration.

Start here Monday: `docs/ALPHA_HITL_RUNBOOK.md` (stack-up §1) → `docs/HITL_IMMOBILEYES_CLICKPLAN.md`
(the 15-step click/perform/expect table you'll drive as RFP admin → shadow → Immobileyes).

---

## 1. What's proven green (the core value loop)

Single-operator path, verified in-sandbox on the greenfield opportunity-card spine
(company: **Immobileyes**, a hypothetical CV property-intelligence SMB):

`/apply` → **Accept** (mints tenant + `tenant_admin` + **temp password inline**, mirrors the opp river)
→ **RFP upload / ingest** (opportunity + `curated_solicitations('new')` + stored doc)
→ **Build baseline template** (Technical-Volume canvas w/ `{company_name}`/`{topic_title}` merge fields)
→ **Curation**: add volume + required item, set compliance (`submission_format`), **link template + expert note**
→ **Approve + Push** (`solicitation.push` fans out → **Immobileyes card = 1**)
→ **Shadow into `/portal/immobileyes`** (rfp_admin global tenant access, `lib/db.ts:52`)
→ **Library**: upload capability doc → atomize → tag → `library_atoms` (reference + primitive)
→ **Provision proposal** (sections + artifacts + **compliance matrix**; the linked template
   **interpolates into the mold** → Technical Approach reads *"Immobileyes proposes…"*, `ai_drafted`, expert note readable)
→ **Release** (admin unlock) → **Accept & Lock** each section (matrix → `satisfied ×2`)
→ **Advance draft → final** (auto-locks → `submitted`)
→ **Download Proposal** (real **8,962-byte .docx**, valid zip)
→ **Audit** (`/admin/activity` events posting as **objects, 33/33** — not string scalars).

Result: **13/15 clickplan steps fully green; 2 config-gated** (below).

## 2. The six functionality areas

| # | Area | State |
|---|---|---|
| 1 | Public content + waitlist + approval | **Green** — apply→accept mints tenant/admin, temp password returned inline, opp river mirrors on signup (backfill wired) |
| 2 | Scout engine + admin ToDo queue | **Partial** — ingestion/scoring paths exist; daily scheduler + web-search notifications are **backlog** |
| 3 | RFP-admin opp creation → global river → per-tenant mirror | **Green** — push fan-out to `tenant_opportunity_cards`, auto-scored into buckets on arrival |
| 4 | Customer upload → atomize → buckets → rank/pin | **Green (core)** — atom loop + bucket scoring; inline `/cards` rank + pinned-opp nudges are **backlog** |
| 5 | Purchase → admin skeleton curation → release → portal | **Green (admin-provisioned)** — matrix/template molds land at provision; **self-serve Stripe purchase is backlog** |
| 6 | Proposal pipeline V1 → download | **Green** — provision → draft/interpolate → lock → advance → **.docx download** |

Full detail + as-built file tree: `docs/ALPHA_ARCHITECTURE_ASBUILT.md`.
Everything deferred is tracked in `docs/ALPHA_TODO_BACKLOG.md` (nothing on the core loop is silently missing).

## 3. Bug classes squashed (the "stupid ones")

- **jsonb string-scalar** — `${JSON.stringify(x)}::jsonb` stores a jsonb *string scalar* (objects **and** arrays;
  `col->>'k'` returns NULL). Definitively reproduced (round-trip: that pattern → `jsonb_typeof=string`;
  `${sql.json(x)}` → `object`). Fixed **56 writes across 34 files** → `sql.json`; migration **104** backfills
  the already-written string-scalar rows. Documented as CLIFFNOTES Mistake #39.
- **`${cond ? 't':'f'}::bool` silent no-op** — a bound text param `'t'`/`'f'` is **not** the SQL literal, so the
  cast evaluated FALSE even when true → silent edit no-ops. Reproduced, fixed to raw `${cond}` across the
  volume/topic update tools + routes (CLIFFNOTES Mistake #40).
- **Type gate green**: `npx tsc --noEmit` → **exit 0** (verified today).

## 4. Operator prerequisites for Monday (config/infra, not code)

Set these before the run — each has a graceful degradation noted:

1. **Real S3 / R2 creds** (`AWS_*` / R2) — without them `rfp-upload` returns **500 STORAGE_ERROR** *after*
   creating the opp+solicitation (orphans a zero-doc solicitation; backlog item B2). **Required for step 3.**
2. **Python pipeline worker booted** — else no `process_instances` / workflow automation. **Required for step 15**
   (the download loop itself does not need it).
3. **`ANTHROPIC_API_KEY` on the pipeline** — gates the live agents (`section_drafter`, `compliance_reviewer`,
   `color_team_reviewer`). Provisioning still interpolates the template mold without it.
4. **`NEXTAUTH_URL` + `NEXTAUTH_SECRET`** — auth/session correctness.
5. **Email provider creds** — optional: `Accept` returns the temp password **inline** with an `emailError`
   flag when email isn't configured, so onboarding still completes.
6. **Stripe price env vars** — only needed once **self-serve purchase** ships; the admin-provisioned founding-cohort
   path (what you'll test Monday) does not touch Stripe.

`DATABASE_URL` + `migrate.mjs` auto-apply migrations through **104** on boot.

## 5. Commit "Unverified" badge — the honest status

The GitHub **Unverified** badge on this branch is an **environment limitation, not a code defect**, and
**cannot be cleared from inside this sandbox**:

- All 48 branch commits already carry the **correct identity** (committer + author `noreply@anthropic.com`,
  name `Claude`) and the mandated trailers. Nothing to fix there.
- They are unsigned (`%G? = N`) because this sandbox has **no functional signing key**: `commit.gpgsign=true`
  and `gpg.format=ssh`, but the configured key file is a **0-byte placeholder**, there is no private key, and no
  ssh-agent. A fresh probe commit also came out unsigned — so **rewriting history to "re-sign" would change
  every hash and force-push for zero change to the badge.** That destructive no-op was deliberately **not** done.
- Even a locally self-generated key would still show "Unverified" on GitHub unless its **public key is registered
  to the GitHub account** — an account action only you can take. That (or accepting it as cosmetic for Alpha) is
  the only real fix.

---

**Bottom line:** the core founding-cohort loop — discover → curate → push → shadow → library → provision →
build → lock → download — is exercised and green; the two gaps to a "full picture" run are S3 creds and the
pipeline worker, both config. Descoped items are catalogued, not hidden. Type gate passes. Ready for Monday HITL.
