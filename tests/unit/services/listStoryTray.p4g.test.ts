import { beforeEach, describe, expect, it, vi } from "vitest";
import { Op } from "sequelize";

vi.mock("../../../src/config/db", () => ({
  sequelize: { query: vi.fn(), transaction: vi.fn() }
}));

vi.mock("../../../src/config/env", () => ({
  env: { nodeEnv: "test" }
}));

vi.mock("../../../src/models", () => ({
  Story: { findAll: vi.fn() },
  StoryView: { findAll: vi.fn() },
  StoryLike: { findAll: vi.fn() },
  User: { findAll: vi.fn() },
  Message: {}
}));

vi.mock("../../../src/services/PostVisibility.service", () => ({
  getAcceptedConnectionUserIds: vi.fn()
}));

vi.mock("../../../src/services/MatrimonySafety.service", () => ({
  getBlockedUserIds: vi.fn()
}));

vi.mock("../../../src/services/Connection.service", () => ({
  hasAcceptedConnection: vi.fn(),
  listConnections: vi.fn()
}));

vi.mock("../../../src/utils/r2Client", () => ({
  isPrivateR2Object: () => false,
  toPrivateSignedUrlIfR2: async () => null,
  toPublicUrlIfR2: (u: string | null) => u,
  deleteR2ImageVariants: async () => undefined
}));

vi.mock("../../../src/services/StoryLocalStorage.service", () => ({
  isLocalStoryKey: () => false,
  buildSignedStoryMediaPath: () => "/signed",
  assertOwnedLocalStoryKey: () => undefined,
  assertStoryVideoDuration: () => undefined,
  absolutePathForStoryKey: () => "",
  cleanupOrphanStoryUploads: async () => undefined,
  deleteStoryFile: async () => undefined,
  mimeFromStoryKey: () => "image/jpeg",
  promoteStoryUploadKey: () => "",
  readStoryFileStream: async () => null,
  saveStoryFile: async () => "",
  verifySignedStoryMediaQuery: () => true,
  STORY_UPLOAD_TMP_PREFIX: "tmp_",
  LOCAL_STORY_KEY_PREFIX: "local/stories/"
}));

vi.mock("../../../src/realtime/messageEvents", () => ({
  emitMessageEvents: () => undefined
}));

vi.mock("../../../src/realtime/messagePushQueue", () => ({
  scheduleMessagePush: () => undefined
}));

vi.mock("../../../src/services/MessagePermission.service", () => ({
  assertCanSendMessage: async () => undefined
}));

import { Story, StoryLike, StoryView, User } from "../../../src/models";
import { getAcceptedConnectionUserIds } from "../../../src/services/PostVisibility.service";
import { getBlockedUserIds } from "../../../src/services/MatrimonySafety.service";
import { listConnections } from "../../../src/services/Connection.service";
import { listStoryTray } from "../../../src/services/Stories.service";

describe("listStoryTray (P4G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses ID-only connections (not listConnections DTO hydration)", async () => {
    vi.mocked(getAcceptedConnectionUserIds).mockResolvedValue([2, 3]);
    vi.mocked(getBlockedUserIds).mockResolvedValue(new Set([3]));
    vi.mocked(Story.findAll).mockResolvedValue([] as any);
    vi.mocked(User.findAll).mockResolvedValue([] as any);
    vi.mocked(StoryView.findAll).mockResolvedValue([] as any);
    vi.mocked(StoryLike.findAll).mockResolvedValue([] as any);

    const out = await listStoryTray(1);
    expect(out.groups).toEqual([]);
    expect(getAcceptedConnectionUserIds).toHaveBeenCalledWith(1);
    expect(listConnections).not.toHaveBeenCalled();
    const where = (vi.mocked(Story.findAll).mock.calls[0]?.[0] as { where: any }).where;
    expect(where.userId).toEqual({ [Op.in]: [1, 2] });
  });

  it("loads views, likes, and authors concurrently", async () => {
    const now = new Date(Date.now() + 60_000);
    const story = {
      id: 10,
      userId: 1,
      mediaType: "text",
      mediaUrl: "text:",
      caption: "hi",
      thumbnailUrl: null,
      durationSeconds: null,
      likeCount: 0,
      createdAt: new Date(),
      expiresAt: now,
      deletedAt: null
    };
    vi.mocked(getAcceptedConnectionUserIds).mockResolvedValue([]);
    vi.mocked(getBlockedUserIds).mockResolvedValue(new Set());
    vi.mocked(Story.findAll).mockResolvedValue([story] as any);

    let maxConcurrent = 0;
    let inFlight = 0;
    const track = async <T>(value: T): Promise<T> => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 8));
      inFlight -= 1;
      return value;
    };

    vi.mocked(StoryView.findAll).mockImplementation(() => track([] as any));
    vi.mocked(StoryLike.findAll).mockImplementation(() => track([] as any));
    vi.mocked(User.findAll).mockImplementation(() =>
      track([{ id: 1, fullName: "Me", username: "me", profilePhoto: null }] as any)
    );

    const out = await listStoryTray(1);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.is_own).toBe(true);
    expect(maxConcurrent).toBeGreaterThanOrEqual(3);
  });
});
