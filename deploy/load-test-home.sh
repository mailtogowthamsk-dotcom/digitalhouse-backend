#!/usr/bin/env bash
# Home cold-start load probe (Phase 3K). Staging/local only.
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
export DURATION="${DURATION:-10}"
export CONNECTIONS="${CONNECTIONS:-5}"
export SCENARIO="${SCENARIO:-all}"
export LOAD_TEST_JWT="${LOAD_TEST_JWT:-${LOAD_TEST_MEMBER_TOKEN:-}}"

exec node deploy/load-test-home.mjs
