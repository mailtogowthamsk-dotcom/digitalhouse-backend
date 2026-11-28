import { beforeEach, describe, expect, it, vi } from "vitest";
import { validatePostAttachments, publicPostAttachments } from "../../../src/services/post/attachments";
import { validateCreatePostBody } from "../../../src/validations/post.validation";

const mocks = vi.hoisted(() => ({ findAll: vi.fn() }));
vi.mock("../../../src/config/db", async () => {
  const { Sequelize } = await import("sequelize");
  return { sequelize: new Sequelize("mysql://test:test@127.0.0.1:3306/test", { logging: false }) };
});
vi.mock("../../../src/models", () => ({ MediaFile: { findAll: mocks.findAll } }));
vi.mock("../../../src/utils/r2Client", () => ({
  isPrivateR2Object: (key: string | null) => Boolean(key?.startsWith("private/")),
  toPublicUrlIfR2: (key: string | null) => key && !key.startsWith("private/") ? `https://cdn.test/${key}` : null,
  toPrivateSignedUrlIfR2: async (key: string) => `https://signed.test/${key}`
}));

const media = (id: number, fileType: "image" | "video" = "image") => ({
  id, fileType, objectKey: `private/${id}`, byteSize: 300,
  variantsJson: fileType === "video"
    ? JSON.stringify({ durationSec: 24, medium: `private/${id}_poster_md.webp` })
    : null
});
const feed = { post_type: "ENTERTAINMENT", creation_source: "feed", title: "Post" };

describe("Ordered Feed attachments", () => {
  beforeEach(() => vi.resetAllMocks());

  it("accepts five photos, rejects six, and preserves selection order", async () => {
    const rows = [1, 2, 3, 4, 5].map((id) => media(id));
    mocks.findAll.mockResolvedValue(rows);
    const selected = [2, 5, 4, 1, 3];
    expect((await validatePostAttachments(9, selected)).map((item) => item.mediaFileId)).toEqual(selected);
    expect(mocks.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 9, module: "posts", processingStatus: "completed" })
    }));
    await expect(validatePostAttachments(9, [1, 2, 3, 4, 5, 6])).rejects.toMatchObject({ status: 400 });
    expect(() => validateCreatePostBody({ ...feed, attachment_ids: [1, 2, 3, 4, 5, 6] })).toThrow();
  });

  it("accepts two photos plus a video and counts using the stored media type", async () => {
    mocks.findAll.mockResolvedValueOnce([media(1), media(2), media(3, "video")]);
    const items = await validatePostAttachments(9, [2, 1, 3]);
    expect(items.map((item) => item.mediaFileId)).toEqual([2, 1, 3]);
    expect(items[2]).toMatchObject({ mediaType: "video", videoDuration: 24, thumbnailUrl: "private/3_poster_md.webp" });
    mocks.findAll.mockResolvedValueOnce([media(1), media(2), media(4), media(3, "video")]);
    await expect(validatePostAttachments(9, [1, 2, 4, 3])).rejects.toThrow(/up to 3/);
  });

  it("rejects duplicate IDs, missing uploads and unvalidated video duration", async () => {
    await expect(validatePostAttachments(9, [1, 1])).rejects.toMatchObject({ status: 400 });
    mocks.findAll.mockResolvedValueOnce([]);
    await expect(validatePostAttachments(9, [1])).rejects.toMatchObject({ status: 400 });
    mocks.findAll.mockResolvedValueOnce([{ ...media(3, "video"), variantsJson: "{}" }]);
    await expect(validatePostAttachments(9, [3])).rejects.toThrow(/validated duration/);
  });

  it("keeps text-only and legacy single-media payloads valid", async () => {
    expect(validateCreatePostBody({ ...feed, description: "Legacy caption" }).attachment_ids).toBeUndefined();
    expect(validateCreatePostBody({ ...feed, media_url: "https://example.test/photo.jpg" }).media_url).toBeTruthy();
    expect(await validatePostAttachments(9, [])).toEqual([]);
    expect(mocks.findAll).not.toHaveBeenCalled();
  });

  it("keeps private media private and emits ordered URLs to an authorized owner", async () => {
    mocks.findAll.mockResolvedValueOnce([media(1), media(2, "video")]);
    const items = await validatePostAttachments(9, [2, 1]);
    expect(await publicPostAttachments(items, false)).toEqual([]);
    const result = await publicPostAttachments(items, true);
    expect(result?.map((item) => item.mediaType)).toEqual(["video", "image"]);
    expect(result?.[0]).not.toHaveProperty("mediaFileId");
  });
});
