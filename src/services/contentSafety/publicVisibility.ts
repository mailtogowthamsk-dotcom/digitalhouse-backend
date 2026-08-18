import { Op, type WhereOptions } from "sequelize";
import { isPublicSafetyDecision } from "../../constants/contentSafety.constants";

type SafetyPost = {
  moderationStatus?: string | null;
  safetyDecision?: string | null;
};

/** Indexed feed/public filter. Feed must never run inference — only this precomputed flag. */
export function publicSafetyWhere(): WhereOptions {
  return { safetyDecision: "SAFE" };
}

export function publicContentWhere(): WhereOptions {
  return {
    [Op.and]: [{ moderationStatus: "ACTIVE" }, publicSafetyWhere()]
  };
}

export function isSafetyNotPublic(post: { safetyDecision?: string | null }): boolean {
  return !isPublicSafetyDecision(post.safetyDecision);
}

export function isHiddenFromPublic(post: SafetyPost): boolean {
  return (
    post.moderationStatus === "HIDDEN" ||
    post.moderationStatus === "SOFT_DELETED" ||
    isSafetyNotPublic(post)
  );
}
