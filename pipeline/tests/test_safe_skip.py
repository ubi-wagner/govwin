"""Never fabricate into a table that carries citations; always label what you fabricate elsewhere.

A step the model fails must not dead-end the workflow, and must not pretend it succeeded. Which of
those two shapes applies depends on what the step produces:

  EVIDENCE  (shredder extraction) asserts what a solicitation SAYS, with a source_excerpt and a
            page. There is no honest way to generate one — a fabricated excerpt is manufactured
            evidence in the one table whose purpose is provenance. FULL SKIP, comment
            "needs completed and verified".

  ARTIFACT  (a section draft) is prose a proposer would have written. Nothing asserts a fact, so a
            labelled stand-in beats an empty section. FABRICATED CONTENT, note
            "meets style and form but not substance requirements".

The mark alone is not the protection — every provenance bug in this codebase was a mark that got
dropped downstream. That is precisely why evidence gets no fabrication at all.
"""
from __future__ import annotations

import pytest

from safe_skip import (
    MAX_MODEL_RETRIES,
    NEEDS_VERIFICATION_COMMENT,
    STYLE_NOT_SUBSTANCE_NOTE,
    placeholder_text,
    skip_artifact,
    skip_evidence,
)


class TestEvidenceNeverFabricates:
    def test_an_evidence_skip_carries_no_content_at_all(self):
        s = skip_evidence("section_extraction", "unparseable JSON")
        assert s.content is None
        assert s.as_result().get("content") is None
        assert "fabricated" not in s.as_result()

    def test_it_carries_the_comment_verbatim(self):
        s = skip_evidence("compliance_extraction", "timeout")
        assert s.comment == NEEDS_VERIFICATION_COMMENT == "needs completed and verified"
        assert s.as_result()["comment"] == NEEDS_VERIFICATION_COMMENT

    def test_it_never_carries_the_artifact_note(self):
        # Mixing the two would tell a reader the gap "meets style and form" — it meets nothing.
        s = skip_evidence("section_extraction", "boom")
        assert s.note is None
        assert STYLE_NOT_SUBSTANCE_NOTE not in str(s.as_result())

    def test_the_result_says_it_was_skipped_in_a_way_a_reader_cannot_miss(self):
        r = skip_evidence("section_extraction", "boom").as_result()
        assert r["skipped"] is True and r["safe_skip"] is True
        assert r["kind"] == "evidence"
        assert r["reason"] == "boom"


class TestArtifactFabricatesButLabels:
    def test_it_carries_content_and_the_note(self):
        s = skip_artifact("draft_v0", "model timeout", content=placeholder_text("Phase I SOW", "timeout"))
        assert s.content
        assert s.note == STYLE_NOT_SUBSTANCE_NOTE == "meets style and form but not substance requirements"
        assert s.as_result()["fabricated"] is True

    def test_it_never_carries_the_evidence_comment(self):
        s = skip_artifact("draft_v0", "boom", content="x")
        assert s.comment is None
        assert NEEDS_VERIFICATION_COMMENT not in str(s.as_result())

    def test_the_placeholder_announces_itself_on_its_FIRST_line(self):
        # A list view, an export preview and a diff all show the first line and nothing else.
        # Anything requiring a scroll to discover it is a draft is something that ships as a draft.
        text = placeholder_text("Phase I Statement of Work", "model returned prose")
        first = text.splitlines()[0]
        assert "PLACEHOLDER" in first
        assert STYLE_NOT_SUBSTANCE_NOTE in first

    def test_the_placeholder_names_the_section_and_the_reason(self):
        text = placeholder_text("Commercialization Strategy", "unparseable JSON")
        assert "Commercialization Strategy" in text
        assert "unparseable JSON" in text

    def test_the_placeholder_disclaims_any_source(self):
        # It must not be mistaken for something read from the solicitation or the library.
        text = placeholder_text("Key Personnel", "timeout")
        assert "Nothing here was read from the solicitation" in text
        assert "Replace this text before submission" in text


class TestTheTwoNeverBlur:
    def test_the_two_annotations_are_different_strings(self):
        assert NEEDS_VERIFICATION_COMMENT != STYLE_NOT_SUBSTANCE_NOTE

    @pytest.mark.parametrize("factory,kind", [(skip_evidence, "evidence")])
    def test_evidence_kind_is_recorded(self, factory, kind):
        assert factory("s", "r").kind == kind

    def test_artifact_kind_is_recorded(self):
        assert skip_artifact("s", "r", content="x").kind == "artifact"

    def test_exactly_one_annotation_is_ever_set(self):
        for s in (skip_evidence("s", "r"), skip_artifact("s", "r", content="x")):
            assert (s.comment is None) != (s.note is None), "exactly one of comment/note must be set"


class TestRetryBudget:
    def test_one_retry_is_the_default(self):
        # Cheap, covers the common transient, and is what a person would do. More would spend real
        # money re-asking a model that has already answered wrongly twice.
        assert MAX_MODEL_RETRIES == 1

    def test_attempts_are_recorded_so_a_reader_knows_it_was_re_asked(self):
        s = skip_evidence("section_extraction", "boom", attempts=MAX_MODEL_RETRIES + 1)
        assert s.as_result()["attempts"] == 2


class TestTheRetryActuallyFires:
    """The vocabulary tests above prove the shapes. These prove the behaviour."""

    @pytest.mark.asyncio
    async def test_call_claude_re_asks_once_then_raises(self):
        from shredder import runner

        calls: list[str] = []

        class _Block:
            def __init__(self, t): self.text = t

        class _Resp:
            def __init__(self, t):
                self.content = [_Block(t)]
                self.usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

        class _Messages:
            async def create(self, **kw):
                calls.append(kw["messages"][0]["content"])
                return _Resp("Emulated model response — prose, not JSON.")

        class _Client:
            messages = _Messages()

        with pytest.raises(ValueError) as ei:
            await runner._call_claude(_Client(), system_prompt="s", user_message="extract this")

        assert len(calls) == 2, "should have re-asked exactly once"
        assert "NOT VALID JSON" in calls[1], "the retry must say what was wrong, not just repeat"
        assert "attempt(s)" in str(ei.value), "the error must report how many attempts were made"

    @pytest.mark.asyncio
    async def test_a_good_reply_on_the_retry_is_accepted(self):
        from shredder import runner

        state = {"n": 0}

        class _Block:
            def __init__(self, t): self.text = t

        class _Resp:
            def __init__(self, t):
                self.content = [_Block(t)]
                self.usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

        class _Messages:
            async def create(self, **kw):
                state["n"] += 1
                return _Resp("oops, prose" if state["n"] == 1 else '{"sections": []}')

        class _Client:
            messages = _Messages()

        parsed, _i, _o = await runner._call_claude(_Client(), system_prompt="s", user_message="u")
        assert parsed == {"sections": []}
        assert state["n"] == 2, "the transient should have been recovered on the retry"
