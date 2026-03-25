# WSL + Windows Chrome 安装指南

brosearch 的三个组件在 WSL 场景下的部署方式：

```
WSL (Python CLI)  ──HTTP──►  Windows (Node daemon :19824)  ──SSE──►  Chrome (Extension)
```

- **Windows 侧**：运行 daemon + Chrome 扩展
- **WSL 侧**：只装 Python CLI，通过网络调用 daemon

> 适用于 Win10 / Win11，WSL1 和 WSL2 均支持。

---

## 前提条件

| 组件 | Windows 侧 | WSL 侧 |
|------|-----------|--------|
| Git | ✅ 需要 | ✅ 需要 |
| Node.js >= 18 | ✅ 需要（运行 daemon） | ❌ 不需要 |
| Python >= 3.10 | 可选 | ✅ 需要 |
| Chrome | ✅ 需要 | ❌ 不需要 |
| ffmpeg | 不需要 | 可选（视频合并用） |

---

## 获取代码

有两种方式把 brosearch 源码部署到目标机器：

### 方式 A：git clone（推荐）

```powershell
git clone https://github.com/haibindev/brosearch.git D:\prjs\open\brosearch
```

### 方式 B：目录同步（Syncthing 等）

源码通过 Syncthing 同步过来后，`node_modules`、`dist`、`__pycache__` 等构建产物已在 `.stignore` 中排除，不会同步。同步的只是纯源码，需要在目标机器上完整构建。

两种方式获取源码后，安装步骤相同。

---

## 第一步：Windows 侧安装

### 1.1 一键安装

```powershell
cd D:\prjs\open\brosearch
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

这会自动完成：
- `pip install -e .`（安装 Python 包）
- `npm install` + `tsc`（编译 daemon）

如果不需要 Windows 侧的 Python CLI，可以只编译 daemon：

```powershell
cd packages\daemon
npm install
npx -p typescript tsc
cd ..\..
```

### 1.3 加载 Chrome 扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `D:\prjs\open\brosearch\packages\extension` 目录

加载成功后，扩展图标显示 **br**。点击图标可查看连接状态。

> 扩展支持中英文自适应（根据 Chrome 语言设置）。

### 1.4 启动 daemon

方式一：双击脚本

```
scripts\start-daemon.bat
```

方式二：命令行

```powershell
node packages\daemon\dist\index.js
```

看到 `brosearch daemon  http://0.0.0.0:19824` 即启动成功。

> daemon 默认监听 `0.0.0.0:19824`，WSL 可直接访问。保持窗口运行，不要关闭。

### 1.5 验证 Windows 侧

点击 Chrome 上的 br 扩展图标，应显示 🟢 **就绪** / **Ready**。

如果安装了 Python，可以进一步验证：

```powershell
python -m brosearch doctor
```

---

## 第二步：WSL 侧安装

### 2.1 获取代码

**方式 A：git clone（推荐）**

```bash
git clone https://github.com/haibindev/brosearch.git ~/brosearch
cd ~/brosearch
```

**方式 B：从同步目录克隆**

如果源码已通过 Syncthing 同步到 Windows（如 `D:\prjs\open\brosearch`），可以从 `/mnt/` 拷贝到 WSL 本地：

```bash
cp -r /mnt/d/prjs/open/brosearch ~/brosearch
cd ~/brosearch
```

> 不建议直接在 `/mnt/` 路径上 `pip install -e`，跨文件系统性能差且可能有权限/换行符问题。

### 2.2 安装 Python CLI

```bash
pip install -e ~/brosearch
```

仅安装 Python CLI 和 `requests`/`PyYAML` 依赖，无需 Node.js。

### 2.3 验证连通性

```bash
python -m brosearch doctor
```

预期输出：

```json
{
  "daemon_url": "http://172.x.x.1:19824",
  "daemon_alive": true,
  "extension_connected": true
}
```

`daemon_url` 可能是 `localhost`（WSL2 mirrored 模式）或 `172.x.x.1`（WSL2 NAT 模式），CLI 会自动检测。

### 2.4 测试浏览器通信

```bash
# 获取当前 Chrome 活动标签页的标题
python -m brosearch eval --js "return document.title"
```

能返回标题即安装成功。

---

## 第三步：防火墙配置（如果连不上）

WSL2 NAT 模式下，WSL 通过虚拟网络访问 Windows，可能被防火墙拦截。

### 方式一：添加防火墙规则（推荐）

以**管理员**身份打开 PowerShell：

```powershell
netsh advfirewall firewall add rule name="brosearch-daemon" dir=in action=allow protocol=TCP localport=19824
```

### 方式二：临时关闭防火墙测试

```powershell
# 仅用于排查，确认后用方式一
netsh advfirewall set allprofiles state off
# 测完记得开回来
netsh advfirewall set allprofiles state on
```

### 方式三：手动指定 daemon 地址

如果自动检测不准，可以手动指定：

```bash
# 临时
export BROSEARCH_DAEMON=http://172.20.0.1:19824
python -m brosearch doctor

# 永久写入 ~/.bashrc
echo 'export BROSEARCH_DAEMON=http://172.20.0.1:19824' >> ~/.bashrc
```

查看 Windows 宿主 IP：

```bash
cat /etc/resolv.conf | grep nameserver
# nameserver 172.20.0.1  ← 这个就是
```

---

## 自动检测原理

brosearch CLI 的 `host.py` 自动检测运行环境：

1. 如果设置了 `BROSEARCH_DAEMON` 环境变量 → 直接使用
2. 检测 `/proc/version` 是否包含 `microsoft` → 判断是否在 WSL 中
3. WSL 中先尝试 `localhost:19824`（WSL2 mirrored 模式或端口转发）
4. 不通则读 `/etc/resolv.conf` 中的 `nameserver` 作为 Windows IP
5. 非 WSL 环境 → 直接用 `localhost`

---

## Chrome 登录准备

brosearch 通过 Chrome 的真实登录态访问各平台。使用前需要在 Chrome 中登录你需要的平台：

- 知乎：zhihu.com
- 小红书：xiaohongshu.com
- 抖音：douyin.com
- B站：bilibili.com
- 微博：weibo.com
- X/Twitter：x.com
- 等等

登录后保持标签页打开或浏览器不关闭即可，brosearch 会复用浏览器的 Cookie。

---

## 常用命令速查

```bash
# 健康检查
python -m brosearch doctor

# 在浏览器执行 JS
python -m brosearch eval --js "return document.title"
python -m brosearch eval --tab "*://zhihu.com/*" --js "return document.title"

# 导航到指定页面
python -m brosearch navigate "https://www.zhihu.com"

# 运行平台适配器
python -m brosearch fetch zhihu/hot

# 移除调试横幅
python -m brosearch detach --all
```

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `daemon_alive: false` | daemon 没启动或防火墙拦截 | 启动 daemon + 检查防火墙 |
| `extension_connected: false` | Chrome 扩展未加载或 daemon 重启后扩展未重连 | 在 chrome://extensions/ 刷新扩展 |
| `daemon_url` 是 localhost 但连不上 | WSL2 NAT 模式，localhost 不通 | 设置 `BROSEARCH_DAEMON` 环境变量 |
| eval 返回超时 | 标签页不匹配或页面未加载完 | 检查 `--tab` 参数，确保页面已打开 |
| Chrome 显示"已开始调试此浏览器" | debugger 已附加 | 用完后执行 `brosearch detach --all` |

---

## 开机自启（可选）

### daemon 自启

创建 `start-brosearch.bat`，放到 Windows 启动目录（`shell:startup`）：

```bat
@echo off
start /min cmd /c "node D:\prjs\open\brosearch\packages\daemon\dist\index.js"
```

### WSL 中设置别名

```bash
echo 'alias bro="python -m brosearch"' >> ~/.bashrc
source ~/.bashrc

# 之后可以简写
bro doctor
bro eval --js "return document.title"
```
