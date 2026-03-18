"""
HTTP search engine aggregator — absorbed from base-websearch.
No Chrome dependency, works anywhere Python runs.
"""
import time
import json
import hashlib
import os
from pathlib import Path
from typing import Optional

# Load config
_CONFIG_PATH = Path(__file__).parent.parent / 'config.yaml'

def _load_config() -> dict:
    try:
        import yaml
        with open(_CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}

_config = _load_config()
_CACHE_DIR = Path(__file__).parent.parent / '.cache'
_ENGINE_PRIORITY = _config.get('engine_priority', ['google', 'bing', 'brave', 'ddg', 'wikipedia'])
_DEFAULT_LIMIT = _config.get('default_limit', 10)
_MAX_AGGREGATE = _config.get('max_aggregate_results', 50)
_CACHE_TTL = _config.get('cache', {}).get('ttl_sec', 1800)
_CACHE_ENABLED = _config.get('cache', {}).get('enabled', True)


def _cache_key(query: str, engines: list, limit: int) -> str:
    raw = json.dumps({'q': query, 'e': sorted(engines), 'l': limit}, sort_keys=True)
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Optional[dict]:
    if not _CACHE_ENABLED:
        return None
    path = _CACHE_DIR / f'{key}.json'
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > _CACHE_TTL:
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _cache_set(key: str, data: dict):
    if not _CACHE_ENABLED:
        return
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (_CACHE_DIR / f'{key}.json').write_text(json.dumps(data, ensure_ascii=False))


# Map short engine names to (module_file, class_name) in engines/
_ENGINE_MAP = {
    'google':    ('google_cse',        'GoogleCseEngine'),
    'bing':      ('bing_serpapi_http', 'BingSerpApiHttpEngine'),
    'brave':     ('brave_html',        'BraveHtmlEngine'),
    'ddg':       ('ddg_html',          'DuckDuckGoHtmlEngine'),
    'wikipedia': ('wikipedia_api',     'WikipediaApiEngine'),
}

_SEARCH_TIMEOUT = _config.get('timeout_sec', 15)


def _load_engine(name: str):
    from importlib import import_module
    module_file, class_name = _ENGINE_MAP.get(name, (name, 'Engine'))
    try:
        mod = import_module(f'engines.{module_file}')
        return getattr(mod, class_name, None)
    except ImportError:
        return None


def aggregate_search(query: str, engines: list = None, limit: int = None) -> dict:
    engines = _ENGINE_PRIORITY if engines is None else engines
    limit = limit or _DEFAULT_LIMIT

    cache_key = _cache_key(query, engines, limit)
    cached = _cache_get(cache_key)
    if cached:
        cached['meta']['from_cache'] = True
        return cached

    t0 = time.time()
    all_results = []
    seen_urls = set()
    seen_titles = set()
    errors = []
    engines_used = []

    for name in engines:
        EngineClass = _load_engine(name)
        if not EngineClass:
            errors.append({'engine': name, 'error': 'not found'})
            continue
        try:
            engine = EngineClass()
            results = engine.search(query, limit=limit, timeout_sec=_SEARCH_TIMEOUT)
            for r in results:
                # EngineResult is a dataclass — convert to dict
                r_dict = r.to_dict() if hasattr(r, 'to_dict') else dict(r)
                url   = r_dict.get('url', '')
                title = r_dict.get('title', '')
                if url in seen_urls or title in seen_titles:
                    continue
                seen_urls.add(url)
                if title:
                    seen_titles.add(title)
                r_dict['source'] = name
                r_dict['rank']   = len(all_results) + 1
                all_results.append(r_dict)
            engines_used.append(name)
        except Exception as e:
            errors.append({'engine': name, 'error': str(e)})

        if _MAX_AGGREGATE and len(all_results) >= _MAX_AGGREGATE:
            break

    result = {
        'query': query,
        'results': all_results[:_MAX_AGGREGATE] if _MAX_AGGREGATE else all_results,
        'meta': {
            'engines_used': engines_used,
            'time_ms': int((time.time() - t0) * 1000),
            'from_cache': False
        },
        'errors': errors
    }
    _cache_set(cache_key, result)
    return result


def check_engines() -> dict:
    """Return availability status for each configured engine."""
    status = {}
    for name in _ENGINE_PRIORITY:
        EngineClass = _load_engine(name)
        if not EngineClass:
            status[name] = 'missing'
            continue
        try:
            engine = EngineClass()
            # doctor() returns (status_str, message); 'ok' means available
            doc_status, _ = engine.doctor()
            status[name] = 'ok' if doc_status == 'ok' else 'no key'
        except Exception as e:
            status[name] = f'error: {e}'
    return status
