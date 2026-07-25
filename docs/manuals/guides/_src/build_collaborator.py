#!/usr/bin/env python3
"""Authoring source for the Collaborator Guide (partner_user).
Emits docs/manuals/guides/collaborator.json. Grounded in the live access model
(resolveUserAccess, capabilities.ts, the collaborator API routes)."""
import json, os

OUT = "/home/user/govwin/docs/manuals/guides/collaborator.json"
CB = "docs/manuals/img/collab/"
TC = "docs/manuals/img/crops/tenant/"
PROP = "docs/proposals/immobileyes-cuas/img/"

def S(t, img=None, cap=None, w="half"):
    d = {"t": t}
    if img: d["img"] = img; d["cap"] = cap or ""; d["w"] = w
    return d
def F(img, cap="", w="full"): return {"img": img, "cap": cap, "w": w}

SECTIONS = []
def sec(**k): SECTIONS.append(k)

# ── 1. Orientation ────────────────────────────────────────────────────────────
sec(id="orientation", toc="1 · Who you are", heading="Orientation — a scoped collaborator",
    where="invite email → /portal/<company>/proposals",
    lead="<p>You’ve been invited to help on one proposal at one company. This guide is your whole world in the platform: "
         "what you can open, how you contribute, and where your assignments live. Collaborators are <b>stage-scoped</b> — your "
         "access is granted per section and per permission (view, comment, or edit).</p>",
    img=CB+"collab-landing.png", caption="The collaborator landing — scoped to the work you were invited to.",
    callouts=[{"kind":"note","html":"There are two kinds of invite. An <b>External</b> invite makes you a "
      "<b>partner_user</b> — the scoped collaborator this guide covers. A <b>Contributor</b> invite makes you internal "
      "staff (tenant-wide). If you see the full company sidebar, you were invited as a Contributor; if you see only "
      "<b>Proposals</b>, you’re an External collaborator."}])

# ── 2. Accept ─────────────────────────────────────────────────────────────────
sec(id="accept", toc="2 · Accept your invite", heading="Accept your invite & sign in",
    where="/invite/<token>  →  /change-password  →  the proposal",
    lead="<p>Your invite arrives as a deep-linked email from the company that wants your help.</p>",
    steps=[
      S("Follow the email link to <b>/invite/&lt;token&gt;</b>. The <b>Accept Invitation</b> page names the inviter, the "
        "proposal, the company, and your email."),
      S("Set a <b>Password</b> (at least 12 characters) and <b>Confirm Password</b>, then <b>Set Password &amp; Accept</b>. "
        "You’re dropped straight into the proposal workspace."),
      S("If you’re an existing user, you’re auto-accepted and the email links you straight to the proposal — no password step."),
    ],
    callouts=[{"kind":"note","html":"A revoked invite shows <i>“This invitation is no longer valid.”</i> An already-used one "
      "shows <b>Invite Already Accepted</b> with a <b>Go to Login</b> button. First sign-in on a fresh account asks you to "
      "change your temporary password before anything else."}])

# ── 3. Scoped landing ─────────────────────────────────────────────────────────
sec(id="landing", toc="3 · Your landing", heading="Your landing — only your assigned work",
    where="/portal/<company>/proposals",
    lead="<p>Unlike a customer admin, your home is the <b>proposals list scoped to you</b>. The sidebar shows only "
         "<b>Proposals</b> (plus the notification bell and Sign out) — no dashboard, pipeline, library, or billing.</p>",
    img=CB+"collab-dashboard.png", caption="The scoped landing — the proposals you’re invited to, and only those.",
    steps=[
      S("Open the proposal you were invited to. Inside, the workspace defaults to the <b>My Sections</b> tab — the sections "
        "assigned to you, each with a permission pill (edit / comment / view)."),
      S("If nothing’s assigned yet, you’ll see <i>“No sections are assigned to you yet.”</i> until an admin adds you."),
    ],
    callouts=[{"kind":"note","html":"Navigating to a company screen you’re not scoped for (dashboard, library, buckets, "
      "billing) simply redirects you back to <b>Proposals</b>. Nothing breaks — you’re gently kept in your lane."}])

# ── 4. Contribute ─────────────────────────────────────────────────────────────
sec(id="workspace", toc="4 · The workspace", heading="Inside the proposal — your view",
    where="/portal/<company>/proposals/<id>",
    lead="<p>The proposal workspace, scoped to you, is organized into what you can act on.</p>",
    img=CB+"collab-activity.png", caption="Inside a proposal — your assignments, dropbox, and the activity timeline.",
    body="<p>The <b>Contributor View</b> groups your work: <b>My Assignments</b> (or <b>Shared With Me</b> for externals) — "
         "the sections you can edit, each with a status badge, page progress, and <b>Open Editor →</b>; <b>My Dropbox</b> — "
         "your private file drop for this proposal; <b>Add content</b> — offer a document into the company library; "
         "<b>Sections (Comment Only)</b> with <b>View &amp; Comment</b>; and <b>Other Sections (View Only)</b> with "
         "<b>View</b>. A <b>Timeline</b> tab shows the proposal’s activity feed.</p>",
    steps=[
      S("Open a section you can edit and work in the same <b>canvas editor</b> the customer uses — headings, text, lists, "
        "tables, images as structured nodes.",
        PROP+"22-canvas-section.png","The canvas editor — your contribution surface (per your edit grant).","full"),
      S("Your edits save to the shared draft. The section owner reviews and, when it’s right, <b>Accepts &amp; Locks</b> it "
        "— that’s an admin action; your job is to get the content right and save."),
    ])

# ── 5. Permission matrix (the centerpiece) ────────────────────────────────────
sec(id="permissions", toc="5 · What each grant unlocks", heading="Your permission matrix",
    where="view · comment · edit",
    lead="<p>Everything you can do flows from your grant on a section. Here is exactly what each level unlocks — this is the "
         "single most useful reference in this guide.</p>",
    table={"title":"What view / comment / edit unlock","headers":["Control","Edit","Comment","View"],"rows":[
      ["Edit canvas nodes (type, drag, reorder)","✅","—","—"],
      ["Formatting toolbar + insert blocks","✅","—","—"],
      ["<b>+ From Library</b> (insert atoms)","✅","—","—"],
      ["AI Revision panel","✅","—","—"],
      ["Undo / Redo · <b>Save</b>","✅","—","—"],
      ["Add / reply to <b>comments</b>","✅","✅","—"],
      ["Resolve a comment","✅","✅","✅*"],
      ["Read the section (read-only)","✅","✅","✅"],
      ["Compliance / History / Review tabs","✅","✅","✅"],
      ["Export the section (after first lock)","✅","✅","✅"],
      ["Accept &amp; Lock · advance stage · manage team","—","—","—"]]},
    callouts=[{"kind":"note","html":"* A <b>view</b> collaborator can resolve a comment on a section they can see, but their "
      "comment <i>posts</i> are rejected. Accepting/locking, advancing stages, and exporting the whole proposal are always "
      "admin-only — a collaborator’s contribution ends at <b>Save</b> + <b>comment</b>."}])

# ── 6. Comments ───────────────────────────────────────────────────────────────
sec(id="comments", toc="6 · Comment & suggest", heading="Comment & suggest",
    where="section canvas → Node / Review tab",
    lead="<p>Comments are how you contribute without changing the draft directly. They thread per section (surfaced in the "
         "<b>Node</b> tab when a node is selected, and in the dedicated <b>Review</b> tab).</p>",
    steps=[
      S("Type in <b>Add comment…</b> and press Enter or click <b>Add</b>. A “reply” is simply another comment on the same "
        "section thread."),
      S("Click <b>Resolve</b> (on a human comment) or <b>Dismiss</b> (on an <b>🤖 AI Review</b> item). Resolved comments "
        "collapse under a <b>Show/Hide N resolved</b> toggle."),
    ],
    callouts=[{"kind":"tip","html":"Resolving is one-way (there’s no un-resolve), and comments can’t be edited or deleted — "
      "so post a fresh comment to add or correct something."}])

# ── 7. Files ──────────────────────────────────────────────────────────────────
sec(id="files", toc="7 · Files & content", heading="Files — dropbox & add content",
    where="section workspace → My Dropbox · Add content",
    lead="<p>Two ways to move files.</p>",
    body="<p><b>My Dropbox</b> is your <b>private</b> per-proposal file drop — you see only your own files (delete your own "
         "with the <b>×</b>). <b>Add content</b> lets you offer a document into the company library: drop a file and it’s "
         "atomized (<i>“Atomized N files into M atoms. Review in Library.”</i>). The upload works even though the Library link "
         "itself is out of your scope — an admin reviews what you contributed.</p>",
    callouts=[{"kind":"note","html":"Uploads are blocked once the proposal is locked (you’ll get a clear message). Before the "
      "first lock, section export is also unavailable (<i>“Downloads available after final review and lock”</i>)."}])

# ── 8. Collaboration vaults (nooks) ───────────────────────────────────────────
sec(id="vaults", toc="8 · Collaboration vaults", heading="Collaboration vaults (“nooks”) — your shared workspace",
    where="/vaults",
    lead="<p>A <b>nook</b> is a private, segregated workspace between you and a customer — a place to hand content back and "
         "forth without either side seeing the other’s wider library. It is separate from proposal collaboration: if a customer "
         "invites you into a nook, you reach it at <b>/vaults</b> (the platform routes you there automatically at sign-in when "
         "you have no proposal assignment). You see <b>only</b> the nook(s) you were invited to — never the customer’s main "
         "library, and never another partner’s nook.</p>",
    img="docs/manuals/img/shots/tenant/vaults-collab-detail.png",
    caption="Your nook — a dedicated Collaboration surface (no customer nav, no other partners). Download whole artifacts, "
            "add your own; the whole-only note sits at the foot of the list.",
    steps=[
      S("Sign in. If your only access is a nook, you land on <b>/vaults</b> — a simple list of the customer(s) you collaborate "
        "with. Click <b>Open nook →</b> to enter.",
        "docs/manuals/img/shots/tenant/vaults-collab-index.png","Your /vaults list — only the customer(s) you collaborate with.","half"),
      S("<b>Add an artifact</b> — name it, pick its form (Document · Deck · Sheet · PDF), and add it. Your upload is atomized "
        "into the nook (it is <i>invisible</i> to the customer’s main library until they choose to harvest it)."),
      S("<b>Download</b> a whole artifact in any format (.docx · .pptx · .xlsx · .pdf). You can download <b>whole</b> artifacts "
        "only — pulling out individual sections is a customer-side action."),
    ],
    table={"title":"What you can do in a nook","headers":["Action","Collaborator (you)","Customer (owner)"],"rows":[
      ["Upload &amp; atomize an artifact","✅","✅"],
      ["Download a <b>whole</b> artifact","✅","✅"],
      ["Download an individual <b>section / atom</b>","—","✅"],
      ["Harvest content into the proposal library","—","✅"],
      ["Invite / remove members, close the nook","—","✅"]]},
    callouts=[{"kind":"note","html":"When you add content, the customer is notified and a review task is raised on their side — "
      "they decide what (if anything) to pull into their proposal. Only add content you’re comfortable with the customer using."},
      {"kind":"tip","html":"A nook is deliberately quiet: no main-library clutter, no other partners. Everything you add stays "
      "scoped to that one customer relationship."}])

# ── 9. Scope boundaries ───────────────────────────────────────────────────────
sec(id="scope", toc="9 · What you can’t see", heading="Scope boundaries — what’s out of reach",
    where="redirects / access checks",
    lead="<p>By design, a collaborator can’t see the company’s book of business. This keeps their pipeline, library, and "
         "billing private while still letting you do the work you were brought in for.</p>",
    table={"title":"Where the boundaries are","headers":["You try to open","What happens"],"rows":[
      ["Dashboard · Opportunities · Buckets · Library · Builds · Processes · Activity · Team · Documents · Settings","redirected to <b>Proposals</b>"],
      ["Billing · AI Usage · Automation","redirected (admin-only)"],
      ["A section you weren’t assigned","<b>not found</b> — you can’t even open it by URL"],
      ["An edit on a comment/view section","rejected server-side (403) even if you forge the request"]]},
    callouts=[{"kind":"note","html":"Access is a living grant. An admin can widen it (view → comment → edit), narrow it, or "
      "<b>revoke</b> it. If your access ends, your collaborator membership at that company is cleanly removed — without "
      "touching any other company you collaborate with. Re-inviting a revoked email restores the same record with fresh grants."}])

# ── 10. Lifecycle ─────────────────────────────────────────────────────────────
sec(id="lifecycle", toc="10 · Your lifecycle & states", heading="Your lifecycle & states",
    where="invite → accept → contribute → (revoke)",
    lead="<p>A quick reference for where you stand at any moment.</p>",
    table={"title":"Collaborator states","headers":["State","What you see"],"rows":[
      ["Pending","invite sent, not yet accepted — the /invite link is live until used or revoked"],
      ["Empty assigned-work","accepted but nothing assigned yet — “No sections are assigned to you yet.”"],
      ["Active with grants","only your assigned sections at your granted permission, plus dropbox &amp; add-content"],
      ["Locked proposal","the review/locked banner; saving &amp; uploading pause; export of your sections opens after the first lock"],
      ["Revoked","access ends immediately; the invite link reads “no longer valid.” Re-invite restores it"]]},
    callouts=[{"kind":"eg","html":"Your contribution is real work the team depends on — draft and comment your assigned "
      "sections, keep your dropbox current, and the admin carries it across the finish line by accepting and locking."}])

spec = {
  "slug": "collaborator",
  "title": "Collaborator Guide — Contribute to a Proposal",
  "nav_title": "Collaborator Guide",
  "audience": "Collaborator · partner_user",
  "eyebrow": "govwin role guide · Collaborator",
  "hero": {
    "h1": "Contribute to a Proposal, Scoped to You",
    "lede": [
      "You were invited to help on one proposal. This guide is your complete manual: accept the invite, find your assigned "
      "sections, contribute in the canvas, comment, move files, and understand exactly what each grant unlocks.",
      "Collaborators are stage-scoped — you see exactly what you were invited to, and nothing else."
    ],
    "badge": "Scoped access · every control your grant unlocks, and every boundary"
  },
  "footer": "govwin — RFP Pipeline Portal · Collaborator role. Your access is granted per proposal by that company’s admin and "
            "can be adjusted or revoked at any time. Companion guides: Customer-Admin, RFP-Admin Operations.",
  "sections": SECTIONS,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(spec, open(OUT, "w"), ensure_ascii=False, indent=2)
print(f"wrote {OUT}: {len(SECTIONS)} sections, {sum(len(s.get('subs',[])) for s in SECTIONS)} subsections")
