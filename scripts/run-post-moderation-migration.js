require("dotenv").config();
const mysql = require("mysql2/promise");

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column]
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
    const alters = [];
    if (!(await hasColumn(conn, "posts", "moderation_status"))) {
      alters.push("ADD COLUMN moderation_status ENUM('ACTIVE','HIDDEN','SOFT_DELETED') NOT NULL DEFAULT 'ACTIVE'");
    }
    if (!(await hasColumn(conn, "posts", "moderation_reason"))) {
      alters.push("ADD COLUMN moderation_reason TEXT NULL");
    }
    if (!(await hasColumn(conn, "posts", "moderation_notes"))) {
      alters.push("ADD COLUMN moderation_notes TEXT NULL");
    }
    if (!(await hasColumn(conn, "posts", "moderated_by"))) {
      alters.push("ADD COLUMN moderated_by VARCHAR(191) NULL");
    }
    if (!(await hasColumn(conn, "posts", "moderated_at"))) {
      alters.push("ADD COLUMN moderated_at DATETIME NULL");
    }
    if (!(await hasColumn(conn, "posts", "deleted_at"))) {
      alters.push("ADD COLUMN deleted_at DATETIME NULL");
    }
    if (alters.length) {
      await conn.query(`ALTER TABLE posts ${alters.join(", ")}`);
    }

    await conn.query(
      "CREATE INDEX idx_posts_moderation_created ON posts (moderation_status, createdAt)"
    ).catch(() => {});

    if (!(await hasColumn(conn, "moderation_actions", "post_id"))) {
      await conn.query("ALTER TABLE moderation_actions ADD COLUMN post_id INT UNSIGNED NULL AFTER target_user_id");
      await conn.query("CREATE INDEX idx_moderation_actions_post_id ON moderation_actions (post_id)").catch(() => {});
    }

    await conn.query(`
      ALTER TABLE moderation_actions
      MODIFY COLUMN action ENUM(
        'WARN','SUSPEND','REACTIVATE','ESCALATE','RESOLVE','DISMISS',
        'HIDE_POST','RESTORE_POST','SOFT_DELETE_POST','HARD_DELETE_POST','EDIT_POST'
      ) NOT NULL
    `);

    console.log("Post moderation migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
