#!/usr/bin/env bash
# Install backend dependencies (ci when lockfile present, else install).
#
# Always include devDependencies: server deploy runs `tsc` (typescript is a
# devDependency). With NODE_ENV=production, plain `npm ci` omits them → tsc: not found.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found in $(pwd)"
  exit 1
fi

# Force-include devDeps even if the shell/PM2 has NODE_ENV=production.
export NPM_CONFIG_PRODUCTION=false

if [[ -f package-lock.json ]]; then
  echo "Using npm ci --include=dev (package-lock.json found)..."
  npm ci --include=dev
else
  echo "WARNING: package-lock.json missing — using npm install --include=dev."
  echo "Upload package-lock.json from your dev machine for reproducible installs."
  npm install --include=dev
fi
