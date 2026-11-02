"use strict";

async function up(conn) {
  try {
    await conn.query(`
      DELETE p1 FROM posts p1
      INNER JOIN posts p2
        ON p1.userId = p2.userId
       AND p1.originalPostId = p2.originalPostId
       AND p1.originalPostId IS NOT NULL
       AND p1.id > p2.id
    `);
    console.log("  ~ duplicate repost rows pruned");
  } catch (err) {
    console.log("  ~ duplicate repost prune skipped:", err?.message?.slice?.(0, 160) || err);
  }

  try {
    await conn.query(`
      ALTER TABLE posts
      ADD UNIQUE INDEX uniq_posts_user_original (userId, originalPostId)
    `);
    console.log("  ~ uniq_posts_user_original");
  } catch (err) {
    console.log("  ~ uniq_posts_user_original skipped:", err?.message?.slice?.(0, 160) || err);
  }
}

module.exports = { up };
