/**
 * Stories R2 storage, HMAC gateway playback, expiry purge retry, legacy local.
 * R2 SDK is mocked — never talks to a real bucket.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const r2 = vi.hoisted(() => ({
  getPresignedPutUrl: vi.fn(async (key: string) => `https://r2.test.local/put/${key}`),
  getPresignedGetUrl: vi.fn(
    async (key: string, ttl = 300, opts?: { responseCacheControl?: string }) => {
      const cc = opts?.responseCacheControl
        ? `&response-cache-control=${encodeURIComponent(opts.responseCacheControl)}`
        : "";
      return `https://r2.test.local/get/${key}?X-Amz-Signature=test&X-Amz-Expires=${ttl}${cc}`;
    }
  ),
  getCdnPublicUrl: vi.fn((key: string) => `https://cdn.test.local/${key}`),
  toPublicUrlIfR2: vi.fn((url: string | null | undefined) => url ?? null),
  toStorageKeyIfR2: vi.fn((url: string | null | undefined) => url ?? null),
  isPrivateR2Object: vi.fn((url: string | null | undefined) =>
    Boolean(url && url.includes("/private/"))
  ),
  extractR2KeyFromUrl: vi.fn((u: string) => u),
  normalizeR2ObjectKey: vi.fn((key: string) => key.replace(/^\//, "")),
  getR2ObjectBuffer: vi.fn(async () => Buffer.from("mock-object")),
  getR2ObjectMetadata: vi.fn(async () => ({
    contentType: "image/jpeg",
    byteSize: 12,
    metadata: {} as Record<string, string>
  })),
  putR2ObjectBuffer: vi.fn(async () => undefined),
  putR2ObjectFromFile: vi.fn(async () => undefined),
  listR2ObjectsByPrefix: vi.fn(async () => [] as Array<{ key: string; lastModified: Date | null }>),
  copyR2Object: vi.fn(async () => undefined),
  deleteR2ObjectByKey: vi.fn(async () => undefined),
  deleteR2ObjectByKeyOrThrow: vi.fn(async () => undefined),
  deleteR2ImageVariants: vi.fn(async () => undefined),
  deleteMediaArtifacts: vi.fn(async () => undefined),
  deleteR2ObjectIfStored: vi.fn(async () => undefined),
  toSignedUrlIfR2: vi.fn(async (url: string | null | undefined) => url),
  toPrivateSignedUrlIfR2: vi.fn(async (url: string | null | undefined) => url)
}));

vi.mock("../../src/utils/r2Client", () => r2);

vi.mock("../../src/config/db", () => ({
  sequelize: { query: vi.fn(), transaction: vi.fn() }
}));

vi.mock("../../src/models", () => ({
  Story: { findByPk: vi.fn(), findAll: vi.fn(), create: vi.fn() },
  StoryView: { findAll: vi.fn(), destroy: vi.fn(), findOne: vi.fn(), count: vi.fn(), findOrCreate: vi.fn() },
  StoryLike: { findAll: vi.fn(), findOne: vi.fn(), destroy: vi.fn(), count: vi.fn(), create: vi.fn() },
  User: { findAll: vi.fn() },
  Message: { create: vi.fn() }
}));

vi.mock("../../src/services/Connection.service", () => ({
  hasAcceptedConnection: vi.fn(),
  listConnections: vi.fn()
}));

vi.mock("../../src/services/MatrimonySafety.service", () => ({
  getBlockedUserIds: vi.fn()
}));

vi.mock("../../src/services/PostVisibility.service", () => ({
  getAcceptedConnectionUserIds: vi.fn()
}));

vi.mock("../../src/realtime/messageEvents", () => ({
  emitMessageEvents: () => undefined
}));

vi.mock("../../src/realtime/messagePushQueue", () => ({
  scheduleMessagePush: () => undefined
}));

vi.mock("../../src/services/MessagePermission.service", () => ({
  assertCanSendMessage: async () => undefined
}));

vi.mock("../../src/utils/videoProcessor", () => ({
  hasFfmpeg: vi.fn(async () => true),
  probeVideoFile: vi.fn(async () => ({
    durationSec: 8,
    width: 720,
    height: 1280,
    videoCodec: "h264",
    audioCodec: "aac",
    bitrate: 1_000_000,
    formatName: "mp4"
  }))
}));

import { Story, StoryLike, StoryView } from "../../src/models";
import { hasAcceptedConnection } from "../../src/services/Connection.service";
import { getBlockedUserIds } from "../../src/services/MatrimonySafety.service";
import {
  STORY_PURGED_MEDIA_KEY,
  STORY_R2_KEY_PREFIX,
  STORY_UPLOAD_TMP_PREFIX
} from "../../src/constants/stories.constants";
import { LOCAL_STORY_KEY_PREFIX } from "../../src/services/StoryLocalStorage.service";
import {
  assertOwnedStoryR2Key,
  cleanupOrphanStoryR2Uploads,
  isPendingStoryR2UploadKey,
  isStoryR2Key,
  promoteStoryR2UploadKey,
  saveStoryR2File
} from "../../src/services/StoryR2Storage.service";
import {
  buildSignedStoryMediaPath,
  saveStoryFile
} from "../../src/services/StoryLocalStorage.service";
import {
  cleanupExpiredStories,
  createStory,
  openStoryMediaFile,
  retryFailedStoryMediaPurges,
  uploadStoryMediaBytes
} from "../../src/services/Stories.service";

const SIGN_SECRET = "unit-test-stories-secret-32chars!!";

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
}

function mp4Bytes(): Buffer {
  const buf = Buffer.alloc(32);
  buf.write("....", 0);
  buf.write("ftyp", 4);
  buf.write("isom", 8);
  return buf;
}

function futureDate(ms = 60 * 60 * 1000): Date {
  return new Date(Date.now() + ms);
}

function parseSignedQuery(mediaPath: string): { e?: string; s?: string; v?: string } {
  const u = new URL(mediaPath, "http://localhost");
  return {
    e: u.searchParams.get("e") ?? undefined,
    s: u.searchParams.get("s") ?? undefined,
    v: u.searchParams.get("v") ?? undefined
  };
}

function storyRow(overrides: Record<string, unknown> = {}) {
  const row: any = {
    id: 42,
    userId: 7,
    mediaType: "image",
    mediaUrl: `${STORY_R2_KEY_PREFIX}7/2026/10/abc.jpg`,
    thumbnailUrl: `${STORY_R2_KEY_PREFIX}7/2026/10/abc_thumb.jpg`,
    durationSeconds: null,
    mimeType: "image/jpeg",
    fileSize: 12,
    likeCount: 0,
    createdAt: new Date(),
    expiresAt: futureDate(),
    deletedAt: null,
    update: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(row, patch);
      return row;
    }),
    reload: vi.fn(async () => row),
    ...overrides
  };
  return row;
}

describe("Story R2 key helpers", () => {
  it("accepts private stories prefix and rejects local / traversal keys", () => {
    expect(isStoryR2Key(`${STORY_R2_KEY_PREFIX}1/2026/10/a.jpg`)).toBe(true);
    expect(isStoryR2Key("local/stories/1/2026/10/a.jpg")).toBe(false);
    expect(isStoryR2Key(`${STORY_R2_KEY_PREFIX}../secret.jpg`)).toBe(false);
    expect(isStoryR2Key("digital-house/images/posts/x.jpg")).toBe(false);
  });

  it("detects pending tmp keys and ownership", () => {
    const pending = `${STORY_R2_KEY_PREFIX}9/2026/10/${STORY_UPLOAD_TMP_PREFIX}abc.jpg`;
    expect(isPendingStoryR2UploadKey(pending)).toBe(true);
    expect(isPendingStoryR2UploadKey(`${STORY_R2_KEY_PREFIX}9/2026/10/abc.jpg`)).toBe(false);
    expect(() => assertOwnedStoryR2Key(9, pending)).not.toThrow();
    expect(() => assertOwnedStoryR2Key(8, pending)).toThrow(/Invalid story media/i);
  });
});

describe("Story R2 upload", () => {
  const prevBackend = process.env.STORIES_STORAGE_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORIES_STORAGE_BACKEND = "r2";
    r2.putR2ObjectBuffer.mockResolvedValue(undefined);
    r2.putR2ObjectFromFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (prevBackend === undefined) delete process.env.STORIES_STORAGE_BACKEND;
    else process.env.STORIES_STORAGE_BACKEND = prevBackend;
  });

  it("uploads a story image to R2 under the private stories prefix", async () => {
    const saved = await saveStoryR2File(7, jpegBytes(), "image/jpeg");
    expect(saved.kind).toBe("image");
    expect(saved.mimeType).toBe("image/jpeg");
    expect(saved.key.startsWith(`${STORY_R2_KEY_PREFIX}7/`)).toBe(true);
    expect(path.posix.basename(saved.key).startsWith(STORY_UPLOAD_TMP_PREFIX)).toBe(true);
    expect(r2.putR2ObjectBuffer).toHaveBeenCalled();
    const key = r2.putR2ObjectBuffer.mock.calls[0]![0];
    expect(key).toBe(saved.key);
    expect(key).not.toContain("local/stories/");
    const putOpts = r2.putR2ObjectBuffer.mock.calls[0]![3];
    expect(putOpts?.cacheControl).toMatch(/private/);
    expect(putOpts?.cacheControl).toMatch(/no-store/);
  });

  it("uploads a story video to R2 via disk stream after duration probe", async () => {
    const saved = await saveStoryR2File(7, mp4Bytes(), "video/mp4");
    expect(saved.kind).toBe("video");
    expect(saved.durationSeconds).toBe(8);
    expect(saved.key.startsWith(`${STORY_R2_KEY_PREFIX}7/`)).toBe(true);
    expect(r2.putR2ObjectFromFile).toHaveBeenCalled();
    const meta = r2.putR2ObjectFromFile.mock.calls[0]![3];
    expect(meta?.metadata?.["duration-seconds"]).toBe("8");
    expect(meta?.cacheControl).toMatch(/private/);
    expect(meta?.cacheControl).toMatch(/no-store/);
  });

  it("uploads a thumbnail image the same way as story images", async () => {
    const saved = await saveStoryR2File(7, jpegBytes(), "image/jpeg");
    expect(saved.kind).toBe("image");
    expect(r2.putR2ObjectBuffer).toHaveBeenCalledTimes(1);
  });

  it("does not keep an R2 object when put fails", async () => {
    r2.putR2ObjectBuffer.mockRejectedValueOnce(new Error("r2 down"));
    await expect(saveStoryR2File(7, jpegBytes(), "image/jpeg")).rejects.toThrow(/r2 down/i);
  });

  it("promotes tmp_* to a permanent key via copy (tmp delete is the caller's job)", async () => {
    const tmp = `${STORY_R2_KEY_PREFIX}7/2026/10/${STORY_UPLOAD_TMP_PREFIX}abc.jpg`;
    const promoted = await promoteStoryR2UploadKey(tmp);
    expect(promoted).toBe(`${STORY_R2_KEY_PREFIX}7/2026/10/abc.jpg`);
    expect(r2.copyR2Object).toHaveBeenCalledWith(tmp, promoted);
    expect(r2.deleteR2ObjectByKeyOrThrow).not.toHaveBeenCalled();
  });

  it("uploadStoryMediaBytes uses R2 when backend=r2", async () => {
    const out = await uploadStoryMediaBytes(3, jpegBytes(), "image/jpeg");
    expect(out.key.startsWith(`${STORY_R2_KEY_PREFIX}3/`)).toBe(true);
    expect(out.media_kind).toBe("image");
  });
});

describe("Story R2 create + DB failure cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORIES_STORAGE_BACKEND = "r2";
    r2.getR2ObjectMetadata.mockResolvedValue({
      byteSize: 12,
      contentType: "image/jpeg",
      metadata: {}
    });
  });

  it("creates a story only after R2 object exists and then promotes the key", async () => {
    const tmpKey = `${STORY_R2_KEY_PREFIX}7/2026/10/${STORY_UPLOAD_TMP_PREFIX}abc.jpg`;
    const row = storyRow({ mediaUrl: tmpKey, thumbnailUrl: null });
    vi.mocked(Story.create).mockResolvedValue(row as any);
    const dto = await createStory(7, { media_url: tmpKey, media_type: "image" });
    expect(Story.create).toHaveBeenCalled();
    expect(r2.copyR2Object).toHaveBeenCalled();
    expect(dto.id).toBe(42);
    expect(row.mediaUrl).toBe(`${STORY_R2_KEY_PREFIX}7/2026/10/abc.jpg`);
    expect(r2.deleteR2ObjectByKeyOrThrow).toHaveBeenCalledWith(tmpKey);
  });

  it("cleans up R2 objects when Story.create fails", async () => {
    const tmpKey = `${STORY_R2_KEY_PREFIX}7/2026/10/${STORY_UPLOAD_TMP_PREFIX}abc.jpg`;
    vi.mocked(Story.create).mockRejectedValueOnce(new Error("db down"));
    await expect(createStory(7, { media_url: tmpKey, media_type: "image" })).rejects.toThrow(
      /db down/i
    );
    expect(r2.deleteR2ObjectByKeyOrThrow).toHaveBeenCalledWith(tmpKey);
  });

  it("rejects a video whose R2 metadata duration is missing", async () => {
    const tmpKey = `${STORY_R2_KEY_PREFIX}7/2026/10/${STORY_UPLOAD_TMP_PREFIX}clip.mp4`;
    r2.getR2ObjectMetadata.mockResolvedValue({
      byteSize: 1000,
      contentType: "video/mp4",
      metadata: {}
    });
    await expect(createStory(7, { media_url: tmpKey, media_type: "video" })).rejects.toThrow(
      /Invalid or corrupt video/i
    );
    expect(Story.create).not.toHaveBeenCalled();
  });
});

describe("Story playback authorization", () => {
  const prevSecret = process.env.STORIES_MEDIA_SIGNING_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORIES_MEDIA_SIGNING_SECRET = SIGN_SECRET;
    vi.mocked(getBlockedUserIds).mockResolvedValue(new Set());
    vi.mocked(hasAcceptedConnection).mockResolvedValue(true);
    r2.getPresignedGetUrl.mockImplementation(
      async (key: string, ttl = 300, opts?: { responseCacheControl?: string }) => {
        const cc = opts?.responseCacheControl
          ? `&response-cache-control=${encodeURIComponent(opts.responseCacheControl)}`
          : "";
        return `https://r2.test.local/get/${key}?X-Amz-Signature=test&X-Amz-Expires=${ttl}${cc}`;
      }
    );
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.STORIES_MEDIA_SIGNING_SECRET;
    else process.env.STORIES_MEDIA_SIGNING_SECRET = prevSecret;
  });

  it("authorized viewer gets an R2 redirect, not a local file path", async () => {
    const row = storyRow();
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 9, "file");
    const q = parseSignedQuery(signed);
    const opened = await openStoryMediaFile(9, 42, "file", q);
    expect(opened.delivery).toBe("r2-redirect");
    if (opened.delivery !== "r2-redirect") throw new Error("expected redirect");
    expect(opened.redirectUrl).toContain("X-Amz-Signature=");
    expect(opened.redirectUrl).not.toContain("R2_SECRET");
    expect("absolutePath" in opened).toBe(false);
    expect(r2.getPresignedGetUrl).toHaveBeenCalled();
    const ttl = r2.getPresignedGetUrl.mock.calls[0]![1];
    expect(ttl).toBeGreaterThanOrEqual(60);
    expect(ttl).toBeLessThanOrEqual(900);
    const signedOpts = r2.getPresignedGetUrl.mock.calls[0]![2];
    expect(signedOpts?.responseCacheControl).toMatch(/private/);
    expect(signedOpts?.responseCacheControl).toMatch(/no-store/);
    expect(opened.redirectUrl).toContain("response-cache-control=");
  });

  it("authorized thumbnail retrieval also redirects to R2", async () => {
    const row = storyRow();
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 9, "thumbnail");
    const opened = await openStoryMediaFile(9, 42, "thumbnail", parseSignedQuery(signed));
    expect(opened.delivery).toBe("r2-redirect");
  });

  it("denies playback with a bad HMAC signature", async () => {
    const signed = buildSignedStoryMediaPath(42, 9, "file");
    const q = parseSignedQuery(signed);
    await expect(
      openStoryMediaFile(9, 42, "file", { ...q, s: "0".repeat(64) })
    ).rejects.toMatchObject({ status: 404 });
    expect(Story.findByPk).not.toHaveBeenCalled();
  });

  it("denies playback after the story expires", async () => {
    const row = storyRow({ expiresAt: new Date(Date.now() - 1000) });
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 9, "file");
    await expect(openStoryMediaFile(9, 42, "file", parseSignedQuery(signed))).rejects.toMatchObject({
      status: 404
    });
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("denies playback after the story is deleted", async () => {
    const row = storyRow({ deletedAt: new Date() });
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 9, "file");
    await expect(openStoryMediaFile(9, 42, "file", parseSignedQuery(signed))).rejects.toMatchObject({
      status: 404
    });
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("denies playback after an accepted connection is removed", async () => {
    const row = storyRow();
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    vi.mocked(hasAcceptedConnection).mockResolvedValue(false);
    const signed = buildSignedStoryMediaPath(42, 9, "file");
    await expect(openStoryMediaFile(9, 42, "file", parseSignedQuery(signed))).rejects.toMatchObject({
      status: 404
    });
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("Range/seek is delegated to R2 (gateway returns redirect, not sendFile bytes)", async () => {
    const row = storyRow({ mediaType: "video", mimeType: "video/mp4" });
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 7, "file");
    const opened = await openStoryMediaFile(7, 42, "file", parseSignedQuery(signed));
    expect(opened.delivery).toBe("r2-redirect");
    if (opened.delivery !== "r2-redirect") throw new Error("expected redirect");
    expect(opened.redirectUrl.startsWith("https://")).toBe(true);
    expect((opened as { byteSize?: number }).byteSize).toBeUndefined();
  });
});

describe("legacy local Story playback", () => {
  let root: string;
  let prevDir: string | undefined;
  const prevSecret = process.env.STORIES_MEDIA_SIGNING_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dh-stories-legacy-"));
    prevDir = process.env.STORIES_STORAGE_DIR;
    process.env.STORIES_STORAGE_DIR = root;
    process.env.STORIES_MEDIA_SIGNING_SECRET = SIGN_SECRET;
    vi.mocked(getBlockedUserIds).mockResolvedValue(new Set());
  });

  afterEach(() => {
    if (prevDir === undefined) delete process.env.STORIES_STORAGE_DIR;
    else process.env.STORIES_STORAGE_DIR = prevDir;
    if (prevSecret === undefined) delete process.env.STORIES_MEDIA_SIGNING_SECRET;
    else process.env.STORIES_MEDIA_SIGNING_SECRET = prevSecret;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("still streams leftover local/stories keys from disk (not as R2)", async () => {
    const saved = await saveStoryFile(7, jpegBytes(), "image/jpeg");
    expect(isStoryR2Key(saved.key)).toBe(false);
    expect(saved.key.startsWith(LOCAL_STORY_KEY_PREFIX)).toBe(true);
    const row = storyRow({
      userId: 7,
      mediaUrl: saved.key,
      thumbnailUrl: null,
      mimeType: saved.mimeType
    });
    vi.mocked(Story.findByPk).mockResolvedValue(row as any);
    const signed = buildSignedStoryMediaPath(42, 7, "file");
    const opened = await openStoryMediaFile(7, 42, "file", parseSignedQuery(signed));
    expect(opened.delivery).toBe("local");
    if (opened.delivery !== "local") throw new Error("expected local");
    expect(opened.absolutePath).toContain(root);
    expect(fs.existsSync(opened.absolutePath)).toBe(true);
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

describe("expiry scheduler + R2 delete retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2.deleteR2ObjectByKeyOrThrow.mockResolvedValue(undefined);
    vi.mocked(StoryView.destroy).mockResolvedValue(1 as any);
    vi.mocked(StoryLike.destroy).mockResolvedValue(1 as any);
  });

  it("soft-deletes expired stories and deletes R2 objects", async () => {
    const row = storyRow({ expiresAt: new Date(Date.now() - 1000) });
    vi.mocked(Story.findAll).mockResolvedValue([row] as any);
    const n = await cleanupExpiredStories(10);
    expect(n).toBe(1);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(r2.deleteR2ObjectByKeyOrThrow).toHaveBeenCalled();
    expect(row.mediaUrl).toBe(STORY_PURGED_MEDIA_KEY);
  });

  it("keeps R2 keys when delete fails so retry can run", async () => {
    const key = `${STORY_R2_KEY_PREFIX}7/2026/10/abc.jpg`;
    const row = storyRow({
      mediaUrl: key,
      thumbnailUrl: null,
      deletedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000)
    });
    r2.deleteR2ObjectByKeyOrThrow.mockRejectedValueOnce(new Error("r2 503"));
    vi.mocked(Story.findAll).mockResolvedValue([row] as any);
    const n = await retryFailedStoryMediaPurges(10);
    expect(n).toBe(0);
    expect(row.mediaUrl).toBe(key);
  });

  it("retry marks keys purged:// after a successful R2 delete", async () => {
    const key = `${STORY_R2_KEY_PREFIX}7/2026/10/abc.jpg`;
    const row = storyRow({
      mediaUrl: key,
      thumbnailUrl: null,
      deletedAt: new Date()
    });
    vi.mocked(Story.findAll).mockResolvedValue([row] as any);
    const n = await retryFailedStoryMediaPurges(10);
    expect(n).toBe(1);
    expect(row.mediaUrl).toBe(STORY_PURGED_MEDIA_KEY);
  });

  it("orphan cleanup deletes unreferenced old tmp R2 keys and skips referenced ones", async () => {
    const oldTmp = `${STORY_R2_KEY_PREFIX}9/2026/10/${STORY_UPLOAD_TMP_PREFIX}old.jpg`;
    const refTmp = `${STORY_R2_KEY_PREFIX}9/2026/10/${STORY_UPLOAD_TMP_PREFIX}ref.jpg`;
    const promoted = `${STORY_R2_KEY_PREFIX}9/2026/10/kept.jpg`;
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    r2.listR2ObjectsByPrefix.mockResolvedValue([
      { key: oldTmp, lastModified: oldTime },
      { key: refTmp, lastModified: oldTime },
      { key: promoted, lastModified: oldTime }
    ]);
    const result = await cleanupOrphanStoryR2Uploads({
      referencedKeys: new Set([refTmp]),
      maxAgeHours: 24
    });
    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(r2.deleteR2ObjectByKeyOrThrow).toHaveBeenCalledWith(oldTmp);
    expect(r2.deleteR2ObjectByKeyOrThrow).not.toHaveBeenCalledWith(refTmp);
    expect(r2.deleteR2ObjectByKeyOrThrow).not.toHaveBeenCalledWith(promoted);
  });
});

describe("unrelated media workflow regression", () => {
  it("generic Media.service still refuses the stories module (source contract)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/services/Media.service.ts"),
      "utf8"
    );
    expect(src).toMatch(/if \(module === "stories"\)/);
    expect(src).toMatch(/Stories must be uploaded via \/api\/stories\/upload/);
    expect(src).not.toMatch(/purpose === "stories"/);
  });
});
