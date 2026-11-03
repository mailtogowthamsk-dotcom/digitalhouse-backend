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
  if (!(await tableExists(conn, "support_team_members"))) {
    await conn.query(`
      CREATE TABLE support_team_members (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(120) NULL,
        email VARCHAR(191) NOT NULL,
        isActive TINYINT(1) NOT NULL DEFAULT 1,
        removedAt DATETIME(3) NULL,
        createdBy VARCHAR(191) NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_support_team_email (email),
        KEY idx_support_team_active (isActive, removedAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + support_team_members");
  }

  if (!(await tableExists(conn, "support_team_events"))) {
    await conn.query(`
      CREATE TABLE support_team_events (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        memberId INT UNSIGNED NOT NULL,
        action VARCHAR(32) NOT NULL,
        actorEmail VARCHAR(191) NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_support_team_events_member (memberId, createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + support_team_events");
  }

  if (!(await tableExists(conn, "registration_request_assignments"))) {
    await conn.query(`
      CREATE TABLE registration_request_assignments (
        userId INT UNSIGNED NOT NULL,
        assignedMemberId INT UNSIGNED NULL,
        workflowStatus ENUM('NEW','ASSIGNED','IN_PROGRESS') NOT NULL DEFAULT 'NEW',
        assignedAt DATETIME(3) NULL,
        assignedBy VARCHAR(191) NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (userId),
        KEY idx_reg_assign_member (assignedMemberId),
        KEY idx_reg_assign_workflow (workflowStatus),
        CONSTRAINT fk_reg_assign_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_reg_assign_member FOREIGN KEY (assignedMemberId) REFERENCES support_team_members (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + registration_request_assignments");
  }

  if (!(await tableExists(conn, "registration_assignment_events"))) {
    await conn.query(`
      CREATE TABLE registration_assignment_events (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId INT UNSIGNED NOT NULL,
        action VARCHAR(32) NOT NULL,
        fromMemberId INT UNSIGNED NULL,
        toMemberId INT UNSIGNED NULL,
        fromMemberEmail VARCHAR(191) NULL,
        toMemberEmail VARCHAR(191) NULL,
        actorEmail VARCHAR(191) NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_reg_assign_events_user (userId, createdAt),
        CONSTRAINT fk_reg_assign_events_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + registration_assignment_events");
  }

  if (!(await tableExists(conn, "registration_internal_notes"))) {
    await conn.query(`
      CREATE TABLE registration_internal_notes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId INT UNSIGNED NOT NULL,
        authorEmail VARCHAR(191) NOT NULL,
        body VARCHAR(2000) NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_reg_notes_user (userId, createdAt),
        CONSTRAINT fk_reg_notes_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + registration_internal_notes");
  }

  if (!(await tableExists(conn, "registration_notification_logs"))) {
    await conn.query(`
      CREATE TABLE registration_notification_logs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId INT UNSIGNED NOT NULL,
        recipientEmail VARCHAR(191) NOT NULL,
        notificationType VARCHAR(40) NOT NULL,
        idempotencyKey VARCHAR(320) NOT NULL,
        deliveryStatus ENUM('PENDING','SENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        lastError VARCHAR(500) NULL,
        sentAt DATETIME(3) NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_reg_notif_idem (idempotencyKey),
        KEY idx_reg_notif_pending (deliveryStatus, updatedAt),
        KEY idx_reg_notif_user (userId),
        CONSTRAINT fk_reg_notif_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + registration_notification_logs");
  }
}

module.exports = { up };
