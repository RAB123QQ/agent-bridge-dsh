// Codex app-server JSON-RPC protocol constants + helpers.
// This is the same wire protocol the OpenAI Codex CLI app-server speaks:
//   client -> server : initialize, initialized, thread/start, thread/resume, turn/start
//   server -> client : notifications turn/started, item/started,
//                      item/agentMessage/delta, item/completed, turn/completed,
//                      thread/closed; requests item/*/requestApproval
// agent-bridge (raysonmeng) proxies these frames raw between its proxy port
// (4501) and the app-server, and wraps them typed on its control port (4502)
// for the Claude plugin. DSH can take either seat.

export const APP_SERVER_METHODS = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_CANCEL: "thread/cancel",
  TURN_START: "turn/start",
};

export const NOTIFICATIONS = {
  TURN_STARTED: "turn/started",
  TURN_COMPLETED: "turn/completed",
  ITEM_STARTED: "item/started",
  ITEM_AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  ITEM_COMPLETED: "item/completed",
  THREAD_CLOSED: "thread/closed",
};

export const SERVER_REQUESTS = new Set([
  "item/permissions/requestApproval",
  "item/fileChange/requestApproval",
  "item/commandExecution/requestApproval",
]);

export const USER_AGENT = "dsh-agentbridge-adapter/0.1.0";

let _seq = 0;
export function nextId(prefix = "dsh") {
  _seq += 1;
  return `${prefix}-${Date.now()}-${_seq}`;
}

export function makeRequest(method, params, id = nextId()) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

export function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function makeNotification(method, params) {
  return { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
}

export function isNotification(msg) {
  return msg && typeof msg === "object" && msg.method !== undefined && msg.id === undefined;
}

export function isRequest(msg) {
  return msg && typeof msg === "object" && typeof msg.method === "string" && msg.id !== undefined;
}

export function isResponse(msg) {
  return msg && typeof msg === "object" && msg.id !== undefined && msg.method === undefined;
}

export function parseFrame(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Extract the first text block from a codex content array (input or delta).
export function firstText(content) {
  if (!Array.isArray(content)) return "";
  for (const item of content) {
    if (item && item.type === "text" && typeof item.text === "string") return item.text;
  }
  return "";
}

export function textInput(text) {
  return [{ type: "text", text }];
}

// Default pair ports. The live pair on this machine uses 4500/4501/4502;
// the isolated DSH test pair uses 4510/4511/4512.
export function pairPorts(env = process.env) {
  return {
    appPort: parseInt(env.ABG_APP_PORT ?? env.CODEX_WS_PORT ?? "4510", 10),
    proxyPort: parseInt(env.ABG_PROXY_PORT ?? env.CODEX_PROXY_PORT ?? "4511", 10),
    controlPort: parseInt(env.ABG_CONTROL_PORT ?? env.AGENTBRIDGE_CONTROL_PORT ?? "4512", 10),
  };
}
