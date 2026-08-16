// Role A: DSH as a channel-side peer of agent-bridge, talking to the codex
// side of a pair. Connect to the daemon's PROXY port (4501) — the raw
// JSON-RPC endpoint the real codex TUI uses. agent-bridge's onTuiConnect
// explicitly supports additional ("secondary") connections there; each
// secondary gets its own buffered pipe to the app-server. No token needed;
// only the Origin header is checked (so never send one).

import {
  APP_SERVER_METHODS,
  NOTIFICATIONS,
  SERVER_REQUESTS,
  USER_AGENT,
  firstText,
  makeRequest,
  makeResponse,
  makeError,
  isRequest,
  isResponse,
  isNotification,
  parseFrame,
  textInput,
} from "./protocol.js";

export class ChannelClient {
  constructor({ proxyPort = 4511, url = null, log = console.error } = {}) {
    this.url = url ?? `ws://127.0.0.1:${proxyPort}`;
    this.log = log;
    this.ws = null;
    this.initialized = false;
    this.pending = new Map(); // id -> {resolve, reject, method, t}
    this.inbound = []; // agent messages received from the codex side
    this.waiters = [];
    this.turnState = new Map(); // turnId -> {threadId, text}
    this.itemState = new Map(); // itemId -> {text} (agentMessage delta buffers)
    this.lastTurnId = null; // latest turn/started, items fold into it
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const t = setTimeout(() => reject(new Error(`timeout connecting to ${this.url}`)), 5000);
      ws.onopen = () => {
        clearTimeout(t);
        this.ws = ws;
        resolve();
      };
      ws.onerror = (e) => {
        clearTimeout(t);
        reject(new Error(`ws error connecting to ${this.url}: ${e?.message ?? e}`));
      };
    });
    this.ws.onmessage = (event) => this._onFrame(event.data);
    this.ws.onclose = () => {
      this.log("[channel] connection closed");
      for (const [, p] of this.pending) {
        p.reject(new Error("connection closed"));
      }
      this.pending.clear();
    };
    return this;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }

  _send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("channel socket is not open");
    }
    this.ws.send(JSON.stringify(msg));
  }

  _onFrame(raw) {
    const msg = parseFrame(raw);
    if (!msg) return;
    if (isResponse(msg)) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.t);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
      }
      return;
    }
    if (isRequest(msg)) {
      // The app-server (or daemon) asks us something — only approvals exist
      // in the surface; answer with a rejection.
      if (SERVER_REQUESTS.has(msg.method)) {
        this._send(makeResponse(msg.id, { approved: false, reason: "dsh channel client cannot approve" }));
      } else {
        this._send(makeError(msg.id, -32601, `method not found: ${msg.method}`));
      }
      return;
    }
    if (isNotification(msg)) {
      this._onNotification(msg);
    }
  }

  // Real codex notification shapes (mirrors agent-bridge's own parsing):
  //   turn/started        params.turn.id
  //   item/started        params.item = {id, type: "agentMessage", ...}
  //   item/agentMessage/delta  params.itemId + params.delta (plain string)
  //   item/completed      params.item = {id, type, content: [...]}
  //   turn/completed      params.turn.id
  _onNotification(msg) {
    const p = msg.params ?? {};
    switch (msg.method) {
      case NOTIFICATIONS.TURN_STARTED: {
        const turnId = p.turn?.id ?? p.turnId;
        const threadId = p.threadId ?? p.thread?.id ?? this.activeThreadId ?? null;
        if (turnId) {
          this.lastTurnId = turnId;
          this.turnState.set(turnId, { threadId, text: "" });
        }
        break;
      }
      case NOTIFICATIONS.ITEM_STARTED: {
        const item = p.item;
        if (item?.type === "agentMessage" && item.id) {
          this.itemState.set(item.id, { text: "" });
        }
        break;
      }
      case NOTIFICATIONS.ITEM_AGENT_MESSAGE_DELTA: {
        const st = this.itemState.get(p.itemId);
        if (st && typeof p.delta === "string") st.text += p.delta;
        break;
      }
      case NOTIFICATIONS.ITEM_COMPLETED: {
        const item = p.item;
        if (item?.type === "agentMessage" && item.id) {
          const st = this.itemState.get(item.id);
          this.itemState.delete(item.id);
          let text = "";
          if (Array.isArray(item.content)) {
            text = item.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("");
          }
          if (!text && st) text = st.text;
          if (text && this.lastTurnId) {
            const cur = this.turnState.get(this.lastTurnId);
            if (cur) cur.text += cur.text ? `\n${text}` : text;
          }
        }
        break;
      }
      case NOTIFICATIONS.TURN_COMPLETED: {
        const turnId = p.turn?.id ?? p.turnId;
        const st = this.turnState.get(turnId);
        if (st) {
          this.turnState.delete(turnId);
          this.inbound.push({ threadId: st.threadId, turnId, text: st.text });
          this._wake();
        }
        break;
      }
      case NOTIFICATIONS.THREAD_CLOSED:
        break;
      default:
        break;
    }
  }

  _wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  async _rpc(method, params, timeoutMs = 30000) {
    const id = `dsh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.get(id).t = t;
      this._send(makeRequest(method, params, id));
    });
  }

  async initialize() {
    const result = await this._rpc(APP_SERVER_METHODS.INITIALIZE, {
      protocolVersion: 1,
      userAgent: USER_AGENT,
      clientInfo: { name: "dsh-agentbridge-adapter", version: "0.1.0" },
    }, 10000);
    this.initialized = true;
    this._send({ jsonrpc: "2.0", method: APP_SERVER_METHODS.INITIALIZED });
    return result;
  }

  /**
   * Send a message to the codex side; returns when the turn completes.
   * Real codex protocol: thread/start creates the thread, turn/start starts
   * the turn with the message payload (a thread without turn/start stays
   * idle — that is why a bare thread/start "never arrives").
   */
  async sendMessage(text, { threadId = null, timeoutMs = 180000 } = {}) {
    // 1) ensure an active thread
    let tid = threadId ?? this.activeThreadId ?? null;
    if (!tid) {
      const res = await this._rpc(APP_SERVER_METHODS.THREAD_START, { input: [] }, timeoutMs);
      tid = res?.thread?.id ?? res?.threadId ?? null;
      if (!tid) {
        throw new Error(`thread/start returned no thread id: ${JSON.stringify(res)}`);
      }
      this.activeThreadId = tid;
    }
    // 2) start the turn with the actual message
    await this._rpc(APP_SERVER_METHODS.TURN_START, { threadId: tid, input: textInput(text) }, timeoutMs);
    // 3) wait for a completed turn on this thread
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idx = this.inbound.findIndex((m) => m.threadId === tid);
      if (idx >= 0) return this.inbound.splice(idx, 1)[0];
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`thread ${tid} turn did not complete within ${timeoutMs}ms`);
  }

  /** Drain any completed turns without waiting. */
  drainInbound() {
    const out = this.inbound;
    this.inbound = [];
    return out;
  }
}
