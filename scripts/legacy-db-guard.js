#!/usr/bin/env node
"use strict";

/**
 * Gate for deprecated legacy DB scripts (db:run-*, fix-indexes, etc.).
 * Policy: docs/DATABASE_POLICY.md §3
 *
 * Allowed only when ALLOW_LEGACY_DB_SCRIPTS=1 and a ticket documents the reason.
 * Preferred path: npm run db:migrate
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function isLegacyAllowed() {
  return String(process.env.ALLOW_LEGACY_DB_SCRIPTS || "").trim() === "1";
}

function printRefuseAndExit() {
  console.error(`
[db] Legacy database script REFUSED.

These scripts are deprecated. Schema changes must use versioned migrations:

  npm run db:migrate
  npm run db:migrate:new -- <name>

Emergency override (document reason in a ticket + verify backup first):

  ALLOW_LEGACY_DB_SCRIPTS=1 npm run <script>

Policy: docs/DATABASE_POLICY.md
`.trim());
  process.exit(1);
}

function main() {
  const targetRel = process.argv[2];
  if (!targetRel) {
    console.error("[db] legacy-db-guard: missing script path argument");
    process.exit(1);
  }

  if (!isLegacyAllowed()) {
    printRefuseAndExit();
  }

  const targetAbs = path.resolve(__dirname, "..", targetRel);
  if (!fs.existsSync(targetAbs)) {
    console.error(`[db] legacy-db-guard: script not found: ${targetRel}`);
    process.exit(1);
  }

  console.warn(
    `[db] ALLOW_LEGACY_DB_SCRIPTS=1 — running deprecated script: ${targetRel}`
  );
  console.warn(
    "[db] Confirm ticket + backup verification before relying on this in shared environments."
  );

  const result = spawnSync(process.execPath, [targetAbs, ...process.argv.slice(3)], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    console.error("[db] legacy-db-guard failed to spawn:", result.error.message);
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

if (require.main === module) {
  main();
}

module.exports = { isLegacyAllowed };
