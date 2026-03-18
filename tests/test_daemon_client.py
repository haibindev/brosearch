"""
Tests for brosearch/daemon_client.py — HTTP client, error handling.
All network calls are mocked.
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from brosearch.daemon_client import DaemonClient


def _mock_client(response_data: dict, status=200):
    """Return a DaemonClient with mocked _post and _get."""
    client = DaemonClient.__new__(DaemonClient)
    client.base = 'http://localhost:19824'
    client._post = MagicMock(return_value=response_data)
    client._get  = MagicMock(return_value=response_data)
    return client


# ─── _ok helper ──────────────────────────────────────────────────────────────

class TestOkHelper:
    def test_ok_returns_data(self):
        client = DaemonClient.__new__(DaemonClient)
        assert client._ok({'ok': True, 'data': [1, 2, 3]}, 'op') == [1, 2, 3]

    def test_not_ok_raises(self):
        client = DaemonClient.__new__(DaemonClient)
        with pytest.raises(RuntimeError, match='something failed'):
            client._ok({'ok': False, 'error': 'something failed'}, 'op')

    def test_not_ok_default_message(self):
        client = DaemonClient.__new__(DaemonClient)
        with pytest.raises(RuntimeError, match='op failed'):
            client._ok({'ok': False}, 'op')


# ─── fetch ────────────────────────────────────────────────────────────────────

class TestFetch:
    def test_fetch_passes_platform_command_args(self):
        client = _mock_client({'ok': True, 'data': [{'title': 'Test'}]})
        result = client.fetch('zhihu', 'hot', {'limit': 10})
        client._post.assert_called_once_with(
            '/api/fetch', {'platform': 'zhihu', 'command': 'hot', 'args': {'limit': 10}}
        )
        assert result == [{'title': 'Test'}]

    def test_fetch_defaults_empty_args(self):
        client = _mock_client({'ok': True, 'data': []})
        client.fetch('zhihu', 'hot')
        call_args = client._post.call_args[0][1]
        assert call_args['args'] == {}


# ─── navigate ─────────────────────────────────────────────────────────────────

class TestNavigate:
    def test_navigate_sends_url(self):
        client = _mock_client({'ok': True, 'data': {'tabId': 1}})
        result = client.navigate('https://zhihu.com')
        assert result == {'tabId': 1}
        payload = client._post.call_args[0][1]
        assert payload['url'] == 'https://zhihu.com'

    def test_navigate_with_tab_query(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.navigate('https://zhihu.com', tab_query={'url': '*://zhihu.com/*'})
        payload = client._post.call_args[0][1]
        assert payload['tabQuery'] == {'url': '*://zhihu.com/*'}


# ─── snapshot ─────────────────────────────────────────────────────────────────

class TestSnapshot:
    def test_snapshot_default_params(self):
        client = _mock_client({'ok': True, 'data': {'tree': '@1 root'}})
        result = client.snapshot()
        assert result == {'tree': '@1 root'}
        payload = client._post.call_args[0][1]
        assert payload['full'] is False

    def test_snapshot_with_depth(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.snapshot(depth=5)
        payload = client._post.call_args[0][1]
        assert payload['depth'] == 5

    def test_snapshot_full(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.snapshot(full=True)
        payload = client._post.call_args[0][1]
        assert payload['full'] is True


# ─── click / type / key_press ─────────────────────────────────────────────────

class TestInteractionMethods:
    def test_click_sends_ref(self):
        client = _mock_client({'ok': True, 'data': {'role': 'button'}})
        result = client.click(42)
        payload = client._post.call_args[0][1]
        assert payload['ref'] == 42
        assert result == {'role': 'button'}

    def test_type_text_sends_text_and_ref(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.type_text('hello', ref=5)
        payload = client._post.call_args[0][1]
        assert payload['text'] == 'hello'
        assert payload['ref'] == 5

    def test_type_text_no_ref(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.type_text('hello')
        payload = client._post.call_args[0][1]
        assert 'ref' not in payload

    def test_key_press_sends_key(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.key_press('Enter')
        payload = client._post.call_args[0][1]
        assert payload['key'] == 'Enter'

    def test_fill_sends_text_and_ref(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.fill('my text', 7)
        payload = client._post.call_args[0][1]
        assert payload['text'] == 'my text'
        assert payload['ref'] == 7

    def test_hover_sends_ref(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.hover(3)
        payload = client._post.call_args[0][1]
        assert payload['ref'] == 3

    def test_select_sends_ref_and_value(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.select(9, 'option_value')
        payload = client._post.call_args[0][1]
        assert payload['ref'] == 9
        assert payload['value'] == 'option_value'


# ─── scroll ───────────────────────────────────────────────────────────────────

class TestScroll:
    def test_scroll_default_params(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.scroll()
        payload = client._post.call_args[0][1]
        assert payload['deltaY'] == 600
        assert payload['deltaX'] == 0

    def test_scroll_with_ref(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.scroll(ref=12)
        payload = client._post.call_args[0][1]
        assert payload['ref'] == 12

    def test_scroll_no_ref_omits_key(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.scroll()
        payload = client._post.call_args[0][1]
        assert 'ref' not in payload


# ─── tab management ───────────────────────────────────────────────────────────

class TestTabManagement:
    def test_tab_list(self):
        tabs = [{'id': 1, 'url': 'https://a.com'}, {'id': 2, 'url': 'https://b.com'}]
        client = _mock_client({'ok': True, 'data': tabs})
        result = client.tab_list()
        assert result == tabs

    def test_tab_switch(self):
        client = _mock_client({'ok': True, 'data': {'tabId': 2}})
        client.tab_switch(2)
        payload = client._post.call_args[0][1]
        assert payload['tabId'] == 2

    def test_tab_close(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.tab_close(3)
        payload = client._post.call_args[0][1]
        assert payload['tabId'] == 3


# ─── reload / wait ────────────────────────────────────────────────────────────

class TestReloadAndWait:
    def test_reload_default(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.reload()
        payload = client._post.call_args[0][1]
        assert 'tabQuery' in payload

    def test_wait_ms_sends_ms(self):
        client = _mock_client({'ok': True, 'data': {}})
        client.wait_ms(2000)
        payload = client._post.call_args[0][1]
        assert payload['ms'] == 2000


# ─── diagnostics ──────────────────────────────────────────────────────────────

class TestDiagnostics:
    def test_get_console_sends_clear_flag(self):
        client = _mock_client({'ok': True, 'data': {'logs': [], 'count': 0}})
        client.get_console(clear=True)
        payload = client._post.call_args[0][1]
        assert payload['clear'] is True

    def test_get_errors_default_no_clear(self):
        client = _mock_client({'ok': True, 'data': {'errors': [], 'count': 0}})
        client.get_errors()
        payload = client._post.call_args[0][1]
        assert payload['clear'] is False

    def test_capture_sends_duration(self):
        client = _mock_client({'ok': True, 'data': [{'url': 'https://api.example.com'}]})
        result = client.capture({'url': '*://example.com/*'}, 5000)
        payload = client._post.call_args[0][1]
        assert payload['duration'] == 5000
        assert result == [{'url': 'https://api.example.com'}]


# ─── is_alive / extension_connected ──────────────────────────────────────────

class TestHealthChecks:
    def test_is_alive_true(self):
        client = _mock_client({'ok': True})
        assert client.is_alive() is True

    def test_is_alive_false_on_error(self):
        client = DaemonClient.__new__(DaemonClient)
        client.base = 'http://localhost:19824'
        client._get = MagicMock(side_effect=Exception('connection refused'))
        assert client.is_alive() is False

    def test_extension_connected_true(self):
        client = _mock_client({'ok': True, 'extension_connected': True})
        assert client.extension_connected() is True

    def test_extension_connected_false(self):
        client = _mock_client({'ok': True, 'extension_connected': False})
        assert client.extension_connected() is False
