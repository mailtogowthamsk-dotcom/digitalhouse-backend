/**
 * Legal documents tables (idempotent).
 * Usage: npm run db:run-legal-documents-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME;

async function main() {
  if (!DB) throw new Error("DB_NAME missing in .env");

  const sqlPath = path.join(__dirname, "..", "migrations", "legal-documents.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB,
    multipleStatements: true
  });

  console.log(`Applying legal documents migration on "${DB}"…`);
  await conn.query(sql);
  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
