/**
 * Legacy entry: npm run db:run-media-jobs-sql
 * Prefer npm run db:migrate (versioned) for deploys.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const { runMediaJobsMigration } = require("./lib/mediaJobsMigration");

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await runMediaJobsMigration(conn);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
