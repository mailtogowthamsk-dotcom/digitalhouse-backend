"use strict";

async function up(conn) {
  try {
    await conn.query(`
      UPDATE stories
      SET deletedAt = COALESCE(deletedAt, UTC_TIMESTAMP(3))
      WHERE mediaType = 'text' AND deletedAt IS NULL
    `);
  } catch (err) {
    console.log("  ~ text stories soft-delete skipped:", err?.message?.slice?.(0, 120) || err);
  }

  try {
    await conn.query(`
      ALTER TABLE stories
      MODIFY COLUMN mediaType ENUM('image','video') NOT NULL
    `);
    console.log("  ~ stories.mediaType -text");
  } catch (err) {
    console.log("  ~ stories.mediaType down skipped:", err?.message?.slice?.(0, 160) || err);
  }

  try {
    await conn.query(`
      ALTER TABLE stories
      MODIFY COLUMN caption VARCHAR(120) NULL
    `);
    console.log("  ~ stories.caption VARCHAR(120)");
  } catch (err) {
    console.log("  ~ stories.caption down skipped:", err?.message?.slice?.(0, 160) || err);
  }
}

module.exports = { up };
