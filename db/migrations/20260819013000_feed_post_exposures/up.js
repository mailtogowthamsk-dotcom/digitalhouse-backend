"use strict";

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (await tableExists(conn, "feed_post_exposures")) return;

  await conn.query(`
    CREATE TABLE feed_post_exposures (
      userId INT UNSIGNED NOT NULL,
      postId INT UNSIGNED NOT NULL,
      impressionCount INT UNSIGNED NOT NULL DEFAULT 0,
      firstSeenAt DATETIME(3) NOT NULL,
      lastSeenAt DATETIME(3) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (userId, postId),
      KEY idx_feed_exposures_user_seen (userId, lastSeenAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("  + feed_post_exposures");
}

async function down(conn) {
  if (await tableExists(conn, "feed_post_exposures")) {
    await conn.query("DROP TABLE feed_post_exposures");
    console.log("  - feed_post_exposures");
  }
}

module.exports = { up, down };
