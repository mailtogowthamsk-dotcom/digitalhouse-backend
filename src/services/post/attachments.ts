import { Op } from "sequelize";
import { POST_IMAGE_UPLOAD_MAX_BYTES, POST_VIDEO_MAX_BYTES, POST_VIDEO_MAX_DURATION_SEC, POST_VIDEO_MIN_DURATION_SEC } from "../../constants/postMedia.constants";
import { MediaFile } from "../../models";
import type { StoredPostAttachment } from "../../models/Post.model";
import { isPrivateR2Object, toPrivateSignedUrlIfR2, toPublicUrlIfR2 } from "../../utils/r2Client";

export function attachmentKeys(attachments: StoredPostAttachment[] | null | undefined) {
  return (attachments ?? []).flatMap((item) => item.thumbnailUrl ? [item.url, item.thumbnailUrl] : [item.url]);
}

export async function validatePostAttachments(userId: number, ids: number[]): Promise<StoredPostAttachment[]> {
  if (!ids.length) return [];
  const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
  if (ids.length > 5 || new Set(ids).size !== ids.length) fail("Choose up to five distinct uploads.");
  const rows = await MediaFile.findAll({
    where: { id: { [Op.in]: ids }, userId, module: "posts", processingStatus: "completed" }
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== ids.length) fail("Choose completed uploads from your account.");
  const items = ids.map((id): StoredPostAttachment => {
    const row = byId.get(id);
    if (!row || (row.fileType !== "image" && row.fileType !== "video") || !row.objectKey) {
      return fail("An attachment is invalid or still processing.");
    }
    let variants: Record<string, unknown> = {};
    try { variants = row.variantsJson ? JSON.parse(row.variantsJson) ?? {} : {}; } catch { /* legacy metadata */ }
    const maxSize = row.fileType === "video" ? POST_VIDEO_MAX_BYTES : POST_IMAGE_UPLOAD_MAX_BYTES;
    if (row.byteSize != null && row.byteSize > maxSize) fail("An attachment exceeds the upload size limit.");
    const thumbnailUrl = row.fileType === "video"
      ? [variants.medium, variants.thumb, variants.full].find((key): key is string => typeof key === "string" && key.includes("_poster_")) ?? null
      : null;
    const duration = Number(variants.durationSec);
    if (row.fileType === "video" && (!Number.isFinite(duration) ||
        duration < POST_VIDEO_MIN_DURATION_SEC || duration > POST_VIDEO_MAX_DURATION_SEC + 0.5)) {
      fail("Choose a video with a validated duration within the post limit.");
    }
    return {
      mediaFileId: row.id, url: row.objectKey, mediaType: row.fileType, thumbnailUrl,
      videoDuration: row.fileType === "video" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
    };
  });
  if (items.some((item) => item.mediaType === "video") && items.length > 3) {
    fail("Posts with a video can have up to 3 attachments total.");
  }
  return items;
}

export type PostAttachmentDto = Omit<StoredPostAttachment, "mediaFileId">;

export async function publicPostAttachments(
  attachments: StoredPostAttachment[] | null | undefined,
  canSignPrivate: boolean
): Promise<PostAttachmentDto[] | undefined> {
  if (!attachments?.length) return undefined;
  const resolve = (url: string | null) => isPrivateR2Object(url) && canSignPrivate
    ? toPrivateSignedUrlIfR2(url) : Promise.resolve(toPublicUrlIfR2(url));
  const items = await Promise.all(attachments.map(async (item) => {
    const [url, thumbnailUrl] = await Promise.all([resolve(item.url), resolve(item.thumbnailUrl)]);
    return url ? { url, thumbnailUrl, mediaType: item.mediaType, videoDuration: item.videoDuration } : null;
  }));
  return items.filter((item): item is PostAttachmentDto => item != null);
}
