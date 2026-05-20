"""Tests for template rendering and trigger flag system."""
import json
import base64
import pytest
from src.templates import (
    render_template,
    render_jinja2,
    embed_trigger_flags,
    extract_trigger_flags,
    build_trigger_metadata,
)


class TestRenderJinja2:
    def test_basic_variable_substitution(self):
        result = render_jinja2('Hello {{name}}!', {'name': 'World'})
        assert result == 'Hello World!'

    def test_missing_variable_renders_empty(self):
        result = render_jinja2('Hello {{name}}!', {})
        assert 'Hello' in result

    def test_html_preserved(self):
        result = render_jinja2('<p>{{msg}}</p>', {'msg': 'test'})
        assert result == '<p>test</p>'

    def test_complex_context(self):
        result = render_jinja2(
            '{{company}} has {{count}} opportunities',
            {'company': 'Acme', 'count': '5'},
        )
        assert result == 'Acme has 5 opportunities'


class TestRenderTemplate:
    def test_legacy_template_renders(self):
        html = render_template('application_accepted', {
            'contactName': 'Jane',
            'tenantName': 'Acme Corp',
            'contactEmail': 'jane@acme.com',
            'tenantSlug': 'acme',
            'loginUrl': '/login',
        })
        assert html is not None
        assert 'Jane' in html
        assert 'Acme Corp' in html

    def test_unknown_template_returns_none(self):
        result = render_template('nonexistent_template', {})
        assert result is None

    def test_inline_jinja_template(self):
        result = render_template('<p>Hi {{name}}</p>', {'name': 'Test'})
        assert result is not None
        assert 'Hi Test' in result


class TestTriggerFlags:
    def test_embed_and_extract_roundtrip(self):
        meta = {
            'namespace': 'capture',
            'type': 'lead.outreach',
            'send_id': 'abc123',
            'tenant_id': 'tenant-uuid',
        }
        html = '<html><body><p>Hello</p></body></html>'
        embedded = embed_trigger_flags(html, meta)
        assert '<!--RFP-TRIGGER:' in embedded

        extracted = extract_trigger_flags(embedded)
        assert extracted is not None
        assert extracted['namespace'] == 'capture'
        assert extracted['type'] == 'lead.outreach'
        assert extracted['send_id'] == 'abc123'

    def test_embed_empty_meta_returns_unchanged(self):
        html = '<p>Hello</p>'
        assert embed_trigger_flags(html, {}) == html
        assert embed_trigger_flags(html, None) == html

    def test_extract_no_trigger_returns_none(self):
        assert extract_trigger_flags('<p>No trigger here</p>') is None
        assert extract_trigger_flags('') is None
        assert extract_trigger_flags(None) is None

    def test_extract_survives_surrounding_content(self):
        meta = {'test': True}
        encoded = base64.b64encode(json.dumps(meta).encode()).decode()
        html = f'<p>Some content</p><!--RFP-TRIGGER:{encoded}--><p>More content</p>'
        result = extract_trigger_flags(html)
        assert result == {'test': True}


class TestBuildTriggerMetadata:
    def test_builds_from_config(self, sample_template):
        meta = build_trigger_metadata(
            template=sample_template,
            send_context={'send_id': 'send-1', 'tenant_id': 'tenant-1'},
        )
        assert meta['namespace'] == 'capture'
        assert meta['type'] == 'lead.outreach'
        assert meta['send_id'] == 'send-1'
        assert meta['auto_response_enabled'] is True
        assert 'interest' in meta['expected_responses']

    def test_empty_trigger_config_returns_empty(self):
        meta = build_trigger_metadata(
            template={'trigger_config': {}},
            send_context={},
        )
        assert meta == {}

    def test_includes_step_for_drip(self):
        template = {
            'trigger_config': {
                'namespace': 'capture',
                'type': 'drip',
                'step': 'day_1',
                'auto_response_enabled': False,
            },
            'id': 'tmpl-1',
            'slug': 'test',
        }
        meta = build_trigger_metadata(template, {'send_id': 's1'})
        assert meta['step'] == 'day_1'
