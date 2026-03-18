from __future__ import annotations

from typing import List

import requests

from ..core.config import get_env
from .base import EngineResult, SearchEngine


class WikipediaApiEngine(SearchEngine):
    name = "wikipedia"

    def doctor(self) -> tuple[str, str]:
        return "ok", "Wikipedia API 可用（通常无需 Key）"

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        lang = get_env("WIKIPEDIA_LANG", "en") or "en"
        api = f"https://{lang}.wikipedia.org/w/api.php"
        ua = get_env("SEARCH_USER_AGENT") or "base-websearch/0.1 (https://localhost)"
        resp = requests.get(
            api,
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "format": "json",
                "srlimit": min(int(limit), 20),
            },
            headers={"User-Agent": ua},
            timeout=timeout_sec,
        )
        resp.raise_for_status()
        data = resp.json()
        items = (data.get("query") or {}).get("search") or []

        out: List[EngineResult] = []
        for idx, item in enumerate(items[:limit], 1):
            title = item.get("title") or ""
            pageid = item.get("pageid")
            snippet = (item.get("snippet") or "").replace("<span class=\"searchmatch\">", "").replace("</span>", "")
            url = f"https://{lang}.wikipedia.org/?curid={pageid}" if pageid else f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}"
            out.append(EngineResult(title=title, url=url, snippet=snippet, source=self.name, rank=idx))
        return out
