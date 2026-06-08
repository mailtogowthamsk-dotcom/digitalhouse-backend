import { z } from "zod";
import { NOTIFICATION_CATEGORIES } from "../constants/notification.constants";

const categorySchema = z.enum([...NOTIFICATION_CATEGORIES, "ALL"] as [string, ...string[]]);

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  category: categorySchema.optional().default("ALL")
});

export const preferencesPatchSchema = z
  .object({
    socialEnabled: z.boolean().optional(),
    matrimonyEnabled: z.boolean().optional(),
    messagesEnabled: z.boolean().optional(),
    communityEnabled: z.boolean().optional(),
    systemEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional()
  })
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

export const pushTokenSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().max(128).nullable().optional(),
  appVersion: z.string().max(32).nullable().optional()
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(100)
});

export const adminBroadcastSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(2000),
  category: z.enum(NOTIFICATION_CATEGORIES as unknown as [string, ...string[]]).optional(),
  userIds: z.array(z.coerce.number().int().positive()).max(5000).optional(),
  actionType: z.string().max(64).optional(),
  actionTargetId: z.string().max(64).nullable().optional(),
  /** false = device push only (no notification center entry) */
  persistInApp: z.boolean().optional().default(true)
});
