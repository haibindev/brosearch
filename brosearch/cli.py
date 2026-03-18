"""
brosearch CLI — unified web data entry point.

Commands:
  fetch         <platform/command> [key=val ...]
  search        <query> [--engines ...] [--limit N]
  read          <url>
  capture       [--tab <url-pattern>] [--duration N] [--out file.json]
  generate      --capture <file.json> --platform <p> --command <c>
  auto-generate --url <url> --platform <p> --command <c> [--duration N]
  adapters
  console       [--tab <url-pattern>] [--clear]
  errors        [--tab <url-pattern>] [--clear]
  wait          <seconds>
  doctor
"""
import sys
import json
import argparse
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from .daemon_client import DaemonClient
from .jina_reader import read_url

ADAPTERS_CUSTOM_DIR = Path(__file__).parent.parent / 'adapters' / 'custom'


# ─── fetch ────────────────────────────────────────────────────────────────────

def cmd_fetch(args):
    parts = args.target.split('/', 1)
    if len(parts) != 2:
        print(json.dumps({'error': 'target must be platform/command'}))
        sys.exit(1)
    platform, command = parts
    kwargs = {}
    for kv in args.args:
        if '=' in kv:
            k, v = kv.split('=', 1)
            try: v = int(v)
            except ValueError: pass
            kwargs[k] = v

    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)
    result = client.fetch(platform, command, kwargs)
    print(json.dumps(result, ensure_ascii=False, indent=2))


# ─── search ───────────────────────────────────────────────────────────────────

def cmd_search(args):
    try:
        from .search import aggregate_search
    except ImportError as e:
        print(json.dumps({'error': f'Missing deps: {e}'}))
        sys.exit(1)
    result = aggregate_search(query=args.query, engines=args.engines or None, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))


# ─── read ─────────────────────────────────────────────────────────────────────

def cmd_read(args):
    try:
        content = read_url(args.url)
        print(json.dumps({'url': args.url, 'content': content}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


# ─── capture ─────────────────────────────────────────────────────────────────

def cmd_capture(args):
    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)

    tab_query   = {'url': args.tab} if args.tab else {}
    duration_ms = int(args.duration * 1000)

    print(f'[brosearch] 抓取网络请求 {args.duration}s，请确保目标页面已打开并刷新', file=sys.stderr)
    requests = client.capture(tab_query, duration_ms)

    if not requests:
        print('[brosearch] 未抓到任何 API 请求', file=sys.stderr)
        sys.exit(1)

    print(f'[brosearch] 抓到 {len(requests)} 条 API 请求', file=sys.stderr)
    output = {
        'captured_at': _now_iso(), 'tab': args.tab or 'active',
        'duration_sec': args.duration, 'requests': requests
    }
    if args.out:
        Path(args.out).write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print(f'[brosearch] 已保存到 {args.out}', file=sys.stderr)
    else:
        print(json.dumps(output, ensure_ascii=False, indent=2))


# ─── generate ────────────────────────────────────────────────────────────────

def cmd_generate(args):
    capture_path = Path(args.capture)
    if not capture_path.exists():
        print(f'[brosearch] 文件不存在: {args.capture}', file=sys.stderr)
        sys.exit(1)

    capture_data = json.loads(capture_path.read_text())
    requests     = capture_data.get('requests', [])
    if not requests:
        print('[brosearch] capture 文件中没有请求', file=sys.stderr)
        sys.exit(1)

    prompt  = _build_adapter_prompt(args.platform, args.command, requests)
    api_key = os.environ.get('ANTHROPIC_API_KEY')

    if not api_key:
        print('[brosearch] 未设置 ANTHROPIC_API_KEY，输出 prompt 供手动使用', file=sys.stderr)
        print('\n' + '='*60 + '\n' + prompt + '\n' + '='*60)
        return

    try:
        import anthropic
    except ImportError:
        print('[brosearch] 请安装: pip install anthropic', file=sys.stderr)
        print('\n' + prompt); return

    print('[brosearch] 正在调用 Claude 生成适配器...', file=sys.stderr)
    ai  = anthropic.Anthropic(api_key=api_key)
    msg = ai.messages.create(
        model='claude-sonnet-4-6', max_tokens=2048,
        messages=[{'role': 'user', 'content': prompt}]
    )
    _save_adapter(args.platform, args.command, msg.content[0].text)


# ─── auto-generate ────────────────────────────────────────────────────────────

def cmd_auto_generate(args):
    """
    全自动适配器生成：
    1. 打开目标 URL
    2. 获取 Accessibility Tree 快照
    3. AI 分析页面，输出动作序列（scroll/type/click/capture/wait）
    4. 执行动作，累积 API 请求
    5. AI 生成适配器 JS 代码
    """
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print('[brosearch] 需要 ANTHROPIC_API_KEY 环境变量', file=sys.stderr)
        sys.exit(1)
    try:
        import anthropic
    except ImportError:
        print('[brosearch] 请安装: pip install anthropic', file=sys.stderr)
        sys.exit(1)

    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)

    platform  = args.platform
    command   = args.command
    url       = args.url
    duration  = int(args.duration * 1000)
    tab_query = {'url': f'*://{_extract_domain(url)}/*'}
    ai        = anthropic.Anthropic(api_key=api_key)

    # Step 1: Navigate
    print(f'[brosearch] 打开 {url} ...', file=sys.stderr)
    nav = client.navigate(url)
    print(f'[brosearch] 已打开 tabId={nav.get("tabId")}', file=sys.stderr)

    # Step 2: Initial snapshot
    print('[brosearch] 获取页面快照...', file=sys.stderr)
    snapshot = client.snapshot(tab_query)
    _log_snapshot(snapshot)

    # Step 3: Multi-turn AI interaction loop
    messages = [{'role': 'user', 'content': _auto_prompt_phase1(platform, command, url, snapshot)}]
    captured_requests = []
    max_rounds = 6

    for rnd in range(max_rounds):
        print(f'[brosearch] AI 分析 (轮次 {rnd+1}/{max_rounds})...', file=sys.stderr)
        resp  = ai.messages.create(model='claude-sonnet-4-6', max_tokens=2048, messages=messages)
        reply = resp.content[0].text
        actions = _parse_ai_actions(reply)

        if not actions:
            print('[brosearch] AI 判断完成', file=sys.stderr)
            break

        for act in actions:
            t = act['type']

            if t == 'capture':
                dur = act.get('duration', duration)
                print(f'[brosearch] 抓取 {dur}ms...', file=sys.stderr)
                try:
                    reqs = client.capture(tab_query, dur)
                    captured_requests.extend(reqs)
                    print(f'[brosearch] +{len(reqs)} 条 (总计 {len(captured_requests)})', file=sys.stderr)
                except Exception as e:
                    print(f'[brosearch] 抓取失败: {e}', file=sys.stderr)

            elif t == 'scroll':
                ref = act.get('ref')
                if ref is not None:
                    print(f'[brosearch] 滚动至 @{ref}...', file=sys.stderr)
                    try:
                        client.scroll(ref=ref, tab_query=tab_query)
                    except Exception as e:
                        print(f'[brosearch] 滚动失败: {e}', file=sys.stderr)
                else:
                    dy = act.get('deltaY', 600)
                    print(f'[brosearch] 向下滚动 {dy}px...', file=sys.stderr)
                    try:
                        client.scroll(delta_y=dy, tab_query=tab_query)
                    except Exception as e:
                        print(f'[brosearch] 滚动失败: {e}', file=sys.stderr)

            elif t == 'click':
                ref = act['ref']
                print(f'[brosearch] 点击 @{ref}...', file=sys.stderr)
                try:
                    r = client.click(ref, tab_query)
                    print(f'[brosearch] 已点击 @{ref} {r.get("role")} "{r.get("name","")}"', file=sys.stderr)
                except Exception as e:
                    print(f'[brosearch] 点击 @{ref} 失败: {e}', file=sys.stderr)

            elif t == 'hover':
                ref = act['ref']
                print(f'[brosearch] 悬停 @{ref}...', file=sys.stderr)
                try:
                    client.hover(ref, tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 悬停失败: {e}', file=sys.stderr)

            elif t == 'type':
                text = act['text']
                ref  = act.get('ref')
                print(f'[brosearch] 输入 "{text}"' + (f' 到 @{ref}' if ref else '') + '...', file=sys.stderr)
                try:
                    client.type_text(text, ref=ref, tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 输入失败: {e}', file=sys.stderr)

            elif t == 'fill':
                text = act['text']
                ref  = act['ref']
                print(f'[brosearch] 填充 "{text}" → @{ref}...', file=sys.stderr)
                try:
                    client.fill(text, ref, tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 填充失败: {e}', file=sys.stderr)

            elif t == 'select':
                ref   = act['ref']
                value = act['value']
                print(f'[brosearch] 选择 @{ref} = "{value}"...', file=sys.stderr)
                try:
                    client.select(ref, value, tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 选择失败: {e}', file=sys.stderr)

            elif t == 'key-press':
                key = act['key']
                print(f'[brosearch] 按键 {key}...', file=sys.stderr)
                try:
                    client.key_press(key, tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 按键失败: {e}', file=sys.stderr)

            elif t == 'reload':
                print('[brosearch] 刷新页面...', file=sys.stderr)
                try:
                    client.reload(tab_query=tab_query)
                except Exception as e:
                    print(f'[brosearch] 刷新失败: {e}', file=sys.stderr)

            elif t == 'wait':
                secs = min(act.get('seconds', 2), 10)
                print(f'[brosearch] 等待 {secs}s...', file=sys.stderr)
                time.sleep(secs)

        # Refresh snapshot after actions
        print('[brosearch] 刷新快照...', file=sys.stderr)
        snapshot = client.snapshot(tab_query)
        _log_snapshot(snapshot)

        # Check for JS errors (self-diagnosis)
        errors = client.get_errors(tab_query, clear=True)
        if errors.get('count', 0):
            errs_text = '\n'.join(f"  {e['message']}" for e in errors['errors'][:5])
            print(f'[brosearch] 页面 JS 错误 ({errors["count"]}):\n{errs_text}', file=sys.stderr)

        # Feed results back to AI
        feedback = _build_feedback(captured_requests, snapshot, errors)
        messages.append({'role': 'assistant', 'content': reply})
        messages.append({'role': 'user', 'content': feedback})

    # Final fallback capture if nothing was caught
    if not captured_requests:
        print(f'[brosearch] 未捕获请求，最终抓取 {duration}ms...', file=sys.stderr)
        captured_requests = client.capture(tab_query, duration)

    if not captured_requests:
        print('[brosearch] 未捕获到任何 API 请求，无法生成适配器', file=sys.stderr)
        sys.exit(1)

    print(f'[brosearch] 共 {len(captured_requests)} 条请求，生成适配器...', file=sys.stderr)
    prompt   = _build_adapter_prompt(platform, command, captured_requests)
    gen_resp = ai.messages.create(
        model='claude-sonnet-4-6', max_tokens=2048,
        messages=[{'role': 'user', 'content': prompt}]
    )
    _save_adapter(platform, command, gen_resp.content[0].text)


# ─── console / errors ─────────────────────────────────────────────────────────

def cmd_console(args):
    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)
    tab_query = {'url': args.tab} if args.tab else {}
    result    = client.get_console(tab_query, clear=args.clear)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_errors(args):
    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)
    tab_query = {'url': args.tab} if args.tab else {}
    result    = client.get_errors(tab_query, clear=args.clear)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_wait(args):
    client = DaemonClient()
    _require_daemon(client)
    _require_extension(client)
    ms = int(args.seconds * 1000)
    result = client.wait_ms(ms)
    print(json.dumps(result, ensure_ascii=False, indent=2))


# ─── adapters / doctor ───────────────────────────────────────────────────────

def cmd_adapters(_args):
    client = DaemonClient()
    _require_daemon(client)
    print(json.dumps(client.list_adapters(), ensure_ascii=False, indent=2))


def cmd_doctor(_args):
    client = DaemonClient()
    status = {
        'daemon_url':         client.base,
        'daemon_alive':       client.is_alive(),
        'extension_connected': client.extension_connected(),
    }
    try:
        from .search import check_engines
        status['search_engines'] = check_engines()
    except ImportError:
        status['search_engines'] = 'unavailable'

    print(json.dumps(status, ensure_ascii=False, indent=2))
    if not status['daemon_alive']:
        print('\n[!] Daemon 未运行，启动: pnpm daemon', file=sys.stderr)
    if not status['extension_connected']:
        print('[!] Chrome 扩展未连接，加载: packages/extension/', file=sys.stderr)


# ─── AI auto-generate helpers ─────────────────────────────────────────────────

def _auto_prompt_phase1(platform: str, command: str, url: str, snapshot: dict) -> str:
    tree = snapshot.get('tree', '')[:5000]
    truncated_note = '\n[树已截断，使用 full=true 获取完整树]' if snapshot.get('truncated') else ''
    return f'''你是一个浏览器自动化专家，任务是帮助捕获 API 请求以生成 brosearch 适配器。

## 目标
- 平台：{platform}
- 命令：{command}（通常是获取某种列表数据）
- URL：{url}

## 当前页面
- 标题：{snapshot.get("title", "")}
- 节点数：{snapshot.get("nodeCount", 0)}

## Accessibility Tree（每个 @ref 节点可被操作）
{tree}{truncated_note}

## 可用动作（每行一个，严格格式）

| 动作 | 格式 | 说明 |
|------|------|------|
| 抓取网络请求 | `ACTION: capture [毫秒数]` | 默认 5000ms |
| 向下滚动 | `ACTION: scroll [像素数]` | 默认 600px |
| 滚动到元素 | `ACTION: scroll @<ref>` | 滚动至指定元素 |
| 点击元素 | `ACTION: click @<ref>` | |
| 悬停元素 | `ACTION: hover @<ref>` | 触发 hover 弹出菜单 |
| 输入文字（追加） | `ACTION: type <文字> [@ref]` | 有 @ref 则先点击 |
| 填充文字（清空后填） | `ACTION: fill <文字> @<ref>` | 适合表单、React 输入框 |
| 选择下拉项 | `ACTION: select @<ref> <value>` | 选择 select 选项的 value |
| 按键 | `ACTION: key-press <键名>` | Enter/Tab/Escape 等 |
| 刷新页面 | `ACTION: reload` | 重新加载页面 |
| 等待 | `ACTION: wait <秒数>` | 最多 10 秒 |
| 完成 | `DONE` | 已收集到足够请求 |

## 推荐策略

1. **热榜/推荐类**：先 `capture`（页面加载时就发了 API 请求），如果没抓到再 `scroll` + `capture`
2. **搜索类**：`fill 搜索词 @ref` → `key-press Enter` → `capture`
3. **登录类**：先截图确认登录状态，再操作
4. 如果页面有"加载更多"按钮，先 `capture` 初始请求，然后 `click` 加载更多 + 再 `capture`
5. 有 hover 菜单的页面用 `hover @ref` 触发，然后 `capture`

请分析页面并输出动作序列：'''


def _parse_ai_actions(text: str) -> list:
    """
    解析 AI 回复中的动作指令：
      ACTION: capture [5000]
      ACTION: scroll [600]
      ACTION: click @5
      ACTION: type 搜索词 [@3]
      ACTION: key-press Enter
      ACTION: wait 2
      DONE
    """
    lines = text.split('\n')
    # Check if last 3 non-empty lines contain DONE
    trailing = [l.strip() for l in lines if l.strip()][-3:]
    if any(l.upper() == 'DONE' for l in trailing):
        return []

    actions = []
    for line in lines:
        line = line.strip()

        m = re.match(r'ACTION:\s*capture\s*(\d*)', line, re.IGNORECASE)
        if m:
            dur = int(m.group(1)) if m.group(1) else 5000
            actions.append({'type': 'capture', 'duration': dur}); continue

        # scroll [pixels] or scroll @ref
        m = re.match(r'ACTION:\s*scroll\s+@(\d+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'scroll', 'ref': int(m.group(1))}); continue
        m = re.match(r'ACTION:\s*scroll\s*(\d*)', line, re.IGNORECASE)
        if m:
            dy = int(m.group(1)) if m.group(1) else 600
            actions.append({'type': 'scroll', 'deltaY': dy}); continue

        m = re.match(r'ACTION:\s*click\s+@(\d+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'click', 'ref': int(m.group(1))}); continue

        m = re.match(r'ACTION:\s*hover\s+@(\d+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'hover', 'ref': int(m.group(1))}); continue

        m = re.match(r'ACTION:\s*type\s+(.+?)(?:\s+@(\d+))?$', line, re.IGNORECASE)
        if m:
            text_val = m.group(1).strip().strip('"\'')
            ref_val  = int(m.group(2)) if m.group(2) else None
            actions.append({'type': 'type', 'text': text_val, 'ref': ref_val}); continue

        m = re.match(r'ACTION:\s*fill\s+(.+?)\s+@(\d+)$', line, re.IGNORECASE)
        if m:
            text_val = m.group(1).strip().strip('"\'')
            actions.append({'type': 'fill', 'text': text_val, 'ref': int(m.group(2))}); continue

        m = re.match(r'ACTION:\s*select\s+@(\d+)\s+(\S+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'select', 'ref': int(m.group(1)), 'value': m.group(2)}); continue

        m = re.match(r'ACTION:\s*key-press\s+(\S+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'key-press', 'key': m.group(1)}); continue

        m = re.match(r'ACTION:\s*reload', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'reload'}); continue

        m = re.match(r'ACTION:\s*wait\s+(\d+)', line, re.IGNORECASE)
        if m:
            actions.append({'type': 'wait', 'seconds': int(m.group(1))}); continue

    return actions


def _build_feedback(captured: list, snapshot: dict, errors: dict) -> str:
    parts = [f'已执行动作。累计捕获 {len(captured)} 条 API 请求。']

    if captured:
        sample = captured[-8:]  # Last 8 (most recent)
        req_summary = json.dumps([{
            'url':      r.get('request', {}).get('url', ''),
            'method':   r.get('request', {}).get('method', ''),
            'status':   r.get('status', 0),
            'mimeType': r.get('mimeType', ''),
            'hasBody':  bool(r.get('responseBody'))
        } for r in sample], ensure_ascii=False, indent=2)
        parts.append(f'\n最近捕获的请求:\n{req_summary}')

    if errors.get('count', 0):
        errs = errors['errors'][:3]
        parts.append('\n页面 JS 错误（可能影响 API 调用）:')
        for e in errs:
            parts.append(f'  - {e["message"]}')

    tree = snapshot.get('tree', '')[:3000]
    parts.append(f'\n当前页面快照 ({snapshot.get("nodeCount", 0)} 节点):\n{tree}')

    if len(captured) >= 5:
        parts.append('\n已有足够请求。如果已覆盖目标 API，回复 DONE；否则继续指定动作。')
    else:
        parts.append('\n继续指定动作，或回复 DONE。')

    return '\n'.join(parts)


def _log_snapshot(snapshot: dict):
    nc = snapshot.get('nodeCount', 0)
    trunc = '(截断)' if snapshot.get('truncated') else ''
    print(f'[brosearch] 快照: {nc} 节点{trunc}', file=sys.stderr)


# ─── Adapter generation helpers ───────────────────────────────────────────────

def _save_adapter(platform: str, command: str, ai_reply: str):
    code = _extract_js(ai_reply)
    if not code:
        print('[brosearch] AI 未返回有效的 JS 代码', file=sys.stderr)
        print(ai_reply)
        sys.exit(1)
    out_dir  = ADAPTERS_CUSTOM_DIR / platform
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'{command}.js'
    out_file.write_text(code)
    print(f'[brosearch] 适配器已保存: {out_file}', file=sys.stderr)
    print(f'[brosearch] 重启 daemon 后可用: brosearch fetch {platform}/{command}', file=sys.stderr)
    print(code)


def _build_adapter_prompt(platform: str, command: str, requests: list) -> str:
    sample = requests[:10]
    return f'''你是一个浏览器 API 逆向工程专家。根据下面抓取的网络请求，为 brosearch 生成一个平台适配器。

## 目标适配器

- 平台：{platform}
- 命令：{command}

## brosearch 适配器格式

```javascript
module.exports = {{
  description: '一句话描述',
  tabQuery: {{ url: '*://platform.com/*' }},
  buildJs: (args) => `
    // 在页面上下文中执行的 JS，可访问 cookies/token/全局变量
    const res = await fetch('...', {{ credentials: 'include', headers: {{...}} }})
    const data = await res.json()
    return data.items.map(item => ({{ id: item.id, title: item.title }}))
  `
}}
```

## 三种认证方式

- Tier 1：fetch() + credentials: 'include'（cookie 自动携带，最简单）
- Tier 2：先从 cookie/页面变量提取 Bearer/CSRF token，放入 headers
- Tier 3：从 webpack 模块/全局 store 获取内部 API 客户端

## 抓取到的网络请求

```json
{json.dumps(sample, ensure_ascii=False, indent=2)}
```

## 要求

1. 选最合适的 API 端点（返回列表数据的 XHR/Fetch）
2. 分析认证方式（看请求头里有没有 Bearer/X-CSRF-Token 等）
3. 返回数据做字段映射，只保留有意义的字段
4. buildJs 里的 JS 要能在浏览器页面上下文直接运行（async IIFE）
5. 直接输出完整 JS 代码，无需解释

请生成适配器代码：'''


# ─── Utils ───────────────────────────────────────────────────────────────────

def _extract_domain(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or parsed.netloc or url

def _extract_js(text: str) -> str:
    m = re.search(r'```(?:javascript|js)?\n(.*?)```', text, re.DOTALL)
    if m: return m.group(1).strip()
    if 'module.exports' in text: return text.strip()
    return ''

def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def _require_daemon(client):
    if not client.is_alive():
        print(json.dumps({'error': f'Daemon 未运行 ({client.base})。启动: pnpm daemon'}))
        sys.exit(1)

def _require_extension(client):
    if not client.extension_connected():
        print(json.dumps({'error': 'Chrome 扩展未连接。打开 Chrome 并加载 packages/extension/'}))
        sys.exit(1)


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(prog='brosearch')
    sub    = parser.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('fetch')
    p.add_argument('target', help='platform/command')
    p.add_argument('args', nargs='*', help='key=value')

    p = sub.add_parser('search')
    p.add_argument('query')
    p.add_argument('--engines', nargs='+')
    p.add_argument('--limit', type=int, default=10)

    p = sub.add_parser('read')
    p.add_argument('url')

    p = sub.add_parser('capture', help='抓取网络请求，用于生成适配器')
    p.add_argument('--tab', help='Tab URL 匹配模式，如 *://zhihu.com/*')
    p.add_argument('--duration', type=float, default=5.0)
    p.add_argument('--out', help='输出文件路径')

    p = sub.add_parser('generate', help='从 capture JSON 生成适配器')
    p.add_argument('--capture', required=True)
    p.add_argument('--platform', required=True)
    p.add_argument('--command', required=True)

    p = sub.add_parser('auto-generate', help='全自动：打开页面 → AI 交互 → 抓取 → 生成适配器')
    p.add_argument('--url', required=True)
    p.add_argument('--platform', required=True)
    p.add_argument('--command', required=True)
    p.add_argument('--duration', type=float, default=5.0, help='每次抓取时长（秒）')

    p = sub.add_parser('console', help='获取页面 console.log 记录')
    p.add_argument('--tab', help='Tab URL 匹配模式')
    p.add_argument('--clear', action='store_true', help='获取后清空记录')

    p = sub.add_parser('errors', help='获取页面 JS 错误记录')
    p.add_argument('--tab', help='Tab URL 匹配模式')
    p.add_argument('--clear', action='store_true', help='获取后清空记录')

    p = sub.add_parser('wait', help='让页面等待指定秒数（通过扩展执行）')
    p.add_argument('seconds', type=float, help='等待时长（秒）')

    sub.add_parser('adapters')
    sub.add_parser('doctor')

    args = parser.parse_args()
    dispatch = {
        'fetch':          cmd_fetch,
        'search':         cmd_search,
        'read':           cmd_read,
        'capture':        cmd_capture,
        'generate':       cmd_generate,
        'auto-generate':  cmd_auto_generate,
        'console':        cmd_console,
        'errors':         cmd_errors,
        'wait':           cmd_wait,
        'adapters':       cmd_adapters,
        'doctor':         cmd_doctor,
    }
    dispatch[args.cmd](args)


if __name__ == '__main__':
    main()
