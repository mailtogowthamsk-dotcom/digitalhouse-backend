/**
 * Versioned migration: media jobs queue.
 * Idempotent — safe on DBs that already ran the legacy script.
 */
const { runMediaJobsMigration } = require("../../../scripts/lib/mediaJobsMigration");

async function up(conn) {
  await runMediaJobsMigration(conn);
}

async function down(_conn) {
  throw new Error(
    "media_jobs_queue has no safe automatic rollback (would drop queue data). Restore from backup if required."
  );
}

module.exports = { up, down };
