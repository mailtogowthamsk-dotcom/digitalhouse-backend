"use strict";

/**
 * Repair profile/post media refs that still point at deleted staging uploads
 * after Sharp wrote *_full.webp.
 *
 * Column names match Sequelize (camelCase) used by this project.
 */

async function up(conn) {
  const [profiles] = await conn.query(`
    UPDATE users u
    INNER JOIN media_files mf
      ON mf.userId = u.id
     AND mf.processingStatus = 'completed'
     AND mf.objectKey LIKE '%\\_full.webp'
     AND (
       u.profilePhoto = REPLACE(mf.objectKey, '_full.webp', '.webp')
       OR u.profilePhoto LIKE CONCAT(
         '%/',
         SUBSTRING_INDEX(REPLACE(mf.objectKey, '_full.webp', ''), '/', -1),
         '.webp'
       )
     )
    SET u.profilePhoto = mf.objectKey
    WHERE u.profilePhoto IS NOT NULL
      AND u.profilePhoto NOT LIKE '%\\_full.webp'
      AND (
        u.profilePhoto LIKE '%/private/quarantine/profile-photos/%'
        OR u.profilePhoto LIKE '%/profile-photos/%'
      )
  `);
  console.log("  ~ users.profilePhoto staging→full rows:", profiles?.affectedRows ?? profiles);

  const [pending] = await conn.query(`
    UPDATE users u
    INNER JOIN media_files mf
      ON mf.userId = u.id
     AND mf.processingStatus = 'completed'
     AND mf.objectKey LIKE '%\\_full.webp'
     AND u.pending_profile_photo = REPLACE(mf.objectKey, '_full.webp', '.webp')
    SET u.pending_profile_photo = mf.objectKey
    WHERE u.pending_profile_photo IS NOT NULL
      AND u.pending_profile_photo NOT LIKE '%\\_full.webp'
  `);
  console.log("  ~ users.pending_profile_photo rows:", pending?.affectedRows ?? pending);

  const [posts] = await conn.query(`
    UPDATE posts p
    INNER JOIN media_files mf
      ON mf.userId = p.userId
     AND mf.processingStatus = 'completed'
     AND mf.objectKey LIKE '%\\_full.webp'
     AND p.mediaUrl = REPLACE(mf.objectKey, '_full.webp', '.webp')
    SET p.mediaUrl = mf.objectKey
    WHERE p.mediaUrl IS NOT NULL
      AND p.mediaUrl NOT LIKE '%\\_full.webp'
  `);
  console.log("  ~ posts.mediaUrl staging→full rows:", posts?.affectedRows ?? posts);

  const [thumbs] = await conn.query(`
    UPDATE posts p
    INNER JOIN media_files mf
      ON mf.userId = p.userId
     AND mf.processingStatus = 'completed'
     AND mf.objectKey LIKE '%\\_full.webp'
     AND p.thumbnailUrl = REPLACE(mf.objectKey, '_full.webp', '.webp')
    SET p.thumbnailUrl = mf.objectKey
    WHERE p.thumbnailUrl IS NOT NULL
      AND p.thumbnailUrl NOT LIKE '%\\_full.webp'
  `);
  console.log("  ~ posts.thumbnailUrl staging→full rows:", thumbs?.affectedRows ?? thumbs);
}

async function down() {
  console.log("[repair_staging_media_refs] down: no-op");
}

module.exports = { up, down };
