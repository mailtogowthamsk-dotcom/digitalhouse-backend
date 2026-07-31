"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "..", "..", ".env")
});
const mysql = require("mysql2/promise");

function requireDbEnv() {
  const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter(
    (k) => !(process.env[k] || "").trim()
  );
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

async function createMigrationConnection(opts = {}) {
  requireDbEnv();
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    multipleStatements: opts.multipleStatements !== false,
    // DDL often cannot run inside a transaction on MySQL; keep autocommit.
    charset: "utf8mb4"
  });
}

module.exports = { createMigrationConnection, requireDbEnv };
