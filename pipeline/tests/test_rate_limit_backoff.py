"""EVERY INGESTER RAISES THE TYPED RATE-LIMIT ERROR, AND SOMETHING CATCHES IT.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
Three of the four ingesters handled 429 carefully — sam_gov reading X-RateLimit-Remaining,
grants_gov reading Retry-After — and raised `IngesterRateLimitError` with the wait time in its
details. Nothing outside the ingest package ever caught it. It fell into the consumer loop's
generic `except Exception`, which logs and sleeps TEN SECONDS, so a source that asked for 300
was retried in 10 and the next schedule tick re-queued the same job.

That is the producer/consumer shape this repository keeps finding (docs/PRODUCER_CONSUMER_AUDIT.md):
a careful, typed, detail-carrying signal with no consumer. Here the consequence is external and
expensive — hammering an API that just asked you to stop is how a key gets throttled harder or
revoked, and DSIP is the DoD SBIR/STTR source we can least afford to lose.

`dsip` was also the one ingester with no 429 branch at all: its rate limit fell through
`raise_for_status()` as a generic HTTPError, indistinguishable from a bad request.

── WHAT THIS GUARDS ─────────────────────────────────────────────────────────────────────────
1. every ingester that talks to a rate-limited API raises the TYPED error on 429;
2. the consumer loop catches that type SPECIFICALLY, before its generic handler;
3. the back-off is bounded — a malicious or broken Retry-After cannot park the worker for a day.

A source scan, deliberately: driving a real 429 needs the upstream to cooperate, and the property
that matters is structural — the signal is raised, and it is caught by type rather than by luck.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"
INGEST = ROOT / "ingest"

# The ingesters that call a rate-limited third-party API. topic_expander and base are helpers;
# naming the set explicitly means ADDING an ingester is a decision, not a silent gap.
RATE_LIMITED = ["sam_gov", "sbir_gov", "grants_gov", "dsip"]


def _src(name: str) -> str:
    return (INGEST / f"{name}.py").read_text()


def test_the_scan_can_see_the_ingesters() -> None:
    # A scan whose files are missing passes every assertion below for the wrong reason.
    for name in RATE_LIMITED:
        assert (INGEST / f"{name}.py").is_file(), f"{name}.py not found — the scan root is wrong"


def test_every_rate_limited_ingester_raises_the_typed_error_on_429() -> None:
    missing = []
    for name in RATE_LIMITED:
        s = _src(name)
        has_429 = re.search(r"status_code\s*==\s*429", s) is not None
        raises_typed = "IngesterRateLimitError" in s
        if not (has_429 and raises_typed):
            missing.append(f"{name} (429 branch: {has_429}, typed raise: {raises_typed})")
    assert not missing, (
        "these ingesters do not raise IngesterRateLimitError on a 429, so the consumer loop "
        "cannot tell a rate limit from any other failure and will retry in seconds: "
        + ", ".join(missing)
    )


def test_the_consumer_loop_catches_the_type_before_its_generic_handler() -> None:
    s = (INGEST / "dispatcher.py").read_text()
    typed = s.find("except IngesterRateLimitError")
    generic = s.find('log.error("consume_one_job error')
    assert typed != -1, (
        "nothing catches IngesterRateLimitError in the dispatcher — the typed signal every "
        "ingester raises falls into the generic handler, which sleeps 10 seconds"
    )
    assert generic != -1, "the generic consume_one_job handler moved; this test needs updating"
    assert typed < generic, (
        "the generic handler comes FIRST, so it swallows the rate-limit error before the typed "
        "branch can see it — order is the whole mechanism in Python's except chain"
    )


def test_the_backoff_is_bounded_at_both_ends() -> None:
    s = (INGEST / "dispatcher.py").read_text()
    # A source (or a bug) sending Retry-After: 86400 must not park the worker for a day, and a
    # Retry-After of 0 must not become a busy loop against an API that just refused us.
    assert re.search(r"max\(\s*30\s*,\s*min\(", s), (
        "the back-off is not clamped. It must have a floor (never hammer) and a ceiling "
        "(never sleep past an hour on a hostile or broken Retry-After)."
    )


def test_the_wait_comes_from_the_source_not_a_constant() -> None:
    s = (INGEST / "dispatcher.py").read_text()
    assert "retry_after_seconds" in s, (
        "grants_gov and dsip put the upstream's own Retry-After into the error details. If the "
        "loop ignores it and sleeps a constant, the carefully-read header is another producer "
        "with no consumer."
    )
