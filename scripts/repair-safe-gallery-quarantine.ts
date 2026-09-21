/**
 * Promote leftover quarantine marketplace/help gallery keys for SAFE posts.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/repair-safe-gallery-quarantine.ts --dry-run
 *   npx ts-node --transpile-only scripts/repair-safe-gallery-quarantine.ts
 *   npx ts-node --transpile-only scripts/repair-safe-gallery-quarantine.ts --limit=100
 */

import "dotenv/config";
import { Op } from "sequelize";
import { repairSafeGalleriesWithPrivateKeys } from "../src/services/contentSafety/ContentSafety.service";
import { sequelize } from "../src/config/db";
import { Post } from "../src/models";
import { parseMarketplaceGallery } from "../src/utils/marketplaceGallery";
import { parseHelpGallery } from "../src/utils/helpGallery";
import { isPrivateR2Object } from "../src/utils/r2Client";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 50) : 50;

async function main(): Promise<void> {
  console.log(`[repair-safe-gallery] dryRun=${dryRun} limit=${limit}`);
  if (dryRun) {
    const posts = await Post.findAll({
      where: {
        safetyDecision: "SAFE",
        postType: { [Op.in]: ["MARKETPLACE", "HELP_REQUEST"] }
      },
      order: [["id", "DESC"]],
      limit
    });
    let need = 0;
    for (const p of posts) {
      const gallery =
        p.postType === "MARKETPLACE"
          ? parseMarketplaceGallery(p.marketplaceGallery, p.mediaUrl)
          : parseHelpGallery(p.helpGallery, p.mediaUrl);
      const privateCount = gallery.filter((u) => isPrivateR2Object(u)).length;
      if (privateCount > 0 || isPrivateR2Object(p.mediaUrl)) {
        need += 1;
        console.log(
          `  post ${p.id} type=${p.postType} gallery=${gallery.length} private=${privateCount}`
        );
      }
    }
    console.log(`[repair-safe-gallery] would repair ${need}/${posts.length}`);
  } else {
    const result = await repairSafeGalleriesWithPrivateKeys(limit);
    console.log(`[repair-safe-gallery] scanned=${result.scanned} fixed=${result.fixed}`);
  }
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
