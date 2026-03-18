from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class EngineResult:
    title: str
    url: str
    snippet: str = ""
    source: str = ""
    rank: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "source": self.source,
            "rank": self.rank,
        }


class SearchEngine:
    name: str = ""

    def doctor(self) -> tuple[str, str]:
        """Return (status, message). status in {ok, off, warn}."""
        return "ok", ""

    def search(self, query: str, limit: int, timeout_sec: int) -> List[EngineResult]:
        raise NotImplementedError
