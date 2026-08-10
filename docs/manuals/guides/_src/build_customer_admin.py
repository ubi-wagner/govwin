#!/usr/bin/env python3
"""Authoring source for the Customer-Admin Proposal-Build Guide.
Emits docs/manuals/guides/customer-admin.json. Grounded in the live customer portal
(every label/modal/node-type/endpoint verified against the code + captured screenshots)."""
import json, os

OUT = "/home/user/govwin/docs/manuals/guides/customer-admin.json"
TS = "docs/manuals/img/shots/tenant/"
TC = "docs/manuals/img/crops/tenant/"
FAITH = "docs/proposals/immobileyes-cuas/img/faithful/"
PROP = "docs/proposals/immobileyes-cuas/img/"
DELIV = "docs/manuals/img/deliverable/"

def S(t, img=None, cap=None, w="half"):
    d = {"t": t}
    if img: d["img"] = img; d["cap"] = cap or ""; d["w"] = w
    return d
def F(img, cap="", w="full"): return {"img": img, "cap": cap, "w": w}

SECTIONS = []
def sec(**k): SECTIONS.append(k)

# ── 1. Orientation ────────────────────────────────────────────────────────────
sec(id="orientation", toc="1 · Your portal", heading="Your portal — orientation",
    where="/portal/<company>/dashboard",
    lead="<p>Welcome to your company’s proposal portal. This guide walks every feature you have as a "
         "<b>Customer Admin</b>, in the order you use them — from a ranked opportunity to a submission-ready, downloadable "
         "proposal. Sign in with the credentials your RFP-Pipeline admin issued; you land on your <b>Dashboard</b>.</p>",
    img=TS+"dashboard.png", caption="The customer portal — your workspace, ToDos, and quick actions.",
    subs=[
      {"id":"chrome","heading":"The sidebar & global chrome","toc":"1.1 · Sidebar & chrome",
       "lead":"<p>The left sidebar is your map. It shows your company name, a notification bell, and your name up top; "
         "every workspace below.</p>",
       "figures":[F(TC+"nav-sidebar.png","Your portal sidebar.","third")],
       "table":{"title":"Sidebar map","headers":["Label","Route","What it is"],"rows":[
         ["Dashboard","/dashboard","home — stats, ToDos, quick actions"],
         ["Opportunities","/cards","your ranked opportunity pipeline"],
         ["Buckets","/buckets","your scoring lenses"],
         ["Library","/atoms","your content atoms"],
         ["Builds","/portals","your purchased proposal portals"],
         ["Proposals","/proposals","your proposals"],
         ["Processes","/processes","your running automations"],
         ["Activity","/activity","your audit timeline"],
         ["Team","/team","members & collaborators"],
         ["Documents","/documents","every document in the workspace"],
         ["Billing","/billing","subscription & purchases"],
         ["AI Usage","/agents","your agent usage & budget"],
         ["Automation","/automation","your automation preferences"],
         ["Settings","/profile","your company profile"]]},
       "callouts":[{"kind":"note","html":"The <b>notification bell</b> polls every 60s and badges unread (or <b>9+</b>). Open it "
         "and hit <b>Mark all read</b> to clear the badge — your read position is remembered per-user, so a teammate’s reading "
         "doesn’t clear yours. If an RFP admin is working inside your company on your behalf, an amber <b>shadow-admin banner</b> "
         "shows at the top — everything they do is logged to your audit trail."}]},
    ])

# ── 2. Dashboard ──────────────────────────────────────────────────────────────
sec(id="dashboard", toc="2 · Dashboard", heading="The Dashboard — home base",
    where="/portal/<company>/dashboard",
    lead="<p>Your dashboard is role-aware: quick stats, your ToDo queue, an <b>Add content</b> dropzone, a getting-started "
         "checklist, and recent activity.</p>",
    steps=[
      S("Check the <b>three stat cards</b> (Library Units · Active Proposals · Pinned Topics) — each links to its screen."),
      S("Work <b>Your To-Dos</b>. Each card shows an urgency chip, a workflow pill, a step trail, and a typed action "
        "(Acknowledge / Approve-Done / Open-to-upload / a form).",
        TC+"dash-todos.png","The ToDo queue on your dashboard.","half"),
      S("Drop a file on <b>Add content</b> to upload &amp; atomize it straight into your library."),
      S("Tick off the <b>Get Started</b> checklist (upload docs · set up profile · create a bucket · purchase a portal).",
        TC+"dash-getstarted.png","The getting-started checklist + recent activity.","full"),
    ],
    callouts=[{"kind":"tip","html":"A <b>trial banner</b> appears if your trial is ending — it turns red within 7 days and "
      "links to Billing so you keep your data."}])

# ── 3. Opportunities (cards) ──────────────────────────────────────────────────
sec(id="cards", toc="3 · Opportunities", heading="Opportunities — your ranked pipeline",
    where="/portal/<company>/cards",
    lead="<p>The <b>Opportunity Pipeline</b> is every opportunity the platform has released to you, ranked by your Spotlight "
         "buckets. Pin one to pull its documents into your workspace, then purchase a build.</p>",
    img=TS+"cards.png", caption="The opportunity pipeline — ranked cards with pin, purchase, and build actions.",
    steps=[
      S("Toggle <b>Include closed</b> to widen the list; <b>Refresh</b> re-pulls; the count shows how many cards you have."),
      S("Read a card: title, a <b>submission-stage badge</b> (NOFO / Pre-Release / Updated / Closed / Archived), agency, "
        "program type, and the close date.",
        TC+"card-actions.png","A card’s stage badge and actions.","half"),
      S("<b>Pin (copy docs)</b> copies the solicitation’s documents into your workspace; a pinned card then shows "
        "<b>Unpin</b> and a green <b>Purchase</b>. <b>Build →</b> opens the build page. An <b>Update available</b> strip "
        "offers <b>Resync</b> when the RFP changes."),
    ],
    subs=[
      {"id":"purchase","heading":"Purchasing a proposal workspace","toc":"3.1 · Purchase modal",
       "lead":"<p>The green <b>Purchase</b> button opens the purchase modal.</p>",
       "img":TS+"card-detail.png","caption":"An opportunity’s detail view.",
       "figures":[F(TC+"card-detail-tabs.png","The card detail — Overview / Origin / Compliance tabs.","full")],
       "steps":[
         S("The offer is a one-time <b>expert-curated proposal build</b>. <b>Pay by card</b> runs Stripe checkout, or use an "
           "<b>Access / discount code</b>."),
         S("Enter your comp code (e.g. <code>rfppipelinetest</code>) and <b>Complete purchase</b>. The build opens in "
           "<code>curation_pending</code> — an RFP admin then releases it (72h SLA), provisioning your matrix and molds."),
       ],
       "callouts":[{"kind":"eg","html":"In the verified run, the NAVAIR/NAVSEA C-UAS topic <b>DON26BX03-NP002</b> ranked "
         "<b>#1</b> for Immobileyes — the best fit for a counter-drone optics company."}]},
    ])

# ── 4. Buckets ────────────────────────────────────────────────────────────────
sec(id="buckets", toc="4 · Buckets", heading="Buckets — your scoring lenses",
    where="/portal/<company>/buckets",
    lead="<p>Spotlight <b>buckets</b> are your scoring criteria — the themes you care about. Each bucket ranks the whole "
         "pipeline by your rules, and editing one re-ranks your Opportunities automatically.</p>",
    img=TS+"buckets.png", caption="Spotlight buckets — define a lens, then rank the pipeline by it.",
    steps=[
      S("In <b>New bucket</b>, set a Name plus any of keywords, agencies, program types, and NAICS codes; tick "
        "<b>Include closed opportunities</b> if you want them scored. Click <b>Create</b>.",
        TC+"bucket-add.png","Creating a scoring bucket.","half"),
      S("Click <b>Rank →</b> on a bucket to see your pipeline ordered <b>#1, #2, …</b> with each opportunity’s score and "
        "per-factor chips (e.g. <code>keyword 3</code>).",
        TC+"bucket-first.png","A bucket with its Rank control.","half"),
      S("Delete a bucket with its <b>✕</b>. Ranking is deterministic today; an optional scoring agent overlays it later."),
    ])

# ── 5. Library / atoms (BIG) ──────────────────────────────────────────────────
sec(id="library", toc="5 · Library & atoms", heading="Library — build your content atoms",
    where="/portal/<company>/atoms",
    lead="<p>Your library is the raw material every draft is built from. You deconstruct your documents into tagged, sized "
         "<b>atoms</b>, then compose and reuse them. The page has three tabs — <b>Library</b>, <b>Upload package</b>, "
         "<b>Atomize</b> — plus a reuse-a-past-proposal panel.</p>",
    img=TS+"library-atoms.png", caption="The library — tagged atoms with grain, usage, lineage, and visibility.",
    subs=[
      {"id":"lib-foundations","heading":"Create a canvas · start from a template · downloads","toc":"5.0 · Create canvas & starter templates",
       "lead":"<p>Beyond hand-shredding, you can <b>create a canvas</b> — a <b>foundation artifact</b> (a whole doc / deck / sheet / "
         "PDF) that decomposes on save into reusable section / group / atom grains — and copy in ready-made <b>starter "
         "templates</b>.</p>",
       "steps":[
         S("Click <b>Create canvas</b>. The <b>Blank</b> tab mints a foundation from a form (Document · Deck · Sheet · PDF) "
           "with a kind × context taxonomy, and opens straight in the canvas editor.",
           TC+"create-canvas-blank.png","Create canvas — a blank foundation by form + taxonomy.","half"),
         S("The <b>Start from a template</b> tab lists the shared starter catalog — capability statement, one-pager, "
           "SBIR/STTR technical &amp; cost volumes, DoW CSO brief, commercialization deck. <b>Use</b> copies one into your "
           "library as your own editable canvas (with lineage back to the original).",
           TC+"create-canvas-templates.png","Start from a template — the starter catalog, copy-on-use.","half"),
         S("When your library is empty, the <b>starter offer</b> appears at the top — <b>Add all N</b> bulk-copies the whole "
           "starter set in one click (idempotent; addable anytime).",
           TC+"library-starter-affordance.png","The starter-set offer on an empty library.","half"),
         S("<b>Browse library</b> filters foundations / sections / groups / atoms by kind × form × context × vehicle (facet "
           "counts update live), and every row offers a native-format <b>download</b> (.docx · .pptx · .xlsx · .pdf).",
           TC+"library-browse.png","The faceted library browser with per-row downloads.","full"),
       ],
       "callouts":[{"kind":"note","html":"<b>Collaboration vaults (nooks)</b> — a customer-owned, RLS-segregated branch library "
         "per external partner — are provisioned server-side (create · invite · upload/atomize · download-whole · ingest, with "
         "the isolation contract adversarially proven). The two-sided nook UI ships next.","w":"full"}]},
      {"id":"lib-browse","heading":"Browse, filter & compose","toc":"5.1 · Browse & compose",
       "steps":[
         S("Filter with the search box, the <b>grain</b> select (primitive / group / foundational), the status select, and "
           "a <b>My atoms / All atoms</b> toggle. Click a tag chip to filter by it.",
           TC+"atom-filters.png","The library filter bar.","half"),
         S("Select atoms with their checkboxes to reveal the <b>bulk bar</b>: <b>Approve all</b>, <b>Archive all</b>, and a "
           "tag-dimension + value → <b>Tag all</b>.",
           TC+"atom-compose-bar.png","The bulk / compose bar appears on selection.","half"),
         S("With two or more selected, name the group (e.g. “Team for Navy”) and <b>Group into new atom</b> to compose a "
           "reusable bundle.",
           FAITH+"31-library-group-created.png","Composing primitives into a group.","half"),
         S("Click an atom title to open its <b>detail drawer</b> — confirmed vs unconfirmed tags, lineage "
           "(↖ derived from / ↳ reused in), and a content preview.",
           TC+"atoms-rows.png","Real library atoms — grain, tags, usage, source badges, and lineage.","full"),
       ],
       "table":{"title":"Atom vocabulary","headers":["Facet","Values"],"rows":[
         ["Grain","primitive (one block) · group (a bundle) · foundational (a whole reference doc)"],
         ["Source","uploaded · returned (harvested back from a locked section)"],
         ["Visibility","private · admin-only · shared"],
         ["Status","draft · approved · archived"]]}},
      {"id":"lib-upload","heading":"Upload a package (bulk atomize)","toc":"5.2 · Upload package",
       "lead":"<p>The fastest way to fill the library: drop a whole proposal package and let the atomizer shred it.</p>",
       "steps":[
         S("On <b>Upload package</b>, drop up to 12 files (PDF·DOCX·PPTX·XLSX·TXT·MD) or <b>Choose files</b>.",
           TC+"atom-upload.png","The upload-package control.","half"),
         S("Add optional <b>Package context</b> (name, agency, program, phase, solicitation, topic) — it’s stamped on every "
           "atom minted from the package."),
         S("Click <b>Atomize package</b>. Each file becomes a <b>reference atom</b> plus one <b>primitive</b> per "
           "substantive block, auto-tagged against the taxonomy."),
       ],
       "callouts":[{"kind":"eg","html":"Verified: five Immobileyes documents atomized into <b>24 atoms</b> — tagged "
         "<span class='tag'>vol:technical</span> <span class='tag'>vol:cost</span> <span class='tag'>vol:key_personnel</span> "
         "<span class='tag'>kind:bio</span> and more.","w":"full"}],
       "figures":[F(FAITH+"A-atoms-real-atomizer.png","The real atomizer — 24 tagged atoms from five documents.","full")]},
      {"id":"lib-atomize","heading":"Atomize — the hand-shredder","toc":"5.3 · Atomize (box & tag)",
       "lead":"<p>The <b>Atomize</b> tab is precision control: paste or upload a document, and box exactly what becomes an "
         "atom.</p>",
       "steps":[
         S("Paste text (a bio, a past-performance blurb, a whole team section) and <b>Deconstruct</b>, or upload a file. "
           "The document becomes a list of typed objects (figure / table / list / heading / text)."),
         S("Set the <b>Session context</b> (the “FROM” pedigree — agency, program, phase, solicitation, topic) so everything "
           "minted this session inherits it."),
         S("Select an object, give it a title, add curated + free tags, and <b>Make atom</b> (or <b>Make group</b> for a "
           "table/list). Minted atoms collect in the <b>Section tray</b>."),
         S("Select several tray items, name it, and <b>Box section</b> to wrap them into a section group."),
       ]},
      {"id":"lib-reuse","heading":"Reuse a past proposal (templify)","toc":"5.4 · Reuse a past proposal",
       "body":"<p>At the top of the page, <b>Reuse a past proposal</b> lists your uploaded proposals. <b>Save as template</b> "
         "extracts a proposal’s structure into a reusable skeleton (pick a template type → <b>Extract structure</b>); once "
         "templated, <b>New draft</b> spins up a fresh document from that skeleton. This is how a winning structure becomes "
         "the starting point for the next bid.</p>"},
      {"id":"lib-capture","heading":"Capture from screen (box → tag → atomize)","toc":"5.5 · Capture from screen",
       "lead":"<p>The <b>Capture</b> tab pulls content from anywhere on your screen — a Google Doc, a data sheet, a web "
         "page — <b>without connecting an account</b>. It’s the box-and-tag Atomize flow applied to a screenshot.</p>",
       "img":TC+"capture-tab.png","caption":"The Capture tab — grab from any window/tab/screen, one-way in.",
       "steps":[
         S("Click <b>▣ Capture from screen</b> and pick a window, tab, or screen. The frame freezes on the canvas and the "
           "screen-share stops immediately — no lingering access."),
         S("<b>Drag boxes</b> over the parts worth keeping. Give each region a title and tag it with the same vocabulary as "
           "the Atomize tab (<span class='tag'>vol</span> <span class='tag'>kind</span> <span class='tag'>fmt</span> …); "
           "add a source URL + note for provenance."),
         S("Optionally name a <b>section</b> to group the regions, then <b>Atomize N region(s) → library</b>. Each region "
           "becomes a <b>draft image atom</b> (anchored to a reference of the whole frame), ready to review and insert into a "
           "section canvas."),
       ],
       "callouts":[{"kind":"note","html":"<b>One-way by design:</b> only the crops you send ever leave your screen — the "
         "platform never receives your Google/social credentials and holds no connection back to the source. Captures land as "
         "<b>draft</b> atoms with a <i>“Screen capture from &lt;host&gt; · &lt;time&gt;”</i> provenance stamp."},
         {"kind":"tip","html":"Verified end-to-end: a captured frame boxed into two regions produced a reference atom + two "
           "tagged region atoms + a section group — all draft, provenance-stamped, insertable into the canvas."}]},
      {"id":"lib-archive","heading":"Archive an atom (retire it from selection)","toc":"5.6 · Archive an atom",
       "lead":"<p>Retire an atom you no longer want offered — a stale bio, a superseded past-performance blurb — by "
         "<b>archiving</b> it. Archiving is soft: the atom stays in indexed storage, it just stops appearing.</p>",
       "steps":[
         S("On an atom, choose <b>Archive</b>. It drops out of the library browse <i>and</i> out of the draft-selection lists everywhere — it can’t be picked into a section until you unarchive it."),
         S("Atoms are <b>copied forward</b> into any proposal that already used them, so archiving one <b>breaks nothing downstream</b> — locked and drafted sections keep their copy."),
         S("<b>Restore</b> re-enables the atom for selection at any time."),
       ],
       "callouts":[{"kind":"note","html":"Archiving an atom only changes what’s <i>selectable</i> — it never deletes content and "
         "never touches a proposal that already used it. (Foundational documents archive the same way.)"}]},
    ])

# ── 6. Proposals list ─────────────────────────────────────────────────────────
sec(id="proposals", toc="6 · Proposals list", heading="Proposals — your builds",
    where="/portal/<company>/proposals",
    lead="<p>Every proposal for your company. Proposals aren’t created here — they appear when you purchase a topic and an "
         "RFP admin releases it.</p>",
    img=TS+"proposals.png", caption="The proposals list — each row opens its build workspace.",
    steps=[
      S("Each row shows the title, agency, topic, section count, created date, a due/closed date (red if overdue), and a "
        "<b>stage pill</b> in the customer V0.5 → V1 labels."),
      S("Click a row to open its build workspace (the compliance matrix).",
        TC+"proposal-row.png","A proposal row — stage pill, section count, and dates.","full"),
    ],
    table={"title":"Proposal stages (what the pill means)","headers":["Pill","Meaning"],"rows":[
      ["V0.5 · Draft","building — sections being drafted"],["V0.5 · Review","in internal review"],
      ["V1 · Final","locked & ready to submit"],["V1 · Submitted","submitted to the agency"],
      ["Archived","closed out — moved to the Archived list, still retrievable"]]},
    subs=[
      {"id":"archive-portal","heading":"Archive a portal — and restore it","toc":"6.1 · Archive & restore",
       "lead":"<p>When a build is finished — won, lost, or shelved — <b>archive the whole portal</b> to clear it from your active "
         "list. Archiving is <b>soft and reversible</b>: nothing is ever deleted here.</p>",
       "steps":[
         S("Open the proposal and click <b>Archive portal</b>. Confirm — the portal <i>and its running workflows</i> move to the "
           "Archived list together (its automations stop; they’ll resume if you restore)."),
         S("At the bottom of the proposals list, expand <b>Archived (N)</b> to see archived builds. Each still opens and still "
           "<b>Export</b>s (as a .zip package)."),
         S("An admin can <b>Restore</b> an archived portal back to the active list at any time — its workflows come back with it."),
       ],
       "callouts":[{"kind":"note","html":"Nothing is deleted — archived builds stay retrievable. After your retention window they’re "
         "flagged <b>cold-storage eligible</b> (a future sweep bulk-moves them to long-term storage, still pointer-retrievable)."}]},
    ])

# ── 7. Proposal workspace / matrix (BIG) ──────────────────────────────────────
sec(id="matrix", toc="7 · Proposal workspace", heading="The proposal workspace & compliance matrix",
    where="/portal/<company>/proposals/<id>",
    lead="<p>Opening a proposal gives you the build cockpit: a stage-control bar, the volume/section matrix, team &amp; "
         "access, compliance, AI, and export. As an admin you get the full <b>admin panel</b> (four tabs).</p>",
    img=TS+"matrix.png", caption="The proposal workspace — 6-volume matrix, ready to draft and lock.",
    subs=[
      {"id":"stagebar","heading":"The stage-control bar","toc":"7.1 · Stage control",
       "steps":[
         S("The bar shows <b>stage progress dots</b> for each gate (done ✓ / current / future), the due date, and a "
           "gate-requirements button (<b>N requirement(s) pending</b> or <b>All gates met ✓</b>)."),
         S("The primary action is <b>Advance to {next} →</b>; at Final you get <b>Unlock for Edit</b> / <b>Re-lock</b>. If an "
           "advance is blocked, an amber list names the unlocked sections (admins can <b>Force advance anyway →</b>)."),
       ],
       "callouts":[{"kind":"note","html":"After two proposal locks, further changes require RFP-Pipeline support — the bar "
         "says so. Downloads unlock once the proposal is locked/submitted."}]},
      {"id":"adminpanel","heading":"The admin panel — 4 tabs","toc":"7.2 · Admin panel",
       "lead":"<p>The admin panel is your build console.</p>",
       "table":{"title":"Admin-panel tabs","headers":["Tab","What you do"],"rows":[
         ["Artifacts","volume groups with per-section <b>Accept &amp; Lock</b>, page-fill gauges, <b>Lock Volume</b>, "
          "<b>Download</b> (docx) / <b>PDF</b>, <b>Accept &amp; Lock All</b>, and the whole-proposal export row"],
         ["Team &amp; Access","the <b>TeamManager</b> — invite collaborators, per-section grants, the E/C/V access matrix"],
         ["Compliance","<b>Run Compliance Check</b> (AI), the compliance checklist, and stage-gate requirements"],
         ["AI &amp; Library","<b>Draft with AI</b> across empty sections, and <b>Record Outcome</b> (Won/Lost/Withdrawn)"]]},
       "steps":[
         S("In <b>Artifacts</b>, each section row shows a status pill, assignee, a page-fill bar, and <b>Accept &amp; Lock</b> "
           "(→ 🔒 Unlock). When every section in a volume is locked, the volume reads <b>✓ Volume locked</b> and the "
           "<b>Download</b> + <b>PDF</b> links light up.",
           TC+"matrix-volume.png","A volume group with its lock + download controls.","half"),
         S("The <b>export row</b> — <b>Download Proposal (.docx)</b> and <b>Download all (.zip)</b> — enables once the "
           "proposal is locked.",
           TC+"matrix-export.png","The proposal export controls.","half"),
       ],
       "figures":[F(TC+"matrix-volumes.png","The live matrix — volumes with per-section Accept &amp; Lock, status pills, "
           "and Volume-locked downloads.","full")]},
      {"id":"compliance-team","heading":"Compliance, team & AI tabs","toc":"7.3 · Compliance · Team · AI",
       "lead":"<p>The other three admin-panel tabs run your review, your people, and your AI.</p>",
       "steps":[
         S("<b>Compliance tab</b> — <b>Run Compliance Check</b> fires an AI pass that scores your proposal against the "
           "solicitation’s requirements (pass/fail/partial per variable). Below it, the <b>Compliance Checklist</b> and the "
           "<b>Stage Gate Requirements</b> (add a gate with a stage + label, toggle each met)."),
         S("<b>Team &amp; Access tab</b> — the <b>TeamManager</b>: <b>+ Invite</b> a collaborator (email, name, role, "
           "permission, and the sections to assign), then read the <b>Access Matrix</b> (sections × people, E/C/V cells)."),
         S("<b>AI &amp; Library tab</b> — <b>Draft with AI</b> queues a draft for every empty section; <b>Record Outcome</b> "
           "(Won/Lost/Withdrawn, once submitted) feeds the result back into your library so winning content ranks higher next time."),
       ],
       "callouts":[{"kind":"tip","html":"Invite grants are <b>per section</b> and <b>per permission</b> (view / comment / "
         "edit). A collaborator only ever sees the sections you assign — see the Collaborator guide for the full picture."},
         {"kind":"note","html":"<b>AI &amp; Library</b> also hosts <b>Research this opportunity</b> — the R&D scout (see 7.5)."}]},
      {"id":"studio","heading":"Proposal Studio — the guided 3-loop draft","toc":"7.4 · Proposal Studio",
       "lead":"<p><b>Proposal Studio</b> is the recommended way to draft. It runs your proposal through three gated loops — "
         "<b>Draft → Refine → Compliance</b> — and stops at each gate for your review before moving on. Advisory throughout: "
         "drafts land in review, and the Studio never locks or submits for you.</p>",
       "table":{"title":"The three loops","headers":["Loop","What it does"],"rows":[
         ["1 · Draft","Plans from the skeleton + compliance matrix, then drafts every section from your library atoms."],
         ["2 · Refine","Reformats + restyles to one house style, runs the cost model, and assembles the package."],
         ["3 · Compliance","Checks requirement coverage, section-to-section continuity, and a redaction scan."]]},
       "steps":[
         S("Click <b>Start</b> on the current loop. The agent cohort runs — you can watch it; the gate opens automatically when the loop finishes."),
         S("At the gate, <b>Preview</b> the document, then either type comments and <b>Regenerate</b> (your comments steer the re-run as guidance), or <b>Approve → next</b> to advance to the next loop."),
         S("Prefer hands-off? <b>Run all 3 automatically</b> chains the loops end-to-end (the same path the admin “doorbell” uses) and still lands in review."),
       ],
       "callouts":[{"kind":"tip","html":"Studio is advisory — every draft is redlined and reversible, and no loop ever advances a "
         "stage gate, locks, or submits. You stay in control at each gate."}]},
      {"id":"ai-actions","heading":"AI Actions & the full-draft manager","toc":"7.7 · AI Actions & full draft",
       "lead":"<p>Below the Studio, the <b>AI Actions</b> and <b>Run full draft</b> cards give you direct, single-pass AI controls "
         "for when you want them.</p>",
       "steps":[
         S("<b>Draft with AI</b> — queues a first draft for every <i>empty</i> section."),
         S("<b>AI Review</b> — runs an AI <b>color-team</b> pass; each section’s recommendations post into that section’s comment thread for you to accept or ignore."),
         S("<b>Run full draft</b> (Advanced) — one full-pass draft across the whole proposal. Pick a <b>Mode</b>: <b>A · HITL + AI</b> "
           "(you drive section-by-section), <b>B · Restyle</b> (reformat to one house style), or <b>C · Full auto</b> (auto-draft across "
           "volumes + a review-gate pass). Optionally set a <b>Voice</b> (persuasive / technical / …). Mode C can add an "
           "<b>Adversarial gate</b> — a directed 1:n review pass landing as either a <b>Human review</b> task or <b>Auto-reconcile</b>."),
       ],
       "callouts":[{"kind":"note","html":"Every AI output — Studio, Draft, AI Review, or full draft — <b>lands in review</b>, redlined "
         "and reversible. AI never advances a gate, locks, or submits on its own."}]},
      {"id":"amendments","heading":"Amendments — a solicitation change to acknowledge","toc":"7.8 · Amendments",
       "lead":"<p>If the agency amends the solicitation after your build started, an RFP admin logs the change and it fans out to "
         "your proposal. You’ll see an amber <b>“This solicitation was amended”</b> banner at the top of the workspace.</p>",
       "steps":[
         S("Read the banner: each change carries a <b>severity</b> chip (critical / major / minor / info) and a short summary."),
         S("Click <b>Show N compliance changes</b> to expand the exact delta — the added / removed / changed requirements."),
         S("An admin clicks <b>Acknowledge</b> to clear the banner for your team. (Contributors see the banner but can’t acknowledge — “An admin must acknowledge these changes.”)"),
       ],
       "callouts":[{"kind":"warn","html":"Acknowledging records that your team <i>saw</i> the change — it does <b>not</b> auto-edit "
         "your proposal. Re-check the affected sections and your compliance matrix against the new requirements."}]},
      {"id":"research","heading":"Research this opportunity (R&D scout)","toc":"7.5 · Research this opportunity",
       "lead":"<p>In the <b>AI &amp; Library</b> tab, the <b>Research Scout</b> does your R&D — market research, prior art, "
         "and the competitor landscape, including DoD sources (SAM.gov, SBIR.gov, DSIP) — and returns a <b>cited brief</b>.</p>",
       "img":TC+"research-scout.png","caption":"Research this opportunity — the R&D scout, in the AI & Library tab.",
       "steps":[
         S("Type (or refine) the research question, then click <b>🔎 Research this opportunity</b>. The scout runs in the "
           "background: it browses the web through a controlled server-side browser, then synthesizes the findings."),
         S("When it finishes, the <b>cited brief</b> appears inline — findings with <b>[source]</b> links and confidence, "
           "plus the competitor list. It’s <b>advisory</b>: review it and pull the useful bits into your Library / sections; "
           "it never changes your proposal by itself."),
       ],
       "callouts":[{"kind":"note","html":"<b>Safe by design:</b> every page the scout reads is treated as <b>untrusted "
         "data</b> (never instructions), the run is <b>budget/rate-capped</b> (usage shows in AI Usage), and it <b>safe-skips</b> "
         "— returning no sources rather than inventing them — if web access is unavailable. Use more, get more."}]},
      {"id":"opp-card","heading":"Opportunity origin & compliance","toc":"7.6 · Origin & compliance",
       "body":"<p>The collapsible <b>Opportunity origin &amp; compliance</b> card has three tabs — <b>Overview</b> "
         "(build stage, lock count, deadlines), <b>Origin</b> (frozen-at-purchase: opportunity, agency, program, topic #, "
         "solicitation #, bought-from bucket), and <b>Compliance</b> (a live “{x}/{y} mandatory satisfied — {pct}%” bar and a "
         "Satisfied / Partial / Not-addressed / N-A grid). It’s your at-a-glance readiness read.</p>"},
    ])

# ── 8. Canvas editor (HUGE) ───────────────────────────────────────────────────
sec(id="canvas", toc="8 · The canvas editor", heading="The section canvas — where you write",
    where="/portal/<company>/proposals/<id>/sections/<sectionId>",
    lead="<p>The canvas is the WYSIWYG editor for one section — <b>what you see is what exports</b>. Open a section from the "
         "matrix. The top bar carries the title, a status pill, export buttons, Undo/Redo, <b>+ From Library</b>, "
         "<b>Save</b>, and (admins) <b>Complete &amp; Lock</b>.</p>",
    img=TS+"canvas.png", caption="The canvas editor — toolbar, page canvas, and the toolbox sidebar.",
    subs=[
      {"id":"canvas-toolbar","heading":"The formatting toolbar & node types","toc":"8.1 · Toolbar & nodes",
       "steps":[
         S("The <b>INSERT</b> group adds a block after the selected one; the <b>FORMAT</b> group (B / I / align / size / "
           "color) acts on the selected text block.",
           TC+"canvas-toolbar.png","The canvas formatting toolbar.","full"),
         S("Click any node to edit it in place; drag the handle to reorder. Each node type has its own inline editor."),
       ],
       "table":{"title":"Canvas node types","headers":["Node","Inline editing"],"rows":[
         ["Heading","level (H1/H2/H3), numbering, text"],
         ["Text block","textarea + B / I / U / superscript / subscript mini-toolbar"],
         ["Bulleted / Numbered list","per-item text, indent/outdent, add/remove item"],
         ["Image","click-to-upload, alt text, caption, size, replace"],
         ["Table","editable headers/cells, + Row / + Column, delete"],
         ["Caption","prefix (Figure/Table/Chart), number, text"],
         ["Footnote / URL","marker + text / href + display text"],
         ["TOC","auto-lists the document’s headings"],
         ["Page break / Spacer","structural"]]}},
      {"id":"canvas-sidebar","heading":"The toolbox sidebar","toc":"8.2 · Toolbox tabs",
       "lead":"<p>The sidebar opens on <b>Your toolbox</b> — a prioritized card list resolved from your role and the stage — "
         "then offers tabs.</p>",
       "table":{"title":"Sidebar tabs","headers":["Tab","Purpose"],"rows":[
         ["Compliance","document status, a real word-budget gauge (“{words}/{max} words · N-page limit”), fonts/margins, "
          "content-source dots (AI / library / manual)"],
         ["Node / Select","the selected block’s provenance + actions (Move, Accept, Revert, Delete, <b>Replace from Library</b>), "
          "a full Format panel, per-node History, Comments, and an <b>AI Revision</b> panel"],
         ["Add","a 12-button grid of every node type"],
         ["Review","“Review · Modify · Lock” — admins get <b>Complete &amp; Lock this section</b>; others save for an admin to lock"],
         ["History","the version list (AI Draft / Human Edit / Library / …) — click any to preview"],
         ["Settings","the floorplan — margins, fonts, line spacing, page/slide limit, header/footer templates"]]},
       "figures":[F(TC+"canvas-toolboxtab.png","The Compliance tab — live word-budget gauge, fonts, and content-source dots.","third")]},
      {"id":"canvas-ai","heading":"Draft & revise with AI","toc":"8.3 · AI drafting",
       "steps":[
         S("Click <b>Draft</b> (or <b>Draft all sections</b> from the admin panel). The drafting agent reads the RFP context "
           "and the section’s mold, pulls the most relevant atoms, and writes canvas content sized to the page budget."),
         S("On a text node, open <b>AI Revision</b> for one-click rewrites: <b>Regenerate · Make shorter · Make longer · "
           "More specific · Simpler language · Stronger opening · Add metrics · Fix compliance</b>, or a custom instruction."),
       ],
       "callouts":[{"kind":"eg","html":"Verified: the <code>proposal.draft_section</code> agent ran on all 8 Technical-Volume "
         "sections, grounded in the atomized library, to a ~1,090-word / 2-page target per section. Nothing auto-commits — "
         "it’s advisory until you accept."}]},
      {"id":"canvas-library","heading":"Insert & replace from the library","toc":"8.4 · From Library",
       "steps":[
         S("<b>+ From Library</b> opens the insert panel: it ranks your atoms for this section (with “✦ N context match(es)”). "
           "Tick atoms and <b>Insert N atom(s) into the canvas</b> — they become section nodes.",
           FAITH+"32-section-insert-panel.png","The insert-from-library panel ranks your atoms for this section.","half"),
         S("The picked atoms flow straight into the canvas as editable nodes.",
           FAITH+"33-section-atoms-inserted.png","Atoms inserted into the section canvas.","half"),
         S("On a selected node, <b>Replace from Library</b> swaps its content for a better-matching atom (sortable by "
           "best-match / most-used / most-recent)."),
         S("Drag nodes to reorder them into the flow you want.",
           FAITH+"34-section-node-reordered.png","Reordering nodes on the canvas.","half"),
       ]},
      {"id":"canvas-atomize","heading":"Harvest back to the library","toc":"8.5 · Atomize rail",
       "body":"<p>The <b>Library (N)</b> button opens the <b>atomize rail</b> — each library-eligible node becomes a bubble you "
         "can classify (choose a type), tag, and <b>Accept as atom</b>, harvesting your best content back into the library for "
         "reuse. <b>Accept all</b> does the batch.</p>"},
      {"id":"canvas-lock","heading":"Accept & Lock","toc":"8.6 · Accept & Lock",
       "steps":[
         S("When a section is right, <b>Complete &amp; Lock</b> (top bar or the Review tab). Locking flips its compliance row "
           "to <b>satisfied</b>, snapshots the version, and harvests reusable content back to your library.",
           TC+"canvas-lock.png","The Accept & Lock control.","half"),
         S("Locked sections are read-only; <b>Unlock</b> reopens one for edits (admins)."),
       ],
       "callouts":[{"kind":"eg","html":"Verified: locking turned <b>10 matrix rows green</b> (8 Technical + 2 Cost); "
         "Volume 2 read “8/8 locked · 9/10 pages · ✓ Volume locked.”"}]},
      {"id":"canvas-slides","heading":"The slide editor","toc":"8.7 · Slide decks",
       "lead":"<p>When the artifact is a <b>slide deck</b>, the same shell becomes the <b>SlideEditor</b>.</p>",
       "steps":[
         S("The left <b>Slides</b> panel is your thumbnail navigator — each thumb shows the slide title and element count; "
           "<b>+ Add Slide</b> appends one (you can’t delete the last)."),
         S("Edit the active slide with the embedded canvas (16:9 or 4:3). The info bar reads “Slide N of M · N element(s).” "
           "Export the deck with <b>Export .pptx</b> from the top bar."),
       ]},
      {"id":"canvas-sheets","heading":"The spreadsheet editor","toc":"8.8 · Spreadsheets",
       "lead":"<p>A <b>spreadsheet</b> artifact (like a Cost Volume) opens the <b>SheetEditor</b> — a real grid with formulas.</p>",
       "figures":[F(TS+"canvas-cost.png","The spreadsheet editor — a cost section with live formulas.","full")],
       "steps":[
         S("Use the <b>cell-reference box</b> (e.g. <code>A1</code>) and the <b>formula bar</b> (<code>fx</code>) to enter "
           "values and formulas; the format bar handles bold, alignment, fill color, size, and font."),
         S("Add rows/columns with the trailing <b>+</b> controls; manage multiple <b>sheet tabs</b> at the bottom "
           "(double-click to rename). <b>Export .xlsx</b> writes the workbook with formulas intact."),
       ],
       "callouts":[{"kind":"eg","html":"Verified: the Cost Volume exported to a submission-ready <b>.xlsx</b> with live "
         "formulas — Base <b>$199,502 ≤ $200k</b>, Option <b>$114,464 ≤ $115k</b>."}]},
    ])

# ── 9. Compliance Review ──────────────────────────────────────────────────────
sec(id="review", toc="9 · Compliance Review", heading="Compliance Review — the readiness check",
    where="/portal/<company>/proposals/<id>/review",
    lead="<p>A read-only readiness view across sections and the compliance matrix.</p>",
    body="<p>The top banner reads <b>Ready for Final Submission</b> (green) or <b>Not Ready — Items Need Attention</b> "
         "(amber), with a stats bar (Sections Locked · Requirements Met · Est. Pages · Stage). Below, a <b>Section Status</b> "
         "table (with page estimates and “(over)” flags) and a <b>Compliance Checklist</b> (each requirement’s status, source, "
         "and notes). Use it as your pre-submit gate.</p>")

# ── 10. Documents ─────────────────────────────────────────────────────────────
sec(id="documents", toc="10 · Documents", heading="Documents — everything in one place",
    where="/portal/<company>/documents",
    lead="<p>Every document across the workspace, in five tables: your standalone documents, proposal sections, supporting "
         "documents, library uploads, and solicitation source documents.</p>",
    img=TS+"documents.png", caption="The documents hub — five tables covering every file type.",
    steps=[
      S("<b>+ New Document</b> starts a standalone canvas document; <b>Upload Document</b> sends a file to the library."),
      S("In <b>Supporting Documents</b>, use the per-row actions: <b>Upload</b> (presigned), <b>Download</b>, and admin "
        "<b>Review</b> / <b>Approve</b> / <b>Waive</b> to advance a required attachment’s status.",
        TC+"docs-tables.png","The documents hub — standalone docs, proposal sections, and supporting files.","full"),
    ],
    subs=[
      {"id":"newdoc","heading":"New document chooser","toc":"10.1 · New document",
       "img":TS+"documents-new.png","caption":"The new-document chooser — blank presets or a template.",
       "body":"<p><b>Start blank</b> offers four presets — <b>One-page flier</b>, <b>Blank document</b>, <b>Slide deck</b>, "
         "<b>Workbook</b>. <b>Start from a template</b> filters your templates and the system library; each card previews the "
         "structure and <b>Use template</b> opens the editor. A standalone document has its own <b>Lock for download</b> bar.</p>"},
    ])

# ── 11. Activity / Processes ──────────────────────────────────────────────────
sec(id="activity", toc="11 · Activity & Processes", heading="Activity & Processes — audit and automation",
    where="/portal/<company>/activity · /processes",
    lead="<p>Two monitoring surfaces.</p>",
    figures=[F(TS+"activity.png","The activity stream — filterable audit timeline.","half"),
             F(TS+"processes.png","Processes — your running automations, health-classified.","half")],
    body="<p><b>Activity</b> is your audit timeline — namespace tabs (All/Proposal/Library/…), a type search, time ranges, "
         "auto-refresh, and expandable event payloads. <b>Processes</b> lists your running automations with health chips "
         "(Failing/Stalled/Awaiting input/Running/Done); admins can <b>Move to next gate</b> on a paused step and expand the "
         "<b>Steps</b> timeline.</p>")

# ── 12. Team / Automation / Settings / Billing / Builds / AI ──────────────────
sec(id="team", toc="12 · Team", heading="Team — members & collaborators",
    where="/portal/<company>/team",
    lead="<p>Manage who’s in your workspace.</p>",
    img=TS+"team.png", caption="The team page — members, roles, and proposal collaborators.",
    steps=[
      S("<b>Invite</b> a member with Email, Name, and Role (<b>Contributor</b> / <b>Admin</b> / <b>External Partner</b>).",
        TC+"team-invite.png","The invite control.","half"),
      S("The <b>Team Members</b> table lets admins <b>Deactivate</b> / <b>Reactivate</b> a member (never hard-deleted). "
        "<b>Proposal Collaborators</b> lists per-proposal partners and their accepted/pending status."),
    ])

sec(id="vaults", toc="13 · Collaboration vaults", heading="Collaboration vaults (“nooks”) — segregated partner libraries",
    where="/portal/<company>/vaults",
    lead="<p>A <b>nook</b> is a private, per-partner branch library — a segregated clearing house you and one external partner "
         "(a subcontractor, a university, a teaming partner) both reach. The partner sees <b>only</b> their nook, never your "
         "main library or another partner’s nook; your main library and your AI agents never see nook content until you "
         "deliberately harvest it. It’s the safe way to exchange content across company lines.</p>",
    img=TS+"vaults-tenant-detail.png",
    caption="A nook, owner side — invite the partner, copy content in, download at any grain, and Harvest an artifact into "
            "your proposal library.",
    steps=[
      S("Open <b>Vaults</b> in the sidebar (admins) and <b>＋ New nook</b> — name the partner and (optionally) their "
        "organization. One nook per partner relationship.",
        TS+"vaults-tenant-index.png","The nooks index — one card per partner, with New nook.","half"),
      S("<b>Invite</b> the partner by email under <b>Partner access</b>. They receive access to <i>only</i> this nook and land "
        "on their own <code>/vaults</code> surface — never inside your portal."),
      S("<b>Copy content in</b> (Add artifact) for the partner to use, and <b>download</b> anything in the nook at any grain. "
        "What you add is a COPY — nothing is linked from your main library."),
      S("When the partner uploads, you get a notification and a <b>review ToDo</b>. <b>Harvest → library</b> pulls a whole "
        "artifact into your proposal library (with lineage) so you can use it in a build; until you do, it stays walled off "
        "in the nook."),
    ],
    table={"title":"Nook rights — the two sides","headers":["Capability","You (owner)","Partner"],"rows":[
      ["Invite / remove members · close the nook","✅","—"],
      ["Copy-in upload &amp; atomize","✅","✅"],
      ["Download a whole artifact","✅","✅"],
      ["Download an individual section / atom","✅","—"],
      ["Harvest a nook artifact into the proposal library","✅","—"]]},
    callouts=[{"kind":"note","html":"Isolation is enforced end-to-end: nook content carries a <code>vault_id</code> that fences "
      "it out of every main-library reader <i>and</i> every agent, so a partner’s draft can never leak into your library or an "
      "AI draft until you harvest it."},
      {"kind":"tip","html":"Sharing is instruction-based for launch: add only what you’re comfortable with the partner using, "
      "and harvest only what you want in your build. Partial-share and signed exchanges are a later addition."}])

sec(id="settings", toc="14 · Automation, Settings & Billing", heading="Automation, Settings & Billing",
    where="/automation · /profile · /billing · /portals · /agents",
    lead="<p>Your account and preferences.</p>",
    subs=[
      {"id":"automation","heading":"Automation preferences","toc":"14.1 · Automation",
       "figures":[F(TS+"automation.png","Automation preferences — toggle what runs automatically.","half")],
       "body":"<p><b>Automation</b> (admins) toggles notifications (document ready · collaborator get-ready · stage advanced · "
         "new priority opportunity), AI (review on advance), and flow (auto-advance when all locked). <b>Save</b> to apply.</p>"},
      {"id":"profile","heading":"Company profile","toc":"14.2 · Settings",
       "figures":[F(TS+"profile.png","Settings — your company profile feeds AI drafting.","half")],
       "body":"<p><b>Settings</b> shows your account + subscription and the editable <b>Company Profile</b> (legal name, "
         "website, summary, technology focus, NAICS, set-asides, target agencies, keywords). These fields feed proposal "
         "templates and AI drafting, so keep them current.</p>"},
      {"id":"billing","heading":"Billing & Builds & AI Usage","toc":"14.3 · Billing · Builds · AI",
       "figures":[F(TS+"billing.png","Billing — subscription, consulting, purchase history.","half"),
                  F(TS+"portals.png","Builds — your purchased proposal portals.","half")],
       "body":"<p><b>Billing</b> manages your Spotlight subscription, expert-consulting hours, and purchase history. "
         "<b>Builds</b> (<code>/portals</code>) lists your purchased proposal portals with their lifecycle status "
         "(curation_pending shows the 72h SLA countdown; launched/executing offer stage controls). <b>AI Usage</b> "
         "(<code>/agents</code>) shows your agent calls, allocation used, per-agent breakdown, and recent activity.</p>"},
    ])

# ── 15. Export ────────────────────────────────────────────────────────────────
sec(id="export", toc="15 · Export & deliver", heading="Export — your submission-ready files",
    where="Download Proposal (.docx) · Cost Volume (.xlsx)",
    lead="<p>With a volume locked, download your deliverables. The Technical Volume exports to a submission-ready "
         "<b>.docx</b> (US-Letter, 1″ margins, the agency’s fonts, figures inline &amp; captioned); the Cost Volume to an "
         "<b>.xlsx</b> with live formulas.</p>",
    img=DELIV+"tvp_1.png", caption="Page 1 of the exported Technical Volume — rendered by the system from your locked canvas.",
    body="<p>Whole-proposal packages export as <b>.json / .docx / .pdf / .zip</b> from the Artifacts export row "
      "(the .zip is per-volume-native). Before you submit, run the <b>Submission Package</b> review in the admin panel: it "
      "shows a deterministic readiness check and, on demand, queues the <b>packaging specialist</b> to compile a manifest — "
      "volume completeness, required forms, and page/format compliance — as an advisory report.</p>",
    callouts=[{"kind":"eg","html":"Verified deliverables: a <b>10-page Technical Volume .docx</b> (6 figures, 5 tables, 8 DON "
      "TV2 sections) and a <b>Cost Volume .xlsx</b> — Base <b>$199,502 ≤ $200k</b>, Option <b>$114,464 ≤ $115k</b>, formulas live."},
      {"kind":"tip","html":"When it’s over, record the result in <b>AI &amp; Library → Record Outcome</b> (Won / Lost / Withdrawn). "
        "Recording <b>Won</b> starts a <b>contract</b> and drops a <b>kickoff task</b> in your queue; every outcome also feeds your "
        "library so winning content ranks higher next time."}])

# ── 16. Worked example: build a real DoD proposal to submission-ready ──────────
sec(id="worked-dod", toc="16 · Worked example — build a DoD proposal", heading="Worked example — build a DoD proposal to submission-ready (DoW 2026 SBIR)",
    where="Opportunities → Purchase → the build workspace",
    lead="<p>This walks a real build end-to-end on a solicitation an RFP admin authored from the uploaded DoW 2026 SBIR BAA "
         "(Navy Phase I). When you procure a portal off the opportunity list, your workspace is <b>provisioned to that "
         "solicitation&rsquo;s exact spec</b> — the six DSIP volumes, the 10-page Technical limit, the 10-point / 1-inch / "
         "single-column format floor — nothing to configure.</p>",
    img=TS+"dow-sbir-build.png",
    caption="The provisioned DoW 2026 SBIR build — six DSIP volumes, the 12-section Technical Volume bounded to 10 pages, the Cost Volume, CCR, Supporting Documents, and the Fraud/Waste/Abuse Training volume.",
    subs=[
      {"id":"dod-provision","heading":"Procure → provision against the spec","toc":"16.1 · Procure & provision",
       "steps":[
         S("Open the opportunity card and <b>Purchase</b> a portal with your comp code — it lands <code>curation_pending</code>; "
           "an RFP admin releases it <b>unlocked</b>, with the compliance matrix pre-loaded from the solicitation."),
         S("Your workspace opens with <b>every volume and section already defined by the solicitation</b> — sections numbered in "
           "order, each item&rsquo;s icon set by its authored type (a Word narrative, a cost spreadsheet, a form, a PDF), and each "
           "Technical section bounded to the 10-page limit."),
       ],
       "callouts":[{"kind":"note","html":"You never pick a template or set a page limit — the build inherits the solicitation&rsquo;s "
         "bounding parameters. Draft into the sections the RFP admin defined."}]},
      {"id":"dod-readiness","heading":"Draft, lock, and clear the readiness gate","toc":"16.2 · Draft → lock → GO",
       "lead":"<p>Draft each section (from the library, the Studio, or by hand), then <b>Accept &amp; Lock</b> it — locking advances "
              "its compliance-matrix row. When every section is locked and the matrix is satisfied, the <b>submission-readiness</b> "
              "verdict flips to <b>GO</b>.</p>",
       "figures":[F(TS+"dow-sbir-submitted.png","The submitted SBIR build — every section LOCKED & APPROVED (1/1 each), the readiness gate cleared, and the header showing 'Locked · Download available'.","full")]},
      {"id":"dod-package","heading":"Download the compliant package","toc":"16.3 · Package",
       "lead":"<p>A locked/submitted proposal downloads as a compliant package — the combined <b>.docx</b> and print-fidelity "
              "<b>.pdf</b>, or a <b>per-volume-native .zip</b> (the Technical/CCR/Supporting volumes as .docx, the Cost Volume as "
              "a native .xlsx).</p>"},
      {"id":"dod-sttr","heading":"The STTR Direct-to-Phase-II variant","toc":"16.4 · STTR D2P2 build",
       "lead":"<p>A DoW 2026 STTR Direct-to-Phase-II portal provisions a structurally different build from the same primitive — a "
              "<b>30-page</b> Technical Volume split into Phase-I Proof of Feasibility and a Phase-II snapshot, a Cost Volume that "
              "reflects the <b>SB≥40% / RI≥30%</b> work-split, and the SBC↔RI Allocation-of-Rights in Supporting Documents.</p>",
       "figures":[F(TS+"dow-sttr-build.png","The STTR D2P2 build — the 30-page Technical Volume (Proof of Feasibility + Phase II snapshot), the Cooperative Work-Split section, and the Allocation-of-Rights in Vol 5.","full")]},
    ])

spec = {
  "slug": "customer-admin",
  "title": "Customer Admin Guide — Build a Winning Proposal",
  "nav_title": "Proposal Build Guide",
  "audience": "Customer Admin · tenant_admin",
  "eyebrow": "govwin role guide · Customer Admin",
  "hero": {
    "h1": "Build a Winning Proposal, End-to-End",
    "lede": [
      "The complete customer manual: every feature of your proposal portal, in the order you use it — rank opportunities, "
      "build a content library, draft a proposal from your atoms in the canvas, lock the matrix, and export submission-ready files.",
      "Every step was verified on a real effort: the <b>Immobileyes NAVAIR/NAVSEA Counter-UAS SBIR</b> "
      "(topic DON26BX03-NP002). The screenshots are that live run."
    ],
    "badge": "Complete surface · every feature, screen, and control — verified on a live build"
  },
  "footer": "govwin — RFP Pipeline Portal · Customer Admin role. Companion guides: RFP-Admin Operations, Collaborator.",
  "sections": SECTIONS,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(spec, open(OUT, "w"), ensure_ascii=False, indent=2)
print(f"wrote {OUT}: {len(SECTIONS)} sections, {sum(len(s.get('subs',[])) for s in SECTIONS)} subsections")
