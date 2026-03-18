from __future__ import annotations

import re
from html import unescape
from typing import List

import requests

from .config import get_env
from .base import EngineResult, SearchEngine


def _strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = unescape(s)
    return re.sub(r"\s+", " ", s).strip()


class BraveHtmlEngine(SearchEngine):
    name = "brave"

    def doctor(self) -> tuple[str, str]:
        return "ok", "Brave HTML 抓取可用（无需 Key，best-effort；解析可能随页面变化而失效）"

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        proxy = get_env("BRAVE_PROXY") or get_env("HTTPS_PROXY") or get_env("HTTP_PROXY")

        sess = requests.Session()
        ua = get_env("SEARCH_USER_AGENT") or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        sess.headers.update({
            "User-Agent": ua,
            "Accept-Encoding": "gzip, deflate",  # avoid br
        })
        if proxy:
            sess.proxies = {"http": proxy, "https": proxy}

        resp = sess.get(
            "https://search.brave.com/search",
            params={"q": query, "source": "web"},
            timeout=timeout_sec,
        )
        resp.raise_for_status()
        html_text = resp.text

        # Best-effort parsing without external HTML parser.
        # Split on result blocks.
        blocks = re.split(r"<div[^>]+data-type=\"web\"[^>]*>", html_text)
        out: List[EngineResult] = []
        for block in blocks[1:]:
            if len(out) >= limit:
                break
            # href
            m_href = re.search(r"<a[^>]+href=\"([^\"]+)\"[^>]*>\s*<div[^>]*class=\"title\"", block)
            if not m_href:
                m_href = re.search(r"<a[^>]+href=\"([^\"]+)\"[^>]*>", block)
            href = m_href.group(1) if m_href else ""

            # title: take first title-ish div text
            m_title = re.search(r"<div[^>]*class=\"title\"[^>]*>(.*?)</div>", block, re.S)
            title = _strip_tags(m_title.group(1)) if m_title else ""

            # snippet
            m_snip = re.search(r"<div[^>]*class=\"snippet\"[^>]*>.*?<div[^>]*class=\"content\"[^>]*>(.*?)</div>", block, re.S)
            snippet = _strip_tags(m_snip.group(1)) if m_snip else ""

            if not href or not title:
                continue

            out.append(
                EngineResult(title=title, url=href, snippet=snippet, source=self.name, rank=len(out) + 1)
            )

        return out
