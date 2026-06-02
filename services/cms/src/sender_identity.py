"""
Email sender identity — which "From" address a given message goes out as.

The platform sends from TWO real identities (the launch model):
  - automation : automation@rfppipeline.com — system/automation traffic: workflow
    NOTIFY steps, admin alerts, HITL nudges, analysis sweeps. The "robot" voice.
  - engagement : eric@rfppipeline.com (or heather@) — human-facing traffic:
    customer onboarding, campaigns/drips, reply responses. The "person" voice.
  - cms_service: cms_gmail_service@rfppipeline.com — the delegated service mailbox
    for CMS-originated automation where a distinct service identity is wanted.

This module is the ABSTRACTION + CONFIG only: addresses come from env (with safe
defaults) and a message is mapped to an identity by
(explicit hint -> originating namespace -> template heuristic). Actual Google
Workspace provisioning, domain-wide delegation, DNS/SPF/DKIM, and the inbound
sweep are EXTERNAL setup — see docs/EMAIL_SENDERS.md.

Fail-safe: resolve_sender() returns the caller's `default` when nothing matches, so
an unmapped message keeps today's behavior — no regression, no surprise sender.
"""
from __future__ import annotations

import os
from typing import Optional

VALID_IDENTITIES = ("automation", "engagement", "cms_service")

# Module cache of DB-backed identities (key -> address), populated by
# load_sender_identities() at CMS startup and refreshed on a cadence. None until
# loaded — env vars + hardcoded defaults apply in the meantime.
_CACHE: Optional[dict[str, str]] = None


async def load_sender_identities(pool) -> int:
    """Load active rows from the CRM-DB sender_identities table into the cache.

    Returns the number loaded. Best-effort: a missing table (009 unapplied), no
    pool, or any query error leaves the cache as-is so resolution still falls back
    to env + hardcoded defaults — this never raises.
    """
    global _CACHE
    if pool is None:
        return 0
    try:
        rows = await pool.fetch(
            "SELECT key, address FROM sender_identities WHERE active = true"
        )
    except Exception:
        return 0
    _CACHE = {r["key"]: r["address"] for r in rows if r["address"]}
    return len(_CACHE)


def _identity_addresses() -> dict[str, str]:
    """Identity key -> From address, resolved with precedence:

        explicit env var  >  DB row (load_sender_identities)  >  hardcoded default

    Read fresh each call so env / DB / test changes take effect without import-time
    caching. The automation default keeps the legacy GOOGLE_WORKSPACE_EMAIL fallback
    so single-sender deployments keep working until anything new is configured.
    """
    # 1. hardcoded floor
    addrs: dict[str, str] = {
        "automation": os.getenv("GOOGLE_WORKSPACE_EMAIL", "automation@rfppipeline.com"),
        "engagement": "eric@rfppipeline.com",
        "cms_service": "cms_gmail_service@rfppipeline.com",
    }
    # 2. DB-backed identities (admin-managed) — override + add custom keys
    if _CACHE:
        for key, address in _CACHE.items():
            if address:
                addrs[key] = address
    # 3. explicit env vars — the ops override (highest precedence)
    for key, env_var in (
        ("automation", "SENDER_AUTOMATION_EMAIL"),
        ("engagement", "SENDER_ENGAGEMENT_EMAIL"),
        ("cms_service", "SENDER_CMS_SERVICE_EMAIL"),
    ):
        val = os.getenv(env_var)
        if val:
            addrs[key] = val
    return addrs


# Originating namespace -> identity. capture (customer) and identity (auth/welcome)
# are human-facing engagement; everything else is automation. A NOTIFY emitter can
# forward the originating namespace as payload.senderNamespace; otherwise the
# template heuristic + default apply.
_NAMESPACE_IDENTITY = {
    "capture": "engagement",
    "identity": "engagement",
    "finder": "automation",
    "proposal": "automation",
    "library": "automation",
    "system": "automation",
    "tool": "automation",
}

# Template-name substrings that are clearly human-facing engagement — used when no
# explicit identity / namespace is available (a NOTIFY payload always has template).
_ENGAGEMENT_TEMPLATE_HINTS = (
    "welcome", "onboard", "campaign", "drip", "outreach", "reply",
    "response", "invite", "lead",
)


def resolve_sender(
    *,
    identity: Optional[str] = None,
    namespace: Optional[str] = None,
    template: Optional[str] = None,
    default: Optional[str] = None,
) -> str:
    """Resolve the From address for a message.

    Priority: explicit identity hint -> originating namespace -> template heuristic.
    Falls back to `default` (the caller's current sender) when nothing matches, so an
    unmapped message never changes sender unexpectedly. If `default` is also None, the
    automation identity is the floor.
    """
    addrs = _identity_addresses()

    # 1. Explicit identity hint (e.g. payload.fromIdentity), if recognized.
    if identity and identity in addrs:
        return addrs[identity]

    # 2. Originating namespace, if forwarded.
    if namespace:
        key = _NAMESPACE_IDENTITY.get(namespace.split(":")[0])
        if key:
            return addrs[key]

    # 3. Template heuristic — human-facing templates go out as engagement.
    if template:
        t = template.lower()
        if any(h in t for h in _ENGAGEMENT_TEMPLATE_HINTS):
            return addrs["engagement"]

    # 4. Fail-safe: the caller's current sender, else the automation floor.
    return default or addrs["automation"]
