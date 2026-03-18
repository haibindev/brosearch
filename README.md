# brosearch

统一网络数据获取层。三层能力，自动降级。

```
层1: Chrome 扩展适配器  → 已登录平台结构化数据（Twitter/知乎/小红书/GitHub...）
层2: HTTP 搜索引擎      → 通用 Web 搜索（无需 Chrome）
层3: Jina Reader       → 任意公开网页全文
```

## 快速开始

```bash
# 1. 启动 daemon（Windows/Mac 本机）
pnpm install && pnpm daemon

# 2. Chrome 加载扩展：packages/extension/

# 3. 调用
python -m brosearch.cli fetch twitter/search query="AI agent"
python -m brosearch.cli search "latest news"
python -m brosearch.cli read "https://example.com"
python -m brosearch.cli doctor
```

详见 `skills/SKILL.md`。

## 项目结构

```
packages/
  daemon/       # Node.js HTTP daemon（适配器路由 + 扩展桥接）
  extension/    # Chrome 扩展（CDP 执行层）
adapters/       # 平台适配器（JS，每个平台/命令一个文件）
  twitter/      search, timeline
  zhihu/        hot, search
  xiaohongshu/  search
  github/       trending
  hackernews/   top
  v2ex/         hot
  bilibili/     hot
  weibo/        hot
brosearch/      # Python CLI（统一入口）
engines/        # HTTP 搜索引擎（absorbed from base-websearch）
skills/         # OpenClaw skill 定义
```

## WSL / 跨平台

- Daemon 跑在 Windows/Mac 本机，监听 `0.0.0.0:19824`
- WSL 自动检测 daemon 地址（localhost 或 Windows 主机 IP）
- 环境变量 `BROSEARCH_DAEMON` 可强制指定地址
