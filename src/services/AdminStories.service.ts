/**
 * Admin Global Stories — publish/list/delete official VettuvaGounder stories.
 * Reuses Stories.service upload/create/delete; never weakens member privacy.
 */
import { Op } from "sequelize";
import { Story, StoryView, User } from "../models";
import {
  createStory,
  deleteOfficialStory,
  getOfficialStoryOwnerUserId,
  uploadStoryMediaBytes,
  type CreateStoryInput
} from "./Stories.service";
import { OFFICIAL_STORY_DISPLAY_NAME } from "../constants/stories.constants";

function serviceError(message: string, status = 400, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

async function assertOfficialOwnerExists(ownerId: number): Promise<void> {
  const user = await User.findByPk(ownerId, { attributes: ["id"] });
  if (!user) {
    serviceError(
      "OFFICIAL_STORY_OWNER_USER_ID does not match an existing user",
      503,
      "OFFICIAL_OWNER_MISSING"
    );
  }
}

function deriveStatus(story: Story, now = new Date()): "active" | "expired" | "deleted" {
  if (story.deletedAt) return "deleted";
  if (story.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export async function listAdminStories(params: { includeExpired?: boolean } = {}) {
  const now = new Date();
  const includeExpired = params.includeExpired !== false;
  const where: Record<string, unknown> = {
    isOfficial: true
  };
  if (!includeExpired) {
    where.deletedAt = null;
    where.expiresAt = { [Op.gt]: now };
  }

  const rows = await Story.findAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: 200
  });

  const ids = rows.map((s) => s.id);
  const viewCounts = new Map<number, number>();
  if (ids.length) {
    const views = await StoryView.findAll({
      where: { storyId: { [Op.in]: ids } },
      attributes: ["storyId"]
    });
    for (const v of views) {
      viewCounts.set(v.storyId, (viewCounts.get(v.storyId) ?? 0) + 1);
    }
  }

  const configuredOwner = Number(process.env.OFFICIAL_STORY_OWNER_USER_ID || "");
  return {
    identity: {
      name: OFFICIAL_STORY_DISPLAY_NAME,
      owner_user_id:
        Number.isInteger(configuredOwner) && configuredOwner > 0 ? configuredOwner : null
    },
    items: rows.map((s) => ({
      id: s.id,
      media_type: s.mediaType,
      caption: s.caption ?? null,
      duration_seconds: s.durationSeconds ?? null,
      mime_type: s.mimeType ?? null,
      file_size: s.fileSize ?? null,
      created_at: s.createdAt.toISOString(),
      expires_at: s.expiresAt.toISOString(),
      deleted_at: s.deletedAt ? s.deletedAt.toISOString() : null,
      created_by_admin_email: s.createdByAdminEmail ?? null,
      status: deriveStatus(s, now),
      view_count: viewCounts.get(s.id) ?? 0,
      like_count: s.likeCount ?? 0
    }))
  };
}

export async function uploadAdminStoryMedia(buffer: Buffer, mimeType: string) {
  const ownerId = getOfficialStoryOwnerUserId();
  await assertOfficialOwnerExists(ownerId);
  return uploadStoryMediaBytes(ownerId, buffer, mimeType);
}

export async function publishAdminStory(adminEmail: string, input: CreateStoryInput) {
  const ownerId = getOfficialStoryOwnerUserId();
  await assertOfficialOwnerExists(ownerId);
  const email = String(adminEmail || "").trim().slice(0, 191);
  if (!email) serviceError("Admin email required", 401, "UNAUTHORIZED");

  const story = await createStory(ownerId, input, {
    isOfficial: true,
    createdByAdminEmail: email
  });

  return {
    ...story,
    is_official: true,
    created_by_admin_email: email,
    identity_name: OFFICIAL_STORY_DISPLAY_NAME
  };
}

export async function removeAdminStory(storyId: number) {
  return deleteOfficialStory(storyId);
}
