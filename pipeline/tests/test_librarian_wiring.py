"""#117 wiring — the greenfielded librarian is registered, handles its current
triggers, and declares modern tools against library_atoms (not the retired
library_units). The LLM reasoning itself runs live on deploy (real key)."""
from agents.fabric import AgentFabric
from agents.archetypes.librarian import LibrarianArchetype


def test_librarian_registered_in_fabric():
    assert "librarian" in AgentFabric()._archetypes


def test_librarian_handles_current_triggers():
    a = LibrarianArchetype()
    for ev in ("library.package.atomized", "package.atomized",
               "library.document.locked", "document.locked"):
        assert a.handles_event(ev), ev
    assert not a.handles_event("proposal.review_requested")


def test_librarian_tools_are_modern():
    names = [t["name"] for t in LibrarianArchetype().get_tools()]
    assert names == ["search_atoms", "get_tenant_profile", "search_memory"]


def test_librarian_prompt_targets_atoms_not_units():
    p = LibrarianArchetype().system_prompt.lower()
    assert "library_units" not in p
    assert "atom" in p


def test_fabric_routes_package_atomized_to_librarian():
    f = AgentFabric()
    handlers = [n for n, arch in f._archetypes.items()
                if arch.handles_event("library.package.atomized")]
    assert handlers == ["librarian"]


def test_tenant_discretion_model_cannot_choose_a_tenant():
    """A tenant-space agent is role-bound to its ASSIGNED tenant: the model-facing tool
    schemas must NOT expose tenant_id, so the LLM can never reference another tenant.
    The trusted tenant_id comes from the task context, not from tool input."""
    for tool in LibrarianArchetype().get_tools():
        props = tool["input_schema"].get("properties", {})
        assert "tenant_id" not in props, f"{tool['name']} must not let the model choose a tenant"


def test_build_messages_references_the_cocoon():
    a = LibrarianArchetype()
    msgs = a.build_messages(
        {"tenant_id": "t", "payload": {"cocoonId": "abc-123",
                                       "atoms": [{"id": "1", "title": "T", "content": "c"}]}},
        [],
    )
    assert any(isinstance(m.get("content"), str) and "abc-123" in m["content"] for m in msgs)
