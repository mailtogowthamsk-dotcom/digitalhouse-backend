#!/usr/bin/env bash
# On server: cd ~/public_html/digitalhouse/backend && bash start-production.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Stopping WRONG old PM2 apps (digitalhouse / digitalhouse-api)"
pm2 delete digitalhouse 2>/dev/null || true
pm2 delete digitalhouse-api 2>/dev/null || true

if [[ ! -f package.json ]]; then
  echo "ERROR: Run this from the backend folder (need package.json)."
  exit 1
fi

echo "==> Installing npm packages"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ ! -f node_modules/cors/package.json ]]; then
  echo "ERROR: node_modules/cors missing — npm install failed."
  exit 1
fi

echo "==> Building dist/server.js"
npm run build

if [[ ! -f dist/server.js ]]; then
  echo "ERROR: dist/server.js not found after build."
  exit 1
fi

echo "==> Starting PM2 with dist/server.js (NOT dist/app.js)"
pm2 start dist/server.js --name digitalhouse-api
pm2 save

echo "==> PM2 status"
pm2 describe digitalhouse-api | grep -E "script path|status|name"

echo "==> Health check"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" && echo

echo ""
echo "OK. Configure Apache proxy, then test HTTPS /api/health"
