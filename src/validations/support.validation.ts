import { z } from "zod";
import {
  SUPPORT_TICKET_TYPES,
  SUPPORT_BUG_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_PRIORITIES
} from "../constants/support.constants";

const metadataSchema = z
  .object({
    appVersion: z.string().max(40).optional(),
    apiVersion: z.string().max(40).optional(),
    platform: z.string().max(20).optional(),
    osVersion: z.string().max(40).optional(),
    deviceModel: z.string().max(120).optional(),
    community: z.string().max(120).optional().nullable(),
    userId: z.number().int().positive().optional(),
    screen: z.string().max(120).optional().nullable(),
    submittedAt: z.string().max(40).optional(),
    networkStatus: z.string().max(40).optional().nullable()
  })
  .passthrough()
  .optional()
  .nullable();

export const createSupportTicketSchema = z
  .object({
    type: z.enum(SUPPORT_TICKET_TYPES),
    category: z.enum(SUPPORT_BUG_CATEGORIES).optional().nullable(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(5000),
    screenshotUrl: z.string().trim().max(500).optional().nullable(),
    recordingUrl: z.string().trim().max(500).optional().nullable(),
    priority: z.enum(SUPPORT_PRIORITIES).optional(),
    metadata: metadataSchema
  })
  .superRefine((data, ctx) => {
    if (data.type === "BUG" && !data.category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Category is required for bug reports.",
        path: ["category"]
      });
    }
  });

export const supportTicketReplySchema = z.object({
  body: z.string().trim().min(1).max(5000)
});

export const adminUpdateTicketSchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  assignedAdminId: z.number().int().positive().nullable().optional(),
  reply: z.string().trim().min(1).max(5000).optional()
});

export const adminFaqSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(5000),
  category: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional()
});

export const adminGuideSchema = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(5000),
        imageUrl: z.string().trim().url().max(500).optional().nullable(),
        sortOrder: z.number().int().optional()
      })
    )
    .optional()
});

export const adminContactConfigSchema = z.object({
  email: z.string().trim().email().max(191).optional().nullable(),
  whatsappNumber: z.string().trim().max(40).optional().nullable(),
  phoneNumber: z.string().trim().max(40).optional().nullable(),
  chatEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  callEnabled: z.boolean().optional(),
  supportNote: z.string().trim().max(500).optional().nullable()
});
