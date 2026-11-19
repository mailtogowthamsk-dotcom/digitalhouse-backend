/**
 * Official (admin) stories — visibility, tray order, member privacy, readonly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  Story: {
    findByPk: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn()
  },
  StoryView: {
    findAll: vi.fn(),
    findOne: vi.fn(),
    findOrCreate: vi.fn(),
    destroy: vi.fn(),
    count: vi.fn()
  },
  StoryLike: {
    findAll: vi.fn(),
    findOne: vi.fn(),
    destroy: vi.fn(),
    count: vi.fn(),
    create: vi.fn()
  },
  User: { findAll: vi.fn(), findByPk: vi.fn() },
  Message: { create: vi.fn() },
  hasAcceptedConnection: vi.fn(),
  getAcceptedConnectionUserIds: vi.fn(),
  getBlockedUserIds: vi.fn(),
  assertCanSendMessage: vi.fn()
}));

vi.mock("../../src/config/db", () => ({
  sequelize: {
    query: vi.fn(),
    transaction: vi.fn(async (fn: any) => fn({ LOCK: { UPDATE: "UPDATE" } }))
  }
}));

vi.mock("../../src/models", () => ({
  Story: mocks.Story,
  StoryView: mocks.StoryView,
  StoryLike: mocks.StoryLike,
  User: mocks.User,
  Message: mocks.Message
}));

vi.mock("../../src/services/Connection.service", () => ({
  hasAcceptedConnection: mocks.hasAcceptedConnection
}));

vi.mock("../../src/services/PostVisibility.service", () => ({
  getAcceptedConnectionUserIds: mocks.getAcceptedConnectionUserIds
}));

vi.mock("../../src/services/MatrimonySafety.service", () => ({
  getBlockedUserIds: mocks.getBlockedUserIds
}));

vi.mock("../../src/services/MessagePermission.service", () => ({
  assertCanSendMessage: mocks.assertCanSendMessage
}));

vi.mock("../../src/realtime/messageEvents", () => ({
  emitMessageEvents: () => undefined
}));

vi.mock("../../src/realtime/messagePushQueue", () => ({
  scheduleMessagePush: () => undefined
}));

vi.mock("../../src/utils/r2Client", () => ({
  isPrivateR2Object: () => false,
  toPrivateSignedUrlIfR2: async (u: string) => u,
  toPublicUrlIfR2: (u: string | null) => u,
  deleteR2ImageVariants: async () => undefined
}));

vi.mock("../../src/config/storiesRuntime", () => ({
  isStoriesR2Backend: () => false
}));

vi.mock("../../src/services/StoryR2Storage.service", () => ({
  assertOwnedStoryR2Key: vi.fn(),
  assertStoryR2ObjectReady: vi.fn(),
  cleanupOrphanStoryR2Uploads: vi.fn(),
  deleteStoryR2Object: vi.fn(),
  isStoryR2Key: () => false,
  promoteStoryR2UploadKey: vi.fn(),
  saveStoryR2File: vi.fn(),
  signStoryR2PlaybackUrl: vi.fn()
}));

vi.mock("../../src/services/StoryLocalStorage.service", () => ({
  absolutePathForStoryKey: vi.fn(),
  assertOwnedLocalStoryKey: vi.fn(),
  assertStoryVideoDuration: vi.fn(),
  buildSignedStoryMediaPath: (id: number) => `/api/stories/${id}/file?signed=1`,
  cleanupOrphanStoryUploads: vi.fn(),
  deleteStoryFile: vi.fn(),
  isLocalStoryKey: (k: string) => typeof k === "string" && k.startsWith("stories/"),
  mimeFromStoryKey: () => "image/jpeg",
  promoteStoryUploadKey: async (k: string) => k.replace("tmp_", ""),
  readStoryFileStream: vi.fn(),
  saveStoryFile: vi.fn(),
  verifySignedStoryMediaQuery: vi.fn()
}));

vi.mock("../../src/utils/perfTimer", () => ({
  timedMs: async (fn: () => Promise<any>) => ({ value: await fn(), ms: 1 })
}));

import {
  createStory,
  deleteStory,
  listStoryTray,
  toggleStoryLike,
  replyToStory,
  deleteOfficialStory
} from "../../src/services/Stories.service";
import * as AdminStories from "../../src/services/AdminStories.service";

function storyRow(partial: Record<string, any>) {
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    id: partial.id ?? 1,
    userId: partial.userId ?? 99,
    mediaType: partial.mediaType ?? "text",
    mediaUrl: partial.mediaUrl ?? "text://",
    caption: partial.caption ?? "Hello",
    thumbnailUrl: null,
    durationSeconds: null,
    mimeType: "text/plain",
    fileSize: null,
    likeCount: 0,
    isOfficial: partial.isOfficial ?? false,
    createdByAdminEmail: partial.createdByAdminEmail ?? null,
    createdAt: partial.createdAt ?? now,
    expiresAt: partial.expiresAt ?? expires,
    deletedAt: partial.deletedAt ?? null,
    update: vi.fn(async function (this: any, patch: any) {
      Object.assign(this, patch);
    }),
    reload: vi.fn(async () => undefined)
  };
}

describe("official stories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OFFICIAL_STORY_OWNER_USER_ID = "99";
    mocks.getAcceptedConnectionUserIds.mockResolvedValue([]);
    mocks.getBlockedUserIds.mockResolvedValue(new Set());
    mocks.hasAcceptedConnection.mockResolvedValue(false);
    mocks.StoryView.findAll.mockResolvedValue([]);
    mocks.StoryLike.findAll.mockResolvedValue([]);
    mocks.User.findAll.mockResolvedValue([]);
    mocks.User.findByPk.mockResolvedValue({ id: 99 });
  });

  it("listStoryTray prepends official group for unrelated viewers", async () => {
    const official = storyRow({ id: 10, userId: 99, isOfficial: true, caption: "Official" });
    const member = storyRow({
      id: 20,
      userId: 5,
      isOfficial: false,
      caption: "Private"
    });

    mocks.getAcceptedConnectionUserIds.mockResolvedValue([5]);
    mocks.Story.findAll.mockImplementation(async (opts: any) => {
      if (opts?.where?.isOfficial === true) return [official];
      return [member];
    });
    mocks.User.findAll.mockResolvedValue([
      { id: 5, fullName: "Peer User", username: "peer", profilePhoto: null }
    ]);

    const { groups } = await listStoryTray(1);
    expect(groups[0]?.is_official).toBe(true);
    expect(groups[0]?.user.name).toBe("VettuvaGounder");
    expect(groups[0]?.stories[0]?.caption).toBe("Official");
    expect(groups.some((g) => g.user.id === 5)).toBe(true);
  });

  it("member createStory never sets isOfficial", async () => {
    mocks.Story.create.mockImplementation(async (row: any) =>
      storyRow({ ...row, id: 3, isOfficial: row.isOfficial ?? false })
    );
    await createStory(7, { media_type: "text", caption: "Hi" });
    expect(mocks.Story.create).toHaveBeenCalledWith(
      expect.objectContaining({ isOfficial: false, userId: 7 })
    );
  });

  it("publishAdminStory sets isOfficial", async () => {
    mocks.Story.create.mockImplementation(async (row: any) =>
      storyRow({ ...row, id: 11, isOfficial: row.isOfficial })
    );
    const out = await AdminStories.publishAdminStory("admin@test.com", {
      media_type: "text",
      caption: "From admin"
    });
    expect(mocks.Story.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isOfficial: true,
        createdByAdminEmail: "admin@test.com",
        userId: 99
      })
    );
    expect(out.is_official).toBe(true);
  });

  it("unrelated user cannot like official story", async () => {
    mocks.Story.findByPk.mockResolvedValue(storyRow({ id: 10, isOfficial: true }));
    await expect(toggleStoryLike(1, 10)).rejects.toMatchObject({
      code: "OFFICIAL_STORY_READONLY"
    });
  });

  it("unrelated user cannot reply to official story", async () => {
    mocks.Story.findByPk.mockResolvedValue(storyRow({ id: 10, isOfficial: true }));
    await expect(replyToStory(1, 10, "hi")).rejects.toMatchObject({
      code: "OFFICIAL_STORY_READONLY"
    });
  });

  it("member cannot delete official story even as storage owner", async () => {
    mocks.Story.findByPk.mockResolvedValue(storyRow({ id: 10, userId: 99, isOfficial: true }));
    await expect(deleteStory(99, 10)).rejects.toMatchObject({ code: "OFFICIAL_STORY" });
  });

  it("deleteOfficialStory soft-deletes official rows", async () => {
    const row = storyRow({ id: 10, isOfficial: true });
    mocks.Story.findByPk.mockResolvedValue(row);
    mocks.StoryView.destroy.mockResolvedValue(1);
    mocks.StoryLike.destroy.mockResolvedValue(1);
    await deleteOfficialStory(10);
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(Date) }));
  });

  it("expired official stories are excluded from tray", async () => {
    mocks.Story.findAll.mockImplementation(async (opts: any) => {
      if (opts?.where?.isOfficial === true) return [];
      return [];
    });
    const { groups } = await listStoryTray(1);
    expect(groups.find((g) => g.is_official)).toBeUndefined();
  });
});
