/**
 * Seed Master Data after schema migration.
 * Usage: node scripts/seed-master-data.cjs
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", esModuleInterop: true }
});

async function main() {
  const { sequelize } = require("../src/config/db");
  await sequelize.authenticate();
  const { masterDataService } = require("../src/services/MasterData.service");
  await masterDataService.seedMasterDataIfNeeded();
  console.log("Master data seed complete.");
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
