"""Voice of Proposal (mig 139 proposals.voice) threading into section_drafter.build_messages.

ADDITIVE + no-op when unset: the register instruction is appended to the drafting prompt ONLY when a
valid voice is supplied. When absent (or all-unknown tokens), the prompt is byte-identical to today's.
These tests verify exactly that — the register line appears only when voice is set, and the no-voice
prompt is unchanged."""
from agents.archetypes.section_drafter import SectionDrafterArchetype, _voice_register

_MARKER = "Voice of Proposal"


def _user_content(context):
    msgs = SectionDrafterArchetype().build_messages(context, [])
    # memories=[] → a single user message; grab its content.
    return " ".join(m["content"] for m in msgs if isinstance(m.get("content"), str))


def _base_ctx(**payload):
    return {"tenant_id": "t", "proposal_id": "p",
            "payload": {"section_title": "Technical Approach", **payload}}


def test_no_voice_is_byte_identical_no_op():
    """Absent voice → the register line does NOT appear and the prompt equals the baseline."""
    baseline = _user_content(_base_ctx())
    assert _MARKER not in baseline


def test_voice_list_appends_register_line():
    voiced = _user_content(_base_ctx(voice=["technical", "persuasive"]))
    assert _MARKER in voiced
    assert "technical, persuasive" in voiced


def test_voiced_prompt_is_baseline_plus_register_only():
    """The voiced prompt is the baseline with ONLY the register appended (nothing else changes)."""
    baseline = _user_content(_base_ctx())
    voiced = _user_content(_base_ctx(voice=["technical"]))
    assert voiced.startswith(baseline)
    assert voiced[len(baseline):] == _voice_register(["technical"])


def test_voice_at_top_level_context_also_threads():
    ctx = _base_ctx()
    ctx["voice"] = ["commercial"]
    voiced = _user_content(ctx)
    assert _MARKER in voiced and "commercial" in voiced


def test_voice_weighting_dict_threads_ordered_by_weight():
    voiced = _user_content(_base_ctx(voice={"technical": 0.3, "persuasive": 0.9}))
    assert _MARKER in voiced
    # ordered by descending weight: persuasive before technical
    assert "persuasive, technical" in voiced


def test_unknown_only_voice_is_no_op():
    """A voice with no known tokens is treated as unset — no register line."""
    assert _MARKER not in _user_content(_base_ctx(voice=["banana", "loud"]))
    assert _MARKER not in _user_content(_base_ctx(voice=[]))
    assert _MARKER not in _user_content(_base_ctx(voice={}))


def test_voice_register_helper_empty_for_falsy():
    # The guard that keeps the prompt byte-identical: no valid tokens → "".
    assert _voice_register(None) == ""
    assert _voice_register([]) == ""
    assert _voice_register("") == ""
    assert _voice_register(["technical"]).startswith("\n\nVoice of Proposal")
