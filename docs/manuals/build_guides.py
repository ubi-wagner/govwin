#!/usr/bin/env python3
"""
Data-driven role-manual builder.

Content lives in JSON (docs/manuals/guides/*.json) — the "dynamic content section"
model: edit the data, re-run this, and the presentation regenerates. Nobody hand-edits
the rendered HTML.

For every guide listed in guides/_manifest.json this emits:
  • docs/manuals/<SLUG>.html   — indexed, self-contained (screenshots embedded as base64),
                                 sticky sidebar TOC, deep-linked anchors. The source JSON is
                                 embedded in a <script type="application/json"> block so the
                                 file carries its own editable content.
  • docs/manuals/<SLUG>.pdf    — Chromium print-to-pdf of the same HTML (print CSS drops the
                                 sidebar and lays it out as a clean letter-size document).
And one index:
  • docs/manuals/index.html    — the landing page linking all guides (also data-driven, from
                                 the manifest).

Usage:
  python3 docs/manuals/build_guides.py            # all guides + index
  python3 docs/manuals/build_guides.py rfp-admin  # one guide (+ index)
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
    """Section body may be a string or a list of html fragments."""
    return "\n".join(body) if isinstance(body, list) else (body or "")


# ── shared stylesheet ─────────────────────────────────────────────────────────
CSS = """
:root{--ink:#1a2230;--mut:#5b6672;--line:#e3e8ef;--brand:#1f3864;--accent:#2563eb;
--eg:#eef4ff;--egb:#c9dcff;--warn:#fff7ed;--warnb:#fed7aa;--warnk:#9a3412;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;font:16px/1.62 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.wrap{display:grid;grid-template-columns:300px 1fr;max-width:1260px;margin:0 auto}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:26px 20px;border-right:1px solid var(--line);background:#fafbfd}
nav .home{font-size:12px;color:var(--mut);margin-bottom:14px;display:block}
nav h1{font-size:15px;margin:0 0 3px;color:var(--brand)}
nav .sub{font-size:12px;color:var(--mut);margin-bottom:16px}
nav ol{list-style:none;margin:0;padding:0}
nav li{margin:1px 0} nav a{display:block;padding:6px 9px;border-radius:7px;color:var(--ink);font-size:13.5px}
nav a:hover{background:#eef2f7;text-decoration:none}
nav .navfoot{margin-top:20px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--mut)}
nav .navfoot a{display:inline;padding:0}
main{padding:42px 52px;max-width:900px;min-width:0}
.hero{border-bottom:2px solid var(--line);padding-bottom:22px;margin-bottom:6px}
.hero .eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.hero h1{font-size:29px;margin:6px 0 8px;color:var(--brand);letter-spacing:-.4px}
.hero p{color:var(--mut);margin:.25em 0}
.badge{display:inline-block;background:var(--eg);border:1px solid var(--egb);color:var(--brand);font-size:12.5px;font-weight:600;padding:3px 11px;border-radius:999px;margin-top:10px}
section{padding:30px 0;border-bottom:1px solid var(--line)}
section:last-of-type{border-bottom:0}
h2{font-size:21px;color:var(--brand);margin:0 0 6px;letter-spacing:-.3px}
.route{font-size:12.5px;color:var(--mut);margin:0 0 12px}
.route span{display:inline-block;background:#eef2f7;color:#48566a;border-radius:5px;padding:1px 7px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}
p{margin:.7em 0}
code{background:#f3f5f9;border:1px solid #e6eaf0;border-radius:5px;padding:1px 6px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#334}
p.eg{background:var(--eg);border:1px solid var(--egb);border-left:3px solid var(--accent);border-radius:8px;padding:12px 15px;margin:14px 0;font-size:14.5px}
p.note{background:var(--warn);border:1px solid var(--warnb);border-left:3px solid #ea9d54;border-radius:8px;padding:12px 15px;margin:14px 0;font-size:14.5px;color:#5b3d1e}
ul,ol.steps{margin:.6em 0 .6em 1.1em;padding:0}
li{margin:.28em 0}
.tag{display:inline-block;background:#e8f0ff;border:1px solid #cfe0ff;color:#2b4a86;border-radius:5px;padding:0 6px;font-size:12px;margin:0 2px}
figure{margin:18px 0 0} figure img{width:100%;border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 14px rgba(20,40,80,.09)}
figcaption{font-size:13px;color:var(--mut);text-align:center;margin-top:8px;font-style:italic}
.foot{color:var(--mut);font-size:13px;padding:26px 0 60px}
@media(max-width:900px){.wrap{grid-template-columns:1fr} nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)} main{padding:26px 20px}}
@media print{
  @page{size:Letter;margin:14mm 14mm}
  nav{display:none!important} .wrap{display:block;max-width:none} main{padding:0;max-width:none}
  a{color:var(--ink)} body{font-size:11.5px;line-height:1.5}
  .hero h1{font-size:22px} h2{font-size:16px}
  section{padding:14px 0;break-inside:avoid} figure{break-inside:avoid} p.eg,p.note{break-inside:avoid}
  figure img{box-shadow:none;max-height:150mm;width:auto;max-width:100%;display:block;margin:0 auto}
}
"""


# ── render one guide ──────────────────────────────────────────────────────────
def render_guide(spec, guides_index):
    slug = spec["slug"]
    secs = spec.get("sections", [])
    toc = "\n".join(
        f'<li><a href="#{s["id"]}">{_html.escape(s.get("toc", s.get("heading","")))}</a></li>'
        for s in secs
    )
    others = "".join(
        f'<a href="{g["slug"]}.html">{_html.escape(g["nav_label"])}</a><br>'
        for g in guides_index if g["slug"] != slug
    )

    body = ""
    for s in secs:
        fig = ""
        if s.get("img"):
            uri = data_uri(s["img"])
            if uri:
                cap = _html.escape(s.get("caption", ""))
                fig = f'<figure><img src="{uri}" alt="{cap}"/><figcaption>{cap}</figcaption></figure>'
        where = s.get("where")
        route = f'<div class="route"><span>where</span> <code>{_html.escape(where)}</code></div>' if where else ""
        body += f"""
    <section id="{s['id']}">
      <h2>{_html.escape(s['heading'])}</h2>
      {route}
      {as_html(s.get('body'))}
      {fig}
    </section>"""

    hero = spec.get("hero", {})
    lede = "".join(f"<p>{p}</p>" for p in hero.get("lede", []))
    badge = f'<span class="badge">{hero["badge"]}</span>' if hero.get("badge") else ""
    # Embed the source content so the file carries its own editable data (dynamic-content model).
    source_json = _html.escape(json.dumps(spec, ensure_ascii=False))

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_html.escape(spec['title'])}</title>
<!-- CONTENT SOURCE: docs/manuals/guides/{slug}.json  ·  REBUILD: python3 docs/manuals/build_guides.py {slug} -->
<style>{CSS}</style></head><body>
<div class="wrap">
<nav>
  <a class="home" href="index.html">← All guides</a>
  <h1>{_html.escape(spec.get('nav_title', spec['title']))}</h1>
  <div class="sub">{_html.escape(spec.get('audience',''))}</div>
  <ol>{toc}</ol>
  <div class="navfoot">Companion guides:<br>{others}</div>
</nav>
<main>
  <div class="hero">
    <div class="eyebrow">{_html.escape(spec.get('eyebrow','govwin role guide'))}</div>
    <h1>{_html.escape(hero.get('h1', spec['title']))}</h1>
    {lede}
    {badge}
  </div>
  {body}
  <p class="foot">{spec.get('footer','')}</p>
</main>
</div>
<script type="application/json" id="guide-source">{source_json}</script>
</body></html>"""


# ── index landing page ────────────────────────────────────────────────────────
def render_index(manifest, guides_index):
    cards = ""
    for g in guides_index:
        thumb = ""
        if g.get("cover"):
            uri = data_uri(g["cover"], maxw=560, q=72)
            if uri:
                thumb = f'<div class="thumb" style="background-image:url({uri})"></div>'
        chips = "".join(f'<span class="chip">{_html.escape(c)}</span>' for c in g.get("chips", []))
        cards += f"""
      <a class="card" href="{g['slug']}.html">
        {thumb}
        <div class="cardbody">
          <div class="role">{_html.escape(g.get('role',''))}</div>
          <h3>{_html.escape(g['nav_label'])}</h3>
          <p>{_html.escape(g.get('blurb',''))}</p>
          <div class="chips">{chips}</div>
          <div class="pdf">HTML · <a href="{g['slug']}.pdf">PDF</a></div>
        </div>
      </a>"""

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_html.escape(manifest.get('title','govwin Role Guides'))}</title>
<!-- CONTENT SOURCE: docs/manuals/guides/_manifest.json  ·  REBUILD: python3 docs/manuals/build_guides.py -->
<style>{CSS}
.ix{{max-width:1080px;margin:0 auto;padding:52px 28px 80px}}
.ixhero{{text-align:center;margin-bottom:38px}}
.ixhero .eyebrow{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent)}}
.ixhero h1{{font-size:34px;color:var(--brand);margin:8px 0 10px;letter-spacing:-.5px}}
.ixhero p{{color:var(--mut);max-width:640px;margin:.3em auto;font-size:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px;margin-top:34px}}
.card{{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 2px 14px rgba(20,40,80,.06);transition:.16s;color:var(--ink)}}
.card:hover{{transform:translateY(-3px);box-shadow:0 10px 28px rgba(20,40,80,.13);text-decoration:none}}
.thumb{{height:150px;background-size:cover;background-position:top center;border-bottom:1px solid var(--line);filter:saturate(.96)}}
.cardbody{{padding:18px 20px 20px}}
.card .role{{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}}
.card h3{{font-size:19px;color:var(--brand);margin:5px 0 7px}}
.card p{{color:var(--mut);font-size:14px;margin:0 0 12px}}
.chips{{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}}
.chip{{font-size:11.5px;background:#eef2f7;color:#48566a;border-radius:5px;padding:2px 8px}}
.pdf{{font-size:12.5px;color:var(--mut)}}
.ixfoot{{text-align:center;color:var(--mut);font-size:13px;margin-top:46px}}
</style></head><body>
<div class="ix">
  <div class="ixhero">
    <div class="eyebrow">{_html.escape(manifest.get('eyebrow','govwin — RFP Pipeline Portal'))}</div>
    <h1>{_html.escape(manifest.get('title','Role Guides'))}</h1>
    <p>{_html.escape(manifest.get('lede',''))}</p>
  </div>
  <div class="grid">{cards}</div>
  <p class="ixfoot">{manifest.get('footer','')}</p>
</div></body></html>"""


# ── combined single-page build (for a shareable, self-contained web artifact) ──
def render_combined(manifest, specs):
    """All guides on one self-contained page. Anchors are namespaced <slug>__<id>
    so the shared sidebar deep-links work across guides. Used for the web Artifact."""
    nav = ""
    body = ""
    for g in manifest["guides"]:
        spec = specs[g["slug"]]
        slug = spec["slug"]
        sub = "".join(
            f'<li><a href="#{slug}__{s["id"]}">{_html.escape(s.get("toc", s.get("heading","")))}</a></li>'
            for s in spec.get("sections", [])
        )
        nav += f"""
      <div class="navgroup">
        <a class="navhead" href="#{slug}__top">{_html.escape(g['nav_label'])}</a>
        <ol>{sub}</ol>
      </div>"""

        hero = spec.get("hero", {})
        lede = "".join(f"<p>{p}</p>" for p in hero.get("lede", []))
        badge = f'<span class="badge">{hero["badge"]}</span>' if hero.get("badge") else ""
        secs = ""
        for s in spec.get("sections", []):
            fig = ""
            if s.get("img"):
                uri = data_uri(s["img"])
                if uri:
                    cap = _html.escape(s.get("caption", ""))
                    fig = f'<figure><img src="{uri}" alt="{cap}"/><figcaption>{cap}</figcaption></figure>'
            where = s.get("where")
            route = f'<div class="route"><span>where</span> <code>{_html.escape(where)}</code></div>' if where else ""
            secs += f"""
      <section id="{slug}__{s['id']}">
        <h2>{_html.escape(s['heading'])}</h2>
        {route}{as_html(s.get('body'))}{fig}
      </section>"""
        body += f"""
    <div class="guide" id="{slug}__top">
      <div class="hero">
        <div class="eyebrow">{_html.escape(spec.get('eyebrow',''))}</div>
        <h1>{_html.escape(hero.get('h1', spec['title']))}</h1>
        {lede}{badge}
      </div>
      {secs}
    </div>"""

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_html.escape(manifest.get('title','govwin Role Guides'))}</title>
<style>{CSS}
.navgroup{{margin-bottom:16px}}
.navhead{{display:block;font-size:13px;font-weight:700;color:var(--brand)!important;padding:6px 9px;border-radius:7px}}
.navhead:hover{{background:#eef2f7;text-decoration:none}}
.guide{{border-bottom:3px solid var(--line);margin-bottom:6px;padding-bottom:14px}}
.guide:last-child{{border-bottom:0}}
</style></head><body>
<div class="wrap">
<nav>
  <h1>{_html.escape(manifest.get('title','Role Guides'))}</h1>
  <div class="sub">{_html.escape(manifest.get('eyebrow',''))}</div>
  {nav}
</nav>
<main>{body}
  <p class="foot">{manifest.get('footer','')}</p>
</main>
</div></body></html>"""


# ── pdf via chromium print-to-pdf ─────────────────────────────────────────────
def to_pdf(html_path, pdf_path):
    if not os.path.exists(CHROME):
        print(f"  ⚠ chromium not found at {CHROME}; skipping PDF")
        return False
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--no-pdf-header-footer", "--virtual-time-budget=12000",
        f"--print-to-pdf={pdf_path}", f"file://{html_path}",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    ok = os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 4096
    if not ok:
        print(f"  ⚠ PDF failed: {r.stderr[-300:]}")
    return ok


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_pdf = "--no-pdf" in sys.argv[1:]

    manifest = json.load(open(f"{GUIDES}/_manifest.json"))
    guides_index = manifest["guides"]
    want = set(args) if args else None

    built = []
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
        print(f"✓ {slug}.html  ({len(html)//1024} KB, {len(spec.get('sections',[]))} sections)")
        if not no_pdf:
            pdfout = f"{MANUALS}/{slug}.pdf"
            if to_pdf(htmlout, pdfout):
                print(f"✓ {slug}.pdf   ({os.path.getsize(pdfout)//1024} KB)")
        built.append(slug)

    # Always (re)build the index landing page + the combined single-file web view.
    open(f"{MANUALS}/index.html", "w").write(render_index(manifest, guides_index))
    print(f"✓ index.html ({len(guides_index)} guides linked)")
    combined = render_combined(manifest, specs)
    open(f"{MANUALS}/manuals.html", "w").write(combined)
    print(f"✓ manuals.html (combined, {len(combined)//1024} KB — self-contained web view)")
    return built


if __name__ == "__main__":
    main()
