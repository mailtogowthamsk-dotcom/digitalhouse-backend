/**
 * Durable MySQL media queue + media_files processing status migration.
 * Usage: npm run db:run-media-jobs-sql
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

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function columnInfo(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows[0] || null;
}

async function indexExists(conn, table, columns, unique = false) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME, NON_UNIQUE,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     GROUP BY INDEX_NAME, NON_UNIQUE`,
    [table]
  );
  const expected = columns.join(",");
  return rows.some(
    (row) =>
      row.columnsList === expected && (!unique || Number(row.NON_UNIQUE) === 0)
  );
}

async function namedIndexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function foreignKeyExists(conn, table, column, referencedTable, referencedColumn) {
  const [rows] = await conn.query(
    `SELECT 1
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME = ?
       AND REFERENCED_COLUMN_NAME = ?
     LIMIT 1`,
    [table, column, referencedTable, referencedColumn]
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, constraint) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [table, constraint]
  );
  return rows.length > 0;
}

async function preflightExistingMediaJobs(conn) {
  if (!(await tableExists(conn, "media_jobs"))) return;
  const [countRows] = await conn.query("SELECT COUNT(*) AS rowCount FROM media_jobs");
  const rowCount = Number(countRows[0]?.rowCount || 0);
  const criticalColumns = ["id", "mediaId", "objectKey", "jobType", "status"];
  const missingCritical = [];
  for (const column of criticalColumns) {
    if (!(await columnExists(conn, "media_jobs", column))) {
      missingCritical.push(column);
    }
  }
  if (rowCount > 0 && missingCritical.length > 0) {
    throw new Error(
      `Cannot safely repair non-empty media_jobs; missing required columns: ${missingCritical.join(", ")}`
    );
  }
  if (!(await columnExists(conn, "media_jobs", "mediaId"))) return;
  const [duplicates] = await conn.query(`
    SELECT mediaId
    FROM media_jobs
    GROUP BY mediaId
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (duplicates.length > 0) {
    throw new Error("media_jobs has duplicate mediaId rows; resolve them before migration");
  }
  const [orphans] = await conn.query(`
    SELECT mj.mediaId
    FROM media_jobs mj
    LEFT JOIN media_files mf ON mf.id = mj.mediaId
    WHERE mf.id IS NULL
    LIMIT 1
  `);
  if (orphans.length > 0) {
    throw new Error("media_jobs has orphan rows; resolve them before adding the foreign key");
  }
}

async function addMissingColumns(conn, table, definitions) {
  for (const [name, definition] of Object.entries(definitions)) {
    if (await columnExists(conn, table, name)) continue;
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
    console.log(`Added ${table}.${name}`);
  }
}

async function addIndexIfMissing(conn, table, name, columns, unique = false) {
  if (await indexExists(conn, table, columns, unique)) return;
  let indexName = name;
  let suffix = 0;
  while (await namedIndexExists(conn, table, indexName)) {
    suffix += 1;
    indexName = `${name}_repair${suffix}`;
  }
  const keyword = unique ? "UNIQUE INDEX" : "INDEX";
  const quotedColumns = columns.map((column) => `\`${column}\``).join(", ");
  await conn.query(
    `ALTER TABLE \`${table}\` ADD ${keyword} \`${indexName}\` (${quotedColumns})`
  );
  console.log(`Added ${table} index ${indexName}`);
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
    if (!(await tableExists(conn, "media_files"))) {
      throw new Error("media_files does not exist; run the base media migration first");
    }
    await preflightExistingMediaJobs(conn);

    await addMissingColumns(conn, "media_files", {
      objectKey: "VARCHAR(500) NULL",
      variantsJson: "TEXT NULL",
      byteSize: "INT UNSIGNED NULL",
      width: "INT UNSIGNED NULL",
      height: "INT UNSIGNED NULL"
    });

    if (await columnExists(conn, "media_files", "processingStatus")) {
      const info = await columnInfo(conn, "media_files", "processingStatus");
      const statusValues = Array.from(
        String(info?.COLUMN_TYPE || "").matchAll(/'([^']+)'/g),
        (match) => match[1]
      );
      const alreadyCurrent =
        ["pending", "processing", "completed", "failed"].every((status) =>
          statusValues.includes(status)
        ) &&
        String(info?.COLUMN_DEFAULT || "").toLowerCase() === "pending";
      if (alreadyCurrent) {
        if (
          statusValues.includes("pending_upload") ||
          statusValues.includes("ready")
        ) {
          await conn.query(`
            UPDATE media_files
            SET processingStatus = CASE
              WHEN processingStatus = 'pending_upload' THEN 'pending'
              WHEN processingStatus = 'ready' THEN 'completed'
              ELSE processingStatus
            END
          `);
        }
        console.log("media_files.processingStatus already current");
      } else {
        // Expand first so legacy values can be converted without ENUM truncation.
        await conn.query(`
          ALTER TABLE media_files
          MODIFY COLUMN processingStatus
            ENUM('pending_upload','pending','processing','ready','completed','failed')
            NOT NULL DEFAULT 'pending'
        `);
        await conn.query(`
          UPDATE media_files
          SET processingStatus = CASE
            WHEN processingStatus = 'pending_upload' THEN 'pending'
            WHEN processingStatus = 'ready' THEN 'completed'
            ELSE processingStatus
          END
        `);
        console.log("Migrated media_files.processingStatus");
      }
    } else {
      await conn.query(`
        ALTER TABLE media_files
        ADD COLUMN processingStatus
          ENUM('pending','processing','completed','failed')
          NOT NULL DEFAULT 'pending'
      `);
      console.log("Added media_files.processingStatus");
    }

    if (!(await tableExists(conn, "media_jobs"))) {
      await conn.query(`
        CREATE TABLE media_jobs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          mediaId INT UNSIGNED NOT NULL,
          objectKey VARCHAR(500) NOT NULL,
          jobType ENUM('image','video') NOT NULL,
          status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
          retryCount INT UNSIGNED NOT NULL DEFAULT 0,
          staleRecoveryCount INT UNSIGNED NOT NULL DEFAULT 0,
          errorMessage TEXT NULL,
          workerId VARCHAR(191) NULL,
          startedAt DATETIME NULL,
          completedAt DATETIME NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          UNIQUE KEY uq_media_jobs_media (mediaId),
          KEY idx_media_jobs_claim (status, updatedAt, createdAt),
          KEY idx_media_jobs_worker (workerId, status),
          CONSTRAINT fk_media_jobs_media
            FOREIGN KEY (mediaId) REFERENCES media_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created media_jobs");
    } else {
      await addMissingColumns(conn, "media_jobs", {
        id: "INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST",
        mediaId: "INT UNSIGNED NOT NULL",
        objectKey: "VARCHAR(500) NOT NULL",
        jobType: "ENUM('image','video') NOT NULL",
        status:
          "ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending'",
        retryCount: "INT UNSIGNED NOT NULL DEFAULT 0",
        staleRecoveryCount: "INT UNSIGNED NOT NULL DEFAULT 0",
        errorMessage: "TEXT NULL",
        workerId: "VARCHAR(191) NULL",
        startedAt: "DATETIME NULL",
        completedAt: "DATETIME NULL",
        createdAt: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updatedAt:
          "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
      });
      console.log("Repaired missing media_jobs columns");
    }

    if (!(await namedIndexExists(conn, "media_jobs", "PRIMARY"))) {
      await conn.query("ALTER TABLE media_jobs ADD PRIMARY KEY (`id`)");
      console.log("Added media_jobs primary key");
    }
    await addIndexIfMissing(
      conn,
      "media_jobs",
      "uq_media_jobs_media",
      ["mediaId"],
      true
    );
    await addIndexIfMissing(
      conn,
      "media_jobs",
      "idx_media_jobs_claim",
      ["status", "updatedAt", "createdAt"]
    );
    await addIndexIfMissing(
      conn,
      "media_jobs",
      "idx_media_jobs_worker",
      ["workerId", "status"]
    );

    if (
      !(await foreignKeyExists(
        conn,
        "media_jobs",
        "mediaId",
        "media_files",
        "id"
      ))
    ) {
      let constraintName = "fk_media_jobs_media";
      let suffix = 0;
      while (await constraintExists(conn, "media_jobs", constraintName)) {
        suffix += 1;
        constraintName = `fk_media_jobs_media_repair${suffix}`;
      }
      await conn.query(`
        ALTER TABLE media_jobs
        ADD CONSTRAINT \`${constraintName}\`
        FOREIGN KEY (mediaId) REFERENCES media_files(id) ON DELETE CASCADE
      `);
      console.log("Added media_jobs media foreign key");
    }

    const [backfill] = await conn.query(`
      UPDATE media_files mf
      LEFT JOIN media_jobs mj ON mj.mediaId = mf.id
      SET mf.processingStatus = 'completed'
      WHERE mf.processingStatus IN ('pending', 'processing')
        AND (
          mj.status = 'completed'
          OR (
            mj.id IS NULL
            AND
            mf.variantsJson IS NOT NULL
            AND TRIM(mf.variantsJson) NOT IN ('', '{}', 'null')
          )
        )
    `);
    console.log(`Backfilled ${backfill.affectedRows || 0} completed media file(s)`);

    const [failedSync] = await conn.query(`
      UPDATE media_files mf
      JOIN media_jobs mj ON mj.mediaId = mf.id
      SET mf.processingStatus = 'failed'
      WHERE mj.status = 'failed'
        AND mf.processingStatus IN ('pending', 'processing')
    `);
    console.log(`Synchronized ${failedSync.affectedRows || 0} failed media file(s)`);

    console.log("Media jobs migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
