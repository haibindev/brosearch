---
name: brosearch
description: >
  统一网络数据获取层。三层能力：
  1. Chrome 扩展适配器 — 已登录平台的结构化数据（Twitter/知乎/小红书/GitHub/B站/微博等）
  2. HTTP 搜索引擎 — 通用 Web 搜索（无需 Chrome，Google/Bing/Brave/DDG/Wikipedia）
  3. Jina Reader — 任意公开网页全文读取

  自动降级：Chrome 未开 → 降级到搜索引擎；无适配器 → 降级到 Jina Reader。
  支持 WSL / Mac / Linux OpenClaw 调用，自动检测 daemon 地址。
  取代 base-websearch，统一作为所有 Skill 的网络数据底座。

  触发："搜索"、"获取XX平台数据"、"抓取"、"查热榜"、"读取网页"等。
---

# brosearch

## 架构

```
调用层（WSL / Mac / Linux OpenClaw skill）
    ↓ python -m brosearch.cli
    ↓
层1: Chrome 扩展适配器（daemon HTTP API）
    - Twitter/X: search, timeline
    - 知乎: hot, search
    - 小红书: search
    - GitHub: trending
    - HackerNews: top
    - V2EX: hot
    - B站: hot
    - 微博: hot
    ↓ 无适配器 / Chrome 未开
层2: HTTP 搜索引擎（无 Chrome 依赖）
    - Google CSE / Bing / Brave / DuckDuckGo / Wikipedia
    ↓ 读具体 URL
层3: Jina Reader（公开网页全文）
```

## 安装

### 1. Daemon（Windows / Mac 本机）

```bash
cd /path/to/brosearch
npm install -g pnpm   # 如未安装
pnpm install
pnpm daemon           # 启动 daemon，默认监听 0.0.0.0:19824
```

### 2. Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 点击「加载已解压的扩展」→ 选择 `packages/extension/` 目录
4. 扩展图标变绿 = 连接成功

### 3. Python 依赖（调用方机器）

```bash
pip install -r requirements.txt
```

### 4. 搜索引擎 Key（可选，有更稳定）

```bash
# 全局 secrets（推荐）
mkdir -p ~/.openclaw/secrets/brosearch
cat > ~/.openclaw/secrets/brosearch/.env << EOF
GOOGLE_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
SERPAPI_API_KEY=
EOF
```

## WSL 使用说明

WSL 环境下自动检测 daemon 地址：

```bash
# 现代 WSL2（Win11 / 已启用端口转发）：localhost 自动可用
# 旧版 WSL2：自动从 /etc/resolv.conf 读取 Windows 主机 IP

# 也可手动指定：
export BROSEARCH_DAEMON=http://192.168.x.x:19824
```

## 命令行用法

### 获取平台数据（需要 Chrome + 扩展）

```bash
# 抓取平台结构化数据
python -m brosearch.cli fetch twitter/search query="AI agent"
python -m brosearch.cli fetch twitter/timeline count=20
python -m brosearch.cli fetch zhihu/hot limit=20
python -m brosearch.cli fetch zhihu/search query="大模型"
python -m brosearch.cli fetch xiaohongshu/search query="穿搭"
python -m brosearch.cli fetch github/trending lang=python since=weekly
python -m brosearch.cli fetch hackernews/top limit=20
python -m brosearch.cli fetch v2ex/hot
python -m brosearch.cli fetch bilibili/hot limit=15
python -m brosearch.cli fetch weibo/hot limit=20

# 列出所有可用适配器
python -m brosearch.cli adapters
```

### 通用 Web 搜索（无需 Chrome）

```bash
python -m brosearch.cli search "openclaw agent" --limit 10
python -m brosearch.cli search "AI news" --engines brave ddg --limit 5
```

### 读取网页全文

```bash
python -m brosearch.cli read "https://example.com/article"
```

### 健康检查

```bash
python -m brosearch.cli doctor
```

## JSON 输出格式

### fetch 输出

```json
[
  { "title": "...", "url": "...", "author": "...", ... }
]
```

### search 输出

```json
{
  "query": "openclaw",
  "results": [
    { "title": "...", "url": "...", "snippet": "...", "source": "google", "rank": 1 }
  ],
  "meta": { "engines_used": ["google", "brave"], "time_ms": 1234 },
  "errors": []
}
```

## 新增平台适配器

```
1. 在 adapters/<platform>/<command>.js 创建适配器
2. 格式：
   module.exports = {
     description: '...',
     tabQuery: { url: '*://platform.com/*' },  // 匹配哪个 tab
     buildJs: (args) => `...JS 代码...`         // 返回在页面上下文执行的 JS
   }
3. 重启 daemon 自动加载
```

适配器三层技术选型：
- **Tier 1**：`fetch()` + cookies（直接请求平台 API，大多数情况够用）
- **Tier 2**：先提取 Bearer/CSRF token，再 `fetch()`（Twitter、知乎等）
- **Tier 3**：Webpack 模块注入 / Pinia store 访问（小红书等重度 SPA）
