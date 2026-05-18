#!/usr/bin/env bash
# Install backend dependencies (ci when lockfile present, else install).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found in $(pwd)"
  exit 1
fi

if [[ -f package-lock.json ]]; then
  echo "Using npm ci (package-lock.json found)..."
  npm ci
else
  echo "WARNING: package-lock.json missing — using npm install."
  echo "Upload package-lock.json from your dev machine for reproducible installs."
  npm install
fi
