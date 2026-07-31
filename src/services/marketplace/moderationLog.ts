import { ModerationAction } from "../../models";
import type { ModerationActionType } from "../../constants/reports.constants";

export async function logMarketplaceAction(input: {
  action: ModerationActionType;
  postId: number;
  targetUserId: number;
  adminEmail?: string | null;
  event: string;
  note?: string | null;
  reportId?: number | null;
}): Promise<void> {
  const noteParts = [`[MARKETPLACE] ${input.event}`, input.note?.trim()].filter(Boolean);
  await ModerationAction.create({
    action: input.action,
    targetUserId: input.targetUserId,
    postId: input.postId,
    reportKind: input.reportId ? "POST" : null,
    reportId: input.reportId ?? null,
    adminEmail: input.adminEmail?.trim() || "admin@system",
    note: noteParts.join(" | "),
    createdAt: new Date()
  } as any);
}
