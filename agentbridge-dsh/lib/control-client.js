// Typed control-channel client: DSH takes the "Claude side" seat of a pair,
// so messages flow into the SAME codex thread the TUI shows (unlike the
// secondary pipe, which creates separate threads the TUI never displays).
//
// Protocol (from agent-bridge daemon.js, verified against v0.1.30):
//   -> {type:"claude_connect", identity:{pairId, pairName, cwd, stateDir,
//        clientPid, contractVersion, controlToken}}
//   <- {type:"status", status}            (attach success signal)
//   -> {type:"claude_to_codex", requestId, message:{content, source:"claude"},
//        onBusy, requireReply?}
//   <- {type:"claude_to_codex_result", requestId, success, code?, error?,
//        retryAfterMs?, phase}
//   <- {type:"codex_to_claude", message:{id, source:"codex", content, timestamp}}
//   <- {type:"turn_started", ...} | {type:"incumbent_status",...} | {type:"budget_refresh",...}

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = process.env.ABG_STATE_DIR ?? join(homedir(), ".local/state/agentbridge");

export function identityForPair(pairName) {
  const registry = JSON.parse(readFileSync(join(STATE_DIR, "pairs/registry.json"), "utf8"));
  const pair = registry.pairs.find((p) => p.name === pairName);
  if (!pair) throw new Error(`pair ${pairName} not found`);
  const stateDir = join(STATE_DIR, `pairs/${pair.pairId}`);
  const tokenPath = join(stateDir, "control-token");
  if (!existsSync(tokenPath)) throw new Error(`no control-token for pair ${pairName} (${tokenPath})`);
  const daemon = JSON.parse(readFileSync(join(stateDir, "daemon.json"), "utf8"));
  return {
    pairId: pair.pairId,
    pairName: pair.name,
    cwd: daemon.cwd,
    stateDir,
    clientPid: process.pid,
    contractVersion: 1,
    controlToken: readFileSync(tokenPath, "utf8").trim(),
  };
}

export class ControlClient {
  constructor({ controlPort, identity, log = console.error } = {}) {
    this.url = `ws://127.0.0.1:${controlPort}/ws`;
    this.identity = identity;
    this.log = log;
    this.ws = null;
    this.attached = false;
    this.status = null;
    this.inbound = []; // codex reply messages {id, content, timestamp}
    this.pending = new Map(); // requestId -> {resolve, reject, t, replied}
    this._seq = 0;
    this._onStatusOnce = null;
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
        reject(new Error(`ws error: ${e?.message ?? e}`));
      };
    });
    this.ws.onmessage = (event) => this._onFrame(event.data);
    this.ws.onclose = () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.t);
        p.reject(new Error("control connection closed"));
      }
      this.pending.clear();
    };
    return this;
  }

  _send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("control socket not open");
    this.ws.send(JSON.stringify(msg));
  }

  /** Take the attach seat; resolves with the daemon status. */
  attach(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this._onStatusOnce = null;
        reject(new Error("attach timeout: no status from daemon"));
      }, timeoutMs);
      this._onStatusOnce = (status) => {
        clearTimeout(t);
        this.attached = true;
        this.status = status;
        resolve(status);
      };
      this._send({ type: "claude_connect", identity: this.identity });
    });
  }

  /**
   * Inject a message into the pair's codex thread. Resolves with the codex
   * reply text (first non-system codex_to_claude after transport accept).
   * Handles busy_reject with retryAfterMs backoff.
   */
  async sendMessage(text, { onBusy = "wait", requireReply = false, timeoutMs = 240000, maxBusyRetries = 6 } = {}) {
    const requestId = `dsh-${Date.now()}-${++this._seq}`;
    const reply = new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        replied: false,
        t: null,
      };
      this.pending.set(requestId, entry);
      entry.t = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`no codex reply within ${timeoutMs}ms`));
      }, timeoutMs);
    });
    this._send({
      type: "claude_to_codex",
      requestId,
      message: { content: text, source: "claude" },
      onBusy,
      ...(requireReply ? { requireReply: true } : {}),
    });

    for (let attempt = 0; attempt <= maxBusyRetries; attempt++) {
      try {
        return await reply;
      } catch (e) {
        const busy = this._lastBusyRetry;
        this._lastBusyRetry = null;
        if (busy && attempt < maxBusyRetries) {
          this.log(`codex busy, retrying in ${busy}ms (${attempt + 1}/${maxBusyRetries})`);
          await new Promise((r) => setTimeout(r, busy));
          continue;
        }
        throw e;
      }
    }
    throw new Error("unreachable");
  }

  _onFrame(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.type) {
      case "status":
        this.status = m.status;
        if (this._onStatusOnce) {
          const cb = this._onStatusOnce;
          this._onStatusOnce = null;
          cb(m.status);
        }
        break;
      case "claude_to_codex_result": {
        const p = this.pending.get(m.requestId);
        if (p) {
          if (!m.success) {
            clearTimeout(p.t);
            this.pending.delete(m.requestId);
            if (m.code === "busy_reject" && typeof m.retryAfterMs === "number") {
              this._lastBusyRetry = m.retryAfterMs;
              p.reject(new Error(`busy: ${m.error}`));
            } else {
              p.reject(new Error(`${m.code ?? "error"}: ${m.error ?? "injection failed"}`));
            }
          }
          // success = transport accepted; the actual reply comes as
          // codex_to_claude below.
        }
        break;
      }
      case "codex_to_claude": {
        const msg = m.message ?? {};
        if (typeof msg.content === "string" && !String(msg.id ?? "").startsWith("system_")) {
          // codex agent reply — resolve the oldest pending request
          const first = this.pending.keys().next();
          if (!first.done) {
            const rid = first.value;
            const p = this.pending.get(rid);
            if (p) {
              clearTimeout(p.t);
              this.pending.delete(rid);
              p.resolve(msg.content);
            }
          }
          this.inbound.push(msg);
        } else {
          this.inbound.push(msg); // system messages visible to consumers too
        }
        // push hook: notify the DSH side immediately so the agent is woken
        // up by codex replies instead of relying on get_messages polling.
        if (typeof this.onCodexMessage === "function") {
          try { this.onCodexMessage(msg); } catch (e) { this.log?.(`onCodexMessage hook failed: ${e?.message ?? e}`); }
        }
        break;
      }
      case "turn_started":
      case "incumbent_status":
      case "budget_refresh":
        break;
      default:
        break;
    }
  }
}
