/**
 * Remove duplicate indexes created by repeated sequelize.sync({ alter: true }).
 * MySQL allows max 64 indexes per table (ER_TOO_MANY_KEYS).
 *
 * Usage: node scripts/fix-duplicate-indexes.js
 * Optional: node scripts/fix-duplicate-indexes.js users
 */

require("dotenv").config();
const mysql = require("mysql2/promise");

const tables = process.argv.slice(2).length ? process.argv.slice(2) : ["users"];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "digital_house"
  });

  for (const table of tables) {
    const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\``);
    if (!rows.length) {
      console.log(`Table ${table}: not found or no indexes`);
      continue;
    }

    /** column -> list of index names (non-primary) */
    const byColumn = new Map();
    for (const row of rows) {
      if (row.Key_name === "PRIMARY") continue;
      const col = row.Column_name;
      if (!byColumn.has(col)) byColumn.set(col, []);
      const list = byColumn.get(col);
      if (!list.includes(row.Key_name)) list.push(row.Key_name);
    }

    let dropped = 0;
    for (const [col, names] of byColumn) {
      if (names.length <= 1) continue;
      const keep = names[0];
      const remove = names.slice(1);
      console.log(`${table}.${col}: keep "${keep}", drop ${remove.length} duplicate(s)`);
      for (const indexName of remove) {
        await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
        dropped++;
      }
    }
    console.log(`Table ${table}: dropped ${dropped} duplicate index(es).`);
  }

  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
