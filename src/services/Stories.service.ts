import { Op } from "sequelize";
import { Message, Story, StoryLike, StoryView, User } from "../models";
import { hasAcceptedConnection, listConnections } from "./Connection.service";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import { assertCanSendMessage } from "./MessagePermission.service";
import { emitMessageEvents } from "../realtime/messageEvents";
import { scheduleMessagePush } from "../realtime/messagePushQueue";
import {
  STORY_IMAGE_DURATION_MS,
  STORY_REPLY_MAX_LENGTH,
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC,
  normalizeStoryCaption,
  storyExpiresAt
} from "../constants/stories.constants";
import {
  isPrivateR2Object,
  toPrivateSignedUrlIfR2,
  toPublicUrlIfR2,
  deleteR2ImageVariants
} from "../utils/r2Client";
import {
  assertOwnedLocalStoryKey,
  buildSignedStoryMediaPath,
  deleteStoryFile,
  isLocalStoryKey,
  mimeFromStoryKey,
  readStoryFileStream,
  saveStoryFile,
  verifySignedStoryMediaQuery,
  type StoryMediaKind
} from "./StoryLocalStorage.service";

function serviceError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function isActiveStory(story: Story, now = new Date()): boolean {
  if (story.deletedAt) return false;
  return story.expiresAt.getTime() > now.getTime();
}

/** Legacy R2 keys only — new stories use local/stories/ keys. */
async function signLegacyR2MediaUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (isLocalStoryKey(url)) return null;
  if (isPrivateR2Object(url)) {
    return (await toPrivateSignedUrlIfR2(url)) ?? null;
  }
  return toPublicUrlIfR2(url) ?? url;
}

async function resolvePlayableUrls(
  story: Story,
  viewerId: number
): Promise<{ media: string | null; thumb: string | null }> {
  if (isLocalStoryKey(story.mediaUrl)) {
    return {
      media: buildSignedStoryMediaPath(story.id, viewerId, "file"),
      thumb: story.thumbnailUrl
        ? buildSignedStoryMediaPath(story.id, viewerId, "thumbnail")
        : null
    };
  }
  const [media, thumb] = await Promise.all([
    signLegacyR2MediaUrl(story.mediaUrl),
    signLegacyR2MediaUrl(story.thumbnailUrl)
  ]);
  return { media, thumb };
}

async function purgeStoryMedia(story: Story): Promise<void> {
  const keys = [story.mediaUrl, story.thumbnailUrl].filter(Boolean) as string[];
  await Promise.all(
    keys.map(async (k) => {
      if (isLocalStoryKey(k)) {
        await deleteStoryFile(k);
        return;
      }
      await deleteR2ImageVariants(k).catch(() => undefined);
    })
  );
}

async function assertCanViewStory(viewerId: number, story: Story): Promise<void> {
  if (!isActiveStory(story)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  if (story.userId === viewerId) return;

  const blocked = await getBlockedUserIds(viewerId).catch(() => new Set<number>());
  if (blocked.has(story.userId)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }

  const connected = await hasAcceptedConnection(viewerId, story.userId);
  if (!connected) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
}

function toStoryDto(
  story: Story,
  mediaUrl: string | null,
  thumbnailUrl: string | null,
  extras?: {
    viewed_by_me?: boolean;
    view_count?: number;
    liked_by_me?: boolean;
    like_count?: number;
  }
) {
  const durationMs =
    story.mediaType === "video"
      ? Math.min(
          Math.max((story.durationSeconds ?? STORY_VIDEO_MIN_DURATION_SEC) * 1000, 1000),
          STORY_VIDEO_MAX_DURATION_SEC * 1000
        )
      : STORY_IMAGE_DURATION_MS;
  return {
    id: story.id,
    user_id: story.userId,
    media_type: story.mediaType,
    media_url: mediaUrl,
    caption: story.caption ?? null,
    thumbnail_url: thumbnailUrl,
    duration_seconds: story.durationSeconds ?? null,
    duration_ms: durationMs,
    created_at: story.createdAt.toISOString(),
    expires_at: story.expiresAt.toISOString(),
    liked_by_me: extras?.liked_by_me ?? false,
    like_count: extras?.like_count ?? story.likeCount ?? 0,
    ...(extras?.viewed_by_me != null ? { viewed_by_me: extras.viewed_by_me } : {}),
    ...(extras?.view_count != null ? { view_count: extras.view_count } : {})
  };
}

export type CreateStoryInput = {
  media_url: string;
  media_type: "image" | "video";
  caption?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
};

export async function createStory(userId: number, input: CreateStoryInput) {
  const mediaUrl = input.media_url?.trim();
  if (!mediaUrl) serviceError("Media is required", 400, "MEDIA_REQUIRED");
  // New stories must use local server storage (not R2).
  assertOwnedLocalStoryKey(userId, mediaUrl);
  if (input.media_type !== "image" && input.media_type !== "video") {
    serviceError("Invalid media type", 400, "INVALID_MEDIA_TYPE");
  }

  let durationSeconds: number | null = null;
  if (input.media_type === "video") {
    const d = Number(input.duration_seconds);
    if (!Number.isFinite(d) || d < STORY_VIDEO_MIN_DURATION_SEC) {
      serviceError("Invalid video duration", 400, "INVALID_DURATION");
    }
    if (d > STORY_VIDEO_MAX_DURATION_SEC) {
      serviceError("Videos must be 30 seconds or less.", 400, "VIDEO_TOO_LONG");
    }
    durationSeconds = Math.floor(d);
  }

  let thumbnailUrl: string | null = null;
  if (input.thumbnail_url?.trim()) {
    assertOwnedLocalStoryKey(userId, input.thumbnail_url.trim());
    thumbnailUrl = input.thumbnail_url.trim();
  }

  const now = new Date();
  const story = await Story.create({
    userId,
    mediaType: input.media_type,
    mediaUrl,
    caption: normalizeStoryCaption(input.caption),
    thumbnailUrl,
    durationSeconds,
    mimeType: input.mime_type ?? null,
    fileSize: input.file_size ?? null,
    likeCount: 0,
    createdAt: now,
    expiresAt: storyExpiresAt(now),
    deletedAt: null
  });

  const { media, thumb } = await resolvePlayableUrls(story, userId);
  return toStoryDto(story, media, thumb, {
    viewed_by_me: true,
    view_count: 0,
    liked_by_me: false,
    like_count: 0
  });
}

/** PUT /api/stories/upload — write image/video bytes to the API server disk.
 * No R2, no media worker finalize, no content-safety / quarantine scan.
 */
export async function uploadStoryMediaBytes(
  userId: number,
  buffer: Buffer,
  mimeType: string
): Promise<{ key: string; byte_size: number; mime_type: string }> {
  const saved = await saveStoryFile(userId, buffer, mimeType);
  return {
    key: saved.key,
    byte_size: saved.byteSize,
    mime_type: saved.mimeType
  };
}

export async function listStoryTray(viewerId: number) {
  const now = new Date();
  const [connections, blocked] = await Promise.all([
    listConnections(viewerId),
    getBlockedUserIds(viewerId).catch(() => new Set<number>())
  ]);
  const peerIds = connections
    .map((c) => c.user.id)
    .filter((id) => id !== viewerId && !blocked.has(id));
  const authorIds = [viewerId, ...peerIds];

  const stories = await Story.findAll({
    where: {
      userId: { [Op.in]: authorIds },
      deletedAt: null,
      expiresAt: { [Op.gt]: now }
    },
    order: [
      ["userId", "ASC"],
      ["createdAt", "ASC"]
    ],
    limit: 500
  });

  const storyIds = stories.map((s) => s.id);
  const myViews =
    storyIds.length === 0
      ? []
      : await StoryView.findAll({
          where: { viewerId, storyId: { [Op.in]: storyIds } },
          attributes: ["storyId"]
        });
  const viewedSet = new Set(myViews.map((v) => v.storyId));

  const myLikes =
    storyIds.length === 0
      ? []
      : await StoryLike.findAll({
          where: { userId: viewerId, storyId: { [Op.in]: storyIds } },
          attributes: ["storyId"]
        });
  const likedSet = new Set(myLikes.map((l) => l.storyId));

  const byUser = new Map<number, Story[]>();
  for (const s of stories) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  const userIds = [...byUser.keys()];
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ["id", "fullName", "username", "profilePhoto"]
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const ownerViewCounts = new Map<number, number>();
  if (byUser.has(viewerId)) {
    const ownIds = (byUser.get(viewerId) ?? []).map((s) => s.id);
    if (ownIds.length) {
      const counts = await StoryView.findAll({
        where: { storyId: { [Op.in]: ownIds } },
        attributes: ["storyId"]
      });
      for (const row of counts) {
        ownerViewCounts.set(row.storyId, (ownerViewCounts.get(row.storyId) ?? 0) + 1);
      }
    }
  }

  type Group = {
    user: {
      id: number;
      name: string;
      username: string | null;
      profile_image: string | null;
    };
    has_unseen: boolean;
    latest_at: string;
    is_own: boolean;
    stories: ReturnType<typeof toStoryDto>[];
  };

  const groups: Group[] = [];
  for (const [uid, list] of byUser) {
    const u = userMap.get(uid);
    if (!u) continue;
    const signedStories = await Promise.all(
      list.map(async (s) => {
        const { media, thumb } = await resolvePlayableUrls(s, viewerId);
        return toStoryDto(s, media, thumb, {
          viewed_by_me: uid === viewerId ? true : viewedSet.has(s.id),
          view_count: uid === viewerId ? ownerViewCounts.get(s.id) ?? 0 : undefined,
          liked_by_me: likedSet.has(s.id),
          like_count: s.likeCount ?? 0
        });
      })
    );
    const hasUnseen =
      uid === viewerId ? false : signedStories.some((s) => s.viewed_by_me === false);
    const latest = list[list.length - 1]!;
    groups.push({
      user: {
        id: u.id,
        name: u.fullName,
        username: u.username ?? null,
        profile_image: toPublicUrlIfR2(u.profilePhoto ?? null)
      },
      has_unseen: hasUnseen,
      latest_at: latest.createdAt.toISOString(),
      is_own: uid === viewerId,
      stories: signedStories
    });
  }

  groups.sort((a, b) => {
    if (a.is_own !== b.is_own) return a.is_own ? -1 : 1;
    if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;
    return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
  });

  return { groups };
}

export async function getStory(viewerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);
  const { media, thumb } = await resolvePlayableUrls(story, viewerId);
  let viewCount: number | undefined;
  if (story.userId === viewerId) {
    viewCount = await StoryView.count({ where: { storyId: story.id } });
  }
  const viewed =
    story.userId === viewerId
      ? true
      : !!(await StoryView.findOne({
          where: { storyId: story.id, viewerId },
          attributes: ["id"]
        }));
  const liked = !!(await StoryLike.findOne({
    where: { storyId: story.id, userId: viewerId },
    attributes: ["id"]
  }));
  return toStoryDto(story, media, thumb, {
    viewed_by_me: viewed,
    view_count: viewCount,
    liked_by_me: liked,
    like_count: story.likeCount ?? 0
  });
}

export async function markStoryViewed(viewerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);
  if (story.userId === viewerId) {
    return { viewed: true, counted: false };
  }
  const now = new Date();
  const [row, created] = await StoryView.findOrCreate({
    where: { storyId: story.id, viewerId },
    defaults: {
      storyId: story.id,
      viewerId,
      viewedAt: now,
      createdAt: now,
      updatedAt: now
    }
  });
  if (!created && row.viewedAt.getTime() !== now.getTime()) {
    await row.update({ viewedAt: now, updatedAt: now });
  }
  return { viewed: true, counted: created };
}

export async function listStoryViewers(ownerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt || !isActiveStory(story)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  if (story.userId !== ownerId) {
    serviceError("Forbidden", 403, "FORBIDDEN");
  }
  const views = await StoryView.findAll({
    where: { storyId: story.id },
    order: [["viewedAt", "DESC"]],
    limit: 200
  });
  const viewerIds = views.map((v) => v.viewerId);
  const users = viewerIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: viewerIds } },
        attributes: ["id", "fullName", "username", "profilePhoto"]
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  return {
    viewers: views
      .map((v) => {
        const u = userMap.get(v.viewerId);
        if (!u) return null;
        return {
          user_id: u.id,
          name: u.fullName,
          username: u.username ?? null,
          profile_image: toPublicUrlIfR2(u.profilePhoto ?? null),
          viewed_at: v.viewedAt.toISOString()
        };
      })
      .filter(Boolean)
  };
}

export async function deleteStory(ownerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  if (story.userId !== ownerId) {
    serviceError("Forbidden", 403, "FORBIDDEN");
  }
  await story.update({ deletedAt: new Date() });
  await StoryView.destroy({ where: { storyId: story.id } });
  await StoryLike.destroy({ where: { storyId: story.id } });
  await purgeStoryMedia(story);
  return { deleted: true };
}

/**
 * Soft-delete expired rows and permanently delete media files from local disk
 * (or legacy R2). Expiry auth still uses expires_at — this is cleanup only.
 */
export async function cleanupExpiredStories(limit = 100): Promise<number> {
  const now = new Date();
  const rows = await Story.findAll({
    where: {
      deletedAt: null,
      expiresAt: { [Op.lte]: now }
    },
    limit,
    order: [["expiresAt", "ASC"]]
  });
  let n = 0;
  for (const story of rows) {
    await story.update({ deletedAt: now });
    await StoryView.destroy({ where: { storyId: story.id } });
    await StoryLike.destroy({ where: { storyId: story.id } });
    await purgeStoryMedia(story);
    n += 1;
  }
  return n;
}

export async function toggleStoryLike(viewerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);

  const existing = await StoryLike.findOne({
    where: { storyId: story.id, userId: viewerId }
  });
  if (existing) {
    await existing.destroy();
    const next = Math.max(0, (story.likeCount ?? 0) - 1);
    await story.update({ likeCount: next });
    return { liked: false, like_count: next };
  }
  await StoryLike.create({
    storyId: story.id,
    userId: viewerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const next = (story.likeCount ?? 0) + 1;
  await story.update({ likeCount: next });
  return { liked: true, like_count: next };
}

/**
 * Reply to a story → DM to the story owner with sharedStoryId mention.
 */
export async function replyToStory(viewerId: number, storyId: number, bodyRaw: string) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);
  if (story.userId === viewerId) {
    serviceError("Cannot reply to your own story", 400, "OWN_STORY");
  }

  const body = String(bodyRaw ?? "").trim().replace(/\s+/g, " ");
  if (!body) serviceError("Comment is required", 400, "EMPTY_REPLY");
  if (body.length > STORY_REPLY_MAX_LENGTH) {
    serviceError(
      `Comment must be ${STORY_REPLY_MAX_LENGTH} characters or less`,
      400,
      "REPLY_TOO_LONG"
    );
  }

  await assertCanSendMessage(viewerId, story.userId);

  const msg = await Message.create({
    senderId: viewerId,
    recipientId: story.userId,
    body,
    sharedPostId: null,
    sharedStoryId: story.id,
    clientId: null,
    deliveredAt: null,
    readAt: null
  } as any);

  const dto = {
    id: msg.id,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    body: msg.body,
    sharedPostId: null as number | null,
    sharedStoryId: story.id,
    clientId: null as string | null,
    deliveredAt: null as string | null,
    readAt: null as string | null,
    createdAt: msg.createdAt.toISOString()
  };
  emitMessageEvents(dto);
  scheduleMessagePush({
    messageId: msg.id,
    recipientId: story.userId,
    senderId: viewerId,
    body
  });

  return {
    sent: true,
    message: dto,
    recipient_user_id: story.userId
  };
}

/** Stream local story media after signature + connection checks. */
export async function openStoryMediaFile(
  viewerId: number,
  storyId: number,
  kind: StoryMediaKind,
  query: { v?: string; e?: string; s?: string }
) {
  const qViewer = Number(query.v);
  if (!Number.isInteger(qViewer) || qViewer !== viewerId) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  if (
    !verifySignedStoryMediaQuery({
      storyId,
      viewerId,
      kind,
      exp: query.e,
      sig: query.s
    })
  ) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }

  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);

  const key = kind === "thumbnail" ? story.thumbnailUrl : story.mediaUrl;
  if (!key || !isLocalStoryKey(key)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }

  const { absolutePath, stat } = await readStoryFileStream(key);
  return {
    absolutePath,
    byteSize: stat.size,
    mimeType: mimeFromStoryKey(key, story.mimeType ?? "application/octet-stream")
  };
}

export const storiesService = {
  createStory,
  uploadStoryMediaBytes,
  listStoryTray,
  getStory,
  markStoryViewed,
  listStoryViewers,
  deleteStory,
  cleanupExpiredStories,
  toggleStoryLike,
  replyToStory,
  openStoryMediaFile
};
