"""Unit tests for pipeline S3 storage helpers.

Mocks boto3 to verify put_text, put_json, copy_object, and list_keys
call the underlying S3 client correctly. No real S3 needed.
"""
import json
from unittest.mock import MagicMock, patch

import pytest

from storage.s3_client import (
    BUCKET,
    put_text,
    put_json,
    copy_object,
    list_keys,
    put_object,
    get_object_bytes,
)


@pytest.fixture(autouse=True)
def mock_s3(monkeypatch):
    """Replace the lazy boto3 client with a mock for every test."""
    mock_client = MagicMock()
    monkeypatch.setattr("storage.s3_client._s3_client", mock_client)
    return mock_client


class TestPutText:
    def test_puts_utf8_bytes_with_markdown_content_type(self, mock_s3):
        put_text(key="test/file.md", text="# Hello\n\nWorld")
        mock_s3.put_object.assert_called_once()
        call_kwargs = mock_s3.put_object.call_args[1]
        assert call_kwargs["Key"] == "test/file.md"
        assert call_kwargs["Body"] == b"# Hello\n\nWorld"
        assert "markdown" in call_kwargs["ContentType"]

    def test_includes_metadata_when_provided(self, mock_s3):
        put_text(key="k", text="t", metadata={"actor": "shredder"})
        call_kwargs = mock_s3.put_object.call_args[1]
        assert call_kwargs["Metadata"] == {"actor": "shredder"}


class TestPutJson:
    def test_puts_json_bytes_with_json_content_type(self, mock_s3):
        put_json(key="test/meta.json", obj={"version": 1, "sections": []})
        call_kwargs = mock_s3.put_object.call_args[1]
        assert call_kwargs["Key"] == "test/meta.json"
        parsed = json.loads(call_kwargs["Body"])
        assert parsed["version"] == 1
        assert "json" in call_kwargs["ContentType"]

    def test_handles_non_serializable_with_default_str(self, mock_s3):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        put_json(key="k", obj={"ts": now})
        call_kwargs = mock_s3.put_object.call_args[1]
        parsed = json.loads(call_kwargs["Body"])
        assert isinstance(parsed["ts"], str)


class TestCopyObject:
    def test_calls_s3_copy(self, mock_s3):
        copy_object(source_key="a/b.pdf", dest_key="c/d.pdf")
        mock_s3.copy_object.assert_called_once_with(
            Bucket=BUCKET,
            CopySource={"Bucket": BUCKET, "Key": "a/b.pdf"},
            Key="c/d.pdf",
        )

    def test_raises_on_failure(self, mock_s3):
        mock_s3.copy_object.side_effect = Exception("network")
        with pytest.raises(RuntimeError, match="storage copy failed"):
            copy_object(source_key="a", dest_key="b")


class TestListKeys:
    def test_returns_keys_from_contents(self, mock_s3):
        mock_s3.list_objects_v2.return_value = {
            "Contents": [
                {"Key": "prefix/a.md"},
                {"Key": "prefix/b.json"},
            ]
        }
        keys = list_keys(prefix="prefix/")
        assert keys == ["prefix/a.md", "prefix/b.json"]
        mock_s3.list_objects_v2.assert_called_once()

    def test_returns_empty_list_when_no_contents(self, mock_s3):
        mock_s3.list_objects_v2.return_value = {}
        assert list_keys(prefix="empty/") == []

    def test_raises_on_failure(self, mock_s3):
        mock_s3.list_objects_v2.side_effect = Exception("denied")
        with pytest.raises(RuntimeError, match="storage list failed"):
            list_keys(prefix="x/")
