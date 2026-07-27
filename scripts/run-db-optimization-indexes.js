/**
 * Database optimization — add missing indexes/FKs (idempotent).
 *
 * Addresses DATABASE_AUDIT.md Critical findings:
 * - Matrimony tables were PRIMARY KEY only (no secondary indexes / FKs)
 * - Duplicate users.email index
 * - Sparse indexes on engagement / audit / analytics tables
 *
 * Usage: npm run db:run-optimization-indexes
 *
 * Safe to re-run. Does NOT drop data. Skips FKs when orphans exist.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function fkExists(conn, table, constraintName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    [table, constraintName]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addIndex(conn, table, indexName, ddl) {
  if (!(await tableExists(conn, table))) {
    console.log(`skip ${indexName} (no table ${table})`);
    return;
  }
  if (await indexExists(conn, table, indexName)) {
    console.log(`exists ${indexName}`);
    return;
  }
  try {
    await conn.query(ddl);
    console.log(`added ${indexName}`);
  } catch (e) {
    console.warn(`failed ${indexName}:`, e.message);
  }
}

async function dropIndex(conn, table, indexName) {
  if (!(await tableExists(conn, table))) return;
  if (!(await indexExists(conn, table, indexName))) {
    console.log(`drop skip ${indexName} (missing)`);
    return;
  }
  try {
    await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
    console.log(`dropped ${indexName}`);
  } catch (e) {
    console.warn(`drop failed ${indexName}:`, e.message);
  }
}

async function countOrphans(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return Number(rows[0]?.c ?? 0);
}

async function addFk(conn, table, constraintName, ddl, orphanSql) {
  if (!(await tableExists(conn, table))) {
    console.log(`skip FK ${constraintName} (no table ${table})`);
    return;
  }
  if (await fkExists(conn, table, constraintName)) {
    console.log(`exists FK ${constraintName}`);
    return;
  }
  if (orphanSql) {
    const orphans = await countOrphans(conn, orphanSql);
    if (orphans > 0) {
      console.warn(`skip FK ${constraintName}: ${orphans} orphan row(s)`);
      return;
    }
  }
  try {
    await conn.query(ddl);
    console.log(`added FK ${constraintName}`);
  } catch (e) {
    console.warn(`failed FK ${constraintName}:`, e.message);
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log(`DB optimization indexes → ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);

  try {
    // --- Matrimony interests ---
    await addIndex(
      conn,
      "matrimony_interests",
      "uq_matrimony_interest_pair",
      `ALTER TABLE matrimony_interests ADD UNIQUE KEY uq_matrimony_interest_pair (from_user_id, to_user_id)`
    );
    await addIndex(
      conn,
      "matrimony_interests",
      "idx_interest_to_status",
      `ALTER TABLE matrimony_interests ADD KEY idx_interest_to_status (to_user_id, status)`
    );
    await addIndex(
      conn,
      "matrimony_interests",
      "idx_interest_from_status",
      `ALTER TABLE matrimony_interests ADD KEY idx_interest_from_status (from_user_id, status)`
    );
    await addFk(
      conn,
      "matrimony_interests",
      "fk_matrimony_interest_from",
      `ALTER TABLE matrimony_interests ADD CONSTRAINT fk_matrimony_interest_from
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_interests i
       LEFT JOIN users u ON u.id = i.from_user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_interests",
      "fk_matrimony_interest_to",
      `ALTER TABLE matrimony_interests ADD CONSTRAINT fk_matrimony_interest_to
        FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_interests i
       LEFT JOIN users u ON u.id = i.to_user_id WHERE u.id IS NULL`
    );

    // --- Matrimony matches ---
    await addIndex(
      conn,
      "matrimony_matches",
      "uq_matrimony_match_pair",
      `ALTER TABLE matrimony_matches ADD UNIQUE KEY uq_matrimony_match_pair (user_low_id, user_high_id)`
    );
    await addIndex(
      conn,
      "matrimony_matches",
      "idx_match_user_low",
      `ALTER TABLE matrimony_matches ADD KEY idx_match_user_low (user_low_id, status)`
    );
    await addIndex(
      conn,
      "matrimony_matches",
      "idx_match_user_high",
      `ALTER TABLE matrimony_matches ADD KEY idx_match_user_high (user_high_id, status)`
    );
    await addFk(
      conn,
      "matrimony_matches",
      "fk_matrimony_match_low",
      `ALTER TABLE matrimony_matches ADD CONSTRAINT fk_matrimony_match_low
        FOREIGN KEY (user_low_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_matches m
       LEFT JOIN users u ON u.id = m.user_low_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_matches",
      "fk_matrimony_match_high",
      `ALTER TABLE matrimony_matches ADD CONSTRAINT fk_matrimony_match_high
        FOREIGN KEY (user_high_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_matches m
       LEFT JOIN users u ON u.id = m.user_high_id WHERE u.id IS NULL`
    );

    // --- Safety ---
    await addIndex(
      conn,
      "matrimony_saved_profiles",
      "uq_matrimony_saved",
      `ALTER TABLE matrimony_saved_profiles ADD UNIQUE KEY uq_matrimony_saved (user_id, saved_user_id)`
    );
    await addIndex(
      conn,
      "matrimony_saved_profiles",
      "idx_matrimony_saved_user",
      `ALTER TABLE matrimony_saved_profiles ADD KEY idx_matrimony_saved_user (user_id)`
    );
    await addFk(
      conn,
      "matrimony_saved_profiles",
      "fk_matrimony_saved_user",
      `ALTER TABLE matrimony_saved_profiles ADD CONSTRAINT fk_matrimony_saved_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_saved_profiles s
       LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_saved_profiles",
      "fk_matrimony_saved_target",
      `ALTER TABLE matrimony_saved_profiles ADD CONSTRAINT fk_matrimony_saved_target
        FOREIGN KEY (saved_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_saved_profiles s
       LEFT JOIN users u ON u.id = s.saved_user_id WHERE u.id IS NULL`
    );

    await addIndex(
      conn,
      "matrimony_blocks",
      "uq_matrimony_block",
      `ALTER TABLE matrimony_blocks ADD UNIQUE KEY uq_matrimony_block (user_id, blocked_user_id)`
    );
    await addIndex(
      conn,
      "matrimony_blocks",
      "idx_matrimony_block_blocked",
      `ALTER TABLE matrimony_blocks ADD KEY idx_matrimony_block_blocked (blocked_user_id)`
    );
    await addFk(
      conn,
      "matrimony_blocks",
      "fk_matrimony_block_user",
      `ALTER TABLE matrimony_blocks ADD CONSTRAINT fk_matrimony_block_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_blocks b
       LEFT JOIN users u ON u.id = b.user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_blocks",
      "fk_matrimony_block_target",
      `ALTER TABLE matrimony_blocks ADD CONSTRAINT fk_matrimony_block_target
        FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_blocks b
       LEFT JOIN users u ON u.id = b.blocked_user_id WHERE u.id IS NULL`
    );

    await addIndex(
      conn,
      "matrimony_reports",
      "uq_matrimony_report_pair",
      `ALTER TABLE matrimony_reports ADD UNIQUE KEY uq_matrimony_report_pair (reporter_id, reported_user_id)`
    );
    await addIndex(
      conn,
      "matrimony_reports",
      "idx_matrimony_report_status",
      `ALTER TABLE matrimony_reports ADD KEY idx_matrimony_report_status (status)`
    );
    await addIndex(
      conn,
      "matrimony_reports",
      "idx_matrimony_report_reported",
      `ALTER TABLE matrimony_reports ADD KEY idx_matrimony_report_reported (reported_user_id)`
    );
    await addFk(
      conn,
      "matrimony_reports",
      "fk_matrimony_report_reporter",
      `ALTER TABLE matrimony_reports ADD CONSTRAINT fk_matrimony_report_reporter
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_reports r
       LEFT JOIN users u ON u.id = r.reporter_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_reports",
      "fk_matrimony_report_reported",
      `ALTER TABLE matrimony_reports ADD CONSTRAINT fk_matrimony_report_reported
        FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_reports r
       LEFT JOIN users u ON u.id = r.reported_user_id WHERE u.id IS NULL`
    );

    // --- Monetization ---
    await addIndex(
      conn,
      "matrimony_subscriptions",
      "idx_mat_sub_user_status",
      `ALTER TABLE matrimony_subscriptions ADD KEY idx_mat_sub_user_status (user_id, status)`
    );
    await addIndex(
      conn,
      "matrimony_subscriptions",
      "idx_mat_sub_ends",
      `ALTER TABLE matrimony_subscriptions ADD KEY idx_mat_sub_ends (ends_at)`
    );
    await addFk(
      conn,
      "matrimony_subscriptions",
      "fk_mat_sub_user",
      `ALTER TABLE matrimony_subscriptions ADD CONSTRAINT fk_mat_sub_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_subscriptions s
       LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL`
    );

    await addIndex(
      conn,
      "matrimony_profile_opens",
      "uq_mat_open_period",
      `ALTER TABLE matrimony_profile_opens ADD UNIQUE KEY uq_mat_open_period (user_id, candidate_user_id, billing_period)`
    );
    await addIndex(
      conn,
      "matrimony_profile_opens",
      "idx_mat_open_user_period",
      `ALTER TABLE matrimony_profile_opens ADD KEY idx_mat_open_user_period (user_id, billing_period)`
    );
    await addFk(
      conn,
      "matrimony_profile_opens",
      "fk_mat_open_user",
      `ALTER TABLE matrimony_profile_opens ADD CONSTRAINT fk_mat_open_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_profile_opens o
       LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_profile_opens",
      "fk_mat_open_candidate",
      `ALTER TABLE matrimony_profile_opens ADD CONSTRAINT fk_mat_open_candidate
        FOREIGN KEY (candidate_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_profile_opens o
       LEFT JOIN users u ON u.id = o.candidate_user_id WHERE u.id IS NULL`
    );

    await addIndex(
      conn,
      "matrimony_contact_reveals",
      "uq_mat_contact_pair",
      `ALTER TABLE matrimony_contact_reveals ADD UNIQUE KEY uq_mat_contact_pair (user_id, target_user_id)`
    );
    await addIndex(
      conn,
      "matrimony_contact_reveals",
      "idx_mat_contact_status",
      `ALTER TABLE matrimony_contact_reveals ADD KEY idx_mat_contact_status (status)`
    );
    await addFk(
      conn,
      "matrimony_contact_reveals",
      "fk_mat_contact_user",
      `ALTER TABLE matrimony_contact_reveals ADD CONSTRAINT fk_mat_contact_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_contact_reveals r
       LEFT JOIN users u ON u.id = r.user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_contact_reveals",
      "fk_mat_contact_target",
      `ALTER TABLE matrimony_contact_reveals ADD CONSTRAINT fk_mat_contact_target
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_contact_reveals r
       LEFT JOIN users u ON u.id = r.target_user_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_contact_reveals",
      "fk_mat_contact_match",
      `ALTER TABLE matrimony_contact_reveals ADD CONSTRAINT fk_mat_contact_match
        FOREIGN KEY (match_id) REFERENCES matrimony_matches(id) ON DELETE SET NULL`,
      `SELECT COUNT(*) AS c FROM matrimony_contact_reveals r
       LEFT JOIN matrimony_matches m ON m.id = r.match_id
       WHERE r.match_id IS NOT NULL AND m.id IS NULL`
    );

    await addIndex(
      conn,
      "matrimony_profile_views",
      "idx_mat_view_viewed",
      `ALTER TABLE matrimony_profile_views ADD KEY idx_mat_view_viewed (viewed_user_id, created_at)`
    );
    await addIndex(
      conn,
      "matrimony_profile_views",
      "idx_mat_view_viewer",
      `ALTER TABLE matrimony_profile_views ADD KEY idx_mat_view_viewer (viewer_id, created_at)`
    );
    await addFk(
      conn,
      "matrimony_profile_views",
      "fk_mat_view_viewer",
      `ALTER TABLE matrimony_profile_views ADD CONSTRAINT fk_mat_view_viewer
        FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_profile_views v
       LEFT JOIN users u ON u.id = v.viewer_id WHERE u.id IS NULL`
    );
    await addFk(
      conn,
      "matrimony_profile_views",
      "fk_mat_view_viewed",
      `ALTER TABLE matrimony_profile_views ADD CONSTRAINT fk_mat_view_viewed
        FOREIGN KEY (viewed_user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_profile_views v
       LEFT JOIN users u ON u.id = v.viewed_user_id WHERE u.id IS NULL`
    );

    // --- Payment orders ---
    await addIndex(
      conn,
      "matrimony_payment_orders",
      "uq_mat_pay_rzp_order",
      `ALTER TABLE matrimony_payment_orders ADD UNIQUE KEY uq_mat_pay_rzp_order (razorpay_order_id)`
    );
    await addIndex(
      conn,
      "matrimony_payment_orders",
      "idx_mat_pay_user_status",
      `ALTER TABLE matrimony_payment_orders ADD KEY idx_mat_pay_user_status (user_id, status)`
    );
    await addIndex(
      conn,
      "matrimony_payment_orders",
      "idx_mat_pay_user_purpose_status",
      `ALTER TABLE matrimony_payment_orders ADD KEY idx_mat_pay_user_purpose_status (user_id, purpose, status)`
    );
    await addFk(
      conn,
      "matrimony_payment_orders",
      "fk_mat_pay_user",
      `ALTER TABLE matrimony_payment_orders ADD CONSTRAINT fk_mat_pay_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `SELECT COUNT(*) AS c FROM matrimony_payment_orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL`
    );

    // --- Supporting indexes ---
    const engUser = (await columnExists(conn, "feed_engagement_events", "userId"))
      ? "userId"
      : "user_id";
    const engCreated = (await columnExists(conn, "feed_engagement_events", "createdAt"))
      ? "createdAt"
      : "created_at";
    await addIndex(
      conn,
      "feed_engagement_events",
      "idx_feed_eng_user_created",
      `ALTER TABLE feed_engagement_events ADD KEY idx_feed_eng_user_created (${engUser}, ${engCreated})`
    );

    if (await columnExists(conn, "auth_analytics_events", "created_at")) {
      await addIndex(
        conn,
        "auth_analytics_events",
        "idx_auth_analytics_created",
        `ALTER TABLE auth_analytics_events ADD KEY idx_auth_analytics_created (created_at)`
      );
    }
    if (await columnExists(conn, "auth_analytics_events", "user_id")) {
      await addIndex(
        conn,
        "auth_analytics_events",
        "idx_auth_analytics_user",
        `ALTER TABLE auth_analytics_events ADD KEY idx_auth_analytics_user (user_id)`
      );
    }

    if (await columnExists(conn, "platform_audit_logs", "created_at")) {
      await addIndex(
        conn,
        "platform_audit_logs",
        "idx_platform_audit_created",
        `ALTER TABLE platform_audit_logs ADD KEY idx_platform_audit_created (created_at)`
      );
    }

    if (await columnExists(conn, "users", "pending_mobile")) {
      await addIndex(
        conn,
        "users",
        "idx_users_pending_mobile",
        `ALTER TABLE users ADD KEY idx_users_pending_mobile (pending_mobile)`
      );
    }

    // Duplicate non-unique email index (unique `email` already exists)
    if ((await indexExists(conn, "users", "email")) && (await indexExists(conn, "users", "users_email"))) {
      await dropIndex(conn, "users", "users_email");
    }

    // Redundant single-column posts visibility (composite covers it)
    if (
      (await indexExists(conn, "posts", "idx_posts_visibility_userId")) &&
      (await indexExists(conn, "posts", "idx_posts_visibility"))
    ) {
      await dropIndex(conn, "posts", "idx_posts_visibility");
    }

    console.log("\nDone. Re-run EXPLAIN on matrimony interest/match queries to verify type=ref/range.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
