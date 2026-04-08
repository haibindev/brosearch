<div align="center">

# brosearch

**Your browser is the API. Built for AI agents.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](packages/extension/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](packages/daemon/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](brosearch/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haibindev/brosearch?style=social)](https://github.com/haibindev/brosearch)

[中文说明](#中文说明) · [Report Bug](https://github.com/haibindev/brosearch/issues)

</div>

---

AI agents have access to files, terminals, and a handful of APIs with keys. But 99% of the internet requires a browser session.

**brosearch gives agents direct access to the web through your already-logged-in Chrome.** No API keys. No re-login. No scraping. The browser executes your session credentials, the same way you do it yourself.

```
agent calls:  brosearch eval --js "return document.title"
              → runs JS in your Chrome tab → returns result as JSON
```

---

## How It Works

```
AI Agent (Claude Code / Cursor / OpenClaw / any CLI)
          │
          │  Python CLI  (brosearch eval / fetch / navigate / detach / ...)
          ▼
    ┌─────────────────────────────────────────────────────┐
    │  Daemon  (Node.js, :19824)                          │
    │                                                     │
    │  Adapter Router ──── loads adapters/*.js            │
    │       │                                             │
    │  Extension Bridge ──── SSE ───────────────────────► │──► Chrome Extension
    └─────────────────────────────────────────────────────┘           │
                                                            chrome.debugger (CDP)
                                                                       │
                                                               ┌───────▼────────┐
                                                               │  Your Chrome   │
                                                               │  Real session  │
                                                               │  Real cookies  │
                                                               └────────────────┘
```

**Key insight:** The Chrome extension keeps a persistent SSE connection to the daemon. When the agent calls `brosearch eval`, the JS is sent to the extension over SSE, executed inside the real browser tab via `chrome.debugger` (CDP), and the result is returned as JSON. The website never sees a bot — it sees *you*.

### Why not Playwright / Puppeteer?

| | Playwright | Scraping | brosearch |
|---|---|---|---|
| Browser instance | New headless browser | No browser | Your real Chrome |
| Login state | None — must re-login | Cookie extraction (fragile) | Already there |
| Anti-bot detection | `navigator.webdriver=true` | IP blocks, CAPTCHAs | Invisible — it IS you |
| Complex auth (2FA, OAuth) | Very hard to replicate | Nearly impossible | Page handles it |
| Speed | Slow (browser launch) | Varies | Fast (tab already open) |

---

## Quick Start

### Windows (PowerShell)

```powershell
git clone https://github.com/haibindev/brosearch.git
cd brosearch

# One-line setup (installs Python package + builds Node daemon)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Load Chrome extension manually:
#   1. Open chrome://extensions/
#   2. Enable "Developer mode" (top-right)
#   3. Click "Load unpacked" → select packages/extension/

# Start daemon in background
python -m brosearch daemon -b

# Verify
python -m brosearch doctor
```

### Linux / macOS

```bash
git clone https://github.com/haibindev/brosearch.git
cd brosearch

# One-line setup
bash scripts/setup.sh

# Load Chrome extension (same manual steps as above)

# Start daemon in background
python -m brosearch daemon -b

# Verify
python -m brosearch doctor
```

### WSL (connecting to Windows Chrome)

WSL only needs the Python CLI. The daemon and Chrome extension run on the **Windows side**.

```bash
# ── Windows side (PowerShell) ──
# Follow the "Windows" steps above to install daemon + extension

# ── WSL side ──
git clone https://github.com/haibindev/brosearch.git ~/brosearch
cd ~/brosearch
pip install -e .    # Python CLI only, no Node needed

# Verify (auto-detects Windows host IP)
python -m brosearch doctor
```

> **Firewall**: If WSL can't reach the daemon, allow port 19824:
> ```powershell
> # Windows PowerShell (Admin)
> netsh advfirewall firewall add rule name="brosearch" dir=in action=allow protocol=TCP localport=19824
> ```

---

## Commands

| Command | Description | Chrome |
|---------|-------------|:------:|
| `eval --js <code> [--tab <pattern>]` | Execute JS in browser tab | ✅ |
| `navigate <url> [--tab <pattern>]` | Open URL in Chrome | ✅ |
| `fetch <platform/command> [key=val]` | Run platform adapter | ✅ |
| `search <query> [--engines ...] [--limit N]` | Multi-engine web search | ❌ |
| `read <url>` | Full-text via Jina Reader | ❌ |
| `capture [--tab <pattern>] [--duration N]` | Record network requests | ✅ |
| `generate --capture <file> --platform <p> --command <c>` | Generate adapter from capture | ❌ |
| `auto-generate --url <url> --platform <p> --command <c>` | Fully automatic: open→interact→capture→generate | ✅ |
| `console [--tab <pattern>] [--clear]` | Read `console.log` from tab | ✅ |
| `errors [--tab <pattern>] [--clear]` | Read JS exceptions from tab | ✅ |
| `detach [--tab <pattern>] [--all]` | Detach debugger (removes debug banner) | ✅ |
| `adapters` | List available adapters | ❌ |
| `daemon [-b] [--stop] [--status]` | Start/stop/check daemon | ❌ |
| `doctor` | Check daemon + extension health | ❌ |

### Examples

```bash
# Execute JS in active tab
python -m brosearch eval --js "return document.title"

# Execute JS in a specific tab
python -m brosearch eval --tab "*://github.com/*" --js "return document.title"

# Navigate to a URL
python -m brosearch navigate "https://github.com"

# Run platform adapter
python -m brosearch fetch zhihu/hot
python -m brosearch fetch twitter/search query="Claude agent"

# Multi-engine web search (no Chrome needed)
python -m brosearch search "AI agent frameworks"

# Detach all debugger sessions (removes "debugging this browser" banner)
python -m brosearch detach --all
```

---

## Chrome Extension

- **i18n**: Automatically displays in English or Chinese based on Chrome language
- **Badge**: No badge when connected; red **✗** badge when daemon is disconnected
- **Popup**: Click the extension icon to see connection status

### Extension status in popup:

| Status | Meaning |
|--------|---------|
| 🟢 Ready | Daemon connected, extension active |
| 🟡 Reconnecting | Daemon running but extension needs refresh |
| 🔴 Daemon off | Daemon not running — start it first |

---

## Built-in Adapters

### International

| Platform | Commands | Notes |
|----------|----------|-------|
| **Twitter / X** | `search`, `timeline` | Bearer + CSRF (Tier 2) |
| **Reddit** | `hot` | Public JSON API; `sub=` param for subreddit |
| **GitHub** | `trending` | Public page + DOM parsing |
| **HackerNews** | `top` | Firebase public API |
| **arXiv** | `search` | Public Atom API; no tab needed |
| **StackOverflow** | `search` | StackExchange public API; no tab needed |
| **npm** | `search` | registry.npmjs.org; no tab needed |
| **Product Hunt** | `trending` | GraphQL (logged-in recommended) |
| **V2EX** | `hot` | Public API |

### China

| Platform | Commands | Notes |
|----------|----------|-------|
| **知乎 Zhihu** | `hot`, `search` | Cookie (Tier 1) |
| **微博 Weibo** | `hot`, `hot-search` | Cookie; `hot-search` = 热搜榜 |
| **小红书 XHS** | `search` | Webpack injection (Tier 3) |
| **B站 Bilibili** | `hot` | Cookie (Tier 1) |
| **36kr** | `hot`, `newsflash` | Cookie (Tier 1) |
| **掘金 Juejin** | `hot` | Token (Tier 2) |
| **雪球 Xueqiu** | `hot` | Cookie; `market=CN/US/HK` |
| **豆瓣 Douban** | `hot-movie` | Cookie; `type=movie/tv` |

> Custom adapters go in `adapters/custom/` (gitignored). Generate them with `auto-generate`.

---

## Adapter Format

One JS file per command:

```javascript
// adapters/mysite/feed.js
module.exports = {
  description: 'Get latest posts from MyForum',
  tabQuery: { url: '*://myforum.com/*' },   // which tab to run in
  buildJs: (args) => `
    // Runs inside your Chrome tab. Cookies are already there.
    const res  = await fetch('/api/posts?limit=${args.limit || 20}', {
      credentials: 'include'
    })
    const data = await res.json()
    return data.posts.map(p => ({ id: p.id, title: p.title, url: p.url }))
  `
}
```

Three auth tiers:

| Tier | Method | Example |
|------|--------|---------|
| **1** | `fetch()` + `credentials: 'include'` | Reddit, GitHub, V2EX |
| **2** | Extract Bearer/CSRF from cookies/globals | Twitter, Zhihu, Juejin |
| **3** | Access webpack module / global store | Xiaohongshu |

---

## Auto-Generate an Adapter

```bash
ANTHROPIC_API_KEY=sk-... python -m brosearch auto-generate \
  --url "https://producthunt.com" \
  --platform producthunt \
  --command trending
```

The AI interaction loop:
1. Opens URL in Chrome
2. Gets Accessibility Tree snapshot (`@ref role "name"`)
3. Decides actions: `capture`, `scroll`, `click @ref`, `type text [@ref]`, `key-press Enter`
4. Captures triggered API requests (with response bodies, up to 256KB each)
5. Generates adapter JS from captured traffic
6. Checks `console.log` / JS errors for self-diagnosis if generation fails

---

## Acknowledgements

brosearch is inspired by and builds on the ideas from **[bb-browser](https://github.com/epiral/bb-browser)** — a brilliant project that pioneered the "your browser is the API" concept for AI agents.

brosearch is a lighter, self-contained version optimized for OpenClaw / Python-based agent setups, with a focus on Chinese platforms and fully automated adapter generation.

---

## Contributing

- Open an [issue](https://github.com/haibindev/brosearch/issues) for bugs or new platform requests
- PRs welcome — especially new adapters
- Star the repo if it's useful

---

## About

**[haibindev.github.io](https://haibindev.github.io/)** — personal site & blog

---

## License

MIT © [haibindev](https://github.com/haibindev)

---

<div id="中文说明"></div>

## 中文说明

**brosearch 把已登录的 Chrome 浏览器变成 AI agent 可以直接调用的数据 API。**

无需 API Key，无需重新登录，无需爬虫——Chrome 标签页本身就是认证凭据。

### 架构

```
Python CLI  →  Node.js Daemon (:19824)  →  Chrome Extension (SSE+CDP)  →  浏览器标签页
```

- Chrome 扩展通过 SSE 保持与 daemon 的长连接
- Agent 调用 CLI → daemon 转发命令 → 扩展在真实标签页中执行 JS → 返回 JSON
- 支持 i18n（中/英文自适应）

### 快速安装

**Windows:**
```powershell
git clone https://github.com/haibindev/brosearch.git
cd brosearch
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# 加载 Chrome 扩展：chrome://extensions/ → 开发者模式 → 加载已解压 → packages/extension
python -m brosearch daemon -b   # 后台启动 daemon
python -m brosearch doctor
```

**WSL（连接同机 Windows Chrome）:**
```bash
# Windows 端：按上面步骤安装 daemon + 扩展
# WSL 端：只装 Python CLI
pip install -e ~/brosearch
python -m brosearch doctor   # 自动检测 Windows 宿主 IP
```

> 防火墙放行：`netsh advfirewall firewall add rule name="brosearch" dir=in action=allow protocol=TCP localport=19824`

### 核心命令

```bash
# 在浏览器中执行 JS
python -m brosearch eval --js "return document.title"

# 导航到指定页面
python -m brosearch navigate "https://zhihu.com"

# 运行平台适配器
python -m brosearch fetch zhihu/hot

# 多引擎搜索（无需 Chrome）
python -m brosearch search "AI agent"

# 移除调试横幅
python -m brosearch detach --all

# Daemon 管理
python -m brosearch daemon -b       # 后台启动
python -m brosearch daemon --status  # 查看状态
python -m brosearch daemon --stop    # 停止
```

**内置 17 个平台，20+ 命令**，包括：知乎/微博/小红书/B站/36kr/掘金/雪球/豆瓣（国内），Twitter/Reddit/GitHub/arXiv/StackOverflow/npm（国外）。

`auto-generate` 命令：AI 自动打开页面 → Accessibility Tree 分析 → 交互（点击/滚动/输入）→ 抓取 API → 生成适配器 JS。

灵感来源和致谢：[bb-browser](https://github.com/epiral/bb-browser)。

个人主页：**[haibindev.github.io](https://haibindev.github.io/)**　微信公众号：**海滨code**

<img src="wechat-qr.jpg" alt="公众号二维码" width="160"/>

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=haibindev/brosearch&type=Date)](https://star-history.com/#haibindev/brosearch&Date)

</div>
