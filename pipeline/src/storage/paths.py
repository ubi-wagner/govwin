"""Object-storage path helpers — canonical source for S3 keys.

ALL application code that needs an S3 key MUST go through one of the
functions in this file. Never concatenate bucket/key strings in callers.
See docs/STORAGE_LAYOUT.md and docs/DECISIONS.md D002 for the layout
rationale.

This is the Python mirror of frontend/lib/storage/paths.ts. The two
files must stay in lock-step — any change here requires the same
change there. All functions are pure and produce deterministic output.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

RfpSource = Literal["sam-gov", "sbir-gov", "grants-gov", "manual-upload"]
RfpPipelineKind = Literal["source", "text", "metadata", "shredded", "attachment"]
CustomerKind = Literal[
    "upload",
    "proposal-section",
    "proposal-attachment",
    "proposal-export",
    "library-unit",
    "library-asset",
]

_TENANT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_SECTION_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_EXT_RE = re.compile(r"^[a-z0-9]{1,8}$")
_EXTERNAL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_RFP_SOURCES: tuple[RfpSource, ...] = (
    "sam-gov",
    "sbir-gov",
    "grants-gov",
    "manual-upload",
)


class StoragePathError(ValueError):
    """Raised when a path helper receives invalid input."""


def _assert_tenant_slug(slug: str) -> None:
    if not _TENANT_SLUG_RE.match(slug):
        raise StoragePathError(f"invalid tenant slug: {slug!r}")


def _assert_uuid(value: str, label: str) -> None:
    if not _UUID_RE.match(value):
        raise StoragePathError(f"invalid {label}: {value!r}")


def _assert_section_slug(value: str) -> None:
    if not _SECTION_SLUG_RE.match(value):
        raise StoragePathError(f"invalid section slug: {value!r}")


def _assert_ext(ext: str) -> str:
    lower = ext.lower()
    if not _EXT_RE.match(lower):
        raise StoragePathError(f"invalid extension: {ext!r}")
    return lower


def _assert_external_id(value: str) -> None:
    if not _EXTERNAL_ID_RE.match(value):
        raise StoragePathError(f"invalid external id: {value!r}")


def _assert_source(source: str) -> None:
    if source not in _RFP_SOURCES:
        raise StoragePathError(f"invalid source: {source!r}")


def _ymd(date: Optional[datetime]) -> tuple[str, str, str]:
    d = date or datetime.now(timezone.utc)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return (
        f"{d.year:04d}",
        f"{d.month:02d}",
        f"{d.day:02d}",
    )


# ----------------------------------------------------------------------------
# rfp-admin/ — curation staging
# ----------------------------------------------------------------------------


def rfp_admin_inbox_path(
    *,
    source: RfpSource,
    external_id: str,
    ext: str,
    at: Optional[datetime] = None,
) -> str:
    _assert_source(source)
    _assert_external_id(external_id)
    ext_lower = _assert_ext(ext)
    yyyy, mm, dd = _ymd(at)
    return f"rfp-admin/inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext_lower}"


def rfp_admin_discarded_path(
    *,
    external_id: str,
    ext: str,
    at: Optional[datetime] = None,
) -> str:
    _assert_external_id(external_id)
    ext_lower = _assert_ext(ext)
    yyyy, mm, _dd = _ymd(at)
    return f"rfp-admin/discarded/{yyyy}/{mm}/{external_id}.{ext_lower}"


# ----------------------------------------------------------------------------
# rfp-pipeline/ — published opportunity artifacts
# ----------------------------------------------------------------------------


def rfp_pipeline_path(
    *,
    opportunity_id: str,
    kind: RfpPipelineKind,
    name: Optional[str] = None,
    ext: Optional[str] = None,
) -> str:
    _assert_uuid(opportunity_id, "opportunity id")
    base = f"rfp-pipeline/{opportunity_id}"

    if kind == "source":
        if not ext:
            raise StoragePathError("rfp-pipeline source requires ext")
        return f"{base}/source.{_assert_ext(ext)}"
    if kind == "text":
        return f"{base}/text.md"
    if kind == "metadata":
        return f"{base}/metadata.json"
    if kind == "shredded":
        if not name:
            raise StoragePathError("rfp-pipeline shredded requires name")
        _assert_section_slug(name)
        return f"{base}/shredded/{name}.md"
    if kind == "attachment":
        if not name or not ext:
            raise StoragePathError("rfp-pipeline attachment requires name and ext")
        _assert_section_slug(name)
        return f"{base}/attachments/{name}.{_assert_ext(ext)}"
    raise StoragePathError(f"unknown rfp-pipeline kind: {kind!r}")


# ----------------------------------------------------------------------------
# customers/ — per-tenant isolated storage
# ----------------------------------------------------------------------------


@dataclass(frozen=True)
class CustomerPathInput:
    tenant_slug: str
    kind: CustomerKind
    proposal_id: Optional[str] = None
    section_slug: Optional[str] = None
    unit_id: Optional[str] = None
    asset_id: Optional[str] = None
    name: Optional[str] = None
    ext: Optional[str] = None
    at: Optional[datetime] = None


def customer_path(p: CustomerPathInput) -> str:
    _assert_tenant_slug(p.tenant_slug)
    base = f"customers/{p.tenant_slug}"

    if p.kind == "upload":
        if not p.name or not p.ext:
            raise StoragePathError("customer upload requires name and ext")
        _assert_uuid(p.name, "upload uuid")
        yyyy, mm, _dd = _ymd(p.at)
        return f"{base}/uploads/{yyyy}/{mm}/{p.name}.{_assert_ext(p.ext)}"

    if p.kind == "proposal-section":
        if not p.proposal_id or not p.section_slug:
            raise StoragePathError("proposal-section requires proposal_id and section_slug")
        _assert_uuid(p.proposal_id, "proposal id")
        _assert_section_slug(p.section_slug)
        return f"{base}/proposals/{p.proposal_id}/sections/{p.section_slug}.md"

    if p.kind == "proposal-attachment":
        if not p.proposal_id or not p.name or not p.ext:
            raise StoragePathError("proposal-attachment requires proposal_id, name, ext")
        _assert_uuid(p.proposal_id, "proposal id")
        _assert_uuid(p.name, "attachment uuid")
        return f"{base}/proposals/{p.proposal_id}/attachments/{p.name}.{_assert_ext(p.ext)}"

    if p.kind == "proposal-export":
        if not p.proposal_id or not p.name or not p.ext:
            raise StoragePathError("proposal-export requires proposal_id, name, ext")
        _assert_uuid(p.proposal_id, "proposal id")
        _assert_section_slug(p.name)
        return f"{base}/proposals/{p.proposal_id}/exports/{p.name}.{_assert_ext(p.ext)}"

    if p.kind == "library-unit":
        if not p.unit_id:
            raise StoragePathError("library-unit requires unit_id")
        _assert_uuid(p.unit_id, "library unit id")
        return f"{base}/library/units/{p.unit_id}.md"

    if p.kind == "library-asset":
        if not p.asset_id or not p.ext:
            raise StoragePathError("library-asset requires asset_id and ext")
        _assert_uuid(p.asset_id, "library asset id")
        return f"{base}/library/assets/{p.asset_id}.{_assert_ext(p.ext)}"

    raise StoragePathError(f"unknown customer kind: {p.kind!r}")


def assert_key_belongs_to_tenant(key: str, tenant_slug: str) -> None:
    """Guard — raises if ``key`` does not belong to the given tenant.

    Use at the boundary of any operation that takes a user-supplied
    object key and must enforce tenant isolation.
    """
    _assert_tenant_slug(tenant_slug)
    prefix = f"customers/{tenant_slug}/"
    if not key.startswith(prefix):
        raise StoragePathError(
            f"key {key!r} does not belong to tenant {tenant_slug!r}"
        )
