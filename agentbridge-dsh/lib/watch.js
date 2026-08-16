#!/usr/bin/env bun
// abg dsh watch — tail the claude<->codex conversation stream for a pair.
//
// The conversation lives in the codex rollout jsonl of the pair's current
// thread (the thread the agent-bridge daemon resumes). This reads it like the
// codex TUI does: extract user/assistant text and task events.
//
//   abg dsh watch --pair KF [--lines 10] [--follow] [--since "15:00"]

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = process.env.ABG_STATE_DIR ?? join(homedir(), ".local/state/agentbridge");
const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex");

export function pairState(pairName) {
  const registry = JSON.parse(readFileSync(join(STATE_DIR, "pairs/registry.json"), "utf8"));
  const p = registry.pairs.find((x) => x.name === pairName);
  if (!p) throw new Error(`pair ${pairName} not found in ${STATE_DIR}/pairs/registry.json`);
  return p;
}

export function currentThreadId(pairName) {
  const p = pairState(pairName);
  const f = join(STATE_DIR, `pairs/${p.pairId}/current-thread.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")).threadId ?? null;
}

export function rolloutFile(threadId) {
  const matches = new Bun.Glob(`sessions/**/rollout-*-${threadId}.jsonl`).scanSync(CODEX_HOME);
  for (const match of matches) return join(CODEX_HOME, match);
  return null;
}

/** Extract display text from one rollout line. */
export function lineText(line) {
  try {
    const rec = JSON.parse(line);
    const p = rec.payload ?? rec;
    if (typeof p === "string") return p;
    // response_item message
    if (Array.isArray(p.content)) {
      return p.content
        .filter((c) => typeof c.text === "string")
        .map((c) => c.text)
        .join("");
    }
    // event_msg task events
    if (typeof p.last_agent_message === "string") return `[task_complete] ${p.last_agent_message}`;
    if (typeof p.last_user_message === "string") return `[user] ${p.last_user_message}`;
    if (typeof p.text === "string") return p.text;
  } catch {}
  return null;
}

/** Incremental tail: call onLine(text, role) for every new line appended. */
export function followStream(file, onLine, intervalMs = 800) {
  // A live stream must not replay the whole persisted rollout on attachment.
  // Snapshot EOF first, then report only records appended after this call.
  let pos = statSync(file).size;
  const timer = setInterval(() => {
    try {
      const size = statSync(file).size;
      if (size < pos) pos = 0; // rotated
      if (size > pos) {
        const fd = openSync(file, "r");
        const buf = new Uint8Array(size - pos);
        readSync(fd, buf, 0, buf.length, pos);
        closeSync(fd);
        pos = size;
        const text = new TextDecoder().decode(buf);
        for (const l of text.split("\n").filter(Boolean)) {
          const role = roleOf(l);
          const t = lineText(l);
          if (t) onLine(t, role);
        }
      }
    } catch {}
  }, intervalMs);
  return () => clearInterval(timer);
}

export function roleOf(line) {
  try {
    const rec = JSON.parse(line);
    const p = rec.payload ?? rec;
    if (p.role === "user" || p.role === "assistant") return p.role;
    if (rec.type === "event_msg") return "event";
  } catch {}
  return "?";
}

export async function watchPair(pairName, { lines = 10, follow = false, since = null } = {}) {
  const threadId = currentThreadId(pairName);
  if (!threadId) {
    console.error(`[watch] pair ${pairName}: no current thread (daemon never attached a thread)`);
    return 1;
  }
  const file = rolloutFile(threadId);
  if (!file) {
    console.error(`[watch] pair ${pairName}: rollout file for thread ${threadId} not found under ${CODEX_HOME}/sessions`);
    return 1;
  }
  console.error(`[watch] ${pairName} -> ${file}`);

  const printLine = (l) => {
    const role = roleOf(l);
    const text = lineText(l);
    if (!text) return;
    const tag = role === "assistant" ? "codex" : role === "user" ? "user" : "event";
    console.log(`[${tag}] ${text.replace(/\n+/g, "\n         ")}`);
    console.log("");
  };

  let startLine = 0;
  if (!follow) {
    const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
    startLine = Math.max(0, all.length - lines);
    for (let i = startLine; i < all.length; i++) printLine(all[i]);
    return 0;
  }

  // follow: print last `lines`, then tail
  let pos = 0;
  if (since) {
    const sinceMs = Date.parse(since);
    const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const idx = all.findIndex((l) => {
      try {
        return Date.parse(JSON.parse(l).timestamp ?? 0) >= sinceMs;
      } catch {
        return false;
      }
    });
    startLine = idx >= 0 ? idx : Math.max(0, all.length - lines);
  } else {
    startLine = Math.max(0, readFileSync(file, "utf8").split("\n").filter(Boolean).length - lines);
  }

  const stat = await import("node:fs").then((fs) => fs.statSync(file));
  pos = stat.size;
  // print the last `lines` from the beginning
  const all = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (let i = Math.max(0, all.length - lines); i < all.length; i++) printLine(all[i]);

  console.error(`[watch] following ${file} (Ctrl-C to stop)`);
  const timer = setInterval(() => {
    try {
      const size = statSync(file).size;
      if (size < pos) pos = 0; // rotated
      if (size > pos) {
        const fd = openSync(file, "r");
        const buf = new Uint8Array(size - pos);
        readSync(fd, buf, 0, buf.length, pos);
        closeSync(fd);
        pos = size;
        const text = new TextDecoder().decode(buf);
        for (const l of text.split("\n").filter(Boolean)) printLine(l);
      }
    } catch {}
  }, 800);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });
  await new Promise(() => {});
  return 0;
}
