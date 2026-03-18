"""
Tests for brosearch/search.py — engine aggregation, dedup, caching, check_engines.
All HTTP calls are mocked.
"""
import json
import time
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from engines.base import EngineResult
from brosearch.search import (
    _cache_key,
    _load_engine,
    aggregate_search,
    check_engines,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_result(title, url, snippet='', source='test', rank=1):
    return EngineResult(title=title, url=url, snippet=snippet, source=source, rank=rank)


def _mock_engine_class(results=None, doctor_status='ok', raise_on_search=None):
    """Return a mock engine class."""
    eng = MagicMock()
    eng.doctor.return_value = (doctor_status, 'msg')
    if raise_on_search:
        eng.search.side_effect = raise_on_search
    else:
        eng.search.return_value = results or []
    klass = MagicMock(return_value=eng)
    return klass


# ─── _cache_key ──────────────────────────────────────────────────────────────

class TestCacheKey:
    def test_deterministic(self):
        k1 = _cache_key('python', ['ddg', 'brave'], 10)
        k2 = _cache_key('python', ['ddg', 'brave'], 10)
        assert k1 == k2

    def test_engine_order_independent(self):
        k1 = _cache_key('python', ['ddg', 'brave'], 10)
        k2 = _cache_key('python', ['brave', 'ddg'], 10)
        assert k1 == k2

    def test_different_query_different_key(self):
        k1 = _cache_key('python', ['ddg'], 10)
        k2 = _cache_key('rust', ['ddg'], 10)
        assert k1 != k2

    def test_different_limit_different_key(self):
        k1 = _cache_key('python', ['ddg'], 5)
        k2 = _cache_key('python', ['ddg'], 10)
        assert k1 != k2

    def test_returns_hex_string(self):
        k = _cache_key('test', ['ddg'], 10)
        assert len(k) == 32
        assert all(c in '0123456789abcdef' for c in k)


# ─── _load_engine ─────────────────────────────────────────────────────────────

class TestLoadEngine:
    def test_loads_ddg(self):
        cls = _load_engine('ddg')
        assert cls is not None
        assert cls.__name__ == 'DuckDuckGoHtmlEngine'

    def test_loads_google(self):
        cls = _load_engine('google')
        assert cls is not None
        assert cls.__name__ == 'GoogleCseEngine'

    def test_loads_bing(self):
        cls = _load_engine('bing')
        assert cls is not None
        assert cls.__name__ == 'BingSerpApiHttpEngine'

    def test_loads_brave(self):
        cls = _load_engine('brave')
        assert cls is not None
        assert cls.__name__ == 'BraveHtmlEngine'

    def test_loads_wikipedia(self):
        cls = _load_engine('wikipedia')
        assert cls is not None
        assert cls.__name__ == 'WikipediaApiEngine'

    def test_unknown_engine_returns_none(self):
        assert _load_engine('nonexistent_engine_xyz') is None


# ─── aggregate_search ─────────────────────────────────────────────────────────

class TestAggregateSearch:
    def _run(self, engines_map, query='test', engines=None, limit=5):
        """Run aggregate_search with patched _load_engine."""
        def fake_load(name):
            return engines_map.get(name)

        with patch('brosearch.search._load_engine', side_effect=fake_load), \
             patch('brosearch.search._cache_get', return_value=None), \
             patch('brosearch.search._cache_set'):
            return aggregate_search(query, engines=engines or list(engines_map.keys()), limit=limit)

    def test_basic_results_returned(self):
        klass = _mock_engine_class([
            _make_result('Result A', 'https://a.com'),
            _make_result('Result B', 'https://b.com'),
        ])
        out = self._run({'ddg': klass}, query='hello', limit=10)
        assert len(out['results']) == 2
        assert out['results'][0]['url'] == 'https://a.com'
        assert out['results'][0]['title'] == 'Result A'

    def test_results_are_dicts(self):
        klass = _mock_engine_class([_make_result('T', 'https://x.com')])
        out = self._run({'ddg': klass})
        r = out['results'][0]
        assert isinstance(r, dict)
        assert 'url' in r and 'title' in r

    def test_dedup_by_url(self):
        klass = _mock_engine_class([
            _make_result('A', 'https://same.com'),
            _make_result('B', 'https://same.com'),  # duplicate URL
        ])
        out = self._run({'ddg': klass})
        assert len(out['results']) == 1

    def test_dedup_by_title(self):
        klass = _mock_engine_class([
            _make_result('Same Title', 'https://a.com'),
            _make_result('Same Title', 'https://b.com'),  # duplicate title
        ])
        out = self._run({'ddg': klass})
        assert len(out['results']) == 1

    def test_cross_engine_dedup(self):
        k1 = _mock_engine_class([_make_result('Dup', 'https://dup.com')])
        k2 = _mock_engine_class([_make_result('Dup', 'https://dup.com')])
        out = self._run({'ddg': k1, 'brave': k2}, engines=['ddg', 'brave'])
        assert len(out['results']) == 1

    def test_source_assigned_from_engine_name(self):
        klass = _mock_engine_class([_make_result('T', 'https://x.com')])
        out = self._run({'ddg': klass})
        assert out['results'][0]['source'] == 'ddg'

    def test_rank_is_sequential(self):
        klass = _mock_engine_class([
            _make_result('A', 'https://a.com'),
            _make_result('B', 'https://b.com'),
        ])
        out = self._run({'ddg': klass})
        assert out['results'][0]['rank'] == 1
        assert out['results'][1]['rank'] == 2

    def test_unknown_engine_recorded_in_errors(self):
        out = self._run({}, query='test', engines=['no_such_engine'])
        assert any(e['engine'] == 'no_such_engine' for e in out['errors'])

    def test_engine_exception_recorded_in_errors(self):
        klass = _mock_engine_class(raise_on_search=RuntimeError('network fail'))
        out = self._run({'ddg': klass})
        assert any('network fail' in e['error'] for e in out['errors'])

    def test_meta_engines_used(self):
        klass = _mock_engine_class([_make_result('T', 'https://x.com')])
        out = self._run({'ddg': klass})
        assert 'ddg' in out['meta']['engines_used']

    def test_meta_from_cache_false_on_fresh(self):
        klass = _mock_engine_class([])
        out = self._run({'ddg': klass})
        assert out['meta']['from_cache'] is False

    def test_cache_hit_returns_cached(self):
        cached = {'query': 'q', 'results': [{'title': 'Cached', 'url': 'https://c.com'}],
                  'meta': {'engines_used': ['ddg'], 'time_ms': 10, 'from_cache': False}, 'errors': []}
        with patch('brosearch.search._cache_get', return_value=cached):
            out = aggregate_search('q', engines=['ddg'], limit=5)
        assert out['meta']['from_cache'] is True
        assert out['results'][0]['title'] == 'Cached'

    def test_search_timeout_passed(self):
        """engine.search() must be called with timeout_sec arg."""
        klass = _mock_engine_class([])
        self._run({'ddg': klass})
        call_kwargs = klass.return_value.search.call_args
        assert 'timeout_sec' in call_kwargs.kwargs or len(call_kwargs.args) >= 3

    def test_limit_passed_to_engine(self):
        """limit is forwarded to engine.search(); total output bounded by _MAX_AGGREGATE."""
        klass = _mock_engine_class([])
        self._run({'ddg': klass}, limit=7)
        call_kwargs = klass.return_value.search.call_args
        # limit must be passed as keyword or positional arg
        limit_val = call_kwargs.kwargs.get('limit') or (call_kwargs.args[1] if len(call_kwargs.args) > 1 else None)
        assert limit_val == 7

    def test_empty_engines_list(self):
        with patch('brosearch.search._load_engine', return_value=None), \
             patch('brosearch.search._cache_get', return_value=None), \
             patch('brosearch.search._cache_set'):
            out = aggregate_search('query', engines=['no_engine_1', 'no_engine_2'], limit=5)
        assert out['results'] == []


# ─── check_engines ───────────────────────────────────────────────────────────

class TestCheckEngines:
    def test_ok_engine(self):
        klass = _mock_engine_class(doctor_status='ok')
        with patch('brosearch.search._load_engine', return_value=klass), \
             patch('brosearch.search._ENGINE_PRIORITY', ['ddg']):
            status = check_engines()
        assert status['ddg'] == 'ok'

    def test_off_engine(self):
        klass = _mock_engine_class(doctor_status='off')
        with patch('brosearch.search._load_engine', return_value=klass), \
             patch('brosearch.search._ENGINE_PRIORITY', ['google']):
            status = check_engines()
        assert status['google'] == 'no key'

    def test_missing_engine(self):
        with patch('brosearch.search._load_engine', return_value=None), \
             patch('brosearch.search._ENGINE_PRIORITY', ['xyz']):
            status = check_engines()
        assert status['xyz'] == 'missing'

    def test_real_engines_importable(self):
        """All built-in engines must be loadable (import smoke test)."""
        for name in ['google', 'bing', 'brave', 'ddg', 'wikipedia']:
            cls = _load_engine(name)
            assert cls is not None, f'Engine {name!r} failed to load'
