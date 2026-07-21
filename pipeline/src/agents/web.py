"""
Controlled web egress for the research_scout agent — the "server-side browser".

Two providers the archetype resolves at runtime:
  • search_provider() -> async (query, limit) -> [{title, url, snippet}]
  • page_fetcher()    -> async (url) -> str   (readable page text)

SAFETY:
  • SSRF-guarded: only http/https, and the resolved host must be a PUBLIC IP —
    loopback / private / link-local / metadata addresses are refused. The fetch URL
    can originate from (untrusted) web content, so this guard is load-bearing.
  • Bounded: per-request timeout, redirect cap, response-size cap, text truncation.
  • Gov/DoD-biased search: results from *.gov / *.mil (SAM.gov, SBIR.gov, DSIP,
    defense.gov, dodsbirsttr.mil, arl/afrl/onr, GAO, CRS) are surfaced first, since
    the primary use is researching DoD opportunities and prior art.

The *content* these return is UNTRUSTED — the archetype fences it before the model
sees it. This module never interprets page content as instructions.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urlparse, quote_plus

import httpx
from lxml import html as lxml_html

logger = logging.getLogger("pipeline.agents.web")

_UA = "Mozilla/5.0 (compatible; govwin-research-scout/1.0; +https://rfppipeline.com/bot)"
_TIMEOUT = httpx.Timeout(12.0, connect=6.0)
_MAX_BYTES = 2_500_000          # 2.5 MB response cap
_MAX_TEXT = 12_000              # chars of extracted text returned
_GOV_TLDS = (".gov", ".mil")
_GOV_HINTS = ("sam.gov", "sbir.gov", "dodsbirsttr.mil", "dsip", "defense.gov", "darpa.mil",
              "onr.navy.mil", "navair", "navsea", "afrl", "arl.army.mil", "gao.gov", "crsreports")


# ── SSRF guard ──────────────────────────────────────────────────────────────────
def _host_is_public(host: str) -> bool:
    """True only if EVERY resolved address for host is a global (public) IP."""
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    if not infos:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def _url_ok(url: str) -> bool:
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    return _host_is_public(u.hostname)


def _gov_rank(url: str) -> int:
    u = url.lower()
    if any(u.split("/")[2].endswith(t) for t in _GOV_TLDS if "//" in u):
        return 0
    if any(h in u for h in _GOV_HINTS):
        return 0
    return 1


# ── search ──────────────────────────────────────────────────────────────────────
async def _search(query: str, limit: int = 6) -> list[dict]:
    """DuckDuckGo HTML endpoint (no API key). Gov/mil results ranked first."""
    q = quote_plus(query.strip()[:300])
    url = f"https://html.duckduckgo.com/html/?q={q}"
    if not _url_ok(url):
        return []
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True, max_redirects=4,
                                 headers={"User-Agent": _UA}) as client:
        r = await client.post("https://html.duckduckgo.com/html/", data={"q": query[:300]})
        r.raise_for_status()
        doc = lxml_html.fromstring(r.text)
    out: list[dict] = []
    for res in doc.cssselect("div.result")[: max(limit * 3, 12)]:
        a = res.cssselect("a.result__a")
        if not a:
            continue
        href = a[0].get("href", "")
        # DDG wraps some links; take the raw href — resolve to the uddg target if present.
        if "uddg=" in href:
            from urllib.parse import parse_qs
            href = (parse_qs(urlparse(href).query).get("uddg") or [href])[0]
        if not _url_ok(href):
            continue
        title = a[0].text_content().strip()
        snip_el = res.cssselect("a.result__snippet") or res.cssselect(".result__snippet")
        snippet = (snip_el[0].text_content().strip() if snip_el else "")[:600]
        out.append({"title": title[:200], "url": href, "snippet": snippet})
    out.sort(key=lambda x: _gov_rank(x["url"]))
    return out[:limit]


# ── fetch ─────────────────────────────────────────────────────────────────────────
async def _fetch(url: str) -> str:
    """Fetch a page and extract readable text. SSRF-guarded, size/time bounded."""
    if not _url_ok(url):
        raise ValueError("URL refused (non-public host or bad scheme)")
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True, max_redirects=4,
                                 headers={"User-Agent": _UA}) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            if "html" not in ctype and "text" not in ctype and "xml" not in ctype:
                return f"(unsupported content-type: {ctype})"
            chunks, total = [], 0
            async for chunk in r.aiter_bytes():
                total += len(chunk)
                if total > _MAX_BYTES:
                    break
                chunks.append(chunk)
    body = b"".join(chunks)
    try:
        doc = lxml_html.fromstring(body)
    except Exception:
        return body.decode("utf-8", "ignore")[:_MAX_TEXT]
    for bad in doc.cssselect("script, style, nav, footer, header, noscript, svg"):
        bad.getparent().remove(bad) if bad.getparent() is not None else None
    text = " ".join(t.strip() for t in doc.itertext() if t.strip())
    return text[:_MAX_TEXT]


# ── provider handles the archetype resolves ────────────────────────────────────────
def search_provider():
    async def provider(query: str, limit: int = 6) -> list[dict]:
        try:
            return await _search(query, limit)
        except Exception as e:
            logger.warning("web search failed: %s", e)
            return []
    return provider


def page_fetcher():
    async def fetcher(url: str) -> str:
        return await _fetch(url)
    return fetcher
