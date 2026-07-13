/**
 * Idempotent jobs Phase 2 columns on posts.
 * Usage: npm run db:run-jobs-phase2-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["jobCompany", "VARCHAR(255) NULL"],
  ["jobLocation", "VARCHAR(255) NULL"],
  [
    "jobEmploymentType",
    "ENUM('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY') NULL"
  ],
  ["jobSalaryMin", "INT UNSIGNED NULL"],
  ["jobSalaryMax", "INT UNSIGNED NULL"]
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    for (const [name, def] of COLUMNS) {
      if (!(await columnExists(conn, "posts", name))) {
        await conn.query(`ALTER TABLE posts ADD COLUMN ${name} ${def}`);
        console.log(`Added posts.${name}`);
      } else {
        console.log(`Skip posts.${name} (exists)`);
      }
    }

    if (!(await indexExists(conn, "posts", "idx_posts_job_location"))) {
      await conn.query("CREATE INDEX idx_posts_job_location ON posts (jobLocation)");
      console.log("Created idx_posts_job_location");
    } else {
      console.log("Skip idx_posts_job_location (exists)");
    }

    if (!(await indexExists(conn, "posts", "idx_posts_job_employment"))) {
      await conn.query("CREATE INDEX idx_posts_job_employment ON posts (jobEmploymentType)");
      console.log("Created idx_posts_job_employment");
    } else {
      console.log("Skip idx_posts_job_employment (exists)");
    }

    console.log("Jobs Phase 2 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
