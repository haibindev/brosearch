import json
import urllib.request
import urllib.error
from .host import get_daemon_url


class DaemonClient:
    def __init__(self):
        self.base = get_daemon_url()

    def _get(self, path: str, timeout: float = 5) -> dict:
        with urllib.request.urlopen(f'{self.base}{path}', timeout=timeout) as r:
            return json.loads(r.read())

    def _post(self, path: str, payload: dict, timeout: float = 20) -> dict:
        data = json.dumps(payload).encode()
        req  = urllib.request.Request(
            f'{self.base}{path}', data=data,
            headers={'Content-Type': 'application/json'}, method='POST'
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.URLError as e:
            raise RuntimeError(f'Daemon unreachable at {self.base}: {e}')

    def _ok(self, result: dict, op: str):
        if not result.get('ok'):
            raise RuntimeError(result.get('error', f'{op} failed'))
        return result['data']

    # ─── Status ───────────────────────────────────────────────────────────────

    def is_alive(self) -> bool:
        try:    return self._get('/health', timeout=1).get('ok', False)
        except: return False

    def extension_connected(self) -> bool:
        try:    return self._get('/health', timeout=1).get('extension_connected', False)
        except: return False

    # ─── Adapter execution ────────────────────────────────────────────────────

    def fetch(self, platform: str, command: str, args: dict = None) -> dict:
        return self._ok(self._post('/api/fetch', {
            'platform': platform, 'command': command, 'args': args or {}
        }), 'fetch')

    def evaluate(self, tab_query: dict, js: str, timeout: float = 30) -> dict:
        return self._ok(self._post('/api/eval', {
            'tabQuery': tab_query, 'js': js
        }, timeout=timeout), 'eval')

    # ─── Browser automation ───────────────────────────────────────────────────

    def navigate(self, url: str, tab_query: dict = None) -> dict:
        payload = {'url': url}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/navigate', payload, timeout=25), 'navigate')

    def snapshot(self, tab_query: dict = None, depth: int = None, full: bool = False) -> dict:
        payload = {'tabQuery': tab_query or {}, 'full': full}
        if depth is not None: payload['depth'] = depth
        return self._ok(self._post('/api/snapshot', payload), 'snapshot')

    def snapshot_partial(self, backend_node_id: int, tab_query: dict = None, depth: int = 10) -> dict:
        return self._ok(self._post('/api/snapshot-partial', {
            'backendNodeId': backend_node_id,
            'tabQuery': tab_query or {},
            'depth': depth
        }), 'snapshot-partial')

    def click(self, ref: int, tab_query: dict = None) -> dict:
        payload = {'ref': ref}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/click', payload), 'click')

    def type_text(self, text: str, ref: int = None, tab_query: dict = None) -> dict:
        payload = {'text': text}
        if ref is not None: payload['ref'] = ref
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/type', payload), 'type')

    def key_press(self, key: str, tab_query: dict = None) -> dict:
        payload = {'key': key}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/key-press', payload), 'key-press')

    def scroll(self, delta_y: int = 600, delta_x: int = 0,
               x: int = 760, y: int = 400, ref: int = None,
               tab_query: dict = None) -> dict:
        payload = {'deltaY': delta_y, 'deltaX': delta_x, 'x': x, 'y': y}
        if ref is not None: payload['ref'] = ref
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/scroll', payload), 'scroll')

    def fill(self, text: str, ref: int, tab_query: dict = None) -> dict:
        payload = {'text': text, 'ref': ref}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/fill', payload), 'fill')

    def hover(self, ref: int, tab_query: dict = None) -> dict:
        payload = {'ref': ref}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/hover', payload), 'hover')

    def select(self, ref: int, value: str, tab_query: dict = None) -> dict:
        payload = {'ref': ref, 'value': value}
        if tab_query: payload['tabQuery'] = tab_query
        return self._ok(self._post('/api/select', payload), 'select')

    def reload(self, tab_query: dict = None) -> dict:
        payload = {'tabQuery': tab_query or {}}
        return self._ok(self._post('/api/reload', payload, timeout=25), 'reload')

    def tab_list(self) -> list:
        return self._ok(self._post('/api/tabs', {}), 'tab-list')

    def tab_switch(self, tab_id: int) -> dict:
        return self._ok(self._post('/api/tab/switch', {'tabId': tab_id}), 'tab-switch')

    def tab_close(self, tab_id: int) -> dict:
        return self._ok(self._post('/api/tab/close', {'tabId': tab_id}), 'tab-close')

    def wait_ms(self, ms: int) -> dict:
        return self._ok(self._post('/api/wait', {'ms': ms}, timeout=ms / 1000 + 10), 'wait')

    def capture(self, tab_query: dict, duration_ms: int) -> list:
        return self._ok(self._post('/api/capture', {
            'tabQuery': tab_query, 'duration': duration_ms
        }, timeout=duration_ms / 1000 + 15), 'capture')

    def screenshot(self, tab_query: dict = None, fmt: str = 'png',
                   quality: int = None, capture_beyond_viewport: bool = False) -> dict:
        payload = {'tabQuery': tab_query or {}, 'format': fmt,
                   'captureBeyondViewport': capture_beyond_viewport}
        if quality is not None: payload['quality'] = quality
        return self._ok(self._post('/api/screenshot', payload), 'screenshot')

    # ─── Diagnostics ──────────────────────────────────────────────────────────

    def get_console(self, tab_query: dict = None, clear: bool = False) -> dict:
        return self._ok(self._post('/api/console', {
            'tabQuery': tab_query or {}, 'clear': clear
        }), 'get-console')

    def get_errors(self, tab_query: dict = None, clear: bool = False) -> dict:
        return self._ok(self._post('/api/errors', {
            'tabQuery': tab_query or {}, 'clear': clear
        }), 'get-errors')

    # ─── Debugger lifecycle ─────────────────────────────────────────────────

    def detach(self, tab_query: dict = None) -> dict:
        payload = {'tabQuery': tab_query or {}}
        return self._ok(self._post('/api/detach', payload), 'detach')

    def detach_all(self) -> dict:
        return self._ok(self._post('/api/detach-all', {}), 'detach-all')

    # ─── Adapters ─────────────────────────────────────────────────────────────

    def list_adapters(self) -> dict:
        try:    return self._get('/api/adapters')
        except: return {}
