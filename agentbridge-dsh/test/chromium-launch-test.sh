#!/usr/bin/env bash
# Regression coverage for the DSH Chromium launch profile isolation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! rg -Fq 'startDetached(CHROMIUM_CMD, ["--incognito", `--app=${webUrl}`], "chromium")' "$ROOT/bin/abg-dsh"; then
  echo "FAIL: DSH Chromium must launch in incognito mode"
  exit 1
fi

echo "chromium launch isolation OK"
