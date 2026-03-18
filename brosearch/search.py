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


def _load_engine(name: str):
    from importlib import import_module
    try:
        mod = import_module(f'engines.{name}')
        return getattr(mod, 'Engine', None)
    except ImportError:
        return None


def aggregate_search(query: str, engines: list = None, limit: int = None) -> dict:
    engines = engines or _ENGINE_PRIORITY
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
            results = engine.search(query, limit=limit)
            for r in results:
                url = r.get('url', '')
                title = r.get('title', '')
                if url in seen_urls or title in seen_titles:
                    continue
                seen_urls.add(url)
                if title:
                    seen_titles.add(title)
                r['source'] = name
                r['rank'] = len(all_results) + 1
                all_results.append(r)
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
    status = {}
    for name in _ENGINE_PRIORITY:
        EngineClass = _load_engine(name)
        if not EngineClass:
            status[name] = 'missing'
            continue
        try:
            engine = EngineClass()
            status[name] = 'ok' if engine.available() else 'no key'
        except Exception as e:
            status[name] = f'error: {e}'
    return status
