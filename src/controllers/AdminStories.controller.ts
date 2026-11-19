import type { Request, Response } from "express";
import { z } from "zod";
import { success, error } from "../utils/response";
import * as AdminStoriesService from "../services/AdminStories.service";
import {
  STORY_CAPTION_MAX_LENGTH,
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC
} from "../constants/stories.constants";
import { VIDEO_MAX_BYTES } from "../validations/media.validation";

type AdminRequest = Request & {
  adminEmail?: string;
};

function parseId(id: string | undefined): number | null {
  if (!id) return null;
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? null : n;
}

const publishSchema = z
  .object({
    media_url: z.string().trim().max(2048).nullable().optional(),
    media_type: z.enum(["image", "video", "text"]),
    caption: z.string().trim().max(STORY_CAPTION_MAX_LENGTH).nullable().optional(),
    thumbnail_url: z.string().trim().max(2048).nullable().optional(),
    duration_seconds: z.number().finite().nullable().optional(),
    mime_type: z.string().trim().max(128).nullable().optional(),
    file_size: z.number().int().positive().nullable().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.media_type === "text") {
      if (!data.caption?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Text is required",
          path: ["caption"]
        });
      }
      return;
    }
    if (!data.media_url?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Media is required",
        path: ["media_url"]
      });
    }
    if (data.media_type !== "video") return;
    const d = data.duration_seconds;
    if (d == null || !Number.isFinite(d)) return;
    if (d < STORY_VIDEO_MIN_DURATION_SEC || d > STORY_VIDEO_MAX_DURATION_SEC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Videos must be ${STORY_VIDEO_MIN_DURATION_SEC}–${STORY_VIDEO_MAX_DURATION_SEC} seconds`,
        path: ["duration_seconds"]
      });
    }
  });

export async function list(req: AdminRequest, res: Response) {
  const includeExpired = String(req.query.includeExpired ?? "1") !== "0";
  const data = await AdminStoriesService.listAdminStories({ includeExpired });
  return success(res, data);
}

export async function upload(req: AdminRequest, res: Response) {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return error(res, "Empty upload body", 400);
  }
  if (buf.length > VIDEO_MAX_BYTES) {
    return error(res, "File too large", 413);
  }
  const mime =
    (typeof req.query.mime === "string" && req.query.mime) ||
    req.header("content-type") ||
    "application/octet-stream";
  const data = await AdminStoriesService.uploadAdminStoryMedia(buf, mime);
  return success(res, data);
}

export async function publish(req: AdminRequest, res: Response) {
  if (!req.adminEmail) return error(res, "Unauthorized", 401);
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return error(res, parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const data = await AdminStoriesService.publishAdminStory(req.adminEmail, parsed.data);
  return success(res, { story: data }, 201);
}

export async function remove(req: AdminRequest, res: Response) {
  const id = parseId(req.params.id);
  if (id == null) return error(res, "Invalid id", 400);
  const data = await AdminStoriesService.removeAdminStory(id);
  return success(res, data);
}
