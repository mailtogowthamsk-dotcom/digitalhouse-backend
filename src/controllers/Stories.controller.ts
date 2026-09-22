import type { Request, Response } from "express";
import { z } from "zod";
import { success, error } from "../utils/response";
import { storiesService } from "../services/Stories.service";
import {
  STORY_CAPTION_MAX_LENGTH,
  STORY_REPLY_MAX_LENGTH,
  STORY_VIDEO_MAX_DURATION_SEC,
  STORY_VIDEO_MIN_DURATION_SEC
} from "../constants/stories.constants";
import type { User } from "../models";

type AuthRequest = Request & {
  user?: User;
};

function parseId(id: string | undefined): number | null {
  if (!id) return null;
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? null : n;
}

const createSchema = z
  .object({
    media_url: z.string().trim().min(1).max(2048),
    media_type: z.enum(["image", "video"]),
    caption: z.string().trim().max(STORY_CAPTION_MAX_LENGTH).nullable().optional(),
    thumbnail_url: z.string().trim().max(2048).nullable().optional(),
    duration_seconds: z.number().finite().nullable().optional(),
    mime_type: z.string().trim().max(128).nullable().optional(),
    file_size: z.number().int().positive().nullable().optional()
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.media_type === "video") {
      const d = data.duration_seconds;
      if (d == null || !Number.isFinite(d)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Video duration is required",
          path: ["duration_seconds"]
        });
        return;
      }
      if (d < STORY_VIDEO_MIN_DURATION_SEC) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid video duration",
          path: ["duration_seconds"]
        });
      }
      if (d > STORY_VIDEO_MAX_DURATION_SEC) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Videos must be 30 seconds or less.",
          path: ["duration_seconds"]
        });
      }
    }
  });

const replySchema = z
  .object({
    body: z.string().trim().min(1).max(STORY_REPLY_MAX_LENGTH)
  })
  .strict();

export async function listTray(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await storiesService.listStoryTray(req.user.id);
  return success(res, data);
}

export async function create(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const body = createSchema.parse(req.body ?? {});
    const story = await storiesService.createStory(req.user.id, body);
    return success(res, { story }, 201);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      const msg = e.errors?.[0]?.message ?? "Invalid request";
      return error(res, msg, 400);
    }
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

/**
 * PUT /api/stories/upload
 * Body = raw file bytes. Stored on the API server disk (not R2).
 * Header: Content-Type = image/* | video/mp4
 */
export async function uploadMedia(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  try {
    const mime =
      (typeof req.query.mime === "string" && req.query.mime.trim()) ||
      req.header("content-type") ||
      "";
    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.isBuffer((req as any).rawBody)
        ? (req as any).rawBody
        : null;
    if (!buffer || !buffer.length) {
      return error(res, "Empty upload body", 400);
    }
    const data = await storiesService.uploadStoryMediaBytes(req.user.id, buffer, mime);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const story = await storiesService.getStory(req.user.id, id);
    return success(res, { story });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function markView(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const data = await storiesService.markStoryViewed(req.user.id, id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listViewers(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const data = await storiesService.listStoryViewers(req.user.id, id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function remove(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const data = await storiesService.deleteStory(req.user.id, id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function like(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const data = await storiesService.toggleStoryLike(req.user.id, id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function reply(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  try {
    const body = replySchema.parse(req.body ?? {});
    const data = await storiesService.replyToStory(req.user.id, id, body.body);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.name === "ZodError") {
      const msg = e.errors?.[0]?.message ?? "Invalid request";
      return error(res, msg, 400);
    }
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

async function streamStoryMedia(req: AuthRequest, res: Response, kind: "file" | "thumbnail") {
  const id = parseId(req.params?.id);
  if (id == null) return error(res, "Invalid story id", 400);
  const viewerId = Number(req.query.v);
  if (!Number.isInteger(viewerId) || viewerId <= 0) {
    return error(res, "Story not found", 404);
  }
  try {
    const opened = await storiesService.openStoryMediaFile(viewerId, id, kind, {
      v: typeof req.query.v === "string" ? req.query.v : String(viewerId),
      e: typeof req.query.e === "string" ? req.query.e : undefined,
      s: typeof req.query.s === "string" ? req.query.s : undefined
    });
    res.setHeader("Content-Type", opened.mimeType);
    res.setHeader("Content-Length", String(opened.byteSize));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.sendFile(opened.absolutePath);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function getFile(req: AuthRequest, res: Response) {
  return streamStoryMedia(req, res, "file");
}

export async function getThumbnail(req: AuthRequest, res: Response) {
  return streamStoryMedia(req, res, "thumbnail");
}
