/**
 * Heal JOB posts stuck PENDING/PROCESSING after jobs left the content-safety pipeline.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/publish-jobs-skip-safety.ts --dry-run
 *   npx ts-node --transpile-only scripts/publish-jobs-skip-safety.ts
 *   npx ts-node --transpile-only scripts/publish-jobs-skip-safety.ts --limit=100
 */

import "dotenv/config";
import { Op } from "sequelize";
import { publishStuckJobPostsWithoutSafety } from "../src/services/contentSafety/ContentSafety.service";
import { sequelize } from "../src/config/db";
import { Post } from "../src/models";

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 50) : 50;

async function main(): Promise<void> {
  console.log(`[publish-jobs-skip-safety] dryRun=${dryRun} limit=${limit}`);
  if (dryRun) {
    const posts = await Post.findAll({
      where: {
        postType: "JOB",
        safetyDecision: { [Op.ne]: "SAFE" },
        moderationStatus: "ACTIVE",
        deletedAt: null
      },
      attributes: ["id", "title", "safetyDecision", "mediaUrl"],
      order: [["id", "DESC"]],
      limit
    });
    for (const p of posts) {
      console.log(`  post ${p.id} safety=${p.safetyDecision} title=${p.title}`);
    }
    console.log(`[publish-jobs-skip-safety] would fix ${posts.length}`);
  } else {
    const result = await publishStuckJobPostsWithoutSafety(limit);
    console.log(`[publish-jobs-skip-safety] scanned=${result.scanned} fixed=${result.fixed}`);
  }
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
