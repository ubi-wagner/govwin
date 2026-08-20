"""Find the sections of a large BAA that actually state the rules.

THE PROBLEM THIS REPLACES. Every agent that reads a solicitation took a PREFIX — `full_text[:8000]`
through `full_text[:24000]` — and reasoned from it. On the DoW 2026 SBIR BAA (1,301,986 chars) that
is 0.6%-1.8% of the document, and what sits in that window is the cover page and the table of
contents. Measured on that BAA:

    "Page Limitations"   first appears at char 624,462   (48.0% in)
    "font"               first appears at char 105,016   ( 8.1% in)
    "margins"            first appears at char  59,834   ( 4.6% in)

None of those is inside ANY agent's prefix. So `matrix_stager` — the agent that stages the
compliance matrix — was inferring page limits from a table of contents. Raising the extraction cap
did nothing for this: the text was always there, the agents just never looked past the first page.

THE FIX. Same character budget, chosen instead of taken. Scan the whole document for the passages
that state the rules for a given topic and hand the agent THOSE, with offsets so the excerpt stays
citable (docs/INGEST_PROVENANCE.md — a value we did not read must never look like one we did).

THE TRAP, and the reason a naive keyword scorer fails here: a table of contents is the single
densest concentration of topic keywords in the entire document, and it contains no rules at all.
"5.4 Page Limitations .................. 47" scores beautifully and says nothing. Dot-leader
detection is therefore not a nicety — without it this returns the TOC every time and is strictly
worse than the prefix it replaces.

Pure and dependency-free, so it is unit-testable without a DB or a model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Topics ───────────────────────────────────────────────────────────────────
# Keyword sets per compliance concern. Deliberately phrases a solicitation actually uses, not
# paraphrases: "page limitation" appears in federal BAAs, "max pages" does not.
#: How much budget a topic deserves when they compete. Raw score alone gets this wrong: "submission"
#: carries common words ("submit", "deadline") and out-scores everything, while "page_limits" — one
#: of the fields the compliance matrix is actually FOR — matches rarely and precisely. Without a
#: priority the important topics lose their slot to the chatty ones.
PRIORITY: dict[str, float] = {
    "page_limits": 3.0,
    "formatting": 3.0,
    "volumes": 2.0,
    "component_instructions": 1.5,
    "submission": 1.0,
    "eligibility": 0.8,
}

TOPICS: dict[str, list[str]] = {
    "page_limits": [
        "page limitation", "page limit", "shall not exceed", "must not exceed",
        "maximum of", "pages in length", "page count",
    ],
    "formatting": [
        "font size", "type size", "times new roman", "point font", "typeface",
        "margin", "single-spaced", "single spaced", "line spacing", "paper size",
    ],
    "volumes": [
        "volume 1", "volume 2", "volume 3", "volume 4", "volume 5",
        "technical volume", "cost volume", "cover sheet", "proposal volume",
    ],
    "submission": [
        "submission", "submit", "deadline", "close date", "electronically",
        "dsip", "sbir.gov", "uploaded", "due no later than",
    ],
    "eligibility": [
        "eligibility", "small business concern", "principal investigator",
        "citizenship", "foreign national", "majority owned",
    ],
    "component_instructions": [
        "component-specific", "component specific", "instructions apply",
        "in addition to the requirements", "supersede",
    ],
}

# ── Structure detection ──────────────────────────────────────────────────────

#: "5.4 Page Limitations" / "3.2.1 Proposal Format" — the numbered headings federal BAAs use.
_NUMBERED_HEADING = re.compile(r"^\s{0,6}(\d{1,2}(?:\.\d{1,2}){0,3})\s+([A-Z][^\n]{3,80})$", re.MULTILINE)
#: "PAGE LIMITATIONS" — an all-caps heading line.
_CAPS_HEADING = re.compile(r"^\s{0,6}([A-Z][A-Z \-/&,\.]{6,70})$", re.MULTILINE)
#: A dot-leader line: "5.4 Page Limitations .............. 47". The signature of a contents page.
_DOT_LEADER = re.compile(r"\.{4,}\s*\d{1,4}\s*$", re.MULTILINE)


@dataclass
class Span:
    """One located passage, citable by offset."""

    topic: str
    start: int
    end: int
    score: float
    heading: str | None = None

    @property
    def length(self) -> int:
        return self.end - self.start


@dataclass
class LocatedExcerpt:
    """What to hand an agent instead of a prefix."""

    text: str
    spans: list[Span] = field(default_factory=list)
    #: Topics for which at least one passage was found — the rest are honest gaps.
    covered: list[str] = field(default_factory=list)
    #: Topics asked for and NOT found anywhere in the document.
    missing: list[str] = field(default_factory=list)
    #: True when the document was small enough to pass through whole.
    whole_document: bool = False


def _toc_ranges(text: str, min_hits: int = 8) -> list[tuple[int, int]]:
    """Character ranges that look like a table of contents.

    A contents page is the densest concentration of topic keywords in the document and states no
    rules whatsoever, so it has to be excluded or it wins every scoring contest. Detected by
    dot-leader lines ("Page Limitations ....... 47"); a run of them within a short distance is a
    contents block, and the range is padded to swallow its heading and tail.
    """
    hits = [m.start() for m in _DOT_LEADER.finditer(text)]
    if len(hits) < min_hits:
        return []
    ranges: list[tuple[int, int]] = []
    run_start = hits[0]
    prev = hits[0]
    run_len = 1
    for h in hits[1:]:
        if h - prev <= 2_000:  # still the same contents block
            prev = h
            run_len += 1
            continue
        if run_len >= min_hits:
            ranges.append((max(0, run_start - 2_000), prev + 2_000))
        run_start, prev, run_len = h, h, 1
    if run_len >= min_hits:
        ranges.append((max(0, run_start - 2_000), prev + 2_000))
    return ranges


def _in_ranges(pos: int, ranges: list[tuple[int, int]]) -> bool:
    return any(a <= pos <= b for a, b in ranges)


def _kw_at(lower_text: str, pos: int, keywords: list[str]) -> str:
    """Which keyword matched at `pos` — used to count DISTINCT phrasings, not raw hits."""
    for kw in keywords:
        if lower_text.startswith(kw.lower(), pos):
            return kw.lower()
    return ""


def _heading_before(text: str, pos: int, lookback: int = 3_000) -> str | None:
    """The nearest heading ABOVE `pos`."""
    window = text[max(0, pos - lookback):pos]
    best: str | None = None
    for m in _NUMBERED_HEADING.finditer(window):
        best = f"{m.group(1)} {m.group(2).strip()}"
    if best:
        return best
    for m in _CAPS_HEADING.finditer(window):
        best = m.group(1).strip()
    return best


def _heading_for(text: str, start: int, end: int) -> str | None:
    """The label for an excerpt spanning [start, end).

    Looks INSIDE the excerpt's opening before looking above it. The section keyword usually appears
    in the heading itself — "5.4 Page Limitations" matches "page limitation" — so the heading sits
    just after the hit, not before it, and a backwards-only search returns the unrelated prose that
    happened to precede the section.
    """
    head_zone = text[start:min(end, start + 800)]
    m = list(_NUMBERED_HEADING.finditer(head_zone))
    if m:
        return f"{m[0].group(1)} {m[0].group(2).strip()}"
    c = list(_CAPS_HEADING.finditer(head_zone))
    if c:
        return c[0].group(1).strip()
    return _heading_before(text, start)


def _has_heading_near(text: str, pos: int) -> bool:
    """Is this hit sitting under (or in) a heading? A rule under one is the rule; a passing
    mention in body prose is not — so the scorer rewards it."""
    zone = text[max(0, pos - 400):pos + 200]
    return bool(_NUMBERED_HEADING.search(zone) or _CAPS_HEADING.search(zone))


def locate_sections(
    text: str | None,
    topics: dict[str, list[str]] | None = None,
    budget: int = 16_000,
    window: int = 2_400,
) -> LocatedExcerpt:
    """Return the passages most likely to STATE the rules for each topic, within `budget` chars.

    `budget` is the same size the callers previously spent on a prefix — this changes WHICH
    characters they get, not how many.
    """
    src = text or ""
    wanted = topics or TOPICS
    if not src.strip():
        return LocatedExcerpt(text="", missing=list(wanted))
    if len(src) <= budget:
        # Small document: the prefix WAS the whole thing, so nothing to choose between.
        return LocatedExcerpt(text=src, covered=list(wanted), whole_document=True)

    toc = _toc_ranges(src)
    lower = src.lower()

    # Best non-TOC window per topic, scored by keyword hits. A hit that sits right after a heading
    # counts double: a rule under "5.4 Page Limitations" is the rule, a passing mention is not.
    best: dict[str, Span] = {}
    for topic, keywords in wanted.items():
        positions: list[int] = []
        for kw in keywords:
            start = 0
            k = kw.lower()
            while True:
                at = lower.find(k, start)
                if at < 0:
                    break
                if not _in_ranges(at, toc):
                    positions.append(at)
                start = at + len(k)
        if not positions:
            continue
        positions.sort()
        # Slide over the hit list: the densest cluster within `window` chars wins.
        #
        # Score on DISTINCT keywords matched, not raw hit count. Raw count rewards a topic for
        # having many common keywords rather than for being the right passage — "submission" scored
        # 62 against "page_limits" at 7 on a real BAA purely because it owns words like "submit".
        # A window matching five different page-limit phrasings is the page-limit section; a window
        # repeating one word twenty times is prose.
        best_score, best_at = 0.0, positions[0]
        lo = 0
        for hi in range(len(positions)):
            while positions[hi] - positions[lo] > window:
                lo += 1
            cluster = positions[lo:hi + 1]
            distinct = len({_kw_at(lower, p, keywords) for p in cluster}) 
            score = float(distinct) + 0.05 * len(cluster)
            if _has_heading_near(src, positions[lo]):
                score *= 2.0
            score *= PRIORITY.get(topic, 1.0)
            if score > best_score:
                best_score, best_at = score, positions[lo]
        start = max(0, best_at - 400)
        end = min(len(src), best_at + window)
        best[topic] = Span(topic=topic, start=start, end=end, score=best_score,
                           heading=_heading_for(src, start, end))

    if not best:
        # Nothing matched anywhere. Falling back to the prefix would be the old bug, so say so:
        # an empty excerpt with every topic listed missing is an honest "we found nothing".
        return LocatedExcerpt(text="", missing=list(wanted))

    # Spend the budget on the strongest topics first, merging overlaps so nothing is paid twice.
    chosen: list[Span] = []
    spent = 0
    for span in sorted(best.values(), key=lambda s: s.score, reverse=True):
        merged = False
        for c in chosen:
            if span.start < c.end and c.start < span.end:  # overlap
                spent += max(0, span.end - c.end) + max(0, c.start - span.start)
                c.start, c.end = min(c.start, span.start), max(c.end, span.end)
                merged = True
                break
        if merged:
            continue
        if spent + span.length > budget:
            continue
        chosen.append(span)
        spent += span.length

    chosen.sort(key=lambda s: s.start)
    parts: list[str] = []
    for c in chosen:
        # Recompute after merging — a merged span covers a wider range than the one that was
        # labelled, and a label describing only its former head would misattribute the rest.
        c.heading = _heading_for(src, c.start, c.end)
        label = c.heading or f"~char {c.start}"
        parts.append(f"[source: {label} — chars {c.start}-{c.end}]\n{src[c.start:c.end]}")

    covered = sorted({c.topic for c in chosen} | {s.topic for s in best.values()
                                                  if any(s.start >= c.start and s.end <= c.end for c in chosen)})
    return LocatedExcerpt(
        text="\n\n---\n\n".join(parts),
        spans=chosen,
        covered=covered,
        missing=sorted(set(wanted) - set(best)),
    )
