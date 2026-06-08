/**
 * Apply notifications platform schema (idempotent, MySQL 5.7+ / MariaDB).
 * Usage: npm run db:run-notifications-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME;

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [DB, table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [DB, table, indexName]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [DB, table]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) {
    console.log(`Skip column ${table}.${column} (exists)`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`Added column ${table}.${column}`);
}

async function addIndex(conn, table, indexName, ddl) {
  if (await indexExists(conn, table, indexName)) {
    console.log(`Skip index ${indexName} (exists)`);
    return;
  }
  await conn.query(ddl);
  console.log(`Added index ${indexName}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB
  });

  console.log(`Applying notification platform migration on database "${DB}"…`);

  if (!(await tableExists(conn, "notifications"))) {
    throw new Error('Table "notifications" not found. Create base schema first.');
  }

  // Legacy Sequelize uses camelCase on notifications
  const userCol = (await columnExists(conn, "notifications", "userId"))
    ? "userId"
    : "user_id";
  const readCol = (await columnExists(conn, "notifications", "readAt"))
    ? "readAt"
    : "read_at";

  await addColumn(
    conn,
    "notifications",
    "type",
    `type VARCHAR(64) NOT NULL DEFAULT 'SYSTEM_GENERIC' AFTER \`${userCol}\``
  );
  await addColumn(
    conn,
    "notifications",
    "category",
    "category VARCHAR(32) NOT NULL DEFAULT 'SYSTEM' AFTER type"
  );
  await addColumn(
    conn,
    "notifications",
    "image_url",
    "image_url VARCHAR(512) NULL AFTER body"
  );
  await addColumn(
    conn,
    "notifications",
    "action_type",
    "action_type VARCHAR(64) NULL AFTER image_url"
  );
  await addColumn(
    conn,
    "notifications",
    "action_target_id",
    "action_target_id VARCHAR(64) NULL AFTER action_type"
  );
  await addColumn(
    conn,
    "notifications",
    "actor_user_id",
    "actor_user_id INT UNSIGNED NULL AFTER action_target_id"
  );
  await addColumn(
    conn,
    "notifications",
    "group_key",
    "group_key VARCHAR(128) NULL AFTER actor_user_id"
  );
  await addColumn(
    conn,
    "notifications",
    "group_count",
    "group_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER group_key"
  );
  await addColumn(
    conn,
    "notifications",
    "priority",
    "priority TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER group_count"
  );
  await addColumn(
    conn,
    "notifications",
    "metadata",
    "metadata JSON NULL AFTER priority"
  );
  await addColumn(
    conn,
    "notifications",
    "deleted_at",
    `deleted_at DATETIME NULL AFTER \`${readCol}\``
  );

  await addIndex(
    conn,
    "notifications",
    "idx_notifications_user_created",
    `CREATE INDEX idx_notifications_user_created ON notifications (\`${userCol}\`, createdAt DESC)`
  );
  await addIndex(
    conn,
    "notifications",
    "idx_notifications_user_unread",
    `CREATE INDEX idx_notifications_user_unread ON notifications (\`${userCol}\`, \`${readCol}\`, deleted_at)`
  );
  await addIndex(
    conn,
    "notifications",
    "idx_notifications_group_key",
    `CREATE INDEX idx_notifications_group_key ON notifications (\`${userCol}\`, group_key, \`${readCol}\`)`
  );

  if (!(await tableExists(conn, "notification_preferences"))) {
    await conn.query(`
      CREATE TABLE notification_preferences (
        user_id INT UNSIGNED NOT NULL PRIMARY KEY,
        social_enabled TINYINT(1) NOT NULL DEFAULT 1,
        matrimony_enabled TINYINT(1) NOT NULL DEFAULT 1,
        messages_enabled TINYINT(1) NOT NULL DEFAULT 1,
        community_enabled TINYINT(1) NOT NULL DEFAULT 1,
        system_enabled TINYINT(1) NOT NULL DEFAULT 1,
        push_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Created table notification_preferences");
  } else {
    console.log("Skip table notification_preferences (exists)");
  }

  if (!(await tableExists(conn, "push_device_tokens"))) {
    await conn.query(`
      CREATE TABLE push_device_tokens (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        token VARCHAR(512) NOT NULL,
        platform ENUM('ios','android','web') NOT NULL DEFAULT 'android',
        device_id VARCHAR(128) NULL,
        app_version VARCHAR(32) NULL,
        last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_push_user_token (user_id, token),
        KEY idx_push_user (user_id),
        CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Created table push_device_tokens");
  } else {
    console.log("Skip table push_device_tokens (exists)");
  }

  await conn.end();
  console.log("Notification platform migration complete.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
