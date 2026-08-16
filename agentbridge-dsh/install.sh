#!/bin/sh
# install.sh — install the `abg dsh` shim so `abg dsh ...` routes to this adapter.
#
#   ./install.sh                 # install to ~/.bun/bin/abg (default)
#   ./install.sh /custom/bin/abg # install to a custom path
#
# The shim passes through every non-`dsh` command to the real abg on PATH,
# so agent-bridge's native commands keep working unchanged.
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ADAPTER="$SCRIPT_DIR/bin/abg-dsh"
DEST="${1:-$HOME/.bun/bin/abg}"

if [ ! -f "$ADAPTER" ]; then
  echo "error: $ADAPTER not found (run install.sh from the repo root)" >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found on PATH (abg-dsh is a bun script)" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$DEST")"
sed "s|__ADAPTER_PATH__|$ADAPTER|g" "$SCRIPT_DIR/install.sh.template" > "$DEST"
chmod +x "$DEST"

echo "installed shim: $DEST -> $ADAPTER"
echo "try: abg dsh --pair NAME   (or: abg --pair NAME dsh)"
