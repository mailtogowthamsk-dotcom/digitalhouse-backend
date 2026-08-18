"use strict";

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, ddl) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`  + ${table}.${column}`);
}

async function addIndex(conn, table, name, sql) {
  if (!(await tableExists(conn, table))) return;
  if (await indexExists(conn, table, name)) return;
  await conn.query(sql);
  console.log(`  + ${table}.${name}`);
}

async function up(conn) {
  if (await tableExists(conn, "posts")) {
    await addColumn(
      conn,
      "posts",
      "safety_decision",
      "safety_decision VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "posts",
      "safety_category",
      "safety_category VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "posts",
      "safety_confidence",
      "safety_confidence DECIMAL(6,5) NULL"
    );
    await addColumn(conn, "posts", "safety_model", "safety_model VARCHAR(64) NULL");
    await addColumn(
      conn,
      "posts",
      "safety_model_version",
      "safety_model_version VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "posts",
      "safety_policy_version",
      "safety_policy_version VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "posts",
      "media_version",
      "media_version INT UNSIGNED NOT NULL DEFAULT 1"
    );
    await addColumn(
      conn,
      "posts",
      "moderated_media_version",
      "moderated_media_version INT UNSIGNED NULL"
    );
    await addColumn(
      conn,
      "posts",
      "safety_failure_reason",
      "safety_failure_reason VARCHAR(255) NULL"
    );

    // Historical rows: do not block deploy on a full rescan. New writes default PENDING.
    await conn.query(`
      UPDATE posts
      SET safety_decision = 'SAFE',
          media_version = COALESCE(media_version, 1),
          moderated_media_version = COALESCE(moderated_media_version, media_version, 1)
      WHERE safety_decision IS NULL
    `);
    await conn.query(`
      ALTER TABLE posts
      MODIFY COLUMN safety_decision VARCHAR(32) NOT NULL DEFAULT 'PENDING'
    `);

    await addIndex(
      conn,
      "posts",
      "idx_posts_safety_moderation_created",
      "ALTER TABLE posts ADD KEY idx_posts_safety_moderation_created (safety_decision, moderation_status, createdAt)"
    );
  }

  if (await tableExists(conn, "media_files")) {
    await addColumn(
      conn,
      "media_files",
      "mediaVersion",
      "mediaVersion INT UNSIGNED NOT NULL DEFAULT 1"
    );
    await addColumn(
      conn,
      "media_files",
      "safetyDecision",
      "safetyDecision VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "media_files",
      "safetyCategory",
      "safetyCategory VARCHAR(32) NULL"
    );
    await addColumn(
      conn,
      "media_files",
      "perceptualHash",
      "perceptualHash CHAR(16) NULL"
    );
  }

  if (!(await tableExists(conn, "content_safety_scans"))) {
    await conn.query(`
      CREATE TABLE content_safety_scans (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        postId INT UNSIGNED NULL,
        mediaId INT UNSIGNED NULL,
        jobId INT UNSIGNED NULL,
        mediaVersion INT UNSIGNED NOT NULL DEFAULT 1,
        mediaType VARCHAR(16) NOT NULL,
        model VARCHAR(64) NOT NULL,
        modelVersion VARCHAR(32) NOT NULL,
        policyVersion VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        category VARCHAR(32) NOT NULL,
        confidence DECIMAL(6,5) NULL,
        decision VARCHAR(32) NOT NULL,
        failureReason VARCHAR(255) NULL,
        processingTimeMs INT UNSIGNED NULL,
        createdAt DATETIME NOT NULL,
        completedAt DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_css_post_version (postId, mediaVersion),
        KEY idx_css_media (mediaId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + content_safety_scans");
  }

  if (!(await tableExists(conn, "content_safety_fingerprints"))) {
    await conn.query(`
      CREATE TABLE content_safety_fingerprints (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        hash CHAR(16) NOT NULL,
        algorithm VARCHAR(32) NOT NULL,
        mediaType VARCHAR(16) NOT NULL,
        category VARCHAR(32) NOT NULL,
        decision VARCHAR(32) NOT NULL,
        postId INT UNSIGNED NULL,
        mediaId INT UNSIGNED NULL,
        createdAt DATETIME NOT NULL,
        PRIMARY KEY (id),
        KEY idx_csf_hash (hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + content_safety_fingerprints");
  }

  if (await tableExists(conn, "moderation_actions")) {
    const [rows] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moderation_actions' AND COLUMN_NAME = 'action'`
    );
    const colType = rows[0]?.COLUMN_TYPE || "";
    if (colType.includes("enum") && !colType.includes("SAFETY_ALLOW")) {
      await conn.query(`
        ALTER TABLE moderation_actions
        MODIFY COLUMN action ENUM(
          'WARN','SUSPEND','REACTIVATE','ESCALATE','RESOLVE','DISMISS',
          'HIDE_POST','RESTORE_POST','SOFT_DELETE_POST','HARD_DELETE_POST','EDIT_POST',
          'SAFETY_ALLOW','SAFETY_REJECT'
        ) NOT NULL
      `);
      console.log("  + moderation_actions.action SAFETY_ALLOW/SAFETY_REJECT");
    }
  }
}

async function down(conn) {
  if (await tableExists(conn, "content_safety_fingerprints")) {
    await conn.query("DROP TABLE content_safety_fingerprints");
  }
  if (await tableExists(conn, "content_safety_scans")) {
    await conn.query("DROP TABLE content_safety_scans");
  }
}

module.exports = { up, down };
