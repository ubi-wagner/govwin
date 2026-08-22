#!/usr/bin/env python3
"""Authoring source for the RFP-Admin Operations Guide.
Emits docs/manuals/guides/rfp-admin.json (the data contract the HTML builder reads).
Edit here, run `python3 build_rfp_admin.py`, then rebuild the HTML with build_guides.py.
Grounded in the live admin console (every label/modal/endpoint verified against the code)."""
import json, os

OUT = "/home/user/govwin/docs/manuals/guides/rfp-admin.json"
SHOT = "docs/manuals/img/shots/admin/"
CROP = "docs/manuals/img/crops/admin/"
HITL = "docs/manuals/img/hitl/"

def S(t, img=None, cap=None, w="half"):
    d = {"t": t}
    if img: d["img"] = img; d["cap"] = cap or ""; d["w"] = w
    return d
def F(img, cap="", w="full"): return {"img": img, "cap": cap, "w": w}

SECTIONS = []
def sec(**k): SECTIONS.append(k)

# ── 1. Orientation ────────────────────────────────────────────────────────────
sec(id="orientation", toc="1 · Orientation & the console", heading="Orientation — the admin console",
    where="/admin  ·  sign in as an rfp_admin / master_admin",
    lead="<p>The admin console is where you run the platform: monitor sources, ingest and curate RFPs, "
         "release purchases, and oversee every automation and agent. This guide walks the whole surface, "
         "screen by screen, in the order you actually use it. Sign in with your RFP-admin credentials; the "
         "console opens on the <b>Dashboard</b>.</p>",
    callouts=[{"kind":"eg","html":"The seeded operator <code>eric@rfppipeline.com</code> is a <b>master_admin</b> — "
        "global access to every tenant plus the full admin surface. <code>rfp_admin</code> has the same console; "
        "a few master-only screens (System Health, Pipeline AI Controls) are noted where they appear."}],
    subs=[
      {"id":"chrome","heading":"The persistent chrome (sidebar, breadcrumb, guards)","toc":"1.1 · Console chrome",
       "lead":"<p>Every <code>/admin/*</code> page shares three things:</p>",
       "body":"<ul class='plain'>"
         "<li><b>Left sidebar</b> — the navy rail, grouped into <b>Overview</b>, <b>Opportunities</b>, "
         "<b>Customers</b>, <b>Content</b>, <b>System</b>, and <b>CRM</b>. The brand link <code>RFP Admin</code> "
         "returns you to the Dashboard; a <code>Portal →</code> footer link jumps to the customer side.</li>"
         "<li><b>Breadcrumb trail</b> at the top of the content — a click-through history with <b>‹</b> Back / "
         "<b>›</b> Forward arrows (browser-history semantics, persisted per tab).</li>"
         "<li><b>Unsaved-changes guard</b> — editors (Site pages, AI-config cards) warn "
         "<i>“You have unsaved changes on this page. Leave without saving?”</i> if you navigate away dirty.</li></ul>",
       "figures":[F(CROP+"nav-sidebar.png","The admin sidebar — every surface in this guide is one click from here.","third")],
       "table":{"title":"Sidebar map — every destination","headers":["Group","Links"],"rows":[
         ["Overview","Dashboard · Our Workspace"],
         ["Opportunities","Intake · RFP Curation · Opportunity Cards · Sources · Scout Monitor · Pipeline Jobs · Templates · Guardrail Defaults"],
         ["Customers","Applications · Tenants · Billing · Waitlist · Purchases · Proposals"],
         ["Content","Site Content · Document Builder · S3 Storage"],
         ["System","System State · Event Stream · Agents · Automation · Process Monitor · Workflows · Process Ledger · System Health · Analytics"],
         ["CRM","CRM Console"]]},
       "callouts":[{"kind":"note","html":"A few surfaces are reachable only by link, not the sidebar: "
         "<code>/admin/scouts</code> (from Sources), <code>/admin/intake</code>, <code>/admin/cards</code>, and "
         "<code>/admin/opportunities</code>. This guide covers them all."}]},
    ])

# ── 2. Dashboard ──────────────────────────────────────────────────────────────
sec(id="dashboard", toc="2 · The Dashboard", heading="The Dashboard — your daily starting point",
    where="/admin/dashboard",
    lead="<p>The Dashboard is a system-overview landing: metric tiles up top, your ToDo queue in the middle, "
         "and live feeds below. It answers “what needs me right now?”</p>",
    img=SHOT+"dashboard.png", caption="The admin Dashboard — stat tiles, ToDos, recent events, pending actions.",
    steps=[
      S("<b>Scan the eight stat tiles.</b> Each tile is a click-through that opens its target page in a new tab. "
        "<b>Events Today</b> also shows a hover preview of the six most recent events.",
        CROP+"dash-stats.png","The eight metric tiles — click any to drill in.","full"),
      S("<b>Work your ToDo queue</b> (“Your To-Dos”). Each card carries an urgency chip (<b>Overdue</b>/"
        "<b>Due soon</b>), a workflow-name pill, and a step trail. The action button is typed to the task — see below.",
        CROP+"dash-todos.png","The ToDo queue — typed completers per task.","half"),
      S("<b>Clear a single ToDo.</b> A review task shows <b>Approve / Done</b> and <b>Dismiss</b>; an "
        "acknowledgement shows <b>Acknowledge</b>; an upload task shows <b>Open to upload</b> + <b>Mark uploaded</b>.",
        CROP+"dash-todo-one.png","A curation ToDo with Approve / Dismiss.","half"),
      S("<b>Review the feeds.</b> <b>Recent Events</b> (Time · Event · Phase · Actor) and <b>Pending Actions</b> "
        "(Pending applications · Unclaimed RFPs · Draft atoms awaiting review) — each row deep-links to the right screen.",
        CROP+"dash-events.png","Recent Events + Pending Actions.","full"),
    ],
    table={"title":"The eight dashboard tiles","headers":["Tile","Counts","Opens"],"rows":[
      ["Pending Applications","applications awaiting review","/admin/applications"],
      ["Active Tenants","live companies","/admin/tenants"],
      ["Library Atoms","approved atoms platform-wide","/admin/analytics"],
      ["Active Proposals","proposals not submitted/archived","/admin/proposals"],
      ["RFPs in Curation","solicitations mid-triage","/admin/rfp-curation"],
      ["Events Today","system_events in 24h (hover = preview)","/admin/events"],
      ["SBIR Companies","SBIR company records","/admin/analytics"],
      ["SBIR Awards","SBIR award records","/admin/analytics"]]},
    callouts=[{"kind":"tip","html":"The <b>ToDo queue</b> (the <code>TaskQueue</code>) auto-reloads every 30s and "
      "appears on tenant dashboards too. A <b>Form</b> task renders its own required fields; a <b>Broadcast note</b> "
      "just needs an <b>Acknowledge</b>."}],
    subs=[
      {"id":"todo-types","heading":"The typed ToDo completers","toc":"2.1 · ToDo completers",
       "lead":"<p>Each ToDo carries the right control for its kind — you never guess how to clear it.</p>",
       "table":{"title":"How each ToDo type is completed","headers":["Task type","Control(s)","Result"],"rows":[
         ["Acknowledge / Broadcast note","<b>Acknowledge</b>","marks it read"],
         ["Review","<b>Approve / Done</b> · <b>Dismiss</b>","approves or declines"],
         ["Upload","<b>Open to upload</b> · <b>Mark uploaded</b>","opens the target, then confirms"],
         ["Form","typed fields (required marked *) → <b>Submit</b>","captures the form payload"]]},
       "callouts":[{"kind":"note","html":"Each card also shows a <b>WorkflowTrail</b> — the step breadcrumb with the "
         "current step in bold and finished steps struck through, so you see where the work sits."}]},
    ])

# ── 3. Sources ────────────────────────────────────────────────────────────────
sec(id="sources", toc="3 · Sources & monitoring", heading="Sources — where opportunities come from",
    where="/admin/sources · /admin/sources/<id>",
    lead="<p>Before anything is ingested, you point the platform at where opportunities live. <b>Sources</b> is your "
         "bookmarked-sites hub; each source can be opened, scouted, and fed documents. This is setup you do once per site "
         "and revisit when a site changes.</p>",
    img=SHOT+"sources.png", caption="The Sources hub — one card per monitored site, with recent changes and activity.",
    subs=[
      {"id":"sources-card","heading":"Working a source card","toc":"3.1 · Source card actions",
       "steps":[
         S("Click <b>+ New Solicitation</b> (top-right) to jump straight to the RFP upload form, or work an existing card below."),
         S("On any card, the five actions are: <b>Open Site</b> (logs a visit, opens the site), <b>Paste Topics</b> "
           "(opens the paste-and-parse modal), <b>Upload PDFs</b> (drops files straight into ingest), <b>Add Note</b> "
           "(inline admin note), and <b>Scout Now</b> (runs the scraper immediately)."),
         S("Drag files onto the card’s <i>“Drop PDF files here to upload”</i> zone to ingest without clicking."),
       ],
       "callouts":[{"kind":"eg","html":"<b>Paste Topics</b> opens a modal: paste tab/pipe/comma-separated rows, click "
         "<b>Parse Preview</b> to see a table, then <b>Import N Topics</b>. It auto-detects the delimiter."}]},
      {"id":"sources-detail","heading":"Source detail — crawl schedule & monitored regions","toc":"3.2 · Source detail",
       "lead":"<p>Click a source name to open its detail page.</p>",
       "img":SHOT+"source-detail.png","caption":"Source detail — crawl settings, monitored regions, change history.",
       "steps":[
         S("Toggle <b>Auto-crawl</b> on, then pick a <b>Schedule</b> (Daily 6am UTC, Every 12 hours, Weekly, Every 6 hours, "
           "or a <b>Custom</b> cron). <b>Scout Now</b> runs it on demand."),
         S("Edit <b>Admin Notes</b> and <b>Visit Instructions</b> inline (Edit → Save)."),
         S("Add a <b>Monitored Region</b> (Name, Region Type, Content Context, optional selector/sample) so the scout "
           "watches a specific part of the page and flags meaningful diffs."),
         S("Review <b>Change History</b> — each diff carries a severity pill and a <b>Review</b> button that marks it seen."),
       ]},
    ])

# ── 4. Scouts ─────────────────────────────────────────────────────────────────
sec(id="scouts", toc="4 · Scout Monitor", heading="Scout Monitor — the worker pool",
    where="/admin/scouts",
    lead="<p>The scout pool is the fleet of workers that visit your sources on schedule, diff them, and surface new or "
         "changed solicitations. This screen is a pure monitor — setup and “Scout Now” live on the Sources page.</p>",
    img=SHOT+"scouts.png", caption="Scout Monitor — pool health, recent runs, and detected changes.",
    steps=[
      S("Read the <b>five metric cards</b>: Active sources · Healthy · Degraded/error · Running scouts · Changes (24h)."),
      S("Scan the <b>Worker Pool</b> table (Source · Agency · Health · Fails · Last success · Avg run · Last visit). "
        "Health is <b>healthy</b>/<b>degraded</b>/<b>error</b>/<b>unknown</b>; a red Fails count needs attention."),
      S("Check <b>Recent scout runs</b> and <b>Changes detected</b> to confirm the pool is finding new opportunities."),
    ],
    callouts=[{"kind":"note","html":"Scouts run <b>managed and audited</b> — a run that fails on one source continues on "
      "the others; nothing dead-ends. Kick a run from <b>Sources → Scout Now</b>."}])

# ── 5. Intake ─────────────────────────────────────────────────────────────────
sec(id="intake", toc="5 · Stage an intake", heading="Intake — stage an opportunity by hand",
    where="/admin/intake",
    lead="<p>When you find an opportunity yourself, <b>Intake</b> stages it into the review queue at status "
         "<code>new</code> (not yet live) — the manual stand-in for scout discovery.</p>",
    img=SHOT+"intake.png", caption="The Intake form — stage a found opportunity into the triage queue.",
    steps=[
      S("Fill <b>Title</b> and <b>Agency</b> (both required), plus any of Office · Unit · Solicitation # · Program "
        "(SBIR/STTR/BAA/OTA/CSO) · Initial stage (Pre-Release / NOFO) · dates · POC."),
      S("Add a <b>Source URL</b>, <b>Description / notes</b>, and internal <b>RFP Expert Notes</b> (carried on the card). "
        "Tick <b>Docs were downloadable</b> if applicable."),
      S("Click <b>Stage into review queue</b>. On success the form clears and shows <b>Staged ✓ Curate it →</b> "
        "linking straight to RFP Curation."),
    ])

# ── 6. Curation cockpit (the big one) ─────────────────────────────────────────
sec(id="curation", toc="6 · RFP Curation cockpit", heading="RFP Curation — the ingest → curate → push cockpit",
    where="/admin/rfp-curation · /upload · /<solId>",
    lead="<p>Curation is the heart of the operator’s job. You claim a solicitation, extract its topics, attach compliance, "
         "build the volume/section skeleton, and finish with <b>Push</b> — the fan-out that puts the opportunity in every "
         "tenant’s pipeline. This is a multi-part workspace; take it in order.</p>",
    img=SHOT+"curation.png", caption="The triage queue — claim, filter, and open solicitations for curation.",
    callouts=[
      {"kind":"warn","html":
       "<b>When Ingest Assist says a value is “Set elsewhere”, that is a job for you, not an error.</b> "
       "A solicitation that defers its page limit or submission format to the Component-specific "
       "instructions leaves that field genuinely unknown — and the product will not invent one, because "
       "a value it did not read must never look like one it did. <b>Push</b> then holds the opportunity "
       "until a person supplies it. Open the referenced instructions, enter the value yourself, and it is "
       "recorded as <b>your</b> entry (<code>hitl</code> provenance) with a note of where it came from — "
       "never laundered into looking machine-read."},
      {"kind":"note","html":
       "<b>Why a master with everything filled in can still read “below the bar”.</b> Build-out readiness "
       "checks five things, not three: compliance authored, ≥1 volume, ≥1 required item, <b>no undecided "
       "items</b>, and <b>no undecided volumes</b>. The last two matter more than they look — an item "
       "nobody has ruled on still provisions as a writable section, and the drafter will fill it with "
       "plausible prose, which is how a build ends up with an AI-written “Reps &amp; Certifications” where "
       "a signed federal form belongs. Either attach a mold or mark it completed elsewhere; the bar is "
       "asking you to decide, not reporting a fault."},
    ],
    subs=[
      {"id":"triage","heading":"The triage queue","toc":"6.1 · Triage queue",
       "steps":[
         S("Use the <b>Filter</b> select to narrow by status (each option shows its count); <b>Refresh</b> re-pulls."),
         S("Each row shows Title · Source · Agency · <b>Status</b> · Namespace · Ingested. Click a row to open the workspace."),
         S("Per-row actions depend on status: a <code>new</code> row offers <b>Claim</b>; a row you’ve claimed offers "
           "<b>Release for AI</b> and <b>Dismiss</b>; an analyzed row offers <b>Open</b>. A stale claim (>24h) shows a "
           "<b>stale</b> pill, and a master_admin can <b>Force Release</b> it.",
           CROP+"curation-row.png","A triage row with its status pill and actions.","half"),
       ],
       "table":{"title":"Solicitation status values","headers":["Status","Meaning"],"rows":[
         ["new","just staged / discovered, unclaimed"],["claimed","an admin owns it"],
         ["released_for_analysis","handed to the AI shredder"],["ai_analyzed","shredder done, ready to curate"],
         ["curation_in_progress","being curated"],["review_requested","sent for a second look"],
         ["approved","curation approved — ready to Push"],["pushed_to_pipeline","fanned out to tenant cards"],
         ["dismissed / rejected_review","stopped, with a reason"]]}},
      {"id":"upload","heading":"Upload an RFP","toc":"6.2 · Upload an RFP",
       "lead":"<p>Bring a solicitation in by hand from <b>+ Upload RFP</b>.</p>",
       "steps":[
         S("Fill the <b>Solicitation Metadata</b> (Title + Agency required; Program Office, Program Type, numbers, dates). "
           "Filenames auto-fill empty fields."),
         S("Drag documents into the <b>Documents</b> zone (PDF/DOCX/XLSX/PPTX/TXT, max 30 MB total). Pick the <b>primary</b> "
           "with the radio; others become attachments."),
         S("<b>Multi-topic BAA?</b> Drop the individual topic files into the <b>Topic files</b> zone on the same form — each "
           "becomes a topic opportunity under this solicitation in one submit (the button shows <b>Upload + N topics</b>). "
           "Leave it empty for a single-topic solicitation, or add topic files later from the workspace drop-zone."),
         S("Leave <b>✨ Run Ingest Assist after upload</b> ticked — it parses the docs, auto-builds the compliance matrix, "
           "volumes and section molds, and publishes the card(s). Click <b>Upload &amp; Ingest Assist</b>."),
       ],
       "callouts":[{"kind":"note","html":"A duplicate file is caught (<code>DUPLICATE_FILE</code>) and offers a "
         "<b>Go to the existing solicitation →</b> link instead of making a second copy. Malformed PDFs are sanitized on ingest."}]},
      {"id":"workspace","heading":"The curation workspace","toc":"6.3 · Curation workspace",
       "lead":"<p>Opening a solicitation gives you the full cockpit. Work top-to-bottom.</p>",
       "img":SHOT+"curation-detail.png","caption":"The curation workspace — documents, PDF tagging, topics, volumes, compliance matrix.",
       "steps":[
         S("<b>Write the Spotlight-match summary</b> (top). It’s <b>required before Push</b> — an empty summary blocks the "
           "fan-out. Save it; the banner turns from rose to green."),
         S("Use the <b>quick-nav tabs</b> — Documents · Topics · Compliance · Customer Interest — to jump around.",
           CROP+"curation-tabs.png","The workspace quick-nav tabs.","half"),
         S("<b>Tag compliance variables on the PDF.</b> Select text in the viewer to open <i>Tag as Compliance Variable</i>, "
           "pick or add a variable, and save its value — provenance (doc + page) is recorded."),
         S("<b>Extract & manage Topics.</b> For a multi-topic BAA, <b>drop the individual topic files</b> into the topic "
           "drop-zone — <b>each file becomes its own topic opportunity</b> under this umbrella (text extracted, deduped, "
           "linked back to its file). Or <b>Extract Topics</b> (scan the umbrella text), <b>Import all topics from source</b>, "
           "<b>Bulk Import</b>, or <b>+ Add Topic</b>. Then <b>Manage Compliance</b> to set per-topic overrides (phase-grouped, with presets)."),
         S("<b>Build Response Volumes.</b> <b>+ Add Volume</b>, then per volume <b>+ Add required item</b> — each item points "
           "at a <b>starter template (mold)</b> and carries its format rules (page limit, font, margins)."),
         S("<b>Advance the state machine.</b> The action bar shows only the valid next steps: <b>Claim → Release → Start "
           "Curation → Request Review → Approve → Push</b>. <b>Push</b> is the fan-out.",
           CROP+"curation-triage.png","The state-machine action bar.","half"),
       ],
       "figures":[F(CROP+"cur-summary.png","The required Spotlight-match summary + the live DON26BX03-NP002 solicitation.","full"),
                  F(CROP+"cur-docs.png","Source documents + the tagging viewer inside the workspace.","full")],
       "table":{"title":"The compliance matrix — the 18 fields you curate","headers":["Group","Fields"],"rows":[
         ["Format","Page Limit (Technical) · Page Limit (Cost) · Font Family · Font Size · Margins · Line Spacing"],
         ["Headers/footers","Header Required · Header Format · Footer Required · Footer Format"],
         ["Submission","Submission Format · Slides Allowed · Slide Limit · TABA Allowed"],
         ["Eligibility","PI Must Be Employee · Partner Max % · Clearance Required · ITAR Required"]]},
       "callouts":[{"kind":"eg","html":"Each matrix field carries a source pill — <b>Verified</b> (green, you confirmed it) "
         "or <b>AI</b> (yellow, suggested). Click <b>p.N</b> on a field to jump the PDF viewer to where it was found."},
         {"kind":"note","html":"<b>One solicitation + N topic files → N opportunities.</b> Upload the umbrella solicitation, then "
          "drop its topic files into the drop-zone — each becomes a topic opportunity under the umbrella (deduped, text-extracted, "
          "linked to its file). <b>Push</b> then fans the umbrella + every topic to all tenants, so 20 topic files land 21 cards."}]},
      {"id":"cur-modals","heading":"The curation modals","toc":"6.4 · Curation modals",
       "lead":"<p>Curation uses a family of modals; here is what each one captures.</p>",
       "table":{"title":"Curation workspace modals","headers":["Modal","Opened by","Key fields"],"rows":[
         ["Add Topic","<b>+ Add Topic</b>","Topic Number · Status · Title · Description · Branch · Tech Focus Areas"],
         ["Bulk Import Topics","<b>Bulk Import</b>","Default branch · a topics textarea (auto-detects delimiter, live preview)"],
         ["Topic files → opportunities","<b>topic drop-zone</b>","drag/drop N topic files · each becomes a topic opportunity (text extracted, deduped, file-linked)"],
         ["Add Volume","<b>+ Add Volume</b>","# · Format · Volume Name · Description · Special Requirements · Applies to Phase"],
         ["Add/Edit Required Item","<b>+ Add required item</b>","# · Type · Name · Required · limits/format · <b>Starter template (mold)</b> · Expert notes"],
         ["Tag as Compliance Variable","select text in the PDF","variable name · category · value (with memory suggestions)"]]},
       "callouts":[{"kind":"note","html":"<b>Ingest Assist</b> (<code>✨</code>) can build the topics, volumes, items and "
         "compliance in one pass — you then refine. It warns before replacing existing structure."}]},
      {"id":"customer-interest","heading":"Customer interest & topic detail","toc":"6.5 · Customer interest",
       "body":"<p>At the bottom of the workspace, <b>Customer Interest</b> lists tenants who pinned topics under this "
         "solicitation — with the topic, pin date, whether they bought a portal, the proposal stage, and a <b>View Portal</b> "
         "link (which drops you into that tenant’s workspace). Open a single topic (from the Topics list) to edit its Title, "
         "Description, Status, and Tech Focus Areas on the <b>topic detail</b> page.</p>"},
      {"id":"assess-ingest","heading":"Assess ingest readiness (advisory)","toc":"6.6 · Assess ingest readiness",
       "lead":"<p><b>Assess ingest readiness</b> wakes the <b>RFP Ingest Manager</b> agent to look over a curated solicitation "
         "and recommend what to do next. It is advisory and read-only — it never edits the solicitation and never descends into "
         "a tenant.</p>",
       "steps":[
         S("Click <b>Assess ingest readiness</b>. You get an immediate, deterministic <b>stage snapshot</b> — shred → extract → matrix → skeleton — showing how far ingest has progressed."),
         S("In the background the manager posts a coordination plan (which specialist agents to run next) to the <b>Agent Workforce</b> audit; the run is injection-fenced and budget-capped like every agent."),
       ],
       "callouts":[{"kind":"note","html":"This is the platform-side analog of the tenant <b>Proposal Studio</b> manager: it "
         "<i>plans</i>, it doesn’t act. Use its readout to decide whether to run <b>Ingest Assist</b> or hand-finish the curation."}]},
      {"id":"amendments","heading":"Amendments — log a change, fan it out to tenants","toc":"6.7 · Amendments",
       "lead":"<p>When an agency amends a solicitation after it’s been built against, the <b>Amendments</b> panel is how you push "
         "the change to every affected proposal. Log it → confirm it → each tenant acknowledges.</p>",
       "steps":[
         S("Click <b>+ Log amendment</b>. Give it a <b>label</b> (e.g. “Amendment 0002”), a <b>severity</b> (critical / major / minor / info), a <b>summary</b>, and — row by row — the <b>compliance delta</b> (added / removed / changed requirement + detail)."),
         S("Review the logged amendment, then <b>Confirm → notify</b>. This fans the change out to <i>every active proposal</i> built from this solicitation (archived builds are skipped); each tenant gets a banner to acknowledge."),
         S("Watch the per-amendment <b>acknowledged N / M</b> counter as tenants clear their banners. <b>Dismiss</b> a false positive instead of confirming — no fan-out."),
       ],
       "callouts":[{"kind":"warn","html":"Confirming is a customer-visible action — it raises a banner on every affected build. "
         "Log the delta precisely (it’s what the tenant sees); dismiss anything that isn’t a real compliance change."}]},
    ])

# ── 7. Opportunity Cards ──────────────────────────────────────────────────────
sec(id="cards", toc="7 · Opportunity Cards", heading="Opportunity Cards — the fan-out cockpit",
    where="/admin/cards",
    lead="<p>After a push, <b>Opportunity Cards</b> is the master view of every opportunity and how it fanned out: curation "
         "status, matrix summary, bridge version, and how many tenants it replicated to. It’s the one place with a "
         "lifecycle stage control.</p>",
    img=SHOT+"cards.png", caption="Master opportunity cards — curation, matrix, bridge version, replication, and the stage control.",
    steps=[
      S("Use the <b>filter box</b> to find by title/agency/number/topic. The table auto-refreshes every 30s; the summary "
        "reads “N shown · N total · N on bridge · N replicated”."),
      S("Sort by any column header (Opportunity · Curation · Matrix · Bridge · Replicated · Stage · Ingested · Close)."),
      S("Change lifecycle with the <b>“move →” select</b> in the Stage column — it offers only the allowed transitions "
        "(nofo → pre_release → open → updated → closed → archived) and records the change."),
    ],
    callouts=[{"kind":"note","html":"The related <b>Opportunity Rollup</b> (<code>/admin/opportunities</code>) is a read-only "
      "cross-tenant view: per opportunity, how many tenants ranked vs pinned it and each proposal’s build stage."}])

# ── 8. Purchases & release ────────────────────────────────────────────────────
sec(id="purchases", toc="8 · Purchases & release", heading="Purchases — release a bought portal",
    where="/admin/purchases · /admin/applications",
    lead="<p>When a customer buys a proposal portal with a comp code, it lands here as <code>curation_pending</code> with a "
         "<b>72-hour SLA</b>. You release it from the shadow account — releasing provisions the build <b>unlocked</b> and "
         "instantiates the compliance matrix and molds from the master solicitation.</p>",
    img=SHOT+"purchases.png", caption="The purchases queue — comp-code and Stripe buys, with the release action.",
    steps=[
      S("Find the <code>curation_pending</code> purchase (watch the 72h clock)."),
      S("Open the tenant’s build and <b>Release to customer</b> — this provisions the matrix + molds and unlocks the build.",
        CROP+"purchase-release.png","The release control on a pending purchase.","half"),
      S("Confirm the tenant now sees an unlocked proposal workspace with a populated compliance matrix."),
    ],
    callouts=[{"kind":"note","html":"You can also grant a build <b>free</b> — approve it as a <b>comped portal</b> instead of "
      "waiting on a purchase. That records a <b>$0 purchase</b> row (<code>metadata.grant=admin</code>) and emits the same "
      "<code>capture:purchase.completed</code> event, so a comp <b>audits exactly like a paid buy</b>. (Self-serve Stripe "
      "checkout is descoped for V1 — the comp code <code>rfppipelinetest</code> and this admin grant are the two paths in.)"}])

# ── 9. Applications ───────────────────────────────────────────────────────────
sec(id="applications", toc="9 · Applications", heading="Applications — onboard a founding-cohort company",
    where="/admin/applications",
    lead="<p>Founding-cohort applications arrive here. Accepting one provisions a tenant and emails credentials; the row "
         "auto-enriches with the applicant’s SBIR award history.</p>",
    img=SHOT+"applications.png", caption="Applications — expand a row to review readiness and accept/reject.",
    steps=[
      S("Expand a row. It auto-fetches <b>SBIR/STTR Award History</b> (awards, funding, agencies) and shows Contact, "
        "Company, Federal Readiness (SAM/CAGE/UEI), Technology, and target programs/agencies."),
      S("Write <b>Admin Review Notes</b> (min 10 chars), then <b>Accept</b> or <b>Reject</b>."),
      S("On <b>Accept</b>, a green panel returns the new workspace path plus <b>Login Credentials</b> (email + temporary "
        "password) and the welcome-email status. Re-accepting never re-creates the tenant or re-sends email.",
        CROP+"app-row.png","An application expanded — readiness detail before you decide.","full"),
    ],
    callouts=[{"kind":"note","html":"An already-decided application gets a <b>Change Status</b> block (new status + an "
      "audit note ≥5 chars). Every status change is audited."}])

# ── 10. Templates ─────────────────────────────────────────────────────────────
sec(id="templates", toc="10 · Templates & molds", heading="Templates — the section-mold studio",
    where="/admin/templates · /admin/templates/<id>/edit",
    lead="<p>Templates are the section <b>molds</b> a required item points at — the format contract (page limit, margins, "
         "font, structure) every provisioned proposal inherits. Author them here, or templify a winning past proposal.</p>",
    img=SHOT+"templates.png", caption="The Template studio — system + custom molds, filterable, previewable.",
    steps=[
      S("Click <b>+ New Template</b>, name it, pick a <b>Type</b> (Technical Volume, Cost Volume, Slide Deck, …) and a "
        "<b>Canvas</b> (Letter/DOCX, Slides/PPTX, Spreadsheet), then <b>Create &amp; open editor</b>.",
        CROP+"template-new.png","The New Template panel.","half"),
      S("Filter the library by Type / Agency / Program; <b>Clear filters</b> resets.",
        CROP+"template-card.png","A template card with node count + limits.","half"),
      S("<b>Preview</b> a system template (read-only, with its merge-field chips), or <b>Edit</b> a custom one to open the "
        "full canvas editor. <b>Delete</b> removes a custom mold (items fall back to the registry)."),
    ],
    callouts=[{"kind":"note","html":"<b>System templates</b> carry an indigo <b>System</b> pill and open read-only — use "
      "“Save as new” to fork one. Editing saves the canvas back to the mold."}])

# ── 11. Workflows ─────────────────────────────────────────────────────────────
sec(id="workflows", toc="11 · Workflow Monitor", heading="Workflow Monitor — see & control every automation",
    where="/admin/workflows",
    lead="<p>Every automation runs as a <b>managed workflow</b> — no fire-and-forget. This is the canonical control surface: "
         "launch forms, the template catalog with activation, and the live/recent instance monitor with advance, retry, and "
         "cancel.</p>",
    img=SHOT+"workflows.png", caption="The Workflow Monitor — stats, catalog, active instances, and recent history.",
    subs=[
      {"id":"wf-launch","heading":"Launching a workflow","toc":"11.1 · Launch forms",
       "steps":[
         S("<b>Generate Content</b> — Title, Content type, Brief, optional Slug → the CMS pipeline drafts it and parks at a "
           "review ToDo within ~10s."),
         S("<b>Launch Review Gate</b> — a human-in-the-loop gate: pick Scope, Assign-to role, Due hours, and the entity "
           "keys (Opportunity ID is the spine key). It parks a task on the assignee.",
           CROP+"wf-launch.png","The two launch forms — Generate Content + Launch Review Gate.","full"),
       ]},
      {"id":"wf-catalog","heading":"The catalog + activation","toc":"11.2 · Catalog & activation",
       "steps":[
         S("Open <b>Workflow Catalog</b> to see every template with a status dot, description, trigger key, and instance "
           "counts (running/paused/done/failed)."),
         S("Toggle <b>Activate</b> / <b>Deactivate</b> per template. Deactivating refuses new launches (existing instances "
           "finish) and is audited.",
           CROP+"workflow-catalog.png","The catalog with per-template activation.","full"),
       ]},
      {"id":"wf-monitor","heading":"Monitoring & driving instances","toc":"11.3 · Instances",
       "steps":[
         S("The <b>stats bar</b> shows Running / Paused / Completed 24h / Failed 24h. <b>Active Workflows</b> auto-refreshes "
           "every 10s with a live elapsed timer.",
           CROP+"workflow-instance.png","A live instance with its progress bar and controls.","full"),
         S("Click <b>Steps</b> to expand the transition timeline (step · from→to · actor · time · reason)."),
         S("<b>Advance</b> a <code>paused</code> instance (HITL override), <b>Cancel</b> a running one, or <b>Retry</b> a "
           "failed one from Recent History. A failed row’s <b>error</b> toggle shows the failing step + message.",
           CROP+"wf-active.png","The live stats bar + active instances.","full"),
       ],
       "table":{"title":"Workflow instance states","headers":["State","Meaning"],"rows":[
         ["running","executing now"],["paused","parked on a human gate — Advance to continue"],
         ["completed","finished"],["failed","errored — Retry re-runs it"],["cancelled","stopped by an admin"],
         ["retrying","re-running after a failure"]]}},
    ],
    callouts=[{"kind":"tip","html":"A step that fails continues on independent branches; a human gate parks and resumes. "
      "The same runs also appear under the legacy <b>Process Monitor</b> and <b>Process Ledger</b> — treat <b>Workflows</b> as primary."}])

# ── 12. Automation ────────────────────────────────────────────────────────────
sec(id="automation", toc="12 · Automation Rules", heading="Automation Rules — event → action",
    where="/admin/automation",
    lead="<p>Automation rules fire actions on system events. Each rule watches a <code>namespace:type</code> trigger and "
         "runs an action (notify, queue a job, send email, create a ToDo, publish content, …).</p>",
    img=SHOT+"automation.png", caption="Automation rules — triggers, action types, and per-rule toggles.",
    steps=[
      S("Read the four cards: Total Rules · Active · Inactive · Executions (24h)."),
      S("In the table, flip a rule’s <b>Active</b> toggle to enable/disable it (optimistic, audited).",
        CROP+"automation-rule.png","An automation rule row with its toggle.","half"),
      S("<b>View Config</b> expands the action’s JSON; <b>View Logs</b> jumps to the event stream filtered to that trigger."),
    ],
    callouts=[{"kind":"note","html":"Action types include <code>queue_notification</code>, <code>send_email</code>, "
      "<code>create_todo</code>, <code>distribute_social</code>, <code>publish_content</code>, <code>webhook</code>, and more "
      "— each rendered as a colored pill."}])

# ── 13. Agents ────────────────────────────────────────────────────────────────
sec(id="agents", toc="13 · Agent Workforce", heading="Agents — the AI workforce & its budget",
    where="/admin/agents · /admin/guardrail-defaults",
    lead="<p>The <b>Agents</b> screen is the workforce roster and its usage. Tenant-space agents are <b>tenant-bound</b> and "
         "<b>advisory</b> — they propose, a guardrail checks, and a human accepts; they never auto-write business tables.</p>",
    img=SHOT+"agents.png", caption="The agent workforce — roster by pod, per-tenant usage, and cost summary.",
    steps=[
      S("Read the <b>roster</b>, grouped into four pods (Tenant build & pursue · Master ingestion · Our-org RFP-admin ops · "
        "Our-org CMS). Each agent shows scope (🔒 Tenant-bound), what it wakes on, status (live/wired/dormant), 30-day queue, "
        "and last run.",
        CROP+"agent-roster.png","The agent roster grouped by pod.","full"),
      S("Below, <b>Usage by tenant (30 days)</b> and a six-tile <b>Usage Summary</b> (calls, cost, tokens, active tenants).",
        CROP+"agent-row.png","An agent row with its 30-day queue.","half"),
      S("A <b>master_admin</b> also gets <b>Pipeline AI Controls</b> — default monthly budget, rate limit, per-call ceiling, "
        "and an optional platform-wide monthly cap."),
      S("Lower on the page, the <b>Tool Registry</b> (every callable tool, its min role and tenant-scoping) and <b>Recent "
        "Tool Invocations</b> give you the full audit of what the agents actually called.",
        CROP+"agents-usage.png","The tool registry + recent invocations — the agent audit trail.","full"),
    ],
    callouts=[{"kind":"note","html":"<b>Research Scout</b> (status <b>live</b>): a tenant-bound R&D agent a customer triggers "
      "from a proposal’s <b>AI &amp; Library</b> tab (“Research this opportunity”). It browses the web — including DoD sources "
      "(SAM.gov, SBIR.gov, DSIP) — through a controlled, SSRF-guarded server-side browser and returns a cited brief. Same "
      "safety contract as every agent here: <b>web results injection-fenced</b> (data, never instructions), "
      "<b>budget/rate/cost-capped</b> via Pipeline AI Controls, and <b>human-gated</b> (advisory brief, never auto-written). "
      "Usage shows in this roster and the tool-invocation audit — the “use more, pay more” model applies."}],
    subs=[
      {"id":"guardrails","heading":"Guardrail defaults","toc":"13.1 · Guardrail defaults",
       "lead":"<p><code>/admin/guardrail-defaults</code> sets the hard limits every customer portal launches inside.</p>",
       "img":SHOT+"guardrails.png","caption":"Guardrail defaults — the safety envelope for new launches.",
       "steps":[S("Set <b>Max stages</b>, <b>Max collaborators</b>, <b>Max managers</b>, and <b>Max nudges</b>, then "
         "<b>Save limits</b>. Changes apply to future launches; frozen configs are unaffected.")]},
      {"id":"doorbell","heading":"Proposal Auto-Drive (the doorbell)","toc":"13.2 · Proposal Auto-Drive",
       "lead":"<p>From <code>/admin/agents</code> you can drive a tenant’s <b>full draft</b> from up top — the “doorbell.” It "
         "fires the exact same engine the customer’s <b>Proposal Studio</b> uses, without you descending into the portal.</p>",
       "steps":[
         S("On the <b>Proposal Auto-Drive</b> card, pick the target proposal and ring the doorbell — it posts a full-draft request (Mode C, full-auto) for that build."),
         S("The request funnels through the one shared helper as the in-portal button, so it lands as a single auditable record; the only difference is <b>source = admin_doorbell</b> vs <b>portal</b>."),
       ],
       "callouts":[{"kind":"note","html":"Advisory, like everything here: the auto-drive drafts across the proposal and lands "
         "in review — it never advances a stage gate, locks, or submits. The tenant sees the drafts arrive in their workspace, "
         "fully attributed."}]},
    ])

# ── 14. Observability trio ────────────────────────────────────────────────────
sec(id="observability", toc="14 · Events · Process · Ledger", heading="Observability — Events, Process Monitor, Ledger",
    where="/admin/events · /admin/process · /admin/processes",
    lead="<p>Three complementary lenses on “what happened, when, and did it finish?” across every tenant.</p>",
    subs=[
      {"id":"events","heading":"Event Stream","toc":"14.1 · Event Stream",
       "img":SHOT+"events.png","caption":"The event stream — filter by namespace, type, and time window.",
       "steps":[
         S("Filter by <b>Namespace</b> (finder/capture/identity/proposal/library/system/tool), a <b>time</b> window "
           "(1h/6h/24h/7d), and toggle <b>Auto-refresh</b> (10s)."),
         S("Each row shows Time · Event · <b>Phase</b> (start/end/single/error) · Actor · Tenant · Payload (click to expand).",
           CROP+"event-row.png","An event row with its phase badge.","half"),
         S("The filter bar drives everything from the URL, so a filtered view is shareable/bookmarkable.",
           CROP+"events-filters.png","The event-stream filter bar.","full"),
       ]},
      {"id":"process","heading":"Process Monitor","toc":"14.2 · Process Monitor",
       "img":SHOT+"process.png","caption":"The process monitor — in-progress, completions, errors, tenant activity.",
       "body":"<p>A real-time view built from events: <b>namespace stat cards</b>, an <b>In Progress</b> list (started-without-"
         "end), <b>Recent Completions</b>, a collapsible <b>Errors</b> panel (auto-expands when non-zero), and a "
         "<b>Tenant Activity (24h)</b> table.</p>"},
      {"id":"processes","heading":"Process Ledger","toc":"14.3 · Process Ledger",
       "img":SHOT+"processes.png","caption":"The process ledger — active instances, health-classified, advanceable inline.",
       "body":"<p>The cross-tenant list of active <code>process_instances</code>, health-classified so problems surface first. "
         "Filter by <b>health</b> chips (Failing/Stalled/Awaiting/Running) or by tenant, and <b>Advance</b> a paused gate inline.</p>"},
    ])

# ── 15. System State ──────────────────────────────────────────────────────────
sec(id="system-state", toc="15 · System State", heading="System State — the operational dashboard",
    where="/admin/system-state",
    lead="<p>A tabbed operational board that auto-refreshes every 30s. The always-on <b>HealthBar</b> (Active Workflows · "
         "Pending Jobs · Events 1h/24h · Automation Rules · Errors 1h) sits above eight tabs.</p>",
    img=SHOT+"system-state.png", caption="System State — HealthBar + eight tabs (Overview, Workflows, Pipeline, Content, Email, Trees, Errors, Volume).",
    steps=[
      S("Start on <b>Overview</b> (top workflows, pipeline, recent errors, event volume)."),
      S("Drill into <b>Active Workflows</b> (expandable cards with per-step status), <b>Pipeline</b> (sources · curation "
        "queue · proposals by stage), <b>Content Pipeline</b>, and <b>Email Automation</b>."),
      S("Use <b>Process Trees</b> (recursive event trees), <b>Errors</b>, and <b>Event Volume</b> (stacked hourly chart) "
        "to diagnose."),
    ],
    table={"title":"The eight System-State tabs","headers":["Tab","What it shows"],"rows":[
      ["Overview","top active workflows, pipeline, recent errors, event-volume chart"],
      ["Active Workflows","every running instance as an expandable card with per-step status + JSON"],
      ["Pipeline","ingestion sources · curation queue by status · proposals by stage"],
      ["Content Pipeline","published/draft blocks, pending reviews, content event timeline"],
      ["Email Automation","rules fired, emails sent/pending, failures, execution log"],
      ["Process Trees","recursive event trees (expand/collapse all)"],
      ["Errors","the full recent-errors table"],
      ["Event Volume","stacked hourly bar chart by namespace"]]},
    subs=[
      {"id":"sys-more","heading":"System Health · Analytics · Storage","toc":"15.1 · Health · Analytics · Storage",
       "body":"<p><b>System Health</b> (<code>/admin/system</code>, master_admin only) is the capacity view — queue depth, "
         "tool-invocation latencies (p50/p95), registered tools, recent errors. <b>Analytics</b> (<code>/admin/analytics</code>) "
         "rolls up tenants, proposals, atoms, revenue, and visitor traffic. <b>Storage</b> (<code>/admin/storage</code>) is the "
         "S3/R2 file manager (Curation Files · Pipeline Artifacts · Customer Storage · Reference Library) with presigned uploads, "
         "folders, rename, and bulk actions.</p>",
       "figures":[F(SHOT+"analytics.png","Analytics — platform + visitor-traffic rollups.","half"),
                  F(SHOT+"storage.png","Storage — the S3/R2 file manager.","half")]},
    ])

# ── 16. Tenants & shadow ──────────────────────────────────────────────────────
sec(id="tenants", toc="16 · Tenants & shadow-descend", heading="Tenants — oversight & shadow-descend",
    where="/admin/tenants · /admin/tenants/<id>",
    lead="<p><b>Tenants</b> is the roster of every company. From a tenant you review its state, tune its AI budget, "
         "archive/restore access, and — the operator’s superpower — <b>shadow-descend</b> into its portal to do work on its "
         "behalf, then rise back to ingest more.</p>",
    img=SHOT+"tenants.png", caption="The tenant roster — users, atoms, proposals per company; + New Company.",
    steps=[
      S("Create a company with <b>+ New Company</b> (name + admin POC email → returns the slug and a temporary password)."),
      S("Open a tenant to see its users, recent activity, and company details.",
        SHOT+"tenant-detail.png","A tenant detail page — users, activity, AI budget, archive control.","full"),
      S("Set an <b>AI Budget &amp; Limits</b> override (monthly budget, rate limit, per-call ceiling) or <b>Archive</b> / "
        "<b>Restore</b> access when a license lapses.",
        CROP+"tenant-aiconfig.png","The per-tenant AI budget override.","half"),
      S("<b>Shadow-descend</b>: enter the tenant’s portal (the session rewrites to tenant_admin, a shadow banner shows), do "
        "the work, and return to <code>/admin</code>. Everything stays audited to their trail.",
        HITL+"shadow-descend.png","Shadow-descend — working inside a tenant’s portal, banner shown.","full"),
    ],
    callouts=[{"kind":"eg","html":"<b>One account, both jobs.</b> <code>eric@rfppipeline.com</code> ingests at "
      "<code>/admin</code>, descends into Immobileyes to build, then rises back up — no separate login."},
      {"kind":"note","html":"<b>Archive = license slumber (reversible).</b> Archiving a company sets its archived-at watermark; "
        "every non-admin user loses access at once (the access gate reads that watermark) and its running workflows cascade to "
        "archived — <i>without</i> touching anyone’s individual membership. <b>Restore</b> lifts the gate and returns everyone to "
        "<i>exactly</i> their prior state (active users active, individually-inactive users still inactive). Nothing is deleted."}])

# ── 17. Billing / Waitlist ────────────────────────────────────────────────────
sec(id="billing", toc="17 · Billing & Waitlist", heading="Billing & Waitlist",
    where="/admin/billing · /admin/waitlist",
    lead="<p>Two lightweight customer screens.</p>",
    figures=[F(SHOT+"billing.png","Billing — revenue, recent purchases, subscription status.","half"),
             F(SHOT+"waitlist.png","Waitlist — marketing-site email captures.","half")],
    body="<p><b>Billing</b> summarizes revenue, recent purchases (with status pills), and per-tenant subscription status. "
         "<b>Waitlist</b> is a read-only list of marketing-page email captures with a <b>View Applications</b> link.</p>")

# ── 18. Site Content ──────────────────────────────────────────────────────────
sec(id="site", toc="18 · Site Content", heading="Site Content — the dynamic-content editor",
    where="/admin/site",
    lead="<p>The public marketing site is edited here as <b>versioned blocks</b>: every save is a snapshot, and publishing "
         "swaps the live version the public site reads. This is the same “dynamic content section” model these very manuals "
         "use — edit data, publish, done.</p>",
    img=SHOT+"site.png", caption="Site Content — pages, site chrome, and documents, each version-controlled.",
    steps=[
      S("Pick a <b>Page</b> (or the Header &amp; Footer, or a <b>Document</b>). Each row shows its live version and draft state.",
        CROP+"site-page-row.png","A site page row with its version + state.","half"),
      S("Edit the <b>blocks</b> — section name, Title, Body, Excerpt, image (with upload), icon, and metadata JSON. "
        "<b>+ Add block</b> appends one."),
      S("Add an <b>audit note</b>, then <b>Preview</b> (iframe of the public path), <b>Save draft</b>, or <b>Publish</b> "
        "(makes it live)."),
    ],
    subs=[
      {"id":"docbuilder","heading":"Document Builder","toc":"18.1 · Document Builder",
       "body":"<p><b>Document Builder</b> (<code>/admin/documents</code>) authors standalone canvas documents (templates, "
         "examples, reference). <b>New Document</b> picks a format preset; the editor is the full canvas with save, "
         "multi-format <b>Export</b> (docx/pptx/xlsx), and version <b>History</b> (restore any prior save).</p>"},
    ])

# ── 19. Worked example: author a real DoD solicitation end-to-end ─────────────
sec(id="worked-dod", toc="19 · Worked example — author a real DoD solicitation",
    heading="Worked example — author a real DoD solicitation (DoW 2026 SBIR & STTR)",
    where="/admin/rfp-curation/<solId>",
    lead="<p>This ties the curation cockpit (§6) together on two <b>real</b> solicitations, ingested from the uploaded "
         "DoW 2026 BAAs (Department of War — the renamed DoD). Each solicitation is unique — you build <b>its own</b> "
         "compliance matrix, volume definitions and document templates from the BAA text, then <b>Push</b>. The two below "
         "are structurally different documents produced from one canvas primitive.</p>",
    img=SHOT+"dow-sbir-curation.png",
    caption="The DoW 2026 SBIR (Navy Phase I) curation workspace — the authored Compliance Matrix (Technical 10pp, Times New Roman 11pt, 1-inch margins, DSIP single-column) and all six DSIP Response Volumes.",
    subs=[
      {"id":"dod-compliance","heading":"Build the compliance matrix from the BAA","toc":"19.1 · Compliance from the BAA",
       "lead":"<p>Read the real requirements off the BAA and set them in the <b>Compliance Matrix</b> rail — these are the "
              "bounding parameters every volume inherits and the export gate enforces.</p>",
       "steps":[
         S("<b>Page limit is component-specific.</b> The DoW 2026 SBIR BAA sets the Technical Volume limit per Service — "
           "e.g. <b>Navy (DON) Phase I = 10 pages</b>. Set <b>Page Limit (Technical)</b> to the value your topic&rsquo;s component states."),
         S("<b>Format floor</b> (BAA §1.4.b): <b>no font smaller than 10-point</b>, 8.5&times;11 paper, <b>one-inch margins</b>, single "
           "column, single-spaced, a per-page header (SBC name · topic # · DSIP #). Set Font, Margins, Line Spacing and Header Required to match."),
         S("The <b>AI</b> pills mark fields Ingest Assist can pre-fill from an uploaded BAA — you confirm every value before Push."),
       ],
       "callouts":[{"kind":"note","html":"Compliance is built <b>per solicitation at ingest</b>, never from a generic preset. "
         "A preset is only a cold-start scaffold — the canvas can bound any document to any solicitation&rsquo;s parameters."}]},
      {"id":"dod-volumes","heading":"Define the volumes and required items","toc":"19.2 · Volume definitions",
       "lead":"<p>Build the <b>Response Volumes</b> skeleton the proposer must produce — for DoW SBIR/STTR that is the full "
              "<b>six-volume DSIP set</b> (the sixth, FWA Training, is easy to miss).</p>",
       "table":{"title":"DoW 2026 SBIR — the six DSIP volumes","headers":["Vol","Volume","Items"],"rows":[
         ["1","Proposal Cover Sheet","DSIP webform"],
         ["2","Technical Volume","12 sections — Identification &amp; Significance → … → assertion of data-rights restrictions (10-page limit)"],
         ["3","Cost Volume","DSIP cost form"],
         ["4","Company Commercialization Report","CCR webform"],
         ["5","Supporting Documents","optional attachments"],
         ["6","Fraud, Waste and Abuse Training","required for Phase I <i>and</i> Direct-to-Phase-II"]]},
       "figures":[F(SHOT+"dow-templates.png","The per-solicitation Technical document templates the builder authors (N261-EXP01, N26D-CAM07) — the section headings + the correct canvas bounds.","full")]},
      {"id":"dod-sttr","heading":"The STTR Direct-to-Phase-II variant","toc":"19.3 · STTR D2P2 differences",
       "lead":"<p>The DoW 2026 STTR BAA produces a structurally different document — the same six volumes, but:</p>",
       "steps":[
         S("<b>Technical Volume = 30 pages</b>, split into a <b>Phase I Proof of Feasibility</b> portion (&le;20pp) and a "
           "<b>Snapshot of Proposed Phase II Effort</b> (&le;10pp)."),
         S("<b>STTR work-split</b> in the compliance custom variables: a minimum <b>40%</b> of the work by the small business "
           "and <b>30%</b> by the single research institution, measured by direct + indirect costs (BAA §1.3)."),
         S("Vol 5 carries the required <b>SBC&harr;RI Allocation-of-Rights</b> agreement."),
       ]},
      {"id":"dod-publish","heading":"Adversarial review, then Push","toc":"19.4 · Review & Push",
       "lead":"<p>Before releasing, sanity-check the authored numbers against the BAA (page limit, font floor, volume count, "
              "the STTR split). Then <b>Push</b> — the fan-out puts the OPP card on every activated tenant&rsquo;s pipeline.</p>",
       "figures":[F(SHOT+"dow-opportunities.png","The two DoW OPP cards on the opportunity list after Push — SBIR (Navy Phase I) and STTR (Direct to Phase II).","full")]},
    ])

spec = {
  "slug": "rfp-admin",
  "title": "RFP-Admin Operations Guide — Run the Platform",
  "nav_title": "RFP-Admin Operations",
  "audience": "RFP Admin · master_admin / rfp_admin",
  "eyebrow": "govwin role guide · RFP Admin",
  "hero": {
    "h1": "Run the Platform, End-to-End",
    "lede": [
      "The complete operator’s manual: every screen in the admin console, in the order you use it — monitor sources, "
      "ingest and curate RFPs, push opportunities, release purchases, oversee every workflow and agent, and shadow-descend "
      "into any company to do the work.",
      "Screenshots are the live console; every button, modal, and status value below is the real thing."
    ],
    "badge": "Complete surface · every screen, button, and status — verified against the live console"
  },
  "footer": "govwin — RFP Pipeline Portal · RFP-Admin role. Canonical automation surface is /admin/workflows; "
            "/admin/process and /admin/processes are legacy lenses on the same runs. Companion guides: Customer-Admin, Collaborator.",
  "sections": SECTIONS,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)

# ── Releases & SLA — the provisioning cockpit ────────────────────────────────
# Restored into the builder after a rebuild dropped it: this section had only ever existed
# in the generated JSON, so regenerating deleted it. The generator is the source of truth.
sec(id="releases", toc="Releases & SLA", heading="Releases & SLA — the provisioning cockpit",
    where="/admin/provisioning · /admin/provisioning/&lt;portalId&gt;",
    lead="<p>This is the screen that <b>lands the 72-hour SLA</b>. A comp-code purchase creates a portal in <code>curation_pending</code>; it queues here until an RFP admin releases it. Reach it from the sidebar as <b>Releases &amp; SLA</b> — the route is <code>/admin/provisioning</code>, and the <code>proposal_setup</code> ToDo on the purchase deep-links straight to the buyer's cockpit.</p>",
    img="docs/manuals/img/shots/admin/releases-sla.png", caption="The release queue when it is clear — the empty state names the next action.",
    steps=[
      S("Open <b>Releases &amp; SLA</b>. Purchased portals are sorted by their 72-hour curation clock, most urgent first. An empty queue says <i>“The release queue is clear.”</i> and links you to Purchases — that is the healthy state, not a fault."),
      S("Open a queued portal to reach its cockpit: the buyer, a live SLA countdown, and the master <b>build-out readiness bar</b> — compliance authored, at least one volume, at least one required item. The bar reads the master solicitation, not this buyer's copy."),
      S("If the master is not ready, follow the deep link into the authoring workspace and finish the build-out. A portal whose master is already built out can be released in one click."),
      S("Press <b>Complete &amp; Release</b>. Two things happen in order: <code>completeBuildOut</code> marks the master built out and broadcasts an <code>updated</code> fan-out to <b>every</b> tenant's mirror card, then <code>provisionAndReleasePortal</code> provisions <b>this buyer's</b> private portal, flips <code>curation_pending → launched</code>, and starts their workflow."),
      S("Confirm the buyer now has an unlocked workspace with a populated compliance matrix, and a required <b>Workflow Setup</b> ToDo waiting for their tenant admin."),
    ],
    callouts=[
      {"kind":"note","html":"The two outcomes are deliberately different in scope. The build-out broadcast touches the <b>shared master</b> — every tenant sees the improved card. The provision touches <b>one buyer's private portal</b>. Segregation and continuity, in that order."},
      {"kind":"tip","html":"The tenant-side <code>?action=release</code> path and this cockpit call the same <code>provisionAndReleasePortal</code> helper, so the two routes cannot drift."},
    ])

json.dump(spec, open(OUT, "w"), ensure_ascii=False, indent=2)
print(f"wrote {OUT}: {len(SECTIONS)} sections, "
      f"{sum(len(s.get('subs',[])) for s in SECTIONS)} subsections")
