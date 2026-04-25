"""Unit tests for portal artifact copy — customer data isolation.

Mocks both boto3 (S3 operations) and asyncpg (DB queries) to verify
that provision_portal_artifacts copies all expected artifacts from
the master rfp-pipeline path to the customer's isolated sandbox.
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, call

import pytest

from storage.portal_provisioner import provision_portal_artifacts


class FakeConn:
    """Minimal fake asyncpg.Connection for testing."""

    def __init__(self, opp_id: str, compliance: dict | None = None, topic_docs: list | None = None):
        self._opp_id = opp_id
        self._compliance = compliance
        self._topic_docs = topic_docs or []
        self._call_log: list[str] = []

    async def fetchval(self, query, *args):
        self._call_log.append(("fetchval", query[:60]))
        if "opportunity_id" in query:
            return self._opp_id
        return None

    async def fetchrow(self, query, *args):
        self._call_log.append(("fetchrow", query[:60]))
        if "solicitation_compliance" in query:
            return self._compliance
        return None

    async def fetch(self, query, *args):
        self._call_log.append(("fetch", query[:60]))
        if "document_type = 'topic'" in query:
            return self._topic_docs
        return []


@pytest.fixture(autouse=True)
def mock_s3(monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr("storage.s3_client._s3_client", mock_client)

    # list_keys returns master artifacts
    mock_client.list_objects_v2.return_value = {
        "Contents": [
            {"Key": "rfp-pipeline/opp-123/source.pdf"},
            {"Key": "rfp-pipeline/opp-123/text.md"},
            {"Key": "rfp-pipeline/opp-123/metadata.json"},
            {"Key": "rfp-pipeline/opp-123/shredded/cover.md"},
            {"Key": "rfp-pipeline/opp-123/shredded/eligibility.md"},
        ]
    }
    return mock_client


@pytest.mark.asyncio
async def test_copies_all_master_artifacts(mock_s3):
    conn = FakeConn(opp_id="opp-123")

    result = await provision_portal_artifacts(
        conn,
        tenant_slug="acme-tech",
        proposal_id="prop-456",
        solicitation_id="sol-789",
    )

    assert result["copied"] == 5  # 5 master artifacts, no compliance (None in this test)
    assert result["skipped"] == 0

    # Verify copy_object was called for each master artifact
    copy_calls = mock_s3.copy_object.call_args_list
    assert len(copy_calls) == 5

    # Verify destination prefix is correct
    for c in copy_calls:
        assert c[1]["Key"].startswith("customers/acme-tech/proposals/prop-456/rfp-snapshot/")


@pytest.mark.asyncio
async def test_includes_compliance_snapshot(mock_s3):
    comp = {
        "page_limit_technical": 15,
        "page_limit_cost": None,
        "font_family": "Times New Roman",
        "font_size": "10",
        "margins": "1 inch",
        "line_spacing": None,
        "submission_format": "DSIP",
        "taba_allowed": True,
        "pi_must_be_employee": True,
        "custom_variables": {"foreign_ownership": {"value": "required"}},
        "verified_by": "user-abc",
        "verified_at": "2026-04-22T15:00:00Z",
    }
    conn = FakeConn(opp_id="opp-123", compliance=comp)

    result = await provision_portal_artifacts(
        conn,
        tenant_slug="acme-tech",
        proposal_id="prop-456",
        solicitation_id="sol-789",
    )

    # 5 master artifacts + 1 compliance.json = 6
    assert result["copied"] == 6

    # Verify compliance.json was written (via put_object, not copy_object)
    put_calls = mock_s3.put_object.call_args_list
    comp_writes = [c for c in put_calls if "compliance.json" in c[1].get("Key", "")]
    assert len(comp_writes) == 1
    body = json.loads(comp_writes[0][1]["Body"])
    assert body["page_limit_technical"] == 15
    assert body["font_family"] == "Times New Roman"


@pytest.mark.asyncio
async def test_includes_topic_artifacts(mock_s3):
    topic_docs = [
        {"storage_key": "rfp-pipeline/opp-123/topics/af261-001.pdf", "original_filename": "AF261-001.pdf"},
    ]
    conn = FakeConn(opp_id="opp-123", topic_docs=topic_docs)

    result = await provision_portal_artifacts(
        conn,
        tenant_slug="acme-tech",
        proposal_id="prop-456",
        solicitation_id="sol-789",
        topic_id="topic-999",
    )

    # 5 master + 1 topic = 6
    assert result["copied"] == 6
    copy_calls = mock_s3.copy_object.call_args_list
    topic_copies = [c for c in copy_calls if "topics/" in c[1].get("Key", "")]
    assert len(topic_copies) == 1


@pytest.mark.asyncio
async def test_writes_manifest(mock_s3):
    conn = FakeConn(opp_id="opp-123")

    result = await provision_portal_artifacts(
        conn,
        tenant_slug="acme-tech",
        proposal_id="prop-456",
        solicitation_id="sol-789",
    )

    assert result["manifest_key"] is not None
    assert "manifest.json" in result["manifest_key"]

    # Verify the manifest was written to S3
    put_calls = mock_s3.put_object.call_args_list
    manifest_writes = [c for c in put_calls if "manifest.json" in c[1].get("Key", "")]
    assert len(manifest_writes) == 1
    body = json.loads(manifest_writes[0][1]["Body"])
    assert body["proposal_id"] == "prop-456"
    assert body["tenant_slug"] == "acme-tech"
    assert body["artifacts_copied"] == 5


@pytest.mark.asyncio
async def test_handles_copy_failure_gracefully(mock_s3):
    mock_s3.copy_object.side_effect = [
        None,  # first copy succeeds
        Exception("network error"),  # second copy fails
        None,  # third copy succeeds
        None,
        None,
    ]
    conn = FakeConn(opp_id="opp-123")

    result = await provision_portal_artifacts(
        conn,
        tenant_slug="acme-tech",
        proposal_id="prop-456",
        solicitation_id="sol-789",
    )

    assert result["copied"] == 4
    assert result["skipped"] == 1
