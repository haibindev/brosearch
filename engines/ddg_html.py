from __future__ import annotations

import re
from html import unescape
from typing import List

import requests

from ..core.config import get_env
from .base import EngineResult, SearchEngine


def _strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = unescape(s)
    return re.sub(r"\s+", " ", s).strip()


class DuckDuckGoHtmlEngine(SearchEngine):
    name = "ddg"

    def doctor(self) -> tuple[str, str]:
        return "ok", "DuckDuckGo HTML 抓取可用（无需 Key，best-effort；解析可能随页面变化而失效）"

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        proxy = get_env("DUCKDUCKGO_PROXY") or get_env("HTTPS_PROXY") or get_env("HTTP_PROXY")

        sess = requests.Session()
        ua = get_env("SEARCH_USER_AGENT") or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        sess.headers.update({"User-Agent": ua})
        if proxy:
            sess.proxies = {"http": proxy, "https": proxy}

        resp = sess.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query, "b": "", "l": "wt-wt"},
            timeout=timeout_sec,
        )
        resp.raise_for_status()
        html_text = resp.text

        blocks = re.split(r"<div[^>]+class=\"result\b[^\"]*\"[^>]*>", html_text)
        out: List[EngineResult] = []

        for block in blocks[1:]:
            if len(out) >= limit:
                break
            m_title = re.search(r"<h2[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, re.S)
            if not m_title:
                continue
            href = m_title.group(1)
            title = _strip_tags(m_title.group(2))

            m_snip = re.search(r"<a[^>]*class=\"result__snippet\"[^>]*>(.*?)</a>", block, re.S)
            snippet = _strip_tags(m_snip.group(1)) if m_snip else ""

            if not href or not title:
                continue
            out.append(
                EngineResult(title=title, url=href, snippet=snippet, source=self.name, rank=len(out) + 1)
            )

        return out
