from __future__ import annotations

from typing import List

import requests

from ..core.config import get_env
from .base import EngineResult, SearchEngine


class GoogleCseEngine(SearchEngine):
    name = "google"

    def doctor(self) -> tuple[str, str]:
        api_key = get_env("GOOGLE_API_KEY")
        cx = get_env("GOOGLE_SEARCH_ENGINE_ID")
        if not api_key or not cx:
            return "off", "缺少 GOOGLE_API_KEY 或 GOOGLE_SEARCH_ENGINE_ID"
        return "ok", "Google Custom Search API 可用"

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        api_key = get_env("GOOGLE_API_KEY")
        cx = get_env("GOOGLE_SEARCH_ENGINE_ID")
        if not api_key or not cx:
            raise RuntimeError("missing GOOGLE_API_KEY/GOOGLE_SEARCH_ENGINE_ID")

        url = "https://www.googleapis.com/customsearch/v1"
        num = min(max(int(limit), 1), 10)  # API limit 10
        resp = requests.get(
            url,
            params={"key": api_key, "cx": cx, "q": query, "num": num, "start": 1},
            timeout=timeout_sec,
        )
        resp.raise_for_status()
        data = resp.json()

        out: List[EngineResult] = []
        for idx, item in enumerate(data.get("items", [])[:limit], 1):
            title = item.get("title") or ""
            link = item.get("link") or ""
            snippet = item.get("snippet") or ""
            if not link:
                continue
            out.append(EngineResult(title=title, url=link, snippet=snippet, source=self.name, rank=idx))
        return out
