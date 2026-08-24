"""What the INSTALLED anthropic SDK will actually accept.

WHY THIS MODULE EXISTS. anthropic 1.0.0 removed `temperature` from `messages.create()`. It was not
renamed and not folded into `output_config` (which carries only `effort` and `format`) — it is
gone. Passing it raises TypeError CLIENT-SIDE, before any HTTP request is made, so a call site that
still sends it does not degrade: it fails, every time, in full.

That is what happened here. Measured on this box across a 30-day window, ten distinct archetypes —
opportunity_scout, content_generator, formatter, cost_estimator, librarian, curation_qa,
continuity_manager, advisory_manager, amendment_monitor, library_seed_suggester — each recorded a
`start` followed immediately by an `error`, at a 100% failure rate with zero tokens spent. The
entire agent workforce was inert, and separately so was the CMS draft generator, which falls back
to a brief on any exception and therefore reported success while producing no generated content.

Nothing surfaced it. The fabric records the failure and safe-skips rather than dead-ending a
workflow (an invariant: an agent must never strand a build), so from the outside every flow
completed normally. Only a check that asserts the agent PRODUCED something can see it.

WHY IT IS ONE MODULE AND NOT A FLAG PER CALL SITE. There were two call sites passing `temperature`
and they failed independently — fixing the fabric alone left the CMS generator broken, and the
next reader would have had no way to know which of the two answers was current. A capability with
two definitions will eventually disagree with itself; this is the one place that answers it.

WHY INTROSPECTION AND NOT A VERSION CHECK. The question is whether THIS interpreter's SDK takes the
argument. A version comparison is a proxy for that, and it goes stale on the next release that
moves something else.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("pipeline.sdk_compat")


def _probe_temperature() -> bool:
    try:
        import inspect

        import anthropic

        return (
            "temperature"
            in inspect.signature(anthropic.resources.messages.AsyncMessages.create).parameters
        )
    except Exception:  # pragma: no cover — a capability probe must never stop the worker
        return False


#: True when messages.create() still accepts `temperature`.
SDK_TAKES_TEMPERATURE: bool = _probe_temperature()


def sampling_kwargs(temperature: float | None) -> dict:
    """The temperature kwarg, or nothing, depending on what the SDK will take.

    Call sites spread it into their create() kwargs:

        resp = await client.messages.create(
            model=..., max_tokens=..., **sampling_kwargs(0.7),
        )

    Omitting the argument costs the caller its sampling preference. Passing one the SDK has dropped
    costs it the entire call — so when the two cannot both be had, the call wins.
    """
    if temperature is None or not SDK_TAKES_TEMPERATURE:
        return {}
    return {"temperature": temperature}


if not SDK_TAKES_TEMPERATURE:
    # Say it once, at import, rather than silently sampling differently than the caller asked for.
    logger.info(
        "anthropic SDK does not accept `temperature` on messages.create(); requested temperatures "
        "will be omitted from API calls (SDK default sampling applies)."
    )
