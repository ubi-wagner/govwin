"""On-demand topic expansion for a single solicitation (Scouting Spine M3 / T3.1).

The "download all 65 topics" capability: given one solicitation + its source
profile, fetch EVERY topic for that solicitation, parse the detail (title,
description, dates, POC, PDF link), and upsert each as an ``opportunities`` row
linked to the parent ``curated_solicitations`` by ``solicitation_id`` — deduped
by ``(solicitation_id, topic_number)``.

Two fetch paths (contract C3.a / C3.c):

  - ``site_type == 'dsip'``: query the DSIP public JSON API
    (``/topics-app/api/public/topics``) filtered to this solicitation and map
    each topic by REUSING ``dsip.py``'s existing parse/normalize helpers
    (imported, never edited).
  - otherwise: render each topic's detail URL from ``topic_url_pattern`` (Python
    ``{topicNumber}``/``{solicitationNumber}`` token substitution — the same
    tokens ``frontend/lib/source-url.ts`` uses), fetch it over plain HTTP
    (headless rendering arrives in M4), and parse the detail page.

Each topic is upserted with per-topic try/except isolation so one bad topic
never aborts the batch, and the upsert is idempotent on re-runs. The column
shape (``source``, ``source_id``, ``title``, ``agency``, ``office``,
``close_date``, ``posted_date``, ``description``, ``content_hash``,
``is_active`` default true, ``solicitation_id``, ``topic_number``,
``topic_branch``, ``topic_status``, ``tech_focus_areas``, ``poc_name``,
``poc_email``, ``topic_metadata``, ``naics_codes``) matches migration 013 and
the frontend ``opportunity.bulk_add_topics`` tool. ``source_id`` and
``content_hash`` are derived the same way as ``opportunity.bulk_add_topics`` so
a topic added by either path collides on the ``opportunities(source,
source_id)`` UNIQUE and reconciles cleanly.

Emits one ``finder:topics.expanded`` rollup event per call.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Optional

import httpx

import config

# Reuse DSIP's parsing/normalizing helpers WITHOUT editing dsip.py (contract
# C3.c: "map topics by importing/reusing dsip.py's existing parse/normalize
# helpers"). These are pure module-level functions; DsipIngester.normalize is a
# method but is documented PURE (no DB access, no side effects) so it is safe to
# call on a throwaway instance to map a raw DSIP API item to the opportunity
# column shape.
from ingest.dsip import (
    DSIP_API_URL,
    HTTP_TIMEOUT,
    PAGE_SIZE,
    DsipIngester,
    _detect_program_type,
    _extract_agency,
    _extract_dsip_tech_focus,
    _extract_topic_prefix,
    _parse_date,
)

log = logging.getLogger("pipeline.ingest.topic_expander")

# Cap how many topic pages we'll page through from the DSIP API for one
# solicitation. A real BAA tops out a few hundred topics; PAGE_SIZE=100 means
# this covers thousands while bounding a runaway loop.
MAX_TOPIC_PAGES = 30
DESCRIPTION_MAX_LEN = 50_000
USER_AGENT = "GovWin-Pipeline/1.0 (topic-expander)"

# Matches a ``{token}`` placeholder; the captured group is the token name.
# Python-side mirror of TOKEN_RE in frontend/lib/source-url.ts so both paths
# agree on what a pattern token is.
_TOKEN_RE = re.compile(r"\{([a-zA-Z0-9_]+)\}")


# ── URL rendering (contract C3.a, Python mirror of renderTopicUrl) ─────

def render_topic_url(pattern: Optional[str], tokens: dict[str, Any]) -> str:
    """Render a concrete per-topic URL from a pattern + token values.

    Substitutes every ``{token}`` in ``pattern`` with the matching value from
    ``tokens`` (URL-encoded). Returns ``""`` when the pattern is empty or any
    token it references is missing/blank — we never emit a half-rendered URL
    with an unresolved ``{placeholder}``. Mirrors ``renderTopicUrl`` in
    ``frontend/lib/source-url.ts``.
    """
    if not pattern or not pattern.strip():
        return ""

    required = []
    seen: set[str] = set()
    for m in _TOKEN_RE.finditer(pattern):
        name = m.group(1)
        if name and name not in seen:
            seen.add(name)
            required.append(name)

    for name in required:
        val = tokens.get(name)
        if val is None or str(val).strip() == "":
            return ""

    from urllib.parse import quote

    def _sub(m: "re.Match[str]") -> str:
        return quote(str(tokens[m.group(1)]), safe="")

    return _TOKEN_RE.sub(_sub, pattern)


# ── Helpers ───────────────────────────────────────────────────────────

def _derive_source_id(solicitation_id: str, topic_number: str) -> str:
    """Derive a stable per-topic source_id.

    Matches ``opportunity.bulk_add_topics``' ``${solicitationId.slice(0,8)}-${topicNumber}``
    so a topic added by the frontend bulk tool and one expanded here resolve to
    the same ``opportunities(source, source_id)`` row.
    """
    return f"{str(solicitation_id)[:8]}-{topic_number}"


def _content_hash(solicitation_id: str, topic_number: str, title: str) -> str:
    """md5(solicitation_id || topic_number || title) — matches bulk_add_topics."""
    return hashlib.md5(
        f"{solicitation_id}{topic_number}{title}".encode("utf-8")
    ).hexdigest()


def _coerce_dt(value: Any) -> Optional[datetime]:
    """Best-effort coerce a normalized close/posted value to a datetime."""
    if value is None or isinstance(value, datetime):
        return value
    return _parse_date(str(value))


# ── Generic topic-detail HTML parser (non-DSIP path) ───────────────────

class _TopicDetailHTMLParser(HTMLParser):
    """Minimal parser pulling topic detail fields from a rendered detail page.

    Heuristic and class/label driven — good enough for plain-HTML portals.
    Captures title, description, close/open dates, POC name/email, and a PDF
    link. Headless rendering for JS-only portals arrives in M4 (contract C4.a);
    until then this handles static markup.
    """

    def __init__(self) -> None:
        super().__init__()
        self.fields: dict[str, Any] = {}
        self.pdf_url: Optional[str] = None
        self._title_chunks: list[str] = []
        self._desc_chunks: list[str] = []
        self._capture: Optional[str] = None
        self._in_h1 = False
        self._saw_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        cls = (attr.get("class") or "").lower()

        if tag == "h1" and not self._saw_h1:
            self._in_h1 = True
            return

        if tag == "a":
            href = attr.get("href") or ""
            if href.lower().endswith(".pdf") and not self.pdf_url:
                self.pdf_url = href
            if "mailto:" in href and "poc_email" not in self.fields:
                self.fields["poc_email"] = href.split("mailto:", 1)[1].split("?")[0]

        if "topic-title" in cls or "topictitle" in cls:
            self._capture = "title"
        elif "description" in cls or "topic-objective" in cls or "objective" in cls:
            self._capture = "description"
        elif "close-date" in cls or "closedate" in cls or "due-date" in cls:
            self._capture = "close_date"
        elif "open-date" in cls or "opendate" in cls or "posted" in cls:
            self._capture = "posted_date"
        elif "poc-name" in cls or "pocname" in cls or "point-of-contact" in cls:
            self._capture = "poc_name"
        elif "poc-email" in cls or "pocemail" in cls:
            self._capture = "poc_email"
        elif "topic-status" in cls or "topicstatus" in cls or "status" in cls:
            self._capture = "status"

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False
            self._saw_h1 = True

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._in_h1:
            self._title_chunks.append(text)
            return
        if self._capture == "description":
            self._desc_chunks.append(text)
            self._capture = None
            return
        if self._capture:
            self.fields.setdefault(self._capture, text)
            self._capture = None

    def result(self) -> dict[str, Any]:
        out = dict(self.fields)
        if "title" not in out and self._title_chunks:
            out["title"] = " ".join(self._title_chunks).strip()
        if self._desc_chunks:
            out["description"] = " ".join(self._desc_chunks).strip()
        if self.pdf_url:
            out["pdf_url"] = self.pdf_url
        return out


def _normalize_status(raw_status: Optional[str]) -> Optional[str]:
    """Map a free-text status to the topic_status enum (013)."""
    s = (raw_status or "").strip().lower()
    if s in ("open", "pre_release", "closed", "awarded", "withdrawn"):
        return s
    if s in ("pre-release", "prerelease"):
        return "pre_release"
    return "open" if s else None


def _map_detail_to_row(
    parsed: dict[str, Any],
    *,
    topic_number: str,
    solicitation_number: Optional[str],
    profile: dict[str, Any],
    detail_url: str,
) -> dict[str, Any]:
    """Map a parsed non-DSIP detail page to the opportunities column shape.

    Reuses DSIP's pure helpers (_extract_agency, _extract_topic_prefix,
    _detect_program_type, _extract_dsip_tech_focus, _parse_date) so the
    non-API path produces the same column shape as the DSIP path.
    """
    title = parsed.get("title") or topic_number
    description = (parsed.get("description") or "")[:DESCRIPTION_MAX_LEN]

    branch = _extract_topic_prefix(topic_number) or profile.get("agency")
    agency = profile.get("agency") or _extract_agency(branch)

    program_type = _detect_program_type(profile.get("program_type"), None)

    tech_focus = _extract_dsip_tech_focus({"description": description})

    topic_meta: dict[str, Any] = {"detail_url": detail_url}
    if parsed.get("pdf_url"):
        topic_meta["pdf_url"] = parsed["pdf_url"]
    if solicitation_number:
        topic_meta["solicitationNumber"] = solicitation_number

    return {
        "source": (profile.get("site_type") or "manual_upload"),
        "title": title,
        "agency": agency,
        "office": branch,
        "solicitation_number": solicitation_number,
        "program_type": program_type,
        "close_date": _parse_date(parsed.get("close_date")),
        "posted_date": _parse_date(parsed.get("posted_date")),
        "description": description,
        "topic_number": topic_number,
        "topic_branch": branch,
        "topic_status": _normalize_status(parsed.get("status")),
        "tech_focus_areas": tech_focus,
        "poc_name": parsed.get("poc_name"),
        "poc_email": parsed.get("poc_email"),
        "topic_metadata": topic_meta,
    }


# ── Fetchers ──────────────────────────────────────────────────────────

async def _fetch_dsip_topics(
    client: httpx.AsyncClient,
    *,
    solicitation_number: Optional[str],
    topic_numbers: Optional[list[str]],
) -> list[dict[str, Any]]:
    """Query the DSIP public JSON API filtered to one solicitation.

    Returns raw DSIP topic dicts (the shape DsipIngester.normalize consumes).
    In stub mode, returns DsipIngester's synthetic topics filtered to the
    requested solicitation/topic_numbers so tests run with no network.
    """
    # Stub mode: reuse DsipIngester's stub generator via a single fetch_page
    # call (cursor=None returns the synthetic set), then filter.
    if config.USE_STUB_DATA:
        items, _ = await DsipIngester().fetch_page(client, None, None)
        return _filter_dsip_items(items, solicitation_number, topic_numbers)

    collected: list[dict[str, Any]] = []
    for page in range(MAX_TOPIC_PAGES):
        params: dict[str, Any] = {"page": page, "size": PAGE_SIZE}
        # Filter to the solicitation when we know its number; the API backs the
        # Angular topic search which accepts a free-text/solicitation filter.
        if solicitation_number:
            params["searchText"] = solicitation_number
            params["solicitationNumber"] = solicitation_number

        resp = await client.get(
            DSIP_API_URL,
            params=params,
            timeout=HTTP_TIMEOUT,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        resp.raise_for_status()
        data = resp.json()

        if isinstance(data, dict):
            items = data.get("topics", data.get("content", data.get("data", [])))
            total_pages = data.get("totalPages", 1)
        elif isinstance(data, list):
            items = data
            total_pages = 1
        else:
            items = []
            total_pages = 1

        if not items:
            break
        collected.extend(items)
        if page + 1 >= total_pages:
            break

    return _filter_dsip_items(collected, solicitation_number, topic_numbers)


def _filter_dsip_items(
    items: list[dict[str, Any]],
    solicitation_number: Optional[str],
    topic_numbers: Optional[list[str]],
) -> list[dict[str, Any]]:
    """Keep only topics for this solicitation (and, if given, topic_numbers).

    The API filter is best-effort, so we re-filter client-side to be safe.
    """
    wanted = {t.strip().upper() for t in (topic_numbers or []) if t and t.strip()}
    sol = (solicitation_number or "").strip().upper()
    out: list[dict[str, Any]] = []
    for raw in items:
        tn = str(raw.get("topicNumber", raw.get("topic_number", ""))).strip().upper()
        if wanted and tn not in wanted:
            continue
        if sol and not wanted:
            baa = str(
                raw.get("baaNumber", raw.get("solicitationNumber", ""))
            ).strip().upper()
            if baa and baa != sol:
                continue
        out.append(raw)
    return out


async def _fetch_topic_detail(
    client: httpx.AsyncClient,
    url: str,
) -> dict[str, Any]:
    """Fetch + parse one topic detail page over plain HTTP."""
    resp = await client.get(
        url,
        timeout=HTTP_TIMEOUT,
        headers={"Accept": "text/html", "User-Agent": USER_AGENT},
    )
    resp.raise_for_status()
    parser = _TopicDetailHTMLParser()
    parser.feed(resp.text)
    return parser.result()


# ── Upsert (column shape per migration 013 / opportunity.bulk_add_topics) ──

async def _upsert_topic(
    conn: Any,
    *,
    solicitation_id: str,
    row: dict[str, Any],
) -> str:
    """Upsert one topic as an opportunities row linked to the solicitation.

    Dedupe is on ``(solicitation_id, topic_number)``: we first look for an
    existing topic with that pair and UPDATE it; otherwise INSERT. The derived
    ``source_id`` also collides on the ``opportunities(source, source_id)``
    UNIQUE so a topic previously added by the frontend bulk tool reconciles
    rather than duplicating.

    Returns "inserted" or "updated".
    """
    topic_number = row["topic_number"]
    title = row.get("title") or topic_number
    source = row.get("source") or "manual_upload"
    source_id = _derive_source_id(solicitation_id, topic_number)
    content_hash = _content_hash(solicitation_id, topic_number, title)
    tech_focus = list(row.get("tech_focus_areas") or [])
    topic_meta = row.get("topic_metadata") or {}
    description = (row.get("description") or "")[:DESCRIPTION_MAX_LEN] or None

    # Dedupe by (solicitation_id, topic_number) — the canonical topic key.
    existing_id = await conn.fetchval(
        """
        SELECT id FROM opportunities
        WHERE solicitation_id = $1::uuid AND topic_number = $2
        LIMIT 1
        """,
        solicitation_id,
        topic_number,
    )

    if existing_id is not None:
        await conn.execute(
            """
            UPDATE opportunities SET
              source = $2,
              source_id = $3,
              title = $4,
              agency = COALESCE($5, agency),
              office = COALESCE($6, office),
              solicitation_number = COALESCE($7, solicitation_number),
              program_type = COALESCE($8, program_type),
              close_date = COALESCE($9, close_date),
              posted_date = COALESCE($10, posted_date),
              description = COALESCE($11, description),
              content_hash = $12,
              topic_branch = COALESCE($13, topic_branch),
              topic_status = COALESCE($14, topic_status),
              tech_focus_areas = $15::text[],
              poc_name = COALESCE($16, poc_name),
              poc_email = COALESCE($17, poc_email),
              topic_metadata = $18::jsonb,
              updated_at = now()
            WHERE id = $1
            """,
            existing_id,
            source,
            source_id,
            title,
            row.get("agency"),
            row.get("office"),
            row.get("solicitation_number"),
            row.get("program_type"),
            _coerce_dt(row.get("close_date")),
            _coerce_dt(row.get("posted_date")),
            description,
            content_hash,
            row.get("topic_branch"),
            row.get("topic_status"),
            tech_focus,
            row.get("poc_name"),
            row.get("poc_email"),
            json.dumps(topic_meta),
        )
        return "updated"

    await conn.execute(
        """
        INSERT INTO opportunities
          (source, source_id, title, agency, office,
           solicitation_number, naics_codes,
           close_date, posted_date, description,
           content_hash, is_active,
           solicitation_id, topic_number, topic_branch,
           topic_status, tech_focus_areas,
           poc_name, poc_email, topic_metadata)
        VALUES
          ($1, $2, $3, $4, $5,
           $6, '{}'::text[],
           $7, $8, $9,
           $10, true,
           $11::uuid, $12, $13,
           $14, $15::text[],
           $16, $17, $18::jsonb)
        ON CONFLICT (source, source_id) DO UPDATE SET
          title = EXCLUDED.title,
          agency = EXCLUDED.agency,
          office = EXCLUDED.office,
          solicitation_number = EXCLUDED.solicitation_number,
          close_date = EXCLUDED.close_date,
          posted_date = EXCLUDED.posted_date,
          description = EXCLUDED.description,
          content_hash = EXCLUDED.content_hash,
          solicitation_id = EXCLUDED.solicitation_id,
          topic_number = EXCLUDED.topic_number,
          topic_branch = EXCLUDED.topic_branch,
          topic_status = EXCLUDED.topic_status,
          tech_focus_areas = EXCLUDED.tech_focus_areas,
          poc_name = EXCLUDED.poc_name,
          poc_email = EXCLUDED.poc_email,
          topic_metadata = EXCLUDED.topic_metadata,
          updated_at = now()
        """,
        source,
        source_id,
        title,
        row.get("agency"),
        row.get("office"),
        row.get("solicitation_number"),
        _coerce_dt(row.get("close_date")),
        _coerce_dt(row.get("posted_date")),
        description,
        content_hash,
        solicitation_id,
        topic_number,
        row.get("topic_branch"),
        row.get("topic_status"),
        tech_focus,
        row.get("poc_name"),
        row.get("poc_email"),
        json.dumps(topic_meta),
    )
    return "inserted"


# ── Source-profile resolution ─────────────────────────────────────────

async def _load_profile(
    conn: Any,
    *,
    source_profile_id: Optional[str],
    solicitation_id: str,
) -> Optional[dict[str, Any]]:
    """Load the source_profiles row, by id or inferred from the solicitation.

    Inference: match the solicitation's landing opportunity ``source`` (or the
    leading ``namespace`` segment) to a source profile's ``site_type``.
    """
    if source_profile_id:
        prof = await conn.fetchrow(
            """
            SELECT id, name, site_type, base_url, topic_url_pattern,
                   pdf_url_pattern, agency, program_type
            FROM source_profiles
            WHERE id = $1::uuid
            """,
            source_profile_id,
        )
        return dict(prof) if prof else None

    # Infer from the solicitation: namespace + landing opportunity source.
    sol = await conn.fetchrow(
        """
        SELECT cs.namespace, o.source AS opp_source
        FROM curated_solicitations cs
        LEFT JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = $1::uuid
        """,
        solicitation_id,
    )
    if not sol:
        return None

    candidates: list[str] = []
    if sol["opp_source"]:
        candidates.append(str(sol["opp_source"]).strip().lower())
    ns = (sol["namespace"] or "").strip().lower()
    if ns:
        candidates.append(ns.split(".", 1)[0])

    for cand in candidates:
        if not cand:
            continue
        prof = await conn.fetchrow(
            """
            SELECT id, name, site_type, base_url, topic_url_pattern,
                   pdf_url_pattern, agency, program_type
            FROM source_profiles
            WHERE site_type = $1 AND is_active = true
            ORDER BY created_at ASC
            LIMIT 1
            """,
            cand,
        )
        if prof:
            return dict(prof)

    return None


# ── Event emission ────────────────────────────────────────────────────

async def _emit_topics_expanded(
    conn: Any,
    *,
    solicitation_id: str,
    source_profile_id: Optional[str],
    expanded: int,
    skipped: int,
    duration_ms: int,
) -> None:
    """Emit the finder:topics.expanded rollup event (one per call)."""
    try:
        await conn.execute(
            """
            INSERT INTO system_events
              (id, namespace, type, phase, actor_type, actor_id,
               payload, created_at)
            VALUES ($1, 'finder', 'topics.expanded', 'single',
                    'pipeline', 'ingest:topic_expander',
                    $2::jsonb, now())
            """,
            uuid.uuid4(),
            json.dumps(
                {
                    "solicitationId": solicitation_id,
                    "sourceProfileId": source_profile_id,
                    "expanded": expanded,
                    "skipped": skipped,
                    "durationMs": duration_ms,
                }
            ),
        )
    except Exception as e:  # instrumentation must never break the business path
        log.error("failed to emit finder:topics.expanded: %s", e)


# ── Public entrypoint (pinned signature — T3.2 calls this exactly) ─────

async def expand_solicitation_topics(
    conn,
    *,
    solicitation_id: str,
    source_profile_id: str | None = None,
    topic_numbers: list[str] | None = None,
    solicitation_number: str | None = None,
) -> dict:
    """Fetch + ingest ALL topics for one solicitation on demand (contract C3.c).

    Loads the source profile (explicit id or inferred from the solicitation),
    fetches every topic via the DSIP public API (``site_type == 'dsip'``) or by
    rendering per-topic detail URLs from ``topic_url_pattern`` for the given
    ``topic_numbers`` (any other site_type), parses each topic's detail, and
    upserts it as an ``opportunities`` row linked by ``solicitation_id`` and
    deduped by ``(solicitation_id, topic_number)``. Per-topic try/except keeps
    one bad topic from aborting the batch; re-runs are idempotent.

    Emits one ``finder:topics.expanded`` rollup and returns the counts.

    Returns::

        {
          "status": "completed" | "no_source" | "no_topics" | "error",
          "solicitationId": str,
          "sourceProfileId": str | None,
          "expanded": int,    # topics inserted OR updated this run
          "skipped": int,     # topics that errored / were unrenderable
          "topics_upserted": int,   # alias of expanded (dispatcher reads this)
          "topics_skipped": int,    # alias of skipped
          "inserted": int,
          "updated": int,
          "durationMs": int,
        }
    """
    started = datetime.now(timezone.utc)
    sol_id = str(solicitation_id)
    inserted = 0
    updated = 0
    skipped = 0
    status = "completed"

    def _result() -> dict:
        duration_ms = int(
            (datetime.now(timezone.utc) - started).total_seconds() * 1000
        )
        expanded = inserted + updated
        return {
            "status": status,
            "solicitationId": sol_id,
            "sourceProfileId": str(profile["id"]) if profile else source_profile_id,
            "expanded": expanded,
            "skipped": skipped,
            "topics_upserted": expanded,
            "topics_skipped": skipped,
            "inserted": inserted,
            "updated": updated,
            "durationMs": duration_ms,
        }

    profile: Optional[dict[str, Any]] = None
    try:
        profile = await _load_profile(
            conn, source_profile_id=source_profile_id, solicitation_id=sol_id
        )
    except Exception as e:
        log.error("expand_topics: failed to load source profile: %s", e)
        status = "error"

    if profile is None:
        if status != "error":
            status = "no_source"
        log.warning(
            "expand_topics: no source profile for solicitation %s (profile_id=%s)",
            sol_id,
            source_profile_id,
        )
        result = _result()
        await _emit_topics_expanded(
            conn,
            solicitation_id=sol_id,
            source_profile_id=result["sourceProfileId"],
            expanded=result["expanded"],
            skipped=result["skipped"],
            duration_ms=result["durationMs"],
        )
        return result

    site_type = (profile.get("site_type") or "").strip().lower()
    profile_id_str = str(profile["id"])

    log.info(
        "expand_topics: solicitation=%s site_type=%s profile=%s",
        sol_id,
        site_type,
        profile_id_str,
    )

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=HTTP_TIMEOUT) as client:
            # ── DSIP path: public JSON API filtered to this solicitation ──
            if site_type == "dsip":
                try:
                    raw_topics = await _fetch_dsip_topics(
                        client,
                        solicitation_number=solicitation_number,
                        topic_numbers=topic_numbers,
                    )
                except Exception as e:
                    log.error("expand_topics: DSIP fetch failed: %s", e)
                    raw_topics = []
                    status = "error"

                if not raw_topics:
                    if status != "error":
                        status = "no_topics"
                else:
                    # Reuse DsipIngester.normalize (pure) to map each raw item.
                    mapper = DsipIngester()
                    for raw in raw_topics:
                        try:
                            row = mapper.normalize(raw)
                            topic_number = row.get("topic_number")
                            if not topic_number:
                                skipped += 1
                                continue
                            # Layer POC fields the listing normalize doesn't set.
                            row.setdefault(
                                "poc_name", raw.get("pocName") or raw.get("poc_name")
                            )
                            row.setdefault(
                                "poc_email", raw.get("pocEmail") or raw.get("poc_email")
                            )
                            outcome = await _upsert_topic(
                                conn, solicitation_id=sol_id, row=row
                            )
                            if outcome == "inserted":
                                inserted += 1
                            else:
                                updated += 1
                        except Exception as e:  # per-topic isolation
                            skipped += 1
                            log.warning(
                                "expand_topics: DSIP topic failed (%s): %s",
                                raw.get("topicNumber"),
                                str(e)[:200],
                            )

            # ── Pattern path: render per-topic URLs, fetch + parse detail ──
            else:
                pattern = profile.get("topic_url_pattern")
                nums = [t for t in (topic_numbers or []) if t and t.strip()]
                if not pattern or not str(pattern).strip():
                    status = "no_source"
                    log.warning(
                        "expand_topics: profile %s has no topic_url_pattern",
                        profile_id_str,
                    )
                elif not nums:
                    status = "no_topics"
                    log.warning(
                        "expand_topics: no topic_numbers given for pattern path "
                        "(solicitation %s)",
                        sol_id,
                    )
                else:
                    for topic_number in nums:
                        try:
                            url = render_topic_url(
                                pattern,
                                {
                                    "topicNumber": topic_number,
                                    "solicitationNumber": solicitation_number or "",
                                },
                            )
                            if not url:
                                skipped += 1
                                log.warning(
                                    "expand_topics: could not render URL for topic %s",
                                    topic_number,
                                )
                                continue
                            parsed = await _fetch_topic_detail(client, url)
                            row = _map_detail_to_row(
                                parsed,
                                topic_number=topic_number,
                                solicitation_number=solicitation_number,
                                profile=profile,
                                detail_url=url,
                            )
                            outcome = await _upsert_topic(
                                conn, solicitation_id=sol_id, row=row
                            )
                            if outcome == "inserted":
                                inserted += 1
                            else:
                                updated += 1
                        except Exception as e:  # per-topic isolation
                            skipped += 1
                            log.warning(
                                "expand_topics: topic %s failed: %s",
                                topic_number,
                                str(e)[:200],
                            )
    except Exception as e:
        log.error("expand_topics: run failed for solicitation %s: %s", sol_id, e)
        status = "error"

    result = _result()
    await _emit_topics_expanded(
        conn,
        solicitation_id=sol_id,
        source_profile_id=profile_id_str,
        expanded=result["expanded"],
        skipped=result["skipped"],
        duration_ms=result["durationMs"],
    )

    log.info(
        "expand_topics complete: solicitation=%s inserted=%d updated=%d skipped=%d (%dms)",
        sol_id,
        inserted,
        updated,
        skipped,
        result["durationMs"],
    )
    return result
