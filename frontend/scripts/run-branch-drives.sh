#!/usr/bin/env bash
# Run every BRANCH drive against the live rig and print one table.
#
# `drive-end-to-end.mjs` proves the happy spine on one artifact: ingest → curate → push → buy →
# provision → author → lock → package. It deliberately does not fork. The branches — award,
# amendment, archive, collaborator, partner, the HITL gates — each have their own drive, and until
# now they were run one at a time by hand, which is how one quietly stops being run at all.
#
# Every drive here already existed. What did not exist was a single command that runs them all and
# says, in one place, which ones pass TODAY against the build that is actually serving.
#
# WHAT A FAILURE MEANS. Nothing is skipped and nothing is swallowed: a drive that fails prints its
# name, its exit code and the tail of its log, and the script exits non-zero. A drive that cannot
# run for an environmental reason (missing fixture, absent seed) is still a FAILURE here — it is
# uncovered, not passing, the same rule the four lenses use.
#
#   ./scripts/run-branch-drives.sh            all drives
#   ./scripts/run-branch-drives.sh amendment  only names matching a substring
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
OUT="${OUT_DIR:-/tmp/branch-drives}"
mkdir -p "$OUT"
FILTER="${1:-}"

# THE DEFAULTS ARE THE TWO ROLES, not one role twice. Defaulting both to the owner made every
# isolation drive refuse ("RLS posture wrong") on the plainest possible invocation — safe, since a
# bypassed layer makes an isolation verdict meaningless rather than merely wrong, but it meant the
# obvious command measured nothing. Defaulting both to the app role would flip the problem onto the
# scenario drives, which create companies and need the owner. Each default is now the role its own
# group requires; either can still be overridden from the environment.
# ONE SOURCE OF TRUTH FOR CREDENTIALS. scripts/sandbox-env.sh is where the box's roles and
# passwords are defined; this file used to carry its own defaults and they drifted — sandbox-env
# said the app role's password was `apppass` and the default below said `changeme`, so on a
# rehydrated box every scoped-connection drive died with
#   PostgresError: password authentication failed for user "govtech_app"
# which reads as a broken database and is actually two files disagreeing about one value. Sourcing
# it means the runner cannot disagree with the environment the box was set up with.
SANDBOX_ENV="$(dirname "$0")/../../scripts/sandbox-env.sh"
# shellcheck disable=SC1090
[ -f "$SANDBOX_ENV" ] && . "$SANDBOX_ENV"

export DATABASE_URL="${DATABASE_URL:-postgresql://govtech_app:changeme@localhost:5432/govtech_intel}"
export DATABASE_URL_OWNER="${DATABASE_URL_OWNER:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"
# The SCOPED role by name, always — a scenario drive is handed the owner as DATABASE_URL, so a
# check whose meaning is "RLS denied it" needs a way to reach the app role regardless.
# DERIVED, not a second literal. This is "the scoped role, by name" — and after sourcing
# sandbox-env.sh, DATABASE_URL already IS the scoped role. Repeating the credential here is what
# left `atomization` and `vault-isolation` still failing on
#   ✗ RLS probe failed — password authentication failed for user "govtech_app"
# after the first copy of the same literal was fixed. One credential, one place: a value written
# twice is a value that will disagree with itself eventually, which is the whole lesson of B109,
# B111 and the sandbox-env drift above.
export DATABASE_URL_APP="${DATABASE_URL_APP:-$DATABASE_URL}"
export GUIDE_BASE="${GUIDE_BASE:-http://localhost:3000}"
# The harness's OWN bookkeeping reads across tenants, so it uses the owner regardless of posture.
export GUIDE_DB="${GUIDE_DB:-$DATABASE_URL_OWNER}"
export SANDBOX_PASSWORD="${SANDBOX_PASSWORD:-SandboxDrive2026!}"
export RFP_ADMIN_PW="${RFP_ADMIN_PW:-$SANDBOX_PASSWORD}"
export TENANT_PW="${TENANT_PW:-DemoPass123!}"
export BUYER_PW="${BUYER_PW:-$TENANT_PW}"
export FOUNDATION_PW="${FOUNDATION_PW:-$TENANT_PW}"
export PASSWORD="${PASSWORD:-$TENANT_PW}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
export ATOM_EMBED="${ATOM_EMBED:-local}"
export STORAGE_DRIVER="${STORAGE_DRIVER:-local}"

# ── RESOLVE THE FIXTURE ONCE, AND HAND IT TO EVERY DRIVE ────────────────────────────────────────
#
# Several drives already read TEST_TENANT_ID / TEST_TENANT_SLUG and fall back to a hardcoded uuid
# when they are unset. That fallback is a dead tenant on any rebuilt database, and the drives fail
# with an FK violation on tenant_id — which looks nothing like "your fixture moved", so it reads as
# a product bug. Exporting a resolved value makes the fallback unreachable.
#
# The tenant chosen is the one with the most to lose: driving isolation against an empty tenant
# proves nothing, because every check would pass on nothing.
# These three lookups are the RUNNER's own bookkeeping and read ACROSS tenants, so they use the
# owner. Run as the scoped app role with no tenant context they would not error — they would
# silently count zero proposals and zero cards for every tenant and pick the "busiest" one at
# random, which is the worst of both worlds: a fixture chosen by nothing, reported as chosen.
if [ -z "${TEST_TENANT_ID:-}" ]; then
  read -r _tid _tslug <<<"$(psql "$DATABASE_URL_OWNER" -tAF' ' -c "
    SELECT x.id, x.slug FROM (
      SELECT t.id, t.slug,
             (SELECT count(*) FROM proposals p WHERE p.tenant_id = t.id) AS n1,
             (SELECT count(*) FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) AS n2
      FROM tenants t
      WHERE EXISTS (SELECT 1 FROM users u
                    WHERE u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin')
    ) x ORDER BY x.n1 + x.n2 DESC LIMIT 1" 2>/dev/null)"
  if [ -n "${_tid:-}" ]; then
    export TEST_TENANT_ID="$_tid" TEST_TENANT_SLUG="$_tslug"
    # The ACTOR is pinned in several drives too — `owner_user_id` FK violations are the same rot,
    # one field further in. Resolve a real tenant_admin of the chosen tenant.
    _aid=$(psql "$DATABASE_URL_OWNER" -tAc "
      SELECT u.id FROM users u
      WHERE u.tenant_id = '$_tid' AND u.is_active AND u.role = 'tenant_admin'
      ORDER BY u.created_at LIMIT 1" 2>/dev/null | tr -d ' ')
    [ -n "$_aid" ] && export TEST_ACTOR_ID="$_aid"
    echo "fixture: tenant=$_tslug ($_tid) actor=${_aid:-UNRESOLVED}"
    echo
  else
    echo "WARNING: could not resolve a tenant — drives that need one will report CANT-RUN" >&2
  fi
fi

# ── PREFLIGHT: is this box enforcing RLS, or only appearing to? (bug log B86) ───────────────────
#
# A superuser connection bypasses row-level security entirely, and a run against one produces
# isolation output indistinguishable from a perfectly isolated box. An entire session's worth of
# "RLS proven" once came from exactly that. So the posture is checked BEFORE anything runs.
#
# It does not abort the suite: the non-isolation drives still measure real things. What it does is
# refuse to let the isolation drives report a verdict they cannot earn — they are marked CANT-RUN,
# which is uncovered rather than passing, and the banner says why.
# The cross-tenant invariant: nothing reads or writes cross-tenant, ever. Checked here rather than
# when someone remembers, because the one violation that existed (303 atom_lineage edges) sat
# unnoticed for months in a link table no tenant-column sweep could see.
if node scripts/check-tenant-isolation-invariant.mjs > "$OUT/tenant-invariant.log" 2>&1; then
  echo "tenant isolation: no cross-tenant references"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ CROSS-TENANT REFERENCES EXIST — data must move by inward COPY, never by reference.    ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/tenant-invariant.log" | tail -12
  # AND IT FAILS THE RUN. This branch used to print the banner and fall through, so the suite
  # reported "39 passed · 0 failed" and exited 0 with a live cross-tenant reference on the box —
  # a green that is not green, and the one thing most likely to be believed without reading.
  #
  # It contradicted this file's own rule, stated in its header: a drive that cannot run "is still a
  # FAILURE here — it is uncovered, not passing". A stored reference across the tenant boundary is
  # strictly worse than uncovered; it is a violation of a non-negotiable invariant, found. The RLS
  # posture preflight above already acts on what it finds (it marks the isolation drives CANT-RUN);
  # this one only talked.
  #
  # It does NOT abort: the drives below still measure real things, and killing the run would trade
  # one blind spot for another. The violation is carried to the summary and forces a non-zero exit.
  INVARIANT_VIOLATION=1
fi

# ── PREFLIGHT: does anything in this suite still point at a row that no longer exists? ──────────
#
# Fixture rot is silent by construction: a drive that pins a uuid keeps reporting a verdict after
# the row is gone, and the verdict looks like a regression in whatever the drive tests. Eight
# confident, wrong findings came out of exactly that this week (B98-B101). This asks the live
# database about every uuid and email literal in the suite, the four lenses and the guide capture,
# and names any that are dead and REACHABLE (a literal behind an env-var fallback the runner
# already resolves is not reachable; one a script is about to CREATE is not rot).
#
# It does not abort — the drives still measure real things — but a non-zero count here means some
# green below may be green about nothing, so it is said loudly and first.
if node scripts/audit-pinned-fixtures.mjs > "$OUT/pinned-fixtures.log" 2>&1; then
  echo "fixtures: nothing in the suite points at a row that no longer exists"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ FIXTURE ROT — a drive below can drive an identifier that is GONE. Its verdict may be  ║"
  echo "║ about nothing at all. Resolve it or build it; see TESTING_STRATEGY.md.                ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed -n '/LIVE SAFETY NET/,/^$/p' "$OUT/pinned-fixtures.log" | sed 's/^/  /'
fi

# ── Is the box serving the build we think it is, and does its client half run? ─────────────────
# Ordered BEFORE the RLS gate on purpose: a broken rig makes every browser drive below meaningless,
# and unlike the RLS posture it fails SILENTLY GREEN. A surface sweep gates on client throws, and
# code that never executes never throws — an unhydrated box reports every page clean.
HYDRATION_OK=1
if node scripts/check-rig-hydration.mjs > "$OUT/rig-hydration.log" 2>&1; then
  echo "Rig: serving this build, client half runs"
else
  HYDRATION_OK=0
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ RIG NOT TRUSTWORTHY — the server and the staged assets are from different builds, or  ║"
  echo "║ the client bundle does not execute. EVERY browser drive below is meaningless: a page  ║"
  echo "║ that never hydrates cannot throw, so a surface sweep reports it CLEAN.                ║"
  echo "║ Fix the rig before believing anything in this run.                                    ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/rig-hydration.log" | head -8
fi
echo

# The two scorers are a deliberate mirror pair — frontend/lib/bucket-scoring.ts::scoreCard and
# pipeline/.../rescore.py::score_card — and until this check the only thing asserting it was each
# file's comment about the other. They have already been observed mirroring each other INCLUDING a
# bug, which is precisely the failure a comment cannot catch. A DIVERGENCE FAILS THE RUN: a
# preflight that finds a violation and lets the suite report green is worse than no preflight
# (B145), and here a divergence means every ranking number below was produced by whichever runtime
# happened to touch the card last.
if node scripts/verify-scorer-parity.mjs > "$OUT/scorer-parity.log" 2>&1; then
  echo "Scorer parity: TS and Python agree on every fixture (rankings mean the same thing either side)"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ SCORER PARITY BROKEN — the TS and Python scorers disagree.                            ║"
  echo "║ A card's score now depends on WHICH RUNTIME scored it last. Every ranking result      ║"
  echo "║ below is unreliable. Fix before reading anything else.                                ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/scorer-parity.log" | head -20
  # A COUNTER, not the FAILED array — that is declared 180 lines below this point, so an append
  # here would be wiped by its `declare -a FAILED=()` and the run would exit 0 with the banner
  # printed. Exactly the shape of B145.
  PARITY_VIOLATION=1
fi
echo

# Every OPP card field and mirror column: written? read? A field declared and written by nothing
# has shipped three times in this tree, each found by hand. A divergence FAILS the run.
if node scripts/audit-card-fields.mjs > "$OUT/card-fields.log" 2>&1; then
  echo "Card fields: nothing declared-and-unwritten"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ A CARD FIELD IS DECLARED AND WRITTEN BY NOTHING — see $OUT/card-fields.log            ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/card-fields.log" | tail -12
  PARITY_VIOLATION=1
fi
echo

RLS_OK=1
if node scripts/check-rls-posture.mjs > "$OUT/rls-posture.log" 2>&1; then
  echo "RLS posture: correct (isolation results from this box mean what they say)"
else
  RLS_OK=0
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ RLS POSTURE WRONG — the isolation drives will be reported as CANT-RUN, not run.       ║"
  echo "║ A bypassed database layer produces the same output as a perfectly isolated one, so    ║"
  echo "║ their verdicts would be meaningless. Everything else still runs.                      ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/rls-posture.log" | head -8
fi
echo

OFFICE_OK=1
if node scripts/check-office-filters.mjs > "$OUT/office-filters.log" 2>&1; then
  echo "Office filters: LibreOffice can open a deck (the deck probe can measure)"
else
  OFFICE_OK=0
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ NO OFFICE FILTERS — the deck probe will be reported as CANT-RUN, not run. It compares ║"
  echo "║ our writer against an engine that did not write the file; with no engine there is no  ║"
  echo "║ comparison, and 'UNMEASURED' in a results table reads like a run that happened.       ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/office-filters.log" | head -6
fi
echo

# Drives that need a real Office engine to mean anything. Without one they measure nothing.
OFFICE_DRIVES="deck-overlap"

# Drives whose entire value is an isolation claim. Meaningless in the wrong posture.
# Drives whose entire value is an isolation claim MADE THROUGH THE DATABASE. Meaningless in the
# wrong posture, so the runner marks them CANT-RUN rather than letting them report a verdict.
# `vault-isolation` left this list when it moved onto the factory: six of its seven checks are
# APP-layer (resolveVaultAccess), which the posture does not affect, and its one RLS check now
# gates itself on the role it lands on and reports NOT MEASURED when that role can bypass.
ISOLATION_DRIVES="rls-app rls-admin rls-portal rls-pages collaborator-boundary"

# ── TWO ROLES, BECAUSE THE SUITE GENUINELY NEEDS BOTH ────────────────────────────────────────────
#
# This is not a preference, it is a conflict of requirements that only became visible once the
# scenario drives existed:
#
#   ISOLATION drives must run with DATABASE_URL = the SCOPED app role. That is the whole point —
#   under the owner, RLS is bypassed and "no cross-tenant rows visible" is unfalsifiable (B86).
#
#   SCENARIO drives must run with DATABASE_URL = the OWNER. They CREATE tenants through the
#   product's own helpers, and those helpers use the context-aware `sql`; under a scoped role with
#   no tenant context the writes are half-applied — tenant yes, membership no — and the drive then
#   fails on session assertions that have nothing to do with the product.
#
# Running the whole suite under either role makes the other group CANT-RUN. So each group gets the
# connection its job requires, and the scenario factory refuses loudly if it is ever handed the
# wrong one rather than half-working.
SCENARIO_DRIVES="pin identity-deeplink partner-lifecycle partner-invite scenario-factory scenario-matrix shadow-tenant-admin spine-section-todo atomization vault-isolation award-to-contract uncovered-triggers cms-generate canvas-authoring ruler-overlays page-scale deck-ruler canvas-demo spend-guardrails full-build-cost"

# label | script — the branches the spine drive does not fork into.
DRIVES=(
  # FIRST, because nine of the drives below now stand on it. The factory is load-bearing: one that
  # silently builds half a scenario, or disposes incompletely, would make every drive above it
  # report confidently about a situation that was never constructed — and the leak would accumulate
  # under every future run. Its self-test counts the world, builds, asserts each piece is real and
  # usable, disposes, and asserts the world is identical again. Validate the instrument, then use it.
  "scenario-factory|scripts/drive-scenario-factory.mts"
  # The PRE-AWARD arc — a government PDF nobody wrote for us through ingest · curate · push ·
  # discover · buy · provision · author · lock · package · download. The header at the top of
  # this file has always named it as the thing these branch drives complement, and it was
  # never actually in the list: run by hand or not at all, which is how a drive quietly stops
  # being run. Paired with `project-lifecycle` below it is one continuous artifact, because
  # that drive reads this one's journal and continues from the build it authored.
  "end-to-end|scripts/drive-end-to-end.mjs"
  # Needs a real Office engine (see OFFICE_DRIVES). Measures the deck writer's declared node
  # heights against what LibreOffice actually renders — the gap that hid B121, where delivered
  # decks were missing table rows and bullets because the bytes were complete and only the
  # rendered page was not.
  "deck-overlap|scripts/probe-deck-overlap.mts"
  "award-to-contract|scripts/drive-award-to-contract.mts"
  # The post-award branch, all the way through: award → the engine raises a ToDo → a human
  # opens the project → CLINs/WBS/milestones → the baseline freezes ONCE → upload is not
  # acceptance → the milestone closes and its variance survives into the event record. It is
  # the drive that caught a baseline nobody could set, behind five green lenses.
  "project-lifecycle|scripts/drive-project-lifecycle.mts"
  # `amendment` takes a <solicitationId>. Passing none made it print usage and exit 1, which the
  # table reported as a failing amendment flow rather than a missing argument. Resolved below.
  "amendment|scripts/drive-amendment.mjs|SOLICITATION"
  "provisioning-cockpit|scripts/drive-provisioning-cockpit.mts"
  "tenant-workflow-setup|scripts/drive-tenant-workflow-setup.mts"
  "scout-intake|scripts/drive-scout-intake.mts"
  "opp-scout|scripts/drive-opp-scout.mts"
  # mig 238 — the solicitation copied inward, on the REAL DoW 2026 SBIR set (433 pages, 1.32M
  # chars). Red first: it refuses a verdict (exit 2) if the corpus already exists, because a green
  # that was already green measures nothing. It stages documents and republishes, so it prints its
  # mutation footprint and restores what it staged.
  "corpus-copy-inward|scripts/drive-corpus-copy-inward.mts"
  # The tenant side of the ranking spine as the THREE actors canManageBuckets admits: tenant_admin,
  # a delegated member, and an rfp_admin (or above) descending. It GRANTS can_manage_buckets to a
  # candidate for the run and reverts it, because no seeded account carries the column and the path
  # would otherwise report uncovered forever — and it checks the refusal as well as the grant.
  "bucket-authoring|scripts/drive-bucket-authoring.mts"
  # The invariant binding the two halves of the mirrorable row: a pointer to a local copy exists
  # only when that copy does. It exists because the opposite shipped — a pin whose objects were
  # missing returned {pinned:true, docs:[]} and stamped pinned_at. Also asserts the pair a
  # withdrawal and a failed copy make: identical from outside, opposite handling.
  "pin-honesty|scripts/drive-pin-honesty.mts"
  # The whole curated-ranking claim in one pass, red first: a lens scores an opportunity ZERO, an
  # admin highlights one sentence containing the lens's keyword, and the same lens then scores it
  # 100 — through the real tool, the real bridge and the real scorer. It is the claim that replaced
  # "rank the whole solicitation", and none of it had ever carried a real highlight.
  "curated-ranking|scripts/drive-curated-ranking.mts"
  # A REAL government solicitation through the REAL product: 3 MB PDF uploaded via the multipart
  # route as a signed-in rfp_admin, shredded by the workflow processor, curated, highlighted from
  # the extracted text, released. Needs the worker and the Claude emulator up (scripts/sandbox-up.sh)
  # and leaves the solicitation on the box; --cleanup removes it.
  "real-solicitation|scripts/drive-real-solicitation.mts"
  # The curator's pass on that solicitation: count the boilerplate, mark the passages that govern
  # every bid, segment the 66 topics into their own opportunities, release all 67. Requires
  # real-solicitation to have run first; --cleanup removes the topics and annotations.
  "curate-baa|scripts/drive-curate-baa.mts"
  # The two questions the expanded card did NOT answer, driven with both halves: does the card say
  # how much work the solicitation is (complianceSummary + provisionReady — both carried by the
  # bridge and read by no code until now), and does a bucket criterion reach any opportunity at all
  # (naics_codes is an empty array on every master row, so a lens naming it scored on nothing while
  # the page reported it at 29%). Pins and unpins one card; sandbox only.
  "card-decision|scripts/drive-card-decision.mts"
  # The verdict/transfer split (mig 240) end to end: the thumb writes an opinion and copies nothing,
  # the up-vote REVEALS "View Solicitation", the transfer lands in a reading view that leads with the
  # analyst's note and marked passages, and a thumbs-down sorts and filters while removing nothing —
  # the mirror invariant checked as row counts and document counts before and after. Seeds a note and
  # one annotation through the real bridge when the box has none, and removes them after.
  "verdict-transfer|scripts/drive-verdict-and-transfer.mts"
  # The UPWARD half of the signal: a customer's thumb reaching the RFP admin who decides what to
  # build out next. Red half first — the admin row must show NO demand before any vote — then two
  # tenants vote and the row must state the count, the drop-off between saying yes and opening the
  # documents, and the narrow "interest · no build-out" case. Votes and restores; sandbox only.
  "admin-demand|scripts/drive-admin-demand.mts"
  "submit-gate|scripts/drive-submit-gate.mts"
  "review-gate|scripts/drive-review-gate.mts"
  "full-draft|scripts/drive-full-draft.mts"
  "collaborator-boundary|scripts/drive-collaborator-boundary.mts"
  "partner-lifecycle|scripts/drive-p3-lifecycle.mts"
  "partner-invite|scripts/drive-p3-invite.mts"
  "starter-offer|scripts/drive-starter-offer.mts"
  "copy-starter|scripts/drive-copy-starter.mts"
  "shadow-tenant-admin|scripts/drive-shadow-tenant-admin.mts"
  "rls-app|scripts/drive-rls-app.mjs"
  "rls-admin|scripts/drive-rls-admin.mjs"
  "rls-portal|scripts/drive-rls-portal.mjs"
  "rls-pages|scripts/drive-rls-pages.mjs"
  "atomization|scripts/drive-atomization.mts"
  "bridge-buckets|scripts/drive-bridge-buckets.mjs"
  "pin|scripts/drive-pin.mts"
  "identity-deeplink|scripts/drive-identity-deeplink.mts"
  "vault-isolation|scripts/drive-vault-isolation.mts"
  "spine-section-todo|scripts/drive-spine-t1-section-todo.mts"
  "spine-buildout|scripts/drive-spine-t4-buildout.mts"
  "spine-anchor|scripts/drive-spine-t7-anchor.mts"
  # Fires the domain emitters the AI_INVOKE contract lens has never observed. Runs LAST because
  # it deliberately leaves its audit events behind — they ARE the coverage evidence (B103).
  "uncovered-triggers|scripts/drive-uncovered-triggers.mts"
  "cms-generate|scripts/drive-cms-generate.mts"
  "cms-publish|scripts/close-e2e-cms.mjs"
  # Authors NEW documents from a blank canvas as both actors and takes them out in all four formats.
  # It needs the OWNER for its own bookkeeping (reading back the saved row), which the runner already
  # exports; it creates tenant_documents rows and leaves them, deliberately — they are a customer's
  # own documents, not fixture, and a tenant with a few extra drafts is the realistic state.
  "canvas-authoring|scripts/drive-canvas-authoring.mts"
  # The four structural primitives, each measured by the effect it actually has. No server needed.
  "canvas-structural|scripts/probe-structural-nodes.mts"
  # The ruler system on the case that motivates it: prose above a table that cannot fit behind it.
  # Asserts the fixture really relocates BEFORE looking at the UI, so a pass cannot come from a
  # document that never triggered the behaviour.
  "ruler-overlays|scripts/drive-ruler-overlays.mts"
  # The page renders at the size it computes — offsetWidth vs getBoundingClientRect across four
  # viewports. The only instrument that can see a uniformly-too-small page, which LOOKS correct.
  "page-scale|scripts/probe-page-scale.mts"
  # Grid geometry against all 10 shipped presets. No server needed.
  "measure-grid|scripts/probe-measure-grid.mts"
  # From an EMPTY preset to a finished document and deck, every capability applied, captured as
  # screen grabs. The only harness here that authors from nothing the way the API does — which is
  # how it found the metadata.status crash that made a freshly-created document unopenable while
  # every fixture document (written by an older path that sets status) rendered fine.
  "canvas-demo|scripts/demo-canvas-capabilities.mts"
  # The ruler on REAL STORED DECKS, authored through the portal routes as a tenant_admin.
  # Every one of the 64 stored proposal sections is `letter`, so the slide half of the canvas had
  # only ever been checked against 7 synthetic in-memory decks and 5 bracket-only molds — the
  # stored-artifact ruler had never measured a deck out of the database. Carries a deliberate
  # over-stuffed deck so the overflow check has a case that fails when the product is wrong.
  "deck-ruler|scripts/verify-deck-ruler-live.mts"

  # ── THE STATIC AUDITS ───────────────────────────────────────────────────────────────────────
  #
  # Not drives — they open no browser and mutate nothing — but registered here for the reason this
  # file exists at all, stated in its own header: an instrument run by hand is one that quietly
  # stops being run. All four were written in a single session and none of them was wired in, which
  # would have made them exactly the "documented but never executed" scripts the inventory keeps
  # counting. They are cheap (seconds, no browser) and each answers a question no drive above does.
  #
  # `audit-env-inventory` also needs no database, so it is the one check here that still means
  # something on a box with nothing running.
  "coherence|scripts/audit-pipeline-coherence.mjs"
  "row-types|scripts/audit-row-type-truth.mjs"
  "env-inventory|scripts/audit-env-inventory.mjs"

  # The phone probe belongs with the drives rather than the audits: it opens a browser, signs in as
  # two actors and needs the app serving. It refuses a verdict when the app is serving no CSS,
  # which is the failure that once made it report 75 phantom findings across the whole tree.
  "mobile-interaction|scripts/probe-interaction-mobile.mts"
  # THE SPEND GUARDRAILS, both directions. Eleven cases: the tenant budget refuses and allows, a
  # monthly_budget of 0 disables, the platform cap refuses even when the tenant has headroom, the
  # kill switch stops everything, the hourly rate limit refuses and allows, and the framework
  # ceiling beats a tenant's own inflated figure. Every case asserts the ALLOW as well as the
  # REFUSE, because a guard that refuses everything passes a refusal-only test. It snapshots every
  # value it touches FIRST and restores in a `finally`, and asserts the restore — written that way
  # after an earlier hand-run left a tenant on a $9999 budget and a $0.39 ceiling.
  "spend-guardrails|../pipeline/tests/verify_spend_guardrails.py"
  # WHAT A FULL BUILD COSTS, and whether the caps see it. Clones a real proposal's structure into a
  # throwaway with authorable sections — because every proposal on this box is `approved`, so a
  # full-draft fired at any of them drafts NOTHING and reports the review cohort's cost under the
  # heading "full build". It refuses a verdict (exit 2) if the run drafts zero sections, prints its
  # mutation footprint, and re-counts the tables afterwards. Needs the emulator on :8787.
  "full-build-cost|scripts/estimate-full-build-cost.mts"
)

pass=0; fail=0; missing=0; cantrun=0
declare -a FAILED=()   # initialised: `${#FAILED[@]}` on a declared-but-unset array trips `set -u`

printf '%-24s %-8s %s\n' "DRIVE" "RESULT" "DETAIL"
printf '%-24s %-8s %s\n' "------------------------" "--------" "------"

for entry in "${DRIVES[@]}"; do
  label="${entry%%|*}"; rest="${entry#*|}"; script="${rest%%|*}"; argspec="${rest#*|}"
  [ "$argspec" = "$script" ] && argspec=""
  # Resolve a positional argument the drive needs. A drive that wants one and gets none prints its
  # usage and exits 1, which is indistinguishable in a table from the flow being broken.
  drive_args=""
  if [ "$argspec" = "SOLICITATION" ]; then
    # RESOLVE WHAT THE DRIVE NEEDS, NOT WHAT IS MERELY NEAREST.
    #
    # This used to select the newest solicitation that had VOLUMES. The amendment drive needs one
    # with an active PROPOSAL — an amendment fans out to the builds made from it, so a solicitation
    # nobody has built against has nothing to fan to. The two predicates agreed only by luck: the
    # moment any newer volume-bearing solicitation appeared, the resolver handed over one the drive
    # had to refuse, and the table read CANT-RUN — which this file's own rule calls uncovered, not
    # passing. So the amendment path quietly stopped being covered, which is precisely the failure
    # this runner was written to prevent ("run one at a time by hand, which is how one quietly stops
    # being run at all"). Observed exactly that between two runs an hour apart.
    #
    # The join direction is the one the schema map warns about (B46, §4): the populated FK is
    # `opportunities.solicitation_id`, NOT `curated_solicitations.opportunity_id`.
    drive_args=$(psql "$DATABASE_URL_OWNER" -tAc "
      SELECT cs.id FROM curated_solicitations cs
      WHERE EXISTS (SELECT 1 FROM solicitation_volumes v WHERE v.solicitation_id = cs.id)
        AND EXISTS (SELECT 1 FROM opportunities o
                      JOIN proposals p ON p.opportunity_id = o.id AND p.archived_at IS NULL
                    WHERE o.solicitation_id = cs.id)
      ORDER BY cs.created_at DESC LIMIT 1" 2>/dev/null | tr -d ' ')
    if [ -z "$drive_args" ]; then
      printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "no curated solicitation with volumes AND an active proposal"
      cantrun=$((cantrun+1)); FAILED+=("$label"); continue
    fi
  fi
  [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue

  if [ ! -f "$script" ]; then
    printf '%-24s %-8s %s\n' "$label" "MISSING" "$script does not exist"
    missing=$((missing+1)); FAILED+=("$label (missing)"); continue
  fi

  if [ "$RLS_OK" -eq 0 ] && [[ " $ISOLATION_DRIVES " == *" $label "* ]]; then
    printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "RLS posture wrong — an isolation verdict here would be meaningless"
    cantrun=$((cantrun+1)); FAILED+=("$label"); continue
  fi

  if [ "$OFFICE_OK" -eq 0 ] && [[ " $OFFICE_DRIVES " == *" $label "* ]]; then
    printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "no LibreOffice Impress filter — nothing independent to measure against"
    cantrun=$((cantrun+1)); FAILED+=("$label"); continue
  fi

  log="$OUT/$label.log"
  # Hand this drive the connection its job needs (see SCENARIO_DRIVES above).
  drive_db="$DATABASE_URL"
  if [[ " $SCENARIO_DRIVES " == *" $label "* ]]; then drive_db="$DATABASE_URL_OWNER"; fi
  if [[ "$script" == *.mts ]]; then
    DATABASE_URL="$drive_db" timeout 900 node --import tsx "$script" $drive_args > "$log" 2>&1
  elif [[ "$script" == *.py ]]; then
    # The pipeline's own guards live in Python and were therefore run by hand — the exact failure
    # mode this file's header names. `python3` directly, never the `pytest` on PATH: that is a uv
    # tool that cannot see asyncpg and collapses into 66 collection errors that read as a broken
    # suite (CLAUDE.md, the pipeline-test note). The DRIVES entry carries the `../` itself so the
    # existence check above sees the same path this line runs.
    DATABASE_URL="$drive_db" PYTHONPATH="$(pwd)/../pipeline/src" \
      timeout 900 python3 "$script" $drive_args > "$log" 2>&1
  else
    DATABASE_URL="$drive_db" timeout 900 node "$script" $drive_args > "$log" 2>&1
  fi
  code=$?

  # EXIT 2 MEANS "COULD NOT RUN", AND THAT IS NOT THE SAME AS A FINDING.
  #
  # A drive that cannot authenticate, or cannot find the fixture it needs, measures nothing — and
  # a logged-out browser gets 401 on every route, which reads exactly like a deny-all. Collapsing
  # the two is how `drive-rls-app` came to print "a DENY-ALL surfaced" having never logged in
  # (docs/E2E_SWEEP_2026-08-23.md §3). Both still count against the suite — uncovered is not
  # passing — but the table says which is which, because they need different fixes.
  if [ $code -eq 0 ]; then
    printf '%-24s %-8s %s\n' "$label" "pass" "$(wc -l < "$log") log lines"
    pass=$((pass+1))
  elif [ $code -eq 2 ]; then
    why=$(grep -A1 'CANNOT RUN' "$log" | tail -1 | sed 's/^ *//' | cut -c1-92)
    printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "${why:-exit 2, no reason given}"
    cantrun=$((cantrun+1)); FAILED+=("$label")
  else
    last=$(grep -vE '^\s*(at |$)' "$log" | tail -1 | cut -c1-96)
    printf '%-24s %-8s %s\n' "$label" "FAIL($code)" "$last"
    fail=$((fail+1)); FAILED+=("$label")
  fi
done

echo
echo "── ${pass} passed · ${fail} failed · ${cantrun} could-not-run · ${missing} missing ──"
echo "   (could-not-run measured NOTHING — it is uncovered, not passing, and not a finding)"
if [ "${INVARIANT_VIOLATION:-0}" -ne 0 ]; then
  echo "   ✗ CROSS-TENANT REFERENCES were found by the preflight — see $OUT/tenant-invariant.log"
  echo "     Every drive above may be green and the box is still in violation. This fails the run."
fi
if [ "${PARITY_VIOLATION:-0}" -ne 0 ]; then
  echo "   ✗ SCORER PARITY BROKEN — see $OUT/scorer-parity.log"
  echo "     A card's score depends on which runtime scored it last. This fails the run."
fi
# Decide on the COUNTERS, not on the array — an empty array expansion is exactly what tripped
# `set -u` here and made a fully green run exit with a shell error.
if [ $((fail + cantrun + missing + ${INVARIANT_VIOLATION:-0} + ${PARITY_VIOLATION:-0})) -gt 0 ]; then
  echo "logs for the failures:"
  for f in ${FAILED[@]+"${FAILED[@]}"}; do echo "  $OUT/${f%% *}.log"; done
  exit 1
fi
exit 0
