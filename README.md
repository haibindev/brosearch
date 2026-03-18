<div align="center">

# brosearch

**Your logged-in Chrome browser as a structured data API.**
**Zero re-authentication. No scraping detection. Real sessions.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](packages/extension/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](packages/daemon/)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](brosearch/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haibindev/brosearch?style=social)](https://github.com/haibindev/brosearch)

[中文说明](#中文说明) · [Report Bug](https://github.com/haibindev/brosearch/issues) · [Request Feature](https://github.com/haibindev/brosearch/issues)

**If you find this useful, please consider giving it a ⭐ Star — it helps a lot!**

</div>

---

## Why brosearch?

You've already logged into Twitter, Zhihu, Bilibili, and 10 other platforms. Getting data from them should be simple — but it isn't:

- **Scraping** gets you blocked or rate-limited
- **Official APIs** are paywalled, restricted, or simply don't exist
- **Playwright/Puppeteer** opens a new browser instance — your session is gone, you need to log in again
- **Cookies extraction** is fragile and expires constantly

brosearch takes a different approach: **your existing Chrome session is the API**.

1. Install the Chrome extension (loads in 30 seconds)
2. Start the daemon on your machine
3. Call `brosearch fetch zhihu/hot` — it runs JavaScript inside your real, logged-in Chrome tab
4. Get back clean structured data, with no login, no tokens, no scraping

```
Layer 1: Chrome extension adapters  → Structured data from logged-in platforms
Layer 2: HTTP search engines         → General web search (no Chrome needed)
Layer 3: Jina Reader fallback        → Full text of any public page
```

Each layer falls back to the next automatically. If you have Chrome open, you get the richest data. If not, you still get results.

**Bonus:** `brosearch auto-generate` opens a page, uses AI to interact with it (click, scroll, type), captures the API calls, and writes a new adapter — fully automatically.

---

## Features

<table>
<tr>
<td width="50%">

### 🔌 Real Session, Zero Re-auth
Runs JavaScript inside your existing Chrome tabs via CDP. Cookies, tokens, and login state are already there — brosearch just uses them. No credential management, no session files.

### 🤖 AI-Powered Adapter Generation
Point `auto-generate` at any URL and it:
1. Opens the page in Chrome
2. Gets an Accessibility Tree snapshot
3. Asks Claude to interact (click, scroll, type into search boxes)
4. Captures the triggered API requests
5. Generates a working adapter JS file

### 📡 Three-Layer Fallback
Chrome extension adapters for rich authenticated data → HTTP search engines (Google/Bing/Brave/DDG) for general search → Jina Reader for full-page text extraction. Always returns something.

</td>
<td width="50%">

### 🏗️ 8 Built-in Platforms
Ready-to-use adapters for Twitter, Zhihu, Xiaohongshu, GitHub, HackerNews, V2EX, Bilibili, and Weibo. Three tiers of authentication: Cookie passthrough, Bearer/CSRF extraction, and Webpack module injection.

### 🖥️ WSL & Cross-Platform
Daemon runs on Windows/macOS host, listens on `0.0.0.0:19824`. WSL automatically detects the host IP via `/etc/resolv.conf`. Override with `BROSEARCH_DAEMON` env var.

### 🔍 Console & Error Monitoring
Captures `console.log`, `console.error`, and JS exceptions from any tab. Used by `auto-generate` to self-diagnose when adapter generation fails.

### ⚡ Full Browser Automation
CDP commands: navigate, snapshot (AX tree), click, type, key-press, scroll, screenshot, capture network. Large-page AX tree with depth limit for performance.

</td>
</tr>
</table>

---

## Quick Start

### 1. Start the Daemon

```bash
git clone https://github.com/haibindev/brosearch.git
cd brosearch

# Install daemon dependencies
cd packages/daemon && npm install && cd ../..

# Start daemon (default port 19824)
npx tsx packages/daemon/src/index.ts
```

### 2. Load the Chrome Extension

Open Chrome → `chrome://extensions` → Enable Developer Mode → **Load unpacked** → select `packages/extension/`

The extension badge shows `✓` when connected to the daemon.

### 3. Use It

```bash
# Install Python deps
pip install requests pyyaml

# Fetch platform data (requires Chrome with logged-in session)
python -m brosearch fetch zhihu/hot
python -m brosearch fetch twitter/search query="AI agent"
python -m brosearch fetch bilibili/hot

# General web search (no Chrome needed)
python -m brosearch search "latest AI news" --engines ddg brave

# Read any page as clean text
python -m brosearch read "https://example.com/article"

# Check system status
python -m brosearch doctor
```

---

## Commands

### Data Commands

| Command | Description | Chrome needed |
|---------|-------------|:---:|
| `fetch <platform/command> [key=val]` | Run a platform adapter | ✅ |
| `search <query> [--engines ...] [--limit N]` | Multi-engine web search | ❌ |
| `read <url>` | Full-text via Jina Reader | ❌ |
| `adapters` | List all available adapters | ❌ |
| `doctor` | Check daemon + extension status | ❌ |

### Adapter Generation

| Command | Description |
|---------|-------------|
| `capture [--tab <pattern>] [--duration N] [--out file.json]` | Record network requests from open page |
| `generate --capture <file> --platform <p> --command <c>` | Generate adapter from captured requests |
| `auto-generate --url <url> --platform <p> --command <c>` | **Fully automatic**: open → interact → capture → generate |

### Diagnostics

| Command | Description |
|---------|-------------|
| `console [--tab <pattern>] [--clear]` | Read `console.log` output from tab |
| `errors [--tab <pattern>] [--clear]` | Read JavaScript exceptions from tab |

### Auto-Generate Example

```bash
# Generate a Weibo trending adapter automatically
ANTHROPIC_API_KEY=sk-... python -m brosearch auto-generate \
  --url "https://weibo.com/hot/search" \
  --platform weibo \
  --command trending \
  --duration 5
# → saves adapters/custom/weibo/trending.js
# → use with: brosearch fetch weibo/trending
```

The AI loop supports these actions: `capture`, `scroll`, `click @ref`, `type <text> [@ref]`, `key-press Enter`, `wait`.

---

## Built-in Adapters

| Platform | Commands | Auth Tier |
|----------|----------|-----------|
| **Twitter** | `search`, `timeline` | Tier 2 (Bearer + CSRF) |
| **Zhihu** | `hot`, `search` | Tier 1 (Cookie) |
| **Xiaohongshu** | `search` | Tier 3 (Internal API) |
| **GitHub** | `trending` | Tier 1 (Public + DOM) |
| **HackerNews** | `top` | Public API |
| **V2EX** | `hot` | Public API |
| **Bilibili** | `hot` | Tier 1 (Cookie) |
| **Weibo** | `hot` | Tier 1 (Cookie) |

**Auth tiers:**
- **Tier 1** — `fetch()` with `credentials: 'include'` (cookies auto-attached)
- **Tier 2** — Extract Bearer/CSRF token from cookies or page globals, pass in headers
- **Tier 3** — Access internal API client from webpack module or global store

---

## Architecture

```
brosearch
├── packages/
│   ├── extension/
│   │   ├── background.js     → Service Worker: SSE client, CDP commands, event dispatcher
│   │   ├── manifest.json     → MV3, permissions: debugger/tabs/storage/alarms
│   │   └── popup.html        → Connection status badge
│   └── daemon/
│       └── src/
│           ├── index.ts          → HTTP server (native node:http, no Express)
│           ├── extension-bridge.ts → SSE connection + pending request tracking
│           └── router.ts         → Load & route adapter JS files
├── adapters/
│   ├── twitter/              → search.js, timeline.js
│   ├── zhihu/                → hot.js, search.js
│   ├── xiaohongshu/          → search.js
│   ├── github/               → trending.js
│   ├── hackernews/           → top.js
│   ├── v2ex/                 → hot.js
│   ├── bilibili/             → hot.js
│   ├── weibo/                → hot.js
│   └── custom/               → AI-generated adapters (gitignored)
├── brosearch/
│   ├── cli.py                → Unified CLI entry point
│   ├── daemon_client.py      → HTTP client for daemon
│   ├── host.py               → WSL host detection
│   ├── search.py             → Search engine aggregator
│   └── jina_reader.py        → Jina Reader fallback
└── engines/
    ├── google_cse.py         → Google Custom Search
    ├── bing_serpapi_http.py  → Bing via SerpAPI
    ├── brave_html.py         → Brave Search (no key)
    ├── ddg_html.py           → DuckDuckGo (no key)
    └── wikipedia_api.py      → Wikipedia
```

### How It Works

```
CLI / OpenClaw skill
      │  HTTP
      ▼
  Daemon :19824
      │  SSE (persistent connection)
      ▼
Chrome Extension (Background Service Worker)
      │  chrome.debugger API (CDP)
      ▼
  Chrome Tab (real session, real cookies)
```

The extension maintains a persistent SSE connection to the daemon. When the CLI sends a command (`fetch`, `capture`, `click`, etc.), the daemon forwards it over SSE. The extension executes it via CDP and POSTs the result back.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Chrome Extension | MV3 Service Worker, CDP (`chrome.debugger`) |
| Daemon | Node.js, TypeScript, native `node:http` |
| CLI | Python 3.9+, zero runtime deps |
| Browser protocol | Chrome DevTools Protocol 1.3 |
| AI (auto-generate) | Claude API (`claude-sonnet-4-6`) |
| Search engines | Google CSE, Bing (SerpAPI), Brave, DuckDuckGo, Wikipedia |
| Page reading | Jina Reader (`r.jina.ai`) |

---

## Writing a Custom Adapter

```javascript
// adapters/custom/mysite/feed.js
module.exports = {
  description: 'Get latest posts from MyForum',
  tabQuery: { url: '*://myforum.com/*' },     // which Chrome tab to use
  buildJs: (args) => `
    // This runs inside the Chrome tab — cookies are already there
    const res = await fetch('/api/posts?limit=${args.limit || 20}', {
      credentials: 'include'
    })
    const data = await res.json()
    return data.posts.map(p => ({
      id:    p.id,
      title: p.title,
      url:   p.url,
      score: p.likes
    }))
  `
}
```

Then: `brosearch fetch mysite/feed limit=50`

Or let AI write it for you: `brosearch auto-generate --url https://myforum.com --platform mysite --command feed`

---

## Contributing

Contributions are welcome!

- Open an [issue](https://github.com/haibindev/brosearch/issues) to report bugs or request new platform adapters
- Submit a PR with a new adapter or engine
- Star the project if you find it useful ⭐

---

## License

MIT © [haibindev](https://github.com/haibindev)

---

<div id="中文说明"></div>

## 中文说明

brosearch 将已登录的 Chrome 浏览器变成结构化数据 API。

**三层架构，自动降级：**
1. Chrome 扩展适配器 — 通过 CDP 在真实已登录标签页执行 JS，获取平台数据（Twitter/知乎/小红书/B站等）
2. HTTP 搜索引擎 — 通用 Web 搜索（Google/Bing/Brave/DDG），无需 Chrome
3. Jina Reader — 任意公开网页全文兜底

**核心特性：**
- 复用已登录 Session，零重新认证
- 内置 8 个平台 11 条命令的适配器
- `auto-generate` 命令：AI 自动打开页面、交互、抓取 API、生成适配器
- Console/JS 错误监控，用于自动化自诊断
- WSL 自动检测 Windows 主机 IP
- Accessibility Tree 快照，大页面深度限制优化

**快速开始：**

```bash
# 启动 daemon
cd packages/daemon && npm install
npx tsx src/index.ts

# Chrome 加载扩展：packages/extension/

# 使用
python -m brosearch fetch zhihu/hot
python -m brosearch auto-generate --url "https://weibo.com" --platform weibo --command hot
python -m brosearch doctor
```

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=haibindev/brosearch&type=Date)](https://star-history.com/#haibindev/brosearch&Date)

</div>
