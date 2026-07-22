import { Op } from "sequelize";
import { Post, User, HelpOffer, HelpAppreciation } from "../models";
import {
  HELP_APPRECIATION_MAX,
  HELP_CATEGORY_LABELS,
  HELP_MAX_AUTHOR_EXTENDS,
  isHelpActivelyOpen,
  resolveHelpActiveHours,
  type HelpCategory
} from "../constants/helpingHands.constants";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import * as Notifications from "./Notification.service";

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
}> {
  const me = await User.findByPk(userId, { attributes: ["community"] });
  const community = me?.community ?? null;
  const communityUsers = await User.findAll({
    where: { status: "APPROVED", community },
    attributes: ["id"]
  });
  const ids = communityUsers.map((u) => u.id);
  if (ids.length === 0) {
    return { peopleHelped: 0, activeVolunteers: 0, requestsCompleted: 0, livesTouched: 0 };
  }

  const [completed, openActive, communityHelpPosts] = await Promise.all([
    Post.count({
      where: {
        postType: "HELP_REQUEST",
        helpStatus: "COMPLETED",
        userId: { [Op.in]: ids }
      }
    }),
    Post.count({
      where: {
        postType: "HELP_REQUEST",
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        userId: { [Op.in]: ids }
      }
    }),
    Post.findAll({
      where: {
        postType: "HELP_REQUEST",
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        userId: { [Op.in]: ids }
      },
      attributes: ["id"]
    })
  ]);

  const openPostIds = communityHelpPosts.map((p) => p.id);
  let activeVolunteers = 0;
  if (openPostIds.length) {
    const offers = await HelpOffer.findAll({
      where: { postId: { [Op.in]: openPostIds }, status: "ACTIVE" },
      attributes: ["fromUserId"],
      raw: true
    });
    activeVolunteers = new Set((offers as { fromUserId: number }[]).map((o) => o.fromUserId)).size;
  }

  return {
    peopleHelped: completed,
    activeVolunteers,
    requestsCompleted: completed,
    livesTouched: completed + openActive
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
      const profile_image =
        (await toSignedUrlIfR2(author.profilePhoto ?? null)) ?? author.profilePhoto ?? null;
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
  opts?: { helperUserId?: number; appreciation?: string | null }
): Promise<{ status: string; appreciationSaved: boolean }> {
  const post = await assertHelpPost(postId, ownerUserId);
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Only the requester can mark this completed"), { status: 403 });
  }
  if (post.helpStatus === "COMPLETED") {
    return { status: "COMPLETED", appreciationSaved: false };
  }

  await post.update({
    helpStatus: "COMPLETED",
    urgent: false,
    helpResolvedAt: new Date(),
    helpResolvedBy: ownerUserId
  });

  void Notifications.notifyHelpRequestResolved(ownerUserId, post.id, post.title).catch(() => {});

  let appreciationSaved = false;
  const helperUserId = opts?.helperUserId;
  const appreciation = opts?.appreciation?.trim();

  if (helperUserId && appreciation) {
    if (appreciation.length > HELP_APPRECIATION_MAX) {
      throw Object.assign(new Error("Appreciation is too long"), { status: 400 });
    }
    const offer = await HelpOffer.findOne({
      where: { postId, fromUserId: helperUserId, status: "ACTIVE" }
    });
    if (!offer) {
      throw Object.assign(new Error("Helper not found on this request"), { status: 400 });
    }
    await HelpAppreciation.findOrCreate({
      where: { postId, helperUserId },
      defaults: {
        postId,
        helperUserId,
        fromUserId: ownerUserId,
        message: appreciation.slice(0, HELP_APPRECIATION_MAX)
      } as any
    });
    appreciationSaved = true;
    void Notifications.notifyHelpAppreciationReceived(
      helperUserId,
      ownerUserId,
      post.id,
      post.title,
      appreciation.slice(0, 120)
    ).catch(() => {});
  }

  const helpers = await HelpOffer.findAll({
    where: { postId, status: "ACTIVE" },
    attributes: ["fromUserId"]
  });
  for (const h of helpers) {
    void Notifications.notifyHelpRequestCompleted(h.fromUserId, post.id, post.title).catch(
      () => {}
    );
  }

  return { status: "COMPLETED", appreciationSaved };
}

export async function getCommunityHeroes(
  userId: number,
  limit = 20
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
}> {
  const me = await User.findByPk(userId, { attributes: ["community"] });
  const community = me?.community ?? null;
  const communityUsers = await User.findAll({
    where: { status: "APPROVED", community },
    attributes: ["id"]
  });
  const ids = communityUsers.map((u) => u.id);
  if (!ids.length) return { items: [] };

  // Completed help offers in this community
  const completedPosts = await Post.findAll({
    where: {
      postType: "HELP_REQUEST",
      helpStatus: "COMPLETED",
      userId: { [Op.in]: ids }
    },
    attributes: ["id", "helpCategory"]
  });
  const postIds = completedPosts.map((p) => p.id);
  const categoryByPost = new Map(completedPosts.map((p) => [p.id, p.helpCategory]));

  if (!postIds.length) return { items: [] };

  const offers = await HelpOffer.findAll({
    where: { postId: { [Op.in]: postIds }, status: "ACTIVE" },
    attributes: ["fromUserId", "postId"]
  });

  const lives = new Map<number, number>();
  const cats = new Map<number, Set<string>>();
  for (const o of offers) {
    lives.set(o.fromUserId, (lives.get(o.fromUserId) || 0) + 1);
    const cat = categoryByPost.get(o.postId);
    if (cat) {
      if (!cats.has(o.fromUserId)) cats.set(o.fromUserId, new Set());
      cats.get(o.fromUserId)!.add(cat);
    }
  }

  const ranked = [...lives.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const helperIds = ranked.map(([id]) => id);
  const users = await User.findAll({
    where: { id: { [Op.in]: helperIds } },
    attributes: ["id", "fullName", "profilePhoto"]
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const appreciations = await HelpAppreciation.findAll({
    where: { helperUserId: { [Op.in]: helperIds } },
    order: [["createdAt", "DESC"]]
  });
  const recentByHelper = new Map<number, string>();
  for (const a of appreciations) {
    if (!recentByHelper.has(a.helperUserId)) recentByHelper.set(a.helperUserId, a.message);
  }

  const items = await Promise.all(
    ranked.map(async ([id, count]) => {
      const u = userMap.get(id);
      const profileImage =
        (await toSignedUrlIfR2(u?.profilePhoto ?? null)) ?? u?.profilePhoto ?? null;
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

  return { items };
}

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
}> {
  const myPosts = await Post.findAll({
    where: { userId, postType: "HELP_REQUEST" },
    order: [["createdAt", "DESC"]],
    limit: 50
  });
  const myPostIds = myPosts.map((p) => p.id);
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

  const requests = myPosts.map((p) => ({
    postId: p.id,
    title: p.title,
    status: p.helpStatus ?? "OPEN",
    category: p.helpCategory,
    createdAt: p.createdAt.toISOString(),
    helperCount: countMap[p.id] || 0
  }));

  const myOffers = await HelpOffer.findAll({
    where: { fromUserId: userId, status: "ACTIVE" },
    order: [["createdAt", "DESC"]],
    limit: 50
  });
  const offerPostIds = myOffers.map((o) => o.postId);
  const offerPosts =
    offerPostIds.length === 0
      ? []
      : await Post.findAll({
          where: { id: { [Op.in]: offerPostIds }, postType: "HELP_REQUEST" },
          include: [{ association: "User", attributes: ["id", "fullName"], required: true }]
        });
  const postMap = new Map(offerPosts.map((p) => [p.id, p]));
  const apprs = offerPostIds.length
    ? await HelpAppreciation.findAll({
        where: { helperUserId: userId, postId: { [Op.in]: offerPostIds } }
      })
    : [];
  const apprMap = new Map(apprs.map((a) => [a.postId, a.message]));

  const contributions = myOffers
    .map((o) => {
      const p = postMap.get(o.postId);
      if (!p) return null;
      const author = (p as any).User as User;
      return {
        postId: p.id,
        title: p.title,
        category: p.helpCategory,
        personHelped: author?.fullName ?? "Member",
        personHelpedId: p.userId,
        date: o.createdAt.toISOString(),
        appreciation: apprMap.get(p.id) ?? null
      };
    })
    .filter(Boolean) as any[];

  return { requests, contributions };
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
  getMyHelpingActivity
};
