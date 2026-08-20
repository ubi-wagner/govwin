"""A model must not write a federal form.

`volume_required_items.item_type` already separates the Volume 2 narrative a proposer writes from the
pdfs, forms and cost spreadsheets that are obtained, signed, filed or computed, and provisioning
copies it onto each section as meta.itemType. The drafter ignored it and produced ~4 KB of fluent
prose per certification on a live DoW 2026 build — an AI-authored "DD Form 2345", "Reps &
Certifications" and "Fraud, Waste, and Abuse Training Certification". These pin the rule that stops
it, and pin that the SELECTOR and the LANDER apply the same rule (they must agree, or the drafter
pays for a model call that is thrown away at the door).
"""
from __future__ import annotations

import json

import pytest

from workflows.actions.authorable import (
    AUTHORED_ITEM_TYPES,
    NON_AUTHORED_ITEM_TYPES,
    is_authorable,
    item_type_of,
    refusal_reason,
)


class TestWhatMayBeDrafted:
    @pytest.mark.parametrize("item_type", sorted(AUTHORED_ITEM_TYPES))
    def test_narrative_types_are_drafted(self, item_type: str) -> None:
        assert is_authorable({"itemType": item_type}) is True

    @pytest.mark.parametrize("item_type", sorted(NON_AUTHORED_ITEM_TYPES))
    def test_forms_attachments_and_workbooks_are_refused(self, item_type: str) -> None:
        assert is_authorable({"itemType": item_type}) is False

    def test_the_two_sets_do_not_overlap(self) -> None:
        assert not (AUTHORED_ITEM_TYPES & NON_AUTHORED_ITEM_TYPES)

    def test_every_type_in_the_db_check_constraint_is_classified(self) -> None:
        # volume_required_items carries a CHECK, so the vocabulary is closed. If someone widens it
        # they must decide which side the new type falls on rather than inheriting a default.
        from_check = {
            "word_doc", "slide_deck", "spreadsheet", "pdf", "text",
            "form_sf424", "form_sbir_certs", "form_other", "other",
        }
        assert from_check == (AUTHORED_ITEM_TYPES | NON_AUTHORED_ITEM_TYPES)


class TestReadingTheMeta:
    def test_accepts_a_dict(self) -> None:
        assert item_type_of({"itemType": "pdf"}) == "pdf"

    def test_accepts_jsonb_returned_as_a_string(self) -> None:
        # asyncpg hands back jsonb as text unless a codec is registered; the guard must not fall
        # open just because the driver did not parse it for us.
        assert item_type_of(json.dumps({"itemType": "form_other"})) == "form_other"
        assert is_authorable(json.dumps({"itemType": "form_other"})) is False

    @pytest.mark.parametrize("meta", [None, "", "not json", "[]", {}, {"itemType": ""}, {"itemType": 7}])
    def test_unknown_shapes_fall_open_to_drafting(self, meta) -> None:
        # Sections predating the field, or created by the volume-with-no-items fallback, carry no
        # itemType. Refusing those would silently stop drafting work the product has always done, so
        # the guard fires only on a type that positively says "this is a form".
        assert is_authorable(meta) is True

    def test_the_refusal_reason_names_the_type(self) -> None:
        assert refusal_reason({"itemType": "pdf"}) == "not_authored_here_pdf"
        assert refusal_reason(None) == "not_authored_here_unknown"


class TestSelectorAndLanderAgree:
    def test_both_modules_import_the_same_predicate(self) -> None:
        # The failure this prevents: draft_v0 selects a certification, pays for a model call, and
        # publish_section_draft throws the result away. publish_section_draft's own comment states
        # the requirement — "the two must agree or a section is selected for drafting and then
        # silently refused at landing".
        # importlib, not `import x as y`: actions/__init__.py re-exports each action function
        # under its own module's name, so `workflows.actions.publish_section_draft` resolves to the
        # FUNCTION once the package is imported, and attribute access on it fails. Reaching the
        # module by its full path is the only way to inspect what it bound.
        import importlib

        selector = importlib.import_module("workflows.actions.draft_v0")
        lander = importlib.import_module("workflows.actions.publish_section_draft")
        from workflows.actions.authorable import is_authorable as canonical

        assert selector.is_authorable is canonical
        assert lander.is_authorable is canonical
