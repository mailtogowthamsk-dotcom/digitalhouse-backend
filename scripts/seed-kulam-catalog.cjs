/**
 * Upsert Vettuvar kulams into master_data_items + kulams.
 * Usage: npm run db:seed-kulams
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
  const result = await masterDataService.ensureVettuvarKulamCatalog();
  console.log("Kulam catalog seed complete.", result);
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
