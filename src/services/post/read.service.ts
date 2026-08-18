import { Post, PostLike, Comment, SavedPost, User } from "../../models";
import { toPublicUrlIfR2, toPrivateSignedUrlIfR2, isPrivateR2Object, deleteR2ImageVariants } from "../../utils/r2Client";
import { parseMarketplaceGallery, publicMarketplaceGallery } from "../../utils/marketplaceGallery";
import { parseHelpGallery, publicHelpGallery } from "../../utils/helpGallery";
import {
  ensureCommunityVisible
} from "./access";
import { isHiddenFromPublic } from "../contentSafety/publicVisibility";
import {
  jobFieldsFromPost,
  marketplaceFieldsFromPost,
  helpFieldsFromPost,
  mediaMetaFromPost,
  toAuthorDto,
  visibilityFieldsFromPost
} from "./mappers";
import type { PostAuthorDto, PostDetailDto } from "./types";

export async function deletePost(userId: number, postId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  if (post.userId !== userId) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
  const mediaUrl = post.mediaUrl;
  const gallery =
    post.postType === "MARKETPLACE"
      ? parseMarketplaceGallery(post.marketplaceGallery, mediaUrl)
      : post.postType === "HELP_REQUEST"
        ? parseHelpGallery(post.helpGallery, mediaUrl)
        : mediaUrl
          ? [mediaUrl]
          : [];
  if (post.thumbnailUrl) gallery.push(post.thumbnailUrl);
  if (post.postType === "JOB") {
    const { JobInterest } = await import("../../models");
    await JobInterest.destroy({ where: { postId } });
  }
  if (post.postType === "HELP_REQUEST") {
    const { HelpOffer, HelpAppreciation } = await import("../../models");
    await HelpOffer.destroy({ where: { postId } });
    await HelpAppreciation.destroy({ where: { postId } });
  }
  await post.destroy();
  await Promise.all(
    [...new Set(gallery)].map((u) => deleteR2ImageVariants(u))
  );
}

export async function getPost(userId: number, postId: number): Promise<PostDetailDto> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "profilePhoto", "status"],
        required: true
      }
    ]
  });
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  const author = (post as any).User as User;
  await ensureCommunityVisible(post, userId);
  const isOwner = post.userId === userId;
  if (isHiddenFromPublic(post) && !isOwner) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

  if (post.postType === "MARKETPLACE") {
    if (post.marketplaceStatus !== "LIVE" && !isOwner) {
      const err = new Error("Post not found");
      (err as any).status = 404;
      throw err;
    }
  }

  const isHelp = post.postType === "HELP_REQUEST";
  const galleryRaw =
    post.postType === "MARKETPLACE"
      ? parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null)
      : isHelp
        ? parseHelpGallery(post.helpGallery, post.mediaUrl ?? null)
        : [];
  const [likeCount, commentCount, likedByMe, savedByMe, mediaUrl, thumbnailUrl, authorDto, gallerySigned] =
    await Promise.all([
      PostLike.count({ where: { postId } }),
      Comment.count({ where: { postId } }),
      PostLike.findOne({ where: { postId, userId } }).then((r) => !!r),
      SavedPost.findOne({ where: { postId, userId } }).then((r) => !!r),
      isOwner && isPrivateR2Object(post.mediaUrl)
        ? toPrivateSignedUrlIfR2(post.mediaUrl)
        : Promise.resolve(toPublicUrlIfR2(post.mediaUrl ?? null)),
      isOwner && isPrivateR2Object(post.thumbnailUrl)
        ? toPrivateSignedUrlIfR2(post.thumbnailUrl)
        : Promise.resolve(toPublicUrlIfR2(post.thumbnailUrl ?? null)),
      toAuthorDto(author),
      post.postType === "MARKETPLACE"
        ? publicMarketplaceGallery(galleryRaw, { signPrivate: isOwner })
        : isHelp
          ? publicHelpGallery(galleryRaw, { signPrivate: isOwner })
          : Promise.resolve([] as string[])
    ]);

  let jobExtra: {
    job_interested_by_me?: boolean;
    job_interest_count?: number;
    job_can_message_poster?: boolean;
  } = {};
  if (post.postType === "JOB") {
    const JobInterestService = await import("../JobInterest.service");
    const [interestCount, myInterest] = await Promise.all([
      JobInterestService.countJobInterests(postId),
      JobInterestService.getMyJobInterest(userId, postId)
    ]);
    jobExtra = {
      job_interest_count: interestCount,
      job_interested_by_me: myInterest.interested,
      job_can_message_poster: myInterest.canMessage
    };
  }

  let helpExtra: {
    help_helper_count?: number;
    help_offered_by_me?: boolean;
  } = {};
  if (isHelp) {
    const { HelpOffer } = await import("../../models");
    const [helperCount, myOffer] = await Promise.all([
      HelpOffer.count({ where: { postId, status: "ACTIVE" } }),
      HelpOffer.findOne({ where: { postId, fromUserId: userId, status: "ACTIVE" } })
    ]);
    helpExtra = {
      help_helper_count: helperCount,
      help_offered_by_me: !!myOffer
    };
  }

  let repostExtra: {
    is_repost?: boolean;
    original_post_id?: number | null;
    original_author?: PostAuthorDto | null;
  } = {};
  if (post.originalPostId) {
    const original = await Post.findByPk(post.originalPostId, {
      include: [
        { association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }
      ]
    });
    const originalUser = original ? ((original as any).User as User) : null;
    repostExtra = {
      is_repost: true,
      original_post_id: post.originalPostId,
      original_author: originalUser ? toAuthorDto(originalUser) : null
    };
  }

  return {
    id: post.id,
    user_id: post.userId,
    post_type: post.postType,
    title: post.title,
    description: post.description ?? null,
    ...mediaMetaFromPost(post, mediaUrl, thumbnailUrl),
    pinned: post.pinned,
    urgent: post.urgent,
    meetup_at: post.meetupAt ? post.meetupAt.toISOString() : null,
    job_status: post.jobStatus ?? null,
    ...jobFieldsFromPost(post),
    ...marketplaceFieldsFromPost(
      post,
      post.postType === "MARKETPLACE" ? gallerySigned : undefined
    ),
    ...helpFieldsFromPost(
      post,
      isHelp ? gallerySigned : undefined
    ),
    ...visibilityFieldsFromPost(post),
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    author: authorDto,
    like_count: likeCount,
    comment_count: commentCount,
    liked_by_me: likedByMe,
    saved_by_me: savedByMe,
    safety_decision: isOwner ? post.safetyDecision : undefined,
    safety_category: isOwner ? post.safetyCategory ?? null : undefined,
    ...jobExtra,
    ...helpExtra,
    ...repostExtra
  };
}
