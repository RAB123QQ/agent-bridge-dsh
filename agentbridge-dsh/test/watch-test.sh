#!/usr/bin/env bash
# Regression coverage for rollout discovery used by `abg dsh --pair`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
THREAD_ID="019fff25-7ad5-7dd1-aaf5-3bd136a8db72"
ROLLOUT="$TMP/codex/sessions/2026/08/14/rollout-2026-08-14T15-21-14-$THREAD_ID.jsonl"
STATE="$TMP/state"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$(dirname "$ROLLOUT")"
printf '{"payload":{"role":"user","content":[{"text":"fixture"}]}}\n' > "$ROLLOUT"
mkdir -p "$STATE/pairs/test-pair"
printf '{"pairs":[{"name":"TST","pairId":"test-pair"}]}' > "$STATE/pairs/registry.json"
printf '{"threadId":"%s"}' "$THREAD_ID" > "$STATE/pairs/test-pair/current-thread.json"

ABG_STATE_DIR="$STATE" CODEX_HOME="$TMP/codex" bun -e '
  const { appendFileSync } = await import("node:fs");
  const { rolloutFile, watchPair, followStream } = await import(process.argv[1]);
  const [threadId, expected] = process.argv.slice(2);
  const found = rolloutFile(threadId);
  if (found !== expected) {
    throw new Error(`expected ${expected}, received ${found}`);
  }
  if (rolloutFile("missing-thread") !== null) {
    throw new Error("missing rollout must return null");
  }
  if (await watchPair("TST", { lines: 1 }) !== 0) {
    throw new Error("watchPair should print the latest line and succeed");
  }
  const received = [];
  const stop = followStream(expected, (text) => received.push(text), 10);
  await new Promise((resolve) => setTimeout(resolve, 40));
  appendFileSync(expected, `${JSON.stringify({
    payload: { role: "assistant", content: [{ text: "new message" }] },
  })}\n`);
  const deadline = Date.now() + 500;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stop();
  if (received.length !== 1 || received[0] !== "new message") {
    throw new Error(`tail must emit only appended text, received ${JSON.stringify(received)}`);
  }
' "$ROOT/lib/watch.js" "$THREAD_ID" "$ROLLOUT"

echo "watch rollout discovery OK"
