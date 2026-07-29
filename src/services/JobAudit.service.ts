import { JobAuditLog } from "../models";

export async function logJobAudit(input: {
  postId?: number | null;
  jobInterestId?: number | null;
  actorType: "ADMIN" | "USER" | "SYSTEM";
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  statusFrom?: string | null;
  statusTo?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await JobAuditLog.create({
    postId: input.postId ?? null,
    jobInterestId: input.jobInterestId ?? null,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    statusFrom: input.statusFrom ?? null,
    statusTo: input.statusTo ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? null,
    createdAt: new Date()
  } as any);
}
