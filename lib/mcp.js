// Minimal MCP server exposing the DSH <-> agent-bridge adapter as tools, so
// DSH's own dsh-mcp-client can mount it (streamable-http or stdio).
// Tools are server-qualified as mcp__<serverName>__<tool> on the DSH side.
//
// Two modes:
//   channel — talk to the codex side of an agent-bridge pair through the
//             daemon's proxy port (Role A).
//   server  — act as the codex app-server of a pair (Role B); inbound
//             thread/start messages are the "messages from abg claude".

import { spawn, execFile } from "node:child_process";

import {
  APP_SERVER_METHODS,
  NOTIFICATIONS,
  makeNotification,
  makeRequest,
  makeResponse,
  makeError,
  isRequest,
  isResponse,
  isNotification,
  parseFrame,
  firstText,
  textInput,
} from "./protocol.js";

// Run `bin args...` without blocking the event loop (this MCP server also
// pumps daemon messages and SSE heartbeats on the same thread). Resolves
// with {exitCode, stdout, stderr, timedOut}; rejects with the spawn error
// (e.g. ENOENT) if the binary itself could not be launched.
function spawnClaude(bin, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(bin, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

// Best-effort PATH probe used only as a fallback when the direct spawn of
// the configured/expected binary name fails with ENOENT. Never returns a
// hardcoded path — only whatever `where`/`which` resolves on this machine.
function findClaudeOnPath() {
  return new Promise((resolve) => {
    const finder = process.platform === "win32" ? "where" : "which";
    execFile(finder, ["claude"], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(first || null);
    });
  });
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
let _mcpId = 0;
const nextMcpId = () => ++_mcpId;

export class McpServer {
  constructor({ mode = "channel", engine, log = console.error, claudeCwd = null } = {}) {
    this.mode = mode;
    this.engine = engine; // ChannelClient (channel) or DshAppServer (server)
    this.log = log;
    this.claudeCwd = claudeCwd; // where claude -p runs (so sessions land in the pair dir)
    this.initialized = false;
  }

  toolDefs() {
    return [
      {
        name: "send_message",
        description: `Send a text message to the ${this.mode === "channel" ? "codex side (through the agent-bridge daemon)" : "claude side (as the pair's codex app-server)"} and wait for the turn to complete.`,
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Message text to send" },
            timeoutMs: { type: "number", description: "Max wait in ms (default 180000)" },
          },
          required: ["text"],
        },
      },
      {
        name: "get_messages",
        description: `Return any messages received from the ${this.mode === "channel" ? "codex side" : "claude side"} that have not been consumed yet.`,
        inputSchema: {
          type: "object",
          properties: {
            timeoutMs: { type: "number", description: "Block up to this many ms waiting for a message (default 0 = return immediately)" },
          },
        },
      },
      {
        name: "pair_status",
        description: "Report whether the agent-bridge daemon and app-server are reachable.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "claude_send",
        description: "Run a one-shot Claude Code prompt via `claude -p` and return Claude's reply. Uses your local claude CLI configuration (ANTHROPIC_BASE_URL etc.). Runs with the pair's working directory as cwd, and by default Claude may execute tools there (read/write files, run commands) — this is not a plain text Q&A call. Pass readonly: true to run with --permission-mode plan instead, which restricts Claude to planning/read-only behavior. Each call starts a fresh session.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Prompt to send to Claude" },
            timeoutMs: { type: "number", description: "Max wait in ms (default 300000)" },
            readonly: { type: "boolean", description: "If true, run with --permission-mode plan (no tool execution, plan/read-only mode)" },
            continue: { type: "boolean", description: "Continue the most recent conversation in the cwd (default true, keeps context). Set false to start a fresh session." },
          },
          required: ["text"],
        },
      },
    ];
  }

  async _callTool(name, args) {
    switch (name) {
      case "send_message": {
        const text = String(args?.text ?? "");
        if (!text) return this._toolError("send_message requires 'text'");
        const timeoutMs = Number(args?.timeoutMs ?? 180000);
        if (this.mode === "channel") {
          const msg = await this.engine.sendMessage(text, { timeoutMs });
          return this._toolResult(JSON.stringify({ ok: true, threadId: msg.threadId, turnId: msg.turnId, reply: msg.text }));
        }
        if (this.mode === "attach") {
          const reply = await this.engine.sendMessage(text, { timeoutMs });
          return this._toolResult(JSON.stringify({ ok: true, reply }));
        }
        // server mode: reply to the oldest pending inbound message, falling
        // back to the most recent thread (the reply can arrive after the
        // message was already drained by get_messages).
        let target = this.engine.drainInbound()[0];
        if (!target) {
          const latest = this.engine.latestThread();
          if (!latest) {
            return this._toolResult(JSON.stringify({ ok: false, error: "no message from claude received yet; call get_messages first" }));
          }
          target = { threadId: latest.threadId, turnId: latest.turnId, itemId: latest.itemId };
        }
        this.engine.reply({ ...target, text });
        return this._toolResult(JSON.stringify({ ok: true, repliedTo: target.threadId, text }));
      }

      case "get_messages": {
        const timeoutMs = Number(args?.timeoutMs ?? 0);
        if (this.mode === "channel") {
          if (timeoutMs > 0) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline && this.engine.inbound.length === 0) {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          const msgs = this.engine.drainInbound();
          return this._toolResult(JSON.stringify({ messages: msgs }));
        }
        if (this.mode === "attach") {
          if (timeoutMs > 0) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline && this.engine.inbound.length === 0) {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          const msgs = this.engine.inbound.splice(0).map((m) => ({ id: m.id, content: m.content }));
          return this._toolResult(JSON.stringify({ messages: msgs }));
        }
        // server mode: wait for a thread/start from the daemon
        if (timeoutMs > 0) {
          await this.engine.waitForInbound(timeoutMs);
        }
        const msgs = this.engine.drainInbound().map((m) => ({ threadId: m.threadId, turnId: m.turnId, text: m.text }));
        return this._toolResult(JSON.stringify({ messages: msgs }));
      }

      case "pair_status": {
        const status = {};
        if (this.mode === "channel") {
          status.mode = "channel";
          status.proxyConnected = this.engine.ws?.readyState === WebSocket.OPEN;
          status.url = this.engine.url;
        } else if (this.mode === "attach") {
          status.mode = "attach";
          status.attached = this.engine.attached;
          status.bridgeReady = this.engine.status?.bridgeReady ?? null;
          status.tuiConnected = this.engine.status?.tuiConnected ?? null;
          status.threadId = this.engine.status?.threadId ?? null;
        } else {
          status.mode = "server";
          status.appServerListening = !!this.engine.server;
          status.daemonConnected = this.engine.ws?.readyState === WebSocket.OPEN;
        }
        return this._toolResult(JSON.stringify(status));
      }

      case "claude_send": {
        const text = String(args?.text ?? "");
        if (!text) return this._toolError("claude_send requires 'text'");
        const timeoutMs = Number(args?.timeoutMs ?? 300000);
        const cliArgs = ["-p", text];
        if (args?.readonly) cliArgs.push("--permission-mode", "plan");
        if (args?.continue !== false) cliArgs.push("--continue");
        const cwd = this.claudeCwd || process.cwd();

        // Resolution order: explicit override env var, then plain "claude"
        // on PATH. Only if that ENOENTs do we probe PATH via where/which as
        // a fallback — never a hardcoded machine-specific path.
        const primaryBin = process.env.ABG_CLAUDE_BIN || "claude";

        let res;
        try {
          res = await spawnClaude(primaryBin, cliArgs, { cwd, timeoutMs });
        } catch (err) {
          if (err?.code !== "ENOENT") {
            return this._toolResult(JSON.stringify({ ok: false, error: String(err?.message || err) }));
          }
          const fallbackBin = await findClaudeOnPath();
          if (!fallbackBin || fallbackBin === primaryBin) {
            return this._toolResult(JSON.stringify({
              ok: false,
              error: `claude CLI not found (tried "${primaryBin}"; set ABG_CLAUDE_BIN to its full path, or ensure it's on PATH)`,
            }));
          }
          try {
            res = await spawnClaude(fallbackBin, cliArgs, { cwd, timeoutMs });
          } catch (err2) {
            return this._toolResult(JSON.stringify({ ok: false, error: String(err2?.message || err2) }));
          }
        }

        if (res.timedOut) {
          return this._toolResult(JSON.stringify({ ok: false, error: `claude -p timed out after ${timeoutMs}ms` }));
        }

        const combined = (res.stdout + (res.stderr ? (res.stdout ? "\n" : "") + res.stderr : "")).trim();
        const truncated = combined.length > 20000;
        const result = {
          ok: res.exitCode === 0,
          exitCode: res.exitCode,
          reply: combined.slice(0, 20000),
        };
        if (truncated) result.truncated = true;
        return this._toolResult(JSON.stringify(result));
      }

      default:
        return this._toolError(`unknown tool: ${name}`);
    }
  }

  _toolResult(text) {
    return { content: [{ type: "text", text }] };
  }

  _toolError(text) {
    return { content: [{ type: "text", text }], isError: true };
  }

  async handleJsonRpc(msg, headers = {}) {
    if (!msg || typeof msg !== "object") return null;
    if (isNotification(msg)) {
      if (msg.method === "notifications/initialized") this.initialized = true;
      return null; // notifications -> no response
    }
    if (!isRequest(msg)) return null;
    const { method, id, params = {} } = msg;
    if (method !== "initialize") {
      const sid = headers["mcp-session-id"];
      if (sid && this.sessions && !this.sessions.has(sid)) {
        return makeError(id, -32001, `unknown session: ${sid}`);
      }
    }
    switch (method) {
      case "initialize": {
        this.initialized = true;
        const sessionId = crypto.randomUUID();
        this.sessions ??= new Set();
        this.sessions.add(sessionId);
        const response = makeResponse(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agentbridge-dsh", version: "0.1.0" },
        });
        response._sessionId = sessionId;
        return response;
      }
      case "ping":
        return makeResponse(id, {});
      case "tools/list":
        return makeResponse(id, { tools: this.toolDefs() });
      case "tools/call":
        try {
          return makeResponse(id, await this._callTool(params.name, params.arguments));
        } catch (e) {
          return makeResponse(id, this._toolError(e?.message ?? String(e)));
        }
      default:
        return makeError(id, -32601, `method not found: ${method}`);
    }
  }
}

// ── streamable-http transport (Bun.serve) ────────────────────────────────
export async function serveHttp(mcp, port) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;
      const accept = req.headers.get("accept") ?? "";
      const wantsSse = accept.includes("text/event-stream");

      if (method === "GET") {
        // MCP streamable-http: GET = SSE stream for server->client messages.
        // Bun.serve idles out sockets with no traffic after ~10s, so push a
        // keep-alive comment every 4s to hold the stream open.
        const sessionId = req.headers.get("mcp-session-id") ?? null;
        if (sessionId && mcp.sessions && !mcp.sessions.has(sessionId)) {
          return new Response("unknown session", { status: 404 });
        }
        const stream = new ReadableStream({
          start(controller) {
            mcp._sseController = controller;
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(": keep-alive\n\n");
              } catch {}
            }, 4000);
            mcp._sseHeartbeat = heartbeat;
          },
          cancel() {
            clearInterval(mcp._sseHeartbeat);
            mcp._sseController = null;
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      if (method === "POST") {
        const raw = await req.text();
        const msg = parseFrame(raw);
        const sessionHeader = req.headers.get("mcp-session-id") ?? undefined;
        const response = await mcp.handleJsonRpc(msg, { "mcp-session-id": sessionHeader });
        if (response === null) {
          return new Response("Accepted", { status: 202 });
        }
        const headers = { "Content-Type": "application/json" };
        if (response._sessionId) {
          headers["Mcp-Session-Id"] = response._sessionId;
          delete response._sessionId;
        }
        const body = JSON.stringify(response);
        if (wantsSse) {
          // SSE envelope: one event containing the JSON-RPC response.
          const sse = `event: message\ndata: ${body}\n\n`;
          return new Response(sse, {
            headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          });
        }
        return new Response(body, { headers });
      }

      if (method === "DELETE") {
        return new Response("Accepted", { status: 202 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  mcp.log(`[mcp] streamable-http on http://127.0.0.1:${port}/mcp`);
  return server;
}

// ── stdio transport ──────────────────────────────────────────────────────
export async function serveStdio(mcp) {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const msg = parseFrame(line);
    const response = await mcp.handleJsonRpc(msg);
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  });
  mcp.log("[mcp] stdio transport ready");
}
