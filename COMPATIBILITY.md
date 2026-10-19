# 兼容性说明（DSH 0.2.x 适配）

本仓库最初针对 **DSH 0.1.x**（2026-08 中旬）编写。2026-10 的 DSH 已经到
**0.2.1-rc.2**（桌面版 DeepSeek Harness 44.7.0 内置同一 runtime，也是 npm
`latest`），本文件记录为同时适配 **web profile** 与 **desktop profile** 所做的
改动、依据与实测结果。

> 结论：适配后，仓库的两半（面板 bundle + MCP 适配器）在 DSH 0.2.1-rc.2 上
> 可以安装、加载并工作；web / desktop 两种宿主都有对应的安装与配置路径。

## 1. 为什么需要适配

| 方面 | 0.1.x（仓库原始目标） | 0.2.1-rc.2（当前） |
|---|---|---|
| 会话消息 source | `{ kind: 'plugin', plugin: '<name>' }` 合法 | session format **v4** 退休该包装：编码器抛 `format v4 message requires a producer-owned source kind`；第三方插件约定 `plugin:<name>` |
| Session 元数据 | `session.meta.cwd` | `session.header.cwd`（`meta` 不再存在） |
| 插件热重载 | 较少使用 HMR | live profile 默认 HMR；未 fiber-scoped 的 `webServer.register` 在重新 apply 时会抛 `duplicate exact route` |
| 客户端 Cordis 服务 | `ctx.get('slots')` 可用 | 仍可用，但官方 bundle 都声明 `exports.inject = ["slots"]`，否则是竞态 |
| 布局 | 旧 flex 框架 | 三列 CSS grid + 官方 rightbar 列 + Windows 标题栏变量 |
| 宿主形态 | `dsh web`（profile=web） | 桌面 App 固定 profile=desktop；普通 `dsh` CLI 拒绝 `--profile desktop` |
| MCP 超时 | — | `dsh-mcp-client` 默认 `toolCallTimeoutMs=60000`，小于适配器 180s/300s 默认等待 |
| MCP 配置落点 | `$DSH_HOME/profiles/web/cordis.patch.yml` | web 写 profiles/web；桌面写 profiles/desktop；或 home 层 `$DSH_HOME/cordis.patch.yml` 两个 profile 通用 |
| 桌面版 GUI 端口 | 固定 3080 | 桌面版向 OS 请求随机端口（`--port 0`），外部推送方需要发现 |

## 2. 改动清单

### dsh-pair-panel（宿主半 `lib/index.js`）

1. `deriveHome()` 兼容 `session.header.cwd`（旧版 fallback 到 `session.meta.cwd`）。
2. 推送唤醒消息 source 改为 `{ kind: 'plugin:ui-pair-panel' }`，符合 v4 的
   “producer-owned source kind” 规则；同时允许 poster 传 `agentId` / `sessionId`
   精确唤醒目标 agent（缺省仍取第一个 root agent）。
3. 三个 `webServer.register(...)` 全部包进 `ctx.effect(...)`，HMR / 禁用再启用
   不再因重复路由报错。
4. `/pair-panel/snapshot` 无条件解析当前模型 context window（HTTP handler 没有
   initiator 边界，原先只有存在 session 时才解析，导致 DSH 仪表缺失）。
5. `/pair-panel/snapshot` 接受 `?session=<id>`（client 半会带上当前会话），
   从而 `sessions.get()` 可解析、`tokenMeter.measure()` 可工作。

### dsh-pair-panel（浏览器半 `lib/client.js`）

1. 末尾导出 `exports.inject = ["slots"]`，并用 `ctx.slots` 读取服务；头部开关
   不再依赖服务就绪时序（renderer 重载后也会重新 apply）。
2. `Sensor` 从 slot props 捕获 `props.sessionId`，`loadSnapshot()` 携带
   `&session=`，桌面版也能显示 DSH 上下文用量。
3. 布局适配：`.pp-panels` 的 top 叠加 `--dsh-windows-titlebar-height`；面板
   定位会预留官方 right sidebar 列（`[data-rightbar-col]`）的宽度，避免覆盖
   右侧栏。
4. 样式标签补 `dataset.plugin`，便于模块系统在失败/重载时回收。
5. `package.json` 增加 `locale/*.json`（标题/描述）与 `icon.svg`，桌面 App
   的插件管理页能显示名称与图标；版本号 0.0.1 → 0.1.0。

### agentbridge-dsh（`bin/abg-dsh`）

1. `abg dsh --pair NAME` 自动识别 DSH 宿主：
   - `--dsh-web-url` / `ABG_DSH_WEB_URL` / `DSH_WEB_URL`（DSH 会话 shell 里已存在）；
   - 否则在 Windows 上用 `netstat -ano` + `tasklist` 找出 DeepSeek Harness.exe
     的 loopback 监听端口，再用 `/manifest.webmanifest` 指纹确认是 DSH GUI；
   - 识别到桌面版时直接复用（不启动第二个 `dsh web`、不开 Chromium 窗口），
     推送唤醒 POST 到该端口；否则退回 3080 的老行为。
2. 修复 `abg dsh mcp ...` 子命令分发（原文档有、代码没有），并新增
   `--dsh-web-url` 与 `abg dsh mcp` 的用法说明。
3. Windows 健壮性：`.cmd`/`.ps1` 通过 `where.exe` 解析 + `cmd /c` /
   `powershell -File` 包装；`startDetached` 处理 `error` 事件，不再因
   `chromium`/`dsh` 不存在而崩；Chromium 窗口用标记文件 + `tasklist` 判断，
   不再依赖 POSIX 的 `pgrep`/`ps`。
4. 打印的 MCP 配置默认带 `toolCallTimeoutMs: 300000`，并按识别到的宿主提示
   正确的 patch 文件路径。

### 配置 / 安装

1. `config/cordis.patch.yml.example` 更新为 0.2.x 语法说明（insert/空文件/HMR），
   覆盖 web、desktop、home 三种落点，并带 `toolCallTimeoutMs`。
2. 新增 `install-dsh.ps1`：`-Profile web|desktop|both`，调用对应 CLI 安装
   bundle；`-McpLayer home|profile|none` 写入 MCP insert row（默认 home 层，
   两个 profile 通用）；桌面 App 运行中会提示先退出。
3. README（根 / dsh-pair-panel / agentbridge-dsh）更新为双宿主安装与配置说明。

## 3. 实测记录（2026-10）

环境：Windows 11 / Node 24.12.0 / bun 1.3.14 / DSH 0.2.1-rc.2（npm 安装）/ pnpm 11.4.0。

| 测试 | 结果 |
|---|---|
| `dsh plugin --profile web add <patched dsh-pair-panel>` | exit 0；profile manifest 自动加入依赖与 `dsh.profile.bundles` 条目 |
| `--dump-config --profile web` | 接受 bundle patch，出现 `- id: ui-pair-panel`，无 stderr 警告 |
| `dsh web` 启动（scratch profile） | 无 failed/pending/incompatible 插件块 |
| `GET /pair-panel/snapshot` | 200 JSON `{"ok":true,...}`，读到真实 pair 状态 |
| `GET /agentbridge/notify` | 200 `{"ok":true}` |
| `__DSH_BOOT__` 客户端图 | 69 → 70 条，插件在 application preload batch；bundle URL 200（38,402 B），错误 rev 404 |
| MCP 适配器握手（当前 SDK 2.2.0，`versionNegotiation:auto`） | 36–51ms 握手，协商 `2025-06-18`，4 个工具，`tools/call` 正常 |
| session format v4 编码 | `kind:'plugin'` 抛错、`kind:'plugin:ui-pair-panel'` 通过（见 §2 改动 2） |
| `abg dsh mcp --mode bogus` | 正确进入 `cmdMcp`（修复前会误走一键模式并报“必须指定 pair”） |

未验证：真实浏览器中的面板 DOM 渲染/层级（需人工目视）、真实 codex pair 的
端到端回合（本机无运行中的 pair daemon）、桌面 App 内安装（会修改用户真实
profile，交由 `install-dsh.ps1` 在退出 App 后执行）。

## 4. 仍存在的已知限制

- 面板是 fixed 覆盖层而不是官方 right sidebar pane；在右侧栏展开、窗口很窄或
  使用第三方鲸鱼皮肤时，位置仍可能与官方布局存在细微错位（功能不受影响）。
- 桌面版 GUI 端口可能每次启动变化：适配器会自动发现，但若有自定义代理/端口
  转发，请显式设置 `ABG_DSH_WEB_URL`。
- 适配器手写 MCP `2025-06-18` 协议，依赖 DSH 当前 SDK 的 legacy 回退；未来
  DSH 升 MCP SDK 主版本并移除旧协议回退时需要再适配（实现 `server/discover`
  或换官方 server SDK）。
- `engines.dsh` 未声明：DSH 的版本兼容检查因此不会拦截也不会提示；
  `toolCallTimeoutMs` 字段在 0.1.x 上可能报未知字段，老版本请删掉。

## 5. 2026-10-19 夜间追加（联调反馈）

- **界面改为右侧停靠栏**：与左侧侧边栏同一视觉语言——通栏、平铺、细分割线、分组头，不再是悬浮圆角卡片；窗口变窄时栏宽自动收窄（280px）并隐藏次要文字。
- **移除会话标题栏注入**：原先注入的「Codex 面板」按钮在窄窗口会与文件夹图标挤在一起重叠；现在改为栏头「对端 ›」收起、右侧边缘窄把手展开，不再占用会话标题栏。
- **消息 Markdown 渲染**：代码块、标题、列表、引用、链接、行内代码、粗体/斜体/删除线；全部用 DOM 节点构建，不注入 HTML。
- **Claude 侧目录编码兼容**：新版 Claude Code 会把 `\.dsh` 这类点目录编码成 `--`（例如 `C--Users-Lenovo--dsh-profiles-desktop`），旧代码只替换路径分隔符会找不到会话；现在按候选编码匹配实际目录（本次先用 junction 立即生效，重启后走代码路径）。
- **Codex 侧数据回退**：`current-thread.json` 的 thread 与 Codex TUI 实际写入的 rollout 不一致时，按 pair cwd 匹配最新 rollout，并用 rollout 文件名修正面板显示的 thread id。
- **pair 启动健壮性**：pair 目录不存在时回退到当前 workspace；启动按钮使用当前选中的 pair 名（不再硬编码 main/cf）；失败时返回明确错误。
- 生效范围：客户端（界面/Markdown）随 HMR 立即生效；host 侧上述改动需重启一次 DSH 后加载。
- **最终 UI 形态**：右侧通栏停靠栏（`top = 标题栏下沿`，与左侧栏同风格、无悬浮把手）；显示/隐藏开关放在标题栏右侧工具区的小图标；会话列自动预留栏宽。消息按 Markdown 渲染，feed 滚动做贴底加固（双 rAF + `overflow-anchor:none`），并在轮询失败时保留上一份快照避免面板重建跳顶。
