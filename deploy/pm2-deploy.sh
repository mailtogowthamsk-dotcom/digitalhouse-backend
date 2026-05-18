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

echo "Installing dependencies..."
bash deploy/npm-install-deps.sh

echo "Building..."
npm run build

# Remove wrong/old PM2 apps (e.g. dist/app.js named "digitalhouse")
for OLD in digitalhouse digitalhouse-api; do
  if pm2 describe "$OLD" >/dev/null 2>&1; then
    echo "Deleting old PM2 process: $OLD"
    pm2 delete "$OLD" || true
  fi
done

npm run verify:deploy

echo "Starting PM2 (dist/server.js)..."
pm2 start ecosystem.config.cjs

pm2 save

echo ""
echo "Local health:"
curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" && echo || {
  echo "Health check failed — run: pm2 logs digitalhouse-api"
  exit 1
}

echo ""
echo "Next: configure Apache proxy (deploy/apache-digitalhouse-api.conf), then:"
echo '  curl -sS "https://www.infosensetechnologies.com/digitalhouse/backend/api/health"'
