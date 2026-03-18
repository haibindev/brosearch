"""
Smoke tests: all engine modules import cleanly and satisfy the SearchEngine contract.
"""
import pytest
from engines.base import SearchEngine, EngineResult
from engines.ddg_html import DuckDuckGoHtmlEngine
from engines.brave_html import BraveHtmlEngine
from engines.google_cse import GoogleCseEngine
from engines.bing_serpapi_http import BingSerpApiHttpEngine
from engines.wikipedia_api import WikipediaApiEngine


ALL_ENGINES = [
    DuckDuckGoHtmlEngine,
    BraveHtmlEngine,
    GoogleCseEngine,
    BingSerpApiHttpEngine,
    WikipediaApiEngine,
]


@pytest.mark.parametrize('EngineClass', ALL_ENGINES, ids=[e.__name__ for e in ALL_ENGINES])
class TestEngineContract:
    def test_instantiates(self, EngineClass):
        engine = EngineClass()
        assert engine is not None

    def test_is_search_engine_subclass(self, EngineClass):
        assert issubclass(EngineClass, SearchEngine)

    def test_has_name(self, EngineClass):
        assert isinstance(EngineClass.name, str) and len(EngineClass.name) > 0

    def test_doctor_returns_tuple(self, EngineClass):
        status, msg = EngineClass().doctor()
        assert status in ('ok', 'off', 'warn'), f"Unexpected status: {status!r}"
        assert isinstance(msg, str)

    def test_search_method_signature(self, EngineClass):
        """search() must accept (query, limit, timeout_sec)."""
        import inspect
        sig = inspect.signature(EngineClass.search)
        params = list(sig.parameters.keys())
        assert 'query' in params
        assert 'limit' in params
        assert 'timeout_sec' in params


class TestEngineResult:
    def test_to_dict_keys(self):
        r = EngineResult(title='Test', url='https://x.com', snippet='s', source='ddg', rank=1)
        d = r.to_dict()
        assert d == {'title': 'Test', 'url': 'https://x.com', 'snippet': 's', 'source': 'ddg', 'rank': 1}

    def test_defaults(self):
        r = EngineResult(title='T', url='https://u.com')
        assert r.snippet == ''
        assert r.source == ''
        assert r.rank == 0


class TestEnginesWithNoKey:
    """Engines that require API keys should fail gracefully (no exception on instantiation)."""

    def test_google_no_key_doctor_off(self):
        import os
        env_backup = {k: os.environ.pop(k, None) for k in ('GOOGLE_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID')}
        try:
            status, msg = GoogleCseEngine().doctor()
            assert status == 'off'
        finally:
            for k, v in env_backup.items():
                if v is not None:
                    os.environ[k] = v

    def test_bing_no_key_doctor_off(self):
        import os
        key_backup = os.environ.pop('SERPAPI_API_KEY', None)
        try:
            status, msg = BingSerpApiHttpEngine().doctor()
            assert status == 'off'
        finally:
            if key_backup is not None:
                os.environ['SERPAPI_API_KEY'] = key_backup
