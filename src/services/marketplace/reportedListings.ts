import { Op } from "sequelize";
import { Post, PostReport } from "../../models";

export async function reportedMarketplacePostIds(): Promise<number[]> {
  const rows = await PostReport.findAll({
    where: { status: "PENDING" },
    attributes: ["postId"],
    group: ["postId"],
    raw: true
  });
  const ids = (rows as { postId: number }[]).map((r) => r.postId);
  if (ids.length === 0) return [];
  const marketplace = await Post.findAll({
    where: { id: { [Op.in]: ids }, postType: "MARKETPLACE" },
    attributes: ["id"],
    raw: true
  });
  return (marketplace as { id: number }[]).map((p) => p.id);
}
