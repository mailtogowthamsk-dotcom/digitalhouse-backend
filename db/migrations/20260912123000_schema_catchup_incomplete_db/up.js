"use strict";

/**
 * Catch-up migration for DBs that were partially migrated / restored incomplete.
 * Safe to re-run: every change is gated by table/column/index existence checks.
 *
 * Covers gaps that blocked production after switching to local MySQL:
 * - posts.originalPostId, posts.mediaType, moderation/safety columns
 * - users.last_seen_*, registration / soft-delete / google auth columns
 * - content_safety_scans / fingerprints (mediaType etc.)
 * - platform_maintenance, master_data_*, moderation_actions, hashtags
 * - messages.sharedPostId
 */

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
  if (!(await tableExists(conn, table))) return false;
  if (await columnExists(conn, table, column)) return false;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`  + ${table}.${column}`);
  return true;
}

async function addIndex(conn, table, name, sql) {
  if (!(await tableExists(conn, table))) return false;
  if (await indexExists(conn, table, name)) return false;
  await conn.query(sql);
  console.log(`  + ${table}.${name}`);
  return true;
}

async function ensureUsers(conn) {
  if (!(await tableExists(conn, "users"))) return;

  await addColumn(conn, "users", "signup_provider",
    "signup_provider ENUM('EXISTING_LOGIN','GOOGLE') NOT NULL DEFAULT 'EXISTING_LOGIN'");
  await addColumn(conn, "users", "provider_user_id", "provider_user_id VARCHAR(191) NULL");
  await addColumn(conn, "users", "google_id", "google_id VARCHAR(191) NULL");
  await addColumn(conn, "users", "email_verified", "email_verified TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(conn, "users", "last_login_provider", "last_login_provider VARCHAR(32) NULL");
  await addColumn(conn, "users", "profile_complete", "profile_complete TINYINT(1) NOT NULL DEFAULT 1");
  await addColumn(conn, "users", "linked_providers", "linked_providers JSON NULL");
  await addColumn(conn, "users", "last_seen_at", "last_seen_at DATETIME NULL");
  await addColumn(conn, "users", "last_seen_visibility",
    "last_seen_visibility ENUM('EVERYONE','MATCHES_ONLY','NOBODY') NOT NULL DEFAULT 'EVERYONE'");
  await addColumn(conn, "users", "registration_admin_remarks", "registration_admin_remarks TEXT NULL");
  await addColumn(conn, "users", "registration_requested_fields", "registration_requested_fields JSON NULL");
  await addColumn(conn, "users", "pending_mobile", "pending_mobile VARCHAR(20) NULL");
  await addColumn(conn, "users", "pending_profile_photo", "pending_profile_photo VARCHAR(500) NULL");
  await addColumn(conn, "users", "registration_resubmitted_at", "registration_resubmitted_at DATETIME NULL");
  await addColumn(conn, "users", "registration_reviewed_at", "registration_reviewed_at DATETIME NULL");
  await addColumn(conn, "users", "deleted_at", "deleted_at DATETIME NULL");
  await addColumn(conn, "users", "deleted_by", "deleted_by VARCHAR(191) NULL");
  await addColumn(conn, "users", "delete_reason", "delete_reason TEXT NULL");
  await addColumn(conn, "users", "profile_visibility",
    "profile_visibility ENUM('PUBLIC','PRIVATE') NOT NULL DEFAULT 'PUBLIC'");
  await addColumn(conn, "users", "allow_connection_requests",
    "allow_connection_requests TINYINT(1) NOT NULL DEFAULT 1");
  await addColumn(conn, "users", "username_changed_at", "username_changed_at DATETIME NULL");

  // Expand status ENUM if older DB lacks newer values (best-effort).
  try {
    await conn.query(`
      ALTER TABLE users
      MODIFY COLUMN status ENUM(
        'PENDING','APPROVED','REJECTED','PENDING_REVIEW','SUSPENDED','CHANGES_REQUESTED','DELETED'
      ) NOT NULL DEFAULT 'PENDING'
    `);
  } catch {
    /* ignore if already compatible / locked */
  }

  await addIndex(conn, "users", "uq_users_google_id",
    "ALTER TABLE users ADD UNIQUE KEY uq_users_google_id (google_id)");
}

async function ensurePosts(conn) {
  if (!(await tableExists(conn, "posts"))) return;

  await addColumn(conn, "posts", "originalPostId",
    "originalPostId INT UNSIGNED NULL DEFAULT NULL AFTER userId");
  await addColumn(conn, "posts", "visibility",
    "visibility ENUM('PUBLIC','CONNECTIONS') NOT NULL DEFAULT 'PUBLIC'");
  await addColumn(conn, "posts", "mediaType",
    "mediaType ENUM('image','video','none') NOT NULL DEFAULT 'none'");
  await addColumn(conn, "posts", "thumbnailUrl", "thumbnailUrl VARCHAR(500) NULL");
  await addColumn(conn, "posts", "videoDuration", "videoDuration INT UNSIGNED NULL");
  await addColumn(conn, "posts", "mimeType", "mimeType VARCHAR(64) NULL");
  await addColumn(conn, "posts", "fileSize", "fileSize INT UNSIGNED NULL");

  await addColumn(conn, "posts", "jobCompany", "jobCompany VARCHAR(255) NULL");
  await addColumn(conn, "posts", "jobCategory", "jobCategory VARCHAR(128) NULL");
  await addColumn(conn, "posts", "jobLocation", "jobLocation VARCHAR(255) NULL");
  await addColumn(conn, "posts", "jobContactPhone", "jobContactPhone VARCHAR(32) NULL");
  await addColumn(conn, "posts", "jobEmploymentType",
    "jobEmploymentType ENUM('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY') NULL");
  await addColumn(conn, "posts", "jobWorkMode",
    "jobWorkMode ENUM('ON_SITE','HYBRID','REMOTE') NULL");
  await addColumn(conn, "posts", "jobExperience", "jobExperience VARCHAR(128) NULL");
  await addColumn(conn, "posts", "jobSkills", "jobSkills JSON NULL");
  await addColumn(conn, "posts", "jobSalaryMin", "jobSalaryMin INT UNSIGNED NULL");
  await addColumn(conn, "posts", "jobSalaryMax", "jobSalaryMax INT UNSIGNED NULL");
  await addColumn(conn, "posts", "jobVacancies", "jobVacancies INT UNSIGNED NULL");
  await addColumn(conn, "posts", "jobApplicationDeadline", "jobApplicationDeadline DATETIME NULL");
  await addColumn(conn, "posts", "jobClosedAt", "jobClosedAt DATETIME NULL");
  await addColumn(conn, "posts", "jobStatus", "jobStatus ENUM('OPEN','CLOSED') NULL");

  await addColumn(conn, "posts", "marketplaceStatus", "marketplaceStatus VARCHAR(32) NULL");
  await addColumn(conn, "posts", "marketplaceIntent", "marketplaceIntent VARCHAR(32) NULL");
  await addColumn(conn, "posts", "marketplaceCategory", "marketplaceCategory VARCHAR(64) NULL");
  await addColumn(conn, "posts", "marketplaceCondition", "marketplaceCondition VARCHAR(32) NULL");
  await addColumn(conn, "posts", "marketplacePrice", "marketplacePrice INT UNSIGNED NULL");
  await addColumn(conn, "posts", "marketplaceNegotiable",
    "marketplaceNegotiable TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(conn, "posts", "marketplaceDistrict", "marketplaceDistrict VARCHAR(255) NULL");
  await addColumn(conn, "posts", "marketplaceAdminNote", "marketplaceAdminNote TEXT NULL");
  await addColumn(conn, "posts", "marketplaceExpiresAt", "marketplaceExpiresAt DATETIME NULL");
  await addColumn(conn, "posts", "marketplaceExpiryReminder", "marketplaceExpiryReminder VARCHAR(16) NULL");
  await addColumn(conn, "posts", "marketplaceGallery", "marketplaceGallery JSON NULL");
  await addColumn(conn, "posts", "marketplaceFeatured",
    "marketplaceFeatured TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn(conn, "posts", "marketplaceFeaturedAt", "marketplaceFeaturedAt DATETIME NULL");

  await addColumn(conn, "posts", "helpStatus", "helpStatus VARCHAR(32) NULL");
  await addColumn(conn, "posts", "helpCategory", "helpCategory VARCHAR(64) NULL");
  await addColumn(conn, "posts", "helpUrgency", "helpUrgency VARCHAR(16) NULL");
  await addColumn(conn, "posts", "helpLocation", "helpLocation VARCHAR(255) NULL");
  await addColumn(conn, "posts", "helpContactPhone", "helpContactPhone VARCHAR(32) NULL");
  await addColumn(conn, "posts", "helpGallery", "helpGallery JSON NULL");
  await addColumn(conn, "posts", "helpExpiresAt", "helpExpiresAt DATETIME NULL");
  await addColumn(conn, "posts", "helpExpiryReminder", "helpExpiryReminder VARCHAR(16) NULL");
  await addColumn(conn, "posts", "helpExtendedCount",
    "helpExtendedCount INT UNSIGNED NOT NULL DEFAULT 0");
  await addColumn(conn, "posts", "helpResolvedAt", "helpResolvedAt DATETIME NULL");
  await addColumn(conn, "posts", "helpResolvedBy", "helpResolvedBy INT UNSIGNED NULL");

  await addColumn(conn, "posts", "likeCount", "likeCount INT UNSIGNED NOT NULL DEFAULT 0");
  await addColumn(conn, "posts", "commentCount", "commentCount INT UNSIGNED NOT NULL DEFAULT 0");

  await addColumn(conn, "posts", "moderation_status",
    "moderation_status ENUM('ACTIVE','HIDDEN','SOFT_DELETED') NOT NULL DEFAULT 'ACTIVE'");
  await addColumn(conn, "posts", "moderation_reason", "moderation_reason TEXT NULL");
  await addColumn(conn, "posts", "moderation_notes", "moderation_notes TEXT NULL");
  await addColumn(conn, "posts", "moderated_by", "moderated_by VARCHAR(191) NULL");
  await addColumn(conn, "posts", "moderated_at", "moderated_at DATETIME NULL");

  await addColumn(conn, "posts", "safety_decision",
    "safety_decision VARCHAR(32) NOT NULL DEFAULT 'PENDING'");
  await addColumn(conn, "posts", "safety_category", "safety_category VARCHAR(32) NULL");
  await addColumn(conn, "posts", "safety_confidence", "safety_confidence DECIMAL(6,5) NULL");
  await addColumn(conn, "posts", "safety_model", "safety_model VARCHAR(64) NULL");
  await addColumn(conn, "posts", "safety_model_version", "safety_model_version VARCHAR(32) NULL");
  await addColumn(conn, "posts", "safety_policy_version", "safety_policy_version VARCHAR(32) NULL");
  await addColumn(conn, "posts", "media_version",
    "media_version INT UNSIGNED NOT NULL DEFAULT 1");
  await addColumn(conn, "posts", "moderated_media_version",
    "moderated_media_version INT UNSIGNED NULL");
  await addColumn(conn, "posts", "safety_failure_reason",
    "safety_failure_reason VARCHAR(255) NULL");
  await addColumn(conn, "posts", "deleted_at", "deleted_at DATETIME NULL");

  // Backfill mediaType from mediaUrl when column was just added / still none
  try {
    await conn.query(`
      UPDATE posts
      SET mediaType = 'image'
      WHERE (mediaType IS NULL OR mediaType = 'none')
        AND mediaUrl IS NOT NULL AND mediaUrl <> ''
    `);
  } catch {
    /* ignore */
  }

  await addIndex(conn, "posts", "idx_posts_originalPostId",
    "ALTER TABLE posts ADD INDEX idx_posts_originalPostId (originalPostId)");
  await addIndex(conn, "posts", "idx_posts_visibility",
    "ALTER TABLE posts ADD INDEX idx_posts_visibility (visibility)");
  await addIndex(conn, "posts", "idx_posts_safety_moderation_created",
    "ALTER TABLE posts ADD KEY idx_posts_safety_moderation_created (safety_decision, moderation_status, createdAt)");
}

async function ensureMessages(conn) {
  if (!(await tableExists(conn, "messages"))) return;
  await addColumn(conn, "messages", "sharedPostId",
    "sharedPostId INT UNSIGNED NULL DEFAULT NULL");
  await addIndex(conn, "messages", "idx_messages_sharedPostId",
    "ALTER TABLE messages ADD INDEX idx_messages_sharedPostId (sharedPostId)");
}

async function ensureMediaFiles(conn) {
  if (!(await tableExists(conn, "media_files"))) return;
  await addColumn(conn, "media_files", "mediaVersion",
    "mediaVersion INT UNSIGNED NOT NULL DEFAULT 1");
  await addColumn(conn, "media_files", "safetyDecision",
    "safetyDecision VARCHAR(32) NULL");
  await addColumn(conn, "media_files", "safetyCategory",
    "safetyCategory VARCHAR(32) NULL");
  await addColumn(conn, "media_files", "perceptualHash",
    "perceptualHash CHAR(16) NULL");
  await addColumn(conn, "media_files", "objectKey", "objectKey VARCHAR(500) NULL");
  await addColumn(conn, "media_files", "variantsJson", "variantsJson TEXT NULL");
  await addColumn(conn, "media_files", "processingStatus",
    "processingStatus ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending'");
  await addColumn(conn, "media_files", "byteSize", "byteSize INT UNSIGNED NULL");
  await addColumn(conn, "media_files", "width", "width INT UNSIGNED NULL");
  await addColumn(conn, "media_files", "height", "height INT UNSIGNED NULL");
}

async function ensureContentSafety(conn) {
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
  } else {
    const cols = [
      ["postId", "postId INT UNSIGNED NULL"],
      ["mediaId", "mediaId INT UNSIGNED NULL"],
      ["jobId", "jobId INT UNSIGNED NULL"],
      ["mediaVersion", "mediaVersion INT UNSIGNED NOT NULL DEFAULT 1"],
      ["mediaType", "mediaType VARCHAR(16) NOT NULL DEFAULT 'image'"],
      ["model", "model VARCHAR(64) NOT NULL DEFAULT 'unknown'"],
      ["modelVersion", "modelVersion VARCHAR(32) NOT NULL DEFAULT '1'"],
      ["policyVersion", "policyVersion VARCHAR(32) NOT NULL DEFAULT 'dh-safety-v1'"],
      ["status", "status VARCHAR(32) NOT NULL DEFAULT 'PENDING'"],
      ["category", "category VARCHAR(32) NOT NULL DEFAULT 'NONE'"],
      ["confidence", "confidence DECIMAL(6,5) NULL"],
      ["decision", "decision VARCHAR(32) NOT NULL DEFAULT 'SAFE'"],
      ["failureReason", "failureReason VARCHAR(255) NULL"],
      ["processingTimeMs", "processingTimeMs INT UNSIGNED NULL"],
      ["createdAt", "createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["completedAt", "completedAt DATETIME NULL"]
    ];
    for (const [name, ddl] of cols) {
      await addColumn(conn, "content_safety_scans", name, ddl);
    }
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
  } else {
    await addColumn(conn, "content_safety_fingerprints", "mediaType",
      "mediaType VARCHAR(16) NOT NULL DEFAULT 'image'");
    await addColumn(conn, "content_safety_fingerprints", "algorithm",
      "algorithm VARCHAR(32) NOT NULL DEFAULT 'phash'");
    await addColumn(conn, "content_safety_fingerprints", "category",
      "category VARCHAR(32) NOT NULL DEFAULT 'NONE'");
    await addColumn(conn, "content_safety_fingerprints", "decision",
      "decision VARCHAR(32) NOT NULL DEFAULT 'SAFE'");
    await addColumn(conn, "content_safety_fingerprints", "postId", "postId INT UNSIGNED NULL");
    await addColumn(conn, "content_safety_fingerprints", "mediaId", "mediaId INT UNSIGNED NULL");
    await addColumn(conn, "content_safety_fingerprints", "createdAt",
      "createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
  }
}

async function ensureMasterData(conn) {
  if (!(await tableExists(conn, "master_data_types"))) {
    await conn.query(`
      CREATE TABLE master_data_types (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(128) NOT NULL,
        description TEXT NULL,
        parentTypeCode VARCHAR(64) NULL,
        parentOptional TINYINT(1) NOT NULL DEFAULT 0,
        isSystem TINYINT(1) NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        UNIQUE KEY uq_mdt_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + master_data_types");
  }
  if (!(await tableExists(conn, "master_data_items"))) {
    await conn.query(`
      CREATE TABLE master_data_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        typeCode VARCHAR(64) NOT NULL,
        code VARCHAR(64) NOT NULL,
        label VARCHAR(191) NOT NULL,
        labelTa VARCHAR(191) NULL,
        parentItemId INT UNSIGNED NULL,
        sortOrder INT NOT NULL DEFAULT 0,
        isActive TINYINT(1) NOT NULL DEFAULT 1,
        metadata JSON NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        UNIQUE KEY uq_mdi_type_code (typeCode, code),
        KEY idx_mdi_type_active (typeCode, isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + master_data_items");
  }
  if (!(await tableExists(conn, "master_data_audits"))) {
    await conn.query(`
      CREATE TABLE master_data_audits (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        actorEmail VARCHAR(191) NULL,
        action VARCHAR(64) NOT NULL,
        typeCode VARCHAR(64) NULL,
        itemId INT UNSIGNED NULL,
        details JSON NULL,
        createdAt DATETIME NOT NULL,
        KEY idx_mda_created (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + master_data_audits");
  }
}

async function ensurePlatform(conn) {
  if (!(await tableExists(conn, "platform_maintenance"))) {
    await conn.query(`
      CREATE TABLE platform_maintenance (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        title VARCHAR(160) NOT NULL DEFAULT 'Under Maintenance',
        description TEXT NULL,
        expected_end_at DATETIME NULL,
        contact_info VARCHAR(255) NULL,
        scheduled_start_at DATETIME NULL,
        activated_at DATETIME NULL,
        deactivated_at DATETIME NULL,
        updated_by VARCHAR(191) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      INSERT INTO platform_maintenance
        (enabled, title, description, created_at, updated_at)
      VALUES (0, 'Under Maintenance', NULL, NOW(), NOW())
    `);
    console.log("  + platform_maintenance");
  }

  if (!(await tableExists(conn, "platform_app_versions"))) {
    await conn.query(`
      CREATE TABLE platform_app_versions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        platform ENUM('ANDROID','IOS') NOT NULL,
        version_name VARCHAR(32) NOT NULL,
        version_code INT UNSIGNED NOT NULL DEFAULT 0,
        min_supported_version VARCHAR(32) NOT NULL,
        latest_version VARCHAR(32) NOT NULL,
        release_notes TEXT NULL,
        release_date DATE NULL,
        store_url VARCHAR(500) NULL,
        status ENUM('DRAFT','SOFT_UPDATE','FORCE_UPDATE','DISABLED','ROLLED_BACK') NOT NULL DEFAULT 'DRAFT',
        created_by VARCHAR(191) NULL,
        updated_by VARCHAR(191) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_platform_version (platform, version_name),
        KEY idx_platform_status (platform, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + platform_app_versions");
  }

  if (!(await tableExists(conn, "admin_users"))) {
    await conn.query(`
      CREATE TABLE admin_users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(191) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('SUPER_ADMIN','ADMIN','MODERATOR') NOT NULL DEFAULT 'ADMIN',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        last_login_at DATETIME NULL,
        failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_by VARCHAR(191) NULL,
        updated_by VARCHAR(191) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_admin_users_email (email),
        KEY idx_admin_users_role (role),
        KEY idx_admin_users_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + admin_users");
  }
}

async function ensureModerationAndHashtags(conn) {
  if (!(await tableExists(conn, "moderation_actions"))) {
    await conn.query(`
      CREATE TABLE moderation_actions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        target_user_id INT UNSIGNED NULL,
        post_id INT UNSIGNED NULL,
        action ENUM(
          'WARN','SUSPEND','REACTIVATE','ESCALATE','RESOLVE','DISMISS',
          'HIDE_POST','RESTORE_POST','SOFT_DELETE_POST','HARD_DELETE_POST','EDIT_POST',
          'SAFETY_ALLOW','SAFETY_REJECT'
        ) NOT NULL,
        reason TEXT NULL,
        admin_email VARCHAR(191) NULL,
        created_at DATETIME NOT NULL,
        KEY idx_mod_actions_user (target_user_id),
        KEY idx_mod_actions_post (post_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + moderation_actions");
  } else {
    await addColumn(conn, "moderation_actions", "post_id", "post_id INT UNSIGNED NULL");
  }

  if (!(await tableExists(conn, "hashtags"))) {
    await conn.query(`
      CREATE TABLE hashtags (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tag VARCHAR(64) NOT NULL,
        usage_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_hashtags_tag (tag)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + hashtags");
  }
  if (!(await tableExists(conn, "post_hashtags"))) {
    await conn.query(`
      CREATE TABLE post_hashtags (
        post_id INT UNSIGNED NOT NULL,
        hashtag_id INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (post_id, hashtag_id),
        KEY idx_post_hashtags_tag (hashtag_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + post_hashtags");
  }
}

async function up(conn) {
  console.log("[schema-catchup] users…");
  await ensureUsers(conn);
  console.log("[schema-catchup] posts…");
  await ensurePosts(conn);
  console.log("[schema-catchup] messages…");
  await ensureMessages(conn);
  console.log("[schema-catchup] media_files…");
  await ensureMediaFiles(conn);
  console.log("[schema-catchup] content safety…");
  await ensureContentSafety(conn);
  console.log("[schema-catchup] master data…");
  await ensureMasterData(conn);
  console.log("[schema-catchup] platform / admin…");
  await ensurePlatform(conn);
  console.log("[schema-catchup] moderation / hashtags…");
  await ensureModerationAndHashtags(conn);
  console.log("[schema-catchup] done");
}

async function down() {
  // Non-destructive catch-up — no automatic drop.
  console.log("[schema-catchup] down: no-op (columns/tables retained)");
}

module.exports = { up, down };
