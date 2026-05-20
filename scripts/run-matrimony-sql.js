#!/usr/bin/env node
/**
 * Run one or more matrimony SQL migration files against DB from .env
 * Usage: cd backend && node scripts/run-matrimony-sql.js migrations/matrimony-candidate-photos.sql
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: node scripts/run-matrimony-sql.js <file.sql> [...]");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "digital_house",
    multipleStatements: true
  });

  console.log(`Database: ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);

  for (const rel of files) {
    const filePath = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(filePath)) {
      console.error(`Not found: ${filePath}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(filePath, "utf8");
    console.log(`Running ${rel}...`);
    await conn.query(sql);
    console.log(`  ✓ done\n`);
  }

  await conn.end();
  console.log("All files applied.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
