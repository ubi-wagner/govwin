"""THE CRM DATABASE VARIABLE HAS ONE RESOLVER, and this is what keeps it that way.

`CMS_DATABASE_URL` was renamed to `CRM_DATABASE`. Before the rename the name was read directly in
eight places — three Python files, a bash migration runner, two CI workflows, a compose file and a
sandbox env — which is eight independent chances for a rename to strand something.

── WHY A RENAME IS DANGEROUS HERE SPECIFICALLY ────────────────────────────────────────────────
Two reasons, and they compound:

1. **The variable and the code that reads it do not change in the same instant.** Whichever moves
   first, a single-name reader is a service that will not boot in the gap — and `init_db()` raises
   `RuntimeError`, so the gap is an outage, not a degradation.

2. **The CI migration step used to SILENTLY SKIP.** `::warning::` plus `exit 0` meant an unset
   secret left the CRM database un-migrated while the workflow stayed green. A rename that updated
   Railway and not the GitHub secret would have produced exactly that: no error anywhere, and
   migrations quietly stopped. (B145: a step that finds a problem and does not fail the run reports
   the opposite of what it found.)

So: one resolver, a fallback chain that spans the rename in both directions, and this file to
assert that nothing has gone back to reading the raw name — and that the bash copy of the chain,
which cannot import the Python one, still agrees with it.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys

import pytest

CMS = pathlib.Path(__file__).resolve().parents[1]
REPO = CMS.parents[1]
sys.path.insert(0, str(CMS))

from src.models.database import _CRM_URL_VARS, crm_database_url  # noqa: E402

#: The one file allowed to name the environment variables.
RESOLVER = CMS / "src" / "models" / "database.py"


def _py_files() -> list[pathlib.Path]:
    return [
        p for p in (CMS / "src").rglob("*.py")
        if "__pycache__" not in str(p)
    ] + [
        p for p in (CMS / "scripts").rglob("*.py")
        if "__pycache__" not in str(p)
    ]


def test_the_resolver_prefers_the_new_name():
    # Order matters: during the overlap BOTH names are set, and the new one has to win or the
    # deprecation warning fires forever and the legacy entry can never be retired.
    assert _CRM_URL_VARS[0] == "CRM_DATABASE"
    assert "CMS_DATABASE_URL" in _CRM_URL_VARS, "the legacy name must still be honoured mid-rename"


def test_the_resolver_actually_resolves(monkeypatch):
    for var in _CRM_URL_VARS:
        monkeypatch.delenv(var, raising=False)
    assert crm_database_url() is None

    monkeypatch.setenv("CMS_DATABASE_URL", "postgresql://legacy/db")
    assert crm_database_url() == "postgresql://legacy/db", "the legacy name must still work"

    monkeypatch.setenv("CRM_DATABASE", "postgresql://new/db")
    assert crm_database_url() == "postgresql://new/db", "the new name must WIN when both are set"


def test_no_python_file_reads_the_variable_directly():
    offenders = []
    for path in _py_files():
        if path == RESOLVER:
            continue
        src = path.read_text(encoding="utf-8")
        for var in _CRM_URL_VARS:
            # `os.getenv("CRM_DATABASE")` and friends. A docstring mention is fine; a read is not.
            if re.search(rf'os\.(?:getenv|environ)[\[(]\s*["\']{var}["\']', src):
                offenders.append(f"{path.relative_to(REPO)} reads {var} directly")
    assert offenders == [], (
        "these files bypass crm_database_url(). A rename then has to find them one at a time, "
        "which is how one gets missed: " + "; ".join(offenders)
    )


def test_the_bash_chain_matches_the_python_chain():
    # `db/run.sh` cannot import the Python resolver, so it repeats the chain. A rename that updated
    # one and not the other is exactly the failure the chain exists to prevent, so the two are
    # reconciled here rather than trusted to stay in step.
    run_sh = (CMS / "db" / "run.sh").read_text(encoding="utf-8")
    line = next((l for l in run_sh.splitlines() if l.startswith("CONN=")), "")
    assert line, "db/run.sh no longer assigns CONN — the chain has moved and this check is blind"

    found = re.findall(r"([A-Z_]*DATABASE[A-Z_]*)", line)
    assert list(dict.fromkeys(found)) == list(_CRM_URL_VARS), (
        f"db/run.sh resolves {found} but the Python resolver uses {list(_CRM_URL_VARS)} — "
        "same order, same names, or a rename strands one of them"
    )


def test_the_workflows_read_the_new_name():
    # The CI migration step is the one that used to skip silently. If a workflow still reads only
    # the legacy secret, renaming it in GitHub takes the CRM migrations offline with no error.
    for wf in ("migrate.yml", "ci.yml"):
        src = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        if "DATABASE" not in src:
            continue
        if "CMS_DATABASE_URL" in src:
            assert "CRM_DATABASE" in src, (
                f".github/workflows/{wf} reads CMS_DATABASE_URL but never CRM_DATABASE — "
                "renaming the secret would silently strand it"
            )


def test_the_crm_migration_step_no_longer_skips_silently():
    # The specific regression: `::warning::` + `exit 0` on a missing connection string left the
    # database un-migrated and the run green.
    src = (REPO / ".github" / "workflows" / "migrate.yml").read_text(encoding="utf-8")
    crm_section = src.split("migrate-crm-prod", 1)
    assert len(crm_section) == 2, "the CRM production migration job has been renamed or removed"
    body = crm_section[1]
    assert "::warning::Neither" not in body
    assert "::error::Neither CRM_DATABASE" in body, (
        "an unset CRM connection string must FAIL the run. A warning-and-skip reports a green "
        "migration workflow against a database that was never migrated."
    )


@pytest.mark.skipif(not os.getenv("CRM_DATABASE"), reason="no CRM database configured here")
def test_the_configured_url_is_reachable_shape():
    # Not a connection — just that whatever is configured looks like one, so a truncated or
    # placeholder value fails here rather than at startup in the deployment.
    url = crm_database_url() or ""
    assert url.startswith("postgres"), f"CRM_DATABASE does not look like a connection string: {url[:20]}…"
