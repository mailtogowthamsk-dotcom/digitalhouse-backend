/**
 * One-shot repair: posts stuck on safety PENDING/PROCESSING after media finished.
 * Usage (on server):
 *   npx tsx scripts/reconcile-pending-safety.ts
 *   npx tsx scripts/reconcile-pending-safety.ts --ids=9,12
 */
import "../src/config/env";
import { sequelize } from "../src/config/db";
import { Post } from "../src/models";
import { Op } from "sequelize";
import {
  reconcilePendingPostSafety,
  reconcileStuckPendingPosts
} from "../src/services/contentSafety/ContentSafety.service";

async function main() {
  await sequelize.authenticate();
  const idsArg = process.argv.find((a) => a.startsWith("--ids="));
  if (idsArg) {
    const ids = idsArg
      .slice("--ids=".length)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    let fixed = 0;
    for (const id of ids) {
      const post = await Post.findByPk(id, {
        attributes: ["id", "title", "safetyDecision", "postType"]
      });
      console.log("before", {
        id,
        title: post?.title,
        safety: post?.safetyDecision,
        type: post?.postType
      });
      const ok = await reconcilePendingPostSafety(id);
      const after = await Post.findByPk(id, { attributes: ["id", "safetyDecision"] });
      console.log("after", { id, safety: after?.safetyDecision, fixed: ok });
      if (ok) fixed += 1;
    }
    console.log(JSON.stringify({ scanned: ids.length, fixed }));
  } else {
    const result = await reconcileStuckPendingPosts(50);
    console.log(JSON.stringify(result));
    const still = await Post.findAll({
      where: {
        safetyDecision: { [Op.in]: ["PENDING", "PROCESSING"] },
        postType: { [Op.in]: ["HELP_REQUEST", "MARKETPLACE", "JOB"] }
      },
      attributes: ["id", "title", "postType", "safetyDecision"],
      order: [["id", "DESC"]],
      limit: 20
    });
    console.log(
      "still_pending",
      still.map((p) => ({ id: p.id, type: p.postType, title: p.title, safety: p.safetyDecision }))
    );
  }
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
