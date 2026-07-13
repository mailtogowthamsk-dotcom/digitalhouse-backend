/**
 * Platform Management Phase 1 schema.
 * Usage: npm run db:run-platform-management-sql
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

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
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
      console.log("Created platform_app_versions");
    }

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
        VALUES (0, 'Under Maintenance', 'We will be back shortly.', NOW(), NOW())
      `);
      console.log("Created platform_maintenance");
    }

    if (!(await tableExists(conn, "platform_notifications"))) {
      await conn.query(`
        CREATE TABLE platform_notifications (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          kind ENUM('GLOBAL','EMERGENCY') NOT NULL DEFAULT 'GLOBAL',
          title VARCHAR(160) NOT NULL,
          body TEXT NOT NULL,
          image_url VARCHAR(500) NULL,
          deep_link VARCHAR(500) NULL,
          audience ENUM('ALL','PREMIUM','FREE','ANDROID','IOS') NOT NULL DEFAULT 'ALL',
          status ENUM('DRAFT','SCHEDULED','SENT','CANCELLED') NOT NULL DEFAULT 'DRAFT',
          scheduled_at DATETIME NULL,
          sent_at DATETIME NULL,
          created_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_plat_notif_status (status, scheduled_at),
          KEY idx_plat_notif_kind (kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_notifications");
    }

    if (!(await tableExists(conn, "platform_alert_popups"))) {
      await conn.query(`
        CREATE TABLE platform_alert_popups (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(160) NOT NULL,
          body TEXT NOT NULL,
          image_url VARCHAR(500) NULL,
          popup_type ENUM('ONE_TIME','REPEAT','MANDATORY') NOT NULL DEFAULT 'ONE_TIME',
          acknowledgement_required TINYINT(1) NOT NULL DEFAULT 0,
          scheduled_at DATETIME NULL,
          expires_at DATETIME NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_plat_popup_active (is_active, expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_alert_popups");
    }

    if (!(await tableExists(conn, "platform_popup_acks"))) {
      await conn.query(`
        CREATE TABLE platform_popup_acks (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          popup_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          acknowledged_at DATETIME NOT NULL,
          UNIQUE KEY uq_popup_user (popup_id, user_id),
          KEY idx_popup_acks_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_popup_acks");
    }

    if (!(await tableExists(conn, "platform_announcements"))) {
      await conn.query(`
        CREATE TABLE platform_announcements (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(160) NOT NULL,
          description TEXT NOT NULL,
          banner_image VARCHAR(500) NULL,
          publish_at DATETIME NOT NULL,
          expires_at DATETIME NULL,
          priority INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_plat_announce_active (is_active, publish_at, expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_announcements");
    }

    if (!(await tableExists(conn, "platform_banners"))) {
      await conn.query(`
        CREATE TABLE platform_banners (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          message VARCHAR(255) NOT NULL,
          background_color VARCHAR(32) NULL DEFAULT '#0f172a',
          icon VARCHAR(64) NULL,
          click_action VARCHAR(500) NULL,
          expires_at DATETIME NULL,
          priority INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_plat_banner_active (is_active, expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_banners");
    }

    if (!(await tableExists(conn, "platform_feature_flags"))) {
      await conn.query(`
        CREATE TABLE platform_feature_flags (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(64) NOT NULL,
          label VARCHAR(120) NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          platforms_json JSON NULL,
          updated_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_plat_flag_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_feature_flags");
    }

    if (!(await tableExists(conn, "platform_menu_items"))) {
      await conn.query(`
        CREATE TABLE platform_menu_items (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(64) NOT NULL,
          label VARCHAR(120) NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          feature_flag VARCHAR(64) NULL,
          platform_scope VARCHAR(32) NULL DEFAULT 'ALL',
          role_scope VARCHAR(64) NULL,
          updated_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_plat_menu_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_menu_items");
    }

    if (!(await tableExists(conn, "platform_ads"))) {
      await conn.query(`
        CREATE TABLE platform_ads (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          kind ENUM('BANNER','SPONSORED','INTERNAL') NOT NULL DEFAULT 'BANNER',
          title VARCHAR(160) NOT NULL,
          image_url VARCHAR(500) NULL,
          target_screen VARCHAR(120) NULL,
          priority INT NOT NULL DEFAULT 0,
          starts_at DATETIME NULL,
          ends_at DATETIME NULL,
          click_action VARCHAR(500) NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          views INT UNSIGNED NOT NULL DEFAULT 0,
          clicks INT UNSIGNED NOT NULL DEFAULT 0,
          created_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_plat_ads_active (is_active, starts_at, ends_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_ads");
    }

    if (!(await tableExists(conn, "platform_audit_logs"))) {
      await conn.query(`
        CREATE TABLE platform_audit_logs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          admin_email VARCHAR(191) NULL,
          action VARCHAR(80) NOT NULL,
          module VARCHAR(64) NOT NULL,
          details_json JSON NULL,
          created_at DATETIME NOT NULL,
          KEY idx_plat_audit_module (module, created_at),
          KEY idx_plat_audit_admin (admin_email, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_audit_logs");
    }

    // Phase 2: store listing URL on versions
    const [storeCol] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'platform_app_versions'
         AND COLUMN_NAME = 'store_url'
       LIMIT 1`
    );
    if (!storeCol.length) {
      await conn.query(
        `ALTER TABLE platform_app_versions
         ADD COLUMN store_url VARCHAR(500) NULL AFTER release_date`
      );
      console.log("Added platform_app_versions.store_url");
    }

    console.log("Platform Management schema complete.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
