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
  const isRepost = Boolean(post.originalPostId);
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
  if (!isRepost && post.postType === "JOB") {
    const { JobInterest } = await import("../../models");
    await JobInterest.destroy({ where: { postId } });
  }
  if (!isRepost && post.postType === "HELP_REQUEST") {
    const { HelpOffer, HelpAppreciation } = await import("../../models");
    await HelpOffer.destroy({ where: { postId } });
    await HelpAppreciation.destroy({ where: { postId } });
  }
  await post.destroy();
  // Repost rows only reference the original's media keys — never delete R2 objects.
  if (!isRepost) {
    await Promise.all([...new Set(gallery)].map((u) => deleteR2ImageVariants(u)));
  }
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

  const wrapper = post;
  const wrapperAuthor = (post as any).User as User;
  let display = post;
  let author = wrapperAuthor;
  const isRepost = Boolean(post.originalPostId);

  if (isRepost && post.originalPostId) {
    const original = await Post.findByPk(post.originalPostId, {
      include: [
        {
          association: "User",
          attributes: ["id", "fullName", "profilePhoto", "status"],
          required: true
        }
      ]
    });
    if (!original) {
      const err = new Error("Post not found");
      (err as any).status = 404;
      throw err;
    }
    display = original;
    author = (original as any).User as User;
  }

  await ensureCommunityVisible(wrapper, userId);
  const contentPostId = display.id;
  const isOwner = display.userId === userId;
  if (isHiddenFromPublic(display) && !isOwner) {
    // Applications list shows ACTIVE jobs you applied to even when safety is still
    // PENDING/PROCESSING (quarantine). Allow those applicants to open the job again;
    // never surface BLOCKED content this way.
    let canApplicantView = false;
    if (
      display.postType === "JOB" &&
      display.moderationStatus === "ACTIVE" &&
      display.safetyDecision !== "BLOCKED"
    ) {
      const { JobInterest } = await import("../../models");
      const application = await JobInterest.findOne({
        where: { postId: contentPostId, fromUserId: userId },
        attributes: ["id"]
      });
      canApplicantView = Boolean(application);
    }
    if (!canApplicantView) {
      const err = new Error("Post not found");
      (err as any).status = 404;
      throw err;
    }
  }

  if (display.postType === "MARKETPLACE") {
    if (display.marketplaceStatus !== "LIVE" && !isOwner) {
      const err = new Error("Post not found");
      (err as any).status = 404;
      throw err;
    }
  }

  const isHelp = display.postType === "HELP_REQUEST";
  const { mediaService } = await import("../Media.service");
  let storedMediaKey = display.mediaUrl;
  let storedThumbKey = display.thumbnailUrl;
  if (storedMediaKey) {
    storedMediaKey =
      (await mediaService.resolveLiveMediaKey(display.userId, storedMediaKey)) ?? storedMediaKey;
  }
  if (storedThumbKey) {
    storedThumbKey =
      (await mediaService.resolveLiveMediaKey(display.userId, storedThumbKey)) ?? storedThumbKey;
  }
  const galleryParsed =
    display.postType === "MARKETPLACE"
      ? parseMarketplaceGallery(display.marketplaceGallery, display.mediaUrl ?? null)
      : isHelp
        ? parseHelpGallery(display.helpGallery, display.mediaUrl ?? null)
        : [];
  const galleryRaw = galleryParsed.length
    ? await mediaService.resolvePublicGalleryKeys(display.userId, galleryParsed)
    : [];
  const canSignPrivate = isOwner || display.safetyDecision === "SAFE";
  const [likeCount, commentCount, likedByMe, savedByMe, mediaUrl, thumbnailUrl, authorDto, gallerySigned, myRepost] =
    await Promise.all([
      PostLike.count({ where: { postId: contentPostId } }),
      Comment.count({ where: { postId: contentPostId } }),
      PostLike.findOne({ where: { postId: contentPostId, userId } }).then((r) => !!r),
      SavedPost.findOne({ where: { postId: contentPostId, userId } }).then((r) => !!r),
      canSignPrivate && isPrivateR2Object(storedMediaKey)
        ? toPrivateSignedUrlIfR2(storedMediaKey)
        : Promise.resolve(toPublicUrlIfR2(storedMediaKey ?? null)),
      canSignPrivate && isPrivateR2Object(storedThumbKey)
        ? toPrivateSignedUrlIfR2(storedThumbKey)
        : Promise.resolve(toPublicUrlIfR2(storedThumbKey ?? null)),
      Promise.resolve(toAuthorDto(author)),
      display.postType === "MARKETPLACE"
        ? publicMarketplaceGallery(galleryRaw, { signPrivate: canSignPrivate })
        : isHelp
          ? publicHelpGallery(galleryRaw, { signPrivate: canSignPrivate })
          : Promise.resolve([] as string[]),
      Post.findOne({
        where: { userId, originalPostId: contentPostId, moderationStatus: "ACTIVE" },
        attributes: ["id"]
      })
    ]);

  let jobExtra: {
    job_interested_by_me?: boolean;
    job_interest_count?: number;
    job_can_message_poster?: boolean;
    job_application_status?: string | null;
    job_interest_id?: number | null;
    job_listing_status?: string;
    job_accepting_applications?: boolean;
  } = {};
  if (display.postType === "JOB") {
    const JobInterestService = await import("../JobInterest.service");
    const { deriveJobListingStatus, isJobAcceptingApplications } = await import(
      "../../utils/jobListingStatus"
    );
    const [interestCount, myInterest] = await Promise.all([
      JobInterestService.countJobInterests(contentPostId),
      JobInterestService.getMyJobInterest(userId, contentPostId)
    ]);
    jobExtra = {
      job_interest_count: interestCount,
      job_interested_by_me: myInterest.interested,
      job_can_message_poster: myInterest.canMessage,
      job_application_status: myInterest.status,
      job_interest_id: myInterest.interestId,
      job_listing_status: deriveJobListingStatus(display),
      job_accepting_applications: isJobAcceptingApplications(display)
    };
  }

  let helpExtra: {
    help_helper_count?: number;
    help_offered_by_me?: boolean;
  } = {};
  if (isHelp) {
    const { HelpOffer } = await import("../../models");
    const [helperCount, myOffer] = await Promise.all([
      HelpOffer.count({ where: { postId: contentPostId, status: "ACTIVE" } }),
      HelpOffer.findOne({ where: { postId: contentPostId, fromUserId: userId, status: "ACTIVE" } })
    ]);
    helpExtra = {
      help_helper_count: helperCount,
      help_offered_by_me: !!myOffer
    };
  }

  const wrapperAuthorDto = isRepost ? toAuthorDto(wrapperAuthor) : null;

  return {
    id: wrapper.id,
    user_id: display.userId,
    post_type: display.postType,
    title: display.title,
    description: display.description ?? null,
    ...mediaMetaFromPost(display, mediaUrl, thumbnailUrl),
    pinned: display.pinned,
    urgent: display.urgent,
    meetup_at: display.meetupAt ? display.meetupAt.toISOString() : null,
    job_status: display.jobStatus ?? null,
    ...jobFieldsFromPost(display),
    ...marketplaceFieldsFromPost(
      display,
      display.postType === "MARKETPLACE" ? gallerySigned : undefined
    ),
    ...helpFieldsFromPost(
      display,
      isHelp ? gallerySigned : undefined
    ),
    ...visibilityFieldsFromPost(display),
    created_at: display.createdAt.toISOString(),
    updated_at: display.updatedAt.toISOString(),
    author: authorDto,
    like_count: likeCount,
    comment_count: commentCount,
    liked_by_me: likedByMe,
    saved_by_me: savedByMe,
    safety_decision: isOwner ? display.safetyDecision : undefined,
    safety_category: isOwner ? display.safetyCategory ?? null : undefined,
    ...jobExtra,
    ...helpExtra,
    is_repost: isRepost,
    original_post_id: wrapper.originalPostId ?? null,
    original_author: isRepost ? authorDto : null,
    reposted_by: wrapperAuthorDto,
    reposted_by_me: Boolean(myRepost)
  };
}
