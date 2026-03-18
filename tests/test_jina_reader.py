"""
Tests for brosearch/jina_reader.py — URL construction, error handling.
"""
import pytest
from unittest.mock import patch, MagicMock
from io import BytesIO
from brosearch.jina_reader import read_url, JINA_BASE


class TestReadUrl:
    def _mock_urlopen(self, content: str):
        """Return a context manager mock that yields response with content."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = content.encode('utf-8')
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return MagicMock(return_value=mock_resp)

    def test_constructs_jina_url(self):
        captured = {}
        def fake_urlopen(req, timeout=None):
            captured['url'] = req.full_url
            m = MagicMock()
            m.read.return_value = b'content'
            m.__enter__ = lambda s: s
            m.__exit__ = MagicMock(return_value=False)
            return m

        with patch('urllib.request.urlopen', fake_urlopen):
            read_url('https://example.com/page')

        assert captured['url'] == JINA_BASE + 'https://example.com/page'

    def test_returns_decoded_content(self):
        with patch('urllib.request.urlopen', self._mock_urlopen('# Hello World\n\nSome content.')):
            result = read_url('https://example.com')
        assert result == '# Hello World\n\nSome content.'

    def test_sets_accept_header(self):
        captured = {}
        def fake_urlopen(req, timeout=None):
            captured['headers'] = dict(req.headers)
            m = MagicMock()
            m.read.return_value = b'ok'
            m.__enter__ = lambda s: s
            m.__exit__ = MagicMock(return_value=False)
            return m

        with patch('urllib.request.urlopen', fake_urlopen):
            read_url('https://example.com')

        assert captured['headers'].get('Accept') == 'text/plain'

    def test_propagates_network_error(self):
        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('timeout')):
            with pytest.raises(urllib.error.URLError):
                read_url('https://example.com')

    def test_jina_base_url(self):
        assert JINA_BASE == 'https://r.jina.ai/'
