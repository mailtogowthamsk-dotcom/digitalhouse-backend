#!/usr/bin/env bash
# Wrapper — prefers zero-dep Node script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export BASE_URL="${BASE_URL:-http://127.0.0.1:4000/api}"
export DURATION="${DURATION:-15}"
export CONNECTIONS="${CONNECTIONS:-40}"
exec node deploy/load-test.mjs
