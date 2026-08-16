#!/usr/bin/env bash
# Full-loop test: DSH channel client <-> test agent-bridge daemon <-> DSH
# app-server (spawned by the daemon via the `codex` PATH stub).
#
# The test pair is fully isolated (ports 4510/4511/4512, state in /tmp), so
# the live pair (4500/4501/4502) is never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABG="/home/visualeaf/.nvm/versions/node/v22.23.1/lib/node_modules/@raysonmeng/agentbridge"
STUB_DIR="$ROOT/test/bin-stub"
STATE_DIR="/tmp/abg-dsh-test"
APP_PORT=4510
PROXY_PORT=4511
CTRL_PORT=4512
MCP_PORT=8765

cleanup() {
  [ -n "${DAEMON_PID:-}" ] && kill "$DAEMON_PID" 2>/dev/null || true
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true
  if [ "${KEEP_STATE:-0}" = "1" ]; then
    echo "state kept at $STATE_DIR"
  else
    rm -rf "$STATE_DIR"
  fi
}
trap cleanup EXIT

echo "== 1. codex stub =="
mkdir -p "$STUB_DIR"
cat > "$STUB_DIR/codex" <<EOF
#!/usr/bin/env bun
import { codexStubMain } from "$ROOT/lib/app-server.js";
const code = codexStubMain(process.argv);
if (typeof code === "number") process.exit(code);
// null = app-server mode: keep the process alive
EOF
chmod +x "$STUB_DIR/codex"
echo "stub at $STUB_DIR/codex"

echo "== 2. start isolated test daemon =="
rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"
PATH="$STUB_DIR:$PATH" \
  CODEX_WS_PORT=$APP_PORT \
  CODEX_PROXY_PORT=$PROXY_PORT \
  AGENTBRIDGE_CONTROL_PORT=$CTRL_PORT \
  AGENTBRIDGE_STATE_DIR="$STATE_DIR" \
  AGENTBRIDGE_PAIR_ID="dsh-test" \
  AGENTBRIDGE_IDLE_SHUTDOWN_MS=600000 \
  AGENTBRIDGE_CODEX_TRANSPORT=ws \
  bun run "$ABG/dist/daemon.js" > "$STATE_DIR/daemon.log" 2>&1 &
DAEMON_PID=$!
echo "daemon pid $DAEMON_PID (log: $STATE_DIR/daemon.log)"

echo "== 3. wait for daemon + mock app-server =="
for i in $(seq 1 40); do
  if curl -sf -m 1 "http://127.0.0.1:$CTRL_PORT/readyz" >/dev/null 2>&1; then
    echo "daemon ready (attempt $i)"
    break
  fi
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "FAIL: daemon died"; tail -30 "$STATE_DIR/daemon.log"; exit 1
  fi
  sleep 0.5
done
curl -sf -m 2 "http://127.0.0.1:$APP_PORT/healthz" >/dev/null && echo "mock app-server healthy"
curl -sf -m 2 "http://127.0.0.1:$PROXY_PORT/" >/dev/null && echo "proxy up"

echo "== 4. Role A: DSH channel client -> daemon -> mock app-server =="
OUT="$("$ROOT/bin/abg-dsh" channel --proxy-port $PROXY_PORT --send "ping from DSH" --timeout-ms 30000 2>"$STATE_DIR/channel.log")"
echo "channel output: $OUT"
echo "$OUT" | grep -q '"ok":true' || { echo "FAIL: no ok in channel output"; tail -30 "$STATE_DIR/channel.log"; exit 1; }
echo "$OUT" | grep -qi "pong from dsh mock" || { echo "FAIL: mock pong missing"; tail -30 "$STATE_DIR/channel.log"; exit 1; }
echo "ROLE A LOOP OK"

echo "== 5. MCP layer (streamable-http) =="
"$ROOT/bin/abg-dsh" mcp --mode channel --proxy-port $PROXY_PORT --http-port $MCP_PORT > "$STATE_DIR/mcp.log" 2>&1 &
MCP_PID=$!
for i in $(seq 1 20); do
  curl -sf -m 1 "http://127.0.0.1:$MCP_PORT/mcp" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' >/dev/null 2>&1 && break
  sleep 0.3
done
echo "-- tools/list"
curl -s -m 5 "http://127.0.0.1:$MCP_PORT/mcp" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | head -c 500
echo
echo "-- tools/call send_message"
curl -s -m 60 "http://127.0.0.1:$MCP_PORT/mcp" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_message","arguments":{"text":"ping via MCP","timeoutMs":30000}}}' | head -c 500
echo
echo "MCP LAYER OK"

echo "== 6. daemon log tail (diagnostics) =="
tail -12 "$STATE_DIR/daemon.log"
echo "ALL TESTS PASSED"
