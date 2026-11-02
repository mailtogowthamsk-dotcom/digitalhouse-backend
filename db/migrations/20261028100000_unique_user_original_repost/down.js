"use strict";

async function up(conn) {
  try {
    await conn.query(`ALTER TABLE posts DROP INDEX uniq_posts_user_original`);
    console.log("  ~ uniq_posts_user_original dropped");
  } catch (err) {
    console.log("  ~ uniq_posts_user_original drop skipped:", err?.message?.slice?.(0, 160) || err);
  }
}

module.exports = { up };
