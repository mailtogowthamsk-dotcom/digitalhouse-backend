/**
 * Prominent People module schema + seed categories.
 * Usage: npm run db:run-prominent-people-sql
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
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
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

const CATEGORIES = [
  { code: "civil_services", label: "Civil Services", color: "#1D4ED8", sortOrder: 10 },
  { code: "business", label: "Business", color: "#B45309", sortOrder: 20 },
  { code: "medical", label: "Medical", color: "#BE123C", sortOrder: 30 },
  { code: "education", label: "Education", color: "#7C3AED", sortOrder: 40 },
  { code: "science", label: "Science", color: "#0F766E", sortOrder: 50 },
  { code: "sports", label: "Sports", color: "#EA580C", sortOrder: 60 },
  { code: "arts_culture", label: "Arts & Culture", color: "#DB2777", sortOrder: 70 },
  { code: "cinema", label: "Cinema", color: "#4F46E5", sortOrder: 80 },
  { code: "agriculture", label: "Agriculture", color: "#15803D", sortOrder: 90 },
  { code: "social_service", label: "Social Service", color: "#0891B2", sortOrder: 100 },
  { code: "politics", label: "Politics", color: "#334155", sortOrder: 110 },
  { code: "others", label: "Others", color: "#64748B", sortOrder: 120 }
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const now = new Date();

  try {
    // Expand media_files.module ENUM if needed
    if (await tableExists(conn, "media_files")) {
      const [cols] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_files' AND COLUMN_NAME = 'module'`
      );
      const colType = cols[0]?.COLUMN_TYPE || "";
      if (colType && !colType.includes("'prominent'")) {
        await conn.query(`
          ALTER TABLE media_files
          MODIFY COLUMN module ENUM(
            'profile','posts','jobs','marketplace','matrimony','help','prominent'
          ) NOT NULL
        `);
        console.log("Updated media_files.module ENUM (+ prominent)");
      } else {
        console.log("Skip media_files.module ENUM");
      }
    }

    if (!(await tableExists(conn, "prominent_categories"))) {
      await conn.query(`
        CREATE TABLE prominent_categories (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(64) NOT NULL,
          label VARCHAR(120) NOT NULL,
          color VARCHAR(16) NOT NULL DEFAULT '#2563EB',
          sort_order INT NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_prominent_categories_code (code),
          KEY idx_prominent_categories_active (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created prominent_categories");
    } else {
      console.log("Skip prominent_categories");
    }

    if (!(await tableExists(conn, "prominent_people"))) {
      await conn.query(`
        CREATE TABLE prominent_people (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          full_name VARCHAR(160) NOT NULL,
          category_id INT UNSIGNED NOT NULL,
          occupation VARCHAR(160) NULL,
          current_designation VARCHAR(200) NULL,
          short_description VARCHAR(500) NULL,
          biography TEXT NULL,
          education TEXT NULL,
          achievements TEXT NULL,
          awards TEXT NULL,
          community_contribution TEXT NULL,
          profile_image_key VARCHAR(500) NULL,
          hero_image_key VARCHAR(500) NULL,
          is_featured TINYINT(1) NOT NULL DEFAULT 0,
          is_published TINYINT(1) NOT NULL DEFAULT 0,
          featured_sort_order INT NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          created_by VARCHAR(191) NULL,
          updated_by VARCHAR(191) NULL,
          published_at DATETIME NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_prominent_people_published (is_published, created_at),
          KEY idx_prominent_people_featured (is_featured, is_published, featured_sort_order),
          KEY idx_prominent_people_category (category_id, is_published),
          KEY idx_prominent_people_name (full_name),
          KEY idx_prominent_people_occupation (occupation),
          CONSTRAINT fk_prominent_people_category
            FOREIGN KEY (category_id) REFERENCES prominent_categories(id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created prominent_people");
    } else {
      console.log("Skip prominent_people");
    }

    if (!(await tableExists(conn, "prominent_gallery"))) {
      await conn.query(`
        CREATE TABLE prominent_gallery (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          person_id INT UNSIGNED NOT NULL,
          image_key VARCHAR(500) NOT NULL,
          caption VARCHAR(255) NULL,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_prominent_gallery_person (person_id, sort_order),
          CONSTRAINT fk_prominent_gallery_person
            FOREIGN KEY (person_id) REFERENCES prominent_people(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created prominent_gallery");
    } else {
      console.log("Skip prominent_gallery");
    }

    if (!(await tableExists(conn, "prominent_timeline"))) {
      await conn.query(`
        CREATE TABLE prominent_timeline (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          person_id INT UNSIGNED NOT NULL,
          year VARCHAR(20) NOT NULL,
          title VARCHAR(200) NOT NULL,
          description VARCHAR(500) NULL,
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          KEY idx_prominent_timeline_person (person_id, sort_order),
          CONSTRAINT fk_prominent_timeline_person
            FOREIGN KEY (person_id) REFERENCES prominent_people(id)
            ON UPDATE CASCADE ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created prominent_timeline");
    } else {
      console.log("Skip prominent_timeline");
    }

    for (const cat of CATEGORIES) {
      const [existing] = await conn.query(
        `SELECT id FROM prominent_categories WHERE code = ? LIMIT 1`,
        [cat.code]
      );
      if (existing.length) continue;
      await conn.query(
        `INSERT INTO prominent_categories
          (code, label, color, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [cat.code, cat.label, cat.color, cat.sortOrder, now, now]
      );
      console.log("Seeded category", cat.code);
    }

    console.log("Prominent People migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
