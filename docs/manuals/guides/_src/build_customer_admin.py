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
       "callouts":[{"kind":"note","html":"The <b>notification bell</b> polls every 60s and badges unread (or <b>9+</b>). "
         "If an RFP admin is working inside your company on your behalf, an amber <b>shadow-admin banner</b> shows at the top — "
         "everything they do is logged to your audit trail."}]},
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
    img=TS+"atoms.png", caption="The library — tagged atoms with grain, usage, lineage, and visibility.",
    subs=[
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
      ["Archived","closed out"]]})

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
         "edit). A collaborator only ever sees the sections you assign — see the Collaborator guide for the full picture."}]},
      {"id":"opp-card","heading":"Opportunity origin & compliance","toc":"7.4 · Origin & compliance",
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

sec(id="settings", toc="13 · Automation, Settings & Billing", heading="Automation, Settings & Billing",
    where="/automation · /profile · /billing · /portals · /agents",
    lead="<p>Your account and preferences.</p>",
    subs=[
      {"id":"automation","heading":"Automation preferences","toc":"13.1 · Automation",
       "figures":[F(TS+"automation.png","Automation preferences — toggle what runs automatically.","half")],
       "body":"<p><b>Automation</b> (admins) toggles notifications (document ready · collaborator get-ready · stage advanced · "
         "new priority opportunity), AI (review on advance), and flow (auto-advance when all locked). <b>Save</b> to apply.</p>"},
      {"id":"profile","heading":"Company profile","toc":"13.2 · Settings",
       "figures":[F(TS+"profile.png","Settings — your company profile feeds AI drafting.","half")],
       "body":"<p><b>Settings</b> shows your account + subscription and the editable <b>Company Profile</b> (legal name, "
         "website, summary, technology focus, NAICS, set-asides, target agencies, keywords). These fields feed proposal "
         "templates and AI drafting, so keep them current.</p>"},
      {"id":"billing","heading":"Billing & Builds & AI Usage","toc":"13.3 · Billing · Builds · AI",
       "figures":[F(TS+"billing.png","Billing — subscription, consulting, purchase history.","half"),
                  F(TS+"portals.png","Builds — your purchased proposal portals.","half")],
       "body":"<p><b>Billing</b> manages your Spotlight subscription, expert-consulting hours, and purchase history. "
         "<b>Builds</b> (<code>/portals</code>) lists your purchased proposal portals with their lifecycle status "
         "(curation_pending shows the 72h SLA countdown; launched/executing offer stage controls). <b>AI Usage</b> "
         "(<code>/agents</code>) shows your agent calls, allocation used, per-agent breakdown, and recent activity.</p>"},
    ])

# ── 14. Export ────────────────────────────────────────────────────────────────
sec(id="export", toc="14 · Export & deliver", heading="Export — your submission-ready files",
    where="Download Proposal (.docx) · Cost Volume (.xlsx)",
    lead="<p>With a volume locked, download your deliverables. The Technical Volume exports to a submission-ready "
         "<b>.docx</b> (US-Letter, 1″ margins, the agency’s fonts, figures inline &amp; captioned); the Cost Volume to an "
         "<b>.xlsx</b> with live formulas.</p>",
    img=DELIV+"tvp_1.png", caption="Page 1 of the exported Technical Volume — rendered by the system from your locked canvas.",
    callouts=[{"kind":"eg","html":"Verified deliverables: a <b>10-page Technical Volume .docx</b> (6 figures, 5 tables, 8 DON "
      "TV2 sections) and a <b>Cost Volume .xlsx</b> — Base <b>$199,502 ≤ $200k</b>, Option <b>$114,464 ≤ $115k</b>, formulas live."}])

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
