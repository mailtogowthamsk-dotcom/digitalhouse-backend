#!/usr/bin/env bash
# Run all deprecated legacy DB schema scripts (idempotent where possible).
#
# Prefer first (versioned, deploy-safe):
#   npm run db:migrate
# especially migration 20260912123000_schema_catchup_incomplete_db
# which adds missing posts/users/media/safety/platform columns & tables.
#
# Use this script only if migrate alone is still not enough on a very old dump.
#
# Usage (from backend/):
#   ALLOW_LEGACY_DB_SCRIPTS=1 bash scripts/run-all-legacy-db-scripts.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${ALLOW_LEGACY_DB_SCRIPTS:-}" != "1" ]]; then
  echo "Set ALLOW_LEGACY_DB_SCRIPTS=1 to run this (see docs/DATABASE_POLICY.md)."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT"
  exit 1
fi

SCRIPTS=(
  # Core / auth / users
  db:run-auth-google-sql
  db:run-registration-status-sql
  db:run-user-soft-delete-sql
  db:run-admin-users-sql
  db:run-legal-documents-sql

  # Master data + options
  db:run-master-data-phase1-sql

  # Media / posts / feed
  db:run-media-jobs-sql
  db:run-post-moderation-sql
  db:run-post-visibility-sql
  db:run-explore-hashtags-sql
  db:run-reports-phase1-sql

  # Notifications / platform
  db:run-notifications-sql
  db:run-platform-management-sql
  db:run-platform-business-settings-sql
  db:run-system-scheduler-sql
  db:run-prominent-people-sql
  db:run-production-hardening-sql

  # Matrimony
  db:run-matrimony-sql
  db:run-matrimony-razorpay-sql
  db:run-matrimony-subscription-p1-sql
  db:run-matrimony-lifecycle-sql

  # Jobs
  db:run-jobs-phase2-sql
  db:run-jobs-phase3-sql
  db:run-jobs-recruitment-phase4-sql

  # Marketplace
  db:run-marketplace-phase1-sql
  db:run-marketplace-phase3-sql
  db:run-marketplace-polish-sql

  # Helping hands
  db:run-helping-hands-phase1-sql
  db:run-helping-hands-lifecycle-sql

  # Indexes last
  db:run-optimization-indexes
)

FAILED=()
OK=0

echo "=== Running ${#SCRIPTS[@]} legacy DB scripts ==="
for name in "${SCRIPTS[@]}"; do
  echo ""
  echo ">>> $name"
  if ALLOW_LEGACY_DB_SCRIPTS=1 npm run "$name"; then
    OK=$((OK + 1))
  else
    echo "!!! FAILED: $name (continuing)"
    FAILED+=("$name")
  fi
done

echo ""
echo "=== Seeds ==="
npm run db:seed-master-data || FAILED+=("db:seed-master-data")
npm run db:seed-kulams || true

echo ""
echo "=== Versioned migrations ==="
npm run db:migrate || FAILED+=("db:migrate")

echo ""
echo "=== Done: $OK scripts ok, ${#FAILED[@]} failed ==="
if ((${#FAILED[@]} > 0)); then
  printf 'Failed:\n'
  printf '  - %s\n' "${FAILED[@]}"
  exit 1
fi

echo "Next: pm2 restart digitalhouse-api digitalhouse-media-worker digitalhouse-scheduler --update-env"
exit 0
