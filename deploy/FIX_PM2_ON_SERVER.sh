#!/usr/bin/env bash
# Run on server: cd ~/public_html/digitalhouse/backend && bash deploy/FIX_PM2_ON_SERVER.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Working directory: $(pwd)"

echo "=== 1) Stop broken PM2 processes ==="
pm2 delete digitalhouse 2>/dev/null || true
pm2 delete digitalhouse-api 2>/dev/null || true

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json missing. Upload the full backend folder, not only dist/."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example to .env and set DB_*, JWT_*, etc."
  exit 1
fi

echo "=== 2) Install dependencies (fixes MODULE_NOT_FOUND for cors, express, ...) ==="
bash deploy/npm-install-deps.sh

echo "=== 3) Build TypeScript ==="
npm run build

echo "=== 4) Verify entry + deps ==="
npm run verify:deploy

echo "=== 5) Start correct entry: dist/server.js (NOT dist/app.js) ==="
if [[ -f ecosystem.config.cjs ]]; then
  pm2 start ecosystem.config.cjs
else
  pm2 start dist/server.js --name digitalhouse-api
fi
pm2 save

echo "=== 6) Local health check ==="
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" && echo

echo ""
echo "Done. If curl works but HTTPS still 404, configure Apache:"
echo "  deploy/apache-digitalhouse-api.conf"
