# agentbridge-dsh

把 DSH（DeepSeek Harness）接入 [agent-bridge](https://github.com/raysonmeng/agent-bridge)
（Claude Code ↔ Codex 的双向桥）的适配器。DSH 不是顶替某一端，而是作为
**独立的对等成员**，既能与 `abg claude` 对接，也能与 `abg codex` 对接。

![preview](preview.jpg)

> ### 🧩 配套插件：[dsh-pair-panel](https://github.com/visualeafsama-hub/dsh-pair-panel)
> Codex 对端面板 —— 在 DSH Web GUI 里与会话并排显示 Codex 的实时状态、
> 上下文用量与消息流。本仓库负责 MCP 适配器与推送钩子，面板 UI 由该插件提供。

- agent-bridge 源码：https://github.com/raysonmeng/agent-bridge
- agent-bridge 文档（中文）：https://raysonmeng.github.io/agent-bridge/zh/
- 配套插件 dsh-pair-panel：https://github.com/visualeafsama-hub/dsh-pair-panel

> **验证状态**：目前只在 **Codex 侧**（channel / attach，Role A）做过真实 pair
> 联调。Role B（`--server`，对接 `abg claude`）有完整实现与 mock 闭环测试，
> 但**尚未在真实 abg claude pair 上验证**——如需使用请自行联调并反馈。

## 安装

前置：`bun`（脚本运行时）、agent-bridge（`abg` 命令，提供 daemon/pair 生态）、
`chromium`（DSH 窗口，默认取 PATH 里的 `chromium`，可用 `ABG_CHROMIUM_CMD` 覆盖）。

```bash
git clone https://github.com/visualeafsama-hub/agentbridge-dsh.git
cd agentbridge-dsh
./install.sh                 # 安装 shim 到 ~/.bun/bin/abg
# 或指定位置：./install.sh /custom/bin/abg
```

`install.sh` 会生成 `abg` 薄包装：所有 `dsh` 子命令路由到本适配器，
其余命令（doctor / pairs / resume / kill / --pair ...）原样透传给真 abg。

启动 DSH 侧（可选配 [dsh-pair-panel](https://github.com/visualeafsama-hub/dsh-pair-panel)
插件显示 Codex 对端面板）：

```bash
abg dsh --pair NAME          # 一键：MCP server + DSH web + chromium 窗口 + attach
```

可选皮肤（左右鲸鱼娘角色，**第三方仓库**，不影响适配器功能）：
[dsh-deep-whale / maid-atelier](https://github.com/Small-tailqwq/dsh-deep-whale) ·
`git clone https://github.com/Small-tailqwq/dsh-deep-whale.git` · 许可见其仓库。

## 原理

agent-bridge 的拓扑（实测自 v0.1.30）：

```
abg claude 侧（控制端口 4502，typed 协议，claude 插件独占 attach 席位）
        │
   daemon（4501 = 原始 JSON-RPC 管道 / 4502 = 控制通道）
        │
   codex app-server（4500，ws JSON-RPC）
        │
   codex TUI（--remote ws://127.0.0.1:4501，raw 协议，占 proxy 主连接）
```

两个接入点（同一套 codex app-server wire protocol 的两个角色）：

| 角色 | DSH 扮演 | 与谁对接 | 接入点 |
|---|---|---|---|
| **channel**（Role A） | 一个额外的 TUI 连接（secondary） | **abg codex** 及整个 pair | `ws://127.0.0.1:<proxyPort>/ws`，走 daemon 的 secondary 管道直达 app-server |
| **server**（Role B） | pair 的 codex app-server 本体 | **abg claude** | 实现 `initialize` / `thread/start` / turn 通知；daemon 通过 PATH 里的 `codex` 拉起它 |

daemon 的 `onTuiConnect` 原生支持 secondary 连接（每个副连接一条独立管道），
所以 DSH 可以**加入正在运行的 pair**，无需改动 agent-bridge 一行代码。

## 文件

```
bin/abg-dsh        CLI 入口（bun）
lib/protocol.js    codex app-server JSON-RPC 协议常量与工具
lib/channel-client.js  Role A：channel 客户端（经 daemon proxy 连 codex 侧）
lib/app-server.js  Role B：codex app-server 实现 + codex CLI stub
lib/mcp.js         极简 MCP server（streamable-http / stdio），暴露给 DSH 的 dsh-mcp-client
test/loop-test.sh  全链路隔离测试（独立端口 4510/4511/4512，不碰 live pair）
```

## 用法

原生集成：`~/.bun/bin/abg` 是薄包装，`dsh` 之外的命令（doctor / pairs / resume /
kill / --pair ...）全部原样透传给真 abg。

```bash
abg dsh                 # 一键：DSH web + chromium 窗口 + 挂进当前 pair（幂等，已开则跳过）
abg dsh --server        # Role B：DSH 扮演 pair 的 codex app-server（配 abg claude 用）
abg dsh --pair NAME     # 指定 pair（`abg --pair NAME dsh` 写法同样支持）
abg dsh --http-port N   # MCP 端口（默认 8765）
abg dsh --server 只起适配器；默认模式顺带拉起 DSH web（3080 未监听时）和
chromium --app 窗口（未打开时）。环境变量可覆盖：
ABG_DSH_WEB_URL / ABG_DSH_WEB_CMD / ABG_CHROMIUM_CMD / ABG_MCP_PORT / ABG_STATE_DIR

# 底层命令（高级用法）
abg dsh channel --proxy-port N --send "hello codex"   # 一次性发消息等回复
abg dsh channel --proxy-port N --listen               # 常驻监听
abg dsh server --port N [--mock]                      # 独立 app-server
abg dsh doctor                                        # pair 端口健康检查
```

## 与 DSH 集成（cordis patch）

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 加一段（HMR 热生效，无需重启），
DSH agent 就获得 `mcp__abg__send_message` / `mcp__abg__get_messages` /
`mcp__abg__pair_status` 工具：

```yaml
- id: mcp-agentbridge
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: abg
    transport: streamable-http
    url: http://127.0.0.1:8765/mcp
```

先起 MCP server：`abg-dsh mcp --mode channel --http-port 8765`（channel 模式对接
codex 侧；server 模式对接 claude 侧，二选一或各起一个端口）。

## 测试

```bash
./test/loop-test.sh    # 需要 bun；起隔离 pair（PATH stub 的 codex = 本适配器）
```

覆盖：Role A 全链路（client→daemon→app-server→pong）、MCP tools/list 与
tools/call、Role B server 模式的收/发闭环。live pair 的 secondary 连接
（initialize 握手）也验证过。

## 注意

- 只连 proxy 端口（4501 系），它只查 Origin 头，无 token；控制端口（4502 系）
  的 attach 席位是 claude 插件的，不要抢。
- secondary 连接里 codex 的回复会同时出现在 claude 插件侧 —— 这是 daemon 的
  设计（`codex_to_claude` 全量广播），在 live pair 上发消息前先想好噪音。
- 运行环境：bun（与 agent-bridge 自身一致）。node ≥22 可跑 Role A 客户端，
  Role B 的 WS server 需要 bun。

---

## 2026-08-14 最终状态（交接记录）

### 现状：全链路已通并验证

```
DSH(本会话) --mcp__abg__*--> 8765 适配器 --attach--> daemon(4532) --> codex 主 thread --> TUI 可见
     <--回复：codex_to_claude-- <----------- daemon <----------- codex <----------|
```

- **attach 引擎是默认**：DSH 以 `claude_connect` 身份（control-token + pairId + cwd + contractVersion=1）接管 pair 的"claude 席位"，消息走 `claude_to_codex` 注入 **codex 主 thread**——codex TUI 里能看到 DSH 的发言（用户已亲眼验证：「看见你了」）。
- 实测命令：`abg dsh attach --pair TST --send "..."`、`abg dsh --pair TST`（默认 attach + 对话流 + web/chromium）。
- MCP 层：`abg dsh mcp` / `daemon-mcp` 的 `send_message` 在 attach 模式下返回 codex 回复文本。
- 对话流：`abg dsh watch --pair KF` 读 codex rollout 文件（claude↔codex 对话在 `~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`；KF 的当前 thread 见 `<STATE_DIR>/pairs/KF-*/current-thread.json`）。

### 协议要点（agent-bridge v0.1.30，源码依据 dist/daemon.js）

1. **attach 身份四要素**：`{pairId, cwd(必须等于 daemon cwd), contractVersion:1, controlToken(读 pairs/<id>/control-token)}`；attach 成功信号 = 收到 `{type:"status"}`。
2. **发消息**：`{type:"claude_to_codex", requestId, message:{content, source:"claude"}, onBusy:"wait"|"steer"|"interrupt", requireReply?}`；transport 接受回 `claude_to_codex_result`，真正回复是 `codex_to_claude{message:{id,source:"codex",content,timestamp}}`（system_ 前缀 id 为系统消息）。
3. **codex app-server 协议**：`thread/start` 只建线程（响应 `result.thread.id`），**必须再发 `turn/start`{threadId, input} 才执行**（bare thread/start 会 idle——"消息没到"的坑）。通知结构：`turn/started` 的 turnId 在 `params.turn.id`；delta 是 `params.delta` 字符串；`item/completed` 的文本在 `params.item.content[]`。
4. **secondary 管道**（`--channel`）：proxy 端口 raw 转发，**独立 thread**，TUI 不可见；适合旁路任务。
5. 控制通道非 attach 只读操作：`status` / `probe_incumbent` / `request_budget_refresh`（发 `{type}` 即回）。

### 踩坑记录（别重踩）

- **cordis.patch.yml 是 override 语义**：新增插件条目必须用 `- insert:\n    - {id, name, config}` 形式，直接 `- id:` 会被 "entry not found" 静默丢弃（dump-config 默认不读 user layer，验证要看运行效果）。
- **Bun.serve 的 SSE 流 10 秒无数据会被 idle 掐断**：MCP server 的 SSE 要每 ~4s 发 `: keep-alive` 心跳；streamable-http 规范建议实现 `Mcp-Session-Id`。
- **async 函数裸 `await new Promise(...)` 返回 undefined**：要 `return await`（JS 语义）。
- **别用 `pgrep -f "daemon.js" | xargs kill`**——会匹配并杀掉 live agent-bridge daemon（本会话事故，KF pair 被打断过）。杀进程按端口找 pid。
- web 的 `cordis.patch.yml` 修改后 HMR 不一定生效，改动后建议 `pkill -f "dsh web"` 重启 web。

### 与 DSH 集成（已完成）

`$DSH_HOME/profiles/web/cordis.patch.yml` 已含（insert 形式）：
```yaml
- insert:
    - id: mcp-agentbridge
      name: '@deepseek-ai/dsh-mcp-client'
      config: { serverName: abg, transport: streamable-http, url: http://127.0.0.1:8765/mcp }
```
DSH 会话内工具：`mcp__abg__send_message` / `get_messages` / `pair_status`。

### 推送通知（Codex 回复实时唤醒 DSH）

attach 模式下，Codex 的回复会通过 `lib/control-client.js` 的 `onCodexMessage` 钩子
实时 POST 到 DSH 的 `/agentbridge/notify` 路由（由 `dsh-pair-panel` 插件提供），
DSH 侧用 `createUserMessage` 规范消息注入当前会话 inbox，实现**真正推送唤醒**，
不再依赖 `get_messages` 轮询。

- 触发条件：Codex 发送非 `system_` 前缀消息，且当前没有 `send_message` 正在等待
  （等待中的回复由 `send_message` 自己消费，避免重复唤醒）。
- 实现：`bin/abg-dsh` 在 attach 成功后给 engine 挂 `onCodexMessage`；
  `lib/control-client.js` 在收到 `codex_to_claude` 时调用该钩子。
- 配套插件：[dsh-pair-panel](https://github.com/visualeafsama-hub/dsh-pair-panel)
  的 host 侧 `/agentbridge/notify` 路由负责注入消息（必须用 `createUserMessage`
  带 `source.kind`，裸 `{role, content}` 会触发
  `Cannot read properties of undefined (reading 'kind')`）。

### Chromium 窗口修复

DSH 窗口改用无痕模式启动：`chromium --incognito --app=<webUrl>`。
原因：Chromium 默认 profile 中 `127.0.0.1:3080` 的持久站点数据损坏会导致
页面渲染循环卡死；无痕模式每次全新加载，问题不复现。

### 接手说明（给下一个 agent / 新会话）

- 代码全部在 `~/agentbridge-dsh/`：`lib/control-client.js`(attach)、`lib/channel-client.js`(secondary)、`lib/mcp.js`、`lib/watch.js`、`lib/app-server.js`(Role B)、`bin/abg-dsh`。
- `~/.bun/bin/abg` 是 shim：只拦截 `dsh` 子命令，其余透传真 abg。
- 常用：`abg dsh --pair TST`（起环境+attach+对话流，Ctrl-C 全关）、`abg dsh attach --pair X --send "..."`、`abg dsh watch --pair X [-f]`、`abg dsh doctor`。
- 限制：attach 占 pair 的 claude 席位（TST 是 DSH 专属；KF/BF 有 claude 插件不能 attach）。
