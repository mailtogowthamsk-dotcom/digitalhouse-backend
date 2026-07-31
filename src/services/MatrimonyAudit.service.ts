import { MatrimonyReviewAudit } from "../models";

/**
 * Persist matrimony review / lifecycle audit events.
 * Shared leaf module — depended on by member and admin matrimony services (no upward imports).
 */
export async function writeAudit(
  userId: number,
  pendingUpdateId: number | null,
  action: string,
  createdBy: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await MatrimonyReviewAudit.create({
    userId,
    pendingUpdateId,
    action,
    payload: payload ?? null,
    createdBy,
    createdAt: new Date()
  } as any);
}
