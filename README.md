<div align="center">

# brosearch

**Your browser is the API. Built for AI agents.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](packages/extension/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](packages/daemon/)
[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](brosearch/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haibindev/brosearch?style=social)](https://github.com/haibindev/brosearch)

[中文说明](#中文说明) · [Report Bug](https://github.com/haibindev/brosearch/issues)

</div>

---

AI agents have access to files, terminals, and a handful of APIs with keys. But 99% of the internet requires a browser session.

**brosearch gives agents direct access to the web through your already-logged-in Chrome.** No API keys. No re-login. No scraping. The browser executes your session credentials, the same way you do it yourself.

```
agent calls:  brosearch fetch zhihu/hot
              → runs JS in your Chrome tab → returns clean JSON
```

Three layers, automatic fallback:

```
1. Chrome extension adapters   →  Logged-in platform data  (Twitter / Zhihu / Reddit / ...)
2. HTTP search engines         →  General web search       (no Chrome needed)
3. Jina Reader                 →  Full-text of any page    (last resort)
```

---

## For AI Agents

```bash
# Cross-platform research in one session
brosearch fetch arxiv/search query="retrieval augmented generation"
brosearch fetch reddit/hot sub=MachineLearning
brosearch fetch github/trending
brosearch fetch stackoverflow/search query="RAG implementation"
brosearch fetch zhihu/search query="RAG"
brosearch fetch 36kr/newsflash

# Six sources. Structured JSON. No browser tabs opened manually.
```

```bash
# Authenticated platform data (uses your existing login)
brosearch fetch twitter/search query="Claude agent"
brosearch fetch bilibili/hot
brosearch fetch xueqiu/hot market=CN
brosearch fetch weibo/hot-search
brosearch fetch juejin/hot

# No token needed — your Chrome session is the credential.
```

```bash
# Unknown platform? Generate an adapter automatically
ANTHROPIC_API_KEY=sk-... brosearch auto-generate \
  --url "https://news.ycombinator.com/show" \
  --platform hn --command show
# → AI opens the page, scrolls, captures API calls, writes adapter JS
```

---

## How It Works

```
AI Agent (Claude Code / Cursor / any CLI)
          │
          │  Python CLI  (brosearch fetch / search / read / auto-generate)
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

**Key insight:** The Chrome extension keeps a persistent SSE connection to the daemon. When the agent calls `brosearch fetch twitter/search`, the adapter JS is sent to the extension over SSE, executed inside the real Twitter tab via `chrome.debugger` (CDP), and the result is returned as JSON. The website never sees a bot — it sees *you*.

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

```bash
git clone https://github.com/haibindev/brosearch.git
cd brosearch

# 1. Start daemon
cd packages/daemon && npm install && cd ../..
npx tsx packages/daemon/src/index.ts

# 2. Load extension: Chrome → chrome://extensions → Developer Mode → Load unpacked → packages/extension/
#    Extension badge shows ✓ when connected.

# 3. Install Python deps
pip install requests pyyaml  # anthropic only needed for auto-generate

# 4. Go
python -m brosearch doctor
python -m brosearch fetch zhihu/hot
python -m brosearch search "AI agent frameworks"
```

---

## Commands

| Command | Description | Chrome |
|---------|-------------|:------:|
| `fetch <platform/command> [key=val]` | Run platform adapter | ✅ |
| `search <query> [--engines ...] [--limit N]` | Multi-engine web search | ❌ |
| `read <url>` | Full-text via Jina Reader | ❌ |
| `capture [--tab <pattern>] [--duration N]` | Record network requests | ✅ |
| `generate --capture <file> --platform <p> --command <c>` | Generate adapter from capture | ❌ |
| `auto-generate --url <url> --platform <p> --command <c>` | Fully automatic: open→interact→capture→generate | ✅ |
| `console [--tab <pattern>] [--clear]` | Read `console.log` from tab | ✅ |
| `errors [--tab <pattern>] [--clear]` | Read JS exceptions from tab | ✅ |
| `adapters` | List available adapters | ❌ |
| `doctor` | Check daemon + extension health | ❌ |

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

One JS file per command. Dead simple:

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
- Star the repo if it's useful ⭐

---

## License

MIT © [haibindev](https://github.com/haibindev)

---

<div id="中文说明"></div>

## 中文说明

**brosearch 把已登录的 Chrome 浏览器变成 AI agent 可以直接调用的数据 API。**

无需 API Key，无需重新登录，无需爬虫——Chrome 标签页本身就是认证凭据。

**三层架构，自动降级：**
1. Chrome 扩展适配器 → 通过 CDP 在真实登录标签页执行 JS，获取平台结构化数据
2. HTTP 搜索引擎 → Google/Bing/Brave/DDG 聚合搜索（无需 Chrome）
3. Jina Reader → 任意网页全文兜底

**内置 17 个平台，20+ 命令**，包括：知乎/微博/小红书/B站/36kr/掘金/雪球/豆瓣（国内），Twitter/Reddit/GitHub/arXiv/StackOverflow/npm（国外）。

`auto-generate` 命令：AI 自动打开页面 → Accessibility Tree 分析 → 交互（点击/滚动/输入）→ 抓取 API → 生成适配器 JS。

灵感来源和致谢：[bb-browser](https://github.com/epiral/bb-browser)。

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=haibindev/brosearch&type=Date)](https://star-history.com/#haibindev/brosearch&Date)

</div>
