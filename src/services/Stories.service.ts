import { Op } from "sequelize";
import { Message, Story, StoryLike, StoryView, User } from "../models";
import { hasAcceptedConnection } from "./Connection.service";
import { getAcceptedConnectionUserIds } from "./PostVisibility.service";
import { getBlockedUserIds } from "./MatrimonySafety.service";
import { assertCanSendMessage } from "./MessagePermission.service";
import { emitMessageEvents } from "../realtime/messageEvents";
import { scheduleMessagePush } from "../realtime/messagePushQueue";
import {
  STORY_IMAGE_DURATION_MS,
  STORY_PURGED_MEDIA_KEY,
  STORY_R2_KEY_PREFIX,
  STORY_REPLY_MAX_LENGTH,
  STORY_TEXT_DURATION_MS,
  STORY_TEXT_MEDIA_KEY,
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC,
  normalizeStoryCaption,
  storyExpiresAt
} from "../constants/stories.constants";
import { isStoriesR2Backend } from "../config/storiesRuntime";
import {
  isPrivateR2Object,
  toPrivateSignedUrlIfR2,
  toPublicUrlIfR2,
  deleteR2ImageVariants
} from "../utils/r2Client";
import {
  absolutePathForStoryKey,
  assertOwnedLocalStoryKey,
  assertStoryVideoDuration,
  buildSignedStoryMediaPath,
  cleanupOrphanStoryUploads,
  deleteStoryFile,
  isLocalStoryKey,
  mimeFromStoryKey,
  promoteStoryUploadKey,
  readStoryFileStream,
  saveStoryFile,
  verifySignedStoryMediaQuery,
  type StoryMediaKind
} from "./StoryLocalStorage.service";
import {
  assertOwnedStoryR2Key,
  assertStoryR2ObjectReady,
  cleanupOrphanStoryR2Uploads,
  deleteStoryR2Object,
  isStoryR2Key,
  promoteStoryR2UploadKey,
  saveStoryR2File,
  signStoryR2PlaybackUrl
} from "./StoryR2Storage.service";
import { sequelize } from "../config/db";

function serviceError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function isActiveStory(story: Story, now = new Date()): boolean {
  if (story.deletedAt) return false;
  return story.expiresAt.getTime() > now.getTime();
}

function isPlaceholderStoryKey(key: string | null | undefined): boolean {
  if (!key) return true;
  return (
    key === STORY_TEXT_MEDIA_KEY ||
    key === STORY_PURGED_MEDIA_KEY ||
    key.startsWith("text:") ||
    key.startsWith("purged:")
  );
}

function usesGatewayPlayback(key: string | null | undefined): boolean {
  return Boolean(key && (isLocalStoryKey(key) || isStoryR2Key(key)));
}

/** Pre-migration R2 objects only — new stories use HMAC gateway URLs, not 6h private GET cache. */
async function signLegacyR2MediaUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || isPlaceholderStoryKey(url) || usesGatewayPlayback(url)) return null;
  if (isPrivateR2Object(url)) {
    return (await toPrivateSignedUrlIfR2(url)) ?? null;
  }
  return toPublicUrlIfR2(url) ?? url;
}

async function resolvePlayableUrls(
  story: Story,
  viewerId: number
): Promise<{ media: string | null; thumb: string | null }> {
  if (story.mediaType === "text" || isPlaceholderStoryKey(story.mediaUrl)) {
    return { media: null, thumb: null };
  }
  if (usesGatewayPlayback(story.mediaUrl)) {
    return {
      media: buildSignedStoryMediaPath(story.id, viewerId, "file"),
      thumb: story.thumbnailUrl && usesGatewayPlayback(story.thumbnailUrl)
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

function assertOwnedStoryUploadKey(userId: number, key: string): void {
  if (isLocalStoryKey(key)) {
    assertOwnedLocalStoryKey(userId, key);
    return;
  }
  if (isStoryR2Key(key)) {
    assertOwnedStoryR2Key(userId, key);
    return;
  }
  serviceError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
}

async function promoteOwnedStoryUploadKey(key: string): Promise<string> {
  if (isLocalStoryKey(key)) return promoteStoryUploadKey(key);
  if (isStoryR2Key(key)) return promoteStoryR2UploadKey(key);
  return key;
}

type PurgeStoryMediaResult = { mediaPurged: boolean; thumbPurged: boolean };

async function purgeOneStoryObject(key: string | null | undefined): Promise<boolean> {
  if (!key || isPlaceholderStoryKey(key)) return true;
  if (isLocalStoryKey(key)) {
    await deleteStoryFile(key);
    return true;
  }
  if (isStoryR2Key(key)) {
    return deleteStoryR2Object(key);
  }
  await deleteR2ImageVariants(key).catch(() => undefined);
  return true;
}

async function purgeStoryMedia(story: Story): Promise<PurgeStoryMediaResult> {
  const [mediaPurged, thumbPurged] = await Promise.all([
    purgeOneStoryObject(story.mediaUrl),
    purgeOneStoryObject(story.thumbnailUrl)
  ]);
  return { mediaPurged, thumbPurged };
}

async function markPurgedKeys(
  story: Story,
  result: PurgeStoryMediaResult
): Promise<void> {
  const patch: { mediaUrl?: string; thumbnailUrl?: string | null } = {};
  if (result.mediaPurged && isStoryR2Key(story.mediaUrl)) {
    patch.mediaUrl = STORY_PURGED_MEDIA_KEY;
  }
  if (result.thumbPurged && story.thumbnailUrl && isStoryR2Key(story.thumbnailUrl)) {
    patch.thumbnailUrl = STORY_PURGED_MEDIA_KEY;
  }
  if (Object.keys(patch).length) {
    await story.update(patch);
  }
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
      : story.mediaType === "text"
        ? STORY_TEXT_DURATION_MS
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
  media_url?: string | null;
  media_type: "image" | "video" | "text";
  caption?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
};

export async function createStory(userId: number, input: CreateStoryInput) {
  if (input.media_type === "text") {
    const caption = normalizeStoryCaption(input.caption);
    if (!caption) serviceError("Text is required", 400, "TEXT_REQUIRED");
    const now = new Date();
    const story = await Story.create({
      userId,
      mediaType: "text",
      mediaUrl: STORY_TEXT_MEDIA_KEY,
      caption,
      thumbnailUrl: null,
      durationSeconds: null,
      mimeType: "text/plain",
      fileSize: null,
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

  const mediaUrlRaw = input.media_url?.trim();
  if (!mediaUrlRaw) serviceError("Media is required", 400, "MEDIA_REQUIRED");
  assertOwnedStoryUploadKey(userId, mediaUrlRaw);
  if (input.media_type !== "image" && input.media_type !== "video") {
    serviceError("Invalid media type", 400, "INVALID_MEDIA_TYPE");
  }

  let mediaUrl = mediaUrlRaw;
  let thumbnailUrl: string | null = null;
  if (input.thumbnail_url?.trim()) {
    assertOwnedStoryUploadKey(userId, input.thumbnail_url.trim());
    thumbnailUrl = input.thumbnail_url.trim();
  }

  /** Authority: probe actual video bytes (local) or R2 metadata written at upload. */
  let durationSeconds: number | null = null;
  let mimeType = input.mime_type ?? null;
  let fileSize = input.file_size ?? null;
  if (isStoryR2Key(mediaUrl)) {
    const ready = await assertStoryR2ObjectReady(userId, mediaUrl);
    fileSize = ready.byteSize || fileSize;
    mimeType = ready.contentType ?? mimeType;
    if (input.media_type === "video") {
      durationSeconds =
        ready.durationSeconds != null && Number.isFinite(ready.durationSeconds)
          ? Math.floor(ready.durationSeconds)
          : null;
      if (
        durationSeconds == null ||
        durationSeconds < STORY_VIDEO_MIN_DURATION_SEC ||
        durationSeconds > STORY_VIDEO_MAX_DURATION_SEC
      ) {
        serviceError("Invalid or corrupt video", 400, "INVALID_VIDEO");
      }
    }
    if (thumbnailUrl && isStoryR2Key(thumbnailUrl)) {
      await assertStoryR2ObjectReady(userId, thumbnailUrl);
    }
  } else if (input.media_type === "video") {
    try {
      durationSeconds = await assertStoryVideoDuration(absolutePathForStoryKey(mediaUrl));
    } catch (e: any) {
      if (e?.status) throw e;
      serviceError("Invalid or corrupt video", 400, "INVALID_VIDEO");
    }
  }

  const now = new Date();
  const r2Upload = isStoryR2Key(mediaUrl);
  if (!r2Upload) {
    try {
      mediaUrl = await promoteOwnedStoryUploadKey(mediaUrl);
      if (thumbnailUrl) thumbnailUrl = await promoteOwnedStoryUploadKey(thumbnailUrl);
    } catch (e: any) {
      if (e?.status) throw e;
      serviceError("Invalid story media reference", 400, "INVALID_STORY_MEDIA");
    }
  }

  let story: Story;
  try {
    story = await Story.create({
      userId,
      mediaType: input.media_type,
      mediaUrl,
      caption: normalizeStoryCaption(input.caption),
      thumbnailUrl,
      durationSeconds,
      mimeType,
      fileSize,
      likeCount: 0,
      createdAt: now,
      expiresAt: storyExpiresAt(now),
      deletedAt: null
    });
  } catch (e) {
    if (isStoryR2Key(mediaUrl)) await deleteStoryR2Object(mediaUrl);
    if (thumbnailUrl && isStoryR2Key(thumbnailUrl)) await deleteStoryR2Object(thumbnailUrl);
    throw e;
  }

  if (r2Upload) {
    const originalMedia = mediaUrl;
    const originalThumb = thumbnailUrl;
    let promotedMedia = mediaUrl;
    let promotedThumb = thumbnailUrl;
    try {
      promotedMedia = await promoteOwnedStoryUploadKey(mediaUrl);
      if (thumbnailUrl) {
        promotedThumb = await promoteOwnedStoryUploadKey(thumbnailUrl);
      }
      if (promotedMedia !== originalMedia || promotedThumb !== originalThumb) {
        await story.update({ mediaUrl: promotedMedia, thumbnailUrl: promotedThumb });
      }
      if (promotedMedia !== originalMedia) {
        await deleteStoryR2Object(originalMedia);
      }
      if (originalThumb && promotedThumb && promotedThumb !== originalThumb) {
        await deleteStoryR2Object(originalThumb);
      }
    } catch (e: any) {
      if (story.mediaUrl === originalMedia && promotedMedia !== originalMedia) {
        await deleteStoryR2Object(promotedMedia);
      }
      if (
        originalThumb &&
        story.thumbnailUrl === originalThumb &&
        promotedThumb &&
        promotedThumb !== originalThumb
      ) {
        await deleteStoryR2Object(promotedThumb);
      }
      console.warn("[stories] promote after create failed — tmp key remains referenced", {
        storyId: story.id,
        code: e?.code ?? "PROMOTE_FAILED"
      });
    }
    await story.reload();
  }
  const { media, thumb } = await resolvePlayableUrls(story, userId);
  return toStoryDto(story, media, thumb, {
    viewed_by_me: true,
    view_count: 0,
    liked_by_me: false,
    like_count: 0
  });
}

/** PUT /api/stories/upload — R2 by default; local disk when STORIES_STORAGE_BACKEND=local. */
export async function uploadStoryMediaBytes(
  userId: number,
  buffer: Buffer,
  mimeType: string
): Promise<{
  key: string;
  byte_size: number;
  mime_type: string;
  duration_seconds: number | null;
  media_kind: "image" | "video";
}> {
  const saved = isStoriesR2Backend()
    ? await saveStoryR2File(userId, buffer, mimeType)
    : await saveStoryFile(userId, buffer, mimeType);
  return {
    key: saved.key,
    byte_size: saved.byteSize,
    mime_type: saved.mimeType,
    duration_seconds: saved.durationSeconds,
    media_kind: saved.kind
  };
}

export async function listStoryTray(viewerId: number) {
  const started = Date.now();
  const metricsOn = process.env.STORY_METRICS === "1" || process.env.HOME_METRICS === "1";
  const { timedMs } = await import("../utils/perfTimer");
  const now = new Date();

  // P4G: IDs-only connections (same accepted set as feed) — avoid listConnections'
  // full user DTO hydration; authors are loaded once below for users with stories.
  const connTimed = await timedMs(() =>
    Promise.all([
      getAcceptedConnectionUserIds(viewerId),
      getBlockedUserIds(viewerId).catch(() => new Set<number>())
    ])
  );
  const [connectionIds, blocked] = connTimed.value;
  const peerIds = connectionIds.filter((id) => id !== viewerId && !blocked.has(id));
  const authorIds = [viewerId, ...peerIds];

  const storiesTimed = await timedMs(() =>
    Story.findAll({
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
    })
  );
  const stories = storiesTimed.value;

  const storyIds = stories.map((s) => s.id);
  const byUser = new Map<number, Story[]>();
  for (const s of stories) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  const userIds = [...byUser.keys()];
  const ownIds = (byUser.get(viewerId) ?? []).map((s) => s.id);

  // P4G: views + likes + authors (+ owner view rows) are independent after the tray query.
  const hydrateTimed = await timedMs(async () => {
    const emptyViews: StoryView[] = [];
    const emptyLikes: StoryLike[] = [];
    const [myViews, myLikes, users, ownerViewRows] = await Promise.all([
      storyIds.length === 0
        ? Promise.resolve(emptyViews)
        : StoryView.findAll({
            where: { viewerId, storyId: { [Op.in]: storyIds } },
            attributes: ["storyId"]
          }),
      storyIds.length === 0
        ? Promise.resolve(emptyLikes)
        : StoryLike.findAll({
            where: { userId: viewerId, storyId: { [Op.in]: storyIds } },
            attributes: ["storyId"]
          }),
      userIds.length === 0
        ? Promise.resolve([] as User[])
        : User.findAll({
            where: { id: { [Op.in]: userIds } },
            attributes: ["id", "fullName", "username", "profilePhoto"]
          }),
      ownIds.length
        ? StoryView.findAll({
            where: { storyId: { [Op.in]: ownIds } },
            attributes: ["storyId"]
          })
        : Promise.resolve(emptyViews)
    ]);
    return { myViews, myLikes, users, ownerViewRows };
  });
  const { myViews, myLikes, users, ownerViewRows } = hydrateTimed.value;
  const viewedSet = new Set(myViews.map((v) => v.storyId));
  const likedSet = new Set(myLikes.map((l) => l.storyId));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const ownerViewCounts = new Map<number, number>();
  for (const row of ownerViewRows) {
    ownerViewCounts.set(row.storyId, (ownerViewCounts.get(row.storyId) ?? 0) + 1);
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

  const dtoStarted = Date.now();
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
  const dtoMs = Date.now() - dtoStarted;

  if (metricsOn) {
    const { getCurrentRequestId } = await import("../utils/requestContext");
    console.info(
      "[story-metrics]",
      JSON.stringify({
        requestId: getCurrentRequestId(),
        service: "listStoryTray",
        totalMs: Date.now() - started,
        connectionsMs: connTimed.ms,
        trayMs: storiesTimed.ms,
        hydrateMs: hydrateTimed.ms,
        dtoMs,
        storyCount: stories.length,
        groupCount: groups.length,
        peerCount: peerIds.length
      })
    );
  }

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
  const purged = await purgeStoryMedia(story);
  await markPurgedKeys(story, purged);
  return { deleted: true };
}

/**
 * Soft-delete expired rows and permanently delete media (local, Story R2, or legacy R2).
 * Expiry auth still uses expires_at — this is cleanup only.
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
    const purged = await purgeStoryMedia(story);
    await markPurgedKeys(story, purged);
    n += 1;
  }
  return n;
}

/**
 * Retry R2 deletes for soft-deleted stories whose object keys were kept after a
 * transient DeleteObject failure. Idempotent; successful deletes are marked purged://.
 */
export async function retryFailedStoryMediaPurges(limit = 100): Promise<number> {
  const rows = await Story.findAll({
    where: {
      deletedAt: { [Op.ne]: null },
      [Op.or]: [
        { mediaUrl: { [Op.like]: `${STORY_R2_KEY_PREFIX}%` } },
        { thumbnailUrl: { [Op.like]: `${STORY_R2_KEY_PREFIX}%` } }
      ]
    },
    limit,
    order: [["deletedAt", "ASC"]]
  });
  let n = 0;
  for (const story of rows) {
    const purged = await purgeStoryMedia(story);
    await markPurgedKeys(story, purged);
    if (purged.mediaPurged && purged.thumbPurged) n += 1;
  }
  return n;
}

export async function toggleStoryLike(viewerId: number, storyId: number) {
  const story = await Story.findByPk(storyId);
  if (!story || story.deletedAt) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }
  await assertCanViewStory(viewerId, story);

  return sequelize.transaction(async (t) => {
    const existing = await StoryLike.findOne({
      where: { storyId: story.id, userId: viewerId },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (existing) {
      await existing.destroy({ transaction: t });
      const likeCount = await StoryLike.count({
        where: { storyId: story.id },
        transaction: t
      });
      await story.update({ likeCount }, { transaction: t });
      return { liked: false, like_count: likeCount };
    }
    try {
      await StoryLike.create(
        {
          storyId: story.id,
          userId: viewerId,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        { transaction: t }
      );
    } catch (e: any) {
      if (e?.name !== "SequelizeUniqueConstraintError") throw e;
    }
    const likeCount = await StoryLike.count({
      where: { storyId: story.id },
      transaction: t
    });
    await story.update({ likeCount }, { transaction: t });
    return { liked: true, like_count: likeCount };
  });
}

/** Remove abandoned tmp_* uploads not referenced by any Story row (local + R2). */
export async function cleanupOrphanStoryMediaUploads(maxAgeHours?: number) {
  const rows = await Story.findAll({
    attributes: ["mediaUrl", "thumbnailUrl"]
  });
  const referencedLocal = new Set<string>();
  const referencedR2 = new Set<string>();
  for (const row of rows) {
    if (row.mediaUrl && isLocalStoryKey(row.mediaUrl)) referencedLocal.add(row.mediaUrl);
    if (row.thumbnailUrl && isLocalStoryKey(row.thumbnailUrl)) {
      referencedLocal.add(row.thumbnailUrl);
    }
    if (row.mediaUrl && isStoryR2Key(row.mediaUrl)) referencedR2.add(row.mediaUrl);
    if (row.thumbnailUrl && isStoryR2Key(row.thumbnailUrl)) {
      referencedR2.add(row.thumbnailUrl);
    }
  }
  const local = await cleanupOrphanStoryUploads({
    referencedKeys: referencedLocal,
    maxAgeHours
  });
  let r2 = { scanned: 0, deleted: 0, failures: 0 };
  if (isStoriesR2Backend() || referencedR2.size > 0) {
    r2 = await cleanupOrphanStoryR2Uploads({ referencedKeys: referencedR2, maxAgeHours });
  }
  return {
    scanned: local.scanned + r2.scanned,
    deleted: local.deleted + r2.deleted,
    failures: local.failures + r2.failures,
    local,
    r2
  };
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

export type OpenStoryMediaResult =
  | {
      delivery: "local";
      absolutePath: string;
      byteSize: number;
      mimeType: string;
    }
  | {
      delivery: "r2-redirect";
      redirectUrl: string;
      mimeType: string;
    };

/**
 * Authorize Story media after HMAC + live connection/expiry checks.
 * Local keys stream from disk. R2 keys 302 to a short-lived presigned GET
 * so the API origin never transfers the object bytes.
 */
export async function openStoryMediaFile(
  viewerId: number,
  storyId: number,
  kind: StoryMediaKind,
  query: { v?: string; e?: string; s?: string }
): Promise<OpenStoryMediaResult> {
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
  if (!key || isPlaceholderStoryKey(key)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }

  if (isStoryR2Key(key)) {
    const redirectUrl = await signStoryR2PlaybackUrl(key);
    return {
      delivery: "r2-redirect",
      redirectUrl,
      mimeType: mimeFromStoryKey(key, story.mimeType ?? "application/octet-stream")
    };
  }

  if (!isLocalStoryKey(key)) {
    serviceError("Story not found", 404, "STORY_NOT_FOUND");
  }

  const { absolutePath, stat } = await readStoryFileStream(key);
  return {
    delivery: "local",
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
  retryFailedStoryMediaPurges,
  cleanupOrphanStoryMediaUploads,
  toggleStoryLike,
  replyToStory,
  openStoryMediaFile
};
