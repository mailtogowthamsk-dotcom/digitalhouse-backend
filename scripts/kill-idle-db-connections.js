/**
 * Kill idle MySQL connections for the app DB user (Sleep older than threshold).
 * Shared hosting often hits max_connections from leaked Node pools / restarts.
 *
 * Usage: node scripts/kill-idle-db-connections.js [minIdleSeconds=300]
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const minIdle = Math.max(60, Number(process.argv[2] || 300));

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 20000
  });

  const [rows] = await conn.query(
    `
    SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE
    FROM information_schema.PROCESSLIST
    WHERE USER = ?
      AND COMMAND = 'Sleep'
      AND TIME >= ?
      AND ID != CONNECTION_ID()
    ORDER BY TIME DESC
    `,
    [process.env.DB_USER, minIdle]
  );

  console.log(`Found ${rows.length} idle Sleep connection(s) ≥ ${minIdle}s`);
  let killed = 0;
  for (const row of rows) {
    try {
      await conn.query(`KILL ?`, [row.ID]);
      killed += 1;
      console.log(`  KILL ${row.ID} (${row.TIME}s idle, ${row.HOST})`);
    } catch (e) {
      console.warn(`  skip ${row.ID}: ${e.message}`);
    }
  }
  console.log(`Killed ${killed}/${rows.length}`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
