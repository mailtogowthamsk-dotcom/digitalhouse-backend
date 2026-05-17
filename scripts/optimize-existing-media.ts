/**
 * One-off migration: optimize existing R2 images (posts, profiles, media_files).
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/optimize-existing-media.ts
 *   npx ts-node --transpile-only scripts/optimize-existing-media.ts --dry-run
 *
 * Requires R2_* env vars and DB connection (same as server).
 */

import "dotenv/config";
import { Op } from "sequelize";
import { sequelize } from "../src/config/db";
import { Post, User, MediaFile } from "../src/models";
import {
  extractR2KeyFromUrl,
  getR2ObjectBuffer,
  putR2ObjectBuffer,
  getCdnPublicUrl,
  deleteR2ObjectByKey
} from "../src/utils/r2Client";
import {
  processImageBuffer,
  sniffImageMime,
  variantKeysFromUploadKey,
  IMAGE_OUTPUT_MIME
} from "../src/utils/imageProcessor";
import { IMAGE_PROCESS_DOWNLOAD_MAX_BYTES } from "../src/config/image.config";

const dryRun = process.argv.includes("--dry-run");

async function optimizeKey(stagingKey: string): Promise<string | null> {
  if (stagingKey.endsWith("_full.webp")) {
    console.log("  skip (already optimized):", stagingKey);
    return getCdnPublicUrl(stagingKey);
  }

  let raw: Buffer;
  try {
    raw = await getR2ObjectBuffer(stagingKey, IMAGE_PROCESS_DOWNLOAD_MAX_BYTES);
  } catch (e) {
    console.warn("  download failed:", stagingKey, (e as Error).message);
    return null;
  }

  if (!sniffImageMime(raw)) {
    console.warn("  not a raster image:", stagingKey);
    return null;
  }

  const processed = await processImageBuffer(raw);
  const { thumbKey, mediumKey, fullKey } = variantKeysFromUploadKey(stagingKey);

  if (dryRun) {
    console.log(
      `  [dry-run] ${stagingKey} → full ${processed.full.bytes}B, md ${processed.medium.bytes}B, thumb ${processed.thumb.bytes}B`
    );
    return getCdnPublicUrl(fullKey);
  }

  await Promise.all([
    putR2ObjectBuffer(thumbKey, processed.thumb.buffer, IMAGE_OUTPUT_MIME),
    putR2ObjectBuffer(mediumKey, processed.medium.buffer, IMAGE_OUTPUT_MIME),
    putR2ObjectBuffer(fullKey, processed.full.buffer, IMAGE_OUTPUT_MIME)
  ]);

  if (stagingKey !== fullKey) {
    await deleteR2ObjectByKey(stagingKey);
  }

  return getCdnPublicUrl(fullKey);
}

async function main() {
  await sequelize.authenticate();
  console.log(dryRun ? "DRY RUN – no writes" : "Optimizing existing media…");

  const urlMap = new Map<string, string>();

  const posts = await Post.findAll({
    attributes: ["id", "mediaUrl"],
    where: { mediaUrl: { [Op.ne]: null } }
  });
  for (const p of posts) {
    const url = p.mediaUrl?.trim();
    if (!url) continue;
    const key = extractR2KeyFromUrl(url);
    if (!key) continue;
    const fullUrl = await optimizeKey(key);
    if (fullUrl) urlMap.set(url, fullUrl);
  }

  const users = await User.findAll({
    attributes: ["id", "profilePhoto"],
    where: { profilePhoto: { [Op.ne]: null } }
  });
  for (const u of users) {
    const url = u.profilePhoto?.trim();
    if (!url) continue;
    const key = extractR2KeyFromUrl(url);
    if (!key) continue;
    const fullUrl = await optimizeKey(key);
    if (fullUrl) urlMap.set(url, fullUrl);
  }

  const mediaRows = await MediaFile.findAll({
    where: { fileType: "image" }
  });
  for (const m of mediaRows) {
    const key = m.objectKey ?? extractR2KeyFromUrl(m.fileUrl);
    if (!key) continue;
    const fullUrl = await optimizeKey(key);
    if (!fullUrl) continue;
    urlMap.set(m.fileUrl, fullUrl);
    if (!dryRun) {
      const { thumbKey, mediumKey, fullKey } = variantKeysFromUploadKey(key);
      await m.update({
        fileUrl: fullUrl,
        objectKey: fullKey,
        variantsJson: JSON.stringify({
          thumb: getCdnPublicUrl(thumbKey),
          medium: getCdnPublicUrl(mediumKey),
          full: fullUrl
        }),
        processingStatus: "ready",
        byteSize: null
      });
    }
  }

  if (!dryRun) {
    for (const [oldUrl, newUrl] of urlMap) {
      await Post.update({ mediaUrl: newUrl }, { where: { mediaUrl: oldUrl } });
      await User.update({ profilePhoto: newUrl }, { where: { profilePhoto: oldUrl } });
    }
  }

  console.log(`Done. ${urlMap.size} image URL(s) ${dryRun ? "would be" : ""} updated.`);
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
