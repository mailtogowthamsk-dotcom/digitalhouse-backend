#!/usr/bin/env node
"use strict";

/**
 * Versioned MySQL migration CLI.
 *
 *   npm run db:migrate              # apply pending
 *   npm run db:migrate:status
 *   npm run db:migrate:down         # rollback last (needs down.sql/js)
 *   npm run db:migrate:down -- 2
 *   npm run db:migrate:baseline     # mark pending as applied (existing DBs)
 *   npm run db:migrate:validate     # schema expectations
 *   npm run db:migrate:new -- foo   # scaffold
 */
const { migrateUp, migrateDown, migrateBaseline, migrateStatus } = require("./runner");
const { validateSchema } = require("./validate");
const { createMigrationScaffold } = require("./discover");

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = (args[0] || "up").toLowerCase();
  const rest = args.slice(1);
  const flags = {};
  const positional = [];
  for (const a of rest) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv);

  switch (cmd) {
    case "up":
    case "migrate": {
      await migrateUp({ toVersion: flags.to || null });
      if (flags.validate !== false && flags["skip-validate"] !== true) {
        const result = await validateSchema();
        if (!result.ok) process.exit(1);
      }
      break;
    }
    case "down":
    case "rollback": {
      const steps = Number(positional[0] || flags.steps || 1);
      await migrateDown({ steps });
      break;
    }
    case "status": {
      await migrateStatus();
      break;
    }
    case "baseline": {
      await migrateBaseline({ untilVersion: flags.to || positional[0] || null });
      break;
    }
    case "validate": {
      const result = await validateSchema();
      if (!result.ok) process.exit(1);
      break;
    }
    case "new":
    case "create": {
      const dir = createMigrationScaffold(positional[0] || flags.name);
      console.log(`[migrate] created ${dir}`);
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      console.log(`Usage:
  node scripts/migrate/cli.js up [--to=VERSION] [--skip-validate]
  node scripts/migrate/cli.js down [steps]
  node scripts/migrate/cli.js status
  node scripts/migrate/cli.js baseline [--to=VERSION]
  node scripts/migrate/cli.js validate
  node scripts/migrate/cli.js new <snake_case_name>`);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  if (process.env.MIGRATE_DEBUG === "1" && err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
});
