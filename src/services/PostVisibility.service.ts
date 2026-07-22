import { Op, type WhereOptions } from "sequelize";
import { MemberConnection } from "../models";
import {
  DEFAULT_POST_VISIBILITY,
  parsePostVisibility,
  postVisibilityLabel,
  type PostVisibility
} from "../constants/postVisibility.constants";

export {
  DEFAULT_POST_VISIBILITY,
  parsePostVisibility,
  postVisibilityLabel,
  type PostVisibility
};
export { POST_VISIBILITIES } from "../constants/postVisibility.constants";

/**
 * Accepted connection peer IDs for a user (undirected).
 * Optimized for feed WHERE clauses — IDs only, no user DTO hydration.
 */
export async function getAcceptedConnectionUserIds(userId: number): Promise<number[]> {
  if (!userId) return [];
  const rows = await MemberConnection.findAll({
    where: {
      status: "ACCEPTED",
      [Op.or]: [{ requesterUserId: userId }, { recipientUserId: userId }]
    },
    attributes: ["requesterUserId", "recipientUserId"],
    raw: true
  });
  const ids = new Set<number>();
  for (const row of rows as Array<{ requesterUserId: number; recipientUserId: number }>) {
    const other = row.requesterUserId === userId ? row.recipientUserId : row.requesterUserId;
    if (other && other !== userId) ids.add(other);
  }
  return [...ids];
}

export type AudienceFilterMode =
  /** Home feed / saved: community + connections (when linked) + own */
  | "feed"
  /** Explore / search / highlights: community (PUBLIC) only */
  | "discovery"
  /** Another member's profile: PUBLIC always; CONNECTIONS only if viewer is connected (or self) */
  | "profile";

/**
 * SQL WHERE fragment enforcing post audience visibility at the database layer.
 * Never rely on client-side filtering alone.
 */
export async function audienceVisibilityWhere(
  viewerId: number,
  mode: AudienceFilterMode,
  opts?: { authorId?: number; isConnectedToAuthor?: boolean; isSelf?: boolean }
): Promise<WhereOptions> {
  if (mode === "discovery") {
    return { visibility: "PUBLIC" };
  }

  if (mode === "profile") {
    const authorId = opts?.authorId;
    if (authorId == null) return { visibility: "PUBLIC" };
    if (opts?.isSelf || authorId === viewerId) {
      return {}; // author sees all of their posts
    }
    if (opts?.isConnectedToAuthor) {
      return {
        visibility: { [Op.in]: ["PUBLIC", "CONNECTIONS"] }
      };
    }
    return { visibility: "PUBLIC" };
  }

  // feed mode
  const connectedIds = await getAcceptedConnectionUserIds(viewerId);
  const orParts: WhereOptions[] = [
    { visibility: "PUBLIC" },
    { userId: viewerId }
  ];
  if (connectedIds.length > 0) {
    orParts.push({
      visibility: "CONNECTIONS",
      userId: { [Op.in]: connectedIds }
    });
  }
  return { [Op.or]: orParts };
}

/**
 * Authorize a single post for the viewer. Throws 404 (not 403) to avoid leaking existence.
 */
export async function assertCanViewPostAudience(
  viewerId: number,
  post: { userId: number; visibility?: string | null }
): Promise<void> {
  const visibility = parsePostVisibility(post.visibility);
  if (post.userId === viewerId) return;
  if (visibility === "PUBLIC") return;

  if (visibility === "CONNECTIONS") {
    const { hasAcceptedConnection } = await import("./Connection.service");
    const ok = await hasAcceptedConnection(viewerId, post.userId);
    if (ok) return;
  }

  const err = new Error("Post not found");
  (err as { status?: number }).status = 404;
  throw err;
}

export function andWhere(base: WhereOptions, extra: WhereOptions): WhereOptions {
  if (!extra || (typeof extra === "object" && Object.keys(extra).length === 0)) {
    return base;
  }
  return { [Op.and]: [base, extra] };
}
