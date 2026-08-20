"""Which proposal sections may receive an AI prose draft — the one rule, in one place.

A solicitation's required items are not all the same kind of thing. `volume_required_items.item_type`
already says which is which (the column carries a CHECK, so the vocabulary is fixed), and
provisioning copies it onto each section as `proposal_sections.meta->>'itemType'`. On a real DoD
annual BAA the split is stark:

    word_doc         12   Volume 2 — genuine narrative the proposer writes
    pdf               5   DD Form 2345, ITAR/EAR disclosure, Letters of Support, Reps & Certs
    form_other        2   Company Commercialization Report, Fraud/Waste/Abuse certificate
    form_sbir_certs   1   Proposal Cover Sheet & Technical Abstract
    spreadsheet       2   Phase I base and option cost

Only the first of those is written. A DD Form 2345 is obtained, signed and attached; Reps &
Certifications are filed in SAM; the FWA certificate is issued after training; the cost volume is
COMPUTED by the burden engine, not narrated. The drafter did not know that, so it wrote roughly four
kilobytes of fluent prose into every one of them — measured on a live build, ten sections of it,
including an AI-authored "DD Form 2345 — Militarily Critical Technical Data Agreement". A buyer
opening that finds convincing text where a signed federal form belongs, which is worse than finding
it empty: empty prompts them to go get the form.

Marking an item completed-elsewhere (the rfp_admin build-or-mark decision) prevents the section from
existing at all, and that is the primary control. This is the belt to it: a solicitation nobody has
curated yet must still not have its certifications written by a model.

Imported by BOTH `draft_v0` (which selects sections to draft) and `publish_section_draft` (which
lands them). The two must agree — publish_section_draft's own comment says so — or a section is
selected, drafted at cost, and then silently refused at the door.
"""
from __future__ import annotations

from typing import Any

#: Item types that are obtained, signed, filed or computed — never narrated by a model.
#: Anything matching is refused a prose draft regardless of who asked.
NON_AUTHORED_ITEM_TYPES = frozenset({
    "pdf",              # obtained and attached as-is (a signed form, a letter on someone's letterhead)
    "form_sf424",       # the federal grants application face page
    "form_sbir_certs",  # SBIR/STTR certifications — filed, not composed
    "form_other",       # any other agency form
    "spreadsheet",      # the cost workbook — the burden engine computes it (lib/proposal/cost-model)
})

#: Types a proposer genuinely writes. Kept explicit rather than "everything else" so a NEW item_type
#: added to the CHECK constraint defaults to refusing the draft rather than silently admitting it —
#: the safe direction for a guard whose failure mode is fabricated federal paperwork.
AUTHORED_ITEM_TYPES = frozenset({"word_doc", "slide_deck", "text", "other"})


def item_type_of(meta: Any) -> str | None:
    """Read itemType off a section's `meta`, tolerating a jsonb string or a dict."""
    if meta is None:
        return None
    if isinstance(meta, str):
        import json
        try:
            meta = json.loads(meta)
        except (ValueError, TypeError):
            return None
    if not isinstance(meta, dict):
        return None
    v = meta.get("itemType")
    return v if isinstance(v, str) and v else None


def is_authorable(meta: Any) -> bool:
    """True when this section may receive an AI prose draft.

    Unknown or absent itemType → True. Plenty of sections predate the field or come from paths that
    never set it (the volume-with-no-items fallback, hand-added sections), and refusing those would
    silently stop drafting work the product has always done. The guard only fires on a type that
    positively says "this is a form".
    """
    t = item_type_of(meta)
    if t is None:
        return True
    return t not in NON_AUTHORED_ITEM_TYPES


def refusal_reason(meta: Any) -> str:
    """A stable, greppable reason for the skip record."""
    return f"not_authored_here_{item_type_of(meta) or 'unknown'}"
