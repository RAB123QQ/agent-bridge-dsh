# dsh-pair-panel

> 本目录由 [visualeafsama-hub/dsh-pair-panel](https://github.com/visualeafsama-hub/dsh-pair-panel)
> 改进而来，新增 Codex / Claude 双面板布局、面板启动按钮、`claude_send` 会话展示等功能。

DSH Web GUI 插件：**对端面板** —— 在 DSH 会话右侧停靠显示 agentbridge 对端（Codex / Claude）的实时状态、上下文用量与消息流。

![preview](preview.png)

> ### 🔌 配套适配器：[agentbridge-dsh](https://github.com/RAB123QQ/agent-bridge-dsh/tree/main/agentbridge-dsh)
> 本插件的运行时依赖：提供 MCP 适配器（`http://127.0.0.1:8765/mcp`）、attach 席位、
> pair 状态读取、Codex rollout 解析与推送通知钩子。本仓库只负责面板 UI 与数据加工，
> 底层通信全部由 agentbridge-dsh 完成。

- **右侧通栏停靠栏**：从标题栏下沿一直顶到底，与左侧侧边栏同一视觉语言；会话列自动预留栏宽，不遮挡聊天内容。
- **Codex / Claude 双栏**：两栏常显，缺少数据的一侧直接给出「启动」按钮，不会让 Claude 无缘无故消失。
- **菜单栏开关**：标题栏右侧工具区的小图标，随时显示/隐藏对端栏（localStorage 记忆）。
- **Markdown 消息渲染**：代码块、列表、引用、链接、行内代码、粗体/斜体/删除线；纯 DOM 构建，不注入 HTML。
- 支持浅色/深色主题（跟随 DSH 主题变量）。
- 消息去重：Codex rollout 同一条消息记录两次（`response_item` + `event_msg`），面板只显示一次。
- 推送唤醒：Codex 回复实时注入 DSH 会话，无需手动拉取。
- 兼容 DSH 0.1.x / 0.2.x（web profile 与桌面 App 的 desktop profile），安装见下。

## 安装（DSH 0.1.x / 0.2.x 通用）

本插件是 DSH "bundle" 插件：安装 = 把包加入目标 profile 的 `dsh.profile.bundles`
（CLI 会自动完成），MCP 配置则写 profile 或 home 层的 `cordis.patch.yml`。
DSH 0.2.x 有两类宿主，**落点不同**：

### A. CLI / 浏览器 web 版（`dsh web` 或 `abg dsh --pair` 拉起，profile = web）

```bash
dsh plugin --profile web add <dsh-pair-panel 绝对路径或 git url>
```

### B. 桌面 App（DeepSeek Harness，profile = desktop）

普通 `dsh` CLI 会拒绝 `--profile desktop`（桌面版 profile 由 Electron 独占）。
任选其一：

1. **推荐**：打开桌面 App → 侧栏「插件」→「添加插件」→「安装第三方插件」→
   选择 **本地目录**（指向本目录 `dsh-pair-panel`）；
2. 完全退出 App 后，用桌面版自带的 CLI：
   ```bat
   "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本目录绝对路径>"
   ```

### C. 一次装好两边 + 写 MCP 配置

仓库根目录的 `install-dsh.ps1` 会分别调用 web / desktop 的 CLI 安装，并把 MCP
insert row 写入 home 层（`$DSH_HOME/cordis.patch.yml`，对两个 profile 都生效）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dsh.ps1 -Profile both
# 桌面 App 在运行时需先完全退出（或加 -AllowDesktopRunning 自担风险）
```

安装后：`dsh web` 部署刷新页面即可；桌面 App 需要重启/重新加载页面后，会话标题栏
出现「Codex 面板」开关。宿主侧改动（推送唤醒 source kind、路由注册）在 DSH 0.2.x
上需要重启宿主进程才生效。

## 依赖

| 依赖 | 用途 | 必需 | 获取 |
| --- | --- | --- | --- |
| [agentbridge-dsh](https://github.com/RAB123QQ/agent-bridge-dsh/tree/main/agentbridge-dsh) | MCP 适配器（`http://127.0.0.1:8765/mcp`）、attach 席位、pair 状态、Codex rollout、推送通知钩子 | **是** | `git clone https://github.com/RAB123QQ/agent-bridge-dsh/tree/main/agentbridge-dsh.git` |
| [agent-bridge](https://github.com/raysonmeng/agent-bridge) | Claude Code ↔ Codex 双向桥（agentbridge-dsh 的底层） | 是 | GitHub: https://github.com/raysonmeng/agent-bridge · 文档: https://raysonmeng.github.io/agent-bridge/zh/ |
| DSH web | 宿主界面（通过 `abg dsh` 拉起） | 是 | https://github.com/deepseek-ai/dsh |
| [dsh-deep-whale / maid-atelier](https://github.com/Small-tailqwq/dsh-deep-whale) | 左右鲸鱼娘角色与布局适配（皮肤，**第三方仓库**） | 否 | `git clone https://github.com/Small-tailqwq/dsh-deep-whale.git`，皮肤许可见其仓库 |

> **安装顺序**：先装 `agentbridge-dsh`（提供 MCP 与推送），再装本插件，最后可选装皮肤。
>
> **皮肤不是必须的**：无皮肤时面板完整可用——消息流、上下文仪表、开关、主题全部正常。
> 皮肤只提供两个增强：① 右鲸鱼作为面板锚点（无皮肤时自动回退到「视口右侧 480px 估算」，
> 面板仍与会话并排）；② 左鲸鱼缩小避让（无皮肤时没有鲸鱼可避让，自然跳过）。

路径均为相对会话工作区推导（`/.local/state/agentbridge/pairs`、`/.codex/sessions`），无本机硬编码，可跨机器移植。

## 布局说明

- 面板位置：锚定右侧鲸鱼左缘，`PANEL_SHIFT`（默认 110px）整体左移面板与会话列。
- 左鲸鱼：`adjustLeftMaid()` 缩至 `min(62vh, 800px)`，避免遮挡会话气泡。
- 右鲸鱼：保持皮肤原位，面板与其保持 16px+ 间隙。

## 文件

- `lib/index.js` — 宿主侧：`GET /pair-panel/snapshot`（pair 状态 + rollout feed + 消息去重 + token 解析）、`POST /agentbridge/notify`（推送唤醒路由，`createUserMessage` 注入）
- `lib/client.js` — 浏览器侧：原生 DOM 面板、布局、主题、开关、消息去重、context 钳制
- `cordis.patch.yml` — 将 `dsh.client` 条目插入 web 插件名册
- `snapshots/` — 本地历史备份（不入库）

## 许可

MIT，见 [LICENSE](LICENSE)。
