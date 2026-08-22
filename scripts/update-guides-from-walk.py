#!/usr/bin/env python3
"""Fold the 2026-08-22 actor-walk findings into the role guides.

The guides are data-driven (docs/manuals/guides/*.json → build_guides.py), so the
edits belong in the JSON, not the rendered HTML. Each change below is anchored to
something a screenshot showed, and only to that:

  rfp-admin / scouts       the Health column and the Healthy·Degraded tiles cannot
                           move — nothing writes source_health — so the guide must
                           stop teaching an operator to read them (BUG_LOG B53).
  rfp-admin / releases     "Releases & SLA" (/admin/provisioning) is the surface that
                           lands the 72h SLA, and the guide had no section for it.
  customer-admin / cards   "Include closed" now means closed; say what unchecked hides.

Idempotent: re-running replaces the same keys rather than appending duplicates.
"""
import json
import sys

GUIDES = "/home/user/govwin/docs/manuals/guides"


def load(name):
    with open(f"{GUIDES}/{name}.json") as fh:
        return json.load(fh)


def save(name, doc):
    with open(f"{GUIDES}/{name}.json", "w") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def section(doc, sid):
    for s in doc["sections"]:
        if s.get("id") == sid:
            return s
    return None


def upsert_after(doc, after_id, new_section):
    """Replace a section with the same id, else insert it after `after_id`."""
    for i, s in enumerate(doc["sections"]):
        if s.get("id") == new_section["id"]:
            doc["sections"][i] = new_section
            return
    for i, s in enumerate(doc["sections"]):
        if s.get("id") == after_id:
            doc["sections"].insert(i + 1, new_section)
            return
    doc["sections"].append(new_section)


# ── rfp-admin ────────────────────────────────────────────────────────────────
admin = load("rfp-admin")

sc = section(admin, "scouts")
if sc is None:
    print("rfp-admin: no scouts section", file=sys.stderr)
    sys.exit(1)
sc["img"] = "docs/manuals/img/shots/admin/scouts.png"
sc["steps"] = [
    {"t": "Read the stage strip across the top — <b>Sources → Scout Monitor → Intake → RFP Curation "
          "→ Opportunity Cards</b>. The badges are live counts, so it doubles as a queue depth gauge: "
          "if Intake is climbing and Curation is flat, triage is the bottleneck."},
    {"t": "Work <b>Candidate opportunities — new or updated</b> first. Scout findings land here "
          "classified NEW vs UPDATE; release a new one into RFP intake, log an update as an amendment "
          "on the matched opportunity, or dismiss it. This is the only part of the page that is a queue."},
    {"t": "Read <b>Recent scout runs</b> and <b>Changes detected</b> to confirm the pool is actually "
          "finding things. Runs come from <code>pipeline_jobs kind='scout_source'</code>, so a "
          "<code>completed</code> row here is real evidence a source was visited.",
     "img": "docs/manuals/img/crops/admin/scout-health.png",
     "cap": "Active sources 6 · Healthy 0 — the Healthy and Degraded tiles are not wired to anything."},
    {"t": "<b>Ignore the Health column and the Healthy / Degraded tiles.</b> They read from "
          "<code>source_health</code>, which is seeded once at install and never written again — no "
          "job updates it. Health therefore shows <code>unknown</code> and Last success shows "
          "<code>never</code> for every source, forever, even while runs are completing normally. "
          "Judge the pool by Recent scout runs instead."},
    {"t": "Set up sources and kick a crawl from the <b>Sources</b> page — this screen is a monitor "
          "only, with no controls of its own."},
]
sc["callouts"] = [
    {"kind": "warn",
     "html": "<b>Healthy 0 does not mean the pool is down.</b> Nothing in the frontend or the pipeline "
             "writes <code>source_health</code>; the tiles are structurally always zero. A pool that "
             "is genuinely working looks exactly like a pool that is dead on this panel — so read "
             "<b>Recent scout runs</b>, which is sourced from real job rows. Tracked as B53 in "
             "docs/BUG_LOG_2026-08-19.md."},
    {"kind": "note",
     "html": "Scouts run managed and audited — a run that fails on one source continues on the others; "
             "nothing dead-ends. Kick a run from Sources → Scout Now."},
]

upsert_after(admin, "purchases", {
    "id": "releases",
    "toc": "Releases & SLA",
    "heading": "Releases & SLA — the provisioning cockpit",
    "where": "/admin/provisioning · /admin/provisioning/&lt;portalId&gt;",
    "lead": "<p>This is the screen that <b>lands the 72-hour SLA</b>. A comp-code purchase creates a "
            "portal in <code>curation_pending</code>; it queues here until an RFP admin releases it. "
            "Reach it from the sidebar as <b>Releases &amp; SLA</b> — the route is "
            "<code>/admin/provisioning</code>, and the <code>proposal_setup</code> ToDo on the purchase "
            "deep-links straight to the buyer's cockpit.</p>",
    "img": "docs/manuals/img/shots/admin/releases-sla.png",
    "caption": "The release queue when it is clear — the empty state names the next action.",
    "steps": [
        {"t": "Open <b>Releases &amp; SLA</b>. Purchased portals are sorted by their 72-hour curation "
              "clock, most urgent first. An empty queue says <i>“The release queue is clear.”</i> and "
              "links you to Purchases — that is the healthy state, not a fault."},
        {"t": "Open a queued portal to reach its cockpit: the buyer, a live SLA countdown, and the "
              "master <b>build-out readiness bar</b> — compliance authored, at least one volume, at "
              "least one required item. The bar reads the master solicitation, not this buyer's copy."},
        {"t": "If the master is not ready, follow the deep link into the authoring workspace and finish "
              "the build-out. A portal whose master is already built out can be released in one click."},
        {"t": "Press <b>Complete &amp; Release</b>. Two things happen in order: "
              "<code>completeBuildOut</code> marks the master built out and broadcasts an "
              "<code>updated</code> fan-out to <b>every</b> tenant's mirror card, then "
              "<code>provisionAndReleasePortal</code> provisions <b>this buyer's</b> private portal, "
              "flips <code>curation_pending → launched</code>, and starts their workflow."},
        {"t": "Confirm the buyer now has an unlocked workspace with a populated compliance matrix, and "
              "a required <b>Workflow Setup</b> ToDo waiting for their tenant admin."},
    ],
    "callouts": [
        {"kind": "note",
         "html": "The two outcomes are deliberately different in scope. The build-out broadcast touches "
                 "the <b>shared master</b> — every tenant sees the improved card. The provision touches "
                 "<b>one buyer's private portal</b>. Segregation and continuity, in that order."},
        {"kind": "tip",
         "html": "The tenant-side <code>?action=release</code> path and this cockpit call the same "
                 "<code>provisionAndReleasePortal</code> helper, so the two routes cannot drift."},
    ],
})
save("rfp-admin", admin)

# ── customer-admin ───────────────────────────────────────────────────────────
cust = load("customer-admin")
cards = section(cust, "cards")
if cards is None:
    print("customer-admin: no cards section", file=sys.stderr)
    sys.exit(1)
cards["img"] = "docs/manuals/img/shots/tenant/cards.png"
steps = cards.get("steps") or []
steps[0] = {
    "t": "By default the list shows only opportunities you can still bid on. <b>Include closed</b> adds "
         "back the ones whose close date has passed or that we have marked closed; <b>Show passed</b> "
         "adds back the ones you marked <i>Not interested</i>. <b>Refresh</b> re-pulls, and the count "
         "beside it always describes what is on screen.",
    "img": "docs/manuals/img/crops/tenant/cards-filter.png",
    "cap": "Unchecked means open only — the count reflects the filtered list, not the total.",
}
cards["steps"] = steps
cards.setdefault("callouts", []).insert(0, {
    "kind": "note",
    "html": "An opportunity with no published close date is treated as open and stays on the list — we "
            "would rather show you one you cannot bid on than hide one you can.",
})
save("customer-admin", cust)

print("guides updated: rfp-admin (scouts rewritten, releases added), customer-admin (cards filter)")
