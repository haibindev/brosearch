"""
Tests for brosearch/cli.py helper functions (no daemon/Chrome needed).
"""
import pytest
from brosearch.cli import (
    _parse_ai_actions,
    _extract_js,
    _extract_domain,
    _build_adapter_prompt,
)


# ─── _extract_domain ─────────────────────────────────────────────────────────

class TestExtractDomain:
    def test_full_url(self):
        assert _extract_domain('https://zhihu.com/hot') == 'zhihu.com'

    def test_subdomain(self):
        assert _extract_domain('https://www.weibo.com/hot') == 'www.weibo.com'

    def test_url_with_path_and_query(self):
        assert _extract_domain('https://reddit.com/r/ml?sort=top') == 'reddit.com'

    def test_bare_domain_fallback(self):
        # No scheme — urlparse returns netloc='' but hostname=None
        result = _extract_domain('reddit.com')
        assert result == 'reddit.com'

    def test_http_scheme(self):
        assert _extract_domain('http://example.com/path') == 'example.com'


# ─── _extract_js ─────────────────────────────────────────────────────────────

class TestExtractJs:
    def test_fenced_javascript_block(self):
        text = "Here is code:\n```javascript\nmodule.exports = {}\n```\nDone."
        assert _extract_js(text) == 'module.exports = {}'

    def test_fenced_js_shorthand(self):
        text = "```js\nmodule.exports = { a: 1 }\n```"
        assert _extract_js(text) == 'module.exports = { a: 1 }'

    def test_fenced_bare_block(self):
        text = "```\nmodule.exports = { b: 2 }\n```"
        assert _extract_js(text) == 'module.exports = { b: 2 }'

    def test_raw_module_exports(self):
        text = "module.exports = { description: 'test' }"
        assert _extract_js(text) == text.strip()

    def test_no_code_returns_empty(self):
        assert _extract_js("Just some text without code.") == ''

    def test_multiline_block(self):
        code = "module.exports = {\n  description: 'test',\n  buildJs: () => 'return 1'\n}"
        text = f"```javascript\n{code}\n```"
        assert _extract_js(text) == code


# ─── _parse_ai_actions ───────────────────────────────────────────────────────

class TestParseAiActions:
    def test_capture_default(self):
        actions = _parse_ai_actions("ACTION: capture")
        assert actions == [{'type': 'capture', 'duration': 5000}]

    def test_capture_custom_ms(self):
        actions = _parse_ai_actions("ACTION: capture 3000")
        assert actions == [{'type': 'capture', 'duration': 3000}]

    def test_scroll_default(self):
        actions = _parse_ai_actions("ACTION: scroll")
        assert actions == [{'type': 'scroll', 'deltaY': 600}]

    def test_scroll_custom_px(self):
        actions = _parse_ai_actions("ACTION: scroll 1200")
        assert actions == [{'type': 'scroll', 'deltaY': 1200}]

    def test_scroll_to_ref(self):
        actions = _parse_ai_actions("ACTION: scroll @42")
        assert actions == [{'type': 'scroll', 'ref': 42}]

    def test_click(self):
        actions = _parse_ai_actions("ACTION: click @7")
        assert actions == [{'type': 'click', 'ref': 7}]

    def test_hover(self):
        actions = _parse_ai_actions("ACTION: hover @15")
        assert actions == [{'type': 'hover', 'ref': 15}]

    def test_type_no_ref(self):
        actions = _parse_ai_actions("ACTION: type hello world")
        assert actions == [{'type': 'type', 'text': 'hello world', 'ref': None}]

    def test_type_with_ref(self):
        actions = _parse_ai_actions("ACTION: type search term @3")
        assert actions == [{'type': 'type', 'text': 'search term', 'ref': 3}]

    def test_type_quoted_text(self):
        actions = _parse_ai_actions('ACTION: type "hello world" @5')
        assert actions[0]['text'] == 'hello world'
        assert actions[0]['ref'] == 5

    def test_fill(self):
        actions = _parse_ai_actions("ACTION: fill my query @10")
        assert actions == [{'type': 'fill', 'text': 'my query', 'ref': 10}]

    def test_select(self):
        actions = _parse_ai_actions("ACTION: select @8 en")
        assert actions == [{'type': 'select', 'ref': 8, 'value': 'en'}]

    def test_key_press(self):
        actions = _parse_ai_actions("ACTION: key-press Enter")
        assert actions == [{'type': 'key-press', 'key': 'Enter'}]

    def test_key_press_tab(self):
        actions = _parse_ai_actions("ACTION: key-press Tab")
        assert actions == [{'type': 'key-press', 'key': 'Tab'}]

    def test_reload(self):
        actions = _parse_ai_actions("ACTION: reload")
        assert actions == [{'type': 'reload'}]

    def test_wait(self):
        actions = _parse_ai_actions("ACTION: wait 3")
        assert actions == [{'type': 'wait', 'seconds': 3}]

    def test_done_returns_empty(self):
        assert _parse_ai_actions("DONE") == []
        assert _parse_ai_actions("Some text\nDONE") == []
        assert _parse_ai_actions("done") == []  # case-insensitive

    def test_done_with_trailing_actions_ignored(self):
        # DONE in last 3 non-empty lines means stop
        text = "ACTION: scroll\nDONE"
        # DONE is in last 3 → returns []
        assert _parse_ai_actions(text) == []

    def test_multiple_actions(self):
        text = "ACTION: click @3\nACTION: capture 5000\nACTION: scroll 800"
        actions = _parse_ai_actions(text)
        assert len(actions) == 3
        assert actions[0] == {'type': 'click', 'ref': 3}
        assert actions[1] == {'type': 'capture', 'duration': 5000}
        assert actions[2] == {'type': 'scroll', 'deltaY': 800}

    def test_case_insensitive(self):
        actions = _parse_ai_actions("action: CAPTURE 2000")
        assert actions == [{'type': 'capture', 'duration': 2000}]

    def test_empty_text(self):
        assert _parse_ai_actions("") == []

    def test_no_actions_no_done(self):
        # Random text without any actions or DONE → empty
        actions = _parse_ai_actions("The page looks loaded. Let me analyze it.")
        assert actions == []


# ─── _build_adapter_prompt ───────────────────────────────────────────────────

class TestBuildAdapterPrompt:
    def test_contains_platform_and_command(self):
        prompt = _build_adapter_prompt('zhihu', 'hot', [])
        assert 'zhihu' in prompt
        assert 'hot' in prompt

    def test_contains_format_hint(self):
        prompt = _build_adapter_prompt('mysite', 'feed', [])
        assert 'module.exports' in prompt
        assert 'buildJs' in prompt

    def test_includes_requests_sample(self):
        reqs = [{'request': {'url': 'https://api.example.com/data', 'method': 'GET'}, 'status': 200}]
        prompt = _build_adapter_prompt('example', 'data', reqs)
        assert 'api.example.com' in prompt

    def test_samples_max_10_requests(self):
        reqs = [{'request': {'url': f'https://api.example.com/{i}'}} for i in range(20)]
        prompt = _build_adapter_prompt('example', 'list', reqs)
        # Only first 10 should appear, item 10+ should not
        assert 'api.example.com/0' in prompt
        assert 'api.example.com/9' in prompt
        assert 'api.example.com/10' not in prompt
