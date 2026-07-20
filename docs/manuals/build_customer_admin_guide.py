#!/usr/bin/env python3
"""Build the first role manual — Customer-Admin proposal-build guide — as a
self-contained, indexed, clickable HTML file with embedded screenshots."""
import base64, io, os
from PIL import Image

ROOT = "/home/user/govwin"
OUT = f"{ROOT}/docs/manuals/CUSTOMER_ADMIN_PROPOSAL_BUILD_GUIDE.html"

def img(path, maxw=1040, q=82):
    im = Image.open(path).convert("RGB")
    if im.size[0] > maxw:
        im = im.resize((maxw, int(im.size[1] * maxw / im.size[0])))
    b = io.BytesIO(); im.save(b, "JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

S = {
    "dash": img(f"{ROOT}/docs/manuals/img/tenant/portal-dashboard.png"),
    "cards": img(f"{ROOT}/docs/proposals/immobileyes-cuas/img/01-cards.png"),
    "buckets": img(f"{ROOT}/docs/manuals/img/tenant/portal-buckets.png"),
    "atoms": img(f"{ROOT}/docs/proposals/immobileyes-cuas/img/faithful/A-atoms-real-atomizer.png"),
    "matrix": img(f"{ROOT}/docs/proposals/immobileyes-cuas/img/21-proposal-workspace.png"),
    "canvas": img(f"{ROOT}/docs/proposals/immobileyes-cuas/img/22-canvas-section.png"),
    "locked": img(f"{ROOT}/docs/proposals/immobileyes-cuas/img/faithful/CD-workspace-cost-locked.png"),
    "docx": img("/tmp/tvp_1.png"),
}

# (anchor, TOC label, heading, route/tool, body-html, image-key, caption)
STEPS = [
    ("signin", "1 · Sign in & your portal", "Sign in & your portal",
     "/portal/&lt;company&gt;/dashboard",
     "<p>Sign in with the credentials your RFP-Pipeline admin issued. Your <b>dashboard</b> is role-aware: it opens on your company's workspace and surfaces your live <b>ToDos</b> — opportunities to review, proposals in progress, and anything waiting on you.</p>",
     "dash", "The customer-admin landing: your workspace + role-aware ToDos."),
    ("cards", "2 · Find your opportunity", "Find your opportunity (ranked cards)",
     "/portal/&lt;company&gt;/cards",
     "<p>The <b>Opportunity Pipeline</b> shows every opportunity the platform has pushed to you, <b>ranked by your Spotlight buckets</b>. Each card carries the agency, program, and close date. <b>Pin</b> copies the solicitation's documents into your workspace; <b>Build</b> opens the proposal workspace.</p>"
     "<p class='eg'>In the verified run, the NAVAIR/NAVSEA Counter-UAS topic <b>DON26BX03-NP002</b> ranks <b>#1</b> for Immobileyes — the best fit for a counter-drone optics company.</p>",
     "cards", "The DON26BX03-NP002 C-UAS card ranked #1 in the Immobileyes pipeline."),
    ("buckets", "3 · Set your scoring criteria", "Set your scoring criteria (buckets)",
     "/portal/&lt;company&gt;/buckets",
     "<p><b>Spotlight buckets</b> are your scoring criteria — the themes you care about (e.g. “Counter-UAS”, “AI sensor fusion”). Every card is scored against each bucket, and editing a bucket <b>re-ranks your pipeline</b> automatically. This is deterministic today; an optional scoring agent overlays it later.</p>",
     "buckets", "Buckets define what ranks to the top of your pipeline."),
    ("library", "4 · Build your content library", "Build your content library (upload → atomize)",
     "/portal/&lt;company&gt;/atoms  ·  Upload package → atomize-package",
     "<p>Your library is the raw material every draft is built from. On <b>Library → Upload package</b>, drop your past proposals, capability docs, résumés, and data (PDF, DOCX, PPTX, XLSX). The <b>atomizer</b> deconstructs each file into a <b>reference atom</b> (the whole doc) plus one <b>primitive atom</b> per substantive block, and <b>auto-tags</b> them against the shared taxonomy (volume, kind, agency, program, phase).</p>"
     "<p class='eg'>Verified: five Immobileyes documents (GHOST draft, TACFI Technical Volume, résumés, foreign affiliations, cost proposal) atomized into <b>24 atoms</b> — tagged <span class='tag'>vol:technical</span> <span class='tag'>vol:cost</span> <span class='tag'>vol:key_personnel</span> <span class='tag'>kind:bio</span> and more. Each uploaded package also gets a <b>“Save as template”</b> button (templify) to reuse its winning structure.</p>",
     "atoms", "The real atomizer: 24 tagged atoms from five uploaded Immobileyes documents."),
    ("matrix", "5 · Open the proposal & matrix", "Open the proposal & compliance matrix",
     "/portal/&lt;company&gt;/proposals/&lt;id&gt;",
     "<p>Opening a proposal provisions the full <b>compliance matrix</b> — every required volume and item the solicitation demands, each linked to a section “mold” that carries the format rules (page limit, margins, font). The specific agency <b>template</b> is built into the matrix, so the structure is correct before you write a word.</p>"
     "<p class='eg'>Verified: the DON <b>6-volume CSO structure</b> (Cover · Technical · Cost · CCR · Supporting · FWA), with <b>Volume 2</b> aligned to the DON Phase-I Open-Topic <b>Technical Volume 2 template</b> (8 sections).</p>",
     "matrix", "The 6-volume matrix; Volume 2 aligned to the DON TV2 template, ready to draft."),
    ("draft", "6 · Draft with the AI agent", "Draft each section with the AI agent",
     "proposal.draft_section  (“Draft all sections”)",
     "<p>Open a section and click <b>Draft</b> (or <b>Draft all sections</b>). The <b>drafting agent</b> reads the RFP context and the section's compliance mold, pulls the most relevant <b>atoms from your library</b>, and writes canvas content sized to the page budget — you review, pick atoms, and revise in the canvas editor. Nothing auto-commits: it's advisory until you accept.</p>"
     "<p class='eg'>Verified: the <code>proposal.draft_section</code> agent tool ran on all <b>8 Technical-Volume sections</b>, grounded in the atomized library, applying its budget/fit check (≈ a 2-page, ~1,090-word target per section).</p>",
     "canvas", "The canvas editor — draft, pick atoms, and revise each section."),
    ("lock", "7 · Accept & Lock", "Accept & Lock → the matrix turns green",
     "lockSectionCore  (Accept & Lock)",
     "<p>When a section is right, <b>Accept &amp; Lock</b> it. Locking flips its <b>compliance row to “satisfied,”</b> snapshots the version, harvests reusable content back into your library, and rolls the volume up. When every section of a volume is locked, the volume shows <b>✓ Volume locked</b> and downloads unlock.</p>"
     "<p class='eg'>Verified: locking via <code>lockSectionCore</code> turned <b>10 matrix rows green</b> (8 Technical + 2 Cost). Volume 2 reads <b>“8/8 locked · 9/10 pages · ✓ Volume locked.”</b></p>",
     "locked", "Volumes locked; matrix satisfied; the Cost Volume built from a live-formula canvas."),
    ("export", "8 · Export your downloadables", "Export your downloadables",
     "Download Proposal (.docx) · Cost Volume (.xlsx)",
     "<p>With the volume locked, <b>Download</b> your deliverables. The <b>Technical Volume</b> exports to a submission-ready <b>.docx</b> (US-Letter, 1″ margins, the agency's fonts, figures inline and captioned). The <b>Cost Volume</b> exports to an <b>.xlsx</b> with <b>live formulas</b>.</p>"
     "<p class='eg'>Verified deliverables: a <b>10-page Technical Volume .docx</b> (6 figures, 5 tables, all 8 DON TV2 sections) and a <b>Cost Volume .xlsx</b> — Base <b>$199,502 ≤ $200k</b>, Option <b>$114,464 ≤ $115k</b>, formulas live.</p>",
     "docx", "Page 1 of the exported Technical Volume — rendered by the system from your locked canvas."),
]

toc = "\n".join(f'<li><a href="#{a}">{lbl}</a></li>' for a, lbl, *_ in STEPS)
body = ""
for a, lbl, h, route, html, ik, cap in STEPS:
    body += f"""
    <section id="{a}">
      <h2>{h}</h2>
      <div class="route"><span>where</span> <code>{route}</code></div>
      {html}
      <figure><img src="{S[ik]}" alt="{cap}"/><figcaption>{cap}</figcaption></figure>
    </section>"""

HTML = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Customer Admin Guide — Build a Winning Proposal</title>
<style>
:root{{--ink:#1a2230;--mut:#5b6672;--line:#e3e8ef;--brand:#1f3864;--accent:#2563eb;--eg:#eef4ff;--egb:#c9dcff;--bg:#fff}}
*{{box-sizing:border-box}}
body{{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}}
a{{color:var(--accent);text-decoration:none}} a:hover{{text-decoration:underline}}
.wrap{{display:grid;grid-template-columns:288px 1fr;max-width:1240px;margin:0 auto}}
nav{{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:28px 22px;border-right:1px solid var(--line);background:#fafbfd}}
nav h1{{font-size:16px;margin:0 0 4px;color:var(--brand)}}
nav .sub{{font-size:12.5px;color:var(--mut);margin-bottom:18px}}
nav ol{{list-style:none;margin:0;padding:0;counter-reset:s}}
nav li{{margin:2px 0}} nav a{{display:block;padding:7px 10px;border-radius:7px;color:var(--ink);font-size:14px}}
nav a:hover{{background:#eef2f7;text-decoration:none}}
main{{padding:44px 52px;max-width:900px}}
.hero{{border-bottom:2px solid var(--line);padding-bottom:22px;margin-bottom:8px}}
.hero h1{{font-size:30px;margin:0 0 6px;color:var(--brand);letter-spacing:-.4px}}
.hero p{{color:var(--mut);margin:.2em 0}}
.badge{{display:inline-block;background:var(--eg);border:1px solid var(--egb);color:var(--brand);font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;margin-top:8px}}
section{{padding:30px 0;border-bottom:1px solid var(--line)}}
h2{{font-size:22px;color:var(--brand);margin:0 0 6px;letter-spacing:-.3px}}
.route{{font-size:12.5px;color:var(--mut);margin:0 0 12px}}
.route span{{display:inline-block;background:#eef2f7;color:#48566a;border-radius:5px;padding:1px 7px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}}
code{{background:#f3f5f9;border:1px solid #e6eaf0;border-radius:5px;padding:1px 6px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#334}}
p.eg{{background:var(--eg);border:1px solid var(--egb);border-left:3px solid var(--accent);border-radius:8px;padding:12px 15px;margin:14px 0;font-size:14.5px}}
.tag{{display:inline-block;background:#e8f0ff;border:1px solid #cfe0ff;color:#2b4a86;border-radius:5px;padding:0 6px;font-size:12px;margin:0 2px}}
figure{{margin:18px 0 0}} figure img{{width:100%;border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 14px rgba(20,40,80,.09)}}
figcaption{{font-size:13px;color:var(--mut);text-align:center;margin-top:8px;font-style:italic}}
.foot{{color:var(--mut);font-size:13px;padding:26px 0 60px}}
@media(max-width:880px){{.wrap{{grid-template-columns:1fr}} nav{{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}} main{{padding:28px 20px}}}}
</style></head><body>
<div class="wrap">
<nav>
  <h1>Proposal Build Guide</h1>
  <div class="sub">Customer Admin · govwin portal</div>
  <ol>{toc}</ol>
</nav>
<main>
  <div class="hero">
    <h1>Build a Winning Proposal, End-to-End</h1>
    <p>The customer's eight-step journey through the govwin proposal portal — from a ranked
       opportunity to a submission-ready, downloadable proposal.</p>
    <p>Every step below was verified on a real effort: the <b>Immobileyes NAVAIR/NAVSEA
       Counter-UAS SBIR</b> (topic DON26BX03-NP002). The screenshots are that live run.</p>
    <span class="badge">Verified end-to-end · all steps through the platform's real tools &amp; agents</span>
  </div>
  {body}
  <p class="foot">govwin — RFP Pipeline Portal · Customer Admin role. Under-the-hood references (routes, tools,
     cores) are shown so the guide doubles as living documentation. Companion guides: RFP-Admin Operations,
     Collaborator. </p>
</main>
</div></body></html>"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(HTML)
print("wrote", OUT, f"({len(HTML)//1024} KB)")
