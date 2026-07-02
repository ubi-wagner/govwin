# HITL Test Plan — Ingest → Download (RFP-admin, solo)

A click-by-click, human-in-the-loop walkthrough of the greenfield pipeline, run entirely
as an RFP admin operating a customer tenant as a shadow admin. `⛱` marks a human-in-the-loop
gate (you decide / approve / accept).

## Preconditions
- **Deploy is green** — merge the `.dockerignore` fix (`scripts/*` + `!scripts/seed_dev_accounts.mjs`) into `main`, or deploy the feature branch. Without it the Docker build fails on the seed COPY.
- **At least one active tenant** exists to shadow into.
- *Optional:* `ANTHROPIC_API_KEY` set on the **web** service → real AI drafts. Without it, drafting still runs but inserts **placeholder** nodes (the flow is fully testable either way).
- **Login as** your RFP admin (`master_admin` / `rfp_admin`) → lands on `/admin/dashboard`.

---

## Phase A — Ingest → Curate → Release (master opportunities)

1. **Intake.** `/admin/intake`. Fill Title + Agency + Program + Close date (POC/URL optional). **"Stage into review queue."**
   - ✅ Green "Staged ✓". *(Metadata only — the PDF + matrix come next.)*
2. **Open curation.** Click **"Curate it →"** (or `/admin/rfp-curation`) and open the new solicitation.
3. `⛱` **Claim** → **Start curation.**  ✅ `new → claimed → curation_in_progress`.
4. **Upload the RFP PDF**, atomize/annotate, and **build the matrix**: volumes → required items per volume → attach a template per item (optional) → tag compliance variables.  ✅ Matrix panel shows volumes + items.
5. `⛱` **Request Review.**  ✅ `→ review_requested`.
6. `⛱` **Approve.**  ✅ `→ approved`. *(Single-admin self-approve works — no second account needed.)*
7. `⛱` **Push.**  ✅ `→ pushed_to_pipeline`; opp goes live and fans out to tenants.

## Phase B — Verify the master cockpit
8. `/admin/cards` (Admin → Opportunities → **Opportunity Cards**).
   - ✅ Row shows curation **pushed_to_pipeline**, Matrix (N vol / M items), Bridge **v1 · published**, **Replicated: N tenants**. Auto-refreshes every 30s.

## Phase C — Shadow into a tenant → bucket → rank → pin
9. `/admin/tenants` → click your test tenant → lands in `/portal/<slug>/dashboard` (admin bypass; full manage rights).
10. Sidebar → **Buckets** (`/portal/<slug>/buckets`). Create a bucket (name + a matching keyword/agency/program). **"Rank →".**  ✅ Opportunity appears ranked with a score.
    - *(Optional: run Phase A for a 2nd RFP, return, **Rank →** again to see re-rank.)*
11. Sidebar → **Opportunities** (`/portal/<slug>/cards`). On the target card: **"Pin (copy docs)"**, then **"Build →".**  ✅ Pinned badge; taken to Builds with the opp pre-filled.

## Phase D — Open the no-pay portal → provision the proposal
12. **Builds** (`/portal/<slug>/portals`): set a **Label** (e.g. `primary`) → **"Open portal."**  ✅ Portal appears **guardrails pending**. *(No Stripe — no-pay path.)*
13. `⛱` **"Accept guardrails & launch."**  ✅ **Provisions the real proposal** (volumes→artifacts, items→sections, templates seeded) + launches the workflow. An **"Open build →"** link appears.

## Phase E — Draft (V0) → Revise (V1) → Review
14. **"Open build →"** → canvas at `/portal/<slug>/proposals/<proposalId>`.
15. **V0 strawman:** click **"Draft all sections."**  ✅ Sections fill (real prose if key set; placeholders if not).
16. `⛱` **V1 revise:** open a section, select a node, use the **AI-revise** panel with an instruction. Repeat where it matters.
17. *(Optional)* `⛱` **AI review:** trigger a quality/compliance pass; read the advisory feedback.

## Phase F — Lock → Advance → Download
18. `⛱` In **Stage Control**: **Lock** each finished section (advancing is gated on locked sections).
19. `⛱` **Advance stage** until the final gate. *(If blocked, the bar names the unlocked sections.)*
20. `⛱` **Lock the proposal** (required before packaging).
21. **Download.** **Export / Download (.docx)** → `package?format=docx` → a Word doc of all sections.
    - ✅ `.docx` downloads. *(Alternative: per-section Export → `.docx/.pptx/.xlsx`.)*

---

## Two things to know while testing
- **Two independent stage tracks.** *Proposal* stages (draft→final, Stage Control in the canvas — the one that leads to Download) are separate from the *portal* workflow stages on the Builds page (the collaboration/ToDo wrapper). For a solo run, drive the proposal track to get the download; the portal "Advance stage" ToDos are the collaboration layer.
- **No agent fleet / pipeline worker needed.** Every AI step here (Draft-all, revise, review) is a button that runs in the web app. The autonomous worker only *auto-fires* the V0 draft — replaced here by the "Draft all sections" click.
