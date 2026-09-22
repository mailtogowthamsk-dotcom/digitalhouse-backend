"use strict";

async function up(conn) {
  try {
    await conn.query(`
      ALTER TABLE stories
      MODIFY COLUMN mediaType ENUM('image','video','text') NOT NULL
    `);
    console.log("  ~ stories.mediaType +text");
  } catch (err) {
    console.log("  ~ stories.mediaType alter skipped:", err?.message?.slice?.(0, 160) || err);
  }

  try {
    await conn.query(`
      ALTER TABLE stories
      MODIFY COLUMN caption VARCHAR(200) NULL
    `);
    console.log("  ~ stories.caption VARCHAR(200)");
  } catch (err) {
    console.log("  ~ stories.caption alter skipped:", err?.message?.slice?.(0, 160) || err);
  }
}

module.exports = { up };
