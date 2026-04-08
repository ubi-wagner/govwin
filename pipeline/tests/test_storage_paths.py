"""Unit tests for pipeline.src.storage.paths.

Mirrors frontend/__tests__/storage-paths.test.ts — any change to a
test here requires the same change there.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.storage.paths import (
    CustomerPathInput,
    StoragePathError,
    assert_key_belongs_to_tenant,
    customer_path,
    rfp_admin_discarded_path,
    rfp_admin_inbox_path,
    rfp_pipeline_path,
)

FIXED_DATE = datetime(2026, 4, 8, 12, 0, 0, tzinfo=timezone.utc)
OPP_UUID = "11111111-2222-3333-4444-555555555555"
PROP_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
ATTACH_UUID = "99999999-8888-7777-6666-555555555555"
UNIT_UUID = "deadbeef-1234-5678-90ab-cdef12345678"
ASSET_UUID = "cafef00d-1234-5678-90ab-cdef12345678"


class TestRfpAdminInboxPath:
    def test_builds_inbox_path_with_utc_date_parts(self) -> None:
        assert (
            rfp_admin_inbox_path(
                source="sam-gov",
                external_id="NOTICE-ABC-123",
                ext="PDF",
                at=FIXED_DATE,
            )
            == "rfp-admin/inbox/2026/04/08/sam-gov/NOTICE-ABC-123.pdf"
        )

    def test_lowercases_extension(self) -> None:
        p = rfp_admin_inbox_path(
            source="sbir-gov", external_id="id1", ext="DOCX", at=FIXED_DATE,
        )
        assert p.endswith(".docx")

    def test_rejects_unknown_source(self) -> None:
        with pytest.raises(StoragePathError, match="invalid source"):
            rfp_admin_inbox_path(
                source="unknown",  # type: ignore[arg-type]
                external_id="id1",
                ext="pdf",
            )

    def test_rejects_external_id_with_path_separator(self) -> None:
        with pytest.raises(StoragePathError, match="invalid external id"):
            rfp_admin_inbox_path(
                source="sam-gov", external_id="../escape", ext="pdf",
            )

    def test_rejects_ext_with_dot(self) -> None:
        with pytest.raises(StoragePathError, match="invalid extension"):
            rfp_admin_inbox_path(source="sam-gov", external_id="id1", ext=".pdf")


class TestRfpAdminDiscardedPath:
    def test_builds_path_with_yyyy_mm_only(self) -> None:
        assert (
            rfp_admin_discarded_path(external_id="id-1", ext="pdf", at=FIXED_DATE)
            == "rfp-admin/discarded/2026/04/id-1.pdf"
        )


class TestRfpPipelinePath:
    def test_source_kind_needs_ext(self) -> None:
        assert (
            rfp_pipeline_path(opportunity_id=OPP_UUID, kind="source", ext="pdf")
            == f"rfp-pipeline/{OPP_UUID}/source.pdf"
        )
        with pytest.raises(StoragePathError, match="source requires ext"):
            rfp_pipeline_path(opportunity_id=OPP_UUID, kind="source")

    def test_text_and_metadata_have_fixed_names(self) -> None:
        assert (
            rfp_pipeline_path(opportunity_id=OPP_UUID, kind="text")
            == f"rfp-pipeline/{OPP_UUID}/text.md"
        )
        assert (
            rfp_pipeline_path(opportunity_id=OPP_UUID, kind="metadata")
            == f"rfp-pipeline/{OPP_UUID}/metadata.json"
        )

    def test_shredded_kind_writes_under_shredded(self) -> None:
        assert (
            rfp_pipeline_path(
                opportunity_id=OPP_UUID, kind="shredded", name="requirements",
            )
            == f"rfp-pipeline/{OPP_UUID}/shredded/requirements.md"
        )

    def test_rejects_non_uuid_opportunity_id(self) -> None:
        with pytest.raises(StoragePathError, match="invalid opportunity id"):
            rfp_pipeline_path(opportunity_id="not-a-uuid", kind="text")


class TestCustomerPath:
    def test_upload_path_uses_yyyy_mm(self) -> None:
        assert (
            customer_path(
                CustomerPathInput(
                    tenant_slug="acme-corp",
                    kind="upload",
                    name=ATTACH_UUID,
                    ext="pdf",
                    at=FIXED_DATE,
                )
            )
            == f"customers/acme-corp/uploads/2026/04/{ATTACH_UUID}.pdf"
        )

    def test_proposal_section_path_uses_section_slug(self) -> None:
        assert (
            customer_path(
                CustomerPathInput(
                    tenant_slug="acme-corp",
                    kind="proposal-section",
                    proposal_id=PROP_UUID,
                    section_slug="executive-summary",
                )
            )
            == f"customers/acme-corp/proposals/{PROP_UUID}/sections/executive-summary.md"
        )

    def test_library_unit_path_under_library_units(self) -> None:
        assert (
            customer_path(
                CustomerPathInput(
                    tenant_slug="acme-corp", kind="library-unit", unit_id=UNIT_UUID,
                )
            )
            == f"customers/acme-corp/library/units/{UNIT_UUID}.md"
        )

    def test_library_asset_path_under_library_assets(self) -> None:
        assert (
            customer_path(
                CustomerPathInput(
                    tenant_slug="acme-corp",
                    kind="library-asset",
                    asset_id=ASSET_UUID,
                    ext="png",
                )
            )
            == f"customers/acme-corp/library/assets/{ASSET_UUID}.png"
        )

    def test_rejects_uppercase_tenant_slug(self) -> None:
        with pytest.raises(StoragePathError, match="invalid tenant slug"):
            customer_path(
                CustomerPathInput(
                    tenant_slug="AcmeCorp",
                    kind="upload",
                    name=ATTACH_UUID,
                    ext="pdf",
                )
            )

    def test_rejects_slug_with_slash_path_traversal_guard(self) -> None:
        with pytest.raises(StoragePathError, match="invalid tenant slug"):
            customer_path(
                CustomerPathInput(
                    tenant_slug="acme/../evil",
                    kind="upload",
                    name=ATTACH_UUID,
                    ext="pdf",
                )
            )

    def test_rejects_too_short_tenant_slug(self) -> None:
        with pytest.raises(StoragePathError, match="invalid tenant slug"):
            customer_path(
                CustomerPathInput(
                    tenant_slug="a", kind="library-unit", unit_id=UNIT_UUID,
                )
            )


class TestAssertKeyBelongsToTenant:
    def test_passes_for_matching_key(self) -> None:
        assert_key_belongs_to_tenant(
            "customers/acme-corp/uploads/2026/04/xyz.pdf", "acme-corp",
        )

    def test_throws_for_different_tenant(self) -> None:
        with pytest.raises(StoragePathError, match="does not belong to tenant"):
            assert_key_belongs_to_tenant(
                "customers/evil-corp/uploads/xyz.pdf", "acme-corp",
            )

    def test_throws_for_admin_key(self) -> None:
        with pytest.raises(StoragePathError, match="does not belong to tenant"):
            assert_key_belongs_to_tenant(
                "rfp-admin/inbox/2026/04/08/sam-gov/id.pdf", "acme-corp",
            )
