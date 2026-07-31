import { Op } from "sequelize";
import { User, Post } from "../../models";
import { assertCanViewPostAudience } from "../PostVisibility.service";
import * as JobsSettings from "../JobsSettings.service";
import { APPROVED } from "./mappers";

/** Ensure post is visible to current user (same community). */
export async function ensureCommunityVisible(post: Post, currentUserId: number): Promise<void> {
  const author = await User.findByPk(post.userId, { attributes: ["community"] });
  const currentUser = await User.findByPk(currentUserId, { attributes: ["community"] });
  if (!author || !currentUser) throw new Error("User not found");
  const authorCommunity = author.community ?? null;
  const myCommunity = currentUser.community ?? null;
  if (authorCommunity !== myCommunity) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await assertCanViewPostAudience(currentUserId, post);
}

export async function viewerCommunity(userId: number): Promise<string | null> {
  const u = await User.findByPk(userId, { attributes: ["community"] });
  return u?.community ?? null;
}

/** Get approved user IDs in the same community as userId (for feed visibility). */
async function approvedUserIdsInCommunity(userId: number): Promise<number[]> {
  const me = await User.findByPk(userId, { attributes: ["community"] });
  if (!me) return [];
  const community = me.community ?? null;
  const users = await User.findAll({
    where: { status: APPROVED, community },
    attributes: ["id"]
  });
  return users.map(u => u.id);
}

export async function assertJobActiveLimit(userId: number, excludePostId?: number): Promise<void> {
  const maxActive = await JobsSettings.getMaxActiveJobs();
  if (!maxActive || maxActive <= 0) return;
  const where: Record<string, unknown> = {
    userId,
    postType: "JOB",
    [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }]
  };
  if (excludePostId) {
    where.id = { [Op.ne]: excludePostId };
  }
  const count = await Post.count({ where: where as any });
  if (count >= maxActive) {
    throw Object.assign(
      new Error(
        `You already have ${maxActive} active job posting${maxActive === 1 ? "" : "s"}. Close one before posting another.`
      ),
      { status: 400, code: "JOB_ACTIVE_LIMIT" }
    );
  }
}

/** Used by Home.service: return approved user IDs in same community as current user. */
export async function getApprovedUserIdsInCommunity(userId: number): Promise<number[]> {
  return approvedUserIdsInCommunity(userId);
}
