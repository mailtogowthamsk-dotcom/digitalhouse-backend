#!/usr/bin/env bash
# Run on server from backend root: ./deploy/pm2-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT — copy .env.example and configure DB/JWT/SMTP."
  exit 1
fi

mkdir -p logs

BACKUP_DIR="$(mktemp -d)"
HAD_DIST=0
HAD_API=0
HAD_WORKER=0
LEGACY_STOPPED=0
ACTIVATED=0

pm2_is_running() {
  local pid
  pid="$(pm2 pid "$1" 2>/dev/null || true)"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]]
}

if [[ -d dist ]]; then
  cp -a dist "$BACKUP_DIR/dist"
  HAD_DIST=1
fi
if pm2_is_running digitalhouse-api; then HAD_API=1; fi
if pm2_is_running digitalhouse-media-worker; then HAD_WORKER=1; fi

rollback_deployment() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed."
  if [[ "$ACTIVATED" -eq 1 ]]; then
    echo "Restoring previous application build..."
    if [[ "$HAD_DIST" -eq 1 ]]; then
      rm -rf dist
      cp -a "$BACKUP_DIR/dist" dist
    fi
    if [[ "$HAD_API" -eq 1 ]]; then
      pm2 restart digitalhouse-api --update-env || true
    else
      pm2 delete digitalhouse-api || true
    fi
    if [[ "$HAD_WORKER" -eq 1 ]]; then
      pm2 restart digitalhouse-media-worker --update-env || true
    else
      pm2 delete digitalhouse-media-worker || true
    fi
    if [[ "$LEGACY_STOPPED" -eq 1 && "$HAD_API" -eq 0 ]]; then
      pm2 restart digitalhouse || true
    fi
  else
    echo "PM2 services were not changed; the previous deployment remains online."
  fi
  rm -rf "$BACKUP_DIR"
  exit "$exit_code"
}
trap rollback_deployment ERR

echo "Installing dependencies..."
bash deploy/npm-install-deps.sh

echo "Building..."
npm run build

echo "Validating and applying backward-compatible migrations..."
npm run db:run-media-jobs-sql

npm run verify:deploy

if pm2_is_running digitalhouse; then
  echo "Stopping legacy PM2 process after successful migration..."
  pm2 stop digitalhouse
  LEGACY_STOPPED=1
fi

echo "Reloading PM2 API + media worker..."
ACTIVATED=1
pm2 startOrReload ecosystem.config.cjs --update-env

pm2 save

echo ""
echo "Local health:"
API_HEALTHY=0
for _ in {1..15}; do
  if curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health"; then
    echo
    API_HEALTHY=1
    break
  fi
  sleep 2
done
if [[ "$API_HEALTHY" -ne 1 ]] || ! pm2_is_running digitalhouse-media-worker; then
  echo "Health check failed — run: pm2 logs digitalhouse-api"
  exit 1
fi

if [[ "$LEGACY_STOPPED" -eq 1 ]]; then
  pm2 delete digitalhouse || true
fi
trap - ERR
rm -rf "$BACKUP_DIR"

echo ""
echo "Next: configure Apache proxy (deploy/apache-digitalhouse-api.conf), then:"
echo '  curl -sS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health"'
