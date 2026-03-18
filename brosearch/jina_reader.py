"""Jina Reader fallback for reading public web pages."""
import urllib.request
import urllib.parse


JINA_BASE = 'https://r.jina.ai/'


def read_url(url: str, timeout: int = 20) -> str:
    """Fetch a URL via Jina Reader and return markdown content."""
    jina_url = JINA_BASE + url
    req = urllib.request.Request(
        jina_url,
        headers={
            'Accept': 'text/plain',
            'User-Agent': 'brosearch/0.1'
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')
