import { z } from "zod";

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursorId: z.coerce.number().int().min(1).optional()
});

export type MessagesHistoryQuery = z.infer<typeof paginationSchema>;

export function validateMessagesHistoryQuery(query: unknown): MessagesHistoryQuery {
  return paginationSchema.parse(query);
}

export const sendMessageSchema = z.object({
  recipientId: z.coerce.number().int().min(1),
  body: z.string().trim().min(1).max(5000),
  clientId: z.string().trim().min(1).max(64).optional()
});

export type SendMessageBody = z.infer<typeof sendMessageSchema>;

