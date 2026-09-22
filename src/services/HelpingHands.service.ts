import { Op, QueryTypes } from "sequelize";
import { Post, User, HelpOffer, HelpAppreciation } from "../models";
import { sequelize } from "../config/db";
import {
  HELP_APPRECIATION_MAX,
  HELP_CATEGORY_LABELS,
  HELP_MAX_AUTHOR_EXTENDS,
  isHelpActivelyOpen,
  resolveHelpActiveHours,
  type HelpCategory
} from "../constants/helpingHands.constants";
import { toPublicUrlIfR2 } from "../utils/r2Client";
import * as Notifications from "./Notification.service";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function clampPage(limit?: number, offset?: number): { limit: number; offset: number } {
  const lim = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(limit as number) ? Math.floor(limit as number) : DEFAULT_PAGE_SIZE)
  );
  const off = Math.max(0, Number.isFinite(offset as number) ? Math.floor(offset as number) : 0);
  return { limit: lim, offset: off };
}

async function ensureSameCommunity(post: Post, userId: number): Promise<void> {
  const [author, me] = await Promise.all([
    User.findByPk(post.userId, { attributes: ["community"] }),
    User.findByPk(userId, { attributes: ["community"] })
  ]);
  if (!author || !me) throw Object.assign(new Error("User not found"), { status: 404 });
  if ((author.community ?? null) !== (me.community ?? null)) {
    throw Object.assign(new Error("Request not found"), { status: 404 });
  }
}

async function assertHelpPost(postId: number, viewerId: number): Promise<Post> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "HELP_REQUEST") {
    throw Object.assign(new Error("Request not found"), { status: 404 });
  }
  await ensureSameCommunity(post, viewerId);
  return post;
}

export async function getHelpingHandsStats(userId: number): Promise<{
  peopleHelped: number;
  activeVolunteers: number;
  requestsCompleted: number;
  livesTouched: number;
  activeRequests: number;
}> {
  const me = await User.findByPk(userId, { attributes: ["community"] });
  const community = me?.community ?? null;

  // JOIN approved community authors — avoid materializing every user id into IN (...).
  const communityAuthorInclude = {
    association: "User" as const,
    attributes: [] as string[],
    required: true as const,
    where: { status: "APPROVED" as const, community }
  };

  const [completed, openActive, volunteerRows] = await Promise.all([
    Post.count({
      where: { postType: "HELP_REQUEST", helpStatus: "COMPLETED", moderationStatus: "ACTIVE", safetyDecision: "SAFE" },
      include: [communityAuthorInclude],
      distinct: true
    }),
    Post.count({
      where: {
        postType: "HELP_REQUEST",
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE"
      },
      include: [communityAuthorInclude],
      distinct: true
    }),
    HelpOffer.findAll({
      where: { status: "ACTIVE" },
      attributes: ["fromUserId"],
      include: [
        {
          association: "Post",
          attributes: [],
          required: true,
          where: {
            postType: "HELP_REQUEST",
            helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
            moderationStatus: "ACTIVE",
            safetyDecision: "SAFE"
          },
          include: [
            {
              association: "User",
              attributes: [],
              required: true,
              where: { status: "APPROVED", community }
            }
          ]
        }
      ]
    })
  ]);

  const activeVolunteers = new Set(volunteerRows.map((o) => o.fromUserId)).size;

  return {
    peopleHelped: completed,
    activeVolunteers,
    requestsCompleted: completed,
    livesTouched: completed + openActive,
    activeRequests: openActive
  };
}

export async function offerHelp(
  fromUserId: number,
  postId: number,
  message?: string | null
): Promise<{
  offered: boolean;
  created: boolean;
  offerId: number;
  requesterUserId: number;
  canMessage: boolean;
  contactPhone: string | null;
}> {
  const post = await assertHelpPost(postId, fromUserId);
  if (post.userId === fromUserId) {
    throw Object.assign(new Error("You cannot offer help on your own request"), { status: 400 });
  }
  if (
    post.helpStatus === "COMPLETED" ||
    post.helpStatus === "CANCELLED" ||
    post.helpStatus === "EXPIRED"
  ) {
    throw Object.assign(new Error("This request is no longer open for help"), { status: 400 });
  }
  if (post.helpExpiresAt && post.helpExpiresAt.getTime() <= Date.now()) {
    throw Object.assign(new Error("This request has expired"), { status: 400 });
  }

  const existing = await HelpOffer.findOne({ where: { postId, fromUserId } });
  if (existing) {
    if (existing.status !== "ACTIVE") {
      await existing.update({ status: "ACTIVE", message: message?.trim()?.slice(0, 500) || existing.message });
    }
    return {
      offered: true,
      created: false,
      offerId: existing.id,
      requesterUserId: post.userId,
      canMessage: true,
      contactPhone: post.helpContactPhone ?? null
    };
  }

  const row = await HelpOffer.create({
    postId,
    fromUserId,
    status: "ACTIVE",
    message: message?.trim()?.slice(0, 500) || null
  } as any);

  if (post.helpStatus === "OPEN" || !post.helpStatus) {
    await post.update({ helpStatus: "IN_PROGRESS" });
  }

  void Notifications.notifyHelpOfferReceived(
    post.userId,
    fromUserId,
    post.id,
    post.title,
    message?.trim() || null
  ).catch(() => {});

  return {
    offered: true,
    created: true,
    offerId: row.id,
    requesterUserId: post.userId,
    canMessage: true,
    contactPhone: post.helpContactPhone ?? null
  };
}

export async function listHelpersForPost(
  viewerId: number,
  postId: number
): Promise<{
  items: {
    id: number;
    from_user_id: number;
    message: string | null;
    created_at: string;
    author: { id: number; name: string; profile_image: string | null };
  }[];
  total: number;
}> {
  const post = await assertHelpPost(postId, viewerId);
  const rows = await HelpOffer.findAll({
    where: { postId, status: "ACTIVE" },
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "profilePhoto"],
        required: true
      }
    ],
    order: [["createdAt", "ASC"]]
  });

  const items = await Promise.all(
    rows.map(async (r) => {
      const author = (r as any).FromUser as User;
      const profile_image = await toPublicUrlIfR2(author.profilePhoto ?? null);
      return {
        id: r.id,
        from_user_id: r.fromUserId,
        message: r.message ?? null,
        created_at: r.createdAt.toISOString(),
        author: { id: author.id, name: author.fullName, profile_image }
      };
    })
  );

  // Owner or helper can see list; community members can see too for transparency
  void post;
  return { items, total: items.length };
}

export async function completeHelpRequest(
  ownerUserId: number,
  postId: number,
  opts?: {
    /** Helpers the requester credits as “resolved by” (Heroes credit). */
    resolvedByUserIds?: number[];
    /** @deprecated use resolvedByUserIds */
    helperUserId?: number;
    appreciation?: string | null;
  }
): Promise<{ status: string; creditedCount: number; appreciationSaved: boolean }> {
  const post = await assertHelpPost(postId, ownerUserId);
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Only the requester can mark this completed"), { status: 403 });
  }
  if (post.helpStatus === "COMPLETED") {
    return { status: "COMPLETED", creditedCount: 0, appreciationSaved: false };
  }

  const activeOffers = await HelpOffer.findAll({
    where: { postId, status: "ACTIVE" },
    attributes: ["fromUserId"]
  });
  const offerIds = new Set(activeOffers.map((o) => o.fromUserId));

  let resolvedBy = [
    ...new Set(
      (opts?.resolvedByUserIds?.length
        ? opts.resolvedByUserIds
        : opts?.helperUserId
          ? [opts.helperUserId]
          : []
      ).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    )
  ];

  for (const id of resolvedBy) {
    if (!offerIds.has(id)) {
      throw Object.assign(
        new Error("Resolved-by must be someone who offered help on this request"),
        { status: 400 }
      );
    }
  }

  await post.update({
    helpStatus: "COMPLETED",
    urgent: false,
    helpResolvedAt: new Date(),
    helpResolvedBy: ownerUserId
  });

  void Notifications.notifyHelpRequestResolved(ownerUserId, post.id, post.title).catch(() => {});

  const appreciationRaw = opts?.appreciation?.trim();
  if (appreciationRaw && appreciationRaw.length > HELP_APPRECIATION_MAX) {
    throw Object.assign(new Error("Appreciation is too long"), { status: 400 });
  }
  const defaultMsg = "Thank you for helping resolve this request.";
  const message = (appreciationRaw && appreciationRaw.length >= 3
    ? appreciationRaw
    : defaultMsg
  ).slice(0, HELP_APPRECIATION_MAX);

  let appreciationSaved = false;
  for (const helperUserId of resolvedBy) {
    const [, created] = await HelpAppreciation.findOrCreate({
      where: { postId, helperUserId },
      defaults: {
        postId,
        helperUserId,
        fromUserId: ownerUserId,
        message
      } as any
    });
    if (created) {
      appreciationSaved = true;
      void Notifications.notifyHelpAppreciationReceived(
        helperUserId,
        ownerUserId,
        post.id,
        post.title,
        message.slice(0, 120)
      ).catch(() => {});
    }
  }

  for (const h of activeOffers) {
    void Notifications.notifyHelpRequestCompleted(h.fromUserId, post.id, post.title).catch(
      () => {}
    );
  }

  return {
    status: "COMPLETED",
    creditedCount: resolvedBy.length,
    appreciationSaved
  };
}

export async function getCommunityHeroes(
  userId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{
  items: {
    userId: number;
    name: string;
    profileImage: string | null;
    intro: string | null;
    livesHelped: number;
    categories: string[];
    recentAppreciation: string | null;
  }[];
  nextOffset: number | null;
}> {
  const { limit, offset } = clampPage(opts?.limit, opts?.offset);
  const me = await User.findByPk(userId, { attributes: ["community"] });
  const community = me?.community ?? null;

  // Credit = HelpAppreciation on COMPLETED requests (requester “Resolved by”), not mere offers.
  // Paginate at SQL level — never load the full hero ranking into memory.
  const ranked = await sequelize.query<{ helperUserId: number; livesHelped: number }>(
    `
    SELECT ha.\`helperUserId\` AS helperUserId, COUNT(*) AS livesHelped
    FROM help_appreciations ha
    INNER JOIN posts p ON p.id = ha.\`postId\`
    INNER JOIN users u ON u.id = ha.\`helperUserId\`
    WHERE p.\`postType\` = 'HELP_REQUEST'
      AND p.\`helpStatus\` = 'COMPLETED'
      AND u.status = 'APPROVED'
      AND (
        (:community IS NULL AND u.community IS NULL)
        OR u.community = :community
      )
    GROUP BY ha.\`helperUserId\`
    ORDER BY livesHelped DESC, helperUserId ASC
    LIMIT :fetchLimit OFFSET :offset
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        community,
        fetchLimit: limit + 1,
        offset
      }
    }
  );

  const hasMore = ranked.length > limit;
  const page = hasMore ? ranked.slice(0, limit) : ranked;
  if (!page.length) return { items: [], nextOffset: null };

  const helperIds = page.map((r) => Number(r.helperUserId));
  const [users, creditRows] = await Promise.all([
    User.findAll({
      where: { id: { [Op.in]: helperIds } },
      attributes: ["id", "fullName", "profilePhoto"]
    }),
    HelpAppreciation.findAll({
      where: { helperUserId: { [Op.in]: helperIds } },
      attributes: ["helperUserId", "postId", "message", "createdAt"],
      include: [
        {
          model: Post,
          required: true,
          attributes: ["id", "helpCategory"],
          where: { postType: "HELP_REQUEST", helpStatus: "COMPLETED" }
        }
      ],
      order: [["createdAt", "DESC"]]
    })
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const cats = new Map<number, Set<string>>();
  const recentByHelper = new Map<number, string>();
  for (const c of creditRows) {
    if (!recentByHelper.has(c.helperUserId)) recentByHelper.set(c.helperUserId, c.message);
    const cat = (c as any).Post?.helpCategory as string | null | undefined;
    if (cat) {
      if (!cats.has(c.helperUserId)) cats.set(c.helperUserId, new Set());
      cats.get(c.helperUserId)!.add(cat);
    }
  }

  const items = await Promise.all(
    page.map(async (row) => {
      const id = Number(row.helperUserId);
      const count = Number(row.livesHelped) || 0;
      const u = userMap.get(id);
      const profileImage = await toPublicUrlIfR2(u?.profilePhoto ?? null);
      const categories = [...(cats.get(id) || [])].map(
        (c) => HELP_CATEGORY_LABELS[c as HelpCategory] || c.replace(/_/g, " ")
      );
      return {
        userId: id,
        name: u?.fullName ?? "Member",
        profileImage,
        intro: null as string | null,
        livesHelped: count,
        categories,
        recentAppreciation: recentByHelper.get(id) ?? null
      };
    })
  );

  return {
    items,
    nextOffset: hasMore ? offset + limit : null
  };
}

export async function getMyHelpRequestsPage(
  userId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{
  items: {
    postId: number;
    title: string;
    status: string;
    category: string | null;
    createdAt: string;
    helperCount: number;
  }[];
  nextOffset: number | null;
}> {
  const { limit, offset } = clampPage(opts?.limit, opts?.offset);
  const myPosts = await Post.findAll({
    where: { userId, postType: "HELP_REQUEST" },
    order: [["createdAt", "DESC"]],
    limit: limit + 1,
    offset
  });
  const hasMore = myPosts.length > limit;
  const page = hasMore ? myPosts.slice(0, limit) : myPosts;
  const myPostIds = page.map((p) => p.id);
  const offerCounts =
    myPostIds.length === 0
      ? []
      : await HelpOffer.findAll({
          where: { postId: { [Op.in]: myPostIds }, status: "ACTIVE" },
          attributes: ["postId"],
          raw: true
        });
  const countMap: Record<number, number> = {};
  for (const o of offerCounts as { postId: number }[]) {
    countMap[o.postId] = (countMap[o.postId] || 0) + 1;
  }

  return {
    items: page.map((p) => ({
      postId: p.id,
      title: p.title,
      status: p.helpStatus ?? "OPEN",
      category: p.helpCategory,
      createdAt: p.createdAt.toISOString(),
      helperCount: countMap[p.id] || 0
    })),
    nextOffset: hasMore ? offset + limit : null
  };
}

export async function getMyHelpContributionsPage(
  userId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{
  items: {
    postId: number;
    title: string;
    category: string | null;
    personHelped: string;
    personHelpedId: number;
    date: string;
    appreciation: string | null;
  }[];
  nextOffset: number | null;
}> {
  const { limit, offset } = clampPage(opts?.limit, opts?.offset);

  // Contributions = only requests where requester credited you (Resolved by).
  const credits = await HelpAppreciation.findAll({
    where: { helperUserId: userId },
    order: [["createdAt", "DESC"]],
    limit: limit + 1,
    offset,
    include: [
      {
        model: Post,
        required: true,
        where: {
          postType: "HELP_REQUEST",
          helpStatus: "COMPLETED",
          moderationStatus: "ACTIVE",
          safetyDecision: "SAFE"
        },
        include: [{ association: "User", attributes: ["id", "fullName"], required: true }]
      }
    ]
  });

  const hasMore = credits.length > limit;
  const page = hasMore ? credits.slice(0, limit) : credits;

  return {
    items: page.map((a) => {
      const p = (a as any).Post as Post;
      const author = (p as any).User as User;
      return {
        postId: p.id,
        title: p.title,
        category: p.helpCategory,
        personHelped: author?.fullName ?? "Member",
        personHelpedId: p.userId,
        date: a.createdAt.toISOString(),
        appreciation: a.message
      };
    }),
    nextOffset: hasMore ? offset + limit : null
  };
}

/** @deprecated Prefer getMyHelpRequestsPage / getMyHelpContributionsPage */
export async function getMyHelpingActivity(userId: number): Promise<{
  requests: {
    postId: number;
    title: string;
    status: string;
    category: string | null;
    createdAt: string;
    helperCount: number;
  }[];
  contributions: {
    postId: number;
    title: string;
    category: string | null;
    personHelped: string;
    personHelpedId: number;
    date: string;
    appreciation: string | null;
  }[];
  nextRequestsOffset: number | null;
  nextContributionsOffset: number | null;
}> {
  const [requests, contributions] = await Promise.all([
    getMyHelpRequestsPage(userId, { limit: DEFAULT_PAGE_SIZE, offset: 0 }),
    getMyHelpContributionsPage(userId, { limit: DEFAULT_PAGE_SIZE, offset: 0 })
  ]);
  return {
    requests: requests.items,
    contributions: contributions.items,
    nextRequestsOffset: requests.nextOffset,
    nextContributionsOffset: contributions.nextOffset
  };
}

/**
 * Author extends active duration (within HELP_MAX_AUTHOR_EXTENDS).
 * Adds one category-duration window from now (or from current expiresAt if still future).
 */
export async function extendHelpRequest(
  ownerUserId: number,
  postId: number
): Promise<{
  status: string;
  helpExpiresAt: string;
  helpExtendedCount: number;
  maxExtends: number;
}> {
  const post = await assertHelpPost(postId, ownerUserId);
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Only the requester can extend this request"), { status: 403 });
  }
  if (!isHelpActivelyOpen(post.helpStatus)) {
    throw Object.assign(new Error("Only active requests can be extended"), { status: 400 });
  }
  const count = post.helpExtendedCount ?? 0;
  if (count >= HELP_MAX_AUTHOR_EXTENDS) {
    throw Object.assign(
      new Error(`You can extend a request at most ${HELP_MAX_AUTHOR_EXTENDS} times`),
      { status: 400 }
    );
  }

  const now = new Date();
  const base =
    post.helpExpiresAt && post.helpExpiresAt.getTime() > now.getTime()
      ? post.helpExpiresAt
      : now;
  const hours = resolveHelpActiveHours(post.helpCategory);
  const nextExpiry = new Date(base.getTime() + hours * 60 * 60 * 1000);

  await post.update({
    helpExpiresAt: nextExpiry,
    helpExtendedCount: count + 1,
    helpExpiryReminder: null
  });

  return {
    status: post.helpStatus ?? "OPEN",
    helpExpiresAt: nextExpiry.toISOString(),
    helpExtendedCount: count + 1,
    maxExtends: HELP_MAX_AUTHOR_EXTENDS
  };
}

export const helpingHandsService = {
  getHelpingHandsStats,
  offerHelp,
  listHelpersForPost,
  completeHelpRequest,
  extendHelpRequest,
  getCommunityHeroes,
  getMyHelpingActivity,
  getMyHelpRequestsPage,
  getMyHelpContributionsPage
};
