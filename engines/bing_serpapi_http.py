from __future__ import annotations

import os
from typing import List

import requests

from .config import get_env
from .base import EngineResult, SearchEngine


def _serpapi_keys() -> List[str]:
    keys: List[str] = []
    # SERPAPI_API_KEY then SERPAPI_API_KEY_1..n
    base = get_env("SERPAPI_API_KEY")
    if base:
        keys.append(base)
    for k, v in sorted(os.environ.items()):
        if k.startswith("SERPAPI_API_KEY_") and v:
            if v not in keys:
                keys.append(v)
    return keys


class BingSerpApiHttpEngine(SearchEngine):
    name = "bing"

    def doctor(self) -> tuple[str, str]:
        keys = _serpapi_keys()
        if not keys:
            return "off", "缺少 SERPAPI_API_KEY（可配置 SERPAPI_API_KEY_1/2... 轮转）"
        return "ok", f"SerpAPI 可用（keys={len(keys)}）"

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        keys = _serpapi_keys()
        if not keys:
            raise RuntimeError("missing SERPAPI_API_KEY")

        url = "https://serpapi.com/search.json"
        last_err: Exception | None = None

        for api_key in keys:
            try:
                resp = requests.get(
                    url,
                    params={
                        "engine": "bing",
                        "q": query,
                        "count": int(limit),
                        "api_key": api_key,
                    },
                    timeout=timeout_sec,
                )
                resp.raise_for_status()
                data = resp.json()
                if "error" in data:
                    raise RuntimeError(str(data["error"]))

                organic = data.get("organic_results", [])
                out: List[EngineResult] = []
                for idx, item in enumerate(organic[:limit], 1):
                    title = item.get("title") or ""
                    link = item.get("link") or ""
                    snippet = item.get("snippet") or ""
                    if not link:
                        continue
                    out.append(EngineResult(title=title, url=link, snippet=snippet, source=self.name, rank=idx))
                return out
            except Exception as e:
                last_err = e
                continue

        raise RuntimeError(f"SerpAPI bing failed with all keys: {last_err}")
