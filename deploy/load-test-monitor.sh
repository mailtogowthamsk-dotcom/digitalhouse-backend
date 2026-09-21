#!/usr/bin/env bash
# Realtime MySQL + PM2 watch during load test. Credentials from backend/.env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HOST="${DB_HOST:-127.0.0.1}"
PORT="${DB_PORT:-3306}"
USER="${DB_USER:?DB_USER missing in .env}"
PASS="${DB_PASSWORD:?DB_PASSWORD missing in .env}"
NAME="${DB_NAME:-}"

echo "Watching MySQL ${USER}@${HOST}:${PORT} (password from .env, not printed)"
echo "Ctrl+C to stop"
echo ""

export MYSQL_PWD="$PASS"
watch -n 1 "pm2 status; echo; mysql -h${HOST} -P${PORT} -u${USER} ${NAME} -N -e \"SHOW STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Questions');\""
