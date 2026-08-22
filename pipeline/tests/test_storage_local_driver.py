"""The pipeline's local storage driver — the counterpart the frontend has had since STORAGE-LOCAL.

WHY IT EXISTS. `lib/storage/s3-client.ts` reads STORAGE_DRIVER=local and writes under
LOCAL_STORAGE_DIR instead of talking to R2. The pipeline's s3_client had no such branch, so every
storage call needed boto3 — which is not installed in this sandbox.

The failure was QUIET, which is what made it worth fixing. The shredder catches the exception and
logs "S3 fetch failed … skipping", so a document simply never gets extracted and the run reports
success having done less. A storage layer that cannot store, reported as a completed job.

These tests pin the contract the two drivers must share: same env vars, same <bucket>/<key> layout,
a missing key is None rather than an exception, delete is idempotent, and a key may not escape the
bucket root.
"""
from __future__ import annotations

import importlib
import os
from unittest import mock

import pytest


@pytest.fixture()
def s3(tmp_path, monkeypatch):
    """s3_client bound to a throwaway directory on the local driver.

    LOCAL/LOCAL_DIR/BUCKET are read at module scope, so the obvious approach is setenv + reload.
    Don't: a reload REBINDS module globals, and monkeypatch can only undo the env vars it set, not
    the module state the reload derived from them. The reloaded BUCKET then leaks forward — it made
    test_storage_helpers' copy assertion fail against `testbucket` in a later file. Patching the
    attributes directly is both narrower and actually reversible.
    """
    from storage import s3_client
    monkeypatch.setattr(s3_client, "LOCAL", True)
    monkeypatch.setattr(s3_client, "LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(s3_client, "BUCKET", "testbucket")
    return s3_client


def test_the_local_driver_is_off_unless_asked_for():
    """Production must be untouched: no STORAGE_DRIVER, no local branch.

    This one genuinely needs a reload — the gate is evaluated at import. It restores the module
    afterwards, under the real environment, so nothing downstream inherits this import.
    """
    from storage import s3_client
    env = {k: v for k, v in os.environ.items() if k != "STORAGE_DRIVER"}
    try:
        with mock.patch.dict(os.environ, env, clear=True):
            assert importlib.reload(s3_client).LOCAL is False
    finally:
        importlib.reload(s3_client)


def test_round_trips_bytes(s3):
    s3.put_object(key="a/b/doc.pdf", body=b"%PDF-1.4 hello", content_type="application/pdf")
    assert s3.get_object_bytes("a/b/doc.pdf") == b"%PDF-1.4 hello"


def test_a_missing_key_is_none_not_an_exception(s3):
    """The shredder branches on a falsy return (`if not pdf_bytes: skip`). Raising here would turn
    an absent document into a crashed run."""
    assert s3.get_object_bytes("never/written.pdf") is None


def test_object_exists_both_ways(s3):
    s3.put_text(key="here.md", text="x")
    assert s3.object_exists("here.md") is True
    assert s3.object_exists("gone.md") is False


def test_delete_is_idempotent(s3):
    """S3 deleting an absent key is a no-op; the local driver keeps that contract so callers do not
    need to know which driver they are on."""
    s3.put_text(key="tmp.md", text="x")
    s3.delete_object("tmp.md")
    s3.delete_object("tmp.md")
    assert s3.object_exists("tmp.md") is False


def test_text_and_json_helpers_write_readable_bytes(s3):
    s3.put_text(key="notes.md", text="# heading")
    s3.put_json(key="meta.json", obj={"n": 1, "ok": True})
    assert s3.get_object_bytes("notes.md") == b"# heading"
    assert b'"n"' in s3.get_object_bytes("meta.json")


def test_copy_within_the_bucket(s3):
    s3.put_text(key="src/a.md", text="body")
    s3.copy_object(source_key="src/a.md", dest_key="dst/b.md")
    assert s3.get_object_bytes("dst/b.md") == b"body"
    assert s3.object_exists("src/a.md"), "copy must not move"


def test_copying_a_missing_key_raises(s3):
    with pytest.raises(RuntimeError):
        s3.copy_object(source_key="nope.md", dest_key="dst.md")


def test_list_keys_is_prefix_scoped_posix_and_relative(s3):
    """S3 returns keys relative to the bucket with forward slashes; so must the local driver, or
    every caller that re-derives a path from a listing breaks on one driver only."""
    for k in ("p/one.md", "p/sub/two.md", "other/three.md"):
        s3.put_text(key=k, text="x")
    assert s3.list_keys(prefix="p/") == ["p/one.md", "p/sub/two.md"]
    assert "other/three.md" in s3.list_keys(prefix="")
    assert s3.list_keys(prefix="nothing/") == []


def test_list_keys_honours_max_keys(s3):
    for i in range(5):
        s3.put_text(key=f"many/{i}.md", text="x")
    assert len(s3.list_keys(prefix="many/", max_keys=2)) == 2


def test_a_key_may_not_escape_the_bucket_root(s3):
    """Keys arrive from the database and from parsed documents. A traversal must be refused rather
    than quietly reading or writing outside the store."""
    for bad in ("../escape.md", "a/../../escape.md"):
        with pytest.raises(RuntimeError, match="escapes the bucket root"):
            s3.get_object_bytes(bad)
        with pytest.raises(RuntimeError):
            s3.put_text(key=bad, text="x")


def test_a_sibling_directory_sharing_the_bucket_prefix_is_still_an_escape(s3):
    """The near-miss a string-prefix containment check waves through.

    Bucket `testbucket`; the key `../testbucket-evil/x` resolves to a DIFFERENT directory that
    nonetheless starts with the root's path. Containment is a path relationship, not a substring.
    """
    with pytest.raises(RuntimeError, match="escapes the bucket root"):
        s3.put_text(key="../testbucket-evil/x.md", text="x")


def test_ping_reports_the_local_driver(s3):
    ping = s3.ping_s3()
    assert ping["ok"] is True
    assert ping["driver"] == "local"
    assert ping["bucket"] == "testbucket"


def test_layout_matches_the_frontend(s3, tmp_path):
    """Both services must agree where a key lives: <LOCAL_STORAGE_DIR>/<bucket>/<key>. A file
    written by the pipeline has to be readable by the frontend and vice versa."""
    s3.put_text(key="rfp-pipeline/abc/source.md", text="shared")
    assert (tmp_path / "testbucket" / "rfp-pipeline" / "abc" / "source.md").read_text() == "shared"
