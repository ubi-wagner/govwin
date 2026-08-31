#!/usr/bin/env python3
"""
Data-driven role-manual builder.

Content lives in JSON (docs/manuals/guides/*.json) — the "dynamic content section"
model: edit the data, re-run this, and the presentation regenerates. Nobody hand-edits
the rendered HTML.

Per guide it emits <SLUG>.html (indexed, screenshots embedded as base64, sticky TOC),
<SLUG>.pdf (Chromium print), plus index.html (landing) and manuals.html (combined web view).

Section schema (all fields optional except id + heading):
  id, toc, heading, where            — anchor, sidebar label, H2, "where" route/tool chip
  lead                               — intro HTML before the steps
  body                               — freeform HTML (string or list of strings)
  steps  : [{t, img?, cap?, w?}]     — numbered walkthrough; each step may carry a crop
  figures: [{img, cap?, w?}]         — figure gallery (w: full|half|third)
  table  : {title?, headers:[], rows:[[]]}   — reference table (badge values, matrices)
  callouts: [{kind:eg|note|tip|warn, html}]
  subs   : [{id, heading, where?, lead?, body?, steps?, figures?, table?, callouts?}]
  img, caption                       — single trailing figure (legacy, still honored)

Usage:
  python3 docs/manuals/build_guides.py            # all guides + index + combined
  python3 docs/manuals/build_guides.py rfp-admin  # one guide (+ index + combined)
  python3 docs/manuals/build_guides.py --no-pdf   # skip the Chromium PDF pass
"""
import base64, io, json, os, subprocess, sys, html as _html

ROOT = "/home/user/govwin"
MANUALS = f"{ROOT}/docs/manuals"
GUIDES = f"{MANUALS}/guides"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

try:
    from PIL import Image
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False


# ── assets ────────────────────────────────────────────────────────────────────
_img_cache = {}
try:
    import revisions as _rev
except ImportError:  # invoked from the repo root rather than docs/manuals
    import importlib.util as _ilu, os as _os
    _spec = _ilu.spec_from_file_location(
        "revisions", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "revisions.py"))
    _rev = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_rev)


def revision_block(slug):
    """The revision badge, the capture provenance, and what changed — rendered from the record.

    ── IT STATES WHAT IT DOES NOT KNOW ──────────────────────────────────────────────────────────
    A guide with no recorded capture prints "screenshots: not recorded", and a guide whose shots
    predate its prose says so. Both are worse-looking than a date and both are the truth; the
    alternative is a finished-looking footer on a guide illustrated with last quarter's product,
    which is the exact drift this system exists to make visible.
    """
    r = _rev.entry(slug)
    if not r["revision"]:
        return ('<div class="rev"><span class="revno">Unrevised</span>'
                '<span class="revmeta">no revision recorded — run '
                '<code>python3 docs/manuals/revisions.py bump ' + esc(slug) + ' "…"</code></span></div>')
    cap = r.get("capture") or {}
    shots = (f'screenshots {esc(cap["at"][:10])} · {esc(str(cap.get("shots", "?")))} shot(s) '
             f'from {esc(cap.get("commit", "?"))}') if cap.get("at") else \
            '<span class="warn">screenshots: not recorded</span>'
    drift = ""
    if cap.get("at") and r.get("revised") and cap["at"][:10] < r["revised"]:
        drift = ('<span class="warn"> · the pictures are older than the words; '
                 're-capture before trusting a screen</span>')
    hist = "".join(
        f'<li><b>rev {h["revision"]}</b> · {esc(h.get("date",""))} · '
        f'<code>{esc(h.get("commit",""))}</code> — {esc(h.get("summary",""))}</li>'
        for h in r.get("history", [])[:6])
    return (f'<div class="rev"><span class="revno">Revision {r["revision"]}</span>'
            f'<span class="revmeta">{esc(r.get("revised",""))} · '
            f'<code>{esc(r.get("commit",""))}</code> · {shots}{drift}</span>'
            + (f'<details class="revhist"><summary>What changed</summary><ul>{hist}</ul></details>'
               if hist else '')
            + '</div>')


def data_uri(rel, maxw=1080, q=82):
    """Repo-relative image path → base64 data URI (downscaled JPEG). Cached."""
    key = (rel, maxw, q)
    if key in _img_cache:
        return _img_cache[key]
    path = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
    if not os.path.exists(path):
        print(f"  ⚠ missing image: {rel}")
        _img_cache[key] = None
        return None
    if HAVE_PIL:
        im = Image.open(path).convert("RGB")
        if im.size[0] > maxw:
            im = im.resize((maxw, int(im.size[1] * maxw / im.size[0])))
        b = io.BytesIO(); im.save(b, "JPEG", quality=q)
        uri = "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()
    else:
        with open(path, "rb") as fh:
            uri = "data:image/png;base64," + base64.b64encode(fh.read()).decode()
    _img_cache[key] = uri
    return uri


def as_html(body):
    return "\n".join(body) if isinstance(body, list) else (body or "")

def esc(s):
    return _html.escape(str(s or ""))


# ── section-content renderers (shared by per-guide + combined builds) ──────────
_MAXW = {"full": 1080, "half": 720, "third": 520}

def fig(spec, default_w="full"):
    """spec: {img, cap?, w?}. Returns a <figure> or ''."""
    img = spec.get("img")
    if not img:
        return ""
    w = spec.get("w", default_w)
    uri = data_uri(img, maxw=_MAXW.get(w, 1080))
    if not uri:
        return ""
    cap = esc(spec.get("cap", ""))
    caph = f"<figcaption>{cap}</figcaption>" if cap else ""
    return f'<figure class="fig-{w}"><img src="{uri}" alt="{cap}"/>{caph}</figure>'

def figures(specs):
    if not specs:
        return ""
    # group width classes; render as a gallery grid
    items = "".join(fig(s, s.get("w", "half")) for s in specs)
    return f'<div class="gallery">{items}</div>' if items else ""

def steps(items):
    if not items:
        return ""
    out = []
    for s in items:
        f = fig({"img": s.get("img"), "cap": s.get("cap"), "w": s.get("w", "half")}) if s.get("img") else ""
        out.append(f'<li><div class="steptxt">{as_html(s.get("t"))}</div>{f}</li>')
    return f'<ol class="steps">{"".join(out)}</ol>'

def table(t):
    if not t:
        return ""
    title = f'<div class="tbl-title">{esc(t["title"])}</div>' if t.get("title") else ""
    head = "".join(f"<th>{as_html(h)}</th>" for h in t.get("headers", []))
    rows = ""
    for r in t.get("rows", []):
        rows += "<tr>" + "".join(f"<td>{as_html(c)}</td>" for c in r) + "</tr>"
    thead = f"<thead><tr>{head}</tr></thead>" if head else ""
    return f'{title}<div class="tbl-wrap"><table class="ref">{thead}<tbody>{rows}</tbody></table></div>'

def callouts(items):
    if not items:
        return ""
    kmap = {"eg": "eg", "note": "note", "tip": "tip", "warn": "warn"}
    out = ""
    for c in items:
        cls = kmap.get(c.get("kind", "note"), "note")
        out += f'<p class="{cls}">{as_html(c.get("html"))}</p>'
    return out

def where_chip(where):
    return f'<div class="route"><span>where</span> <code>{esc(where)}</code></div>' if where else ""

def block(s):
    """Render the inner content of a section OR subsection (everything but its heading)."""
    parts = [
        where_chip(s.get("where")),
        as_html(s.get("lead")),
        as_html(s.get("body")),
        callouts(s.get("callouts")),
        steps(s.get("steps")),
        figures(s.get("figures")),
        table(s.get("table")),
    ]
    if s.get("img"):
        parts.append(fig({"img": s["img"], "cap": s.get("caption", ""), "w": s.get("w", "full")}))
    return "".join(p for p in parts if p)

def section_html(s, anchor_prefix=""):
    """Full <section> incl. H2 and any H3 subsections. anchor_prefix namespaces ids."""
    sid = (anchor_prefix + s["id"]) if anchor_prefix else s["id"]
    body = block(s)
    subs = ""
    for sub in s.get("subs", []):
        subid = (anchor_prefix + sub["id"]) if (anchor_prefix and sub.get("id")) else sub.get("id", "")
        idattr = f' id="{subid}"' if subid else ""
        subs += f'<div class="sub"{idattr}><h3>{esc(sub["heading"])}</h3>{block(sub)}</div>'
    return f'<section id="{sid}"><h2>{esc(s["heading"])}</h2>{body}{subs}</section>'

def toc_items(secs, anchor_prefix=""):
    lis = ""
    for s in secs:
        sid = (anchor_prefix + s["id"]) if anchor_prefix else s["id"]
        lis += f'<li><a href="#{sid}">{esc(s.get("toc", s.get("heading","")))}</a>'
        subs = [x for x in s.get("subs", []) if x.get("toc")]
        if subs:
            lis += "<ul>" + "".join(
                f'<li><a href="#{(anchor_prefix+x["id"]) if anchor_prefix else x["id"]}">{esc(x["toc"])}</a></li>'
                for x in subs) + "</ul>"
        lis += "</li>"
    return lis


# ── shared stylesheet ─────────────────────────────────────────────────────────
CSS = """
:root{--ink:#1a2230;--mut:#5b6672;--line:#e3e8ef;--brand:#1f3864;--accent:#2563eb;
--eg:#eef4ff;--egb:#c9dcff;--tip:#eefaf3;--tipb:#b7e6cd;--tipk:#186a3b;
--warn:#fff7ed;--warnb:#fed7aa;--warnk:#9a3412;--note:#f6f8fb;--noteb:#dbe3ee;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;font:15.5px/1.62 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.wrap{display:grid;grid-template-columns:310px 1fr;max-width:1300px;margin:0 auto}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:24px 18px;border-right:1px solid var(--line);background:#fafbfd}
nav .home{font-size:12px;color:var(--mut);margin-bottom:12px;display:block}
nav h1{font-size:14.5px;margin:0 0 3px;color:var(--brand)}
nav .sub{font-size:11.5px;color:var(--mut);margin-bottom:14px}
nav ol,nav ul{list-style:none;margin:0;padding:0}
nav>ol>li{margin:1px 0} nav a{display:block;padding:5px 9px;border-radius:6px;color:var(--ink);font-size:13px}
nav a:hover{background:#eef2f7;text-decoration:none}
nav ul{margin:1px 0 4px 10px;border-left:1px solid var(--line)} nav ul a{font-size:12px;color:var(--mut);padding:3px 9px}
nav .navfoot{margin-top:18px;padding-top:12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mut)}
nav .navfoot a{display:inline;padding:0}
main{padding:40px 52px;max-width:940px;min-width:0}
.hero{border-bottom:2px solid var(--line);padding-bottom:20px;margin-bottom:6px}
.rev{margin:14px 0 0;padding:10px 14px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:6px;background:#fbfcfe;font-size:12.5px}
.rev .revno{font-weight:700;color:var(--brand);margin-right:10px}
.rev .revmeta{color:var(--mut)}
.rev .warn{color:#9a3412;font-weight:600}
.rev code{font-size:11.5px;background:#eef2f7;padding:1px 5px;border-radius:3px}
.revhist{margin-top:8px}
.revhist summary{cursor:pointer;color:var(--brand);font-weight:600}
.revhist ul{margin:6px 0 0 18px;color:var(--mut)}
.revhist li{margin:3px 0}
.hero .eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.hero h1{font-size:28px;margin:6px 0 8px;color:var(--brand);letter-spacing:-.4px;text-wrap:balance}
.hero p{color:var(--mut);margin:.25em 0}
.badge{display:inline-block;background:var(--eg);border:1px solid var(--egb);color:var(--brand);font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;margin-top:8px}
section{padding:26px 0;border-bottom:1px solid var(--line)}
section:last-of-type{border-bottom:0}
h2{font-size:20px;color:var(--brand);margin:0 0 8px;letter-spacing:-.3px;text-wrap:balance}
.sub{margin:22px 0 0;padding:16px 0 0;border-top:1px dashed var(--line)}
h3{font-size:15.5px;color:#2a3f66;margin:0 0 6px;font-weight:700}
.route{font-size:12px;color:var(--mut);margin:0 0 10px;word-break:break-word}
.route span{display:inline-block;background:#eef2f7;color:#48566a;border-radius:5px;padding:1px 7px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}
p{margin:.6em 0}
code{background:#f3f5f9;border:1px solid #e6eaf0;border-radius:5px;padding:1px 5px;font:12.5px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#334;word-break:break-word}
.eg{background:var(--eg);border:1px solid var(--egb);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px;margin:12px 0;font-size:14px}
.note{background:var(--note);border:1px solid var(--noteb);border-left:3px solid #9fb0c9;border-radius:8px;padding:10px 14px;margin:12px 0;font-size:14px}
.tip{background:var(--tip);border:1px solid var(--tipb);border-left:3px solid #27a567;border-radius:8px;padding:10px 14px;margin:12px 0;font-size:14px;color:#1c4d33}
.warn{background:var(--warn);border:1px solid var(--warnb);border-left:3px solid #ea9d54;border-radius:8px;padding:10px 14px;margin:12px 0;font-size:14px;color:#5b3d1e}
ul.plain,ol.plain{margin:.5em 0 .5em 1.1em;padding:0}
li{margin:.25em 0}
.tag{display:inline-block;background:#e8f0ff;border:1px solid #cfe0ff;color:#2b4a86;border-radius:5px;padding:0 6px;font-size:12px;margin:0 2px}
ol.steps{counter-reset:st;list-style:none;margin:14px 0;padding:0}
ol.steps>li{position:relative;padding:0 0 4px 40px;margin:0 0 16px}
ol.steps>li::before{counter-increment:st;content:counter(st);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--brand);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
ol.steps>li .steptxt{padding-top:3px}
ol.steps figure{margin:9px 0 0}
figure{margin:14px 0 0}
figure img{width:100%;display:block;border:1px solid var(--line);border-radius:8px;box-shadow:0 1px 8px rgba(20,40,80,.07)}
figcaption{font-size:12.5px;color:var(--mut);margin-top:6px;font-style:italic}
.fig-half{max-width:720px} .fig-third{max-width:520px} .fig-full{max-width:100%}
.gallery{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0 0;align-items:flex-start}
.gallery figure{margin:0;flex:1 1 300px}
.gallery .fig-third{flex:1 1 220px;max-width:360px} .gallery .fig-half{flex:1 1 300px;max-width:520px} .gallery .fig-full{flex:1 1 100%;max-width:100%}
.tbl-title{font-size:13px;font-weight:700;color:#2a3f66;margin:14px 0 5px}
.tbl-wrap{overflow-x:auto;margin:6px 0 0}
table.ref{border-collapse:collapse;width:100%;font-size:13px}
table.ref th,table.ref td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
table.ref th{background:#f3f6fb;color:#2a3f66;font-weight:700;white-space:nowrap}
table.ref tbody tr:nth-child(even),table.ref tbody tr:nth-child(even){background:#fafbfd}
.foot{color:var(--mut);font-size:12.5px;padding:24px 0 60px}
@media(max-width:920px){.wrap{grid-template-columns:1fr} nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)} main{padding:24px 18px} .gallery figure{flex-basis:100%}}
@media print{
  @page{size:Letter;margin:13mm 13mm}
  nav{display:none!important} .wrap{display:block;max-width:none} main{padding:0;max-width:none}
  a{color:var(--ink)} body{font-size:10.5px;line-height:1.46}
  .hero h1{font-size:20px} h2{font-size:15px} h3{font-size:12.5px}
  section{padding:11px 0;break-inside:avoid-page} .sub{break-inside:avoid}
  figure,ol.steps>li,.eg,.note,.tip,.warn,.tbl-wrap{break-inside:avoid}
  figure img{box-shadow:none;max-height:132mm;width:auto;max-width:100%}
  .gallery figure img{max-height:80mm}
  table.ref{font-size:9.5px} table.ref th,table.ref td{padding:3px 5px}
}
"""


# ── per-guide page ─────────────────────────────────────────────────────────────
def render_guide(spec, guides_index):
    slug = spec["slug"]
    secs = spec.get("sections", [])
    toc = toc_items(secs)
    others = "".join(
        f'<a href="{g["slug"]}.html">{esc(g["nav_label"])}</a><br>'
        for g in guides_index if g["slug"] != slug)
    body = "".join(section_html(s) for s in secs)
    hero = spec.get("hero", {})
    lede = "".join(f"<p>{p}</p>" for p in hero.get("lede", []))
    badge = f'<span class="badge">{hero["badge"]}</span>' if hero.get("badge") else ""
    source_json = esc(json.dumps(spec, ensure_ascii=False))
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(spec['title'])}</title>
<!-- CONTENT SOURCE: docs/manuals/guides/{slug}.json  ·  REBUILD: python3 docs/manuals/build_guides.py {slug} -->
<style>{CSS}</style></head><body>
<div class="wrap">
<nav>
  <a class="home" href="index.html">← All guides</a>
  <h1>{esc(spec.get('nav_title', spec['title']))}</h1>
  <div class="sub">{esc(spec.get('audience',''))}</div>
  <ol>{toc}</ol>
  <div class="navfoot">Companion guides:<br>{others}</div>
</nav>
<main>
  <div class="hero">
    <div class="eyebrow">{esc(spec.get('eyebrow','govwin role guide'))}</div>
    <h1>{esc(hero.get('h1', spec['title']))}</h1>
    {lede}{badge}
  </div>
  {revision_block(slug)}
  {body}
  <p class="foot">{spec.get('footer','')}</p>
</main>
</div>
<script type="application/json" id="guide-source">{source_json}</script>
</body></html>"""


# ── index landing page ─────────────────────────────────────────────────────────
def render_index(manifest, guides_index):
    cards = ""
    for g in guides_index:
        thumb = ""
        if g.get("cover"):
            uri = data_uri(g["cover"], maxw=560, q=72)
            if uri:
                thumb = f'<div class="thumb" style="background-image:url({uri})"></div>'
        chips = "".join(f'<span class="chip">{esc(c)}</span>' for c in g.get("chips", []))
        pages = f' · {g["pages"]}' if g.get("pages") else ""
        cards += f"""
      <a class="card" href="{g['slug']}.html">
        {thumb}
        <div class="cardbody">
          <div class="role">{esc(g.get('role',''))}</div>
          <h3>{esc(g['nav_label'])}</h3>
          <p>{esc(g.get('blurb',''))}</p>
          <div class="chips">{chips}</div>
          <div class="pdf">HTML{pages} · <a href="{g['slug']}.pdf">PDF</a></div>
        </div>
      </a>"""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(manifest.get('title','govwin Role Guides'))}</title>
<!-- CONTENT SOURCE: docs/manuals/guides/_manifest.json -->
<style>{CSS}
.ix{{max-width:1080px;margin:0 auto;padding:52px 28px 80px}}
.ixhero{{text-align:center;margin-bottom:30px}}
.ixhero .eyebrow{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent)}}
.ixhero h1{{font-size:33px;color:var(--brand);margin:8px 0 10px;letter-spacing:-.5px}}
.ixhero p{{color:var(--mut);max-width:660px;margin:.3em auto;font-size:15.5px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px;margin-top:32px}}
.card{{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 2px 14px rgba(20,40,80,.06);transition:.16s;color:var(--ink)}}
.card:hover{{transform:translateY(-3px);box-shadow:0 10px 28px rgba(20,40,80,.13);text-decoration:none}}
.thumb{{height:150px;background-size:cover;background-position:top center;border-bottom:1px solid var(--line)}}
.cardbody{{padding:18px 20px 20px}}
.card .role{{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}}
.card h3{{font-size:19px;color:var(--brand);margin:5px 0 7px}}
.card p{{color:var(--mut);font-size:13.5px;margin:0 0 12px}}
.chips{{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}}
.chip{{font-size:11.5px;background:#eef2f7;color:#48566a;border-radius:5px;padding:2px 8px}}
.pdf{{font-size:12.5px;color:var(--mut)}}
.ixfoot{{text-align:center;color:var(--mut);font-size:12.5px;margin-top:44px}}
</style></head><body>
<div class="ix">
  <div class="ixhero">
    <div class="eyebrow">{esc(manifest.get('eyebrow','govwin — RFP Pipeline Portal'))}</div>
    <h1>{esc(manifest.get('title','Role Guides'))}</h1>
    <p>{esc(manifest.get('lede',''))}</p>
  </div>
  <div class="grid">{cards}</div>
  <p class="ixfoot">{manifest.get('footer','')}</p>
</div></body></html>"""


# ── combined single-page web view (theme-aware, for the Artifact) ──────────────
def render_combined(manifest, specs):
    nav = ""
    body = ""
    for g in manifest["guides"]:
        spec = specs[g["slug"]]
        slug = spec["slug"]
        nav += f'<div class="navgroup"><a class="navhead" href="#{slug}__top">{esc(g["nav_label"])}</a><ol>{toc_items(spec.get("sections", []), slug + "__")}</ol></div>'
        hero = spec.get("hero", {})
        lede = "".join(f"<p>{p}</p>" for p in hero.get("lede", []))
        badge = f'<span class="badge">{hero["badge"]}</span>' if hero.get("badge") else ""
        secs = "".join(section_html(s, slug + "__") for s in spec.get("sections", []))
        body += f'<div class="guide" id="{slug}__top"><div class="hero"><div class="eyebrow">{esc(spec.get("eyebrow",""))}</div><h1>{esc(hero.get("h1", spec["title"]))}</h1>{lede}{badge}</div>{secs}</div>'

    DARK = """
:root[data-theme="dark"]{--ink:#e6ecf5;--mut:#94a3b7;--line:#25313f;--brand:#9cc1ff;--accent:#6ea8ff;--eg:#152338;--egb:#2c4569;--note:#141c28;--noteb:#293748;--tip:#122519;--tipb:#245039;--warn:#2a2113;--warnb:#5a4626;--bg:#0f1622}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#e6ecf5;--mut:#94a3b7;--line:#25313f;--brand:#9cc1ff;--accent:#6ea8ff;--eg:#152338;--egb:#2c4569;--note:#141c28;--noteb:#293748;--tip:#122519;--tipb:#245039;--warn:#2a2113;--warnb:#5a4626;--bg:#0f1622}}
:root[data-theme="dark"] nav,@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) nav{background:#0c131d}}
:root[data-theme="dark"] code,:root[data-theme="dark"] .route span,:root[data-theme="dark"] .tag,:root[data-theme="dark"] table.ref th{background:#172230;border-color:#25313f;color:#cdd8e6}
:root[data-theme="dark"] figure img{border-color:#2a3746;box-shadow:0 2px 16px rgba(0,0,0,.4)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) nav{background:#0c131d}
:root:not([data-theme="light"]) code,:root:not([data-theme="light"]) .route span,:root:not([data-theme="light"]) .tag,:root:not([data-theme="light"]) table.ref th{background:#172230;border-color:#25313f;color:#cdd8e6}
:root:not([data-theme="light"]) figure img{border-color:#2a3746;box-shadow:0 2px 16px rgba(0,0,0,.4)}}
"""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(manifest.get('title','govwin Role Guides'))}</title>
<style>{CSS}
.navgroup{{margin-bottom:14px}}
.navhead{{display:block;font-size:13px;font-weight:700;color:var(--brand)!important;padding:5px 9px;border-radius:6px}}
.navhead:hover{{background:#eef2f7;text-decoration:none}}
.guide{{border-bottom:3px solid var(--line);margin-bottom:6px;padding-bottom:12px}}
.guide:last-child{{border-bottom:0}}
{DARK}</style></head><body>
<div class="wrap">
<nav><h1>{esc(manifest.get('title','Role Guides'))}</h1><div class="sub">{esc(manifest.get('eyebrow',''))}</div>{nav}</nav>
<main>{body}<p class="foot">{manifest.get('footer','')}</p></main>
</div></body></html>"""


# ── pdf via chromium print-to-pdf ─────────────────────────────────────────────
def to_pdf(html_path, pdf_path):
    if not os.path.exists(CHROME):
        print(f"  ⚠ chromium not found at {CHROME}; skipping PDF")
        return False
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--no-pdf-header-footer", "--virtual-time-budget=20000",
           f"--print-to-pdf={pdf_path}", f"file://{html_path}"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    ok = os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 4096
    if not ok:
        print(f"  ⚠ PDF failed: {r.stderr[-300:]}")
    return ok


def pdf_pages(path):
    try:
        import re
        d = open(path, "rb").read()
        return len(re.findall(rb"/Type\s*/Page[^s]", d))
    except Exception:
        return "?"


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_pdf = "--no-pdf" in sys.argv[1:]
    manifest = json.load(open(f"{GUIDES}/_manifest.json"))
    guides_index = manifest["guides"]
    want = set(args) if args else None

    specs = {}
    for g in guides_index:
        slug = g["slug"]
        spec = json.load(open(f"{GUIDES}/{slug}.json"))
        specs[slug] = spec
        if want and slug not in want:
            continue
        htmlout = f"{MANUALS}/{slug}.html"
        html = render_guide(spec, guides_index)
        open(htmlout, "w").write(html)
        nsec = len(spec.get("sections", []))
        nsub = sum(len(s.get("subs", [])) for s in spec.get("sections", []))
        print(f"✓ {slug}.html  ({len(html)//1024} KB, {nsec} sections, {nsub} subsections)")
        if not no_pdf:
            pdfout = f"{MANUALS}/{slug}.pdf"
            if to_pdf(htmlout, pdfout):
                print(f"✓ {slug}.pdf   ({os.path.getsize(pdfout)//1024} KB, {pdf_pages(pdfout)} pages)")

    open(f"{MANUALS}/index.html", "w").write(render_index(manifest, guides_index))
    print(f"✓ index.html ({len(guides_index)} guides)")
    combined = render_combined(manifest, specs)
    open(f"{MANUALS}/manuals.html", "w").write(combined)
    print(f"✓ manuals.html (combined, {len(combined)//1024} KB)")


if __name__ == "__main__":
    main()
