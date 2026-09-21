#!/usr/bin/env bash
# Load-test wrapper — loads backend/.env then runs Node probe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export BASE_URL="${BASE_URL:-http://127.0.0.1:4000/api}"
export DURATION="${DURATION:-15}"
export CONNECTIONS="${CONNECTIONS:-40}"
# Optional overrides; otherwise load-test.mjs reads ADMIN_EMAILS + ADMIN_PASSWORD from env
export LOAD_TEST_EMAIL="${LOAD_TEST_EMAIL:-}"
export LOAD_TEST_PASSWORD="${LOAD_TEST_PASSWORD:-}"

exec node deploy/load-test.mjs
